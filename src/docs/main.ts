import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { referencePages } from './reference-pages'

// Writes each generated page, run by `npm run docs` from out/docs, two folders below the repository's root.
const root = new URL('../../', import.meta.url)

for (const [path, page] of Object.entries(referencePages())) {
  const file = fileURLToPath(new URL(path, root))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, page)
  console.log(`Wrote ${path}`)
}
