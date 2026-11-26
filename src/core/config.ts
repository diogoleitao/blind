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

const paletteNestings = ['flat', 'nested', 'hidden'] as const

// How the Command Palette lists Tabs and Panes with nothing typed: every Tab and then every Pane after the Sessions,
// each Open Session's Tabs under it and each Tab's Panes under the Tab, or none, leaving them to a search.
export type PaletteNesting = (typeof paletteNestings)[number]

const loginLaunchStarts = ['hidden', 'shown'] as const

// How the Login Launch starts: hidden until the Hotkey shows the app, or shown, as a launch by hand does.
export type LoginLaunchStart = (typeof loginLaunchStarts)[number]

const loginLaunchesWithNoOpenSessions = ['new', 'hotkey'] as const

// What a hidden Login Launch with no Open Sessions opens: a new Session, which the first Hotkey press shows, or
// nothing, leaving it to the first Hotkey press, which opens a new Session.
export type LoginLaunchWithNoOpenSessions = (typeof loginLaunchesWithNoOpenSessions)[number]

const sessionsWithoutNameOrRootOnCloseBehaviours = ['keep', 'delete'] as const

// What closing a Session with neither a name nor a Root directory does: keep it as a Closed Session, or delete it.
// Quitting closes every Open Session, and delete also deletes such Closed Sessions then.
export type SessionsWithoutNameOrRootOnClose = (typeof sessionsWithoutNameOrRootOnCloseBehaviours)[number]

const startDirectories = ['root', 'current', 'home'] as const

// Where a new Tab or Pane starts: the Session's Root directory, or the current Pane's working directory without one;
// the current Pane's working directory; or the home directory.
export type StartDirectory = (typeof startDirectories)[number]

const tabRenameSuggestions = ['claude', 'all'] as const

// Whose Program Title Rename Tab suggests, from the current Pane: Claude Code's alone, or any program's.
export type TabRenameSuggestion = (typeof tabRenameSuggestions)[number]

const hiddenTabReturnPositions = ['end', 'original'] as const

// Where a Hidden Tab goes as it's shown again: after the other Tabs, as a new Tab does, or back at its place among them.
export type HiddenTabReturnPosition = (typeof hiddenTabReturnPositions)[number]

export const menuBarIcons = ['monochrome', 'colour'] as const

// The menu bar icon's look: one colour that follows the menu bar's, light or dark, or the icon's own colours.
export type MenuBarIcon = (typeof menuBarIcons)[number]

// The macOS system sounds, by their names in /System/Library/Sounds.
export const activitySounds = [
  'Basso',
  'Blow',
  'Bottle',
  'Frog',
  'Funk',
  'Glass',
  'Hero',
  'Morse',
  'Ping',
  'Pop',
  'Purr',
  'Sosumi',
  'Submarine',
  'Tink',
] as const

// The sound played when a Pane gains Activity.
export type ActivitySound = (typeof activitySounds)[number]

const activityRings = ['always', 'whileHidden', 'never'] as const

// When a Pane gaining Activity plays the Activity sound: whether the app is shown or hidden, only while it's hidden, or
// never.
export type ActivityRing = (typeof activityRings)[number]

const activitySidebarSides = ['right', 'left'] as const

// The side of the Current Session's window the Activity Sidebar slides over.
export type ActivitySidebarSide = (typeof activitySidebarSides)[number]

const panePaddings = ['padded', 'none'] as const

// Whether each Pane keeps its terminal's text off its edges and dividers, by a fixed amount, or lets it run up to them.
export type PanePadding = (typeof panePaddings)[number]

const paneScrollBars = ['none', 'visible'] as const

// Whether each Pane shows a scroll bar, or leaves its room to the terminal.
export type PaneScrollBar = (typeof paneScrollBars)[number]

const shellOnQuits = ['keepRunning', 'end'] as const

// What the app quitting does to the Shells: leaves them running, for the app to show again as it launches, or ends them.
export type ShellOnQuit = (typeof shellOnQuits)[number]

const backgroundEffects = ['blur', 'none'] as const

// What a Session window's background shows behind it: a blur of what's there, or what's there as good as unblurred.
export type BackgroundEffect = (typeof backgroundEffects)[number]

// The blur radius's bounds. Never 0, which is reported to stop macOS blurring the window for good; see
// docs/adr/0003-blur-through-a-private-macos-api.md.
export const minimumBlurRadius = 1
export const maximumBlurRadius = 64

// What `unlimited` scrollback keeps: the terminal sets its buffer aside up front, so it can't be truly unbounded.
export const unlimitedScrollbackLines = 1_000_000

// What the config file sets, each setting at its default unless the file gives it a valid value. Settings are grouped by
// the glossary term they act on, one level deep, and a setting that is a term's whole choice, such as which Theme, goes
// by the term's name as a plain value; see docs/adr/0004-settings-grouped-by-glossary-term.md.
export interface Settings {
  session: {
    cycleOrder: CycleOrder;
    withoutNameOrRootOnClose: SessionsWithoutNameOrRootOnClose;
  };
  tab: {
    startDirectory: StartDirectory;
    renameSuggestion: TabRenameSuggestion;
  };
  hiddenTab: {
    returnPosition: HiddenTabReturnPosition;
  };
  pane: {
    // How many lines of each Pane's scrollback are kept, `unlimited` read as `unlimitedScrollbackLines`.
    scrollbackLines: number;
    // Where the new Pane of a split starts.
    startDirectory: StartDirectory;
    padding: PanePadding;
    scrollBar: PaneScrollBar;
  };
  shell: {
    // The program each new Pane's Shell runs; absent for the user's login shell.
    program?: string;
    onQuit: ShellOnQuit;
  };
  loginLaunch: {
    start: LoginLaunchStart;
    withNoOpenSessions: LoginLaunchWithNoOpenSessions;
  };
  // Whether cycling Open Sessions shows the Session Banner.
  sessionBanner: boolean;
  commandPalette: {
    sessionSearchOrder: SessionSearchOrder;
    tabSearchScope: TabSearchScope;
    paneSearchScope: PaneSearchScope;
    nesting: PaletteNesting;
    // Whether Sessions, Tabs and Panes show their kind's marker before their names, while nesting isn't hidden.
    kindMarkers: boolean;
  };
  activity: {
    sound: ActivitySound;
    ring: ActivityRing;
  };
  activitySidebar: {
    side: ActivitySidebarSide;
  };
  // The name of the Theme in effect, built in or from a Theme file.
  theme: string;
  background: {
    // How transparent a Session window's background is, in percent: 0 is opaque.
    transparency: number;
    effect: BackgroundEffect;
    // How strongly `blur` blurs, from `minimumBlurRadius` to `maximumBlurRadius`.
    blurRadius: number;
  };
  menuBarIcon: MenuBarIcon;
  // Each action's shortcut; null for an unbound action.
  keyBindings: Record<BoundAction, Shortcut | null>;
}

export const defaultSettings: Settings = {
  session: {
    cycleOrder: 'alphabetical',
    withoutNameOrRootOnClose: 'keep',
  },
  tab: {
    startDirectory: 'root',
    renameSuggestion: 'claude',
  },
  hiddenTab: {
    returnPosition: 'end',
  },
  pane: {
    scrollbackLines: 10_000,
    startDirectory: 'current',
    padding: 'padded',
    scrollBar: 'none',
  },
  shell: {
    onQuit: 'keepRunning',
  },
  loginLaunch: {
    start: 'hidden',
    withNoOpenSessions: 'hotkey',
  },
  sessionBanner: true,
  commandPalette: {
    sessionSearchOrder: 'openFirst',
    tabSearchScope: 'all',
    paneSearchScope: 'all',
    nesting: 'flat',
    kindMarkers: false,
  },
  activity: {
    sound: 'Purr',
    ring: 'whileHidden',
  },
  activitySidebar: {
    side: 'right',
  },
  theme: defaultTheme.name,
  background: {
    transparency: 25,
    effect: 'blur',
    blurRadius: 15,
  },
  menuBarIcon: 'monochrome',
  keyBindings: Object.fromEntries(
    Object.entries(defaultKeyBindings).map(([action, shortcut]) => [action, shortcut && parseShortcut(shortcut)!])
  ) as Settings['keyBindings'],
}

const invalid = Symbol('invalid')

// A setting's value read from the config file, or `invalid`. A setting made of entries rejects the invalid ones by
// their names within it and keeps the rest.
type SettingParser<Value> = (value: unknown, rejectEntry: (entry: string) => void) => Value | typeof invalid

type SettingParsers<Group> = { [Name in keyof Group]-?: SettingParser<Group[Name]> }

// A group of settings, each at its default unless the group gives it a valid value. A setting the group gets wrong, or
// that doesn't exist, is rejected by name, and the rest are kept; one rejecting entries of its own rejects them by
// their names within it, after its own name and a dot.
function groupOf<Group extends object> (defaults: Group, parsers: SettingParsers<Group>): SettingParser<Group> {
  return (value, rejectEntry) => {
    if (!isObject(value)) return invalid
    const group = { ...defaults }
    for (const [name, entry] of Object.entries(value)) {
      const parsed = Object.hasOwn(parsers, name)
        ? parsers[name as keyof Group](entry, (inner) => rejectEntry(`${name}.${inner}`))
        : invalid
      if (parsed === invalid) rejectEntry(name)
      else Object.assign(group, { [name]: parsed })
    }
    return group
  }
}

function oneOf<const Values extends readonly string[]> (values: Values): SettingParser<Values[number]> {
  return (value) => (values.includes(value as string) ? (value as Values[number]) : invalid)
}

function wholeNumberFrom (minimum: number, maximum: number): SettingParser<number> {
  return (value) =>
    Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum ? (value as number) : invalid
}

// The theme setting takes the name of one of the Themes loaded.
const settingParsers = (themeNames: readonly string[]): SettingParsers<Settings> => ({
  session: groupOf(defaultSettings.session, {
    cycleOrder: oneOf(cycleOrders),
    withoutNameOrRootOnClose: oneOf(sessionsWithoutNameOrRootOnCloseBehaviours),
  }),
  tab: groupOf(defaultSettings.tab, {
    startDirectory: oneOf(startDirectories),
    renameSuggestion: oneOf(tabRenameSuggestions),
  }),
  hiddenTab: groupOf(defaultSettings.hiddenTab, {
    returnPosition: oneOf(hiddenTabReturnPositions),
  }),
  pane: groupOf(defaultSettings.pane, {
    scrollbackLines: (value) => {
      if (value === 'unlimited') return unlimitedScrollbackLines
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= unlimitedScrollbackLines
        ? (value as number)
        : invalid
    },
    startDirectory: oneOf(startDirectories),
    padding: oneOf(panePaddings),
    scrollBar: oneOf(paneScrollBars),
  }),
  shell: groupOf(defaultSettings.shell, {
    program: (value) => (typeof value === 'string' && value.trim() !== '' ? value : invalid),
    onQuit: oneOf(shellOnQuits),
  }),
  loginLaunch: groupOf(defaultSettings.loginLaunch, {
    start: oneOf(loginLaunchStarts),
    withNoOpenSessions: oneOf(loginLaunchesWithNoOpenSessions),
  }),
  sessionBanner: (value) => (typeof value === 'boolean' ? value : invalid),
  commandPalette: groupOf(defaultSettings.commandPalette, {
    sessionSearchOrder: oneOf(sessionSearchOrders),
    tabSearchScope: oneOf(tabSearchScopes),
    paneSearchScope: oneOf(paneSearchScopes),
    nesting: oneOf(paletteNestings),
    kindMarkers: (value) => (typeof value === 'boolean' ? value : invalid),
  }),
  activity: groupOf(defaultSettings.activity, {
    // Matched ignoring case, taking the sound's spelling.
    sound: (value) =>
      activitySounds.find((sound) => typeof value === 'string' && sound.toLowerCase() === value.toLowerCase()) ??
      invalid,
    ring: oneOf(activityRings),
  }),
  activitySidebar: groupOf(defaultSettings.activitySidebar, {
    side: oneOf(activitySidebarSides),
  }),
  // Theme names are unique ignoring case, so the setting matches one ignoring case and takes its spelling.
  theme: (value) =>
    themeNames.find((name) => typeof value === 'string' && name.toLowerCase() === value.toLowerCase()) ?? invalid,
  background: groupOf(defaultSettings.background, {
    transparency: wholeNumberFrom(0, 100),
    effect: oneOf(backgroundEffects),
    blurRadius: wholeNumberFrom(minimumBlurRadius, maximumBlurRadius),
  }),
  menuBarIcon: oneOf(menuBarIcons),
  keyBindings: parseKeyBindings,
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
      rejectEntry(action)
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
    session: {
      description: 'How Open Sessions are cycled through, and what closing a Session keeps.',
      type: 'object',
      additionalProperties: false,
      properties: {
        cycleOrder: {
          description:
            'The order Open Sessions are cycled through and listed in: by name, by most recent use, or by creation.',
          enum: cycleOrders,
          default: defaultSettings.session.cycleOrder,
        },
        withoutNameOrRootOnClose: {
          description:
            'What closing a Session with neither a name nor a Root directory does: keep it as a Closed Session, or delete it. Quitting closes every Open Session, and delete also deletes such Closed Sessions then.',
          enum: sessionsWithoutNameOrRootOnCloseBehaviours,
          default: defaultSettings.session.withoutNameOrRootOnClose,
        },
      },
    },
    tab: {
      description: 'Where new Tabs start, and what renaming one suggests.',
      type: 'object',
      additionalProperties: false,
      properties: {
        startDirectory: {
          description:
            "Where a new Tab starts: root is the Session's Root directory, or the Current Pane's working directory without one; current is the Current Pane's working directory; home is the home directory. A Session reopened with no Tabs starts its Tab at the home directory for home, and otherwise at its Root directory, or the home directory without one.",
          enum: startDirectories,
          default: defaultSettings.tab.startDirectory,
        },
        renameSuggestion: {
          description:
            "Whose Program Title Rename Tab suggests, from the program running in the Current Pane: claude suggests Claude Code's, which follows its /rename; all suggests any program's. When the program has none, Rename Tab suggests the Tab's current title.",
          enum: tabRenameSuggestions,
          default: defaultSettings.tab.renameSuggestion,
        },
      },
    },
    hiddenTab: {
      description: 'Where a Hidden Tab goes when it comes back to the Tab bar.',
      type: 'object',
      additionalProperties: false,
      properties: {
        returnPosition: {
          description:
            'Where a Hidden Tab goes as it becomes the Current Tab again: end puts it after the other Tabs, as a new Tab is, and it stays there; original puts it back at its place among them.',
          enum: hiddenTabReturnPositions,
          default: defaultSettings.hiddenTab.returnPosition,
        },
      },
    },
    pane: {
      description: "Each Pane's scrollback and look, and where a split's new Pane starts.",
      type: 'object',
      additionalProperties: false,
      properties: {
        scrollbackLines: {
          description: `How many lines of each Pane's scrollback are kept and restored, up to ${unlimitedScrollbackLines.toLocaleString('en-GB')}; "unlimited" keeps that many.`,
          default: defaultSettings.pane.scrollbackLines,
          oneOf: [
            { type: 'integer', minimum: 0, maximum: unlimitedScrollbackLines },
            { const: 'unlimited' },
          ],
        },
        startDirectory: {
          description:
            "Where the new Pane of a split starts: root is the Session's Root directory, or the split Pane's working directory without one; current is the split Pane's working directory; home is the home directory.",
          enum: startDirectories,
          default: defaultSettings.pane.startDirectory,
        },
        padding: {
          description:
            'Whether each Pane keeps its text off its edges and the dividers next to it: padded leaves 7px at its sides and 5px at its top and bottom; none lets the text run up to them.',
          enum: panePaddings,
          default: defaultSettings.pane.padding,
        },
        scrollBar: {
          description:
            "Whether each Pane shows a scroll bar: none hides it, and the terminal takes its room; visible shows a thin bar in the Theme's colours at the Pane's right edge. Scrolling works either way.",
          enum: paneScrollBars,
          default: defaultSettings.pane.scrollBar,
        },
      },
    },
    shell: {
      description: "The program each Pane's Shell runs, and what quitting Blind does to the Shells.",
      type: 'object',
      additionalProperties: false,
      properties: {
        program: {
          type: 'string',
          minLength: 1,
          description: "The program each new Pane's Shell runs, as a login shell. Defaults to your login shell ($SHELL).",
        },
        onQuit: {
          description:
            "What quitting Blind does to the Shells: keepRunning leaves every Shell running, and Blind shows each as it was the next time it starts, unless the OS restarts meanwhile; the Command Palette's and the Menu Bar Icon's Quit and End Shells ends them. end ends every Shell, and Sessions come back with fresh Shells. A change takes effect at the next quit.",
          enum: shellOnQuits,
          default: defaultSettings.shell.onQuit,
        },
      },
    },
    loginLaunch: {
      description: 'How Blind starts on its own when you log in to macOS.',
      type: 'object',
      additionalProperties: false,
      properties: {
        start: {
          description:
            'How the Login Launch starts: hidden until the Hotkey shows the app, or shown, as a launch by hand does.',
          enum: loginLaunchStarts,
          default: defaultSettings.loginLaunch.start,
        },
        withNoOpenSessions: {
          description:
            'What a hidden Login Launch with no Open Sessions opens: a new Session, which the first Hotkey press shows, or nothing, leaving it to the first Hotkey press, which opens a new Session.',
          enum: loginLaunchesWithNoOpenSessions,
          default: defaultSettings.loginLaunch.withNoOpenSessions,
        },
      },
    },
    sessionBanner: {
      description: 'Whether cycling Open Sessions shows the Session Banner, naming the Session in the middle of its window.',
      type: 'boolean',
      default: defaultSettings.sessionBanner,
    },
    commandPalette: {
      description: 'What the Command Palette lists, and in what order.',
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionSearchOrder: {
          description:
            "The order the Command Palette lists Sessions in when the query starts with ss: openFirst lists the Open Sessions before the Closed ones, cycle lists them together; each by session.cycleOrder, or by how well they match once there's a search.",
          enum: sessionSearchOrders,
          default: defaultSettings.commandPalette.sessionSearchOrder,
        },
        tabSearchScope: {
          description:
            "Whose Tabs the Command Palette lists when the query starts with tt: all lists every Open Session's, currentSession the Current Session's alone. A query without a prefix lists every Open Session's either way.",
          enum: tabSearchScopes,
          default: defaultSettings.commandPalette.tabSearchScope,
        },
        paneSearchScope: {
          description:
            "Whose Panes the Command Palette lists when the query starts with pp: all lists every Open Session's, currentSession the Current Session's alone, currentTab the Current Tab's alone. A query without a prefix lists every Open Session's either way.",
          enum: paneSearchScopes,
          default: defaultSettings.commandPalette.paneSearchScope,
        },
        nesting: {
          description:
            "How the Command Palette lists Tabs and Panes when nothing is typed: flat lists every Tab, then every Pane, after the Sessions; nested lists each Open Session's Tabs under it and each Tab's Panes under the Tab, leaving out a Session's only Tab and a Tab's only Pane; hidden lists none, leaving them to a search. Searching, and the ss, tt and pp prefixes, list them flat either way.",
          enum: paletteNestings,
          default: defaultSettings.commandPalette.nesting,
        },
        kindMarkers: {
          description:
            'Whether the Command Palette marks Sessions, Tabs and Panes with Ⓢ, Ⓣ and Ⓟ before their names. Only while nesting is flat or nested; hidden shows none, even when searching.',
          type: 'boolean',
          default: defaultSettings.commandPalette.kindMarkers,
        },
      },
    },
    activity: {
      description: 'The sound played when a Pane gains Activity, and when it plays.',
      type: 'object',
      additionalProperties: false,
      properties: {
        sound: {
          description:
            "The macOS system sound played when a Pane gains Activity. The Command Palette's Change Activity Sound sets it too, playing each sound as it's browsed.",
          enum: activitySounds,
          default: defaultSettings.activity.sound,
        },
        ring: {
          description:
            "When a Pane gaining Activity plays activity.sound: always plays it whether Blind is shown or hidden; whileHidden only while Blind is hidden; never doesn't play it. A Pane plays it once as it gains Activity, and again only once its Activity has cleared.",
          enum: activityRings,
          default: defaultSettings.activity.ring,
        },
      },
    },
    activitySidebar: {
      description:
        "The list of the Panes with Activity across every Open Session, which the toggleActivitySidebar key binding, Cmd+B by default, or the Command Palette's Toggle Activity Sidebar slides over the Current Session's window.",
      type: 'object',
      additionalProperties: false,
      properties: {
        side: {
          description: "The side of the Current Session's window the Activity Sidebar slides over.",
          enum: activitySidebarSides,
          default: defaultSettings.activitySidebar.side,
        },
      },
    },
    theme: {
      description:
        "The Theme's name: one built in, or one from a Theme file in the themes folder next to this file. The Command Palette's Change Theme sets it too.",
      type: 'string',
      minLength: 1,
      default: defaultSettings.theme,
      examples: builtInThemes.map((theme) => theme.name),
    },
    background: {
      description: "What a Session's window shows behind its terminal.",
      type: 'object',
      additionalProperties: false,
      properties: {
        transparency: {
          description:
            "How transparent a Session window's background, the Theme's terminal background, is, in percent: 0 is opaque, 100 shows only what background.effect makes of what's behind the window. The Command Palette and the Session Banner keep their own colours.",
          type: 'integer',
          minimum: 0,
          maximum: 100,
          default: defaultSettings.background.transparency,
        },
        effect: {
          description:
            "What a Session window shows through its background: blur blurs what's behind the window, by background.blurRadius; none shows it as good as unblurred, at the lightest blur macOS allows without turning blur off for good.",
          enum: backgroundEffects,
          default: defaultSettings.background.effect,
        },
        blurRadius: {
          description: `How strongly background.effect blur blurs, from ${minimumBlurRadius} to ${maximumBlurRadius}. Ignored when background.effect is none.`,
          type: 'integer',
          minimum: minimumBlurRadius,
          maximum: maximumBlurRadius,
          default: defaultSettings.background.blurRadius,
        },
      },
    },
    menuBarIcon: {
      description:
        "The Menu Bar Icon: monochrome follows the menu bar's colour, light or dark; colour keeps the icon's own colours. The Command Palette's Change Menu Bar Icon sets it too.",
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
  // A setting in a group by its group's name and its own, joined by a dot, such as `pane.scrollBar`.
  rejected: string[];
}

// The settings in the config file's text, or the defaults without a file; undefined when the text isn't a JSON object,
// comments allowed. Editors read `$schema`, so it's no setting. The theme setting names one of `themeNames`.
export function parseConfig (text: string | undefined, themeNames: readonly string[]): ParsedConfig | undefined {
  const config = text === undefined ? {} : readJsonc(text)
  if (config === undefined) return undefined
  const rejected: string[] = []
  const settings = groupOf(defaultSettings, settingParsers(themeNames))(
    Object.fromEntries(Object.entries(config).filter(([name]) => name !== '$schema')),
    (entry) => rejected.push(entry)
  ) as Settings
  return { settings, rejected }
}
