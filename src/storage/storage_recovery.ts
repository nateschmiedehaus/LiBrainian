import Database from 'better-sqlite3';
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
  mode?: 'stale_lock' | 'quarantine_corrupt';
}

export interface SnapshotRecoveryOptions {
  additionalCandidates?: string[];
}

const LOCK_STALE_TIMEOUT_MS = 15 * 60_000;
const LOCK_DIR_RECOVERY_TIMEOUT_MS = 2 * 60_000;
const LOCK_EMPTY_DIR_RECOVERY_TIMEOUT_MS = 20_000;
const LOCK_PID_UNKNOWN_RECOVERY_TIMEOUT_MS = 5_000;
const WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS = 2 * 60 * 60_000;
const WORKSPACE_LOCK_DIRECTORIES = ['.librarian/locks', '.librarian/swarm/locks'] as const;
const NO_ACTION_WARNING_DEDUPE_WINDOW_MS = 10_000;

const noActionWarningState = new Map<string, { timestamp: number; suppressedCount: number }>();

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
  const mode = options.mode
    ?? (isCorruptionStorageError(options.error) ? 'quarantine_corrupt' : 'stale_lock');

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

  if (!lockBlocked && mode === 'quarantine_corrupt') {
    const timestamp = Date.now();
    const quarantinePaths: Array<{ sourcePath: string; kind: 'db' | 'wal' | 'shm' }> = [
      { sourcePath: dbPath, kind: 'db' },
      { sourcePath: walPath, kind: 'wal' },
      { sourcePath: shmPath, kind: 'shm' },
    ];
    for (const entry of quarantinePaths) {
      if (!existsSync(entry.sourcePath)) continue;
      const quarantinePath = `${entry.sourcePath}.corrupt.${timestamp}`;
      try {
        await fs.rename(entry.sourcePath, quarantinePath);
        actions.push(
          entry.kind === 'db'
            ? 'quarantined_corrupt_db'
            : entry.kind === 'wal'
              ? 'quarantined_corrupt_wal'
              : 'quarantined_corrupt_shm'
        );
      } catch (renameError) {
        errors.push(`${entry.kind}_quarantine_failed:${String(renameError)}`);
      }
    }
  }

  if (actions.length > 0) {
    logInfo('[storage-recovery] applied recovery actions', { dbPath, actions });
  } else if (errors.length > 0) {
    const signature = `${dbPath}|${errors.join(',')}`;
    const now = Date.now();
    const previous = noActionWarningState.get(signature);
    if (previous && now - previous.timestamp < NO_ACTION_WARNING_DEDUPE_WINDOW_MS) {
      previous.suppressedCount += 1;
      previous.timestamp = now;
      noActionWarningState.set(signature, previous);
    } else {
      logWarning('[storage-recovery] no recovery actions applied', {
        dbPath,
        errors,
        ...(previous && previous.suppressedCount > 0 ? { suppressedDuplicates: previous.suppressedCount } : {}),
      });
      noActionWarningState.set(signature, { timestamp: now, suppressedCount: 0 });
    }
  }

  return { recovered: actions.length > 0 && !lockBlocked, actions, errors };
}

interface StorageSnapshotStats {
  path: string;
  totalCoreRows: number;
  mtimeMs: number;
}

function readTableCount(db: Database.Database, tableName: string): number {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { 1?: number } | undefined;
  if (!row) return 0;
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count?: number } | undefined;
  return typeof countRow?.count === 'number' && Number.isFinite(countRow.count) ? countRow.count : 0;
}

async function inspectSnapshot(dbPath: string): Promise<StorageSnapshotStats | null> {
  if (!existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    const stat = await fs.stat(dbPath);
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const totalCoreRows =
      readTableCount(db, 'librarian_functions')
      + readTableCount(db, 'librarian_modules')
      + readTableCount(db, 'librarian_context_packs')
      + readTableCount(db, 'librarian_files')
      + readTableCount(db, 'librarian_embeddings')
      + readTableCount(db, 'librarian_ingested_items')
      + readTableCount(db, 'librarian_directories');
    return {
      path: dbPath,
      totalCoreRows,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }
}

async function discoverSnapshotCandidates(
  primaryDbPath: string,
  options: SnapshotRecoveryOptions
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const candidate of options.additionalCandidates ?? []) {
    if (candidate && candidate !== primaryDbPath) {
      candidates.add(candidate);
    }
  }

  const directory = path.dirname(primaryDbPath);
  const primaryFileName = path.basename(primaryDbPath);
  try {
    const entries = await fs.readdir(directory);
    for (const entry of entries) {
      if (!entry.startsWith(`${primaryFileName}.bak.`)) continue;
      if (entry.includes('-wal.bak.') || entry.includes('-shm.bak.')) continue;
      candidates.add(path.join(directory, entry));
    }
  } catch {
    // Ignore unreadable directories and return only explicit candidates.
  }

  return Array.from(candidates);
}

async function archivePrimaryArtifacts(primaryDbPath: string, archiveSuffix: string): Promise<string[]> {
  const archived: string[] = [];
  const suffixes = ['', '-wal', '-shm'];
  for (const suffix of suffixes) {
    const sourcePath = `${primaryDbPath}${suffix}`;
    if (!existsSync(sourcePath)) continue;
    const archivedPath = `${sourcePath}.empty.${archiveSuffix}`;
    await fs.rename(sourcePath, archivedPath);
    archived.push(archivedPath);
  }
  return archived;
}

async function removePrimarySidecars(primaryDbPath: string): Promise<void> {
  await Promise.all(
    ['-wal', '-shm'].map(async (suffix) => {
      try {
        await fs.unlink(`${primaryDbPath}${suffix}`);
      } catch {
        // Ignore missing sidecars.
      }
    })
  );
}

async function installSnapshotArtifacts(primaryDbPath: string, snapshotPath: string): Promise<void> {
  await removePrimarySidecars(primaryDbPath);
  await fs.copyFile(snapshotPath, primaryDbPath);
  for (const suffix of ['-wal', '-shm']) {
    const sourcePath = `${snapshotPath}${suffix}`;
    const targetPath = `${primaryDbPath}${suffix}`;
    if (!existsSync(sourcePath)) continue;
    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function recoverPrimaryFromViableSnapshot(
  primaryDbPath: string,
  options: SnapshotRecoveryOptions = {}
): Promise<StorageRecoveryResult> {
  const actions: string[] = [];
  const errors: string[] = [];
  if (!primaryDbPath || primaryDbPath === ':memory:') {
    return { recovered: false, actions, errors: ['memory_storage'] };
  }

  const primaryStats = await inspectSnapshot(primaryDbPath);
  if (primaryStats && primaryStats.totalCoreRows > 0) {
    return { recovered: false, actions, errors };
  }

  const candidatePaths = await discoverSnapshotCandidates(primaryDbPath, options);
  const candidateStats = (
    await Promise.all(candidatePaths.map((candidatePath) => inspectSnapshot(candidatePath)))
  ).filter((stats): stats is StorageSnapshotStats => stats !== null && stats.totalCoreRows > 0);

  if (candidateStats.length === 0) {
    return { recovered: false, actions, errors: ['no_viable_snapshot'] };
  }

  candidateStats.sort((left, right) =>
    right.totalCoreRows - left.totalCoreRows || right.mtimeMs - left.mtimeMs
  );
  const bestSnapshot = candidateStats[0];
  const archiveSuffix = String(Date.now());

  try {
    const archived = await archivePrimaryArtifacts(primaryDbPath, archiveSuffix);
    if (archived.length > 0) {
      actions.push('archived_empty_primary');
    }
    await installSnapshotArtifacts(primaryDbPath, bestSnapshot.path);
    actions.push('restored_primary_from_snapshot');
    logInfo('[storage-recovery] restored empty primary storage from viable snapshot', {
      primaryDbPath,
      snapshotPath: bestSnapshot.path,
      snapshotCoreRows: bestSnapshot.totalCoreRows,
      previousPrimaryCoreRows: primaryStats?.totalCoreRows ?? 0,
    });
    return { recovered: true, actions, errors };
  } catch (error) {
    errors.push(`snapshot_restore_failed:${String(error)}`);
    logWarning('[storage-recovery] failed to restore empty primary storage from viable snapshot', {
      primaryDbPath,
      snapshotPath: bestSnapshot.path,
      error: String(error),
    });
    return { recovered: false, actions, errors };
  }
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
