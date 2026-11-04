# Electron and xterm.js instead of a native Swift app

blind is built with Electron, TypeScript and xterm.js rather than Swift and AppKit, because its owner works in JavaScript and needs to read and maintain the code. Every macOS behaviour the app needs (a global Hotkey, floating above fullscreen apps, hiding from the Dock and `Cmd+Tab`, a menu bar icon) is reachable through Electron's APIs. We accept higher memory use and lower peak speed under heavy output than a native terminal would have.

## Considered Options

- **Swift + AppKit with a native terminal engine**: best macOS integration and speed, but in a language the owner doesn't know.
- **Tauri + xterm.js**: lighter than Electron, but the backend and the macOS window behaviour need Rust or community plugins.
