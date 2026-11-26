import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { referencePages } from './reference-pages'

// The committed page at `path` from the repository's root, or undefined when there's none.
function committed (path: string) {
  try {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  } catch {
    return undefined
  }
}

describe('the committed reference pages', () => {
  it.each(Object.entries(referencePages()))('%s is up to date', (path, page) => {
    expect(committed(path), `${path} is out of date: run npm run docs and commit the result`).toBe(page)
  })
})
