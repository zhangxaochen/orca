import type { AiVaultScanIssue, AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { RpcClient } from '../transport/rpc-client'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import { agentHistorySessionScan } from './mobile-agent-history-operations'

// Match desktop SESSION_LIMIT=500 for recency only; host separately caps in-scope union.
export const MOBILE_AI_VAULT_SESSION_LIMIT = 500

/** Module cache cap. A phone keeps a handful of hosts and scopes, not the full desktop history. */
const MAX_CACHED_SNAPSHOTS = 20

const snapshotCache = new Map<string, AgentHistoryCachedSnapshot>()

export type AgentHistoryScreenState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      sessions: AiVaultSession[]
      issues: AiVaultScanIssue[]
    }

export type FetchedHistoryState =
  | Exclude<AgentHistoryScreenState, { kind: 'ready' }>
  | (Extract<AgentHistoryScreenState, { kind: 'ready' }> & { hostId: string; client: RpcClient })

export type AgentHistoryCachedSnapshot = {
  fingerprint: string
  sessions: AiVaultSession[]
  issues: AiVaultScanIssue[]
}

export type ScanMobileAgentSessionsParams = {
  scopePaths: string[] | undefined
  force: boolean
  previous?: AgentHistoryCachedSnapshot | null
  /** Shown when the host refuses the scan with an empty message. */
  fallbackErrorMessage?: string
}

export type ScanMobileAgentSessionsResult = {
  sessions: AiVaultSession[]
  issues: AiVaultScanIssue[]
  fingerprint?: string
}

/**
 * Returns the last scan for this host and scope, if the module cache still holds it.
 * A hit counts as use so a visible scope is not the first entry evicted.
 */
export function readCachedAgentHistorySnapshot(
  hostId: string,
  cacheKey: string
): AgentHistoryCachedSnapshot | undefined {
  const key = snapshotCacheId(hostId, cacheKey)
  const snapshot = snapshotCache.get(key)
  if (!snapshot) {
    return undefined
  }
  rememberAgentHistorySnapshot(key, snapshot)
  return snapshot
}

/** Stores a scan snapshot, dropping the least recently used entry past the cap. */
export function writeCachedAgentHistorySnapshot(
  hostId: string,
  cacheKey: string,
  snapshot: AgentHistoryCachedSnapshot
): void {
  rememberAgentHistorySnapshot(snapshotCacheId(hostId, cacheKey), snapshot)
}

/** Drops every cached scan so a host switch or test cannot reuse another machine's rows. */
export function clearCachedAgentHistorySnapshots(): void {
  snapshotCache.clear()
}

/**
 * Lists agent sessions for the scope. `afterFingerprint` is always sent: `null` asks for a full
 * scan, and a previous fingerprint lets the host return `unchanged` instead of the row set.
 */
export async function scanMobileAgentSessions(
  client: RpcClient,
  params: ScanMobileAgentSessionsParams
): Promise<ScanMobileAgentSessionsResult> {
  const fallbackErrorMessage = params.fallbackErrorMessage ?? 'Unable to load agent sessions'
  const previousFingerprint = !params.force ? (params.previous?.fingerprint ?? null) : null
  const reply = await agentHistorySessionScan.request(client, {
    limit: MOBILE_AI_VAULT_SESSION_LIMIT,
    force: params.force,
    scopePaths: params.scopePaths,
    afterFingerprint: previousFingerprint
  })

  const result = interpretOrThrowRefusalMessage(
    () => agentHistorySessionScan.interpret(reply),
    fallbackErrorMessage
  )
  if (result.unchanged === true) {
    if (params.previous && result.fingerprint === params.previous.fingerprint) {
      return {
        sessions: params.previous.sessions,
        issues: params.previous.issues,
        fingerprint: result.fingerprint
      }
    }
    // Fall back to a full scan if the client lacks the matching previous snapshot.
    const fallbackReply = await agentHistorySessionScan.request(client, {
      limit: MOBILE_AI_VAULT_SESSION_LIMIT,
      force: true,
      scopePaths: params.scopePaths,
      afterFingerprint: null
    })
    const fallbackResult = interpretOrThrowRefusalMessage(
      () => agentHistorySessionScan.interpret(fallbackReply),
      fallbackErrorMessage
    )
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: opaque session records
      sessions: fallbackResult.sessions as AiVaultSession[],
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: opaque issue records
      issues: fallbackResult.issues as AiVaultScanIssue[],
      fingerprint: fallbackResult.fingerprint
    }
  }

  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: opaque session records
    sessions: result.sessions as AiVaultSession[],
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: opaque issue records
    issues: result.issues as AiVaultScanIssue[],
    fingerprint: result.fingerprint
  }
}

/** One slot per host and scope. The separator keeps those two fields from aliasing each other. */
function snapshotCacheId(hostId: string, cacheKey: string): string {
  return `${hostId}\0${cacheKey}`
}

/** Puts this snapshot last in insertion order, which is the newest end of the LRU. */
function rememberAgentHistorySnapshot(key: string, snapshot: AgentHistoryCachedSnapshot): void {
  snapshotCache.delete(key)
  snapshotCache.set(key, snapshot)
  if (snapshotCache.size <= MAX_CACHED_SNAPSHOTS) {
    return
  }
  const oldest = snapshotCache.keys().next().value
  if (oldest !== undefined) {
    snapshotCache.delete(oldest)
  }
}
