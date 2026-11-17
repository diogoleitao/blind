import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createThemeFiles, readThemeSource } from './theme-files'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'blind-themes-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('writing a Theme file', () => {
  it('writes it to the themes folder, making the folder', () => {
    const themeFiles = createThemeFiles(join(directory, 'themes'))

    expect(themeFiles.write('Dracula.jsonc', '{ "name": "Dracula" }\n')).toBe(true)

    expect(readFileSync(join(directory, 'themes', 'Dracula.jsonc'), 'utf8')).toBe('{ "name": "Dracula" }\n')
  })

  it('never writes over a file already there', () => {
    writeFileSync(join(directory, 'Dracula.jsonc'), '{ "name": "Dracula Pro" }')
    const themeFiles = createThemeFiles(directory)

    expect(themeFiles.write('Dracula.jsonc', '{ "name": "Dracula" }\n')).toBe(false)

    expect(readFileSync(join(directory, 'Dracula.jsonc'), 'utf8')).toBe('{ "name": "Dracula Pro" }')
  })
})

describe('reading a file picked to Import a Theme from', () => {
  it('reads its name and its text', () => {
    writeFileSync(join(directory, 'dracula.conf'), 'background #282a36\n')

    expect(readThemeSource(join(directory, 'dracula.conf'))).toEqual({
      fileName: 'dracula.conf',
      text: 'background #282a36\n',
    })
  })

  it('leaves out the text of a file far larger than any theme, such as a video picked by mistake', () => {
    writeFileSync(join(directory, 'holiday.mov'), Buffer.alloc(2 * 1024 * 1024))

    expect(readThemeSource(join(directory, 'holiday.mov'))).toEqual({ fileName: 'holiday.mov', text: undefined })
  })

  it("leaves out the text of a file that can't be read", () => {
    expect(readThemeSource(join(directory, 'gone.conf'))).toEqual({ fileName: 'gone.conf', text: undefined })
  })
})
