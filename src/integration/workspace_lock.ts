import * as fs from 'fs/promises';
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
        if (!confirmed || confirmed.pid !== state.pid || confirmed.startedAt !== state.startedAt) {
          await releaseWorkspaceLock(lockPath, state);
          throw new Error('Tier-0: workspace lock not persisted');
        }
      }
      return { lockPath, state, release: () => releaseWorkspaceLock(lockPath, state) };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
    const existing = await readLockState(lockPath);
    if (!existing || !isPidAlive(existing.pid)) { await removeLockFile(lockPath); continue; }
    await sleep(pollIntervalMs);
  }
  const existing = await readLockState(lockPath);
  const details = existing ? ` (pid=${existing.pid}, startedAt=${existing.startedAt})` : '';
  throw new Error(
    `unverified_by_trace(lease_conflict): timed out waiting for LiBrainian bootstrap lock${details}. ` +
      'If this is stale, delete `.librarian/bootstrap.lock` or run `librainian doctor --heal`.'
  );
}

export async function cleanupWorkspaceLock(workspaceRoot: string): Promise<void> {
  const lockPath = resolveLockPath(workspaceRoot); const existing = await readLockState(lockPath);
  if (!existing) return;
  if (existing.pid === process.pid || !isPidAlive(existing.pid)) {
    const removed = await removeLockFile(lockPath);
    if (removed) registeredLocks.delete(lockPath);
    if (isTestMode() && !removed) throw new Error('Tier-0: workspace lock cleanup failed');
  }
}

async function releaseWorkspaceLock(lockPath: string, expected: WorkspaceLockState): Promise<void> {
  const current = await readLockState(lockPath);
  if (!current || current.pid !== expected.pid || current.startedAt !== expected.startedAt) return;
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

  const cleanupAll = () => {
    for (const [lockPath, state] of registeredLocks.entries()) {
      void releaseWorkspaceLock(lockPath, state);
    }
  };

  process.once('exit', cleanupAll);
  process.once('SIGINT', cleanupAll);
  process.once('SIGTERM', cleanupAll);
}

async function removeLockFile(lockPath: string): Promise<boolean> {
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    return isFileNotFound(error);
  }
}

async function readLockState(lockPath: string): Promise<WorkspaceLockState | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = safeJsonParse<{ pid?: number; startedAt?: string }>(raw);
    if (parsed.ok && typeof parsed.value.pid === 'number' && typeof parsed.value.startedAt === 'string') {
      return { pid: parsed.value.pid, startedAt: parsed.value.startedAt };
    }
    const fallbackPid = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(fallbackPid) ? { pid: fallbackPid, startedAt: 'unknown' } : null;
  } catch (error) {
    return isFileNotFound(error) ? null : null;
  }
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
