import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarianStorage } from '../../storage/types.js';
import { __testing } from '../query.js';
import { computeFileChecksum } from '../../utils/checksums.js';

const { detectStaleResultFiles, formatWorkspaceRelativePath } = __testing;

describe('detectStaleResultFiles', () => {
  let workspaceRoot: string;
  let storage: Pick<LibrarianStorage, 'getFileChecksum'>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'query-stale-'));
    const mockGetFileChecksum = vi.fn<(filePath: string) => Promise<string | null>>();
    storage = {
      getFileChecksum: mockGetFileChecksum,
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('flags files whose on-disk content diverges from stored checksum', async () => {
    const targetPath = path.join(workspaceRoot, 'src', 'index.ts');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'console.log("v1");');

    storage.getFileChecksum.mockResolvedValue('deadbeef');

    const result = await detectStaleResultFiles({
      storage,
      workspaceRoot,
      filePaths: [targetPath],
      maxFiles: 5,
    });

    expect(result.staleFiles).toEqual([targetPath]);
  });

  it('ignores files that match stored checksum', async () => {
    const targetPath = path.join(workspaceRoot, 'src', 'ok.ts');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'console.log("ok");');
    const checksum = computeFileChecksum(await fs.readFile(targetPath));

    storage.getFileChecksum.mockResolvedValue(checksum);

    const result = await detectStaleResultFiles({
      storage,
      workspaceRoot,
      filePaths: [targetPath],
    });

    expect(result.staleFiles).toHaveLength(0);
  });

  it('treats missing files as stale when storage still has a checksum', async () => {
    const missingPath = path.join(workspaceRoot, 'src', 'missing.ts');
    storage.getFileChecksum.mockResolvedValue('cafef00d');

    const result = await detectStaleResultFiles({
      storage,
      workspaceRoot,
      filePaths: [missingPath],
    });

    expect(result.staleFiles).toEqual([missingPath]);
  });
});

describe('formatWorkspaceRelativePath', () => {
  it('formats paths relative to workspace root when possible', () => {
    const workspaceRoot = path.join(path.sep, 'tmp', 'workspace');
    const filePath = path.join(workspaceRoot, 'src', 'main.ts');
    const relative = formatWorkspaceRelativePath(filePath, workspaceRoot);
    expect(relative).toBe('src/main.ts');
  });

  it('returns absolute paths for external files', () => {
    const workspaceRoot = path.join(path.sep, 'tmp', 'workspace');
    const filePath = path.join(path.sep, 'etc', 'passwd');
    const formatted = formatWorkspaceRelativePath(filePath, workspaceRoot);
    expect(formatted).toBe(filePath);
  });
});
