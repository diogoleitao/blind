import type { Effect, QuitSession, RunningProgram } from '../core/core'

// What the quit confirmation asks.
export type QuitPrompt = Extract<Effect, { type: 'confirmQuit' }>

// The quit confirmation's words: its title, what happens to the Shells, the lists of Sessions it names, each under its
// heading if it has one, and the label of the button that confirms.
export interface QuitPromptText {
  title: string;
  detail: string;
  lists: { heading?: string; sessions: QuitSession[] }[];
  confirm: string;
}

// Quit and End Shells' list needs no heading, being the only one besides the Sessions deleted.
const listHeadings = {
  deleted: 'Deleted',
  runningClosed: 'Closed Sessions still running',
  running: undefined,
} as const

export function quitPromptText (asked: QuitPrompt): QuitPromptText {
  const comingBack = asked.restart ? 'as Blind starts again' : 'the next time Blind starts'
  return {
    title: asked.restart ? 'Restart Blind?' : 'Quit Blind?',
    detail: asked.endShells
      ? `Every Shell ends. Sessions come back with fresh Shells ${comingBack}.`
      : `The Shells keep running, and Blind shows each as it is ${comingBack}.`,
    lists: (Object.keys(listHeadings) as (keyof typeof listHeadings)[]).flatMap((list) => {
      const sessions = asked[list]
      return sessions ? [{ heading: listHeadings[list], sessions }] : []
    }),
    confirm: asked.restart ? 'Restart' : 'Quit',
  }
}

// A program by its name, with how many Panes it runs in when more than one, e.g. `vim (2)`.
export function programLabel ({ program, count }: RunningProgram) {
  return count > 1 ? `${program} (${count})` : program
}

// The items as a sentence lists them, e.g. `vim, claude and less`.
export function listInProse (items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

// A Session's line in the quit confirmation's sections: its label and how many programs quitting ends in it, counting
// each Pane's, e.g. `api · 3 programs` for two `vim` and a `claude`.
export function quitSessionSummary ({ label, programs }: QuitSession) {
  const count = programs.reduce((total, program) => total + program.count, 0)
  return `${label} · ${count} ${count === 1 ? 'program' : 'programs'}`
}

// A Session as a line of plain text lists it, its programs after its label, e.g. `api: vim (2) and claude`.
export function quitSessionLine ({ label, programs }: QuitSession) {
  return programs.length === 0 ? label : `${label}: ${listInProse(programs.map(programLabel))}`
}
