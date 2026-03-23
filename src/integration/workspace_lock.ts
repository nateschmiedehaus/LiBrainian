import fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'path';
import { safeJsonParse } from '../utils/safe_json.js';

export interface WorkspaceLockState { pid: number; startedAt: string; }
export interface WorkspaceLockHandle { lockPath: string; state: WorkspaceLockState; release: () => Promise<void>; }
export interface WorkspaceLockOptions { timeoutMs?: number; pollIntervalMs?: number; }

const DEFAULT_TIMEOUT_MS = 0;
const DEFAULT_POLL_INTERVAL_MS = 200;
const registeredLocks = new Map<string, WorkspaceLockState>();
let globalCleanupRegistered = false;
const isTestMode = (): boolean => process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true';

type LockReadResult =
  | { kind: 'ok'; state: WorkspaceLockState }
  | { kind: 'missing' }
  | { kind: 'corrupt'; details: string }
  | { kind: 'unreadable'; details: string };

export async function acquireWorkspaceLock(workspaceRoot: string, options: WorkspaceLockOptions = {}): Promise<WorkspaceLockHandle> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS; const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const lockPath = resolveLockPath(workspaceRoot); await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    const state: WorkspaceLockState = { pid: process.pid, startedAt: new Date().toISOString() };
    try {
      await fs.writeFile(lockPath, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' });
      registerLockCleanup(lockPath, state);
      if (isTestMode()) {
        const confirmed = await readLockState(lockPath);
        if (!confirmed || confirmed.kind !== 'ok' || confirmed.state.pid !== state.pid || confirmed.state.startedAt !== state.startedAt) {
          await releaseWorkspaceLock(lockPath, state);
          throw new Error('Tier-0: workspace lock not persisted');
        }
      }
      return { lockPath, state, release: () => releaseWorkspaceLock(lockPath, state) };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
    const existing = await readLockState(lockPath);
    if (!existing) continue;
    if (existing.kind === 'corrupt' || existing.kind === 'unreadable') {
      throw new Error(
        `unverified_by_trace(lease_conflict): bootstrap lock exists but is ${existing.kind}. ` +
          `Refusing to delete it automatically. ${existing.details} ` +
          'Inspect `.librarian/bootstrap.lock` or run `librainian doctor` before retrying.'
      );
    }
    if (existing.kind === 'ok' && !isPidAlive(existing.state.pid)) { await removeLockFile(lockPath); continue; }
    await sleep(pollIntervalMs);
  }
  const existing = await readLockState(lockPath);
  const details = existing?.kind === 'ok'
    ? ` (pid=${existing.state.pid}, startedAt=${existing.state.startedAt})`
    : existing?.kind === 'corrupt' || existing?.kind === 'unreadable'
      ? ` (${existing.details})`
      : '';
  throw new Error(
    `unverified_by_trace(lease_conflict): timed out waiting for librainian bootstrap lock${details}. ` +
      'If this is stale, delete `.librarian/bootstrap.lock` or run `librainian doctor`.'
  );
}

export async function cleanupWorkspaceLock(workspaceRoot: string): Promise<void> {
  const lockPath = resolveLockPath(workspaceRoot); const existing = await readLockState(lockPath);
  if (!existing || existing.kind !== 'ok') return;
  if (existing.state.pid === process.pid || !isPidAlive(existing.state.pid)) {
    const removed = await removeLockFile(lockPath);
    if (removed) registeredLocks.delete(lockPath);
    if (isTestMode() && !removed) throw new Error('Tier-0: workspace lock cleanup failed');
  }
}

async function releaseWorkspaceLock(lockPath: string, expected: WorkspaceLockState): Promise<void> {
  const current = await readLockState(lockPath);
  if (!current || current.kind !== 'ok') return;
  if (current.state.pid !== expected.pid || current.state.startedAt !== expected.startedAt) return;
  const removed = await removeLockFile(lockPath);
  if (removed) registeredLocks.delete(lockPath);
  if (isTestMode() && !removed) throw new Error('Tier-0: workspace lock cleanup failed');
}

function registerLockCleanup(lockPath: string, state: WorkspaceLockState): void {
  if (registeredLocks.has(lockPath)) return;
  registeredLocks.set(lockPath, state);
  ensureGlobalCleanupHandlers();
}

const resolveLockPath = (workspaceRoot: string): string => path.join(workspaceRoot, '.librarian', 'bootstrap.lock');

function ensureGlobalCleanupHandlers(): void {
  if (globalCleanupRegistered) return;
  globalCleanupRegistered = true;

  const cleanupAllSync = () => {
    for (const [lockPath, state] of registeredLocks.entries()) {
      releaseWorkspaceLockSync(lockPath, state);
    }
  };

  process.once('exit', cleanupAllSync);
  process.once('SIGINT', () => {
    cleanupAllSync();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanupAllSync();
    process.exit(143);
  });
}

async function removeLockFile(lockPath: string): Promise<boolean> {
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    return isFileNotFound(error);
  }
}

async function readLockState(lockPath: string): Promise<LockReadResult | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    return parseLockState(raw);
  } catch (error) {
    return isFileNotFound(error)
      ? null
      : { kind: 'unreadable', details: `failed to read lock file: ${formatLockReadError(error)}` };
  }
}

function readLockStateSync(lockPath: string): LockReadResult | null {
  try {
    const raw = fsSync.readFileSync(lockPath, 'utf8');
    return parseLockState(raw);
  } catch (error) {
    return isFileNotFound(error)
      ? null
      : { kind: 'unreadable', details: `failed to read lock file: ${formatLockReadError(error)}` };
  }
}

function parseLockState(raw: string): LockReadResult {
  const parsed = safeJsonParse<{ pid?: number; startedAt?: string }>(raw);
  if (parsed.ok && typeof parsed.value.pid === 'number' && typeof parsed.value.startedAt === 'string') {
    return { kind: 'ok', state: { pid: parsed.value.pid, startedAt: parsed.value.startedAt } };
  }
  const fallbackPid = Number.parseInt(raw.trim(), 10);
  if (Number.isFinite(fallbackPid)) {
    return { kind: 'ok', state: { pid: fallbackPid, startedAt: 'unknown' } };
  }
  return { kind: 'corrupt', details: 'lock file contents are not valid JSON or legacy PID format' };
}

function releaseWorkspaceLockSync(lockPath: string, expected: WorkspaceLockState): void {
  const current = readLockStateSync(lockPath);
  if (!current || current.kind !== 'ok') return;
  if (current.state.pid !== expected.pid || current.state.startedAt !== expected.startedAt) return;
  try {
    fsSync.unlinkSync(lockPath);
    registeredLocks.delete(lockPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

function formatLockReadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EEXIST');
}
function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
