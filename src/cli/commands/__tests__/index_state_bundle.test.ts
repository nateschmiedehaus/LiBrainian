import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { exportIndexStateCommand, importIndexStateCommand } from '../index_state_bundle.js';

const tarCheck = spawnSync('tar', ['--version'], { encoding: 'utf8' });
const tarAvailable = tarCheck.status === 0;

const createdDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function createSqliteWithWorkspacePath(dbPath: string, workspaceRoot: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  const workspacePath = path.join(workspaceRoot, 'src', 'auth', 'session.ts');
  db.prepare('INSERT INTO files (file_path, payload) VALUES (?, ?)').run(
    workspacePath,
    JSON.stringify({ sourcePath: workspacePath }),
  );
  db.close();
}

function readStoredPath(dbPath: string): { filePath: string; payload: string } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const row = db.prepare('SELECT file_path as filePath, payload FROM files LIMIT 1').get() as {
    filePath: string;
    payload: string;
  };
  db.close();
  return row;
}

describe('index state bundle export/import', () => {
  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('exports a portable archive with manifest and relativized sqlite paths', async () => {
    if (!tarAvailable) return;

    const workspace = await makeTemp('librarian-export-workspace-');
    const librarianDir = path.join(workspace, '.librarian');
    await fs.mkdir(librarianDir, { recursive: true });

    const librarianDb = path.join(librarianDir, 'librarian.sqlite');
    const knowledgeDb = path.join(librarianDir, 'knowledge.db');
    createSqliteWithWorkspacePath(librarianDb, workspace);
    createSqliteWithWorkspacePath(knowledgeDb, workspace);
    await fs.writeFile(path.join(librarianDir, 'hnsw.bin'), Buffer.from('vector-index'));

    const outputPath = path.join(workspace, 'state', 'exports', 'librarian-index.tar.gz');
    await exportIndexStateCommand({
      workspace,
      args: [],
      rawArgs: ['export', '--output', outputPath, '--json'],
    });

    const extractDir = await makeTemp('librarian-export-extract-');
    const extract = spawnSync('tar', ['-xzf', outputPath, '-C', extractDir], { encoding: 'utf8' });
    expect(extract.status).toBe(0);

    const manifestPath = path.join(extractDir, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as { files?: string[]; placeholder?: string };
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files).toContain('librarian.sqlite');
    expect(manifest.files).toContain('knowledge.db');

    const exportedRow = readStoredPath(path.join(extractDir, 'librarian.sqlite'));
    expect(exportedRow.filePath).toContain('<workspace>');
    expect(exportedRow.filePath).not.toContain(workspace);
    expect(exportedRow.payload).toContain('<workspace>');
    expect(exportedRow.payload).not.toContain(workspace);
  });

  it('imports an archive and restores workspace-specific absolute paths', async () => {
    if (!tarAvailable) return;

    const sourceWorkspace = await makeTemp('librarian-source-workspace-');
    const sourceLibrarianDir = path.join(sourceWorkspace, '.librarian');
    await fs.mkdir(sourceLibrarianDir, { recursive: true });
    createSqliteWithWorkspacePath(path.join(sourceLibrarianDir, 'librarian.sqlite'), sourceWorkspace);
    createSqliteWithWorkspacePath(path.join(sourceLibrarianDir, 'knowledge.db'), sourceWorkspace);

    const archivePath = path.join(sourceWorkspace, 'librarian-index.tar.gz');
    await exportIndexStateCommand({
      workspace: sourceWorkspace,
      args: [],
      rawArgs: ['export', '--output', archivePath, '--json'],
    });

    const targetWorkspace = await makeTemp('librarian-target-workspace-');
    await importIndexStateCommand({
      workspace: targetWorkspace,
      args: [],
      rawArgs: ['import', '--input', archivePath, '--json'],
    });

    const importedDb = path.join(targetWorkspace, '.librarian', 'librarian.sqlite');
    const importedRow = readStoredPath(importedDb);
    expect(importedRow.filePath).toContain(targetWorkspace);
    expect(importedRow.filePath).not.toContain('<workspace>');
    expect(importedRow.payload).toContain(targetWorkspace);
    expect(importedRow.payload).not.toContain('<workspace>');
  });
});
