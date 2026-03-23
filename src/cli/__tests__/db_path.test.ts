import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: vi.fn(actual.access),
    mkdir: vi.fn(actual.mkdir),
    mkdtemp: vi.fn(actual.mkdtemp),
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

vi.mock('../../storage/storage_recovery.js', () => ({
  recoverPrimaryFromViableSnapshot: vi.fn(async () => undefined),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import { resolveDbPath } from '../db_path.js';
import { recoverPrimaryFromViableSnapshot } from '../../storage/storage_recovery.js';
import { logInfo } from '../../telemetry/logger.js';

describe('resolveDbPath', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(recoverPrimaryFromViableSnapshot).mockResolvedValue(undefined);
  });

  it('returns the sqlite path and runs snapshot recovery when sqlite already exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));
    const sqlitePath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, 'sqlite', 'utf8');

    await expect(resolveDbPath(workspace)).resolves.toBe(sqlitePath);
    expect(recoverPrimaryFromViableSnapshot).toHaveBeenCalledWith(sqlitePath, {
      additionalCandidates: [path.join(workspace, '.librarian', 'librarian.db')],
    });
  });

  it('throws when sqlite exists but snapshot recovery fails', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));
    const sqlitePath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, 'sqlite', 'utf8');

    vi.mocked(recoverPrimaryFromViableSnapshot).mockRejectedValueOnce(new Error('snapshot repair failed'));

    await expect(resolveDbPath(workspace)).rejects.toThrow('snapshot repair failed');
  });

  it('migrates a legacy db when sqlite is missing', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const legacyPath = path.join(librarianDir, 'librarian.db');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(legacyPath, 'legacy', 'utf8');

    await expect(resolveDbPath(workspace)).resolves.toBe(sqlitePath);
    await expect(fs.readFile(sqlitePath, 'utf8')).resolves.toBe('legacy');
    await expect(fs.access(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logInfo).toHaveBeenCalledWith('[librarian] Migrated database from librarian.db to librarian.sqlite');
  });

  it('throws when legacy migration rename fails', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));
    const librarianDir = path.join(workspace, '.librarian');
    const legacyPath = path.join(librarianDir, 'librarian.db');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(legacyPath, 'legacy', 'utf8');

    const renameSpy = vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename blocked'));

    await expect(resolveDbPath(workspace)).rejects.toThrow('rename blocked');
    expect(renameSpy).toHaveBeenCalledOnce();
  });

  it('throws on non-missing sqlite access errors instead of falling through', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));
    const accessSpy = vi.mocked(fs.access).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );

    await expect(resolveDbPath(workspace)).rejects.toMatchObject({ message: 'permission denied' });
    expect(accessSpy).toHaveBeenCalledOnce();
  });

  it('returns the sqlite path for a fresh workspace when no db exists yet', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-db-path-'));

    await expect(resolveDbPath(workspace)).resolves.toBe(
      path.join(workspace, '.librarian', 'librarian.sqlite'),
    );
  });
});
