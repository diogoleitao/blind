# Activity

A Pane whose program asks for your attention while you're elsewhere has Activity until you focus it. A Tab or Session has Activity while any of its Panes does.

## Where Activity shows

- A dot on the Pane's Tab in the Tab bar.
- A dot on its Session, Tab and Pane in the [Command Palette](command-palette.md).
- The Tab bar names up to three other Sessions with Activity after the Session's name, or shows `3+` past that.
- The Tab bar counts [Hidden Tabs](hidden-tabs.md) with Activity after the shown Tabs, such as `+2`.
- The [Activity Sidebar](#activity-sidebar) lists every Pane with Activity.

## Which programs raise it

Claude Code 2.1.295 and later needs no setup: it reports when it finishes or waits for you (OSC 7501), and blind clears the dot once it gets back to work.

Any other program can raise Activity with a desktop notification (OSC 9, 99 or 777).

A program keeps raising Activity while no window shows its Pane, in a Closed Session or after blind quits; see [Shells that outlive the app](shells-outlive-the-app.md).

## Activity Sidebar

`Cmd+B`, or the Toggle Activity Sidebar action, slides the Activity Sidebar over the right of the window. It lists every Pane with Activity across your Open Sessions, then under their own heading your Closed Sessions, the latest first. Each Pane shows under its Session, and under its Tab where two or more Tabs of that Session have Activity.

A Closed Session's Activity shows only there, and choosing one of its Panes reopens it.

Up, Down and Enter, or a click, jump to a Pane. `Cmd+B` or a click outside closes the Activity Sidebar.

## Activity Sound

While blind is hidden, a Pane gaining Activity also plays the [Activity Sound](../configuration/activity-sound.md), Purr by default. The Change Activity Sound action picks another macOS sound, playing each one as you move through the list, and sets [`activity.sound`](../configuration/settings.md#activitysound).

## Settings

- [`activity.sound`](../configuration/settings.md#activitysound): the macOS sound played when a Pane gains Activity.
- [`activity.ring`](../configuration/settings.md#activityring): when the Activity Sound plays.
- [`activitySidebar.side`](../configuration/settings.md#activitysidebarside): which side of the window the Activity Sidebar slides over.
