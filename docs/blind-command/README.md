# The `blind` command

`blind` does from the terminal what some of blind's actions do in the app, and builds, installs and runs blind from its repo.

## Getting the command

```sh
npm link
```

Run once from the repo, this builds the `blind` command and puts it on your `PATH`. It runs from the repo, so it stays linked to this checkout.

If you switch Node versions with a version manager such as nvm, run `npm link` again under the new one.

Once `blind` is on your `PATH`, [`blind link`](link.md) links it again from any directory, after you change the command's source.

## Commands

- [`blind settings`](settings.md): list every setting and change it in the terminal; `blind settings open` opens the config file in your editor.
- [`blind themes import`](themes-import.md): make a Theme file from another terminal's theme.
- [`blind install`](install.md): build the last commit, install it in `/Applications` and restart a running Blind into it; `--force` restarts it without asking.
- [`blind link`](link.md): rebuild the `blind` command and link it again.
- [`blind dev`](dev.md): run blind from the repo, as `npm run dev` does, from any directory.
