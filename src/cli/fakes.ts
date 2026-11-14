import { starterConfig } from '../core/config'
import type { CliDependencies } from './run'
import type { Key } from './settings-editor'

export const fakeConfigPath = '/home/.config/blind/config.jsonc'

// Dependencies that do as little as they can, for a test to override what it looks at.
export function createFakeDependencies (overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    repoRoot: '/repos/blind',
    editor: undefined,
    configFile: {
      path: fakeConfigPath,
      createIfMissing: () => true,
      read: () => ({ readable: true, text: starterConfig }),
      write: () => true,
    },
    themeNames: () => ['Default'],
    terminal: createFakeTerminal([]),
    run: async () => 0,
    stdout: () => {},
    stderr: () => {},
    ...overrides,
  }
}

// A terminal the keys are pressed on, in order, keeping every frame drawn.
export function createFakeTerminal (keys: Key[], { interactive = true } = {}) {
  const frames: string[][] = []
  let closed = false
  return {
    interactive,
    async * keys () { yield * keys },
    draw: (lines: string[]) => { frames.push(lines) },
    close: () => { closed = true },
    // The last frame drawn, one line per line.
    screen: () => frames.at(-1)?.join('\n') ?? '',
    closed: () => closed,
  }
}
