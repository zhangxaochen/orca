import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRecentSessionCardsForTests,
  recordRecentSessionCardVisit
} from './recent-session-cards'
import { useMobileSessionCloseActions } from './use-mobile-session-close-actions'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'

describe('useMobileSessionCloseActions', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => renderer?.unmount())

  it('optimistically updates sessionTabs and schedules fetchSessionTabs upon terminal rename', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({ ok: true, result: {} }))
    }

    const initialTerminals: Terminal[] = [
      { handle: 'term-1', title: 'Claude Code', isActive: true }
    ]
    const initialSessionTabs: MobileSessionTab[] = [
      {
        type: 'terminal',
        id: 'tab-1::pane:1',
        title: 'Claude Code',
        terminal: 'term-1',
        parentTabId: 'tab-1',
        leafId: 'pane:1',
        isActive: true
      },
      {
        type: 'terminal',
        id: 'tab-2::pane:2',
        title: 'Terminal 2',
        terminal: 'term-2',
        parentTabId: 'tab-2',
        leafId: 'pane:2',
        isActive: false
      }
    ]

    const setTerminals = vi.fn()
    const setSessionTabs = vi.fn()
    const terminalsRef = { current: initialTerminals }
    const sessionTabsRef = { current: initialSessionTabs }
    const scheduledActions: (() => void)[] = []
    const scheduleDelayedAction = vi.fn((action: () => void, _delayMs: number) => {
      scheduledActions.push(action)
    })
    const fetchTerminals = vi.fn(async () => {})
    const fetchSessionTabs = vi.fn(async () => {})
    const setRenameTarget = vi.fn()

    const scope = {
      worktreeId: 'wt-1',
      client,
      setTerminals,
      terminals: initialTerminals,
      terminalsRef,
      setSessionTabs,
      setFileDocs: vi.fn(),
      setMarkdownDocs: vi.fn(),
      sessionTabsRef,
      reconcileBufferedDraftsRef: { current: vi.fn() },
      closedTabTombstonesRef: { current: new Map() },
      clearTerminalLiveInputDefault: vi.fn(),
      setActiveHandle: vi.fn(),
      setActiveSessionTabId: vi.fn(),
      activeSessionTabIdRef: { current: 'tab-1::pane:1' },
      selectedSessionTabIdRef: { current: 'tab-1::pane:1' },
      renameTarget: { handle: 'term-1', title: 'Claude Code', isActive: true },
      setRenameTarget,
      terminalRefs: { current: new Map() },
      activeHandleRef: { current: 'term-1' },
      activeSessionTabTypeRef: { current: 'terminal' },
      pendingSelectionRef: { current: null },
      pendingBrowserFocusPageIdRef: { current: null },
      scheduleDelayedAction,
      unsubscribeTerminal: vi.fn(),
      subscribeToTerminal: vi.fn(),
      fetchTerminals,
      fetchSessionTabs
    }

    let actions: ReturnType<typeof useMobileSessionCloseActions> | undefined
    function Harness() {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Test harness provides the rename slice of the session scope.
      actions = useMobileSessionCloseActions(scope as never)
      return null
    }

    await act(async () => {
      renderer = create(createElement(Harness))
    })

    await act(async () => {
      await actions?.handleRenameTerminal('Auth Worker')
    })

    expect(client.sendRequest).toHaveBeenCalledWith('terminal.rename', {
      terminal: 'term-1',
      title: 'Auth Worker'
    })
    expect(setRenameTarget).toHaveBeenCalledWith(null)
    expect(sessionTabsRef.current).toEqual([
      expect.objectContaining({
        type: 'terminal',
        terminal: 'term-1',
        title: 'Auth Worker'
      }),
      expect.objectContaining({
        type: 'terminal',
        terminal: 'term-2',
        title: 'Terminal 2'
      })
    ])
    expect(setSessionTabs).toHaveBeenCalledWith(sessionTabsRef.current)
    expect(scheduleDelayedAction).toHaveBeenCalledWith(expect.any(Function), 300)
    await act(async () => {
      scheduledActions.forEach((action) => action())
    })
    expect(fetchTerminals).toHaveBeenCalled()
    expect(fetchSessionTabs).toHaveBeenCalled()
  })

  it('activates the MRU or adjacent remaining tab instead of leaving a null active tab when closing the active session tab', async () => {
    clearRecentSessionCardsForTests()
    const client = {
      sendRequest: vi.fn(async () => ({ ok: true, result: { closed: true } }))
    }

    const tab1: MobileSessionTab = {
      type: 'terminal',
      id: 'tab-1::pane:1',
      title: 'Term 1',
      terminal: 'term-1',
      parentTabId: 'tab-1',
      leafId: 'pane:1',
      isActive: false
    }
    const tab2: MobileSessionTab = {
      type: 'terminal',
      id: 'tab-2::pane:2',
      title: 'Term 2',
      terminal: 'term-2',
      parentTabId: 'tab-2',
      leafId: 'pane:2',
      isActive: true
    }
    const tab3: MobileSessionTab = {
      type: 'terminal',
      id: 'tab-3::pane:3',
      title: 'Term 3',
      terminal: 'term-3',
      parentTabId: 'tab-3',
      leafId: 'pane:3',
      isActive: false
    }

    recordRecentSessionCardVisit({
      hostId: 'host-1',
      worktreeId: 'wt-1',
      worktreeName: 'orca',
      tabId: tab1.id,
      terminalHandle: 'term-1',
      title: 'Term 1',
      tabType: 'terminal',
      lastVisitedAt: 100
    })
    recordRecentSessionCardVisit({
      hostId: 'host-1',
      worktreeId: 'wt-1',
      worktreeName: 'orca',
      tabId: tab2.id,
      terminalHandle: 'term-2',
      title: 'Term 2',
      tabType: 'terminal',
      lastVisitedAt: 200
    })

    const sessionTabsRef = { current: [tab1, tab2, tab3] }
    const activeSessionTabIdRef = { current: tab2.id as string | null }
    const selectedSessionTabIdRef = { current: tab2.id as string | null }
    const activeHandleRef = { current: 'term-2' as string | null }
    const activeSessionTabTypeRef = { current: 'terminal' as string | null }
    const setActiveSessionTabId = vi.fn()
    const setActiveHandle = vi.fn()
    const subscribeToTerminal = vi.fn()

    const scope = {
      hostId: 'host-1',
      worktreeId: 'wt-1',
      client,
      setTerminals: vi.fn(),
      terminalsRef: { current: [] },
      setSessionTabs: vi.fn(),
      setFileDocs: vi.fn(),
      setMarkdownDocs: vi.fn(),
      sessionTabsRef,
      reconcileBufferedDraftsRef: { current: vi.fn() },
      closedTabTombstonesRef: { current: new Map() },
      clearTerminalLiveInputDefault: vi.fn(),
      setActiveHandle,
      setActiveSessionTabId,
      activeSessionTabIdRef,
      selectedSessionTabIdRef,
      renameTarget: null,
      setRenameTarget: vi.fn(),
      terminalRefs: { current: new Map() },
      activeHandleRef,
      activeSessionTabTypeRef,
      pendingSelectionRef: { current: null },
      pendingBrowserFocusPageIdRef: { current: null },
      scheduleDelayedAction: vi.fn(),
      unsubscribeTerminal: vi.fn(),
      subscribeToTerminal,
      fetchTerminals: vi.fn(async () => {}),
      fetchSessionTabs: vi.fn(async () => {})
    }

    let actions: ReturnType<typeof useMobileSessionCloseActions> | undefined
    function Harness() {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Test harness provides the close slice of the session scope.
      actions = useMobileSessionCloseActions(scope as never)
      return null
    }

    await act(async () => {
      renderer = create(createElement(Harness))
    })

    await act(async () => {
      await actions?.handleCloseSessionTab(tab2)
    })

    expect(activeSessionTabIdRef.current).toBe(tab1.id)
    expect(selectedSessionTabIdRef.current).toBe(tab1.id)
    expect(setActiveSessionTabId).toHaveBeenCalledWith(tab1.id)
    expect(activeHandleRef.current).toBe('term-1')
    expect(setActiveHandle).toHaveBeenCalledWith('term-1')
    expect(subscribeToTerminal).toHaveBeenCalledWith('term-1')
  })
})
