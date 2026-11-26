# `blind install`

In the app: the [Show Build](../features/show-build.md) action lists the Build blind is running, which, once Blind restarts, is the commit `blind install` built. Without the command, the README's [Install](../../README.md#install) section builds and installs blind with `npm run install-app`.

`blind install` runs `npm run install-app`, then has a running Blind restart into the new copy. A Blind that isn't running is left that way.

## Uncommitted changes

`npm run install-app` builds the last commit only. With uncommitted changes, untracked files included, `blind install` first lists them and stashes them as `blind install: uncommitted changes`, so only the last commit is built. It puts them back once the build ends, staged changes staged again, whether the build succeeded, failed or was stopped with Ctrl+C.

A running `blind dev` reloads onto the last commit meanwhile.

Should putting them back fail, it says so and leaves Blind running as it is. `git stash list` and `git stash pop --index` get them back.

## Restarting Blind

To restart, Blind asks you to confirm, as quitting does, and starts again once you do. Cancel and the old copy keeps running until you next quit.

## `--force`

```sh
blind install --force
```

`blind install --force` restarts Blind without asking, saving your Sessions first.
