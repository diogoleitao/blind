# `blind themes import`

In the app: the Import Theme action (see [Importing a Theme](../configuration/theme-files.md#importing-a-theme)).

```sh
blind themes import <file>
```

`blind themes import <file>` makes a Theme file in the themes folder, `~/.config/blind/themes`, from an iTerm2, Ghostty, Kitty, Alacritty or Windows Terminal theme, as the Command Palette's Import Theme does, and says where it saved it.

Unlike Import Theme, it saves the file without showing the Theme first.

It refuses:

- a file that isn't a theme
- one that leaves out colours the rest are drawn from
- one whose name another Theme or file in the themes folder has, ignoring case

A running Blind lists the new Theme in Change Theme straight away.
