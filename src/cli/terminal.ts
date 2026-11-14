import { on } from 'node:events'
import { emitKeypressEvents, type Key as KeypressKey } from 'node:readline'
import type { Key } from './settings-editor'

// The keys readline names that the settings editor answers to.
const namedKeys: Record<string, Key> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  return: 'enter',
  escape: 'escape',
  backspace: 'backspace',
}

// The key readline reports, or undefined for one the settings editor doesn't answer to. Raw mode turns Ctrl+C into a
// key rather than a signal.
function keyFrom (char: string | undefined, key: KeypressKey | undefined): Key | undefined {
  if (key?.ctrl && key.name === 'c') return 'interrupt'
  if (key?.name && Object.hasOwn(namedKeys, key.name)) return namedKeys[key.name]
  if (char && char.length === 1 && char >= ' ' && !key?.ctrl && !key?.meta) return { char }
  return undefined
}

// This process's terminal. The settings editor draws on the alternate screen, which gives the shell's screen back as it
// was on closing, and reads keys raw, one at a time. Raw mode also stops a newline returning the cursor to the start of
// the line, so lines end in both.
export function createTerminal () {
  const { stdin, stdout } = process
  let drawn = false
  return {
    interactive: Boolean(stdin.isTTY && stdout.isTTY),
    async * keys () {
      emitKeypressEvents(stdin)
      stdin.setRawMode(true)
      for await (const [char, key] of on(stdin, 'keypress') as AsyncIterable<[string | undefined, KeypressKey]>) {
        const pressed = keyFrom(char, key)
        if (pressed) yield pressed
      }
    },
    draw (lines: string[]) {
      if (!drawn) stdout.write('\x1b[?1049h\x1b[?25l')
      drawn = true
      stdout.write(`\x1b[H\x1b[2J${lines.join('\r\n')}`)
    },
    close () {
      if (stdin.isTTY) stdin.setRawMode(false)
      stdin.pause()
      if (drawn) stdout.write('\x1b[?25h\x1b[?1049l')
    },
  }
}
