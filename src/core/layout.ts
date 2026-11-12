import type { Layout, PaneId } from './state'

// Where a Pane sits in its Tab, as fractions of the Tab's width and height from its top left corner.
export interface PaneRect {
  paneId: PaneId;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every Pane's rectangle, in layout order.
export function paneRects (layout: Layout, x = 0, y = 0, width = 1, height = 1): PaneRect[] {
  if (layout.type === 'pane') return [{ paneId: layout.paneId, x, y, width, height }]
  if (layout.direction === 'vertical') {
    return [
      ...paneRects(layout.first, x, y, width / 2, height),
      ...paneRects(layout.second, x + width / 2, y, width / 2, height),
    ]
  }
  return [
    ...paneRects(layout.first, x, y, width, height / 2),
    ...paneRects(layout.second, x, y + height / 2, width, height / 2),
  ]
}

export type FocusDirection = 'left' | 'right' | 'up' | 'down'

// The Pane across `paneId`'s edge in `direction` that shares the longest stretch of that edge, the earliest in layout
// order on a tie. Rectangles are halves of halves, so their edges compare exactly.
export function neighbourOf (layout: Layout, paneId: PaneId, direction: FocusDirection): PaneId | undefined {
  const rects = paneRects(layout)
  const from = rects.find((rect) => rect.paneId === paneId)
  if (!from) return undefined
  let best: { paneId: PaneId; shared: number } | undefined
  for (const rect of rects) {
    const shared = sharedEdge(from, rect, direction)
    if (shared > 0 && (!best || shared > best.shared)) best = { paneId: rect.paneId, shared }
  }
  return best?.paneId
}

// How much of `from`'s edge in `direction` `to` sits against, or 0 if it isn't across that edge.
function sharedEdge (from: PaneRect, to: PaneRect, direction: FocusDirection) {
  const across = {
    left: to.x + to.width === from.x,
    right: from.x + from.width === to.x,
    up: to.y + to.height === from.y,
    down: from.y + from.height === to.y,
  }[direction]
  if (!across) return 0
  if (direction === 'left' || direction === 'right') {
    return Math.min(from.y + from.height, to.y + to.height) - Math.max(from.y, to.y)
  }
  return Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x)
}

// The layout without the Pane `paneId`, its sibling filling the split they shared; undefined if it was the only Pane.
export function removePane (layout: Layout, paneId: PaneId): Layout | undefined {
  if (layout.type === 'pane') return layout.paneId === paneId ? undefined : layout
  const first = removePane(layout.first, paneId)
  const second = removePane(layout.second, paneId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}

// The Pane that takes the focus when `paneId` closes: the one nearest to it in the sibling that fills its space.
export function successorOf (layout: Layout, paneId: PaneId): PaneId | undefined {
  if (layout.type === 'pane') return undefined
  if (layout.first.type === 'pane' && layout.first.paneId === paneId) return outermostPaneOf(layout.second, 'first')
  if (layout.second.type === 'pane' && layout.second.paneId === paneId) return outermostPaneOf(layout.first, 'second')
  return successorOf(layout.first, paneId) ?? successorOf(layout.second, paneId)
}

// The first or last Pane of a layout, in layout order.
function outermostPaneOf (layout: Layout, end: 'first' | 'second'): PaneId {
  return layout.type === 'pane' ? layout.paneId : outermostPaneOf(layout[end], end)
}

// The layout with the Pane `paneId` swapped for `replacement`.
export function replacePane (layout: Layout, paneId: PaneId, replacement: Layout): Layout {
  if (layout.type === 'pane') return layout.paneId === paneId ? replacement : layout
  return {
    ...layout,
    first: replacePane(layout.first, paneId, replacement),
    second: replacePane(layout.second, paneId, replacement),
  }
}
