// The Command Palette's position is how far down its window its top sits, as a fraction of the window's height, so it
// keeps its place as the window changes size. It starts 15% down, and the user can drag it up or down from there.
export const defaultPalettePosition = 0.15

// Keeps the Command Palette's top no higher than the window's top edge, and no lower than where its smallest useful
// height, the search field with three results, still fits above the window's bottom edge.
export function palettePositionWithinWindow (
  position: number,
  { windowHeight, smallestPaletteHeight }: { windowHeight: number; smallestPaletteHeight: number }
) {
  const lowest = Math.max(0, 1 - smallestPaletteHeight / windowHeight)
  return Math.min(Math.max(position, 0), lowest)
}
