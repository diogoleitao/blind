const usage = 'usage: blind settings [open] | blind dev | blind install\n'

export interface CliDependencies {
  // The repo the CLI was built from.
  repoRoot: string;
  // $EDITOR, if set.
  editor: string | undefined;
  // The installed app's config file.
  configFile: {
    path: string;
    // Writes the starter config, leaving an existing file alone; answers whether there's a file afterwards.
    createIfMissing(): boolean;
  };
  // Runs the command in `cwd`, or the current directory without one, with this process's input and output, resolving
  // to its exit code.
  run(command: string, args: string[], cwd?: string): Promise<number>;
  stderr(text: string): void;
}

// Runs the command `argv` names, resolving to the exit code: 2, after the usage line, for a missing or unknown one.
export async function runCli (argv: string[], deps: CliDependencies): Promise<number> {
  const [command, subcommand] = argv
  if (command === 'dev') return deps.run('npm', ['run', 'dev'], deps.repoRoot)
  if (command === 'settings' && subcommand === 'open') return openSettings(deps)
  deps.stderr(usage)
  return 2
}

// $EDITOR goes through the shell, as it may carry its own arguments, e.g. `code --wait`. Without one, the file opens in
// its default app, as the Command Palette opens it. A file that couldn't be created, already reported, isn't opened.
async function openSettings ({ editor, configFile, run }: CliDependencies) {
  if (!configFile.createIfMissing()) return 1
  if (!editor) return run('open', [configFile.path])
  return run('/bin/sh', ['-c', `${editor} "$@"`, 'sh', configFile.path])
}
