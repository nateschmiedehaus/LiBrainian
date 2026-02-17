import { describe, expect, it, vi } from 'vitest';
import { analyzeCommand } from '../analyze.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('analyzeCommand dead-weight mode', () => {
  it('emits DeadWeightReport.v1 JSON and ranks candidates', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-analyze-dead-weight-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await fs.writeFile(
        path.join(workspace, 'index.ts'),
        "import { keep } from './keep';\nexport const value = keep();\n",
        'utf8'
      );
      await fs.writeFile(
        path.join(workspace, 'keep.ts'),
        'export function keep() { return 1; }\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspace, 'dead.ts'),
        'export function dead() { return 2; }\n',
        'utf8'
      );

      await analyzeCommand({
        workspace,
        args: [],
        rawArgs: ['analyze', '--dead-weight', '--format', 'json'],
      });

      const output = logSpy.mock.calls
        .map((call) => call[0])
        .filter((value) => typeof value === 'string')
        .join('\n')
        .trim();

      const report = JSON.parse(output) as {
        schema: string;
        files: Array<{ file: string; score: number }>;
      };

      expect(report.schema).toBe('DeadWeightReport.v1');
      expect(Array.isArray(report.files)).toBe(true);
      expect(report.files.length).toBeGreaterThan(0);

      const deadFile = report.files.find((entry) => entry.file.endsWith('/dead.ts'));
      expect(deadFile).toBeDefined();

      const keepFile = report.files.find((entry) => entry.file.endsWith('/keep.ts'));
      if (keepFile && deadFile) {
        expect(deadFile.score).toBeGreaterThanOrEqual(keepFile.score);
      }
    } finally {
      logSpy.mockRestore();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
