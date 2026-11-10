// How many lines of a Pane's scrollback are kept, the lines of its screen included. Serialized terminals end lines in
// `\r\n`.
export const scrollbackLineLimit = 10_000;

export function capScrollback(scrollback: string) {
  const lines = scrollback.split("\r\n");
  return lines.length > scrollbackLineLimit ? lines.slice(-scrollbackLineLimit).join("\r\n") : scrollback;
}
