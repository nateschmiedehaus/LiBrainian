import * as fs from 'node:fs/promises';
import path from 'node:path';
import { safeJsonParse } from './safe_json.js';
import { resolveWorkspaceRoot } from './workspace_resolver.js';

export type ProviderName = 'claude' | 'codex';

export type ProviderFailureReason =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'auth_failed'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'unavailable'
  | 'unknown';

export interface ProviderFailureRecord {
  provider: ProviderName;
  reason: ProviderFailureReason;
  message: string;
  at: string;
  ttlMs: number;
}

export interface ProviderFailureState {
  kind: 'ProviderFailureState.v1';
  schema_version: 1;
  updated_at: string;
  failures: Partial<Record<ProviderName, ProviderFailureRecord>>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_TTL_MS = 15 * 60 * 1000;
const QUOTA_TTL_MS = 60 * 60 * 1000;
const SHORT_TTL_MS = 5 * 60 * 1000;

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFailurePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'state', 'audits', 'librarian', 'provider', 'provider_failures.json');
}

export function resolveProviderWorkspaceRoot(cwd: string = process.cwd()): string {
  if (process.env.LIBRARIAN_WORKSPACE_ROOT) {
    return path.resolve(process.env.LIBRARIAN_WORKSPACE_ROOT);
  }
  return resolveWorkspaceRoot(cwd).workspace;
}

export function classifyProviderFailure(message: string): { reason: ProviderFailureReason; ttlMs: number } {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('inside another claude code session')
    || normalized.includes('cannot be launched inside another')
    || normalized.includes('nested session')
    || normalized.includes('agent-inside-agent')
  ) {
    return { reason: 'unavailable', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_UNAVAILABLE_MS', DEFAULT_TTL_MS) };
  }
  if (
    normalized.includes('rate limit')
    || normalized.includes('rate_limit')
    || normalized.includes('429')
    || normalized.includes('limit reached')
  ) {
    return { reason: 'rate_limit', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_RATE_LIMIT_MS', RATE_LIMIT_TTL_MS) };
  }
  if (normalized.includes('quota') || normalized.includes('exceeded')) {
    return { reason: 'quota_exceeded', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_QUOTA_MS', QUOTA_TTL_MS) };
  }
  if (normalized.includes('auth') || normalized.includes('unauthorized') || normalized.includes('not authenticated')) {
    return { reason: 'auth_failed', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_AUTH_MS', DEFAULT_TTL_MS) };
  }
  if (normalized.includes('timeout')) {
    return { reason: 'timeout', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_TIMEOUT_MS', SHORT_TTL_MS) };
  }
  if (normalized.includes('network') || normalized.includes('econn') || normalized.includes('enet')) {
    return { reason: 'network_error', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_NETWORK_MS', SHORT_TTL_MS) };
  }
  if (normalized.includes('invalid') || normalized.includes('schema')) {
    return { reason: 'invalid_response', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_INVALID_MS', DEFAULT_TTL_MS) };
  }
  if (normalized.includes('unknown model') || normalized.includes('unsupported model')) {
    return { reason: 'invalid_response', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_INVALID_MS', DEFAULT_TTL_MS) };
  }
  if (normalized.includes('unavailable')) {
    return { reason: 'unavailable', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_UNAVAILABLE_MS', DEFAULT_TTL_MS) };
  }
  return { reason: 'unknown', ttlMs: readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_MS', DEFAULT_TTL_MS) };
}

async function readFailureState(workspaceRoot: string): Promise<ProviderFailureState | null> {
  try {
    const raw = await fs.readFile(resolveFailurePath(workspaceRoot), 'utf8');
    const parsed = safeJsonParse<ProviderFailureState>(raw);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

async function writeFailureState(workspaceRoot: string, state: ProviderFailureState): Promise<void> {
  const targetPath = resolveFailurePath(workspaceRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function isExpired(record: ProviderFailureRecord, nowMs: number): boolean {
  const timestamp = Date.parse(record.at);
  if (!Number.isFinite(timestamp)) return true;
  return nowMs - timestamp > record.ttlMs;
}

export async function getActiveProviderFailures(
  workspaceRoot: string,
  nowMs: number = Date.now()
): Promise<Partial<Record<ProviderName, ProviderFailureRecord>>> {
  const state = await readFailureState(workspaceRoot);
  if (!state?.failures) return {};
  const failures: Partial<Record<ProviderName, ProviderFailureRecord>> = { ...state.failures };
  let changed = false;
  for (const provider of Object.keys(failures) as ProviderName[]) {
    const record = failures[provider];
    if (!record) continue;
    if (isExpired(record, nowMs)) {
      delete failures[provider];
      changed = true;
    }
  }
  if (changed) {
    await writeFailureState(workspaceRoot, {
      kind: 'ProviderFailureState.v1',
      schema_version: 1,
      updated_at: new Date().toISOString(),
      failures,
    });
  }
  return failures;
}

export async function recordProviderFailure(
  workspaceRoot: string,
  record: ProviderFailureRecord
): Promise<void> {
  const state = await readFailureState(workspaceRoot);
  const failures = { ...(state?.failures ?? {}) };
  failures[record.provider] = record;
  await writeFailureState(workspaceRoot, {
    kind: 'ProviderFailureState.v1',
    schema_version: 1,
    updated_at: new Date().toISOString(),
    failures,
  });
}

export async function recordProviderSuccess(workspaceRoot: string, provider: ProviderName): Promise<void> {
  const state = await readFailureState(workspaceRoot);
  const failures = { ...(state?.failures ?? {}) };
  if (!failures[provider]) return;
  delete failures[provider];
  await writeFailureState(workspaceRoot, {
    kind: 'ProviderFailureState.v1',
    schema_version: 1,
    updated_at: new Date().toISOString(),
    failures,
  });
}
