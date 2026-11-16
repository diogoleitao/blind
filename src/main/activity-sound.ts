import { type ChildProcess, execFile } from 'node:child_process'
import type { ActivitySound } from '../core/config'

// Plays the macOS system sounds with afplay. A sound still playing stops when the next one starts, so browsing them in
// the Command Palette plays only the one selected.
export function createActivitySoundPlayer () {
  let playing: ChildProcess | undefined

  function play (sound: ActivitySound) {
    playing?.kill()
    playing = execFile('afplay', [`/System/Library/Sounds/${sound}.aiff`], () => {})
  }

  return { play }
}
