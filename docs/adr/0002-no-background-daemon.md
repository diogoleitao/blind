# No background daemon: Shells don't survive the app quitting

Restore brings back every Session's Tabs, Pane layout, working directories and scrollback, but Shells start fresh. There is no tmux-style daemon keeping processes alive while the app is closed. A daemon would be the most expensive part of the design, and an OS restart kills processes anyway, so quitting the app is treated like a reboot. Re-running each Pane's last command on Restore is a planned later addition and doesn't need a daemon.
