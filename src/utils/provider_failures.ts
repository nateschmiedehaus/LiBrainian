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
const VALID_FAILURE_REASONS: ReadonlySet<ProviderFailureReason> = new Set([
  'rate_limit',
  'quota_exceeded',
  'auth_failed',
  'timeout',
  'network_error',
  'invalid_response',
  'unavailable',
  'unknown',
]);

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

function resolveTtlForReason(reason: ProviderFailureReason): number {
  switch (reason) {
    case 'rate_limit':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_RATE_LIMIT_MS', RATE_LIMIT_TTL_MS);
    case 'quota_exceeded':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_QUOTA_MS', QUOTA_TTL_MS);
    case 'timeout':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_TIMEOUT_MS', SHORT_TTL_MS);
    case 'network_error':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_NETWORK_MS', SHORT_TTL_MS);
    case 'invalid_response':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_INVALID_MS', DEFAULT_TTL_MS);
    case 'auth_failed':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_AUTH_MS', DEFAULT_TTL_MS);
    case 'unavailable':
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_UNAVAILABLE_MS', DEFAULT_TTL_MS);
    default:
      return readEnvNumber('LIBRARIAN_PROVIDER_FAILURE_TTL_MS', DEFAULT_TTL_MS);
  }
}

export function classifyProviderFailure(message: string): { reason: ProviderFailureReason; ttlMs: number } {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('inside another claude code session')
    || normalized.includes('cannot be launched inside another')
    || normalized.includes('nested session')
    || normalized.includes('agent-inside-agent')
  ) {
    return { reason: 'unavailable', ttlMs: resolveTtlForReason('unavailable') };
  }
  if (
    normalized.includes('rate limit')
    || normalized.includes('rate_limit')
    || normalized.includes('429')
    || normalized.includes('limit reached')
  ) {
    return { reason: 'rate_limit', ttlMs: resolveTtlForReason('rate_limit') };
  }
  if (
    normalized.includes('quota')
    || normalized.includes('insufficient_quota')
    || normalized.includes('billing')
    || normalized.includes('credits exhausted')
  ) {
    return { reason: 'quota_exceeded', ttlMs: resolveTtlForReason('quota_exceeded') };
  }
  if (normalized.includes('auth') || normalized.includes('unauthorized') || normalized.includes('not authenticated')) {
    return { reason: 'auth_failed', ttlMs: resolveTtlForReason('auth_failed') };
  }
  if (normalized.includes('timeout')) {
    return { reason: 'timeout', ttlMs: resolveTtlForReason('timeout') };
  }
  if (normalized.includes('network') || normalized.includes('econn') || normalized.includes('enet')) {
    return { reason: 'network_error', ttlMs: resolveTtlForReason('network_error') };
  }
  if (normalized.includes('invalid') || normalized.includes('schema')) {
    return { reason: 'invalid_response', ttlMs: resolveTtlForReason('invalid_response') };
  }
  if (normalized.includes('unknown model') || normalized.includes('unsupported model')) {
    return { reason: 'invalid_response', ttlMs: resolveTtlForReason('invalid_response') };
  }
  if (normalized.includes('unavailable')) {
    return { reason: 'unavailable', ttlMs: resolveTtlForReason('unavailable') };
  }
  return { reason: 'unknown', ttlMs: resolveTtlForReason('unknown') };
}

function reasonHasEvidence(reason: ProviderFailureReason, message: string): boolean {
  const normalized = message.toLowerCase();
  switch (reason) {
    case 'rate_limit':
      return normalized.includes('rate limit') || normalized.includes('rate_limit') || normalized.includes('429');
    case 'quota_exceeded':
      return normalized.includes('quota') || normalized.includes('billing') || normalized.includes('insufficient_quota');
    case 'auth_failed':
      return normalized.includes('auth')
        || normalized.includes('unauthorized')
        || normalized.includes('not authenticated')
        || normalized.includes('missing bearer token')
        || normalized.includes('login');
    case 'timeout':
      return normalized.includes('timeout') || normalized.includes('timed out');
    case 'network_error':
      return normalized.includes('network')
        || normalized.includes('econn')
        || normalized.includes('enet')
        || normalized.includes('connection refused');
    case 'invalid_response':
      return normalized.includes('invalid')
        || normalized.includes('schema')
        || normalized.includes('unsupported model')
        || normalized.includes('unknown model')
        || normalized.includes('malformed');
    case 'unavailable':
      return normalized.includes('unavailable')
        || normalized.includes('cannot run')
        || normalized.includes('cannot be launched')
        || normalized.includes('inside nested')
        || normalized.includes('nested claude code')
        || normalized.includes('provider unavailable');
    case 'unknown':
      return true;
    default:
      return false;
  }
}

function normalizeReason(reason: ProviderFailureReason, message: string): ProviderFailureReason {
  if (reason === 'unknown') return reason;
  return reasonHasEvidence(reason, message) ? reason : 'unknown';
}

function normalizePersistedFailureRecord(
  provider: ProviderName,
  record: ProviderFailureRecord,
  nowIso: string
): ProviderFailureRecord {
  const message = String(record.message ?? '').trim();
  const safeMessage = message || `${provider} provider call failed without diagnostic output`;
  const rawReason = typeof record.reason === 'string' && VALID_FAILURE_REASONS.has(record.reason as ProviderFailureReason)
    ? record.reason as ProviderFailureReason
    : 'unknown';
  const reason = normalizeReason(rawReason, safeMessage);
  const parsedAt = Date.parse(record.at);
  const at = Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : nowIso;
  const ttlMs = Number.isFinite(record.ttlMs) && record.ttlMs > 0 ? record.ttlMs : resolveTtlForReason(reason);
  return {
    provider,
    reason,
    message: safeMessage,
    at,
    ttlMs,
  };
}

function recordsEqual(left: ProviderFailureRecord, right: ProviderFailureRecord): boolean {
  return left.provider === right.provider
    && left.reason === right.reason
    && left.message === right.message
    && left.at === right.at
    && left.ttlMs === right.ttlMs;
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
  const nowIso = new Date(nowMs).toISOString();
  let changed = false;
  for (const provider of Object.keys(failures) as ProviderName[]) {
    const record = failures[provider];
    if (!record) continue;
    const normalized = normalizePersistedFailureRecord(provider, record, nowIso);
    if (!recordsEqual(record, normalized)) {
      failures[provider] = normalized;
      changed = true;
    }
    if (isExpired(normalized, nowMs)) {
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
  failures[record.provider] = normalizePersistedFailureRecord(record.provider, record, new Date().toISOString());
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
