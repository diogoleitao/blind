# Show Build

The Show Build action, in the [Command Palette](command-palette.md), lists the Build blind is running: its version and commit, such as `Version: 0.0.0` and `Commit: 45e9d74`, the commit's short SHA, with ` (dev)` after it when running from the repo.

Blind Spot, which holds the Shells (see [Shells that outlive the app](shells-outlive-the-app.md#blind-spot)), can run an older Build than the app, as it keeps running through an install. When its commit differs, `Blind Spot Version` and `Blind Spot Commit` follow. A Blind Spot too old to report its Build adds nothing.

Enter, or a click, copies the version or the commit's full SHA and shows `Copied!`, leaving the list open.
