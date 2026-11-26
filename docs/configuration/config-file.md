# Config file

Every setting lives in one file, `~/.config/blind/config.jsonc`: JSON with comments allowed. The Open Settings action, in the [Command Palette](../features/command-palette.md) and the [Menu Bar Icon](../features/menu-bar-icon.md)'s menu, opens it in the app macOS opens `.jsonc` files with, creating it first if it's missing, or shows it in Finder when no app opens them.

From the terminal: [`blind settings open`](../blind-command/settings.md#blind-settings-open) opens it in `$EDITOR`, or in its default app without one, creating it first if it's missing.

A setting the file leaves out is at its default, so the file only needs what you change.

## Running from the repo

blind run from the repo with `npm run dev` or `blind dev` keeps its config file and [themes folder](theme-files.md) in `~/.config/blind-dev/` instead, apart from the installed app's, so the two never share settings.

## Changes apply on save

blind watches the file and applies each change as you save it; there's nothing to restart.

A setting given a value it can't take, or that doesn't exist, is at its default, and a notification names it. A file that isn't JSON with comments leaves every setting as it was, and a notification says so.

## Autocomplete in your editor

blind writes the file's JSON schema, `config.schema.json`, next to it every time it starts, so it always matches the version you're running. A new config file names it in `$schema`:

```jsonc
{
  // Your editor suggests every setting and its default from the schema.
  "$schema": "./config.schema.json"
}
```

An editor that reads `$schema`, such as VS Code, then suggests every setting with its description and default, and flags a value the setting can't take.

## Groups and dotted names

Settings are grouped by what they act on, such as `pane` or `commandPalette`, and the docs name a setting by its group and its name joined by a dot, such as `pane.scrollBar` ([ADR 0004](../adr/0004-settings-grouped-by-glossary-term.md)). In the file, that is the setting inside its group:

```jsonc
{
  "$schema": "./config.schema.json",
  "pane": { "scrollBar": "visible" },
  "theme": "Tokyo Night"
}
```

A few settings, such as `theme`, are in no group and go by their name alone.

## References

- [Settings](settings.md): every setting, with its values and default.
- [Key bindings](key-bindings.md): every action's shortcut, and how to rebind it under `keyBindings`.
