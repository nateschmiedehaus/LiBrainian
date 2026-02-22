import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LibrarianStorage } from '../storage/types.js';
import { logWarning } from '../telemetry/logger.js';

const SEEDED_PACK_PROVENANCE = 'seeded_from_construction';

export interface SeededPackValidationResult {
  checked: number;
  invalidated: number;
}

export interface SeededPackValidationOptions {
  workspaceRoot?: string;
}

type SeededPackValidationStorage = Pick<LibrarianStorage, 'findByProvenance' | 'invalidateContextPacks'>;

function hasSeededPackValidationStorage(storage: LibrarianStorage): storage is LibrarianStorage & SeededPackValidationStorage {
  const record = storage as unknown as Record<string, unknown>;
  return (
    typeof record.findByProvenance === 'function'
    && typeof record.invalidateContextPacks === 'function'
  );
}

function isErrnoCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown };
  return record.code === code;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolvePath(filePath: string, workspaceRoot?: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  if (workspaceRoot) {
    return path.resolve(workspaceRoot, filePath);
  }
  return path.resolve(process.cwd(), filePath);
}

export async function validateSeededPacks(
  storage: LibrarianStorage,
  options: SeededPackValidationOptions = {}
): Promise<SeededPackValidationResult> {
  if (!hasSeededPackValidationStorage(storage)) {
    return { checked: 0, invalidated: 0 };
  }

  const seededPacks = await storage.findByProvenance(SEEDED_PACK_PROVENANCE);
  let invalidated = 0;

  for (const pack of seededPacks) {
    const triggerCandidates = Array.from(new Set(
      [...pack.invalidationTriggers, ...pack.relatedFiles]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0)
    ));
    if (triggerCandidates.length === 0) {
      continue;
    }

    const baseline = pack.createdAt.getTime();
    let stale = false;

    for (const triggerPath of triggerCandidates) {
      const absolutePath = resolvePath(triggerPath, options.workspaceRoot);
      try {
        const stat = await fs.stat(absolutePath);
        if (stat.mtime.getTime() > baseline) {
          stale = true;
          break;
        }
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT') || isErrnoCode(error, 'ENOTDIR')) {
          continue;
        }
        logWarning('[homeostasis] seeded pack validation stat failed', {
          packId: pack.packId,
          path: absolutePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!stale) {
      continue;
    }

    for (const triggerPath of triggerCandidates) {
      invalidated += await storage.invalidateContextPacks(normalizePath(triggerPath));
    }
  }

  return {
    checked: seededPacks.length,
    invalidated,
  };
}
