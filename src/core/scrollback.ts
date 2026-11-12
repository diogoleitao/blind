// Keeps the last `lineLimit` lines of a Pane's scrollback, the lines of its screen included. Serialized terminals end
// lines in `\r\n`.
export function capScrollback (scrollback: string, lineLimit: number) {
  const lines = scrollback.split('\r\n')
  return lines.length > lineLimit ? lines.slice(lines.length - lineLimit).join('\r\n') : scrollback
}
