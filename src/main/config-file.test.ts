import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { starterConfig } from '../core/config'
import { createConfigFile } from './config-file'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'blind-config-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('creating the config file if missing', () => {
  it('writes the starter config when there is no file, creating its directory', () => {
    const configFile = createConfigFile(join(directory, 'blind'))
    expect(configFile.createIfMissing()).toBe(true)
    expect(readFileSync(configFile.path, 'utf8')).toBe(starterConfig)
  })

  it('leaves an existing file alone', () => {
    const configFile = createConfigFile(directory)
    writeFileSync(configFile.path, '{ "theme": "mine" }')
    expect(configFile.createIfMissing()).toBe(true)
    expect(readFileSync(configFile.path, 'utf8')).toBe('{ "theme": "mine" }')
  })

  it('answers false when the file can\'t be created', () => {
    writeFileSync(join(directory, 'blind'), 'a file where the directory should be')
    const configFile = createConfigFile(join(directory, 'blind'))
    expect(configFile.createIfMissing()).toBe(false)
  })
})
