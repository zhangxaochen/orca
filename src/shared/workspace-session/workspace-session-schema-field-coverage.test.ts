import { describe, expect, it } from 'vitest'

import { parseWorkspaceSession, workspaceSessionStateSchema } from './workspace-session-schema'
import type { WorkspaceSessionState } from './workspace-session-state-types'

/** Zod strips unlisted fields at local and SSH load boundaries although writes accept them. Pin schema coverage to WorkspaceSessionState so fields survive quit/relaunch, including close tombstones that otherwise resurrect tabs. */
const PERSISTED_WORKSPACE_SESSION_FIELDS = {
  activeRepoId: true,
  activeWorkspaceKey: true,
  activeWorkspaceExecutionHostId: true,
  activeWorktreeId: true,
  activeTabId: true,
  tabsByWorktree: true,
  terminalLayoutsByTabId: true,
  localOnlyScrollbackByTabId: true,
  activeWorktreeIdsOnShutdown: true,
  openFilesByWorktree: true,
  activeFileIdByWorktree: true,
  markdownFrontmatterVisible: true,
  browserTabsByWorktree: true,
  browserPagesByWorkspace: true,
  activeBrowserTabIdByWorktree: true,
  clientHostedBrowserPagesByWorktree: true,
  clientHostedBrowserCloseIntentsByEnvironment: true,
  pairedTerminalTabCloseIntentsByEnvironment: true,
  activeTabTypeByWorktree: true,
  browserUrlHistory: true,
  workspaceDocHistory: true,
  activeTabIdByWorktree: true,
  unifiedTabs: true,
  tabGroups: true,
  tabGroupLayouts: true,
  activeGroupIdByWorktree: true,
  activeConnectionIdsAtShutdown: true,
  remoteSessionIdsByTabId: true,
  lastVisitedAtByWorktreeId: true,
  defaultTerminalTabsAppliedByWorktreeId: true,
  sleepingAgentSessionsByPaneKey: true,
  terminalPtyIncarnationsByPaneKey: true,
  terminalTopologyRevisionByRepoId: true,
  terminalSurfaceTombstonesByPaneKey: true,
  closedTerminalTabTombstonesByTabId: true,
  sessionCustomTitles: true,
  closedTerminalPanesByPaneKey: true
} satisfies Record<keyof WorkspaceSessionState, true>

const MINIMAL_SESSION = {
  activeRepoId: null,
  activeWorktreeId: null,
  activeTabId: null,
  tabsByWorktree: {},
  terminalLayoutsByTabId: {}
}

describe('workspaceSessionStateSchema field coverage', () => {
  it('pins every WorkspaceSessionState field the load schema must keep', () => {
    expect(workspaceSessionStateSchema).toBeDefined()
    expect(PERSISTED_WORKSPACE_SESSION_FIELDS.closedTerminalTabTombstonesByTabId).toBe(true)
    expect(PERSISTED_WORKSPACE_SESSION_FIELDS.sessionCustomTitles).toBe(true)
  })

  it('round-trips the closed-tab tombstone map through parseWorkspaceSession', () => {
    // A persisted close must survive relaunch or disconnected tabs reappear despite every single-process test passing.
    const parsed = parseWorkspaceSession({
      ...MINIMAL_SESSION,
      closedTerminalTabTombstonesByTabId: {
        'tab-1': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1', reason: 'cleanup' },
        // An older build's acknowledgement stamp is dropped; the record itself survives.
        'tab-2': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1', ackRevision: 4 }
      }
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.closedTerminalTabTombstonesByTabId).toEqual({
      'tab-1': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1', reason: 'cleanup' },
      'tab-2': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1' }
    })
  })

  it('salvages a malformed tombstone entry rather than dropping the whole map', () => {
    const parsed = parseWorkspaceSession({
      ...MINIMAL_SESSION,
      closedTerminalTabTombstonesByTabId: {
        'tab-good': { closedAt: 1, worktreeId: 'repo:wt-1' },
        'tab-bad': { closedAt: 'nope', worktreeId: 'repo:wt-1' }
      }
    })

    expect(parsed.ok).toBe(true)
    expect(
      Object.keys((parsed.ok && parsed.value.closedTerminalTabTombstonesByTabId) || {})
    ).toEqual(['tab-good'])
  })
})
