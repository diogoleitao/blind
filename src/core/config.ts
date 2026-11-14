import { isObject, readJsonc } from './jsonc'
import { type BoundAction, defaultKeyBindings, parseShortcut, sameShortcut, type Shortcut } from './key-bindings'
import { builtInThemes, defaultTheme } from './themes'

const cycleOrders = ['alphabetical', 'recent', 'created'] as const

// The order Open Sessions are cycled through: by name, by most recent use, or by creation.
export type CycleOrder = (typeof cycleOrders)[number]

const sessionSearchOrders = ['openFirst', 'cycle'] as const

// The order the Command Palette's `ss ` lists Sessions in: the Open ones before the Closed ones, or Open and Closed
// together, each by the cycle order, or by how well they match once there's a search.
export type SessionSearchOrder = (typeof sessionSearchOrders)[number]

const tabSearchScopes = ['all', 'currentSession'] as const

// Whose Tabs the Command Palette's `tt ` lists: every Open Session's, or the Current Session's alone.
export type TabSearchScope = (typeof tabSearchScopes)[number]

const paneSearchScopes = ['all', 'currentSession', 'currentTab'] as const

// Whose Panes the Command Palette's `pp ` lists: every Open Session's, the Current Session's alone, or the Current
// Tab's alone.
export type PaneSearchScope = (typeof paneSearchScopes)[number]

const hotkeyBehaviours = ['new', 'palette'] as const

// What the Hotkey shows with no Open Sessions: a new Session, or the Command Palette on its own.
export type HotkeyWithNoOpenSessions = (typeof hotkeyBehaviours)[number]

const loginLaunches = ['hidden', 'shown'] as const

// How the launch at login starts: hidden until the Hotkey shows the app, or shown, as a launch by hand does.
export type LoginLaunch = (typeof loginLaunches)[number]

const hiddenStartBehaviours = ['new', 'hotkey'] as const

// What a hidden launch at login with no Open Sessions opens: a new Session, which the first Hotkey press shows, or
// nothing, leaving the first Hotkey press to hotkeyWithNoOpenSessions.
export type HiddenStartWithNoOpenSessions = (typeof hiddenStartBehaviours)[number]

const sessionsWithoutNameOrRootOnCloseBehaviours = ['keep', 'delete'] as const

// What closing a Session with neither a name nor a Root directory does: keep it as a Closed Session, or delete it.
// Quitting closes every Open Session, and delete also deletes such Closed Sessions then.
export type SessionsWithoutNameOrRootOnClose = (typeof sessionsWithoutNameOrRootOnCloseBehaviours)[number]

const startDirectories = ['root', 'current', 'home'] as const

// Where a new Tab or Pane starts: the Session's Root directory, or the current Pane's working directory without one;
// the current Pane's working directory; or the home directory.
export type StartDirectory = (typeof startDirectories)[number]

const sessionLabelPositions = ['belowTabs', 'aboveTabs'] as const

// Where the Tab bar shows the Session's label: on a row below the Tabs, or above them.
export type SessionLabelPosition = (typeof sessionLabelPositions)[number]

export const menuBarIcons = ['monochrome', 'colour'] as const

// The menu bar icon's look: one colour that follows the menu bar's, light or dark, or the icon's own colours.
export type MenuBarIcon = (typeof menuBarIcons)[number]

// What `unlimited` scrollback keeps: the terminal sets its buffer aside up front, so it can't be truly unbounded.
export const unlimitedScrollbackLines = 1_000_000

// What the config file sets, each setting at its default unless the file gives it a valid value.
export interface Settings {
  // The program each new Pane's Shell runs; absent for the user's login shell.
  shell?: string;
  // How many lines of each Pane's scrollback are kept, `unlimited` read as `unlimitedScrollbackLines`.
  scrollbackLines: number;
  cycleOrder: CycleOrder;
  sessionSearchOrder: SessionSearchOrder;
  tabSearchScope: TabSearchScope;
  paneSearchScope: PaneSearchScope;
  hotkeyWithNoOpenSessions: HotkeyWithNoOpenSessions;
  loginLaunch: LoginLaunch;
  hiddenStartWithNoOpenSessions: HiddenStartWithNoOpenSessions;
  sessionsWithoutNameOrRootOnClose: SessionsWithoutNameOrRootOnClose;
  newTabDirectory: StartDirectory;
  splitPaneDirectory: StartDirectory;
  sessionLabelPosition: SessionLabelPosition;
  // Whether cycling Open Sessions shows the Session Banner.
  sessionBanner: boolean;
  // Each action's shortcut; null for an unbound action.
  keyBindings: Record<BoundAction, Shortcut | null>;
  // The name of the Theme in effect, built in or from a Theme file.
  theme: string;
  menuBarIcon: MenuBarIcon;
}

export const defaultSettings: Settings = {
  scrollbackLines: 10_000,
  cycleOrder: 'alphabetical',
  sessionSearchOrder: 'openFirst',
  tabSearchScope: 'all',
  paneSearchScope: 'all',
  hotkeyWithNoOpenSessions: 'new',
  loginLaunch: 'hidden',
  hiddenStartWithNoOpenSessions: 'hotkey',
  sessionsWithoutNameOrRootOnClose: 'keep',
  newTabDirectory: 'root',
  splitPaneDirectory: 'current',
  sessionLabelPosition: 'belowTabs',
  sessionBanner: true,
  keyBindings: Object.fromEntries(
    Object.entries(defaultKeyBindings).map(([action, shortcut]) => [action, shortcut && parseShortcut(shortcut)!])
  ) as Settings['keyBindings'],
  theme: defaultTheme.name,
  menuBarIcon: 'monochrome',
}

const invalid = Symbol('invalid')

// A setting's value read from the config file, or `invalid`. A setting made of entries rejects the invalid ones by
// name and keeps the rest.
type SettingParser<Value> = (value: unknown, rejectEntry: (entry: string) => void) => Value | typeof invalid

function oneOf<const Values extends readonly string[]> (values: Values): SettingParser<Values[number]> {
  return (value) => (values.includes(value as string) ? (value as Values[number]) : invalid)
}

type SettingParsers = { [Name in keyof Settings]-?: SettingParser<Settings[Name]> }

// The theme setting takes the name of one of the Themes loaded.
const settingParsers = (themeNames: readonly string[]): SettingParsers => ({
  shell: (value) => (typeof value === 'string' && value.trim() !== '' ? value : invalid),
  scrollbackLines: (value) => {
    if (value === 'unlimited') return unlimitedScrollbackLines
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= unlimitedScrollbackLines
      ? (value as number)
      : invalid
  },
  cycleOrder: oneOf(cycleOrders),
  sessionSearchOrder: oneOf(sessionSearchOrders),
  tabSearchScope: oneOf(tabSearchScopes),
  paneSearchScope: oneOf(paneSearchScopes),
  hotkeyWithNoOpenSessions: oneOf(hotkeyBehaviours),
  loginLaunch: oneOf(loginLaunches),
  hiddenStartWithNoOpenSessions: oneOf(hiddenStartBehaviours),
  sessionsWithoutNameOrRootOnClose: oneOf(sessionsWithoutNameOrRootOnCloseBehaviours),
  newTabDirectory: oneOf(startDirectories),
  splitPaneDirectory: oneOf(startDirectories),
  sessionLabelPosition: oneOf(sessionLabelPositions),
  sessionBanner: (value) => (typeof value === 'boolean' ? value : invalid),
  keyBindings: parseKeyBindings,
  // Theme names are unique ignoring case, so the setting matches one ignoring case and takes its spelling.
  theme: (value) =>
    themeNames.find((name) => typeof value === 'string' && name.toLowerCase() === value.toLowerCase()) ?? invalid,
  menuBarIcon: oneOf(menuBarIcons),
})

// The defaults with each configured action's shortcut, or null, in place. A configured shortcut is taken away from the
// action bound to it by default; one already configured for another action is rejected.
function parseKeyBindings (value: unknown, rejectEntry: (entry: string) => void) {
  if (!isObject(value)) return invalid
  const configured: Partial<Settings['keyBindings']> = {}
  const isConfigured = (shortcut: Shortcut | null | undefined) =>
    Object.values(configured).some((other) => other && shortcut && sameShortcut(other, shortcut))
  for (const [action, text] of Object.entries(value)) {
    const shortcut = typeof text === 'string' ? parseShortcut(text) : text === null ? null : undefined
    if (!Object.hasOwn(defaultKeyBindings, action) || shortcut === undefined || isConfigured(shortcut)) {
      rejectEntry(`keyBindings.${action}`)
    } else {
      configured[action as BoundAction] = shortcut
    }
  }
  const defaults = Object.entries(defaultSettings.keyBindings).map(([action, shortcut]) => [
    action,
    isConfigured(shortcut) ? null : shortcut,
  ])
  return { ...Object.fromEntries(defaults), ...configured } as Settings['keyBindings']
}

// The JSON schema of the config file, which the file names in `$schema` so editors validate and autocomplete it.
export const configSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Blind settings',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    shell: {
      type: 'string',
      minLength: 1,
      description: "The program each new Pane's Shell runs, as a login shell. Defaults to your login shell ($SHELL).",
    },
    scrollbackLines: {
      description: `How many lines of each Pane's scrollback are kept and restored, up to ${unlimitedScrollbackLines.toLocaleString('en-GB')}; "unlimited" keeps that many.`,
      default: defaultSettings.scrollbackLines,
      oneOf: [
        { type: 'integer', minimum: 0, maximum: unlimitedScrollbackLines },
        { const: 'unlimited' },
      ],
    },
    cycleOrder: {
      description: 'The order Open Sessions are cycled through and listed in: by name, by most recent use, or by creation.',
      enum: cycleOrders,
      default: defaultSettings.cycleOrder,
    },
    sessionSearchOrder: {
      description:
        "The order the Command Palette lists Sessions in when the query starts with ss: openFirst lists the Open Sessions before the Closed ones, cycle lists them together; each by cycleOrder, or by how well they match once there's a search.",
      enum: sessionSearchOrders,
      default: defaultSettings.sessionSearchOrder,
    },
    tabSearchScope: {
      description:
        "Whose Tabs the Command Palette lists when the query starts with tt: all lists every Open Session's, currentSession the Current Session's alone. A query without a prefix lists every Open Session's either way.",
      enum: tabSearchScopes,
      default: defaultSettings.tabSearchScope,
    },
    paneSearchScope: {
      description:
        "Whose Panes the Command Palette lists when the query starts with pp: all lists every Open Session's, currentSession the Current Session's alone, currentTab the Current Tab's alone. A query without a prefix lists every Open Session's either way.",
      enum: paneSearchScopes,
      default: defaultSettings.paneSearchScope,
    },
    hotkeyWithNoOpenSessions: {
      description: 'What the Hotkey shows when there are no Open Sessions: a new Session, or the Command Palette on its own.',
      enum: hotkeyBehaviours,
      default: defaultSettings.hotkeyWithNoOpenSessions,
    },
    loginLaunch: {
      description: 'How the launch at login starts: hidden until the Hotkey shows the app, or shown, as a launch by hand does.',
      enum: loginLaunches,
      default: defaultSettings.loginLaunch,
    },
    hiddenStartWithNoOpenSessions: {
      description:
        'What a hidden launch at login with no Open Sessions opens: a new Session, which the first Hotkey press shows, or nothing, leaving the first Hotkey press to hotkeyWithNoOpenSessions.',
      enum: hiddenStartBehaviours,
      default: defaultSettings.hiddenStartWithNoOpenSessions,
    },
    sessionsWithoutNameOrRootOnClose: {
      description:
        'What closing a Session with neither a name nor a Root directory does: keep it as a Closed Session, or delete it. Quitting closes every Open Session, and delete also deletes such Closed Sessions then.',
      enum: sessionsWithoutNameOrRootOnCloseBehaviours,
      default: defaultSettings.sessionsWithoutNameOrRootOnClose,
    },
    newTabDirectory: {
      description:
        "Where a new Tab starts: root is the Session's Root directory, or the current Pane's working directory without one; current is the current Pane's working directory; home is the home directory. A Session reopened with no Tabs starts its Tab at the home directory for home, and otherwise at its Root directory, or the home directory without one.",
      enum: startDirectories,
      default: defaultSettings.newTabDirectory,
    },
    splitPaneDirectory: {
      description:
        "Where the new Pane of a split starts: root is the Session's Root directory, or the split Pane's working directory without one; current is the split Pane's working directory; home is the home directory.",
      enum: startDirectories,
      default: defaultSettings.splitPaneDirectory,
    },
    sessionLabelPosition: {
      description: "Where the Tab bar shows the Session's label: on a row below the Tabs, or above them.",
      enum: sessionLabelPositions,
      default: defaultSettings.sessionLabelPosition,
    },
    sessionBanner: {
      description: 'Whether cycling Open Sessions shows the Session Banner, naming the Session in the middle of its window.',
      type: 'boolean',
      default: defaultSettings.sessionBanner,
    },
    theme: {
      description:
        "The Theme's name: one built in, or one from a Theme file in the themes folder next to this file. The Command Palette's Change Theme sets it too.",
      type: 'string',
      minLength: 1,
      default: defaultSettings.theme,
      examples: builtInThemes.map((theme) => theme.name),
    },
    menuBarIcon: {
      description:
        "The menu bar icon: monochrome follows the menu bar's colour, light or dark; colour keeps the icon's own colours. The Command Palette's Change Menu Bar Icon sets it too.",
      enum: menuBarIcons,
      default: defaultSettings.menuBarIcon,
    },
    keyBindings: {
      description:
        'Each action\'s shortcut, such as "Cmd+Shift+D": modifiers (Cmd, Shift, Alt or Option, Ctrl) and one key or key name (Left, Right, Up, Down, Enter, Tab, Space, Backspace, Delete, Escape, Home, End, PageUp, PageDown, Plus, F1 to F20), joined by "+". Cmd or Ctrl is required. null unbinds an action; a shortcut given here is taken away from the action it is bound to by default.',
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(defaultKeyBindings).map(([action, shortcut]) => [
          action,
          { type: ['string', 'null'], default: shortcut },
        ])
      ),
    },
  },
  additionalProperties: false,
} as const

// The file the schema is written to, next to the config file.
export const configSchemaFileName = 'config.schema.json'

// What the config file starts as: nothing but the schema, which editors complete from.
export const starterConfig = `{
  // Your editor suggests every setting and its default from the schema.
  "$schema": "./${configSchemaFileName}"
}
`

export interface ParsedConfig {
  settings: Settings;
  // The settings the file gave invalid values, or that don't exist.
  rejected: string[];
}

// The settings in the config file's text, or the defaults without a file; undefined when the text isn't a JSON object,
// comments allowed. Editors read `$schema`, so it's no setting. The theme setting names one of `themeNames`.
export function parseConfig (text: string | undefined, themeNames: readonly string[]): ParsedConfig | undefined {
  const settings = { ...defaultSettings }
  const rejected: string[] = []
  const config = text === undefined ? {} : readJsonc(text)
  if (config === undefined) return undefined
  const parsers = settingParsers(themeNames)
  for (const [name, value] of Object.entries(config)) {
    if (name === '$schema') continue
    const parsed = Object.hasOwn(parsers, name)
      ? parsers[name as keyof Settings](value, (entry) => rejected.push(entry))
      : invalid
    if (parsed === invalid) rejected.push(name)
    else Object.assign(settings, { [name]: parsed })
  }
  return { settings, rejected }
}
