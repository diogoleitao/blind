# Getting started

Your first minutes with blind: bring it down, name a Session, split a Pane, find your way with the Command Palette, and put it back up.

Build and install blind first, as the README's [Install](../../README.md#install) section says.

## 1. Bring blind down

Press `F12`, the [Hotkey](../features/hotkey.md). blind comes down over whatever app you're in, fullscreen ones included, showing a Session with a Shell ready in its one Pane. If blind isn't running yet, open it from `/Applications` once; from then on it starts on its own when you log in, hidden until you press the Hotkey.

A first Session has no name yet, so the Tab bar labels it with a placeholder such as `Session 1`.

## 2. Name your first Session

Press `Cmd+K` to open the [Command Palette](../features/command-palette.md), choose Rename Session, and name the Session after the project you'll work on.

Set Session Root, also in the Command Palette, does more: it gives the Session a Root directory, where its new Tabs start, and names an Unnamed Session after that directory. See [Names and Root directories](../features/sessions.md#names-and-root-directories).

## 3. Split a Pane

`Cmd+D` splits the Current Pane vertically and `Cmd+Shift+D` horizontally. Each Pane runs its own Shell, and splits nest without limit. `Cmd+]` and `Cmd+[` move between Panes, and `Cmd+W` closes one.

The rest of the keys are in [Tabs and Panes](../features/tabs-and-panes.md#keys-and-actions).

## 4. Open the Command Palette

`Cmd+K` searches every Session, Tab and Pane, and every action. Type part of a name to jump to it, or part of an action, such as `split`, to run it. Every action blind has is there, including those with no shortcut, so it is the place to look when you don't know the key. See [Command Palette](../features/command-palette.md).

## 5. Hide blind again

Press `F12` again, or click another app. blind goes back up and gives focus back to the app you were in. Nothing stops: your Shells keep running, and the next press of the Hotkey brings back the Session you used last.

## Next

- [One Session per project](one-session-per-project.md)
- [Leaving programs running](leaving-programs-running.md)
- [Following Activity](following-activity.md)
