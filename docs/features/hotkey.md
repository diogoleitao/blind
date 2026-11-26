# Hotkey

`F12` brings blind down over every app, including fullscreen ones, on every Space, like a window blind. The same key, or clicking away, hides it and gives focus back to the app you were in.

When blind is shown, one Session is visible: the one you used most recently. See [Sessions](sessions.md) to switch to another.

The Hotkey can't be changed; see [Limitations](limitations.md).

## Out of the way

blind is not in the Dock or `Cmd+Tab`. It starts on its own when you log in to macOS, a Login Launch, and stays hidden until the Hotkey shows it.

## Settings

- [`loginLaunch.start`](../configuration/settings.md#loginlaunchstart): whether a Login Launch stays hidden until the Hotkey shows it.
- [`loginLaunch.withNoOpenSessions`](../configuration/settings.md#loginlaunchwithnoopensessions): what a hidden Login Launch with no Open Sessions opens.
