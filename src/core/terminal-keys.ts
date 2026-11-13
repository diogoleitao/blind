import type { KeyPress } from './key-bindings'

// What a key press in a Pane sends to the Shell in place of what xterm.js would send. Undefined for every other key.
// Option+Left and Option+Right move by word as iTerm2's Natural Text Editing has them, sending Esc b and Esc f, which
// shells bind to moving back and forward a word. Shift+Enter sends Esc Enter, as Option+Enter does, since xterm.js
// sends a plain Enter for it and programs like Claude Code take Esc Enter as a newline.
export function terminalInput ({ key, meta, shift, alt, control }: KeyPress) {
  if (meta || control) return undefined
  if (alt && !shift && key === 'ArrowLeft') return '\x1bb'
  if (alt && !shift && key === 'ArrowRight') return '\x1bf'
  if (shift && !alt && key === 'Enter') return '\x1b\r'
  return undefined
}
