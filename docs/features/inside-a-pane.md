# Inside a Pane

## Clickable links

`Cmd+click` opens URLs and file paths, including relative paths and `path:line:col`.

## Find in Pane

`Cmd+F`, or the Find in Pane action, searches the Pane's scrollback and shows the match count.

## Clear Scrollback

`Cmd+Shift+K`, or the Clear Scrollback action, clears the Current Pane's scrollback.

## Copy and paste

`Cmd+C` copies and `Cmd+V` pastes.

## Terminal identity

Every Shell gets `TERM_PROGRAM=blind`, so programs can tell they're running in blind, even when blind was started from another terminal.
