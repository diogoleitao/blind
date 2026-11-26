# `blind settings`

In the app: `blind settings` changes the settings listed on the [Settings](../configuration/settings.md) page, and `blind settings open` opens the config file as the Open Settings action does, but differently: the command opens it in `$EDITOR`, and in its default app only without one, while the action opens it in its default app, or shows it in Finder when no app opens `.jsonc` files (see [Config file](../configuration/config-file.md)).

## Changing settings

`blind settings` lists every setting but `keyBindings` with its value and description, each group's under a heading of its name, and changes them as you go:

- Arrow keys move and pick values.
- Enter types a number, or the [`shell.program`](../configuration/settings.md#shellprogram) setting.

Settings changed since the editor opened show in bold yellow with a `*`.

## Saving or discarding changes

Quit with `q` or Escape to save your changes, and a running Blind applies them then. Ctrl+C quits without saving them.

Quitting lists the settings you changed, by group and setting joined by a dot, with their old and new values. After Ctrl+C they are listed under `Discarded:`.

## `blind settings open`

`blind settings open` opens the config file, `~/.config/blind/config.jsonc`, in `$EDITOR`, or in its default app without one, creating it first if it's missing.
