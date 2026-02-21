import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { sha256Hex } from '../spine/hashes.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { logWarning } from '../telemetry/logger.js';

const TAG = 'FileLockManager';

/** Safely unlinks a lock file, logging errors instead of throwing */
const safeUnlinkLock = async (lockPath: string, context: string): Promise<void> => {
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    // ENOENT is expected if lock was already removed - don't log
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logWarning(`${TAG}: Failed to unlink lock during ${context}`, {
        lockPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export interface LockStatus {
  locked: boolean;
  taskId?: string;
  since?: string;
  pid?: number;
}

export interface BlockedLock {
  path: string;
  status: LockStatus;
}

export interface LockResult {
  acquired: string[];
  blocked: BlockedLock[];
  timeout: boolean;
}

export class FileLockManager {
  private readonly lockRoot: string;
  private readonly locksByTask = new Map<string, Set<string>>();
  private readonly staleMs: number;
  private readonly timeoutMs: number;

  constructor(workspaceRoot: string, options?: { staleMs?: number; timeoutMs?: number }) {
    this.lockRoot = path.join(workspaceRoot, '.librainian', 'locks');
    this.staleMs = options?.staleMs ?? 5 * 60_000;
    this.timeoutMs = options?.timeoutMs ?? 0;
  }

  async acquireLock(taskId: string, paths: string[]): Promise<LockResult> {
    const acquired: string[] = []; const blocked: BlockedLock[] = [];
    const sorted = [...new Set(paths)].sort();
    const deadline = this.timeoutMs > 0 ? Date.now() + this.timeoutMs : Number.POSITIVE_INFINITY;
    while (true) {
      blocked.length = 0;
      for (const target of sorted) {
        if (acquired.includes(target)) continue;
        const lockPath = this.lockPathFor(target);
        const status = await this.tryAcquire(lockPath, taskId);
        if (status) { acquired.push(target); continue; }
        const current = await this.checkLock(target); blocked.push({ path: target, status: current });
      }
      if (blocked.length === 0) break;
      if (Date.now() >= deadline) return { acquired, blocked, timeout: true };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const set = this.locksByTask.get(taskId) ?? new Set<string>(); for (const target of acquired) set.add(target); this.locksByTask.set(taskId, set);
    return { acquired, blocked: [], timeout: false };
  }

  async releaseLock(taskId: string): Promise<void> {
    const paths = Array.from(this.locksByTask.get(taskId) ?? []);
    for (const target of paths) {
      const lockPath = this.lockPathFor(target);
      await safeUnlinkLock(lockPath, `releaseLock:${taskId}`);
    }
    this.locksByTask.delete(taskId);
  }

  async checkLock(filePath: string): Promise<LockStatus> {
    const lockPath = this.lockPathFor(filePath);
    if (!fsSync.existsSync(lockPath)) return { locked: false };
    try {
      const raw = await fs.readFile(lockPath, 'utf8');
      const parsed = safeJsonParse<{ taskId?: string; pid?: number; acquiredAt?: string }>(raw);
      if (!parsed.ok) return { locked: true };
      return { locked: true, taskId: parsed.value.taskId, pid: parsed.value.pid, since: parsed.value.acquiredAt };
    } catch {
      return { locked: true };
    }
  }

  async breakStaleLock(filePath: string, reason: string): Promise<void> {
    const lockPath = this.lockPathFor(filePath);
    await safeUnlinkLock(lockPath, `breakStaleLock:${reason}`);
  }

  private lockPathFor(filePath: string): string {
    const hash = sha256Hex(path.resolve(filePath));
    return path.join(this.lockRoot, `${hash}.lock`);
  }

  private async tryAcquire(lockPath: string, taskId: string): Promise<boolean> {
    await fs.mkdir(this.lockRoot, { recursive: true });
    try {
      const handle = await fs.open(lockPath, 'wx');
      const payload = JSON.stringify({ taskId, pid: process.pid, acquiredAt: new Date().toISOString() });
      await handle.writeFile(payload, 'utf8');
      await handle.close();
      return true;
    } catch {
      const stale = await this.isStale(lockPath);
      if (stale) {
        await safeUnlinkLock(lockPath, 'tryAcquire:stale');
        return this.tryAcquire(lockPath, taskId);
      }
      return false;
    }
  }

  private async isStale(lockPath: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(lockPath, 'utf8');
      const parsed = safeJsonParse<{ pid?: number; acquiredAt?: string }>(raw);
      if (!parsed.ok) return true;
      if (parsed.value.pid && !this.isPidAlive(parsed.value.pid)) return true;
      if (parsed.value.acquiredAt && Date.now() - Date.parse(parsed.value.acquiredAt) > this.staleMs) return true;
      return false;
    } catch {
      return true;
    }
  }

  private isPidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
}
