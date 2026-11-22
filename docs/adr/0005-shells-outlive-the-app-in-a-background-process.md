# Shells outlive the app in a background process of Blind's own

Supersedes ADR 0002. Shells keep running after the app quits, however it stops (quit, restart for an update, a stop signal, a crash), held by a background process that ships inside the app and that the app connects to when it launches; the user can choose for quitting to end them instead (`shell.onQuit`), and an OS restart still ends them, which Restore covers. The process runs the node-pty Shells and the headless terminals that keep each Pane's state, which already existed to keep a Closed Session's Shells running while the app runs, so a launching app's windows get each Pane's state as a reopened Session's do. ADR 0002 judged a daemon the most expensive part of the design; once the headless terminals existed for Closed Sessions, most of that cost was already paid.

## Considered Options

- **tmux, driven through its control mode** (as iTerm2's tmux integration does): a proven server that owns the ptys and keeps each pane's state, but not installed on macOS by default, so Blind would depend on it or bundle it, and its pane state would replace the headless terminals that answer programs' queries and raise Activity.
- **Keeping ADR 0002**, with Restore re-running each Pane's last command: no process outlives the app, but a program's state (an editor's unsaved buffer, a `claude` conversation in progress) is lost.
