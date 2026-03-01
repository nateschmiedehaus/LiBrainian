const CLI_NON_EXITING_COMMANDS = new Set(['watch', 'mcp']);

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function shouldForceCliExit(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  if (CLI_NON_EXITING_COMMANDS.has(normalizedCommand)) return false;

  return isTruthyFlag(env.LIBRARIAN_FORCE_PROCESS_EXIT) || isTruthyFlag(env.LIBRARIAN_FORCE_EXIT);
}

