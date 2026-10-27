import { useRef, useCallback, useState } from 'react'
import { openExternalLink } from '../platform/external-link'
import { useWorkspaceRouteHandoff } from '../navigation/workspace-route-handoff'
import { createMobileFilePreviewHref } from '../files/mobile-file-preview-route'
import { isRendererUnavailableReply } from '../transport/renderer-unavailable-reply'
import { useMobileFileTapHandlers } from './use-mobile-file-tap-handlers'
import { displayNameFromPath, type MobileFileTapResolvedConfirmation } from './mobile-file-tap-open'
import { fileTapOpenRun } from './mobile-session-launch-operations'
import { resolveMobileNativeChatSessionId } from './native-chat/mobile-native-chat-eligibility'
import {
  activateOpenedSessionTab,
  activateOpenedSourceControlDiffTab,
  findOpenedMobileSessionTab
} from './opened-mobile-session-tab'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { MobileSessionTerminalSendActionsModel } from './use-mobile-session-terminal-send-actions'

export type PendingTerminalFileTap = MobileFileTapResolvedConfirmation & {
  onOpen: () => void
}

export function useMobileSessionFileActions(scope: MobileSessionTerminalSendActionsModel) {
  const {
    hostId,
    worktreeId,
    routeWorktreeName,
    isFloatingWorkspaceRoute,
    client,
    sessionTabsRef,
    terminalLinkOpenMode,
    activeSessionTabIdRef,
    terminalCwdRef,
    activeHandleRef,
    activeSessionTab,
    activeSessionTabTypeRef,
    switchSessionTabRef,
    handleCreateBrowserRef,
    scheduleDelayedAction,
    nativeChatSendError,
    fetchSessionTabs
  } = scope
  const [pendingTerminalFileTap, setPendingTerminalFileTap] =
    useState<PendingTerminalFileTap | null>(null)
  const fileInitialLineSeqRef = useRef(0)
  const [fileInitialLines, setFileInitialLines] = useState<
    ReadonlyMap<string, { line: number; seq: number }>
  >(() => new Map())
  const confirmTerminalFileTapOpen = useCallback(
    (target: MobileFileTapResolvedConfirmation, proceed: () => void) => {
      setPendingTerminalFileTap({ ...target, onOpen: proceed })
    },
    []
  )
  const revealFileLine = useCallback((relativePath: string, line: number) => {
    const seq = ++fileInitialLineSeqRef.current
    setFileInitialLines((prev) => new Map(prev).set(relativePath, { line, seq }))
  }, [])
  // Tap a terminal or chat file path → resolve on host, open as file tab/preview.
  const { handleFileTap, handleNativeChatFileTap } = useMobileFileTapHandlers<MobileSessionTab>({
    client,
    hostId,
    worktreeId,
    worktreeName: routeWorktreeName,
    nativeChatSessionId: resolveMobileNativeChatSessionId(activeSessionTab),
    activeHandleRef,
    terminalCwdRef,
    openBrowser: (url) => void handleCreateBrowserRef.current?.(url),
    fetchSessionTabs,
    getSessionTabs: () => sessionTabsRef.current,
    getActiveSessionTabId: () => activeSessionTabIdRef.current,
    getActiveSessionTabType: () => activeSessionTabTypeRef.current,
    switchSessionTab: (tab) => switchSessionTabRef.current?.(tab),
    scheduleDelayedAction,
    reportChatTapFailure: nativeChatSendError.show,
    confirmTerminalFileTapOpen,
    onRevealFileLine: revealFileLine
  })

  const handleOpenedFileDiffActivationSeqRef = useRef(0)
  // Capture the active tab before awaiting openDiff so focus retries cannot override a later user switch.
  const fileOpenStartActiveTabIdRef = useRef<string | null>(null)
  const handleFileOpenStart = useCallback(() => {
    fileOpenStartActiveTabIdRef.current = activeSessionTabIdRef.current
  }, [])
  const handleOpenedFileDiff = useCallback(
    (relativePath: string) => {
      const activationSeq = ++handleOpenedFileDiffActivationSeqRef.current
      const activeTabIdAtTap = fileOpenStartActiveTabIdRef.current

      let activated = false
      const activateOpenedTab = async (): Promise<void> => {
        const settled = await activateOpenedSourceControlDiffTab<MobileSessionTab>({
          relativePath,
          activeTabIdAtTap,
          fetchSessionTabs,
          getTabs: () => sessionTabsRef.current,
          getActiveTabId: () => activeSessionTabIdRef.current,
          getActivationState: () => ({
            activated,
            activationSeq,
            latestActivationSeq: handleOpenedFileDiffActivationSeqRef.current
          }),
          switchSessionTab: (tab) => switchSessionTabRef.current?.(tab)
        })
        if (settled) {
          activated = true
        }
      }

      scheduleDelayedAction(() => void activateOpenedTab(), 300)
      scheduleDelayedAction(() => void activateOpenedTab(), 900)
      scheduleDelayedAction(() => void activateOpenedTab(), 1800)
    },
    [fetchSessionTabs, scheduleDelayedAction]
  )

  const router = useWorkspaceRouteHandoff()
  const handleOpenFile = useCallback(
    (relativePath: string) => {
      if (!client) {
        return
      }
      handleFileOpenStart()
      const activationSeq = ++handleOpenedFileDiffActivationSeqRef.current
      const activeTabIdAtTap = fileOpenStartActiveTabIdRef.current

      const existingTab = findOpenedMobileSessionTab(sessionTabsRef.current, relativePath, {
        preferMode: 'edit'
      })
      if (existingTab) {
        switchSessionTabRef.current?.(existingTab)
        return
      }

      void fileTapOpenRun
        .request(
          client,
          { worktree: `id:${worktreeId}`, relativePath },
          { timeoutMs: 15_000 }
        )
        .then((res) => {
          if (isRendererUnavailableReply(res)) {
            router.push(
              createMobileFilePreviewHref({
                hostId,
                worktreeId,
                source: 'worktree',
                relativePath,
                name: displayNameFromPath(relativePath),
                worktreeName: routeWorktreeName
              })
            )
          }
        })

      let activated = false
      const activateOpenedTab = async (): Promise<void> => {
        const settled = await activateOpenedSessionTab<MobileSessionTab>({
          relativePath,
          activeTabIdAtTap,
          fetchSessionTabs,
          getTabs: () => sessionTabsRef.current,
          getActiveTabId: () => activeSessionTabIdRef.current,
          getActivationState: () => ({
            activated,
            activationSeq,
            latestActivationSeq: handleOpenedFileDiffActivationSeqRef.current
          }),
          switchSessionTab: (tab) => switchSessionTabRef.current?.(tab),
          preferMode: 'edit'
        })
        if (settled) {
          activated = true
        }
      }

      scheduleDelayedAction(() => void activateOpenedTab(), 200)
      scheduleDelayedAction(() => void activateOpenedTab(), 600)
      scheduleDelayedAction(() => void activateOpenedTab(), 1200)
    },
    [
      client,
      fetchSessionTabs,
      handleFileOpenStart,
      hostId,
      routeWorktreeName,
      router,
      scheduleDelayedAction,
      sessionTabsRef,
      switchSessionTabRef,
      worktreeId
    ]
  )

  const handleTerminalOpenUrl = useCallback(
    (handle: string, url: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      // Why: browser.tabCreate resolves a real worktree, which the floating
      // sentinel doesn't have — open taps in the phone browser instead.
      if (terminalLinkOpenMode === 'phone-browser' || isFloatingWorkspaceRoute) {
        openExternalLink(url)
        return
      }
      void handleCreateBrowserRef.current?.(url)
    },
    [terminalLinkOpenMode, isFloatingWorkspaceRoute]
  )
  return {
    pendingTerminalFileTap,
    setPendingTerminalFileTap,
    fileInitialLines,
    handleFileTap,
    handleNativeChatFileTap,
    handleOpenedFileDiffActivationSeqRef,
    fileOpenStartActiveTabIdRef,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleOpenFile,
    handleTerminalOpenUrl
  }
}

export type MobileSessionFileActionsModel = MobileSessionTerminalSendActionsModel &
  ReturnType<typeof useMobileSessionFileActions>
