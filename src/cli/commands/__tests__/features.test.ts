import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { featuresCommand } from '../features.js';

describe('featuresCommand', () => {
  it('emits machine-readable JSON feature entries with required fields', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-features-json-'));
    try {
      await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
      await fs.writeFile(path.join(workspace, '.librarian', 'librarian.sqlite'), '');
      const outPath = path.join(workspace, 'features.json');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await featuresCommand({
          workspace,
          args: [],
          rawArgs: ['features', '--json', '--out', outPath],
        });
      } finally {
        logSpy.mockRestore();
      }

      const output = await fs.readFile(outPath, 'utf8');
      const parsed = JSON.parse(output) as {
        durationMs: number;
        features: Array<{ name: string; status: string; requiresConfig: boolean; docs: string }>;
      };
      expect(parsed.durationMs).toBeLessThan(500);
      expect(parsed.features.length).toBeGreaterThan(5);
      for (const feature of parsed.features) {
        expect(feature.name.length).toBeGreaterThan(0);
        expect(feature.status.length).toBeGreaterThan(0);
        expect(typeof feature.requiresConfig).toBe('boolean');
        expect(feature.docs.length).toBeGreaterThan(0);
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('marks persistent session memory as experimental once memory.db exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-features-memory-'));
    try {
      await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
      await fs.writeFile(path.join(workspace, '.librarian', 'memory.db'), '');
      const outPath = path.join(workspace, 'features.json');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await featuresCommand({
          workspace,
          args: [],
          rawArgs: ['features', '--json', '--out', outPath],
        });
      } finally {
        logSpy.mockRestore();
      }

      const parsed = JSON.parse(await fs.readFile(outPath, 'utf8')) as {
        features: Array<{ id: string; status: string }>;
      };
      const memoryFeature = parsed.features.find((entry) => entry.id === 'persistent_session_memory');
      expect(memoryFeature?.status).toBe('experimental');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
