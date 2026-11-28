import type { ExecutionHostId } from '../../../src/shared/execution-host/execution-host'
import { workspaceRouteHref } from '../navigation/workspace-execution-host'
import { triggerError, triggerSuccess } from '../platform/haptics/haptics'
import type { ConnectionState } from '../transport/connection/connection-state'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { classifyRecentCardActivationFailure } from './recent-session-card-host-health'
import {
  markRecentCardExecutionHostUnreachable,
  resolveRecentCardClient,
  type RecentCardsPollState
} from './recent-session-card-routing'
import { recentCardExecutionHostKey, recentCardRowKey } from './recent-session-card-snapshot'
import { removeRecentSessionCard, type RecentSessionCardRecord } from './recent-session-cards'
import {
  activateMobileSessionTab,
  setPendingCrossWorktreeTabTarget
} from './tabs/mobile-session-tab-activation'
import type { MobileSessionTab } from './tabs/mobile-session-tabs'

export type SelectRecentSessionCardDeps = {
  hostId: string
  worktreeId: string
  executionHost: ExecutionHostId | undefined
  client: RpcClient | null
  connState: ConnectionState
  pairedHostClient: RpcClient | null
  pairedHostState: ConnectionState
  hostCapabilities: readonly string[] | null | undefined
  sessionTabs: readonly MobileSessionTab[]
  activeSessionTabId: string | null
  recentCardsPollState: RecentCardsPollState
  effectiveUnreachableHosts: ReadonlySet<string>
  switchSessionTab: (tab: MobileSessionTab) => void
  showToast: (message: string, durationMs?: number) => void
  closeRecentCardSheets: () => void
  setPollState: (next: RecentCardsPollState) => void
  setJumpingCardKey: (key: string | null) => void
  replaceRoute: (href: string) => void
  t: (key: string, defaultValue: string) => string
}

export async function selectRecentSessionCard(
  card: RecentSessionCardRecord,
  deps: SelectRecentSessionCardDeps
): Promise<void> {
  const {
    hostId,
    worktreeId,
    executionHost,
    sessionTabs,
    activeSessionTabId,
    recentCardsPollState,
    effectiveUnreachableHosts,
    switchSessionTab,
    showToast,
    closeRecentCardSheets,
    setPollState,
    setJumpingCardKey,
    replaceRoute,
    t
  } = deps

  const reportUnreachable = () => {
    if (card.executionHost) {
      setPollState(markRecentCardExecutionHostUnreachable(hostId, card.executionHost))
    }
    triggerError()
    showToast(t('session.recentSessionCards.workspaceUnreachable', 'Workspace host is offline'))
    closeRecentCardSheets()
  }

  const cardExecKey = recentCardExecutionHostKey(card.executionHost)
  const isSameWorktree =
    card.worktreeId === worktreeId && cardExecKey === recentCardExecutionHostKey(executionHost)
  if (isSameWorktree) {
    if (card.tabId === activeSessionTabId) {
      closeRecentCardSheets()
      return
    }
    const targetTab = sessionTabs.find(
      (tab) =>
        tab.id === card.tabId ||
        (tab.type === 'terminal' &&
          Boolean(card.terminalHandle) &&
          tab.terminal === card.terminalHandle)
    )
    closeRecentCardSheets()
    if (targetTab) {
      switchSessionTab(targetTab)
      triggerSuccess()
    } else {
      removeRecentSessionCard(hostId, card.worktreeId, card.tabId, undefined, card.executionHost)
      triggerError()
      showToast(t('session.recentSessionCards.cardClosed', 'Card was closed'))
    }
    return
  }

  const knownWorktree = recentCardsPollState.worktrees.find(
    (w) =>
      w.worktreeId === card.worktreeId &&
      recentCardExecutionHostKey(w.executionHost) === cardExecKey
  )
  if (effectiveUnreachableHosts.has(cardExecKey) || knownWorktree?.unreachable) {
    reportUnreachable()
    return
  }

  const targetClient = resolveRecentCardClient({
    targetExecutionHost: card.executionHost,
    currentExecutionHost: executionHost,
    currentClient: deps.client,
    currentConnState: deps.connState,
    pairedHostClient: deps.pairedHostClient,
    pairedHostState: deps.pairedHostState,
    hostCapabilities: deps.hostCapabilities
  })
  if (!targetClient) {
    triggerError()
    showToast(t('session.recentSessionCards.waitingForHost', 'Waiting for host…'))
    return
  }

  setJumpingCardKey(recentCardRowKey(card))
  try {
    setPendingCrossWorktreeTabTarget({
      worktreeId: card.worktreeId,
      tabId: card.tabId,
      leafId: card.leafId,
      terminalHandle: card.terminalHandle
    })
    const response = await activateMobileSessionTab(targetClient, {
      worktree: `id:${card.worktreeId}`,
      tabId: card.tabId,
      ...(card.leafId ? { leafId: card.leafId } : {}),
      notifyClients: false,
      navigation: 'caller',
      intent: 'user'
    })
    if (!response.ok) {
      setPendingCrossWorktreeTabTarget(null)
      const outcome = classifyRecentCardActivationFailure(response.error.code)
      if (outcome === 'workspace-gone') {
        removeRecentSessionCard(hostId, card.worktreeId, undefined, undefined, card.executionHost)
        triggerError()
        showToast(t('session.recentSessionCards.workspaceGone', 'Workspace no longer exists'))
        closeRecentCardSheets()
        return
      }
      if (outcome === 'host-unreachable') {
        reportUnreachable()
        return
      }
      removeRecentSessionCard(hostId, card.worktreeId, card.tabId, undefined, card.executionHost)
      showToast(
        t(
          'session.recentSessionCards.cardClosedOpeningWorkspace',
          'Card was closed; opening workspace'
        )
      )
    } else {
      triggerSuccess()
    }
    closeRecentCardSheets()
    const query = card.worktreeName ? `?name=${encodeURIComponent(card.worktreeName)}` : ''
    replaceRoute(
      workspaceRouteHref(
        `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(card.worktreeId)}${query}`,
        card.executionHost
      )
    )
  } catch {
    setPendingCrossWorktreeTabTarget(null)
    reportUnreachable()
  } finally {
    setJumpingCardKey(null)
  }
}
