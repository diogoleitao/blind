# Command Palette

`Cmd+K` opens the Command Palette, which fuzzy-searches every Session, Tab and Pane, and every action. Choose a Session, Tab or Pane to jump to it, or an action to run it. Every action blind has is here, including those with no shortcut.

## Searching only Sessions, Tabs or Panes

Start the query with `ss`, `tt` or `pp` to search only Sessions, Tabs or Panes.

- `ss` lists Open Sessions before Closed ones.
- `tt` and `pp` search every Open Session.

## Nesting

Before you type, the Command Palette lists every Tab, then every Pane, after the Sessions. It can instead list each Open Session's Tabs under it and each Tab's Panes under the Tab, or list only Sessions and actions until you type. Searching, and the `ss`, `tt` and `pp` prefixes, list them flat either way.

## Kind markers

The Command Palette can mark Sessions, Tabs and Panes with Ⓢ, Ⓣ and Ⓟ before their names, unless `commandPalette.nesting` is `hidden`.

## Moving it

Drag the Command Palette by its edge to move it up or down. Every Session's window opens it there, even after a restart, until the Reset Command Palette Position action puts it back.

## Settings

- `commandPalette.sessionSearchOrder`: `openFirst`, the default, has `ss` list Open Sessions before Closed ones; `cycle` lists them together.
- `commandPalette.tabSearchScope`: `all`, the default, has `tt` search every Open Session's Tabs; `currentSession` searches only the Current Session's.
- `commandPalette.paneSearchScope`: `all`, the default, has `pp` search every Open Session's Panes; `currentSession` searches only the Current Session's, and `currentTab` only the Current Tab's.
- `commandPalette.nesting`: `flat`, the default, lists every Tab, then every Pane, after the Sessions; `nested` lists each Open Session's Tabs under it and each Tab's Panes under the Tab; `hidden` lists only Sessions and actions until you type.
- `commandPalette.kindMarkers`: `true` marks Sessions, Tabs and Panes with Ⓢ, Ⓣ and Ⓟ; `false`, the default, doesn't.
