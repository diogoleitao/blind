import { describe, expect, it } from 'vitest'
import { press } from './fakes'
import { terminalInput } from './terminal-keys'

describe('what a key sends to the Shell in place of what the terminal would', () => {
  it('sends Esc Enter for Shift+Enter, which programs like Claude Code take as a newline', () => {
    expect(terminalInput(press('Enter', 'Enter', 'shift'))).toBe('\x1b\r')
  })

  it('moves back and forward a word for Option+Left and Option+Right, as iTerm2 does', () => {
    expect(terminalInput(press('ArrowLeft', 'ArrowLeft', 'alt'))).toBe('\x1bb')
    expect(terminalInput(press('ArrowRight', 'ArrowRight', 'alt'))).toBe('\x1bf')
  })

  it('leaves every other key to the terminal, including those keys with other modifiers held', () => {
    expect(terminalInput(press('Enter', 'Enter'))).toBeUndefined()
    expect(terminalInput(press('Enter', 'Enter', 'alt'))).toBeUndefined()
    expect(terminalInput(press('Enter', 'Enter', 'shift', 'alt'))).toBeUndefined()
    expect(terminalInput(press('Enter', 'Enter', 'shift', 'meta'))).toBeUndefined()
    expect(terminalInput(press('Enter', 'Enter', 'shift', 'control'))).toBeUndefined()
    expect(terminalInput(press('ArrowLeft', 'ArrowLeft'))).toBeUndefined()
    expect(terminalInput(press('ArrowLeft', 'ArrowLeft', 'alt', 'shift'))).toBeUndefined()
    expect(terminalInput(press('ArrowRight', 'ArrowRight', 'alt', 'meta'))).toBeUndefined()
    expect(terminalInput(press('ArrowRight', 'ArrowRight', 'alt', 'control'))).toBeUndefined()
    expect(terminalInput(press('a', 'KeyA', 'shift'))).toBeUndefined()
  })
})
