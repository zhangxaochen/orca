import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'

// Why: a 60–120fps continuous linear spin wakes the WebView/GPU compositor on
// every frame for every visible working tab or worktree row, draining battery
// during long agent runs. Stepping 4 cardinal 90° angles at 3 FPS (333ms) on a
// shared ticker cuts wakeups by >95% and lets LTPO displays idle between ticks.
export const WORKING_RING_FPS = 3
export const WORKING_RING_FRAME_INTERVAL_MS = Math.round(1000 / WORKING_RING_FPS)
export const WORKING_RING_STEP_COUNT = 4

const activeSpinValues = new Set<Animated.Value>()
let sharedIntervalId: ReturnType<typeof setInterval> | null = null
let currentStepIndex = 0

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function tickWorkingRings(): void {
  if (activeSpinValues.size === 0 || isDocumentHidden()) {
    return
  }
  currentStepIndex = (currentStepIndex + 1) % WORKING_RING_STEP_COUNT
  const progress = currentStepIndex / WORKING_RING_STEP_COUNT
  for (const spinValue of activeSpinValues) {
    spinValue.setValue(progress)
  }
}

function subscribeWorkingRing(spinValue: Animated.Value): () => void {
  activeSpinValues.add(spinValue)
  spinValue.setValue(currentStepIndex / WORKING_RING_STEP_COUNT)
  if (sharedIntervalId === null) {
    sharedIntervalId = setInterval(tickWorkingRings, WORKING_RING_FRAME_INTERVAL_MS)
  }
  return () => {
    activeSpinValues.delete(spinValue)
    if (activeSpinValues.size === 0 && sharedIntervalId !== null) {
      clearInterval(sharedIntervalId)
      sharedIntervalId = null
      currentStepIndex = 0
    }
  }
}

/** The working ring's rotation: stepped at 3 FPS while `active`, reset to 0 otherwise. */
export function useWorkingRingRotation(active: boolean): Animated.AnimatedInterpolation<string> {
  const spinValue = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (active) {
      return subscribeWorkingRing(spinValue)
    }
    spinValue.setValue(0)
    return undefined
  }, [active, spinValue])

  return spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
}
