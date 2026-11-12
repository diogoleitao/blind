import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedScrollback, Snapshot, StateStore } from '../core/ports'
import { type PaneId, panesIn } from '../core/state'

// How long a save waits before writing, so a burst of changes, such as a Pane's output, is written once.
const writeDelayMilliseconds = 1_000

// Writes to a sibling file first, so a crash mid-write leaves the previous version whole.
function writeWhole (path: string, data: string) {
  writeFileSync(`${path}.tmp`, data)
  renameSync(`${path}.tmp`, path)
}

// Keeps the state in `state.json` and each Pane's scrollback in `scrollback/<pane id>`, inside `directory`.
export function createFileStateStore (directory: string): StateStore {
  const statePath = join(directory, 'state.json')
  const scrollbackDirectory = join(directory, 'scrollback')
  let pending: Snapshot | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // What each scrollback file holds, to write only the Panes whose scrollback changed.
  let written: Record<PaneId, SavedScrollback> = {}

  function write (snapshot: Snapshot) {
    mkdirSync(scrollbackDirectory, { recursive: true })
    writeWhole(statePath, JSON.stringify(snapshot.state))
    for (const [paneId, scrollback] of Object.entries(snapshot.scrollback)) {
      if (written[paneId] !== scrollback) writeWhole(join(scrollbackDirectory, paneId), JSON.stringify(scrollback))
    }
    for (const paneId of readdirSync(scrollbackDirectory)) {
      if (!(paneId in snapshot.scrollback)) rmSync(join(scrollbackDirectory, paneId), { force: true })
    }
    written = snapshot.scrollback
  }

  function flush () {
    clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const snapshot = pending
    pending = undefined
    try {
      write(snapshot)
    } catch (error) {
      console.error(`Couldn't save the state to ${directory}:`, error)
    }
  }

  return {
    load () {
      if (!existsSync(statePath)) return undefined
      try {
        const state: Snapshot['state'] = JSON.parse(readFileSync(statePath, 'utf8'))
        const scrollback: Record<PaneId, SavedScrollback> = {}
        for (const { id } of panesIn(state)) {
          const path = join(scrollbackDirectory, id)
          if (!existsSync(path)) continue
          // An unreadable scrollback costs only its own Pane's history.
          try {
            scrollback[id] = JSON.parse(readFileSync(path, 'utf8'))
          } catch (error) {
            console.error(`Couldn't restore the scrollback in ${path}:`, error)
          }
        }
        written = scrollback
        return { state, scrollback }
      } catch (error) {
        // Moved aside rather than overwritten by the next save, so it can still be recovered by hand.
        const asidePath = join(directory, `state-${Date.now()}.unreadable.json`)
        console.error(`Couldn't restore the state from ${statePath}, starting afresh; moved it to ${asidePath}:`, error)
        try {
          renameSync(statePath, asidePath)
        } catch (renameError) {
          console.error(`Couldn't move ${statePath} aside:`, renameError)
        }
        return undefined
      }
    },
    save (snapshot) {
      pending = snapshot
      timer ??= setTimeout(flush, writeDelayMilliseconds)
    },
    flush,
  }
}
