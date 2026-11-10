import { type BoundAction, defaultKeyBindings, parseShortcut, sameShortcut, type Shortcut } from "./key-bindings";

const cycleOrders = ["alphabetical", "recent", "created"] as const;

// The order Open Sessions are cycled through: by name, by most recent use, or by creation.
export type CycleOrder = (typeof cycleOrders)[number];

const hotkeyBehaviours = ["new", "palette"] as const;

// What the Hotkey shows with no Open Sessions: a new Session, or the Command Palette on its own.
export type HotkeyWithNoOpenSessions = (typeof hotkeyBehaviours)[number];

// What `unlimited` scrollback keeps: the terminal sets its buffer aside up front, so it can't be truly unbounded.
export const unlimitedScrollbackLines = 1_000_000;

// What the config file sets, each setting at its default unless the file gives it a valid value.
export interface Settings {
  // The program each new Pane's Shell runs; absent for the user's login shell.
  shell?: string;
  // How many lines of each Pane's scrollback are kept, `unlimited` read as `unlimitedScrollbackLines`.
  scrollbackLines: number;
  cycleOrder: CycleOrder;
  hotkeyWithNoOpenSessions: HotkeyWithNoOpenSessions;
  // Each action's shortcut; null for an unbound action.
  keyBindings: Record<BoundAction, Shortcut | null>;
}

export const defaultSettings: Settings = {
  scrollbackLines: 10_000,
  cycleOrder: "alphabetical",
  hotkeyWithNoOpenSessions: "new",
  keyBindings: Object.fromEntries(
    Object.entries(defaultKeyBindings).map(([action, shortcut]) => [action, shortcut && parseShortcut(shortcut)!]),
  ) as Settings["keyBindings"],
};

const invalid = Symbol("invalid");

// A setting's value read from the config file, or `invalid`. A setting made of entries rejects the invalid ones by
// name and keeps the rest.
type SettingParser<Value> = (value: unknown, rejectEntry: (entry: string) => void) => Value | typeof invalid;

function oneOf<const Values extends readonly string[]>(values: Values): SettingParser<Values[number]> {
  return (value) => (values.includes(value as string) ? (value as Values[number]) : invalid);
}

const settingParsers: { [Name in keyof Settings]-?: SettingParser<Settings[Name]> } = {
  shell: (value) => (typeof value === "string" && value.trim() !== "" ? value : invalid),
  scrollbackLines: (value) => {
    if (value === "unlimited") return unlimitedScrollbackLines;
    return Number.isInteger(value) && 0 <= (value as number) && (value as number) <= unlimitedScrollbackLines
      ? (value as number)
      : invalid;
  },
  cycleOrder: oneOf(cycleOrders),
  hotkeyWithNoOpenSessions: oneOf(hotkeyBehaviours),
  keyBindings: parseKeyBindings,
};

// The defaults with each configured action's shortcut, or null, in place. A configured shortcut is taken away from the
// action bound to it by default; one already configured for another action is rejected.
function parseKeyBindings(value: unknown, rejectEntry: (entry: string) => void) {
  if (!isObject(value)) return invalid;
  const configured: Partial<Settings["keyBindings"]> = {};
  const isConfigured = (shortcut: Shortcut | null | undefined) =>
    Object.values(configured).some((other) => other && shortcut && sameShortcut(other, shortcut));
  for (const [action, text] of Object.entries(value)) {
    const shortcut = typeof text === "string" ? parseShortcut(text) : text === null ? null : undefined;
    if (!Object.hasOwn(defaultKeyBindings, action) || shortcut === undefined || isConfigured(shortcut)) {
      rejectEntry(`keyBindings.${action}`);
    } else {
      configured[action as BoundAction] = shortcut;
    }
  }
  const defaults = Object.entries(defaultSettings.keyBindings).map(([action, shortcut]) => [
    action,
    isConfigured(shortcut) ? null : shortcut,
  ]);
  return { ...Object.fromEntries(defaults), ...configured } as Settings["keyBindings"];
}

// The JSON schema of the config file, which the file names in `$schema` so editors validate and autocomplete it.
export const configSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Blind settings",
  type: "object",
  properties: {
    $schema: { type: "string" },
    shell: {
      type: "string",
      minLength: 1,
      description: "The program each new Pane's Shell runs, as a login shell. Defaults to your login shell ($SHELL).",
    },
    scrollbackLines: {
      description: `How many lines of each Pane's scrollback are kept and restored, up to ${unlimitedScrollbackLines.toLocaleString("en-GB")}; "unlimited" keeps that many.`,
      default: defaultSettings.scrollbackLines,
      oneOf: [
        { type: "integer", minimum: 0, maximum: unlimitedScrollbackLines },
        { const: "unlimited" },
      ],
    },
    cycleOrder: {
      description: "The order Open Sessions are cycled through and listed in: by name, by most recent use, or by creation.",
      enum: cycleOrders,
      default: defaultSettings.cycleOrder,
    },
    hotkeyWithNoOpenSessions: {
      description: "What the Hotkey shows when there are no Open Sessions: a new Session, or the Command Palette on its own.",
      enum: hotkeyBehaviours,
      default: defaultSettings.hotkeyWithNoOpenSessions,
    },
    keyBindings: {
      description:
        'Each action\'s shortcut, such as "Cmd+Shift+D": modifiers (Cmd, Shift, Alt or Option, Ctrl) and one key or key name (Left, Right, Up, Down, Enter, Tab, Space, Backspace, Delete, Escape, Home, End, PageUp, PageDown, Plus, F1 to F20), joined by "+". Cmd or Ctrl is required. null unbinds an action; a shortcut given here is taken away from the action it is bound to by default.',
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(defaultKeyBindings).map(([action, shortcut]) => [
          action,
          { type: ["string", "null"], default: shortcut },
        ]),
      ),
    },
  },
  additionalProperties: false,
} as const;

export interface ParsedConfig {
  settings: Settings;
  // The settings the file gave invalid values, or that don't exist.
  rejected: string[];
}

// The settings in the config file's text, or the defaults without a file; undefined when the text isn't a JSON object,
// comments allowed. Editors read `$schema`, so it's no setting.
export function parseConfig(text: string | undefined): ParsedConfig | undefined {
  const settings = { ...defaultSettings };
  const rejected: string[] = [];
  const config = text === undefined ? {} : readJsonc(text);
  if (config === undefined) return undefined;
  for (const [name, value] of Object.entries(config)) {
    if (name === "$schema") continue;
    const parsed = Object.hasOwn(settingParsers, name)
      ? settingParsers[name as keyof Settings](value, (entry) => rejected.push(entry))
      : invalid;
    if (parsed === invalid) rejected.push(name);
    else Object.assign(settings, { [name]: parsed });
  }
  return { settings, rejected };
}

// The JSON object the text holds, comments allowed, or undefined if it holds something else or isn't JSON.
function readJsonc(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stripJsonc(text));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text as plain JSON: comments become spaces and commas before a closing bracket or brace are dropped, outside
// strings.
function stripJsonc(text: string) {
  let json = "";
  let position = 0;
  while (position < text.length) {
    const character = text[position];
    if (character === '"') {
      const end = stringEnd(text, position);
      json += text.slice(position, end);
      position = end;
    } else if (text.startsWith("//", position) || text.startsWith("/*", position)) {
      const end = commentEnd(text, position);
      json += " ";
      position = end;
    } else if (character === "," && "]}".includes(text[nextToken(text, position + 1)] ?? "?")) {
      position += 1;
    } else {
      json += character;
      position += 1;
    }
  }
  return json;
}

// Just past the string starting at `start`, skipping escaped quotes; the end of the text if it never closes.
function stringEnd(text: string, start: number) {
  let position = start + 1;
  while (position < text.length && text[position] !== '"') position += text[position] === "\\" ? 2 : 1;
  return Math.min(position + 1, text.length);
}

// Just past the comment starting at `start`: a line comment runs to the end of its line.
function commentEnd(text: string, start: number) {
  if (text.startsWith("//", start)) {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  const end = text.indexOf("*/", start + 2);
  return end === -1 ? text.length : end + 2;
}

// The position of the next character that isn't whitespace or part of a comment.
function nextToken(text: string, start: number) {
  let position = start;
  while (position < text.length) {
    if (/\s/.test(text[position])) position += 1;
    else if (text.startsWith("//", position) || text.startsWith("/*", position)) position = commentEnd(text, position);
    else break;
  }
  return position;
}
