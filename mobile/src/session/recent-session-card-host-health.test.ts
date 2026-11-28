import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY } from '../../../src/shared/remote-runtime/relay/mobile-desktop-relay-contract'
import { persistMirrored, retainMirroredStorage } from '../storage/mirrored-storage-keys'
import { LAST_VISITED_WORKTREE_STORAGE_KEY } from '../worktree/navigation/last-visited-worktree-repo'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import {
  canRetireUnconfirmedLocalGhostTab,
  classifyRecentCardActivationFailure
} from './recent-session-card-host-health'
import {
  clearRecentCardsPollStateForTests,
  pollRecentCardsAcrossHosts
} from './recent-session-card-routing'
import {
  RECENT_SESSION_CARDS_STORAGE_KEY,
  clearRecentSessionCardsForTests,
  getVisibleRecentSessionCards,
  readAllRecentSessionCardsSync,
  recordRecentSessionCardVisit,
  type RecentSessionCardRecord
} from './recent-session-cards'

const storage = vi.hoisted(() => ({ items: new Map<string, string>() }))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.items.set(key, value)
    },
    removeItem: async (key: string) => {
      storage.items.delete(key)
    },
    multiGet: async (keys: readonly string[]) =>
      keys.map((key) => [key, storage.items.get(key) ?? null] as const)
  }
}))

function card(
  overrides: Partial<RecentSessionCardRecord> & Pick<RecentSessionCardRecord, 'tabId'>
): RecentSessionCardRecord {
  return {
    hostId: 'host-1',
    worktreeId: 'wt-local',
    worktreeName: 'orca',
    title: overrides.tabId,
    tabType: 'terminal',
    lastVisitedAt: 1,
    ...overrides
  }
}

async function settleWrites(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

let releaseStorage: (() => void) | null = null

beforeEach(async () => {
  await settleWrites()
  releaseStorage?.()
  releaseStorage = retainMirroredStorage([
    RECENT_SESSION_CARDS_STORAGE_KEY,
    LAST_VISITED_WORKTREE_STORAGE_KEY
  ])
  storage.items.clear()
  await persistMirrored(RECENT_SESSION_CARDS_STORAGE_KEY, null)
  await persistMirrored(LAST_VISITED_WORKTREE_STORAGE_KEY, null)
  clearRecentSessionCardsForTests()
  clearRecentCardsPollStateForTests()
})

afterEach(() => {
  clearRecentCardsPollStateForTests()
  releaseStorage?.()
  releaseStorage = null
})

describe('recent-session-card-host-health', () => {
  it('hides unreachable SSH/runtime cards, prunes removed/rebuilt hosts, and restores when recovered', async () => {
    let sshConnected = false
    let sshRemoved = false
    let runtimeRelay: 'ready' | 'unavailable' = 'unavailable'
    let runtimeWorktrees: { worktreeId: string; displayName: string }[] = [
      { worktreeId: 'wt-runtime', displayName: 'Runtime App' }
    ]

    recordRecentSessionCardVisit(
      card({ worktreeId: 'wt-local', tabId: 'tab-local', lastVisitedAt: 10 })
    )
    recordRecentSessionCardVisit(
      card({ worktreeId: 'wt-ssh', tabId: 'tab-ssh', lastVisitedAt: 20 })
    )
    recordRecentSessionCardVisit(
      card({
        worktreeId: 'wt-runtime',
        tabId: 'tab-runtime',
        executionHost: 'runtime:env-1',
        lastVisitedAt: 30
      })
    )
    recordRecentSessionCardVisit(
      card({
        worktreeId: 'wt-removed-env',
        tabId: 'tab-removed-env',
        executionHost: 'runtime:env-gone',
        lastVisitedAt: 40
      })
    )

    const client: RpcClient = {
      sendRequest: async (method, params, options) => {
        const execHost = options?.envelope?.executionHost
        if (method === 'repo.list') {
          return {
            ok: true,
            result: {
              snapshotId: 'repo-snap-1',
              repos: [
                { id: 'repo-local', displayName: 'Local', executionHostId: 'local' },
                { id: 'repo-ssh', displayName: 'RemoteSSH', connectionId: 'ssh-target-1' }
              ]
            }
          }
        }
        if (method === 'ssh.listTargetSummaries') {
          return {
            ok: true,
            result: {
              targets: sshRemoved
                ? []
                : [
                    {
                      id: 'ssh-target-1',
                      label: 'Container SSH',
                      connected: sshConnected,
                      connectionStatus: sshConnected ? 'connected' : 'disconnected'
                    }
                  ]
            }
          }
        }
        if (method === 'mobileRelay.hosts.list') {
          return {
            ok: true,
            result: {
              hosts: [
                {
                  hostId: 'runtime:env-1',
                  label: 'Container Runtime',
                  health: runtimeRelay === 'ready' ? 'available' : 'disconnected',
                  relay: runtimeRelay
                }
              ]
            }
          }
        }
        if (method === 'worktree.ps') {
          if (execHost === 'runtime:env-1') {
            return {
              ok: true,
              result: { snapshotId: 'rt-1', worktrees: runtimeWorktrees }
            }
          }
          return {
            ok: true,
            result: {
              snapshotId: 'desk-1',
              worktrees: [
                { worktreeId: 'wt-local', repoId: 'repo-local', displayName: 'Local Main' },
                { worktreeId: 'wt-ssh', repoId: 'repo-ssh', displayName: 'SSH Work' }
              ]
            }
          }
        }
        if (method === 'session.tabs.list') {
          const wt = (params as { worktree?: string } | undefined)?.worktree
          if (wt === 'id:wt-ssh') {
            throw new Error('session.tabs.list must not run for unreachable SSH worktree')
          }
          return {
            ok: true,
            result: {
              worktree: wt ?? 'id:wt-local',
              tabs: [{ id: wt === 'id:wt-runtime' ? 'tab-runtime' : 'tab-local', type: 'terminal' }]
            }
          }
        }
        return { ok: false, error: { code: 'unsupported', message: method } }
      },
      subscribe: () => () => {},
      updateTerminalSubscriptionViewport: () => {},
      getState: () => 'connected',
      getReconnectAttempt: () => 0,
      getLastConnectedAt: () => null,
      onStateChange: () => () => {},
      notifyForeground: () => {},
      close: () => {}
    }

    const disconnectedPoll = await pollRecentCardsAcrossHosts({
      hostId: 'host-1',
      worktreeId: 'wt-other',
      sessionTabsCount: 1,
      currentClient: client,
      currentConnState: 'connected',
      pairedHostClient: client,
      pairedHostState: 'connected',
      hostCapabilities: [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY],
      isCancelled: () => false
    })
    expect(disconnectedPoll?.unreachableExecutionHosts.has('runtime:env-1')).toBe(true)
    expect(
      getVisibleRecentSessionCards({
        hostId: 'host-1',
        currentWorktreeId: 'wt-other',
        currentTabId: 'tab-other',
        liveWorktrees: disconnectedPoll?.worktrees,
        confirmedExecutionHosts: disconnectedPoll?.confirmedExecutionHosts,
        unreachableExecutionHosts: disconnectedPoll?.unreachableExecutionHosts
      }).map((c) => c.tabId)
    ).toEqual(['tab-local'])
    expect(readAllRecentSessionCardsSync().map((c) => c.tabId)).toEqual([
      'tab-runtime',
      'tab-ssh',
      'tab-local'
    ])

    // SSH reconnects -> wt-ssh card becomes visible again without losing recency.
    sshConnected = true
    const reconnectedSshPoll = await pollRecentCardsAcrossHosts({
      hostId: 'host-1',
      worktreeId: 'wt-other',
      sessionTabsCount: 1,
      currentClient: client,
      currentConnState: 'connected',
      pairedHostClient: client,
      pairedHostState: 'connected',
      hostCapabilities: [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY],
      isCancelled: () => false
    })
    expect(
      getVisibleRecentSessionCards({
        hostId: 'host-1',
        currentWorktreeId: 'wt-other',
        currentTabId: 'tab-other',
        liveWorktrees: reconnectedSshPoll?.worktrees,
        confirmedExecutionHosts: reconnectedSshPoll?.confirmedExecutionHosts,
        unreachableExecutionHosts: reconnectedSshPoll?.unreachableExecutionHosts
      }).map((c) => c.tabId)
    ).toEqual(['tab-ssh', 'tab-local'])

    // Rebuilt runtime container comes online empty (`worktrees: []`) and removed SSH target disappears -> both pruned.
    runtimeRelay = 'ready'
    runtimeWorktrees = []
    sshRemoved = true
    await pollRecentCardsAcrossHosts({
      hostId: 'host-1',
      worktreeId: 'wt-other',
      sessionTabsCount: 1,
      currentClient: client,
      currentConnState: 'connected',
      pairedHostClient: client,
      pairedHostState: 'connected',
      hostCapabilities: [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY],
      isCancelled: () => false
    })
    expect(readAllRecentSessionCardsSync().map((c) => c.tabId)).toEqual(['tab-local'])
  })

  it('classifies activation failures and allows ghost-tab retirement only when unconfirmed', () => {
    expect(classifyRecentCardActivationFailure('remote_runtime_unavailable')).toBe(
      'host-unreachable'
    )
    expect(classifyRecentCardActivationFailure('runtime_timeout')).toBe('host-unreachable')
    expect(classifyRecentCardActivationFailure('repo_not_found')).toBe('workspace-gone')
    expect(classifyRecentCardActivationFailure('selector_not_found')).toBe('workspace-gone')
    expect(classifyRecentCardActivationFailure('tab_not_found')).toBe('tab-closed')

    expect(canRetireUnconfirmedLocalGhostTab(-1, 'remote_runtime_unavailable')).toBe(true)
    expect(canRetireUnconfirmedLocalGhostTab(-1, 'runtime_timeout')).toBe(true)
    expect(canRetireUnconfirmedLocalGhostTab(-1, undefined)).toBe(true)
    expect(canRetireUnconfirmedLocalGhostTab(0, 'remote_runtime_unavailable')).toBe(false)
    expect(canRetireUnconfirmedLocalGhostTab(3, 'runtime_unavailable')).toBe(false)
  })
})
