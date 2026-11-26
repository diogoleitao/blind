# `blind link`

In the app: none. `blind link` refreshes the link the README's [Install](../../README.md#install) section has you make, and you run it while working on the repo, as in [Develop](../../README.md#develop).

`blind link` runs `npm link` in the repo, which rebuilds the `blind` command first. Run it after changing the command's source.

It needs `blind` on your `PATH` already, so the first link, and the one after switching Node versions, is still `npm link` from the repo (see [Getting the command](README.md#getting-the-command)).
