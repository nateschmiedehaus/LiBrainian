import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { logWarning, logInfo } from '../telemetry/logger.js';

export interface StorageRecoveryResult {
  recovered: boolean;
  actions: string[];
  errors: string[];
}

export interface StorageRecoveryOptions {
  error?: unknown;
}

const LOCK_STALE_TIMEOUT_MS = 15 * 60_000;
const LOCK_DIR_RECOVERY_TIMEOUT_MS = 2 * 60_000;
const LOCK_EMPTY_DIR_RECOVERY_TIMEOUT_MS = 20_000;
const LOCK_PID_UNKNOWN_RECOVERY_TIMEOUT_MS = 5_000;
const WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS = 2 * 60 * 60_000;
const WORKSPACE_LOCK_DIRECTORIES = ['.librarian/locks', '.librarian/swarm/locks'] as const;

export interface WorkspaceLockInspection {
  lockDirs: string[];
  scannedFiles: number;
  staleFiles: number;
  activePidFiles: number;
  unknownFreshFiles: number;
  stalePaths: string[];
}

export interface WorkspaceLockCleanupResult extends WorkspaceLockInspection {
  removedFiles: number;
  errors: string[];
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM';
  }
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'number') return Number.isFinite(parsed) ? parsed : null;
      if (parsed && typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)) return parsed.pid;
    } catch {
      const asNumber = Number.parseInt(trimmed, 10);
      if (Number.isFinite(asNumber)) return asNumber;
    }
  } catch {
    return null;
  }
  return null;
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(lockPath);
    return Date.now() - stats.mtimeMs > LOCK_STALE_TIMEOUT_MS;
  } catch {
    return false;
  }
}

async function lockAgeMs(lockPath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(lockPath);
    return Math.max(0, Date.now() - stats.mtimeMs);
  } catch {
    return null;
  }
}

async function isLockDirectory(lockPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(lockPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function isEmptyDirectory(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function removeLockPath(lockPath: string): Promise<void> {
  const isDir = await isLockDirectory(lockPath);
  if (isDir) {
    await fs.rm(lockPath, { recursive: true, force: true });
    return;
  }
  await fs.unlink(lockPath);
}

export function isRecoverableStorageError(error: unknown): boolean {
  const message = String(error ?? '').toLowerCase();
  return message.includes('storage_locked')
    || message.includes('database is locked')
    || message.includes('sqlite_busy')
    || message.includes('lock compromised')
    || message.includes('wal')
    || message.includes('shm')
    || message.includes('sqlite_corrupt')
    || message.includes('database disk image is malformed')
    || message.includes('database malformed')
    || message.includes('malformed database')
    || message.includes('file is not a database')
    || message.includes('database schema is corrupt');
}

function isCorruptionStorageError(error: unknown): boolean {
  const message = String(error ?? '').toLowerCase();
  return message.includes('sqlite_corrupt')
    || message.includes('database disk image is malformed')
    || message.includes('database malformed')
    || message.includes('malformed database')
    || message.includes('file is not a database')
    || message.includes('database schema is corrupt');
}

export async function attemptStorageRecovery(
  dbPath: string,
  options: StorageRecoveryOptions = {}
): Promise<StorageRecoveryResult> {
  const actions: string[] = [];
  const errors: string[] = [];
  if (!dbPath || dbPath === ':memory:') {
    return { recovered: false, actions, errors: ['memory_storage'] };
  }

  const lockPath = `${dbPath}.lock`;
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  let lockBlocked = false;

  if (existsSync(lockPath)) {
    const pid = await readLockPid(lockPath);
    const isDir = await isLockDirectory(lockPath);
    const ageMs = await lockAgeMs(lockPath);
    if (pid !== null) {
      if (isPidAlive(pid)) {
        lockBlocked = true;
        errors.push(`lock_active:${pid}`);
      } else {
        await removeLockPath(lockPath).catch((error) => {
          errors.push(`lock_unlink_failed:${String(error)}`);
        });
        actions.push('removed_lock');
      }
    } else {
      const stale = await isLockStale(lockPath);
      const staleDir = isDir && ageMs !== null && ageMs > LOCK_DIR_RECOVERY_TIMEOUT_MS;
      const staleEmptyDir = isDir
        && ageMs !== null
        && ageMs > LOCK_EMPTY_DIR_RECOVERY_TIMEOUT_MS
        && await isEmptyDirectory(lockPath);
      const staleUnknownPid = !isDir
        && ageMs !== null
        && ageMs > LOCK_PID_UNKNOWN_RECOVERY_TIMEOUT_MS;
      if (stale || staleDir || staleEmptyDir || staleUnknownPid) {
        await removeLockPath(lockPath).catch((error) => {
          errors.push(`lock_unlink_failed:${String(error)}`);
        });
        actions.push('removed_lock');
      } else {
        lockBlocked = true;
        errors.push(`lock_pid_unknown${ageMs !== null ? `:${ageMs}` : ''}`);
      }
    }
  }

  if (!lockBlocked) {
    if (existsSync(walPath)) {
      await fs.unlink(walPath).catch((error) => {
        errors.push(`wal_unlink_failed:${String(error)}`);
      });
      actions.push('removed_wal');
    }
    if (existsSync(shmPath)) {
      await fs.unlink(shmPath).catch((error) => {
        errors.push(`shm_unlink_failed:${String(error)}`);
      });
      actions.push('removed_shm');
    }

    if (isCorruptionStorageError(options.error) && existsSync(dbPath)) {
      const quarantinePath = `${dbPath}.corrupt.${Date.now()}`;
      try {
        await fs.rename(dbPath, quarantinePath);
        actions.push('quarantined_corrupt_db');
      } catch (renameError) {
        errors.push(`db_quarantine_failed:${String(renameError)}`);
        await fs.unlink(dbPath).catch((unlinkError) => {
          errors.push(`db_unlink_failed:${String(unlinkError)}`);
        });
        if (!existsSync(dbPath)) {
          actions.push('removed_corrupt_db');
        }
      }
    }
  }

  if (actions.length > 0) {
    logInfo('[storage-recovery] applied recovery actions', { dbPath, actions });
  } else if (errors.length > 0) {
    logWarning('[storage-recovery] no recovery actions applied', { dbPath, errors });
  }

  return { recovered: actions.length > 0 && !lockBlocked, actions, errors };
}

async function inspectSingleWorkspaceLock(lockPath: string): Promise<{
  stale: boolean;
  activePid: boolean;
}> {
  const pid = await readLockPid(lockPath);
  const ageMs = await lockAgeMs(lockPath);
  if (pid !== null) {
    return {
      stale: !isPidAlive(pid),
      activePid: isPidAlive(pid),
    };
  }
  const stale = ageMs !== null && ageMs > WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS;
  return {
    stale,
    activePid: false,
  };
}

export async function inspectWorkspaceLocks(workspaceRoot: string): Promise<WorkspaceLockInspection> {
  const lockDirs = WORKSPACE_LOCK_DIRECTORIES.map((relativeDir) => path.join(workspaceRoot, relativeDir));
  const result: WorkspaceLockInspection = {
    lockDirs,
    scannedFiles: 0,
    staleFiles: 0,
    activePidFiles: 0,
    unknownFreshFiles: 0,
    stalePaths: [],
  };

  for (const lockDir of lockDirs) {
    if (!existsSync(lockDir)) continue;
    let entries: string[];
    try {
      entries = await fs.readdir(lockDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.lock')) continue;
      const lockPath = path.join(lockDir, entry);
      result.scannedFiles += 1;
      const inspection = await inspectSingleWorkspaceLock(lockPath);
      if (inspection.activePid) {
        result.activePidFiles += 1;
        continue;
      }
      if (inspection.stale) {
        result.staleFiles += 1;
        result.stalePaths.push(lockPath);
        continue;
      }
      result.unknownFreshFiles += 1;
    }
  }

  return result;
}

export async function cleanupWorkspaceLocks(workspaceRoot: string): Promise<WorkspaceLockCleanupResult> {
  const inspection = await inspectWorkspaceLocks(workspaceRoot);
  const errors: string[] = [];
  let removedFiles = 0;

  for (const stalePath of inspection.stalePaths) {
    try {
      await removeLockPath(stalePath);
      removedFiles += 1;
    } catch (error) {
      errors.push(`remove_failed:${stalePath}:${String(error)}`);
    }
  }

  if (removedFiles > 0) {
    logInfo('[storage-recovery] removed stale workspace lock files', {
      workspaceRoot,
      removedFiles,
      staleFiles: inspection.staleFiles,
    });
  }

  return {
    ...inspection,
    removedFiles,
    errors,
  };
}
