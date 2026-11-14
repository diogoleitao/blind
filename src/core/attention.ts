// The OSC numbers programs send desktop notifications under: iTerm2's 9, kitty's 99 and urxvt's 777.
export const notificationOscs = [9, 99, 777] as const

export type NotificationOsc = (typeof notificationOscs)[number]

// Whether an OSC's payload, the text after its number and `;`, is a notification. ConEmu's `9;4` reports progress, and
// 777 carries other commands besides `notify`.
export function isNotification (osc: NotificationOsc, payload: string) {
  if (osc === 9) return !payload.startsWith('4;')
  if (osc === 777) return payload.startsWith('notify;')
  return true
}

// What a program's OSC 7501 payload, the text after `7501;`, asks of the terminal, under the Program Status Protocol:
// https://www.superlogical.com/rex/docs/build/program-status.
export type ProgramStatus = { type: 'query' } | ({ type: 'report' } & ProgramStatusReport)

// A report on one of the program's status records. Its record is the root record without an `id`, which is `''` here.
export interface ProgramStatusReport {
  id: string;
  state: ProgramState;
}

// The terminal's answer to the query, telling the program to send its reports. Listing no states or kinds stands for
// every one the protocol names.
export const programStatusSupported = '\x1b]7501;?\x1b\\'

const programStates = ['idle', 'working', 'blocked', 'done', 'error', 'clear'] as const

export type ProgramState = (typeof programStates)[number]

// Whether a record in the state wants the user: waiting on them, finished, or stopped on a failure.
export function wantsTheUser (state: ProgramState) {
  return state === 'blocked' || state === 'done' || state === 'error'
}

// Whether the report replaces the record, as one on the same id does. `clear` drops the records under its id too, and
// every record without one.
export function replaces ({ id, state }: ProgramStatusReport, record: string) {
  return record === id || (state === 'clear' && (id === '' || record.startsWith(`${id}/`)))
}

// The protocol's caps, past any of which a report is thrown away whole, in bytes. The sequence's counts its
// `ESC ] 7501 ;` and its longest terminator, `ESC \`.
const maximumSequenceLength = 4096
const sequenceFramingLength = '\x1b]7501;\x1b\\'.length
const maximumKeyLength = 16
const maximumIdSegmentLength = 32
const maximumIdDepth = 8

// How many bytes the text takes in UTF-8, as the program sent it.
function utf8Length (text: string) {
  let bytes = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
  }
  return bytes
}

// A report is `key=value` pairs separated by `:`, its values free of `:`; a pair without a key and an `=` is skipped,
// and a repeated key's last value wins. A report without a state the protocol names, or past one of its caps, is
// ignored.
export function programStatus (payload: string): ProgramStatus | undefined {
  if (payload === '?') return { type: 'query' }
  if (utf8Length(payload) + sequenceFramingLength > maximumSequenceLength) return undefined
  const fields = new Map<string, string>()
  for (const pair of payload.split(':')) {
    const separator = pair.indexOf('=')
    if (separator < 1) continue
    fields.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  if ([...fields.keys()].some((key) => key.length > maximumKeyLength)) return undefined
  const state = fields.get('state') as ProgramState
  if (!programStates.includes(state)) return undefined
  const id = fields.get('id') ?? ''
  const segments = id.split('/')
  if (segments.length > maximumIdDepth || segments.some((segment) => segment.length > maximumIdSegmentLength)) {
    return undefined
  }
  return { type: 'report', id, state }
}
