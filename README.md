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
- **One config file.** `~/.config/blind/config.jsonc` comes with a schema for editor autocomplete, applies changes as you save, and rebinds any shortcut. Settings are grouped by what they act on, such as `"pane": { "scrollBar": "visible" }`, and this README names them by group and setting joined by a dot, such as `pane.scrollBar` ([ADR 0004](docs/adr/0004-settings-grouped-by-glossary-term.md)).
- [**Menu Bar Icon**](docs/features/menu-bar-icon.md): your Open and Closed Sessions, one click away.
- [**Show Build**](docs/features/show-build.md): the version and commit blind and Blind Spot are running.

What blind can't do yet is in [Limitations](docs/features/limitations.md).

## Install

```sh
npm run install-app
```

Builds `Blind.app` from the last commit and copies it to `/Applications`, replacing any previous copy. It refuses to run while the repo has uncommitted changes, untracked files included; `blind install` (below) stashes them for the build. Quit a running Blind and open it again to use the new copy, or use `blind install`, which does both.

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

```sh
npm link
```

Run once from the repo, this builds the `blind` command and puts it on your `PATH`. It runs from the repo, so it stays linked to this checkout. If you switch Node versions with a version manager such as nvm, run `npm link` again under the new one.

`blind settings` lists every setting but `keyBindings` with its value and description, each group's under a heading of its name, and changes them as you go: arrow keys move and pick values, and Enter types a number or the `shell.program` setting. Changes are saved when you quit with `q` or Escape, and a running Blind applies them then; Ctrl+C quits without saving them. Settings changed since the editor opened show in bold yellow with a `*`, and quitting lists them, by group and setting joined by a dot, with their old and new values, under `Discarded:` after Ctrl+C. `blind settings open` opens `~/.config/blind/config.jsonc` in `$EDITOR`, or in its default app without one, creating it first if it's missing.

`blind themes import <file>` makes a Theme file in `~/.config/blind/themes` from an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme, as the Command Palette's Import Theme does, and says where it saved it. It saves the file without showing the Theme first, and refuses a file that isn't a theme, one that leaves out colours the rest are drawn from, and one whose name another Theme or file in the folder has, ignoring case. A running Blind lists the new Theme in Change Theme straight away.

`blind install` runs `npm run install-app`, then has a running Blind restart into the new copy. With uncommitted changes, untracked files included, it first lists them and stashes them as `blind install: uncommitted changes`, so only the last commit is built, and puts them back once the build ends, staged changes staged again, whether the build succeeded, failed or was stopped with Ctrl+C. A running `blind dev` reloads onto the last commit meanwhile. Should putting them back fail, it says so and leaves Blind running as it is; `git stash list` and `git stash pop --index` get them back. To restart, Blind asks you to confirm, as quitting does, and starts again once you do. Cancel and the old copy keeps running until you next quit. `blind install --force` restarts it without asking, saving your Sessions first. A Blind that isn't running is left that way.

`blind link` runs `npm link` in the repo, which rebuilds the `blind` command first. Run it after changing the command's source. It needs `blind` on your `PATH` already, so the first link, and the one after switching Node versions, is still the one above.

## Develop

```sh
npm install
npm run dev
```

With [the `blind` command](#the-blind-command) linked, `blind dev` does the same as `npm run dev` from any directory. Running from the repo, the Hotkey is F7. The app keeps its data in `~/Library/Application Support/Blind Dev/` and its config and Themes in `~/.config/blind-dev/`, apart from the installed app's, so the two never share Sessions or settings. `dev` and `build` first build the native addon in `native/`, which needs the Xcode Command Line Tools (`xcode-select --install`); the first build downloads Electron's headers.

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
