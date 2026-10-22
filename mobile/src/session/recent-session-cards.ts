import {
  persistMirrored,
  readMirroredKeyOrStore,
  readMirroredStorage
} from '../storage/mirrored-storage-keys'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../worktree/last-visited-worktree-repo'
import type { MobileSessionTab, MobileSessionTabType } from './mobile-session-route-types'
import {
  getMobileSessionTabTitle,
  resolveMobileTerminalTabAgentId
} from './mobile-terminal-tab-agent'

export const RECENT_SESSION_CARDS_STORAGE_KEY = 'orca:recent-session-cards'
export const MAX_RECENT_SESSION_CARDS_DISPLAY = 7
export const MAX_RECENT_SESSION_CARDS_STORED = 12
const MAX_TOTAL = 24
const TAB_TYPES = new Set<string>(['terminal', 'markdown', 'file', 'browser', 'agent-session'])

export type RecentSessionCardRecord = {
  hostId: string
  worktreeId: string
  worktreeName: string
  tabId: string
  leafId?: string
  terminalHandle?: string
  title: string
  tabType: MobileSessionTabType
  agentId?: string
  lastVisitedAt: number
}

let memory: RecentSessionCardRecord[] | null = null
let hydrated = false
const listeners = new Set<() => void>()

export function subscribeRecentSessionCards(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function notify(): void {
  listeners.forEach((listener) => listener())
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function cardKey(c: RecentSessionCardRecord): string {
  return `${c.hostId}\0${c.worktreeId}\0${c.tabId}`
}

function matchesTab(c: RecentSessionCardRecord, t: { id: string; terminal?: string }): boolean {
  return t.id === c.tabId || (Boolean(c.terminalHandle) && t.terminal === c.terminalHandle)
}

function parseCard(v: unknown): RecentSessionCardRecord | null {
  if (!isRecord(v) || typeof v.tabType !== 'string' || !TAB_TYPES.has(v.tabType)) {
    return null
  }
  const [hostId, worktreeId, tabId, title] = [
    str(v.hostId),
    str(v.worktreeId),
    str(v.tabId),
    str(v.title)
  ]
  if (!hostId || !worktreeId || !tabId || !title || !Number.isFinite(v.lastVisitedAt)) {
    return null
  }
  return {
    hostId,
    worktreeId,
    worktreeName: typeof v.worktreeName === 'string' ? v.worktreeName : '',
    tabId,
    title,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded by TAB_TYPES.has(v.tabType) above.
    tabType: v.tabType as MobileSessionTabType,
    lastVisitedAt: Number(v.lastVisitedAt),
    ...(str(v.leafId) ? { leafId: str(v.leafId) } : {}),
    ...(str(v.terminalHandle) ? { terminalHandle: str(v.terminalHandle) } : {}),
    ...(str(v.agentId) ? { agentId: str(v.agentId) } : {})
  }
}

export function parseRecentSessionCards(raw: string | null | undefined): RecentSessionCardRecord[] {
  if (!raw) {
    return []
  }
  try {
    const p: unknown = JSON.parse(raw)
    const items = Array.isArray(p)
      ? p
      : isRecord(p) && Array.isArray(p.recentCards)
        ? p.recentCards
        : []
    return items.flatMap((item) => {
      const card = parseCard(item)
      return card ? [card] : []
    })
  } catch {
    return []
  }
}

function capCards(cards: readonly RecentSessionCardRecord[]): RecentSessionCardRecord[] {
  const perHost = new Map<string, number>()
  return cards
    .filter((item) => {
      const count = perHost.get(item.hostId) ?? 0
      if (count >= MAX_RECENT_SESSION_CARDS_STORED) {
        return false
      }
      perHost.set(item.hostId, count + 1)
      return true
    })
    .slice(0, MAX_TOTAL)
}

function mergeByRecency(
  primary: readonly RecentSessionCardRecord[],
  secondary: readonly RecentSessionCardRecord[]
): RecentSessionCardRecord[] {
  const byKey = new Map<string, RecentSessionCardRecord>()
  for (const card of [...secondary, ...primary]) {
    const prev = byKey.get(cardKey(card))
    if (!prev || card.lastVisitedAt >= prev.lastVisitedAt) {
      byKey.set(cardKey(card), card)
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
}

function applyVisit(
  existing: readonly RecentSessionCardRecord[],
  record: RecentSessionCardRecord
): RecentSessionCardRecord[] {
  const key = cardKey(record)
  const rank = existing
    .filter((i) => i.hostId === record.hostId)
    .findIndex((i) => cardKey(i) === key)
  return rank !== -1 && rank < MAX_RECENT_SESSION_CARDS_DISPLAY
    ? existing.map((item) => (cardKey(item) === key ? record : item))
    : capCards([record, ...existing.filter((item) => cardKey(item) !== key)])
}

export function readAllRecentSessionCardsSync(): RecentSessionCardRecord[] {
  if (memory) {
    return memory.slice()
  }
  const m = readMirroredStorage([
    RECENT_SESSION_CARDS_STORAGE_KEY,
    LAST_VISITED_WORKTREE_STORAGE_KEY
  ])
  const dedicated = parseRecentSessionCards(m[RECENT_SESSION_CARDS_STORAGE_KEY])
  const cards = dedicated.length
    ? dedicated
    : parseRecentSessionCards(m[LAST_VISITED_WORKTREE_STORAGE_KEY])
  if (cards.length > 0) {
    memory = cards
    hydrated = true
  }
  return cards.slice()
}

export async function hydrateRecentSessionCards(): Promise<RecentSessionCardRecord[]> {
  const [dRaw, lRaw] = await Promise.all([
    readMirroredKeyOrStore(RECENT_SESSION_CARDS_STORAGE_KEY),
    readMirroredKeyOrStore(LAST_VISITED_WORKTREE_STORAGE_KEY)
  ])
  const stored = capCards(
    mergeByRecency(parseRecentSessionCards(dRaw), parseRecentSessionCards(lRaw))
  )
  if (memory !== null) {
    const combined = memory.reduceRight((acc, visit) => applyVisit(acc, visit), stored)
    hydrated = true
    memory = combined
    return combined[0] ? persistCards(combined, combined[0]).slice() : (notify(), combined.slice())
  }
  hydrated = true
  if (stored.length > 0) {
    memory = stored
    notify()
  }
  return stored.slice()
}

function persistCards(
  next: RecentSessionCardRecord[],
  fallback: { hostId: string; worktreeId: string }
): RecentSessionCardRecord[] {
  memory = next
  notify()
  void persistMirrored(RECENT_SESSION_CARDS_STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  const m = readMirroredStorage([LAST_VISITED_WORKTREE_STORAGE_KEY])
  const last = readLastVisitedWorktreeRecord(m[LAST_VISITED_WORKTREE_STORAGE_KEY] ?? null)
  const hostId = last?.hostId || fallback.hostId
  const worktreeId = last?.worktreeId || fallback.worktreeId
  if (hostId && worktreeId) {
    const payload = JSON.stringify({ hostId, worktreeId, recentCards: next })
    void persistMirrored(LAST_VISITED_WORKTREE_STORAGE_KEY, payload).catch(() => {})
  }
  return next
}

export function recordRecentSessionCardVisit(
  r: RecentSessionCardRecord
): RecentSessionCardRecord[] {
  if (!r.hostId || !r.worktreeId || !r.tabId) {
    return readAllRecentSessionCardsSync()
  }
  const next = applyVisit(readAllRecentSessionCardsSync(), r)
  if (hydrated) {
    return persistCards(next, r)
  }
  memory = next
  notify()
  void hydrateRecentSessionCards().catch(() => {})
  return next.slice()
}

export function removeRecentSessionCard(
  hostId: string,
  worktreeId: string,
  tabId?: string,
  handle?: string
): RecentSessionCardRecord[] {
  const current = readAllRecentSessionCardsSync()
  const next = current.filter(
    (i) =>
      i.hostId !== hostId ||
      i.worktreeId !== worktreeId ||
      ((tabId !== undefined || handle !== undefined) &&
        (tabId === undefined || i.tabId !== tabId) &&
        (!handle || i.terminalHandle !== handle))
  )
  return next.length === current.length ? current : persistCards(next, { hostId, worktreeId })
}

export function reconcileRecentSessionCardsForWorktree(p: {
  hostId: string
  worktreeId: string
  liveTabs: readonly { id: string; terminal?: string }[]
  allowEmpty?: boolean
}): RecentSessionCardRecord[] {
  const current = readAllRecentSessionCardsSync()
  if (!p.hostId || !p.worktreeId || (!p.liveTabs.length && !p.allowEmpty)) {
    return current
  }
  const next = current.filter(
    (i) =>
      i.hostId !== p.hostId ||
      i.worktreeId !== p.worktreeId ||
      p.liveTabs.some((t) => matchesTab(i, t))
  )
  return next.length === current.length ? current : persistCards(next, p)
}

export function clearRecentSessionCardsForTests(): void {
  memory = null
  hydrated = false
}

export function getVisibleRecentSessionCards(p: {
  hostId: string
  currentWorktreeId: string
  currentTabId: string | null
  limit?: number
  liveWorktrees?: readonly { worktreeId: string; displayName?: string; isArchived?: boolean }[]
  currentWorktreeTabs?: readonly { id: string; terminal?: string }[]
}): RecentSessionCardRecord[] {
  const live = p.liveWorktrees?.length
    ? new Map(p.liveWorktrees.map((w) => [w.worktreeId, w]))
    : null
  const tabs = p.currentWorktreeTabs
  return readAllRecentSessionCardsSync()
    .filter((i) => {
      const entry = live?.get(i.worktreeId)
      const closed =
        Boolean(tabs?.length) &&
        i.worktreeId === p.currentWorktreeId &&
        !tabs?.some((t) => matchesTab(i, t))
      return i.hostId === p.hostId && (!live || (entry && entry.isArchived !== true)) && !closed
    })
    .slice(0, p.limit ?? MAX_RECENT_SESSION_CARDS_DISPLAY)
    .map((i) => ({ ...i, worktreeName: live?.get(i.worktreeId)?.displayName || i.worktreeName }))
}

export function buildRecentSessionCardFromTab(p: {
  hostId: string
  worktreeId: string
  worktreeName: string
  tab: MobileSessionTab
  now?: number
}): RecentSessionCardRecord {
  const { tab } = p
  const agentId =
    tab.type === 'agent-session'
      ? tab.agent
      : tab.type === 'terminal'
        ? resolveMobileTerminalTabAgentId(tab)
        : undefined
  return {
    hostId: p.hostId,
    worktreeId: p.worktreeId,
    worktreeName: p.worktreeName,
    tabId: tab.id,
    title: getMobileSessionTabTitle(tab),
    tabType: tab.type,
    lastVisitedAt: p.now ?? Date.now(),
    ...(agentId ? { agentId } : {}),
    ...(tab.type === 'terminal' && tab.leafId ? { leafId: tab.leafId } : {}),
    ...(tab.type === 'terminal' && tab.terminal ? { terminalHandle: tab.terminal } : {})
  }
}
