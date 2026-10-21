import { defaultAgentChatLabel } from '../../shared/agent-session-chat-label'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

/** Project the one durable conversation name onto each structured tab's display title. */
export function titleStructuredConversationTabs(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  nameFor: (sessionId: string) => string | null | undefined,
  customTitleFor?: (sessionId: string) => string | null | undefined
): RuntimeMobileSessionTabsSnapshot {
  let changed = false
  const tabs = snapshot.tabs.map((tab) => {
    if (tab.type !== 'agent-session') {
      return tab
    }
    const customTitle =
      tab.customTitle === null
        ? null
        : tab.customTitle?.trim() || customTitleFor?.(tab.sessionId)?.trim() || undefined
    const title = customTitle || nameFor(tab.sessionId) || defaultAgentChatLabel(tab.agent)
    const nextCustomTitle = customTitle !== undefined ? customTitle : tab.customTitle
    if (tab.title === title && tab.customTitle === nextCustomTitle) {
      return tab
    }
    changed = true
    return {
      ...tab,
      title,
      ...(nextCustomTitle !== undefined ? { customTitle: nextCustomTitle } : {})
    }
  })
  return changed ? { ...snapshot, tabs } : snapshot
}

/** A changed title must cross the renderer's snapshot-version fence. */
export function retitleStructuredConversationTab(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  sessionId: string,
  name: string | null | undefined,
  customTitleFor?: (sessionId: string) => string | null | undefined
): RuntimeMobileSessionTabsSnapshot | null {
  let changed = false
  const tabs = snapshot.tabs.map((tab) => {
    if (tab.type !== 'agent-session' || tab.sessionId !== sessionId) {
      return tab
    }
    const customTitle =
      tab.customTitle === null
        ? null
        : tab.customTitle?.trim() || customTitleFor?.(tab.sessionId)?.trim() || undefined
    const title = customTitle || name || defaultAgentChatLabel(tab.agent)
    const nextCustomTitle = customTitle !== undefined ? customTitle : tab.customTitle
    if (tab.title === title && tab.customTitle === nextCustomTitle) {
      return tab
    }
    changed = true
    return {
      ...tab,
      title,
      ...(nextCustomTitle !== undefined ? { customTitle: nextCustomTitle } : {})
    }
  })
  return changed ? { ...snapshot, tabs, snapshotVersion: snapshot.snapshotVersion + 1 } : null
}
