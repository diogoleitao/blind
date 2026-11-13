import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the Node version', () => {
  it('is the same major in .nvmrc and the engines field', () => {
    const major = read('../.nvmrc').trim()
    const { engines } = JSON.parse(read('../package.json'))

    expect(major).toMatch(/^\d+$/)
    expect(engines.node).toBe(`>=${major}`)
  })
})
