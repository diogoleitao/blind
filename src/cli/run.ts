import { join } from 'node:path'
import { importTheme, themeImportRefusalMessage, themeImportTargetFor, type ThemeSource } from '../core/theme-import'
import { loadThemes, type ThemeFile } from '../core/themes'
import { editSettings, type SettingsEditorDependencies } from './settings-editor'

const usage = 'usage: blind settings [open] | blind themes import <file> | blind dev | blind install | blind link\n'

export interface CliDependencies extends SettingsEditorDependencies {
  // The repo the CLI was built from.
  repoRoot: string;
  // $EDITOR, if set.
  editor: string | undefined;
  // Runs the command in `cwd`, or the current directory without one, with this process's input and output, resolving
  // to its exit code.
  run(command: string, args: string[], cwd?: string): Promise<number>;
  // The repo's uncommitted changes, untracked files included and ignored ones left out, each as `git status --short`
  // lists it, e.g. ` M GLOSSARY.md`.
  uncommittedChanges(): Promise<string[]>;
  // The installed Blind's process, while it's running; the one running from the repo is never it.
  runningBlindPid(): Promise<number | undefined>;
  // Has the installed Blind launched once the process has exited, by something that outlives this command and the Shell
  // it runs in, which Blind quitting stops.
  relaunchAfterExit(pid: number): void;
  // Asks the process to stop, which Blind does by saving and quitting without asking.
  terminate(pid: number): void;
  // The Theme files in the installed app's themes folder. A failure is reported to stderr with its error.
  themeFiles: {
    directory: string;
    read(): ThemeFile[];
    // Writes a new Theme file, making the folder if need be, never over one already there; answers whether it did.
    write(fileName: string, text: string): boolean;
    // Writes the Theme schema next to the Theme files.
    writeSchema(): void;
  };
  // The file at `path`, relative to the current directory, to Import a Theme from.
  readThemeSource(path: string): ThemeSource;
}

// Runs the command `argv` names, resolving to the exit code: 2, after the usage line, for a missing or unknown one.
export async function runCli (argv: string[], deps: CliDependencies): Promise<number> {
  const [command, subcommand] = argv
  if (command === 'dev') return deps.run('npm', ['run', 'dev'], deps.repoRoot)
  if (command === 'settings' && subcommand === undefined) return editSettings(deps)
  if (command === 'settings' && subcommand === 'open') return openSettings(deps)
  if (command === 'themes' && subcommand === 'import' && argv.length === 3) return importThemeFile(deps, argv[2])
  const force = subcommand === '--force'
  if (command === 'install' && (subcommand === undefined || force)) return install(deps, { force })
  if (command === 'link' && subcommand === undefined) return link(deps)
  deps.stderr(usage)
  return 2
}

// Links the repo's `blind` command again, which npm rebuilds first, as `npm link` runs the `prepare` script. Run from
// the repo's own `blind`, so it refreshes an existing link but can't make the first one.
async function link ({ repoRoot, run, stdout }: CliDependencies) {
  const exitCode = await run('npm', ['link'], repoRoot)
  if (exitCode === 0) stdout('Linked.\n')
  return exitCode
}

// Where `npm run install-app` puts Blind.
export const installedApp = '/Applications/Blind.app'

// What `blind install` names the stash it keeps uncommitted changes in during the build.
const installStashMessage = 'blind install: uncommitted changes'

// Builds the last commit, with any uncommitted changes stashed meanwhile, and puts it in /Applications. The changes are
// put back however the build ends, a Ctrl+C included, as the build's command takes it and exits; failing that, the exit
// code is the build's, or 1 after a build that succeeded, and Blind must not restart.
async function buildCommitted ({ repoRoot, run, uncommittedChanges, stderr }: CliDependencies) {
  const changes = await uncommittedChanges()
  if (changes.length === 0) return run('npm', ['run', 'install-app'], repoRoot)
  stderr([
    'Building the last commit only. These uncommitted changes are stashed during the build, then put back:',
    ...changes.map((change) => `  ${change}`),
    'A running `blind dev` reloads onto the last commit meanwhile.',
    '',
  ].join('\n'))
  const stashExitCode = await run('git', ['stash', 'push', '--include-untracked', '-m', installStashMessage], repoRoot)
  if (stashExitCode !== 0) return stashExitCode
  const installExitCode = await run('npm', ['run', 'install-app'], repoRoot)
  if (await run('git', ['stash', 'pop', '--index'], repoRoot) === 0) return installExitCode
  stderr(
    "Couldn't put the uncommitted changes back, so Blind wasn't restarted. They're still stashed as " +
      `"${installStashMessage}": find them with \`git stash list\`, then put them back with \`git stash pop --index\`.\n`
  )
  return installExitCode || 1
}

// Builds Blind and puts it in /Applications, then has a running Blind restart into the new copy: by asking it, which it
// confirms like quitting, or with `force`, by stopping it, which it doesn't ask about, and launching it again. The URL
// goes to the installed app by name, as another copy of Blind, e.g. one built into the repo, may take `blind:` URLs too.
async function install (deps: CliDependencies, { force }: { force: boolean }) {
  const { run, runningBlindPid, relaunchAfterExit, terminate, stdout, stderr } = deps
  const installExitCode = await buildCommitted(deps)
  if (installExitCode !== 0) return installExitCode
  const pid = await runningBlindPid()
  if (pid === undefined) {
    stdout('Installed.\n')
    return 0
  }
  if (force) {
    relaunchAfterExit(pid)
    terminate(pid)
    stdout('Installed. Blind is restarting.\n')
    return 0
  }
  const askExitCode = await run('open', ['-a', installedApp, 'blind://restart'])
  if (askExitCode === 0) stdout('Installed. Blind restarts once you confirm quitting.\n')
  else stderr("Installed, but Blind couldn't be asked to restart; quit it and open it again to use the new copy.\n")
  return askExitCode
}

// Imports a Theme into the themes folder, checked against the Themes and files there, as the Command Palette's Import
// Theme does, though without showing the Theme before saving it. A file that couldn't be written, already reported, gets
// no schema.
function importThemeFile ({ themeFiles, readThemeSource, stdout, stderr }: CliDependencies, path: string) {
  const files = themeFiles.read()
  const themeImport = importTheme(readThemeSource(path), themeImportTargetFor(files, loadThemes(files)))
  if (themeImport.type === 'refused') {
    const { title, detail } = themeImportRefusalMessage(themeImport)
    stderr(`${title}. ${detail}\n`)
    return 1
  }
  if (!themeFiles.write(themeImport.fileName, themeImport.text)) return 1
  themeFiles.writeSchema()
  stdout(`Imported ${themeImport.name} to ${join(themeFiles.directory, themeImport.fileName)}.\n`)
  return 0
}

// $EDITOR goes through the shell, as it may carry its own arguments, e.g. `code --wait`. Without one, the file opens in
// its default app, as the Command Palette opens it. A file that couldn't be created, already reported, isn't opened.
async function openSettings ({ editor, configFile, run }: CliDependencies) {
  if (!configFile.createIfMissing()) return 1
  if (!editor) return run('open', [configFile.path])
  return run('/bin/sh', ['-c', `${editor} "$@"`, 'sh', configFile.path])
}
