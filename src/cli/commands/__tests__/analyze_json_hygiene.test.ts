import { describe, expect, it, vi } from 'vitest';
import { analyzeCommand } from '../analyze.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('analyzeCommand JSON hygiene', () => {
  it('emits pure JSON when --format json is set (no leading status lines)', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-analyze-json-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await analyzeCommand({
        workspace,
        args: [],
        rawArgs: ['analyze', '--complexity', '--format', 'json', '--threshold', '25'],
      });

      const output = logSpy.mock.calls
        .map(call => call[0])
        .filter(value => typeof value === 'string')
        .join('\n')
        .trim();

      expect(output.startsWith('{')).toBe(true);
      expect(() => JSON.parse(output)).not.toThrow();
    } finally {
      logSpy.mockRestore();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

