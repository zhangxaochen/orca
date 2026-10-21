import type {
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult,
  RuntimeMobileSessionTerminalTab
} from '../../shared/runtime-types'
import type { AgentStatusEntry } from '../../shared/agent-status-types'
import type { TuiAgent } from '../../shared/tui-agent'
import { dropRetirementProofsForLiveSurfaces } from '../../shared/terminal-retirement-proof-ledger'
import { publishedCustomTitle } from './manual-terminal-title'
import type {
  RuntimeMobileSessionProjectionHost,
  RuntimeMobileSessionProjectionInput
} from './runtime-mobile-session-projection-contract'

export function buildProjectedMobileTerminalClientTab(args: {
  tab: RuntimeMobileSessionTerminalTab
  title: string
  effectiveManualTitle: string | null
  incarnationId?: string | null
  launchAgent: TuiAgent | null
  clientAgentStatus: { agentStatus?: AgentStatusEntry }
  turnCompletedAt?: number
  terminalHandle: string | null
}): RuntimeMobileSessionClientTab {
  const { tab, effectiveManualTitle, title, terminalHandle } = args
  return {
    type: 'terminal',
    id: tab.id,
    parentTabId: tab.parentTabId,
    leafId: tab.leafId,
    title: effectiveManualTitle ?? title,
    ...publishedCustomTitle(effectiveManualTitle, tab.customTitle),
    ...(tab.ptyId ? { ptyId: tab.ptyId } : {}),
    // Bind identity to the handle's live owner, never a stale persisted surface.
    ...(args.incarnationId ? { incarnationId: args.incarnationId } : {}),
    ...(tab.terminalTheme ? { terminalTheme: tab.terminalTheme } : {}),
    ...(args.launchAgent ? { launchAgent: args.launchAgent } : {}),
    ...args.clientAgentStatus,
    ...(args.turnCompletedAt !== undefined ? { turnCompletedAt: args.turnCompletedAt } : {}),
    ...(tab.parentLayout ? { parentLayout: tab.parentLayout } : {}),
    ...(tab.startupCwd ? { startupCwd: tab.startupCwd } : {}),
    ...(tab.color != null ? { color: tab.color } : {}),
    ...(tab.isPinned ? { isPinned: true } : {}),
    ...(tab.viewMode ? { viewMode: tab.viewMode } : {}),
    ...(tab.launchDraft ? { launchDraft: tab.launchDraft } : {}),
    ...(tab.launchDraftCreatedAt !== undefined
      ? { launchDraftCreatedAt: tab.launchDraftCreatedAt }
      : {}),
    isActive: tab.isActive,
    ...(terminalHandle
      ? { status: 'ready' as const, terminal: terminalHandle }
      : { status: 'pending-handle' as const, terminal: null })
  }
}

export function finalizeRuntimeMobileSessionTabsResult(
  { snapshot, tabs }: RuntimeMobileSessionProjectionInput,
  host: RuntimeMobileSessionProjectionHost
): RuntimeMobileSessionTabsResult {
  const active =
    tabs.find((tab) => tab.isActive && tab.id === snapshot.activeTabId) ??
    tabs.find((tab) => tab.isActive) ??
    (snapshot.activeTabId ? (tabs[0] ?? null) : null)
  const normalizedTabs =
    active && !tabs.some((tab) => tab.isActive)
      ? tabs.map((tab) => (tab.id === active.id ? { ...tab, isActive: true } : tab))
      : tabs
  const tabGroups = host.sanitizeGroups(snapshot.tabGroups, normalizedTabs)
  const validGroupIds = new Set(tabGroups?.map((group) => group.id) ?? [])
  const tabGroupLayout =
    snapshot.tabGroupLayout === undefined
      ? undefined
      : host.pruneGroupLayout(snapshot.tabGroupLayout, validGroupIds)
  const activeGroupId =
    snapshot.activeGroupId && validGroupIds.has(snapshot.activeGroupId)
      ? snapshot.activeGroupId
      : (tabGroups?.find((group) =>
          active ? group.tabOrder.some((tabId) => host.collectTabIds([active]).has(tabId)) : false
        )?.id ??
        tabGroups?.[0]?.id ??
        null)
  return {
    worktree: snapshot.worktree,
    publicationEpoch: snapshot.publicationEpoch,
    snapshotVersion: snapshot.snapshotVersion,
    activeGroupId,
    activeTabId: active?.id ?? null,
    activeTabType: active?.type ?? null,
    ...(tabGroups ? { tabGroups } : {}),
    ...(snapshot.tabGroupLayout !== undefined ? { tabGroupLayout } : {}),
    ...(snapshot.retiredTerminalSurfaces
      ? {
          retiredTerminalSurfaces: dropRetirementProofsForLiveSurfaces(
            snapshot.retiredTerminalSurfaces,
            snapshot.tabs
          )
        }
      : {}),
    tabs: normalizedTabs
  }
}
