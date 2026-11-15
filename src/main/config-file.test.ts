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

describe('the schema written next to the config file', () => {
  function writtenSchema () {
    createConfigFile(directory).writeSchema()
    return JSON.parse(readFileSync(join(directory, 'config.schema.json'), 'utf8'))
  }

  it('groups the settings by glossary term, in glossary order, each group closed to other settings', () => {
    const schema = writtenSchema()
    const groups = Object.entries(schema.properties as Record<string, { type?: string; properties?: object; additionalProperties?: boolean }>)
      .filter(([, property]) => property.type === 'object' && property.properties)
    expect(Object.keys(schema.properties)).toEqual([
      '$schema', 'session', 'tab', 'pane', 'shell', 'loginLaunch', 'sessionBanner', 'commandPalette', 'theme',
      'background', 'menuBarIcon', 'keyBindings',
    ])
    expect(schema.additionalProperties).toBe(false)
    expect(Object.fromEntries(groups.map(([name, group]) => [name, Object.keys(group.properties!)]))).toMatchObject({
      session: ['cycleOrder', 'withoutNameOrRootOnClose'],
      tab: ['startDirectory', 'renameSuggestion'],
      pane: ['scrollbackLines', 'startDirectory', 'padding', 'scrollBar'],
      loginLaunch: ['start', 'withNoOpenSessions'],
      commandPalette: ['sessionSearchOrder', 'tabSearchScope', 'paneSearchScope', 'nesting'],
      background: ['transparency', 'effect', 'blurRadius'],
    })
    for (const [, group] of groups) expect(group.additionalProperties).toBe(false)
  })

  it('gives grouped settings the defaults they had before they were grouped', () => {
    const { properties } = writtenSchema()
    const defaults = (group: string) =>
      Object.fromEntries(Object.entries(properties[group].properties as Record<string, { default: unknown }>)
        .map(([name, setting]) => [name, setting.default]))
    expect(defaults('session')).toEqual({ cycleOrder: 'alphabetical', withoutNameOrRootOnClose: 'keep' })
    expect(defaults('tab')).toEqual({ startDirectory: 'root', renameSuggestion: 'claude' })
    expect(defaults('pane')).toEqual({ scrollbackLines: 10_000, startDirectory: 'current', padding: 'padded', scrollBar: 'none' })
    expect(defaults('loginLaunch')).toEqual({ start: 'hidden', withNoOpenSessions: 'hotkey' })
    expect(defaults('commandPalette')).toEqual({
      sessionSearchOrder: 'openFirst', tabSearchScope: 'all', paneSearchScope: 'all', nesting: 'flat',
    })
    expect(defaults('background')).toEqual({ transparency: 25, effect: 'blur', blurRadius: 15 })
  })
})
