import { editSettings, type SettingsEditorDependencies } from './settings-editor'

const usage = 'usage: blind settings [open] | blind dev | blind install\n'

export interface CliDependencies extends SettingsEditorDependencies {
  // The repo the CLI was built from.
  repoRoot: string;
  // $EDITOR, if set.
  editor: string | undefined;
  // Runs the command in `cwd`, or the current directory without one, with this process's input and output, resolving
  // to its exit code.
  run(command: string, args: string[], cwd?: string): Promise<number>;
  // The installed Blind's process, while it's running; the one running from the repo is never it.
  runningBlindPid(): Promise<number | undefined>;
  // Has the installed Blind launched once the process has exited, by something that outlives this command and the Shell
  // it runs in, which Blind quitting stops.
  relaunchAfterExit(pid: number): void;
  // Asks the process to stop, which Blind does by saving and quitting without asking.
  terminate(pid: number): void;
}

// Runs the command `argv` names, resolving to the exit code: 2, after the usage line, for a missing or unknown one.
export async function runCli (argv: string[], deps: CliDependencies): Promise<number> {
  const [command, subcommand] = argv
  if (command === 'dev') return deps.run('npm', ['run', 'dev'], deps.repoRoot)
  if (command === 'settings' && subcommand === undefined) return editSettings(deps)
  if (command === 'settings' && subcommand === 'open') return openSettings(deps)
  const force = subcommand === '--force'
  if (command === 'install' && (subcommand === undefined || force)) return install(deps, { force })
  deps.stderr(usage)
  return 2
}

// Where `npm run install-app` puts Blind.
export const installedApp = '/Applications/Blind.app'

// Builds Blind and puts it in /Applications, then has a running Blind restart into the new copy: by asking it, which it
// confirms like quitting, or with `force`, by stopping it, which it doesn't ask about, and launching it again. The URL
// goes to the installed app by name, as another copy of Blind, e.g. one built into the repo, may take `blind:` URLs too.
async function install (deps: CliDependencies, { force }: { force: boolean }) {
  const { repoRoot, run, runningBlindPid, relaunchAfterExit, terminate, stdout, stderr } = deps
  const installExitCode = await run('npm', ['run', 'install-app'], repoRoot)
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

// $EDITOR goes through the shell, as it may carry its own arguments, e.g. `code --wait`. Without one, the file opens in
// its default app, as the Command Palette opens it. A file that couldn't be created, already reported, isn't opened.
async function openSettings ({ editor, configFile, run }: CliDependencies) {
  if (!configFile.createIfMissing()) return 1
  if (!editor) return run('open', [configFile.path])
  return run('/bin/sh', ['-c', `${editor} "$@"`, 'sh', configFile.path])
}
