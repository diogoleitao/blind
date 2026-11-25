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

**Hidden Tab**:
A Tab left out of its Session's Tab bar until it next becomes the Current Tab. It stays in the Session, its Shells keep running, and it can still be found in the Command Palette.
_Avoid_: Closed Tab, minimised Tab, archived Tab, stashed Tab

**Hide**:
Making a Tab a Hidden Tab. Unlike closing it, nothing ends.
_Avoid_: Close, minimise, archive, stash

**Pane**:
A rectangular region of a Tab that hosts one Shell. Panes come from splitting another Pane vertically or horizontally, and splits nest without limit.
_Avoid_: Split, Session (iTerm2's meaning)

**Shell**:
The process running inside a Pane. It keeps running after the app quits, unless the user has chosen for quitting to end it, until its Pane or Tab is closed, its Session is deleted, or the OS restarts.
_Avoid_: Session

**Program Title**:
The title the program running in a Pane gives itself, kept until that program stops.
_Avoid_: Window title, terminal title, Claude Code's session name

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

**Current Pane**:
The Pane of the Current Tab that is focused.
_Avoid_: Active Pane

**Closed Session**:
A Session that is saved but out of the cycle. Closing a Session's window makes it a Closed Session; it can be opened again. Its Shells keep running while it is closed and once it is opened again. A Session with neither a name nor a Root directory, closed while the user has chosen to delete such Sessions, is deleted instead.
_Avoid_: Detached, archived

**Windowless Pane**:
A Pane whose Shell runs on while no window shows it: a Closed Session's, or any Pane's once the app has quit. Its program can still raise Activity, and everything it prints is kept, so the Pane shows as it is when a window shows it again.
_Avoid_: Detached Pane, background Pane, hidden Pane

**Delete**:
Permanently removing a Session, open or closed, which ends its Shells. Closing a window never deletes a Session with a name or a Root directory; one with neither is deleted on closing when the user has chosen so.
_Avoid_: Close (when the Session should go away)

**Restore**:
Bringing back every Session with its Tabs, Pane layout, working directories and scrollback after the app quits or the OS restarts. A Shell still running since the app quit carries on as it was; any other Shell starts fresh.
_Avoid_: Resume, reattach

**Build**:
The version of Blind, and the commit, a running copy of Blind was made from. Blind Spot has a Build of its own, which can be older than the app's.
_Avoid_: Release, About, build info

**Login Launch**:
The app starting on its own when the user logs in to macOS, hidden until the Hotkey shows it unless the user has chosen for it to start shown.
_Avoid_: Autostart, startup, launch at login

### Navigation

**Hotkey**:
The global shortcut that shows or hides the app, floating above every other app's windows, fullscreen ones included, but beneath the system's own overlays and the launchers the user summons over it. When shown, exactly one Session is visible: the most recently used one.
_Avoid_: Hotkey window, quake mode, visor

**Banner**:
A brief label shown in the middle of a Session's window, which then fades.
_Avoid_: Toast, HUD, flash, OSD

**Session Banner**:
The Banner naming the Session that cycling has just made the Current Session.

**Copy Banner**:
The Banner confirming what the Command Palette has just copied.

**Command Palette**:
The searchable dialog for jumping to any Session, Tab or Pane and for running any app action.
_Avoid_: Cmd+K menu, launcher, quick open

### Attention

**Activity**:
A Pane's standing request for the user's attention, raised when the program in its Shell asks for it and cleared when the Pane becomes the Current Pane or the program says it no longer needs the user. A Tab or Session has Activity while any of its Panes does.
_Avoid_: Unread, alert, output

**Activity Sidebar**:
A list of the Panes with Activity across every Open Session and Closed Session, grouped by Session, with Open Sessions and Closed Sessions under separate headings, that slides over one side of the Current Session's window. Choosing a Pane in it makes that Pane the Current Pane, opening its Session first if it is a Closed Session.
_Avoid_: Inbox, drawer, panel

### Appearance

**Theme**:
A named set of colours covering both the terminal and the app's own chrome (Tab bar, Tab dividers, Command Palette, Activity Sidebar, Session Banner, Pane dividers, Bezel).
_Avoid_: Colour scheme, profile

**Theme file**:
A Theme the user keeps in the themes folder, written by hand or made by Import. Built-in Themes are not Theme files.
_Avoid_: Custom theme, user theme

**Import**:
Making a Theme file from a file in which another terminal, such as iTerm2 or Ghostty, keeps its colours. The new Theme's chrome colours come from its terminal colours, and it is named after the file it came from.
_Avoid_: Upload, convert

**Bezel**:
The thin border around a Session's window.
_Avoid_: Frame, outline, window border

**Background**:
What a Session's window shows behind its terminal: the Theme's terminal background, see-through and blurred as far as the user has chosen.
_Avoid_: Transparency, vibrancy, opacity

**Menu Bar Icon**:
The app's icon in the macOS menu bar.
_Avoid_: Tray icon, status item
