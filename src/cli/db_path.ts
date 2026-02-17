/**
 * @fileoverview Database path resolution with migration support
 *
 * Handles migration from legacy .db files to .sqlite files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logInfo } from '../telemetry/logger.js';

const SQLITE_FILENAME = 'librarian.sqlite';
const LEGACY_DB_FILENAME = 'librarian.db';

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
    return sqlitePath;
  } catch {
    // .sqlite doesn't exist
  }

  // Check if legacy .db exists and migrate
  try {
    await fs.access(legacyPath);
    // Migrate by renaming
    await fs.rename(legacyPath, sqlitePath);
    logInfo(`[librarian] Migrated database from ${LEGACY_DB_FILENAME} to ${SQLITE_FILENAME}`);
    return sqlitePath;
  } catch {
    // Neither exists, return path for new .sqlite
  }

  return sqlitePath;
}
