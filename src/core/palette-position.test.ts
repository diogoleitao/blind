import { describe, expect, it } from 'vitest'
import { palettePositionWithinWindow } from './palette-position'

describe("the Command Palette's position within its window", () => {
  it('stays where it was put between the top edge and the lowest position', () => {
    expect(palettePositionWithinWindow(0.4, { windowHeight: 1000, smallestPaletteHeight: 200 })).toBe(0.4)
  })

  it('stops with its top at the window\'s top edge', () => {
    expect(palettePositionWithinWindow(-0.1, { windowHeight: 1000, smallestPaletteHeight: 200 })).toBe(0)
  })

  it('stops where the search field and three results still fit above the window\'s bottom edge', () => {
    expect(palettePositionWithinWindow(0.95, { windowHeight: 1000, smallestPaletteHeight: 200 })).toBe(0.8)
  })

  it('stops higher in a shorter window, the same fraction staying put where it still fits', () => {
    expect(palettePositionWithinWindow(0.8, { windowHeight: 500, smallestPaletteHeight: 200 })).toBe(0.6)
    expect(palettePositionWithinWindow(0.5, { windowHeight: 500, smallestPaletteHeight: 200 })).toBe(0.5)
  })

  it('sits at the top edge in a window too short for the search field and three results', () => {
    expect(palettePositionWithinWindow(0.5, { windowHeight: 150, smallestPaletteHeight: 200 })).toBe(0)
  })
})
