import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { HealthCheckStatus } from './health_summary.js';

export const CROSS_DB_CONSISTENCY_CHECK_NAME = 'Cross-DB Consistency';

const LEGACY_DB_FILENAMES = [
  'knowledge.db',
  'evidence_ledger.db',
  'librarian.db',
] as const;

export interface CrossDbConsistencyDetails extends Record<string, unknown> {
  activeDb: string;
  legacyFiles: string[];
  legacyCount: number;
}

export interface CrossDbConsistencyResult {
  status: HealthCheckStatus;
  message: string;
  details: CrossDbConsistencyDetails;
  suggestion?: string;
}

async function statMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

export async function evaluateCrossDbConsistency(
  workspace: string,
  dbPath: string,
): Promise<CrossDbConsistencyResult> {
  const librarianDir = path.join(workspace, '.librarian');
  const activeDb = path.resolve(dbPath);
  const legacyCandidates = LEGACY_DB_FILENAMES.map((filename) => path.join(librarianDir, filename));

  const legacyFiles = (
    await Promise.all(
      legacyCandidates.map(async (candidate) => {
        const mtimeMs = await statMtimeMs(candidate);
        if (mtimeMs == null || path.resolve(candidate) === activeDb) return null;
        return { path: candidate, mtimeMs };
      }),
    )
  ).filter((entry): entry is { path: string; mtimeMs: number } => entry !== null);

  const details: CrossDbConsistencyDetails = {
    activeDb,
    legacyFiles: legacyFiles.map((entry) => entry.path),
    legacyCount: legacyFiles.length,
  };

  if (legacyFiles.length === 0) {
    return {
      status: 'OK',
      message: 'No legacy DB divergence artifacts detected',
      details,
    };
  }

  const newestLegacyMs = legacyFiles.reduce((max, entry) => Math.max(max, entry.mtimeMs), 0);
  const activeMtimeMs = (await statMtimeMs(activeDb)) ?? 0;

  if (newestLegacyMs > activeMtimeMs + 1_000) {
    return {
      status: 'ERROR',
      message: `Legacy DB files are newer than active store (${legacyFiles.length} files)`,
      details,
      suggestion: 'Run `librarian bootstrap --force` to rebuild and converge into .librarian/librarian.sqlite',
    };
  }

  return {
    status: 'WARNING',
    message: `Legacy DB artifacts detected (${legacyFiles.length} files)`,
    details,
    suggestion: 'Remove stale legacy DB files after verifying current index health',
  };
}
