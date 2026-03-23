/**
 * @fileoverview Database path resolution with migration support
 *
 * Handles migration from legacy .db files to .sqlite files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logInfo } from '../telemetry/logger.js';
import { recoverPrimaryFromViableSnapshot } from '../storage/storage_recovery.js';

const SQLITE_FILENAME = 'librarian.sqlite';
const LEGACY_DB_FILENAME = 'librarian.db';

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

/**
 * Resolve the database path for a workspace, handling migration from .db to .sqlite.
 *
 * @param workspace - The workspace root directory
 * @returns The resolved database path (always .sqlite)
 */
export async function resolveDbPath(workspace: string): Promise<string> {
  const librarianDir = path.join(workspace, '.librarian');
  const sqlitePath = path.join(librarianDir, SQLITE_FILENAME);
  const legacyPath = path.join(librarianDir, LEGACY_DB_FILENAME);

  // Ensure .librarian directory exists
  await fs.mkdir(librarianDir, { recursive: true });

  // Check if .sqlite exists
  try {
    await fs.access(sqlitePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  try {
    await fs.access(sqlitePath);
    await recoverPrimaryFromViableSnapshot(sqlitePath, {
      additionalCandidates: [legacyPath],
    });
    return sqlitePath;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  // Check if legacy .db exists and migrate
  try {
    await fs.access(legacyPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return sqlitePath;
  }

  await fs.rename(legacyPath, sqlitePath);
  logInfo(`[librarian] Migrated database from ${LEGACY_DB_FILENAME} to ${SQLITE_FILENAME}`);
  return sqlitePath;
}
