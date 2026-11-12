import type { PaletteAction } from './core'

// A key pressed in a Session's window as the keyboard reports it: `key` is what the key produces under the layout and
// modifiers, e.g. `}` for Shift+], and `code` names the physical key, e.g. `BracketRight`.
export interface KeyPress {
  key: string;
  code: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  control: boolean;
}

// A key with the modifiers that must be held, and no others. `key` is lowercase, or a key name like `arrowleft`.
export interface Shortcut {
  key: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  control: boolean;
}

type TabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// Every app action, plus opening the Command Palette, copying and pasting, and focusing the Tab at each of the first
// nine positions.
export type BoundAction = PaletteAction | 'openCommandPalette' | 'copy' | 'paste' | `focusTab${TabNumber}`

// iTerm2's shortcuts, plus Cmd+K for the Command Palette, Cmd+Backtick for cycling Sessions and Cmd+Shift+K for
// clearing scrollback. Null leaves an action unbound.
export const defaultKeyBindings: Record<BoundAction, string | null> = {
  openCommandPalette: 'Cmd+K',
  newSession: 'Cmd+N',
  renameSession: null,
  setSessionRoot: null,
  clearSessionRoot: null,
  closeSession: null,
  deleteSession: null,
  newTab: 'Cmd+T',
  renameTab: null,
  clearTabTitle: null,
  splitPaneVertically: 'Cmd+D',
  splitPaneHorizontally: 'Cmd+Shift+D',
  closePane: 'Cmd+W',
  nextSession: 'Cmd+`',
  previousSession: 'Cmd+Shift+`',
  nextTab: 'Cmd+Shift+]',
  previousTab: 'Cmd+Shift+[',
  nextPane: 'Cmd+]',
  previousPane: 'Cmd+[',
  focusPaneLeft: 'Cmd+Alt+Left',
  focusPaneRight: 'Cmd+Alt+Right',
  focusPaneUp: 'Cmd+Alt+Up',
  focusPaneDown: 'Cmd+Alt+Down',
  findInPane: 'Cmd+F',
  clearScrollback: 'Cmd+Shift+K',
  copy: 'Cmd+C',
  paste: 'Cmd+V',
  focusTab1: 'Cmd+1',
  focusTab2: 'Cmd+2',
  focusTab3: 'Cmd+3',
  focusTab4: 'Cmd+4',
  focusTab5: 'Cmd+5',
  focusTab6: 'Cmd+6',
  focusTab7: 'Cmd+7',
  focusTab8: 'Cmd+8',
  focusTab9: 'Cmd+9',
  changeTheme: null,
  changeMenuBarIcon: null,
  openSettings: null,
  quit: null,
}

const modifierNames: Record<string, keyof Omit<Shortcut, 'key'>> = {
  cmd: 'meta',
  command: 'meta',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  ctrl: 'control',
  control: 'control',
}

// Keys written by name, as their `KeyPress` keys in lowercase.
const keyNames: Record<string, string> = {
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  space: ' ',
  backspace: 'backspace',
  delete: 'delete',
  escape: 'escape',
  esc: 'escape',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  plus: '+',
  ...Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index + 1}`, `f${index + 1}`])),
}

// A shortcut written like `Cmd+Shift+D`: modifiers, then one character or key name, joined by `+`, ignoring case.
// Undefined unless it holds Cmd or Ctrl, so no binding takes typed characters, Shifted or Optioned ones included, from
// the Pane's terminal.
export function parseShortcut (text: string): Shortcut | undefined {
  const parts = text.split('+').map((part) => part.trim().toLowerCase())
  const last = parts.pop()!
  const key = keyNames[last] ?? ([...last].length === 1 ? last : undefined)
  if (key === undefined) return undefined
  const shortcut: Shortcut = { key, meta: false, shift: false, alt: false, control: false }
  for (const part of parts) {
    const modifier = modifierNames[part]
    if (!modifier) return undefined
    shortcut[modifier] = true
  }
  return shortcut.meta || shortcut.control ? shortcut : undefined
}

export function sameShortcut (a: Shortcut, b: Shortcut) {
  return a.key === b.key && a.meta === b.meta && a.shift === b.shift && a.alt === b.alt && a.control === b.control
}

// Keys Shift turns into other characters, matched by what they produce unshifted.
const unshiftedKeys: Record<string, string> = { '{': '[', '}': ']', '~': '`' }

// Punctuation and digits, matched by their key's position too, since Shift and keyboard layouts change what they
// produce.
const positionalKeys: Record<string, string> = {
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [`Digit${digit}`, String(digit)])),
}

export function matchesShortcut (keyPress: KeyPress, shortcut: Shortcut) {
  const { meta, shift, alt, control } = keyPress
  if (meta !== shortcut.meta || shift !== shortcut.shift || alt !== shortcut.alt || control !== shortcut.control) {
    return false
  }
  const key = keyPress.key.toLowerCase()
  return [key, unshiftedKeys[key], positionalKeys[keyPress.code], optionLetter(keyPress)].includes(shortcut.key)
}

// Option turns a letter into another character, e.g. `∂` for D, so with Option held a letter matches by its key's
// position. Without Option, letters match by what they produce, following the keyboard layout.
function optionLetter ({ alt, code }: KeyPress) {
  return alt && /^Key[A-Z]$/.test(code) ? code.slice('Key'.length).toLowerCase() : undefined
}
