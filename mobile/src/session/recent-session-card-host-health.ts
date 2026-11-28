import type { ExecutionHostId } from '../../../src/shared/execution-host/execution-host'
import type { ExecutionHostHealth } from '../../../src/shared/execution-host/execution-host-health'
import type { MobileRelayHost } from '../../../src/shared/remote-runtime/relay/mobile-relay-hosts-contract'
import { sshTargetSummaryHostId } from '../../../src/shared/worktree/row-display/host-context-labels'
import { settledMetadataReply } from '../host-screen/catalog/host-ssh-target-labels-read'
import {
  hostRepoCatalogSnapshotRead,
  hostSshTargetSummariesRead
} from '../host-screen/host-screen-operations'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { relayHostsListRead } from '../worktree/execution-hosts/server-workspace-operations'
import { serverHostHealth } from '../worktree/execution-hosts/server-host-health'
import { buildSshHostHealthById } from '../worktree/execution-hosts/worktree-host-health'
import {
  buildRepoHostIdByRepoId,
  resolveWorktreeHostId
} from '../worktree/row-presentation/worktree-host-context-labels'
import { recentCardExecutionHostKey } from './recent-session-card-snapshot'

type CachedRepoHostMap = {
  snapshotId: string | null
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
}

export type DesktopRecentCardHostMetadata = {
  repoHostIdByRepoId: ReadonlyMap<string, ExecutionHostId>
  knownSshHostIds: ReadonlySet<ExecutionHostId> | null
  sshHealthByHostId: ReadonlyMap<ExecutionHostId, ExecutionHostHealth>
  relayHosts: readonly MobileRelayHost[] | null
}

const repoHostMapCache = new Map<string, CachedRepoHostMap>()

export function clearRecentCardHostMetadataCacheForTests(): void {
  repoHostMapCache.clear()
}

async function readRepoHostIdMap(
  hostId: string,
  desktopClient: RpcClient
): Promise<ReadonlyMap<string, ExecutionHostId>> {
  const held = repoHostMapCache.get(hostId)
  const reply = await settledMetadataReply(() =>
    hostRepoCatalogSnapshotRead.request(desktopClient, {
      afterSnapshotId: held?.snapshotId ?? null
    })
  )
  const parsed = reply ? hostRepoCatalogSnapshotRead.interpret(reply) : null
  if (!parsed?.accepted) {
    return held?.repoHostIdByRepoId ?? new Map()
  }
  if (parsed.value.kind === 'catalog') {
    const repoHostIdByRepoId = buildRepoHostIdByRepoId(parsed.value.repos)
    repoHostMapCache.set(hostId, {
      snapshotId: parsed.value.snapshotId,
      repoHostIdByRepoId
    })
    return repoHostIdByRepoId
  }
  if (held && parsed.value.snapshotId === held.snapshotId) {
    return held.repoHostIdByRepoId
  }
  const fullReply = await settledMetadataReply(() =>
    hostRepoCatalogSnapshotRead.request(desktopClient, { afterSnapshotId: null })
  )
  const fullParsed = fullReply ? hostRepoCatalogSnapshotRead.interpret(fullReply) : null
  if (fullParsed?.accepted && fullParsed.value.kind === 'catalog') {
    const repoHostIdByRepoId = buildRepoHostIdByRepoId(fullParsed.value.repos)
    repoHostMapCache.set(hostId, {
      snapshotId: fullParsed.value.snapshotId,
      repoHostIdByRepoId
    })
    return repoHostIdByRepoId
  }
  return held?.repoHostIdByRepoId ?? new Map()
}

export async function readDesktopRecentCardHostMetadata(
  hostId: string,
  desktopClient: RpcClient | null
): Promise<DesktopRecentCardHostMetadata> {
  if (!desktopClient) {
    return {
      repoHostIdByRepoId: new Map(),
      knownSshHostIds: null,
      sshHealthByHostId: new Map(),
      relayHosts: null
    }
  }
  const [repoRes, sshRes, relayRes] = await Promise.allSettled([
    readRepoHostIdMap(hostId, desktopClient),
    settledMetadataReply(() => hostSshTargetSummariesRead.request(desktopClient)),
    settledMetadataReply(() => relayHostsListRead.request(desktopClient)).then((reply) => {
      const parsed = reply ? relayHostsListRead.interpret(reply) : null
      return parsed?.accepted ? parsed.value : null
    })
  ])
  const repoHostIdByRepoId =
    repoRes.status === 'fulfilled' ? repoRes.value : new Map<string, ExecutionHostId>()
  const sshReply = sshRes.status === 'fulfilled' ? sshRes.value : null
  const sshVerdict = sshReply ? hostSshTargetSummariesRead.interpret(sshReply) : null
  let knownSshHostIds: ReadonlySet<ExecutionHostId> | null = null
  const sshHealthByHostId = new Map<ExecutionHostId, ExecutionHostHealth>()
  if (sshVerdict?.accepted) {
    const known = new Set<ExecutionHostId>()
    for (const [id, health] of buildSshHostHealthById(sshVerdict.value)) {
      sshHealthByHostId.set(id, health)
    }
    for (const target of sshVerdict.value) {
      const targetHostId = sshTargetSummaryHostId(target.id)
      known.add(targetHostId)
      if (target.connected === true && target.connectionStatus === undefined) {
        sshHealthByHostId.set(targetHostId, 'available')
      } else if (target.connected === false && !sshHealthByHostId.has(targetHostId)) {
        sshHealthByHostId.set(targetHostId, 'disconnected')
      }
    }
    knownSshHostIds = known
  }
  return {
    repoHostIdByRepoId,
    knownSshHostIds,
    sshHealthByHostId,
    relayHosts: relayRes.status === 'fulfilled' ? relayRes.value : null
  }
}

export function evaluateDesktopWorktreeSshReachability(
  row: Record<string, unknown>,
  metadata: DesktopRecentCardHostMetadata
): { ownerHostId: ExecutionHostId; unreachable: boolean; targetRemoved: boolean } {
  const ownerHostId = resolveWorktreeHostId(
    {
      hostId: typeof row.hostId === 'string' ? row.hostId : undefined,
      repoId: typeof row.repoId === 'string' ? row.repoId : ''
    },
    metadata.repoHostIdByRepoId
  )
  if (!ownerHostId.startsWith('ssh:')) {
    return { ownerHostId, unreachable: false, targetRemoved: false }
  }
  if (metadata.knownSshHostIds !== null && !metadata.knownSshHostIds.has(ownerHostId)) {
    return { ownerHostId, unreachable: true, targetRemoved: true }
  }
  const health = metadata.sshHealthByHostId.get(ownerHostId)
  return {
    ownerHostId,
    unreachable: health !== undefined && health !== 'available',
    targetRemoved: false
  }
}

export function collectRelayHostReachability(relayHosts: readonly MobileRelayHost[] | null): {
  unreachableExecKeys: Set<string>
  activeRuntimeExecKeys: Set<string> | null
} {
  const unreachableExecKeys = new Set<string>()
  if (relayHosts === null) {
    return { unreachableExecKeys, activeRuntimeExecKeys: null }
  }
  const activeRuntimeExecKeys = new Set<string>()
  for (const host of relayHosts) {
    const key = recentCardExecutionHostKey(host.hostId)
    activeRuntimeExecKeys.add(key)
    if (host.relay !== 'ready' || serverHostHealth(host) !== 'available') {
      unreachableExecKeys.add(key)
    }
  }
  return { unreachableExecKeys, activeRuntimeExecKeys }
}

const WORKSPACE_GONE_CODES = new Set(['repo_not_found', 'selector_not_found', 'worktree_not_found'])
const TAB_CLOSED_CODES = new Set([
  'tab_not_found',
  'pane_not_found',
  'leaf_not_found',
  'terminal_not_found',
  'session_not_found',
  'browser_page_not_found'
])

export function classifyRecentCardActivationFailure(
  code: string | undefined
): 'workspace-gone' | 'tab-closed' | 'host-unreachable' {
  if (code && WORKSPACE_GONE_CODES.has(code)) {
    return 'workspace-gone'
  }
  if (code && TAB_CLOSED_CODES.has(code)) {
    return 'tab-closed'
  }
  return 'host-unreachable'
}

export function sameExecutionHostSets(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const key of a) {
    if (!b.has(key)) {
      return false
    }
  }
  return true
}

export function canRetireUnconfirmedLocalGhostTab(
  appliedSnapshotVersion: number,
  code: string | undefined
): boolean {
  return (
    appliedSnapshotVersion < 0 && classifyRecentCardActivationFailure(code) === 'host-unreachable'
  )
}

export type ParsedRecentCardWorktree = {
  worktreeId: string
  executionHost?: ExecutionHostId
  displayName?: string
  isArchived?: boolean
  unreachable?: boolean
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function parseRecentCardWorktreeRows(
  rows: readonly unknown[] | undefined,
  executionHost: ExecutionHostId | undefined,
  desktopMetadata: DesktopRecentCardHostMetadata | null
): { worktrees: ParsedRecentCardWorktree[]; removedWorktreeIds: string[] } {
  const execKey = recentCardExecutionHostKey(executionHost)
  const scopedExec = executionHost && execKey !== '' ? executionHost : undefined
  const worktrees: ParsedRecentCardWorktree[] = []
  const removedWorktreeIds: string[] = []
  for (const row of rows ?? []) {
    if (!isRecord(row) || typeof row.worktreeId !== 'string' || row.worktreeId.length === 0) {
      continue
    }
    const ssh =
      execKey === '' && desktopMetadata
        ? evaluateDesktopWorktreeSshReachability(row, desktopMetadata)
        : null
    if (ssh?.targetRemoved) {
      removedWorktreeIds.push(row.worktreeId)
      continue
    }
    worktrees.push({
      worktreeId: row.worktreeId,
      ...(scopedExec ? { executionHost: scopedExec } : {}),
      displayName: typeof row.displayName === 'string' ? row.displayName : undefined,
      isArchived: typeof row.isArchived === 'boolean' ? row.isArchived : undefined,
      ...(ssh?.unreachable ? { unreachable: true } : {})
    })
  }
  return { worktrees, removedWorktreeIds }
}
