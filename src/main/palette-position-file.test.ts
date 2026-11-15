import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPalettePositionFile } from './palette-position-file'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'blind-palette-position-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the file keeping where the user dragged the Command Palette', () => {
  it('reads back the position saved, creating its directory', () => {
    const file = createPalettePositionFile(join(directory, 'Blind'))

    file.save(0.4)

    expect(createPalettePositionFile(join(directory, 'Blind')).read()).toBe(0.4)
  })

  it('reads nothing before a position was saved', () => {
    expect(createPalettePositionFile(directory).read()).toBeUndefined()
  })

  it.each([
    ['not JSON', '{ position'],
    ['not a number', '"low"'],
    ['above the window', '-0.1'],
    ['below the window', '1.5'],
  ])('reads nothing from a file holding %s', (_case, text) => {
    writeFileSync(join(directory, 'palette-position.json'), text)

    expect(createPalettePositionFile(directory).read()).toBeUndefined()
  })

  it('forgets the position once cleared, and clearing with none saved does nothing', () => {
    const file = createPalettePositionFile(directory)
    file.clear()
    file.save(0.4)

    file.clear()

    expect(file.read()).toBeUndefined()
    expect(existsSync(join(directory, 'palette-position.json'))).toBe(false)
  })
})
