import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileSessionTerminalInput } from './use-mobile-session-terminal-input'

vi.mock('../terminal/mobile-terminal-operations', () => ({
  terminalInputSend: {},
  terminalBufferClear: {}
}))
vi.mock('../terminal/worker-terminal-takeover-report', () => ({
  reportWorkerTerminalUserInput: vi.fn()
}))

type InputNode = {
  focus: ReturnType<typeof vi.fn>
  blur: ReturnType<typeof vi.fn>
  isFocused?: () => boolean
}

const renderers: ReactTestRenderer[] = []

function mountToggle(options: {
  keyboardHeight?: number
  nextEnabled: boolean
  liveFocused?: boolean
  commandFocused?: boolean
}) {
  const liveInput: InputNode = {
    focus: vi.fn(),
    blur: vi.fn(),
    isFocused: () => options.liveFocused ?? false
  }
  const commandInput: InputNode = {
    focus: vi.fn(),
    blur: vi.fn(),
    isFocused: () => options.commandFocused ?? false
  }
  const scope = {
    activeHandle: 'terminal-a',
    keyboardHeight: options.keyboardHeight ?? 0,
    toggleTerminalLiveInput: () => options.nextEnabled,
    clearPendingLiveInputCommit: vi.fn(),
    liveInputRef: { current: liveInput },
    commandInputRef: { current: commandInput },
    liveInputFocusTimerRef: { current: null }
  }
  let toggle = (): void => {}
  function Harness(): null {
    const actions = useMobileSessionTerminalInput(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only toggleLiveInput runs; all fields it reads are supplied above.
      scope as unknown as Parameters<typeof useMobileSessionTerminalInput>[0]
    )
    toggle = actions.toggleLiveInput
    return null
  }
  act(() => {
    renderers.push(create(createElement(Harness)))
  })
  return { toggle, liveInput, commandInput }
}

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()))
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Live input keyboard handoff', () => {
  it.each([
    {
      liveFocused: true,
      commandFocused: false,
      keyboardHeight: 0,
      nextEnabled: false,
      target: 'command'
    },
    {
      liveFocused: false,
      commandFocused: true,
      keyboardHeight: 0,
      nextEnabled: true,
      target: 'live'
    },
    {
      liveFocused: false,
      commandFocused: false,
      keyboardHeight: 280,
      nextEnabled: false,
      target: 'command'
    },
    {
      liveFocused: false,
      commandFocused: false,
      keyboardHeight: 280,
      nextEnabled: true,
      target: 'live'
    }
  ] as const)(
    'hands focus off synchronously with Live input $nextEnabled and keyboard height $keyboardHeight',
    ({ liveFocused, commandFocused, keyboardHeight, nextEnabled, target }) => {
      vi.useFakeTimers()
      const { toggle, liveInput, commandInput } = mountToggle({
        liveFocused,
        commandFocused,
        keyboardHeight,
        nextEnabled
      })

      act(toggle)

      const focused = target === 'live' ? liveInput : commandInput
      const other = target === 'live' ? commandInput : liveInput
      expect(focused.focus).toHaveBeenCalledTimes(1)
      expect(other.focus).not.toHaveBeenCalled()
      expect(liveInput.blur).not.toHaveBeenCalled()
      expect(commandInput.blur).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('schedules live input focus when the keyboard is closed and neither field is focused', () => {
    vi.useFakeTimers()
    const { toggle, liveInput, commandInput } = mountToggle({ nextEnabled: true })

    act(toggle)

    expect(liveInput.focus).not.toHaveBeenCalled()
    expect(liveInput.blur).not.toHaveBeenCalled()
    expect(commandInput.focus).not.toHaveBeenCalled()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(liveInput.focus).toHaveBeenCalledTimes(1)
  })

  it('blurs live input when the keyboard is closed and neither field is focused', () => {
    vi.useFakeTimers()
    const { toggle, liveInput, commandInput } = mountToggle({ nextEnabled: false })

    act(toggle)

    expect(liveInput.blur).toHaveBeenCalledTimes(1)
    expect(liveInput.focus).not.toHaveBeenCalled()
    expect(commandInput.focus).not.toHaveBeenCalled()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(commandInput.focus).not.toHaveBeenCalled()
    expect(liveInput.focus).not.toHaveBeenCalled()
  })
})
