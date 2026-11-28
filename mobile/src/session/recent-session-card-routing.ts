import type { ExecutionHostId } from '../../../src/shared/execution-host/execution-host'
import type { ConnectionState } from '../transport/connection/connection-state'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { rpcClientForExecutionHost } from '../worktree/execution-hosts/execution-host-scoped-rpc-client'
import { worktreeCatalogRead } from '../worktree/catalog/worktree-catalog-operations'
import { sessionTabsListRead } from './tabs/mobile-session-tab-read-operations'
import {
  clearRecentCardHostMetadataCacheForTests,
  collectRelayHostReachability,
  parseRecentCardWorktreeRows,
  readDesktopRecentCardHostMetadata,
  sameExecutionHostSets,
  type ParsedRecentCardWorktree
} from './recent-session-card-host-health'
import {
  isUnpublishedSnapshot,
  recentCardExecutionHostKey,
  recentCardSnapshotTabs
} from './recent-session-card-snapshot'
import {
  readAllRecentSessionCardsSync,
  reconcileRecentSessionCardsForWorktree,
  removeRecentSessionCard
} from './recent-session-cards'
import { recentCardWorktreeScopeKey } from './recent-session-card-visibility'

export type RecentCardWorktree = ParsedRecentCardWorktree

export type RecentCardsPollState = {
  worktrees: readonly RecentCardWorktree[]
  confirmedExecutionHosts: ReadonlySet<string>
  unreachableExecutionHosts: ReadonlySet<string>
}

export const EMPTY_RECENT_CARDS_POLL_STATE: RecentCardsPollState = {
  worktrees: [],
  confirmedExecutionHosts: new Set(),
  unreachableExecutionHosts: new Set()
}

const cachedPollStateByHost = new Map<string, RecentCardsPollState>()

export function getCachedRecentCardsPollState(hostId: string | undefined): RecentCardsPollState {
  return (hostId && cachedPollStateByHost.get(hostId)) || EMPTY_RECENT_CARDS_POLL_STATE
}

export function clearRecentCardsPollStateForTests(): void {
  cachedPollStateByHost.clear()
  clearRecentCardHostMetadataCacheForTests()
}

export function markRecentCardExecutionHostUnreachable(
  hostId: string,
  executionHost: ExecutionHostId | undefined
): RecentCardsPollState {
  const current = getCachedRecentCardsPollState(hostId)
  const key = recentCardExecutionHostKey(executionHost)
  if (!key || current.unreachableExecutionHosts.has(key)) {
    return current
  }
  const unreachableExecutionHosts = new Set(current.unreachableExecutionHosts)
  unreachableExecutionHosts.add(key)
  const confirmedExecutionHosts = new Set(current.confirmedExecutionHosts)
  confirmedExecutionHosts.delete(key)
  const next: RecentCardsPollState = {
    worktrees: current.worktrees,
    confirmedExecutionHosts,
    unreachableExecutionHosts
  }
  if (hostId) {
    cachedPollStateByHost.set(hostId, next)
  }
  return next
}

type ClientResolutionArgs = {
  targetExecutionHost: ExecutionHostId | undefined
  currentExecutionHost: ExecutionHostId | undefined
  currentClient: RpcClient | null
  currentConnState: ConnectionState
  pairedHostClient: RpcClient | null
  pairedHostState: ConnectionState
  hostCapabilities: readonly string[] | null | undefined
}

export function sameRecentCardsPollState(
  prev: RecentCardsPollState,
  next: RecentCardsPollState
): boolean {
  if (
    !sameExecutionHostSets(prev.confirmedExecutionHosts, next.confirmedExecutionHosts) ||
    !sameExecutionHostSets(prev.unreachableExecutionHosts, next.unreachableExecutionHosts) ||
    prev.worktrees.length !== next.worktrees.length
  ) {
    return false
  }
  return prev.worktrees.every(
    (a, i) =>
      a.worktreeId === next.worktrees[i]?.worktreeId &&
      recentCardExecutionHostKey(a.executionHost) ===
        recentCardExecutionHostKey(next.worktrees[i]?.executionHost) &&
      a.displayName === next.worktrees[i]?.displayName &&
      a.isArchived === next.worktrees[i]?.isArchived &&
      Boolean(a.unreachable) === Boolean(next.worktrees[i]?.unreachable)
  )
}

/** Route to the card's execution host via the paired desktop relay, falling back to the active screen client. */
export function resolveRecentCardClient(args: ClientResolutionArgs): RpcClient | null {
  const {
    targetExecutionHost,
    currentExecutionHost,
    currentClient,
    currentConnState,
    pairedHostClient,
    pairedHostState,
    hostCapabilities
  } = args
  if (pairedHostClient && pairedHostState === 'connected') {
    return rpcClientForExecutionHost(pairedHostClient, hostCapabilities ?? [], targetExecutionHost)
  }
  if (
    recentCardExecutionHostKey(targetExecutionHost) ===
      recentCardExecutionHostKey(currentExecutionHost) &&
    currentConnState === 'connected'
  ) {
    return currentClient
  }
  return null
}

export async function pollRecentCardsAcrossHosts(
  args: Omit<ClientResolutionArgs, 'targetExecutionHost'> & {
    hostId: string
    worktreeId: string
    sessionTabsCount: number
    isCancelled: () => boolean
  }
): Promise<RecentCardsPollState | null> {
  const { hostId, worktreeId, sessionTabsCount, currentExecutionHost, isCancelled, ...clientArgs } =
    args
  const cardsForHost = readAllRecentSessionCardsSync().filter((item) => item.hostId === hostId)
  const desktopClient = resolveRecentCardClient({
    ...clientArgs,
    currentExecutionHost,
    targetExecutionHost: undefined
  })
  const desktopMetadata = await readDesktopRecentCardHostMetadata(hostId, desktopClient)
  if (isCancelled() || !hostId) {
    return null
  }
  const { unreachableExecKeys, activeRuntimeExecKeys } = collectRelayHostReachability(
    desktopMetadata.relayHosts
  )
  const unreachableExecutionHosts = new Set(unreachableExecKeys)
  if (activeRuntimeExecKeys !== null) {
    for (const item of cardsForHost) {
      const cardExec = recentCardExecutionHostKey(item.executionHost)
      if (cardExec.startsWith('runtime:') && !activeRuntimeExecKeys.has(cardExec)) {
        unreachableExecutionHosts.add(cardExec)
        removeRecentSessionCard(hostId, item.worktreeId, undefined, undefined, item.executionHost)
      }
    }
  }
  const catalogTargets = new Map<string, ExecutionHostId | undefined>()
  for (const exec of [
    undefined,
    currentExecutionHost,
    ...cardsForHost.map((card) => card.executionHost)
  ]) {
    const key = recentCardExecutionHostKey(exec)
    if (!catalogTargets.has(key)) {
      catalogTargets.set(key, key ? exec : undefined)
    }
  }

  const worktrees: RecentCardWorktree[] = []
  const confirmedExecutionHosts = new Set<string>()
  const populatedExecutionHosts = new Set<string>()
  await Promise.allSettled(
    [...catalogTargets.entries()].map(async ([execKey, execHost]) => {
      if (execKey !== '' && unreachableExecutionHosts.has(execKey)) {
        return
      }
      const targetClient = resolveRecentCardClient({
        ...clientArgs,
        currentExecutionHost,
        targetExecutionHost: execHost
      })
      if (!targetClient) {
        if (execKey !== '') {
          unreachableExecutionHosts.add(execKey)
        }
        return
      }
      try {
        const reply = await worktreeCatalogRead.request(targetClient, { limit: 10000 })
        const catalog = !isCancelled() ? worktreeCatalogRead.interpret(reply) : null
        if (
          catalog?.accepted &&
          Array.isArray(catalog.value.worktrees) &&
          catalog.value.unchanged !== true
        ) {
          confirmedExecutionHosts.add(execKey)
          if (catalog.value.worktrees.length > 0) {
            populatedExecutionHosts.add(execKey)
          }
          const parsed = parseRecentCardWorktreeRows(
            catalog.value.worktrees,
            execHost,
            execKey === '' ? desktopMetadata : null
          )
          worktrees.push(...parsed.worktrees)
          for (const removedId of parsed.removedWorktreeIds) {
            removeRecentSessionCard(hostId, removedId, undefined, undefined, undefined)
          }
        } else if (execKey !== '' && !reply.ok) {
          unreachableExecutionHosts.add(execKey)
        }
      } catch {
        if (execKey !== '') {
          unreachableExecutionHosts.add(execKey)
        }
      }
    })
  )

  if (isCancelled() || !hostId) {
    return null
  }

  const activeWorktreeKeys = new Set(
    worktrees
      .filter((w) => !w.isArchived)
      .map((w) => recentCardWorktreeScopeKey(w.worktreeId, w.executionHost))
  )
  const prunedScopeKeys = new Set<string>()
  for (const item of cardsForHost) {
    const itemExecKey = recentCardExecutionHostKey(item.executionHost)
    const scopeKey = recentCardWorktreeScopeKey(item.worktreeId, item.executionHost)
    const hostAuthoritative =
      populatedExecutionHosts.has(itemExecKey) ||
      (itemExecKey !== '' && confirmedExecutionHosts.has(itemExecKey))
    if (hostAuthoritative && !activeWorktreeKeys.has(scopeKey) && !prunedScopeKeys.has(scopeKey)) {
      prunedScopeKeys.add(scopeKey)
      removeRecentSessionCard(hostId, item.worktreeId, undefined, undefined, item.executionHost)
    }
  }

  const reachableWorktreeKeys = new Set(
    worktrees
      .filter((w) => !w.isArchived && !w.unreachable)
      .map((w) => recentCardWorktreeScopeKey(w.worktreeId, w.executionHost))
  )
  const currentExecKey = recentCardExecutionHostKey(currentExecutionHost)
  const tabTargets = new Map<string, { worktreeId: string; executionHost?: ExecutionHostId }>()
  for (const item of cardsForHost) {
    const itemExecKey = recentCardExecutionHostKey(item.executionHost)
    if (item.worktreeId === worktreeId && itemExecKey === currentExecKey && sessionTabsCount > 0) {
      continue
    }
    const key = recentCardWorktreeScopeKey(item.worktreeId, item.executionHost)
    if (!reachableWorktreeKeys.has(key) || prunedScopeKeys.has(key) || tabTargets.has(key)) {
      continue
    }
    tabTargets.set(key, {
      worktreeId: item.worktreeId,
      ...(itemExecKey ? { executionHost: item.executionHost } : {})
    })
  }

  await Promise.allSettled(
    [...tabTargets.values()].map(async (target) => {
      const targetClient = resolveRecentCardClient({
        ...clientArgs,
        currentExecutionHost,
        targetExecutionHost: target.executionHost
      })
      if (!targetClient) {
        return
      }
      const reply = await sessionTabsListRead.request(targetClient, {
        worktree: `id:${target.worktreeId}`
      })
      const snapshot = !isCancelled() && reply.ok ? sessionTabsListRead.interpret(reply) : null
      const liveTabs =
        snapshot !== null && !isUnpublishedSnapshot(snapshot)
          ? recentCardSnapshotTabs(snapshot)
          : null
      if (liveTabs !== null) {
        reconcileRecentSessionCardsForWorktree({
          hostId,
          worktreeId: target.worktreeId,
          executionHost: target.executionHost,
          liveTabs,
          allowEmpty: true
        })
      }
    })
  )

  if (isCancelled()) {
    return null
  }
  const nextState: RecentCardsPollState = {
    worktrees,
    confirmedExecutionHosts,
    unreachableExecutionHosts
  }
  const prevCached = cachedPollStateByHost.get(hostId)
  if (!prevCached || !sameRecentCardsPollState(prevCached, nextState)) {
    cachedPollStateByHost.set(hostId, nextState)
  }
  return nextState
}
