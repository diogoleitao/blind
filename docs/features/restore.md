# Restore

After a quit or an OS restart, every Session comes back with its Tabs, splits, working directories and scrollback.

A Pane whose Shell ran on while blind was gone shows it as it is; see [Shells that outlive the app](shells-outlive-the-app.md). Any other Pane starts a fresh Shell below a "Restored" marker.

[Hidden Tabs](hidden-tabs.md) stay hidden through Restore.

Restore doesn't re-run each Pane's last command; see [Limitations](limitations.md).

## Settings

- `pane.scrollbackLines`: how many lines of each Pane's scrollback are kept and restored. The default is `10000`, and the most is `1000000`; `"unlimited"` keeps that many.
