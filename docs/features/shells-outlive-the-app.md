# Shells that outlive the app

Quitting blind, however it stops, leaves every Shell running, so claude, vim or a build go on while blind is gone. The next time blind starts, it shows each program as you left it, with everything it printed meanwhile. A Pane whose Shell exited meanwhile keeps its output and gets a fresh Shell.

While no window shows a Pane, its program can still raise [Activity](activity.md).

An OS restart still ends every Shell. After one, [Restore](restore.md) brings back your Sessions with fresh Shells.

## Blind Spot

A background process, Blind Spot, holds the Shells while blind is gone. It ends on its own once none is left. Why blind works this way is in [ADR 0005](../adr/0005-shells-outlive-the-app-in-a-background-process.md).

## Quit and End Shells

Quit and End Shells, in the [Command Palette](command-palette.md) and the [Menu Bar Icon](menu-bar-icon.md)'s menu, quits blind and ends every Shell, naming the programs it ends first. It has no shortcut by default; bind one in `keyBindings` as `quitAndEndShells`.

## Settings

- `shell.onQuit`: `keepRunning`, the default, leaves every Shell running on quit. `end` has every quit end them, and Sessions come back with fresh Shells; Quit and End Shells is then not offered. A change takes effect at the next quit.
