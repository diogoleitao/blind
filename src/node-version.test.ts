import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const major = read('../.nvmrc').trim()
const { engines, devDependencies } = JSON.parse(read('../package.json'))

describe('the Node version', () => {
  it('is the same major in .nvmrc and the engines field', () => {
    expect(major).toMatch(/^\d+$/)
    expect(engines.node).toBe(`>=${major}`)
  })

  it('is the same major in .nvmrc and the @types/node range', () => {
    expect(devDependencies['@types/node']).toMatch(new RegExp(`^\\^${major}\\.`))
  })
})
