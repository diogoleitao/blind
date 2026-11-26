# Restore

After a quit or an OS restart, every Session comes back with its Tabs, splits, working directories and scrollback.

A Pane whose Shell ran on while blind was gone shows it as it is; see [Shells that outlive the app](shells-outlive-the-app.md). Any other Pane starts a fresh Shell below a "Restored" marker.

[Hidden Tabs](hidden-tabs.md) stay hidden through Restore.

When a Pane's Shell has ended, such as after an OS restart or Quit and End Shells, Restore starts a fresh Shell and doesn't re-run the program that was running; see [Limitations](limitations.md).

## Settings

- [`pane.scrollbackLines`](../configuration/settings.md#panescrollbacklines): how many lines of each Pane's scrollback are kept and restored.
