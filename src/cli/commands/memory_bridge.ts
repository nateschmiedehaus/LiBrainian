import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.js';
import type { MemoryBridgeState } from '../../memory_bridge/entry.js';

export interface MemoryBridgeCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type MemoryBridgeAction = 'status';

interface MemoryBridgeStatusReport {
  success: boolean;
  action: MemoryBridgeAction;
  workspace: string;
  memoryFilePath: string;
  stateFilePath: string;
  stateExists: boolean;
  updatedAt?: string;
  totalEntries: number;
  activeEntries: number;
  defeatedEntries: number;
}

const STATE_FILE_NAME = '.librainian-memory-bridge.json';

function toAction(value: string | undefined): MemoryBridgeAction {
  if (value === 'status') return value;
  throw new CliError(
    `Unknown or missing action: ${value ?? '<none>'}. Usage: librarian memory-bridge <status> [--memory-file <path>] [--json]`,
    'INVALID_ARGUMENT',
  );
}

function resolveMemoryFilePath(workspace: string, raw: string | undefined): string {
  const value = raw?.trim();
  if (value && value.length > 0) {
    return path.resolve(value);
  }
  return path.join(path.resolve(workspace), '.openclaw', 'memory', 'MEMORY.md');
}

async function loadState(stateFilePath: string): Promise<MemoryBridgeState | null> {
  try {
    const raw = await fs.readFile(stateFilePath, 'utf8');
    const parsed = JSON.parse(raw) as MemoryBridgeState;
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function toStatusReport(
  workspace: string,
  memoryFilePath: string,
  stateFilePath: string,
  state: MemoryBridgeState | null,
): MemoryBridgeStatusReport {
  const now = Date.now();
  const entries = state?.entries ?? [];
  const defeatedEntries = entries.filter((entry) => typeof entry.defeatedBy === 'string').length;
  const activeEntries = entries.filter((entry) => {
    if (entry.defeatedBy) return false;
    if (!entry.validUntil) return true;
    const validUntil = Date.parse(entry.validUntil);
    if (!Number.isFinite(validUntil)) return true;
    return validUntil >= now;
  }).length;

  return {
    success: true,
    action: 'status',
    workspace: path.resolve(workspace),
    memoryFilePath,
    stateFilePath,
    stateExists: Boolean(state),
    updatedAt: state?.updatedAt,
    totalEntries: entries.length,
    activeEntries,
    defeatedEntries,
  };
}

function printTextReport(report: MemoryBridgeStatusReport): void {
  console.log('librainian memory-bridge status');
  console.log('===============================');
  console.log(`Workspace: ${report.workspace}`);
  console.log(`Memory file: ${report.memoryFilePath}`);
  console.log(`State file: ${report.stateFilePath}`);
  console.log(`State exists: ${report.stateExists ? 'yes' : 'no'}`);
  if (report.updatedAt) {
    console.log(`Updated: ${report.updatedAt}`);
  }
  console.log(`Total entries: ${report.totalEntries}`);
  console.log(`Active entries: ${report.activeEntries}`);
  console.log(`Defeated entries: ${report.defeatedEntries}`);
}

export async function memoryBridgeCommand(options: MemoryBridgeCommandOptions): Promise<void> {
  const { values, positionals } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      'memory-file': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const action = toAction(positionals[0] ?? options.args[0]);
  if (action !== 'status') {
    throw new CliError(
      `Unsupported memory-bridge action: ${action}`,
      'INVALID_ARGUMENT',
    );
  }

  const memoryFilePath = resolveMemoryFilePath(
    options.workspace,
    typeof values['memory-file'] === 'string' ? values['memory-file'] : undefined,
  );
  const stateFilePath = path.join(path.dirname(memoryFilePath), STATE_FILE_NAME);
  const state = await loadState(stateFilePath);
  const report = toStatusReport(options.workspace, memoryFilePath, stateFilePath, state);
  const jsonMode = Boolean(values.json) || options.rawArgs.includes('--json');

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printTextReport(report);
}
