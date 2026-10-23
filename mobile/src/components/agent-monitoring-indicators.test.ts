import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSpinner } from './AgentSpinner'
import { AgentStateDot } from './AgentStateDot'
import { WORKING_RING_FRAME_INTERVAL_MS } from './use-working-ring-rotation'
import { colors } from '../theme/mobile-theme'

const DESKTOP_WORKING_COLOR = '#eab308'

type MonitoringTestRenderer = {
  readonly root: {
    findByType(type: string): { props: Record<string, unknown> }
    findAllByType(type: string): { props: Record<string, unknown> }[]
  }
  unmount(): void
}

const { animationLoop, animationTiming, setValue } = vi.hoisted(() => ({
  animationLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  animationTiming: vi.fn(() => ({})),
  setValue: vi.fn()
}))

vi.mock('lucide-react-native', () => ({ Activity: 'Activity' }))
vi.mock('react-native', () => ({
  Animated: {
    Value: function Value() {
      return { interpolate: vi.fn(() => 'rotation'), setValue }
    },
    View: 'AnimatedView',
    loop: animationLoop,
    timing: animationTiming
  },
  Easing: { linear: 'linear' },
  Platform: { OS: 'ios' },
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View'
}))

describe('mobile monitoring indicators', () => {
  let renderer: MonitoringTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    animationLoop.mockClear()
    animationTiming.mockClear()
    setValue.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('renders a static Activity heartbeat for a monitoring agent', async () => {
    await act(async () => {
      renderer = create(createElement(AgentStateDot, { state: 'monitoring' }))
    })

    expect(renderer?.root.findByType('Activity').props).toMatchObject({
      color: DESKTOP_WORKING_COLOR,
      size: 10
    })
    setValue.mockClear()
    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS * 4)
    })
    expect(setValue).not.toHaveBeenCalled()
    expect(animationTiming).not.toHaveBeenCalled()
    expect(animationLoop).not.toHaveBeenCalled()
  })

  it('renders a static Activity heartbeat for an all-monitoring workspace', async () => {
    await act(async () => {
      renderer = create(
        createElement(AgentSpinner, { status: 'working', workingMode: 'monitoring' })
      )
    })

    expect(renderer?.root.findByType('Activity').props).toMatchObject({
      color: DESKTOP_WORKING_COLOR,
      size: 12
    })
    setValue.mockClear()
    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS * 4)
    })
    expect(setValue).not.toHaveBeenCalled()
    expect(animationTiming).not.toHaveBeenCalled()
    expect(animationLoop).not.toHaveBeenCalled()
  })

  it('steps the working spinner at 3 FPS in 90-degree increments without 60fps timing loops', async () => {
    await act(async () => {
      renderer = create(createElement(AgentSpinner, { status: 'working' }))
    })

    expect(animationTiming).not.toHaveBeenCalled()
    expect(animationLoop).not.toHaveBeenCalled()
    expect(setValue).toHaveBeenLastCalledWith(0)

    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS)
    })
    expect(setValue).toHaveBeenLastCalledWith(0.25)

    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS)
    })
    expect(setValue).toHaveBeenLastCalledWith(0.5)

    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS)
    })
    expect(setValue).toHaveBeenLastCalledWith(0.75)

    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS)
    })
    expect(setValue).toHaveBeenLastCalledWith(0)
  })

  it('shares a single 3 FPS ticker across multiple working rings and stops when unmounted', async () => {
    await act(async () => {
      renderer = create(
        createElement('View', null, [
          createElement(AgentSpinner, { key: 'spinner', status: 'working' }),
          createElement(AgentStateDot, { key: 'dot', state: 'working' })
        ])
      )
    })

    setValue.mockClear()
    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS)
    })
    expect(setValue).toHaveBeenCalledTimes(2)
    expect(setValue).toHaveBeenNthCalledWith(1, 0.25)
    expect(setValue).toHaveBeenNthCalledWith(2, 0.25)

    act(() => renderer?.unmount())
    renderer = null
    setValue.mockClear()
    act(() => {
      vi.advanceTimersByTime(WORKING_RING_FRAME_INTERVAL_MS * 4)
    })
    expect(setValue).not.toHaveBeenCalled()
  })

  it.each([
    // A user's Stop is not news: muted, never the fault red a failure draws.
    ['interrupted', colors.textMuted],
    ['failed', '#ef4444']
  ] as const)('draws %s with its own dot colour', async (state, color) => {
    await act(async () => {
      renderer = create(createElement(AgentStateDot, { state }))
    })

    const dot = renderer?.root.findAllByType('View').find((view) => Array.isArray(view.props.style))
    expect(dot?.props.style).toContainEqual({ backgroundColor: color })
  })
})
