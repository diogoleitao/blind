# Activity Sound

The Activity Sound is the macOS sound blind plays when a Pane gains [Activity](../features/activity.md), so you hear that a program wants you even while blind is out of sight.

## When it plays

[`activity.ring`](settings.md#activityring) sets when it plays:

- `whileHidden`, the default, plays it only while blind is hidden.
- `always` plays it whether blind is shown or hidden.
- `never` doesn't play it.

A Pane plays it once as it gains Activity, and again only once its Activity has cleared and it gains Activity anew.

## Choosing the sound

The Change Activity Sound action, in the [Command Palette](../features/command-palette.md), lists the macOS sounds with the one in effect selected, and plays each one as you move through the list. Choosing one keeps it, and Escape goes back to the one from before.

Change Activity Sound sets [`activity.sound`](settings.md#activitysound) in the [config file](config-file.md), which you can also set by hand. The sounds it takes are listed in its entry in the [Settings](settings.md#activitysound) reference. `Purr` is the default.
