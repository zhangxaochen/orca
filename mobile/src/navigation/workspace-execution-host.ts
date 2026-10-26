import { createContext, useContext } from 'react'
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import type { RouterHref } from './route-href'

// Keep context separate from WorkspaceRoute so readers need not import Expo.
export const WorkspaceExecutionHostContext = createContext<ExecutionHostId | undefined>(undefined)

export function useWorkspaceExecutionHost(): ExecutionHostId | undefined {
  return useContext(WorkspaceExecutionHostContext)
}

// Gate editor-tab-only actions by route execution host; direct headless pairings still count as the paired desktop, matching main.
export function useWorkspaceOnPairedHost(): boolean {
  // No host advertises window availability; routed workspace calls already target their execution host.
  return useWorkspaceExecutionHost() === undefined
}

// Carry executionHost on pushed workspace params so navigation stays on the same server.
export function workspaceRouteParams(executionHost: ExecutionHostId | undefined): {
  executionHost?: ExecutionHostId
} {
  return executionHost ? { executionHost } : {}
}

export function workspaceRouteHref(
  href: string,
  executionHost: ExecutionHostId | null | undefined
): string {
  // Why null: empty means this machine, so the handoff does not copy the screen's server.
  if (executionHost === null) {
    return `${href}${href.includes('?') ? '&' : '?'}executionHost=`
  }
  if (!executionHost) {
    return href
  }
  return `${href}${href.includes('?') ? '&' : '?'}executionHost=${encodeURIComponent(executionHost)}`
}

/** The same, for any router target. An href that already chooses a host keeps that choice. */
export function workspaceHref(href: RouterHref, executionHost: ExecutionHostId): RouterHref {
  if (typeof href !== 'string') {
    const params = href.params ?? {}
    if ('executionHost' in params) {
      if (params.executionHost !== undefined && params.executionHost !== '') {
        return href
      }
      const { executionHost: _local, ...rest } = params
      return { ...href, params: rest }
    }
    return { ...href, params: { ...params, executionHost } }
  }
  const declared = declaredExecutionHost(href)
  if (declared === 'local') {
    return withoutExecutionHostQuery(href)
  }
  if (declared === 'set') {
    return href
  }
  return workspaceRouteHref(href, executionHost)
}

/** Absent inherits the screen's server. Local is an empty executionHost. Set already names one. */
function declaredExecutionHost(href: string): 'absent' | 'local' | 'set' {
  const queryIndex = href.indexOf('?')
  if (queryIndex === -1) {
    return 'absent'
  }
  let sawEmpty = false
  for (const part of href.slice(queryIndex + 1).split('&')) {
    if (executionHostQueryKey(part) !== 'executionHost') {
      continue
    }
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(eq + 1) !== '') {
      return 'set'
    }
    sawEmpty = true
  }
  return sawEmpty ? 'local' : 'absent'
}

function executionHostQueryKey(part: string): string | null {
  if (part === '') {
    return null
  }
  const eq = part.indexOf('=')
  const rawKey = eq === -1 ? part : part.slice(0, eq)
  try {
    return decodeURIComponent(rawKey)
  } catch {
    return rawKey
  }
}

function withoutExecutionHostQuery(href: string): string {
  const queryIndex = href.indexOf('?')
  if (queryIndex === -1) {
    return href
  }
  const kept = href
    .slice(queryIndex + 1)
    .split('&')
    .filter((part) => executionHostQueryKey(part) !== 'executionHost')
  const path = href.slice(0, queryIndex)
  return kept.length === 0 ? path : `${path}?${kept.join('&')}`
}
