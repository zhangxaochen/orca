import { MouseTargetType } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js'
import type { editor } from 'monaco-editor'
import {
  getDragAutoScrollStepPx,
  REFERENCE_FRAME_MS
} from '../../../diff-comments/diff-comment-drag-auto-scroll'

// Monaco's drag listens on its captured lines node, or on window when capture fails, and cancels each move it handles.
function replayPointerMove(cell: HTMLElement, pointer: PointerEvent, clientY: number): boolean {
  const target =
    pointer.target instanceof Node && cell.contains(pointer.target) ? pointer.target : cell
  return !target.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: pointer.buttons,
      clientX: pointer.clientX,
      clientY,
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      shiftKey: pointer.shiftKey,
      altKey: pointer.altKey,
      ctrlKey: pointer.ctrlKey,
      metaKey: pointer.metaKey
    })
  )
}

// Scroll only once the pointer is past the pane (over the sticky header or outside the viewport), so clicks and drags on an edge line never scroll.
export function getIpynbSelectionScroll(
  pane: { top: number; bottom: number },
  clientY: number,
  frameDeltaMs: number
): { y: number; step: number } {
  const y = Math.min(pane.bottom - 1, Math.max(pane.top + 1, clientY))
  if (y === clientY) {
    return { y, step: 0 }
  }
  const step = getDragAutoScrollStepPx({
    editorTop: pane.top,
    editorBottom: pane.bottom,
    clientY,
    frameDeltaMs
  })
  return { y, step }
}

// Cells grow to fit their text, so Monaco never edge-scrolls a drag; scroll the notebook and replay the held pointer so Monaco keeps extending the selection.
export function installIpynbSelectionScroll(
  editor: editor.IStandaloneCodeEditor,
  cell: HTMLElement
): void {
  const notebook = cell.closest<HTMLElement>('[data-ipynb-viewport]')
  const header = notebook?.querySelector<HTMLElement>('[data-ipynb-header]')
  if (!notebook || !header) {
    return
  }

  let stopDrag: (() => void) | undefined
  editor.onDidDispose(() => stopDrag?.())
  editor.onMouseDown(({ event, target }) => {
    stopDrag?.()
    if (
      !event.leftButton ||
      (target.type !== MouseTargetType.CONTENT_TEXT &&
        target.type !== MouseTargetType.CONTENT_EMPTY)
    ) {
      return
    }

    const controller = new AbortController()
    let pointer: PointerEvent | undefined
    let frame = 0
    let lastTime: number | undefined
    // Dragging selected text to move it leaves the selection unchanged, so only selection drags scroll.
    // Monaco selects the word or line before this runs, and never moves text on a double or triple click.
    const canMoveText = event.detail < 2
    let selecting = false
    const selectionListener = editor.onDidChangeCursorSelection((e) => {
      selecting ||= e.source === 'mouse' && !e.selection.isEmpty()
    })
    const stop = (): void => {
      controller.abort()
      cancelAnimationFrame(frame)
      selectionListener.dispose()
      stopDrag = undefined
    }
    stopDrag = stop

    const scroll = (time: number): void => {
      frame = 0
      const frameDeltaMs = lastTime === undefined ? REFERENCE_FRAME_MS : time - lastTime
      lastTime = undefined
      if (!pointer) {
        return
      }
      // The sticky header covers the top of the pane.
      const top = header.getBoundingClientRect().bottom
      // Client box, so a horizontal scrollbar is not part of the pane.
      const bottom =
        notebook.getBoundingClientRect().top + notebook.clientTop + notebook.clientHeight
      const { y, step } = getIpynbSelectionScroll({ top, bottom }, pointer.clientY, frameDeltaMs)
      // Monaco ignores moves over the header or past the pane, so a drag that leaves the pane from its edge line selects nothing; moving text needs a selection.
      if (!step || (!selecting && canMoveText && !editor.getSelection()?.isEmpty())) {
        return
      }
      const rect = cell.getBoundingClientRect()
      const hidden = step > 0 ? rect.bottom - bottom : top - rect.top
      const notebookScrollTop = notebook.scrollTop
      if (hidden > 0) {
        notebook.scrollTop += Math.sign(step) * Math.min(Math.abs(step), hidden)
      }
      if (notebook.scrollTop === notebookScrollTop) {
        // Past the cell's edge Monaco scrolls and extends the selection itself once it sees the real pointer.
        if (pointer.clientY < rect.top || pointer.clientY > rect.bottom) {
          if (!replayPointerMove(cell, pointer, pointer.clientY)) {
            stop()
          }
          return
        }
        // Cells past the line cap scroll inside Monaco.
        const editorScrollTop = editor.getScrollTop()
        editor.setScrollTop(editorScrollTop + step)
        if (editor.getScrollTop() === editorScrollTop) {
          return
        }
      }
      // Replay inside the pane so the selection ends on a visible line; an uncanceled replay means Monaco ended the drag.
      if (!replayPointerMove(cell, pointer, y)) {
        stop()
        return
      }
      lastTime = time
      frame = requestAnimationFrame(scroll)
    }

    const onPointer = (e: PointerEvent): void => {
      if (
        !e.isTrusted ||
        (e.pointerType !== 'mouse' && e.pointerType !== 'pen') ||
        (pointer && pointer.pointerId !== e.pointerId)
      ) {
        return
      }
      if (e.type !== 'pointermove' || e.buttons !== 1) {
        stop()
        return
      }
      pointer = e
      if (!frame) {
        frame = requestAnimationFrame(scroll)
      }
    }
    const options = { capture: true, signal: controller.signal }
    for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) {
      window.addEventListener(type, onPointer, options)
    }
    window.addEventListener('blur', stop, options)
  })
}
