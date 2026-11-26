# Tabs and Panes

Each Session holds Tabs, and each Tab holds one or more Panes, each running its own Shell. Splits nest without limit.

## Keys and actions

| Key | Action |
| --- | --- |
| `Cmd+T` | New Tab |
| `Cmd+D` | Split Pane Vertically |
| `Cmd+Shift+D` | Split Pane Horizontally |
| `Cmd+W` | Close Pane |
| `Cmd+1` to `Cmd+9` | Go to the Tab at that position |
| `Cmd+Right`, `Cmd+Left` | Next Tab, Previous Tab |
| `Cmd+]`, `Cmd+[` | Next Pane, Previous Pane |
| `Cmd+Alt+Left`, `Cmd+Alt+Right`, `Cmd+Alt+Up`, `Cmd+Alt+Down` | Focus Pane Left, Focus Pane Right, Focus Pane Above, Focus Pane Below |

Rename Tab and Clear Tab Title have no shortcut by default; run them from the [Command Palette](command-palette.md).

Splits are 50/50 and can't be resized, and the Tab bar can't be clicked; see [Limitations](limitations.md).

## Tab titles

Each Tab's title follows the program running in it, or its folder when the Shell is idle.

Rename Tab fixes a Tab's title until you clear it with Clear Tab Title, after which it follows its program again. While the Current Pane runs Claude Code, Rename Tab suggests Claude Code's Program Title, which follows its `/rename`.

## Start directories

New Tabs start at the Session's Root directory, or the Current Pane's directory when the Session has none; see [Sessions](sessions.md#names-and-root-directories). New Panes start in the split Pane's directory.

## Closing

Closing a Pane whose Shell runs a program, such as vim or claude, asks first, naming the program it ends. A Tab closes with its last Pane.

## Settings

- `tab.startDirectory`: where a new Tab starts. `root`, the default, is the Session's Root directory, or the current Pane's directory without one; `current` is the current Pane's directory; `home` is your home directory.
- `pane.startDirectory`: where the new Pane of a split starts. `current`, the default, is the split Pane's directory; `root` is the Session's Root directory, or the split Pane's directory without one; `home` is your home directory.
- `tab.renameSuggestion`: `claude`, the default, has Rename Tab suggest Claude Code's Program Title alone; `all` suggests any running program's Program Title.
- `pane.padding`: `padded`, the default, keeps each Pane's text a few pixels off its edges and dividers; `none` lets it run up to them.
- `pane.scrollBar`: `none`, the default, shows no scroll bar; `visible` shows a thin one in the Theme's colours. Scrolling works either way.
