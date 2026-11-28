import { useEffect, useMemo, useRef, useState } from 'react'
import { BOTTOM_DRAWER_SHOW_DURATION_MS } from '../components/bottom-drawer/bottom-drawer-constants'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useWorkspaceExecutionHost } from '../navigation/workspace-execution-host'
import { useRelayHosts } from '../worktree/execution-hosts/relay-hosts-feed'
import { collectRelayHostReachability } from './recent-session-card-host-health'
import {
  getCachedRecentCardsPollState,
  pollRecentCardsAcrossHosts,
  sameRecentCardsPollState,
  type RecentCardsPollState
} from './recent-session-card-routing'
import { selectRecentSessionCard } from './recent-session-card-selection'
import { recentCardExecutionHostKey } from './recent-session-card-snapshot'
import {
  getVisibleRecentSessionCards,
  readAllRecentSessionCardsSync,
  subscribeRecentSessionCards,
  type RecentSessionCardRecord
} from './recent-session-cards'
import type { MobileSessionPresentationModel } from './use-mobile-session-presentation'

const EMPTY_RECENT_SESSION_CARDS: readonly RecentSessionCardRecord[] = []
const POLL_INTERVAL_MS = 2500
const PREWARM_DELAY_MS = 150

export function useRecentSessionCardMenu(scope: MobileSessionPresentationModel) {
  const t = useMobileTranslation()
  const executionHost = useWorkspaceExecutionHost()
  const {
    hostId,
    worktreeId,
    client,
    connState,
    pairedHostClient,
    pairedHostState,
    hostCapabilities,
    router,
    sessionTabs,
    activeSessionTabId,
    switchSessionTab,
    showToast,
    showHeaderMoreActions,
    setShowHeaderMoreActions,
    showRecentSessionCards,
    setShowRecentSessionCards
  } = scope
  const isRecentCardsOpen = Boolean(showRecentSessionCards || showHeaderMoreActions)
  const [jumpingRecentCardKey, setJumpingRecentCardKey] = useState<string | null>(null)
  const jumpLockRef = useRef(false)
  const recentCardsPollInFlightRef = useRef(false)
  const [recentCardsRevision, setRecentCardsRevision] = useState(0)
  const [recentCardsPollState, setRecentCardsPollState] = useState<RecentCardsPollState>(() =>
    getCachedRecentCardsPollState(hostId)
  )
  const relayHostsClient =
    pairedHostClient && pairedHostState === 'connected'
      ? pairedHostClient
      : executionHost === undefined && connState === 'connected'
        ? client
        : null
  const relayHosts = useRelayHosts(relayHostsClient, hostCapabilities ?? [])

  useEffect(() => {
    const cached = getCachedRecentCardsPollState(hostId)
    setRecentCardsPollState((prev) => (sameRecentCardsPollState(prev, cached) ? prev : cached))
  }, [hostId])

  useEffect(() => {
    if (!isRecentCardsOpen) {
      return
    }
    return subscribeRecentSessionCards(() => setRecentCardsRevision((rev) => rev + 1))
  }, [isRecentCardsOpen])

  const anyHostConnected = connState === 'connected' || pairedHostState === 'connected'
  useEffect(() => {
    if (!anyHostConnected || !hostId || isRecentCardsOpen) {
      return
    }
    if (
      getCachedRecentCardsPollState(hostId).confirmedExecutionHosts.size > 0 ||
      !readAllRecentSessionCardsSync().some((c) => c.hostId === hostId)
    ) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      if (recentCardsPollInFlightRef.current || cancelled) {
        return
      }
      recentCardsPollInFlightRef.current = true
      void pollRecentCardsAcrossHosts({
        hostId,
        worktreeId,
        sessionTabsCount: sessionTabs.length,
        currentExecutionHost: executionHost,
        currentClient: client,
        currentConnState: connState,
        pairedHostClient,
        pairedHostState,
        hostCapabilities,
        isCancelled: () => cancelled
      })
        .then((next) => {
          if (next && !cancelled) {
            setRecentCardsPollState((prev) => (sameRecentCardsPollState(prev, next) ? prev : next))
          }
        })
        .finally(() => {
          recentCardsPollInFlightRef.current = false
        })
    }, PREWARM_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    anyHostConnected,
    client,
    connState,
    executionHost,
    hostCapabilities,
    hostId,
    isRecentCardsOpen,
    pairedHostClient,
    pairedHostState,
    sessionTabs.length,
    worktreeId
  ])

  useEffect(() => {
    if (!isRecentCardsOpen || !anyHostConnected) {
      return
    }
    let cancelled = false
    const tick = async () => {
      if (recentCardsPollInFlightRef.current || cancelled || !hostId) {
        return
      }
      recentCardsPollInFlightRef.current = true
      try {
        const next = await pollRecentCardsAcrossHosts({
          hostId,
          worktreeId,
          sessionTabsCount: sessionTabs.length,
          currentExecutionHost: executionHost,
          currentClient: client,
          currentConnState: connState,
          pairedHostClient,
          pairedHostState,
          hostCapabilities,
          isCancelled: () => cancelled
        })
        if (next && !cancelled) {
          setRecentCardsPollState((prev) => (sameRecentCardsPollState(prev, next) ? prev : next))
        }
      } finally {
        recentCardsPollInFlightRef.current = false
      }
    }
    if (getCachedRecentCardsPollState(hostId).confirmedExecutionHosts.size === 0) {
      void tick()
    }
    const settleTimer = setTimeout(() => {
      void tick()
    }, BOTTOM_DRAWER_SHOW_DURATION_MS)
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(settleTimer)
      clearInterval(timer)
    }
  }, [
    activeSessionTabId,
    anyHostConnected,
    client,
    connState,
    executionHost,
    hostCapabilities,
    hostId,
    isRecentCardsOpen,
    pairedHostClient,
    pairedHostState,
    sessionTabs.length,
    worktreeId
  ])

  const liveRelayReach = useMemo(() => collectRelayHostReachability(relayHosts), [relayHosts])

  const effectiveUnreachableHosts = useMemo(() => {
    const merged = new Set(recentCardsPollState.unreachableExecutionHosts)
    for (const key of liveRelayReach.unreachableExecKeys) {
      merged.add(key)
    }
    if (liveRelayReach.activeRuntimeExecKeys !== null) {
      for (const card of readAllRecentSessionCardsSync()) {
        if (card.hostId !== hostId) {
          continue
        }
        const execKey = recentCardExecutionHostKey(card.executionHost)
        if (execKey.startsWith('runtime:') && !liveRelayReach.activeRuntimeExecKeys.has(execKey)) {
          merged.add(execKey)
        }
      }
    }
    return merged
  }, [hostId, liveRelayReach, recentCardsPollState.unreachableExecutionHosts, recentCardsRevision])

  const recentSessionCards = useMemo(() => {
    if (!isRecentCardsOpen) {
      return EMPTY_RECENT_SESSION_CARDS
    }
    void recentCardsRevision
    return getVisibleRecentSessionCards({
      hostId,
      currentWorktreeId: worktreeId,
      currentExecutionHost: executionHost,
      currentTabId: activeSessionTabId,
      liveWorktrees: recentCardsPollState.worktrees,
      confirmedExecutionHosts: recentCardsPollState.confirmedExecutionHosts,
      unreachableExecutionHosts: effectiveUnreachableHosts,
      currentWorktreeTabs: sessionTabs
    })
  }, [
    activeSessionTabId,
    effectiveUnreachableHosts,
    executionHost,
    hostId,
    isRecentCardsOpen,
    recentCardsPollState,
    recentCardsRevision,
    sessionTabs,
    worktreeId
  ])

  const closeRecentCardSheets = () => {
    setShowRecentSessionCards(false)
    setShowHeaderMoreActions(false)
  }

  const handleSelectRecentSessionCard = async (card: RecentSessionCardRecord) => {
    if (jumpingRecentCardKey !== null || jumpLockRef.current) {
      return
    }
    jumpLockRef.current = true
    try {
      await selectRecentSessionCard(card, {
        hostId,
        worktreeId,
        executionHost,
        client,
        connState,
        pairedHostClient,
        pairedHostState,
        hostCapabilities,
        sessionTabs,
        activeSessionTabId,
        recentCardsPollState,
        effectiveUnreachableHosts,
        switchSessionTab,
        showToast,
        closeRecentCardSheets,
        setPollState: setRecentCardsPollState,
        setJumpingCardKey: setJumpingRecentCardKey,
        replaceRoute: (href) => router.replace(href),
        t
      })
    } finally {
      jumpLockRef.current = false
    }
  }

  return { recentSessionCards, jumpingRecentCardKey, handleSelectRecentSessionCard }
}
