const WORKSPACE_POSITIONAL_COMMANDS = new Set([
  'status',
  'stats',
  'bootstrap',
  'generate-docs',
  'uninstall',
  'quickstart',
  'setup',
  'init',
  'doctor',
  'check',
  'publish-gate',
  'diagnose',
  'health',
  'check-providers',
  'privacy-report',
  'features',
  'watch',
]);

const CHECK_SUBCOMMANDS = new Set([
  'completeness',
]);

function hasWorkspaceFlag(rawArgs: string[]): boolean {
  return rawArgs.includes('--workspace') || rawArgs.includes('-w');
}

export function resolveWorkspaceArg(options: {
  command: string | undefined;
  commandArgs: string[];
  rawArgs: string[];
  defaultWorkspace: string;
}): { workspace: string; commandArgs: string[] } {
  const { command, commandArgs, rawArgs, defaultWorkspace } = options;
  if (!command || !WORKSPACE_POSITIONAL_COMMANDS.has(command)) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  if (hasWorkspaceFlag(rawArgs)) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  const candidate = commandArgs[0];
  if (!candidate || candidate.startsWith('-')) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  if (command === 'check' && CHECK_SUBCOMMANDS.has(candidate.toLowerCase())) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  const commandIndex = rawArgs.indexOf(command);
  if (commandIndex === -1) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  const immediateToken = rawArgs[commandIndex + 1];
  if (immediateToken !== candidate) {
    return { workspace: defaultWorkspace, commandArgs };
  }
  return { workspace: candidate, commandArgs: commandArgs.slice(1) };
}
