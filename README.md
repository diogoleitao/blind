# blind

> _I can't see my terminal--oh, here it is!_

A macOS terminal emulator organised around named Sessions that persist across app quits and OS restarts. See [GLOSSARY.md](GLOSSARY.md) for the domain language.

## Stack

- Electron
- TypeScript
- xterm.js

Why:
- [ADR 0001](docs/adr/0001-electron-and-xterm-js.md) (not Swift or Tauri)
- [ADR 0002](docs/adr/0002-no-background-daemon.md) (no background daemon)

## Develop

```sh
npm install
npm run dev
```

Running from the repo, the Hotkey is F7.

## Install

```sh
npm run install-app
```

Builds `Blind.app` and copies it to `/Applications`, replacing any previous copy. Quit a running Blind and open it again to use the new copy.

The installed app:

- uses F12 as the Hotkey, so it can run alongside the development app
- registers itself as a login item and starts hidden at login, until the Hotkey shows it
- is ad-hoc signed and not notarized. Built on this Mac, it opens without a Gatekeeper prompt. A copy downloaded from elsewhere would be blocked.

The app icon is made from `build/icon.iconset`. The app registers itself as a login item each time it starts, so removing it from System Settings > General > Login Items lasts only until Blind is next opened.

## Credits

The menu bar icons were drawn in [Pixilart](https://www.pixilart.com/).

## License

[MIT](LICENSE)
