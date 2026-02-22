import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('storage export contract', () => {
  it('sqlite_storage exports SqliteLibrarianStorage alias', async () => {
    const storageModule = await import('../sqlite_storage.js');
    expect(typeof storageModule.SqliteLiBrainianStorage).toBe('function');
    expect(typeof storageModule.SqliteLibrarianStorage).toBe('function');
    expect(storageModule.SqliteLibrarianStorage).toBe(storageModule.SqliteLiBrainianStorage);
  });

  it('storage index re-exports SqliteLibrarianStorage', async () => {
    const indexModule = await import('../index.js');
    expect(typeof indexModule.SqliteLibrarianStorage).toBe('function');
    expect(indexModule.SqliteLibrarianStorage).toBe(indexModule.SqliteLiBrainianStorage);
  });

  it('cli runtime path does not crash on SqliteLibrarianStorage export mismatch', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-export-contract-'));
    const statusPath = path.join(workspace, 'status.json');
    try {
      const result = spawnSync(
        process.execPath,
        [
          'scripts/run-with-tmpdir.mjs',
          '--',
          'npx',
          'tsx',
          'src/cli/index.ts',
          '--workspace',
          workspace,
          'status',
          '--format',
          'json',
          '--out',
          statusPath,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 60_000,
        },
      );
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      expect(output).not.toContain("does not provide an export named 'SqliteLibrarianStorage'");
      expect(fs.existsSync(statusPath)).toBe(true);
      const statusReport = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as {
        storage?: { status?: string };
      };
      expect(typeof statusReport.storage?.status).toBe('string');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
