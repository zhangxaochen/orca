import { useEffect, useState } from 'react'
import type { AiVaultScope } from '../../../src/shared/ai-vault-types'
import { getProvenCachedWorktrees } from '../cache/worktree-cache'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { worktreeCatalogRead } from '../worktree/worktree-catalog-operations'
import type { Worktree } from '../worktree/workspace-list-types'

type AssociationFeed = {
  getAssociationRevision: () => number
  subscribe: (listener: () => void) => () => void
}

type LoadSessions = (options: { scope: AiVaultScope; force: boolean }) => void

/** Seeds worktrees from the proven host cache and refreshes them from worktree.ps when connected. */
export function useMobileHistoryWorktrees(
  hostId: string,
  client: RpcClient | null,
  connState: ConnectionState
): { worktrees: Worktree[]; worktreesLoaded: boolean } {
  const [worktrees, setWorktrees] = useState<Worktree[]>(() => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: proven cache stores the same worktree rows this panel already reads as Worktree[].
    return (getProvenCachedWorktrees(hostId) as Worktree[] | null) ?? []
  })
  const [worktreesLoaded, setWorktreesLoaded] = useState(
    () => (getProvenCachedWorktrees(hostId)?.length ?? 0) > 0
  )

  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const worktreeReply = await worktreeCatalogRead.request(client, { limit: 10000 })
        if (cancelled) {
          return
        }
        const catalog = worktreeCatalogRead.interpret(worktreeReply)
        if (catalog.accepted) {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rows stay opaque in the reader; this panel reads path/worktreeId/repoId off rows.
          setWorktrees((catalog.value.worktrees ?? []) as Worktree[])
        }
      } catch {
        // Best-effort context: failed worktree list leaves scoped tabs scanning full history.
      } finally {
        if (!cancelled) {
          setWorktreesLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, connState])

  return { worktrees, worktreesLoaded }
}

/** Reloads history when a structured session attaches, and holds that reload behind an in-flight scan. */
export function useAgentHistoryAssociationReload(
  feed: AssociationFeed | null,
  loadSessions: LoadSessions,
  scope: AiVaultScope,
  activeLoads: { current: number },
  pendingReload: { current: (() => void) | null }
): void {
  useEffect(() => {
    if (!feed) {
      return
    }
    let revision = feed.getAssociationRevision()
    const stop = feed.subscribe(() => {
      const next = feed.getAssociationRevision()
      if (next === revision) {
        return
      }
      revision = next
      const reload = () => void loadSessions({ scope, force: false })
      if (activeLoads.current > 0) {
        pendingReload.current = reload
        return
      }
      reload()
    })
    return () => {
      stop()
      pendingReload.current = null
    }
  }, [activeLoads, feed, loadSessions, pendingReload, scope])
}
