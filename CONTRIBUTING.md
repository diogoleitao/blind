# Contributing

## Commit messages

Every commit must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

## Linting

Code follows [neostandard](https://github.com/neostandard/neostandard), standard.js for TypeScript, used as it is so style is never up for debate. Run `npm run lint` to check and `npm run lint:fix` to fix what can be fixed automatically. When code breaks a rule, change the code: `eslint.config.js` gets no rule overrides and no neostandard style options.

## User docs

The user docs live under `docs/`, indexed by `docs/README.md`. A change to user-visible behaviour updates its page under `docs/` (Usage, Features, Configuration or The `blind` command) in the same commit. Adding or removing a feature also updates its one-line entry in the README and its line in `docs/README.md`. The Settings and Key bindings pages under `docs/configuration/` are generated from the code: run `npm run docs` and commit the result rather than editing them by hand. `npm test` fails when they are out of date.

## Git hooks

`npm install` points git at `.githooks`, whose `pre-commit` hook runs `npm run lint`, `npm run typecheck` and `npm test` and aborts the commit on the first failure. It checks every file on disk, so what is staged makes no difference to the result. `git commit --no-verify` skips it.
