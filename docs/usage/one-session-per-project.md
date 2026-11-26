# One Session per project

Give each project its own Session, with its own name, Root directory, Tabs and Panes, and switch between them without losing your place.

## 1. Name a Session

Press `Cmd+K` to open the [Command Palette](../features/command-palette.md) and choose Rename Session. No two Sessions share a name. See [Names and Root directories](../features/sessions.md#names-and-root-directories).

## 2. Set its Root directory

Choose Set Session Root in the Command Palette and pick the project's directory, such as its repository. The Session now belongs to that directory, and its new Tabs, from `Cmd+T`, start there. Clear Session Root removes it.

On an Unnamed Session, setting a Root directory also names the Session after the last part of the directory's path, so one step does both.

New Panes from a split start in the split Pane's directory; [`pane.startDirectory`](../configuration/settings.md#panestartdirectory) can start them at the Root directory instead. See [Start directories](../features/tabs-and-panes.md#start-directories).

## 3. Open one per project

`Cmd+N` opens a new Session. Name it, or set its Root directory, and repeat for each project. Each Session keeps its own Tabs, Panes and Shells, and comes back with them after a quit or an OS restart; see [Restore](../features/restore.md).

## 4. Switch with `` Cmd+` ``

`` Cmd+` `` moves to the next Open Session and `` Cmd+Shift+` `` back to the previous one. The Session Banner names each Session as it lands. Open Sessions are cycled through by name by default; [`session.cycleOrder`](../configuration/settings.md#sessioncycleorder) can cycle by most recent use or by creation instead. See [Cycling through Sessions](../features/sessions.md#cycling-through-sessions).

## 5. Jump with the Command Palette

With more than a few Sessions, jumping is quicker than cycling. Press `Cmd+K` and type part of a Session's name. Start the query with `ss` to search only Sessions, Open Sessions listed before Closed ones. See [Searching only Sessions, Tabs or Panes](../features/command-palette.md#searching-only-sessions-tabs-or-panes).

The [Menu Bar Icon](../features/menu-bar-icon.md) lists every Session too, one click away.

## When a project can wait

Close Session keeps the Session as a Closed Session, out of the cycle, with its programs still running; see [Leaving programs running](leaving-programs-running.md). Delete Session removes it for good; see [Deleting a Session](../features/sessions.md#deleting-a-session).
