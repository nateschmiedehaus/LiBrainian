import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { featuresCommand } from '../features.js';

describe('featuresCommand', () => {
  const originalInternalCommands = process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;

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
        kind: string;
        schemaVersion: number;
        durationMs: number;
        surface: string;
        counts: { visible: number; hidden: number };
        features: Array<{ id: string; name: string; status: string; requiresConfig: boolean; docs: string; surface: string }>;
      };
      expect(parsed.kind).toBe('LiBrainianFeatures.v1');
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.durationMs).toBeLessThan(500);
      expect(parsed.surface).toBe('public');
      expect(parsed.features.length).toBeGreaterThan(3);
      expect(parsed.counts.hidden).toBeGreaterThan(0);
      expect(parsed.features.some((feature) => feature.id === 'agent_docs_injection')).toBe(false);
      expect(parsed.features.some((feature) => feature.id === 'constrained_generation')).toBe(false);
      for (const feature of parsed.features) {
        expect(feature.name.length).toBeGreaterThan(0);
        expect(feature.status.length).toBeGreaterThan(0);
        expect(typeof feature.requiresConfig).toBe('boolean');
        expect(feature.docs.length).toBeGreaterThan(0);
        expect(feature.surface).toBe('public');
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('includes internal experimental features only when --all is set', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-features-memory-'));
    try {
      process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = '1';
      await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
      await fs.writeFile(path.join(workspace, '.librarian', 'memory.db'), '');
      const outPath = path.join(workspace, 'features.json');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await featuresCommand({
          workspace,
          args: [],
          rawArgs: ['features', '--json', '--all', '--out', outPath],
        });
      } finally {
        logSpy.mockRestore();
      }

      const parsed = JSON.parse(await fs.readFile(outPath, 'utf8')) as {
        surface: string;
        features: Array<{ id: string; status: string }>;
      };
      expect(parsed.surface).toBe('full');
      const memoryFeature = parsed.features.find((entry) => entry.id === 'persistent_session_memory');
      expect(memoryFeature?.status).toBe('experimental');
    } finally {
      if (originalInternalCommands === undefined) {
        delete process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
      } else {
        process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = originalInternalCommands;
      }
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects --all in public mode', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-features-public-'));
    try {
      await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
      await fs.writeFile(path.join(workspace, '.librarian', 'librarian.sqlite'), '');

      await expect(featuresCommand({
        workspace,
        args: [],
        rawArgs: ['features', '--json', '--all'],
      })).rejects.toThrow(/unavailable in the public release surface/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
