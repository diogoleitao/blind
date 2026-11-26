# Hotkey

`F12` brings blind down over every app, including fullscreen ones, on every Space, like a window blind. The same key, or clicking away, hides it and gives focus back to the app you were in.

When blind is shown, one Session is visible: the one you used most recently. See [Sessions](sessions.md) to switch to another.

The Hotkey can't be changed; see [Limitations](limitations.md).

## Out of the way

blind is not in the Dock or `Cmd+Tab`. It starts on its own when you log in to macOS, a Login Launch, and stays hidden until the Hotkey shows it.

## Settings

- `loginLaunch.start`: `hidden`, the default, keeps the Login Launch hidden until the Hotkey shows it; `shown` starts it shown, as opening blind by hand does.
- `loginLaunch.withNoOpenSessions`: what a hidden Login Launch with no Open Sessions opens. `hotkey`, the default, opens nothing and leaves it to the first Hotkey press, which opens a new Session; `new` opens a new Session for the first Hotkey press to show.
