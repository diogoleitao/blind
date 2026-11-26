# Appearance

## Themes

A Theme colours both the terminal and blind's own chrome: the Tab bar, Tab dividers, Command Palette, Activity Sidebar, Session Banner, Pane dividers and the Bezel.

blind has five built-in Themes: Default, Catppuccin, Tokyo Night, Rosé Pine and Gruvbox. You can add your own as `.jsonc` files in `~/.config/blind/themes/`; see [Theme files](../configuration/theme-files.md).

The Change Theme action opens the picker, which previews each Theme as you move through the list, and sets [`theme`](../configuration/settings.md#theme).

### Importing a Theme

The Import Theme action makes a Theme file in that folder from another terminal's theme: an iTerm2 `.itermcolors`, a Ghostty theme, a Kitty `.conf`, an Alacritty `.toml` or a Windows Terminal colour scheme. It's named after the file, and its Tab bar, Command Palette and Session Banner colours come from the terminal colours. See [Importing a Theme](../configuration/theme-files.md#importing-a-theme) for what it refuses.

## See-through windows

A Session's window shows its Theme's background 25% transparent over a blur of what's behind it, as iTerm2 does.

The blur uses a private macOS function ([ADR 0003](../adr/0003-blur-through-a-private-macos-api.md)). If a macOS update breaks it, windows show unblurred and blind tells you, once per launch.

## Settings

- [`theme`](../configuration/settings.md#theme): the name of the Theme in effect, built in or from a Theme file.
- [`background.transparency`](../configuration/settings.md#backgroundtransparency): how transparent the window's background is.
- [`background.blurRadius`](../configuration/settings.md#backgroundblurradius): how strongly the background blurs what's behind the window.
- [`background.effect`](../configuration/settings.md#backgroundeffect): whether the background blurs what's behind the window.
