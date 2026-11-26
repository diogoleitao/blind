# Command Palette

`Cmd+K` opens the Command Palette, which fuzzy-searches every Session, Tab and Pane, and every action. Choose a Session, Tab or Pane to jump to it, or an action to run it. Every action blind has is here, including those with no shortcut.

## Searching only Sessions, Tabs or Panes

Start the query with `ss`, `tt` or `pp` to search only Sessions, Tabs or Panes.

- `ss` lists Open Sessions before Closed ones.
- `tt` and `pp` search every Open Session.

## Nesting

Before you type, the Command Palette lists every Tab, then every Pane, after the Sessions. It can instead list each Open Session's Tabs under it and each Tab's Panes under the Tab, or list only Sessions and actions until you type. Searching, and the `ss`, `tt` and `pp` prefixes, list them flat either way.

## Kind markers

The Command Palette can mark Sessions, Tabs and Panes with Ⓢ, Ⓣ and Ⓟ before their names, unless [`commandPalette.nesting`](../configuration/settings.md#commandpalettenesting) is `hidden`.

## Moving it

Drag the Command Palette by its edge to move it up or down. Every Session's window opens it there, even after a restart, until the Reset Command Palette Position action puts it back.

## Settings

- [`commandPalette.sessionSearchOrder`](../configuration/settings.md#commandpalettesessionsearchorder): whether `ss` lists Open Sessions before Closed ones.
- [`commandPalette.tabSearchScope`](../configuration/settings.md#commandpalettetabsearchscope): whose Tabs `tt` searches.
- [`commandPalette.paneSearchScope`](../configuration/settings.md#commandpalettepanesearchscope): whose Panes `pp` searches.
- [`commandPalette.nesting`](../configuration/settings.md#commandpalettenesting): how the Command Palette lists Tabs and Panes before you type.
- [`commandPalette.kindMarkers`](../configuration/settings.md#commandpalettekindmarkers): whether Sessions, Tabs and Panes are marked with Ⓢ, Ⓣ and Ⓟ.
