import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison
} from '../../../src/shared/cross-platform-path'
import type { Worktree } from '../worktree/workspace-list-types'
import {
  AI_VAULT_SCOPE_PATHS_MAX_COUNT,
  type AiVaultScope
} from '../../../src/shared/ai-vault-types'

export const MOBILE_AGENT_HISTORY_SCOPE_TABS: { scope: AiVaultScope; label: string }[] = [
  { scope: 'workspace', label: 'Workspace' },
  { scope: 'project', label: 'Project' },
  { scope: 'all', label: 'All' }
]

// Why: the renderer's deriveAiVault* helpers are renderer-located and
// Metro-unresolvable, so mobile does its own minimal derivation seeded by the
// active worktree's path plus same-repo sibling worktrees (mobile already loads
// the full worktree list via worktree.ps). scopePaths only widen the host scan's
// discovery breadth; they are host-local match prefixes, never device paths.
export function deriveMobileAiVaultScopePaths(
  scope: AiVaultScope,
  activeWorktree: Pick<Worktree, 'worktreeId' | 'path' | 'repoId'> | null,
  liveWorktrees: readonly Pick<Worktree, 'worktreeId' | 'path' | 'repoId'>[]
): string[] {
  // All scope omits hints to retain host’s global recency list.
  if (scope === 'all' || !activeWorktree) {
    return []
  }

  const paths: string[] = []
  const comparisonPaths = new Set<string>()
  addScopePath(paths, comparisonPaths, activeWorktree.path)

  // Workspace uses active path; Project includes same-repo siblings.
  if (scope === 'project') {
    for (const worktree of liveWorktrees) {
      // RPC rejects oversized scopePaths; drop tail hints rather than fail scan because hints only widen discovery.
      if (paths.length >= AI_VAULT_SCOPE_PATHS_MAX_COUNT) {
        break
      }
      if (worktree.repoId === activeWorktree.repoId) {
        addScopePath(paths, comparisonPaths, worktree.path)
      }
    }
  }

  return paths
}

function addScopePath(
  paths: string[],
  comparisonPaths: Set<string>,
  pathValue: string | undefined
): void {
  const trimmedPath = pathValue?.trim()
  if (!trimmedPath || !isRuntimePathAbsolute(trimmedPath)) {
    return
  }
  const comparisonPath = normalizeRuntimePathForComparison(trimmedPath)
  if (comparisonPaths.has(comparisonPath)) {
    return
  }
  comparisonPaths.add(comparisonPath)
  paths.push(trimmedPath)
}
