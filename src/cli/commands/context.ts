/**
 * @fileoverview Context command - Focused deep-retrieval context on a topic
 *
 * This command is an alias for `query --depth L3`. It exists to match the
 * documented patrol agent workflow (`librainian context "topic"`) and provide
 * a semantically meaningful entry point for agents seeking focused context
 * on a specific topic, module, or concept.
 */

import { queryCommand } from './query.js';

export interface ContextCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

/**
 * Context command: focused deep retrieval for a topic.
 *
 * Delegates to `queryCommand` with `--depth L3` injected by default
 * (unless the caller already specifies `--depth`).
 */
export async function contextCommand(options: ContextCommandOptions): Promise<void> {
  const { workspace, args, rawArgs } = options;

  // Inject --depth L3 if no --depth flag is already present
  const hasDepth = rawArgs.includes('--depth') || args.includes('--depth');
  const augmentedArgs = hasDepth ? args : [...args, '--depth', 'L3'];
  const augmentedRawArgs = hasDepth ? rawArgs : [...rawArgs, '--depth', 'L3'];

  await queryCommand({
    workspace,
    args: augmentedArgs,
    rawArgs: augmentedRawArgs,
  });
}
