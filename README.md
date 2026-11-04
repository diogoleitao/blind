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

## License

[MIT](LICENSE)
