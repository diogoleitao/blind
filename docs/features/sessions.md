# Sessions

A Session is a window of blind that holds one project: its Tabs, its Panes and their Shells. Keep one Session per project, each with its own name. Sessions persist across quits and OS restarts; see [Restore](restore.md).

## Names and Root directories

A Session's name is optional, and no two Sessions share one. Name a Session with the Rename Session action in the [Command Palette](command-palette.md).

An Unnamed Session shows under a numbered placeholder label, such as `Session 1`, followed by its working directory where there is room, such as `Session 1 (~/some/dir)`. The placeholder is not its name.

A Session can belong to a Root directory, set with Set Session Root and removed with Clear Session Root. Its new Tabs start there; see [Tabs and Panes](tabs-and-panes.md#start-directories). Setting a Root directory on an Unnamed Session names the Session after the last part of the directory's path.

The Tab bar shows the Session's label on a row below its Tabs.

## Cycling through Sessions

`` Cmd+` `` (Next Session) cycles through your Open Sessions, and `` Cmd+Shift+` `` (Previous Session) goes back. Each Session is named in the middle of the window as it lands, in the Session Banner. `Cmd+N` (New Session) opens a new one.

You can also jump to any Session from the [Command Palette](command-palette.md) or the [Menu Bar Icon](menu-bar-icon.md).

## Closed Sessions

Closing a Session's window, or the Close Session action, keeps the Session as a Closed Session, and its Shells keep running in the background. Reopen it from the [Command Palette](command-palette.md) or the [Menu Bar Icon](menu-bar-icon.md) to find each program as you left it, with everything it printed meanwhile. A Pane whose Shell exited meanwhile keeps its output and gets a fresh Shell.

## Deleting a Session

The Delete Session action removes a Session for good, open or closed, and stops its Shells. Its confirmation names the programs that end.

## Settings

- `sessionBanner`: `true`, the default, shows the Session Banner as you cycle; `false` turns it off.
- `session.cycleOrder`: the order Open Sessions are cycled through and listed in. `alphabetical`, the default, goes by name; `recent` by most recent use; `created` by creation.
- `session.withoutNameOrRootOnClose`: `keep`, the default, keeps a closed Session with neither a name nor a Root directory as a Closed Session. `delete` has closing or quitting delete such Sessions instead; the quit confirmation names them, with the programs that end.
