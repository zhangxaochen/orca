import { describe, expect, it } from 'vitest'
import { getIpynbSelectionScroll } from './ipynb-selection-scroll'

const pane = { top: 100, bottom: 900 }
const frameMs = 1000 / 60

describe('getIpynbSelectionScroll', () => {
  it('does not scroll while the pointer is inside the pane, even on the edge lines', () => {
    for (const clientY of [101, 102, 120, 500, 880, 898, 899]) {
      expect(getIpynbSelectionScroll(pane, clientY, frameMs)).toEqual({ y: clientY, step: 0 })
    }
  })

  it('scrolls down and clamps the replay to the last visible pixel once past the bottom', () => {
    const { y, step } = getIpynbSelectionScroll(pane, 915, frameMs)
    expect(y).toBe(899)
    expect(step).toBeGreaterThan(0)
  })

  it('scrolls up and clamps the replay below the header once over it', () => {
    const { y, step } = getIpynbSelectionScroll(pane, 90, frameMs)
    expect(y).toBe(101)
    expect(step).toBeLessThan(0)
  })
})
