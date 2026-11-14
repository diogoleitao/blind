const usage = 'usage: blind settings [open] | blind dev | blind install\n'

export interface CliDependencies {
  // The repo the CLI was built from.
  repoRoot: string;
  // Runs the command in `cwd` with this process's input and output, resolving to its exit code.
  run(command: string, args: string[], cwd: string): Promise<number>;
  stderr(text: string): void;
}

// Runs the command `argv` names, resolving to the exit code: 2, after the usage line, for a missing or unknown one.
export async function runCli (argv: string[], deps: CliDependencies): Promise<number> {
  const [command] = argv
  if (command === 'dev') return deps.run('npm', ['run', 'dev'], deps.repoRoot)
  deps.stderr(usage)
  return 2
}
