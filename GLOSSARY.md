# blind

A macOS terminal emulator organised around named Sessions that persist across app quits and OS restarts.

## Language

### Layout

**Session**:
A persistent window of the app that holds one or more Tabs, typically one per repository or project. Its name is optional and unique, given explicitly or by setting a Root directory on the Session while it is unnamed.
_Avoid_: Workspace, Project, Window

**Unnamed Session**:
A Session without a name. It is shown under a numbered placeholder label, e.g. `Session 1`, which is not its name, followed by its working directory where there is room, e.g. `Session 1 (~/some/dir)`.
_Avoid_: Untitled, default name

**Tab**:
One page of a Session, holding one or more Panes.

**Pane**:
A rectangular region of a Tab that hosts one Shell. Panes come from splitting another Pane vertically or horizontally, and splits nest without limit.
_Avoid_: Split, Session (iTerm2's meaning)

**Shell**:
The process running inside a Pane.
_Avoid_: Session

**Root directory**:
The optional directory a Session belongs to, always set explicitly. Its new Tabs start there unless the user has chosen otherwise, and the user can choose for new Panes to start there too. In a Session without one, those start in the working directory of the Pane they open from instead, or the home directory when there is no such Pane. Setting one on an Unnamed Session names the Session after the last part of the directory's path.
_Avoid_: Project folder, home

### Continuity

**Open Session**:
A Session in the cycle of Sessions the user switches between. Only one Open Session is visible at a time.

**Current Session**:
The one Open Session that is visible.
_Avoid_: Active Session, front window

**Current Tab**:
The Tab of the Current Session that is visible.
_Avoid_: Active Tab

**Closed Session**:
A Session that is saved but out of the cycle. Closing a Session's window makes it a Closed Session; it can be opened again. A Session with neither a name nor a Root directory, closed while the user has chosen to delete such Sessions, is deleted instead.
_Avoid_: Detached, archived

**Delete**:
Permanently removing a Session, open or closed. Closing a window never deletes a Session with a name or a Root directory; one with neither is deleted on closing when the user has chosen so.
_Avoid_: Close (when the Session should go away)

**Restore**:
Bringing back every Session with its Tabs, Pane layout, working directories and scrollback after the app quits or the OS restarts. Shells start fresh; nothing keeps running in between.
_Avoid_: Resume, reattach

### Navigation

**Hotkey**:
The global shortcut that shows or hides the app, floating above every other app. When shown, exactly one Session is visible: the most recently used one.
_Avoid_: Hotkey window, quake mode, visor

**Command Palette**:
The searchable dialog for jumping to any Session, Tab or Pane and for running any app action.
_Avoid_: Cmd+K menu, launcher, quick open

### Appearance

**Theme**:
A named set of colours covering both the terminal and the app's own chrome (Tab bar, Command Palette, Pane dividers).
_Avoid_: Colour scheme, profile
