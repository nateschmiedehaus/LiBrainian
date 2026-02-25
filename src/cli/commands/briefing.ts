import { parseArgs } from 'node:util';
import path from 'node:path';
import { generateAmbientBriefing, type AmbientBriefingTier } from '../../api/ambient_briefing.js';
import { CliError } from '../errors.js';

export interface BriefingCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function parseTier(value: unknown): AmbientBriefingTier {
  if (typeof value !== 'string' || value.trim().length === 0) return 'standard';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'micro' || normalized === 'standard' || normalized === 'deep') {
    return normalized;
  }
  throw new CliError(
    `Invalid --tier value "${String(value)}". Expected micro|standard|deep.`,
    'INVALID_ARGUMENT',
  );
}

function parseMaxTokens(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError('`--max-tokens` must be a positive integer.', 'INVALID_ARGUMENT');
  }
  return parsed;
}

export async function briefingCommand(options: BriefingCommandOptions): Promise<void> {
  const { values, positionals } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      tier: { type: 'string' },
      json: { type: 'boolean', default: false },
      'max-tokens': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const workspaceRoot = path.resolve(options.workspace);
  const scopePath = positionals[0] ?? '.';
  const tier = parseTier(values.tier);
  const maxTokens = parseMaxTokens(values['max-tokens']);
  const briefing = await generateAmbientBriefing({
    workspaceRoot,
    scopePath,
    tier,
    maxTokens,
  });

  if (values.json) {
    console.log(JSON.stringify(briefing, null, 2));
    return;
  }

  console.log(briefing.markdown);
}
