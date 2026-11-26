<p align="center">
  <img src="build/icon.iconset/icon_128x128@2x.png" width="128" alt="blind icon">
</p>

<h1 align="center">blind</h1>

<p align="center"><em>I can't see my terminal--oh, here it is!</em></p>

Terminal windows get buried under everything else, and each project's tabs and splits are gone once you quit. blind is a macOS terminal that comes down over every app on one key, like a window blind, and goes back up on the same key. Each project lives in its own Session, which comes back with its Tabs, Panes and scrollback after a quit or an OS restart.

## Features

- [**Hotkey**](docs/features/hotkey.md): `F12` brings blind down over every app, and the same key puts it back up.
- [**Sessions**](docs/features/sessions.md): one Session per project, cycled through with `` Cmd+` ``, closed and reopened with its programs still running.
- [**Shells that outlive the app**](docs/features/shells-outlive-the-app.md): quitting blind leaves every program running, shown as you left it on the next start.
- [**Restore**](docs/features/restore.md): after a quit or an OS restart, every Session comes back with its Tabs, splits, working directories and scrollback.
- [**Tabs and Panes**](docs/features/tabs-and-panes.md): splits that nest without limit, and Tab titles that follow the running program.
- [**Hidden Tabs**](docs/features/hidden-tabs.md): `Cmd+H` takes a Tab out of the Tab bar without closing it.
- [**Command Palette**](docs/features/command-palette.md): `Cmd+K` searches every Session, Tab, Pane and action.
- [**Activity**](docs/features/activity.md): a dot on every Pane whose program wants your attention, listed in the Activity Sidebar.
- [**Inside a Pane**](docs/features/inside-a-pane.md): clickable links, Find in Pane, and `TERM_PROGRAM=blind`.
- [**Appearance**](docs/features/appearance.md): built-in and imported Themes, and see-through, blurred windows.
- [**One config file**](docs/configuration/config-file.md): every setting and shortcut in `~/.config/blind/config.jsonc`, with editor autocomplete, applied as you save.
- [**Menu Bar Icon**](docs/features/menu-bar-icon.md): your Open and Closed Sessions, one click away.
- [**Show Build**](docs/features/show-build.md): the version and commit blind and Blind Spot are running.

What blind can't do yet is in [Limitations](docs/features/limitations.md).

## Install

```sh
npm run install-app
```

Builds `Blind.app` from the last commit and copies it to `/Applications`, replacing any previous copy. It refuses to run while the repo has uncommitted changes, untracked files included; `blind install` stashes them for the build. Quit a running Blind and open it again to use the new copy, or use `blind install`, which does both.

From the terminal: [`blind install`](docs/blind-command/install.md) builds and installs the last commit with uncommitted changes stashed, and restarts a running Blind into the new copy.

The installed app records the Build it was made from: its `Info.plist` names the commit's full SHA under `BlindCommit`, beside the version in `CFBundleShortVersionString`, and `Blind.app/Contents/Resources/version` holds the version on its first line and the full SHA on its second.

```sh
plutil -extract BlindCommit raw /Applications/Blind.app/Contents/Info.plist
cat /Applications/Blind.app/Contents/Resources/version
```

The installed app:

- uses F12 as the Hotkey, so it can run alongside the development app
- registers itself as a login item and starts hidden at login, until the Hotkey shows it. `loginLaunch.start` in the config file can start it shown instead, and `loginLaunch.withNoOpenSessions` can have a hidden Login Launch with no Open Sessions open one for the first Hotkey press to show
- is ad-hoc signed and not notarized. Built on this Mac, it opens without a Gatekeeper prompt. A copy downloaded from elsewhere would be blocked.

The app icon is made from `build/icon.iconset`. The app registers itself as a login item each time it starts, so removing it from System Settings > General > Login Items lasts only until Blind is next opened.

### The `blind` command

[The `blind` command](docs/blind-command/README.md): put it on your `PATH` with `npm link` from the repo, then change settings, import Themes, install, relink and run blind from the terminal.

## Develop

```sh
npm install
npm run dev
```

With [the `blind` command](docs/blind-command/README.md) linked, [`blind dev`](docs/blind-command/dev.md) does the same as `npm run dev` from any directory. Running from the repo, the Hotkey is F7. The app keeps its data in `~/Library/Application Support/Blind Dev/` and its config and Themes in `~/.config/blind-dev/`, apart from the installed app's, so the two never share Sessions or settings. `dev` and `build` first build the native addon in `native/`, which needs the Xcode Command Line Tools (`xcode-select --install`); the first build downloads Electron's headers.

## Stack

- Electron
- TypeScript
- xterm.js

Why:
- [ADR 0001](docs/adr/0001-electron-and-xterm-js.md) (not Swift or Tauri)
- [ADR 0003](docs/adr/0003-blur-through-a-private-macos-api.md) (blur through a private macOS API)
- [ADR 0005](docs/adr/0005-shells-outlive-the-app-in-a-background-process.md) (Shells outlive the app in a background process, superseding ADR 0002)

## Documentation

- [`docs/README.md`](docs/README.md): the user documentation. What blind can do, how to configure it, and how to use it.
- [`GLOSSARY.md`](GLOSSARY.md): the domain language. Terms such as Session, Tab, Pane, Hotkey and Restore have precise meanings here.
- [`docs/adr/`](docs/adr): architecture decisions and why they were made.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): commit message conventions and linting.

## Credits

The app and menu bar icons were drawn in [Pixilart](https://www.pixilart.com/).

## License

[MIT](LICENSE)
