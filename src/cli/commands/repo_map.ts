import { parseArgs } from 'node:util';
import path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { generateRepoMap, type RepoMapStyle } from '../../api/repo_map.js';
import { CliError } from '../errors.js';

export interface RepoMapCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function parseStyle(value: unknown): RepoMapStyle {
  const normalized = String(value ?? 'compact').trim().toLowerCase();
  if (normalized === 'compact' || normalized === 'detailed' || normalized === 'json') {
    return normalized;
  }
  throw new CliError(
    `Invalid --style value "${String(value)}". Expected compact|detailed|json.`,
    'INVALID_ARGUMENT',
  );
}

function parseFocus(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseMaxTokens(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError('`--max-tokens` must be a positive integer.', 'INVALID_ARGUMENT');
  }
  return parsed;
}

export async function repoMapCommand(options: RepoMapCommandOptions): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      style: { type: 'string' },
      focus: { type: 'string' },
      'max-tokens': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const workspaceRoot = path.resolve(options.workspace);
  const style = parseStyle(values.style);
  const maxTokens = parseMaxTokens(values['max-tokens']);
  const focus = parseFocus(values.focus);
  const jsonMode = Boolean(values.json) || style === 'json';

  const dbPath = await resolveDbPath(workspaceRoot);
  const storage = createSqliteStorage(dbPath, workspaceRoot);
  await storage.initialize();

  try {
    const result = await generateRepoMap(storage, workspaceRoot, {
      style: jsonMode ? 'json' : style,
      maxTokens,
      focus,
    });
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(result.text ?? '');
  } finally {
    await storage.close();
  }
}
