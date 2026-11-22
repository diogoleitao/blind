import type { PaneId } from './state'

// One row of the Activity Sidebar, at its depth: 0 for a Session, 1 under it, 2 under a Tab. A row with `paneId` stands
// for that Pane and is the one chosen; one without is a heading. `group` marks the heading of the Open Sessions or the
// Closed Sessions, at depth 0. `hiddenTab` marks a Hidden Tab's rows.
export interface ActivitySidebarRow {
  label: string;
  level: 0 | 1 | 2;
  paneId?: PaneId;
  group?: true;
  hiddenTab?: true;
}

// The Panes the rows stand for, in order.
function choosable (rows: ActivitySidebarRow[]) {
  return rows.flatMap((row) => (row.paneId === undefined ? [] : [row.paneId]))
}

// The Pane selected once the rows change from `previous` to `rows`: still the selected one while it has a row, or else
// the nearest Pane after it in `previous` that still has one, or else the nearest before it, or else the first. None
// once no row stands for a Pane.
export function selectionAfter (previous: ActivitySidebarRow[], rows: ActivitySidebarRow[], selected: PaneId | undefined) {
  const listed = choosable(rows)
  if (selected !== undefined && listed.includes(selected)) return selected
  const before = choosable(previous)
  const position = selected === undefined ? -1 : before.indexOf(selected)
  const stillListed = (paneId: PaneId) => listed.includes(paneId)
  const after = position < 0 ? undefined : before.slice(position + 1).find(stillListed)
  return after ?? (position < 0 ? undefined : before.slice(0, position).findLast(stillListed)) ?? listed[0]
}

// The Pane `offset` rows standing for Panes from the selected one, wrapping around between the first and last; the first
// when none is selected.
export function movedSelection (rows: ActivitySidebarRow[], selected: PaneId | undefined, offset: number) {
  const listed = choosable(rows)
  const position = selected === undefined ? -1 : listed.indexOf(selected)
  if (position < 0) return listed[0]
  return listed[(position + offset + listed.length) % listed.length]
}
