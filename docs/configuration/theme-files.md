# Theme files

Besides the built-in Themes (see [Appearance](../features/appearance.md#themes)), blind takes any Theme you keep as a Theme file in the themes folder, `~/.config/blind/themes/`, next to the [config file](config-file.md). Write one by hand, or make one from another terminal's theme with [Import Theme](#importing-a-theme).

## Writing a Theme file

A Theme file is a `.jsonc` file in the themes folder: JSON with comments allowed. It needs a `name`, which no other Theme has, ignoring case; the Change Theme action lists it by that name, and the [`theme`](settings.md#theme) setting takes it. Anything else it leaves out takes the Default Theme's value, so a Theme file can change as little as one colour:

```jsonc
{
  "$schema": "./theme.schema.json",
  "name": "Midnight",
  "terminal": { "background": "#0b1021", "foreground": "#d8dee9" },
  "chrome": { "accent": "#88c0d0" }
}
```

blind writes the Theme file's JSON schema, `theme.schema.json`, to the themes folder every time it starts. Name it in `$schema`, as above, and an editor that reads `$schema`, such as VS Code, suggests every field with its default and flags a value it can't take.

blind watches the folder, so a Theme file takes effect as you save it, and a new one shows in Change Theme straight away.

A file that isn't JSON with comments, has no `name`, or has another Theme's name is skipped; a field with a value it can't take is at the Default Theme's value. A notification names either.

## What a Theme covers

A Theme colours both the terminal and blind's own chrome. Colours are `#rrggbb`, or `#rrggbbaa` with an alpha.

- `font`: the terminal's `family`, an installed font, and its `size`, from `6` to `72`.
- `cursor`: its `style`, `block`, `bar` or `underline`, and whether it should `blink`.
- `terminal`: the `foreground` and `background`, the `cursor` and the character under a block cursor (`cursorText`), the `selection` and its text (`selectionText`), and the 16 ANSI colours, `black` to `white` and `brightBlack` to `brightWhite`. The background is as transparent as [`background.transparency`](settings.md#backgroundtransparency) says.
- `chrome`: the Tab bar, Tab dividers, Command Palette, Activity Sidebar, Session Banner, Pane dividers and the Bezel around the window. `divider` sits above the Tab bar and around the Tabs that aren't focused, and the Pane dividers, Tab dividers and Bezel take a stronger mix of it; `tabText` is the Tabs' text; `accent` fills the focused Tab and outlines the Session's label, with `accentText` on it; `sessionBannerBackground` and `sessionBannerText` colour the Session Banner; `paletteBackground`, `paletteBorder`, `paletteText`, `paletteMutedText` and `paletteSelection` colour the Command Palette; `activity` fills the dot marking [Activity](../features/activity.md).

## Importing a Theme

The Import Theme action, in the [Command Palette](../features/command-palette.md), makes a Theme file from a file in which another terminal keeps its colours:

- an iTerm2 `.itermcolors` file
- a Ghostty theme
- a Kitty `.conf`
- an Alacritty `.toml`
- a Windows Terminal colour scheme

Pick the file, and blind shows the Theme it makes: a sample in its colours, its 16 ANSI colours, its main chrome colours, and the name of the file it will be saved as. Enter saves it to the themes folder, and Escape cancels. The Theme is named after the file it came from, without its extension, and its chrome colours come from its terminal colours. Change Theme lists it once saved.

Import refuses a file that isn't one of those themes, such as a Windows Terminal `settings.json`; one that leaves out colours the rest are drawn from, naming them as the file does; and one whose name another Theme, or another file in the themes folder, already has, ignoring case. Rename such a file and import it again; Enter picks another file.

From the terminal: [`blind themes import <file>`](../blind-command/themes-import.md) imports a Theme the same way, without showing it first.
