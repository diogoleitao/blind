# Leaving programs running

Start claude or a long build, then close its Session or quit blind: the program keeps running, and its output is waiting when you come back.

## 1. Start something that takes a while

In a Pane, start claude, a build, or anything else you don't want to wait on.

## 2. Close its Session

Choose Close Session in the [Command Palette](../features/command-palette.md). The Session becomes a Closed Session: it leaves the cycle of Open Sessions, and its Shells keep running in the background. See [Closed Sessions](../features/sessions.md#closed-sessions).

## 3. Or quit blind

Choose Quit Blind in the Command Palette or the [Menu Bar Icon](../features/menu-bar-icon.md)'s menu. Every Shell keeps running, held by a background process, Blind Spot, until blind starts again. See [Shells that outlive the app](../features/shells-outlive-the-app.md).

While no window shows its Pane, a program can still raise Activity, so you can still find out when it finishes; see [Following Activity](following-activity.md).

## 4. Come back to it

Reopen a Closed Session from the Command Palette, where `ss` lists Sessions alone, or from the Menu Bar Icon. After a quit, open blind again. Either way, each program is as you left it, with everything it printed meanwhile. A Pane whose Shell exited meanwhile keeps its output and gets a fresh Shell.

An OS restart still ends every Shell. After one, [Restore](../features/restore.md) brings back your Sessions with fresh Shells.

## 5. End them when you want them gone

- Quit and End Shells, in the Command Palette and the Menu Bar Icon's menu, quits blind and ends every Shell, naming the programs it ends first. It has no shortcut by default; bind one as `quitAndEndShells` in [Key bindings](../configuration/key-bindings.md). See [Quit and End Shells](../features/shells-outlive-the-app.md#quit-and-end-shells).
- Delete Session ends one Session's Shells and removes the Session for good; its confirmation names the programs that end. See [Deleting a Session](../features/sessions.md#deleting-a-session).
- `Cmd+W` closes one Pane, asking first when its Shell runs a program and naming it. See [Closing](../features/tabs-and-panes.md#closing).

To have every quit end the Shells, set [`shell.onQuit`](../configuration/settings.md#shellonquit) to `end`; see [Settings](../features/shells-outlive-the-app.md#settings).
