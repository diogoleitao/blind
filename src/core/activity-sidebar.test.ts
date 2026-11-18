import { describe, expect, it } from 'vitest'
import { type ActivitySidebarRow, movedSelection, selectionAfter } from './activity-sidebar'

// A Session heading, then a row for each Pane named, as the Activity Sidebar lists them.
function rows (...paneIds: string[]): ActivitySidebarRow[] {
  return [{ label: 'blind', level: 0 }, ...paneIds.map((paneId) => ({ label: paneId, level: 1 as const, paneId }))]
}

describe("the Activity Sidebar's selection", () => {
  it('starts on the first row standing for a Pane, past the headings', () => {
    expect(selectionAfter([], rows('vim', 'zsh'), undefined)).toBe('vim')
  })

  it('stays on its Pane as rows come and go around it, wherever the Pane moves', () => {
    expect(selectionAfter(rows('vim', 'zsh'), rows('tail', 'zsh', 'vim'), 'zsh')).toBe('zsh')
  })

  it("moves to the next row when its Pane's row goes, or to the previous one when it was the last", () => {
    expect(selectionAfter(rows('vim', 'zsh', 'tail'), rows('vim', 'tail'), 'zsh')).toBe('tail')
    expect(selectionAfter(rows('vim', 'zsh', 'tail'), rows('vim', 'zsh'), 'tail')).toBe('zsh')
  })

  it('passes over rows that went with it, to the nearest one left', () => {
    expect(selectionAfter(rows('vim', 'zsh', 'tail', 'plan'), rows('vim', 'plan'), 'zsh')).toBe('plan')
    expect(selectionAfter(rows('vim', 'zsh', 'tail'), rows('vim'), 'zsh')).toBe('vim')
  })

  it('selects nothing once no row is left', () => {
    expect(selectionAfter(rows('vim'), [], 'vim')).toBeUndefined()
  })

  it('moves up and down between the rows standing for Panes, past the headings, wrapping around', () => {
    const listed = [...rows('vim', 'zsh'), { label: 'infra', level: 0 as const }, ...rows('tail').slice(1)]

    expect(movedSelection(listed, 'zsh', 1)).toBe('tail')
    expect(movedSelection(listed, 'tail', 1)).toBe('vim')
    expect(movedSelection(listed, 'vim', -1)).toBe('tail')
    expect(movedSelection([], undefined, 1)).toBeUndefined()
  })
})
