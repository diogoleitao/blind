# Following Activity

Leave Claude Code working in one Session, get on with another, and find out the moment it finishes or needs you.

## 1. Start Claude Code in a Session

Claude Code 2.1.295 and later tells blind when it finishes or waits for you, with no setup. Any other program can do the same with a desktop notification. See [Which programs raise it](../features/activity.md#which-programs-raise-it).

## 2. Work somewhere else

Move to another Session with `` Cmd+` ``, or hide blind with the Hotkey. When Claude Code finishes, its Pane gains [Activity](../features/activity.md).

## 3. Spot the dot and the Session's name

- In the Tab bar of the Session you're in, the names of up to three other Sessions with Activity follow your Session's name, or `3+` past that.
- In Claude Code's own Session, a dot marks the Tab its Pane is in, and the Tab bar counts [Hidden Tabs](../features/hidden-tabs.md) with Activity after the shown Tabs, such as `+2`.
- The [Command Palette](../features/command-palette.md) puts a dot on the Session, Tab and Pane.

See [Where Activity shows](../features/activity.md#where-activity-shows).

## 4. Open the Activity Sidebar

`Cmd+B` slides the Activity Sidebar over the right of the window. It lists every Pane with Activity, across your Open Sessions and then your Closed Sessions, the latest first. Up, Down and Enter, or a click, take you to a Pane, reopening its Session if it was closed. See [Activity Sidebar](../features/activity.md#activity-sidebar).

## 5. Hear the Activity Sound

While blind is hidden, a Pane gaining Activity plays the Activity Sound, Purr by default, so you hear Claude Code finish from another app. The Change Activity Sound action picks another macOS sound, and [`activity.ring`](../configuration/settings.md#activityring) can play it while blind is shown too, or never. See [Activity Sound](../features/activity.md#activity-sound).

## 6. Clear it

Go to the Pane and its Activity clears. Claude Code clears it too once it gets back to work.

Activity is raised even while no window shows the Pane, in a Closed Session or after blind quits; see [Leaving programs running](leaving-programs-running.md).
