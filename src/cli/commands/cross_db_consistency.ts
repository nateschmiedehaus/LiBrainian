import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { HealthCheckStatus } from './health_summary.js';

export const CROSS_DB_CONSISTENCY_CHECK_NAME = 'Cross-DB Consistency';

const LEGACY_DB_FILENAMES = [
  'librarian.db',
] as const;

function getLegacyDbSidecarPaths(filePath: string): string[] {
  return [
    filePath,
    `${filePath}-shm`,
    `${filePath}-wal`,
  ];
}

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

export interface CrossDbConsistencyCleanupResult {
  archivedFiles: string[];
  blockedFiles: string[];
  archiveDir: string | null;
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
      suggestion: 'Run `librainian bootstrap --force --mode fast` to rebuild and converge into .librarian/librarian.sqlite',
    };
  }

  return {
    status: 'WARNING',
    message: `Legacy DB artifacts detected (${legacyFiles.length} files)`,
    details,
    suggestion: 'Remove stale legacy DB files after verifying current index health',
  };
}

export async function archiveStaleLegacyDbArtifacts(
  workspace: string,
  dbPath: string,
): Promise<CrossDbConsistencyCleanupResult> {
  const librarianDir = path.join(workspace, '.librarian');
  const activeDb = path.resolve(dbPath);
  const activeMtimeMs = (await statMtimeMs(activeDb)) ?? 0;
  const legacyCandidates = LEGACY_DB_FILENAMES.map((filename) => path.join(librarianDir, filename));
  const archiveDir = path.join(
    librarianDir,
    'legacy-db-archive',
    new Date().toISOString().replaceAll(':', '-'),
  );

  const archivedFiles: string[] = [];
  const blockedFiles: string[] = [];
  let archiveDirCreated = false;

  for (const candidate of legacyCandidates) {
    const mtimeMs = await statMtimeMs(candidate);
    if (mtimeMs == null || path.resolve(candidate) === activeDb) continue;
    if (mtimeMs > activeMtimeMs + 1_000) {
      blockedFiles.push(candidate);
      continue;
    }

    const sidecars = getLegacyDbSidecarPaths(candidate);
    const existingSidecars = (
      await Promise.all(sidecars.map(async (entry) => {
        try {
          await fs.stat(entry);
          return entry;
        } catch {
          return null;
        }
      }))
    ).filter((entry): entry is string => entry !== null);

    if (existingSidecars.length === 0) continue;

    if (!archiveDirCreated) {
      await fs.mkdir(archiveDir, { recursive: true });
      archiveDirCreated = true;
    }

    for (const entry of existingSidecars) {
      const destination = path.join(archiveDir, path.basename(entry));
      await fs.rename(entry, destination);
      archivedFiles.push(destination);
    }
  }

  return {
    archivedFiles,
    blockedFiles,
    archiveDir: archiveDirCreated ? archiveDir : null,
  };
}
