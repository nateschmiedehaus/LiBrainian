import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { capabilitiesCommand } from '../capabilities.js';

describe('capabilitiesCommand', () => {
  const originalInternalCommands = process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;

  it('emits a versioned public capability inventory with required fields', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-capabilities-'));
    const outPath = path.join(workspace, 'capabilities.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await capabilitiesCommand({
        workspace,
        args: [],
        rawArgs: ['capabilities', '--json', '--out', outPath],
      });
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(await fs.readFile(outPath, 'utf8')) as {
      kind: string;
      schemaVersion: number;
      surface: string;
      inventoryVersion: string;
      counts: { mcpTools: number; constructions: number; compositions: number; total: number };
      capabilities: Array<{
        kind: string;
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        exampleUsage: string;
        version: string;
      }>;
    };

    expect(parsed.kind).toBe('LiBrainianCapabilities.v1');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.surface).toBe('public');
    expect(parsed.inventoryVersion.startsWith('v1-')).toBe(true);
    expect(parsed.counts.mcpTools).toBeGreaterThanOrEqual(5);
    expect(parsed.counts.constructions).toBe(0);
    expect(parsed.counts.compositions).toBe(0);
    expect(parsed.counts.total).toBe(parsed.capabilities.length);

    const queryTool = parsed.capabilities.find((entry) => entry.kind === 'mcp_tool' && entry.name === 'query');
    const repoMapTool = parsed.capabilities.find((entry) => entry.kind === 'mcp_tool' && entry.name === 'get_repo_map');
    expect(queryTool).toBeDefined();
    expect(repoMapTool?.exampleUsage).toContain('"focus":["src/api","src/cli"]');
    expect(parsed.capabilities.every((entry) => entry.kind === 'mcp_tool')).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('Controls items for');
    expect(JSON.stringify(parsed)).not.toContain('librarian constructions run');
    expect(JSON.stringify(parsed)).not.toContain('compile_technique_composition');

    for (const capability of parsed.capabilities.slice(0, 10)) {
      expect(capability.name.length).toBeGreaterThan(0);
      expect(capability.description.length).toBeGreaterThan(0);
      expect(typeof capability.inputSchema).toBe('object');
      expect(capability.exampleUsage.length).toBeGreaterThan(0);
      expect(capability.version.length).toBeGreaterThan(0);
    }
  });

  it('emits the full internal inventory when --full is set', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-capabilities-full-'));
    const outPath = path.join(workspace, 'capabilities-full.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = '1';
      await capabilitiesCommand({
        workspace,
        args: [],
        rawArgs: ['capabilities', '--json', '--full', '--out', outPath],
      });
    } finally {
      if (originalInternalCommands === undefined) {
        delete process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
      } else {
        process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = originalInternalCommands;
      }
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(await fs.readFile(outPath, 'utf8')) as {
      surface: string;
      counts: { constructions: number; compositions: number };
      capabilities: Array<{ kind: string }>;
    };

    expect(parsed.surface).toBe('full');
    expect(parsed.counts.constructions).toBeGreaterThan(0);
    expect(parsed.counts.compositions).toBeGreaterThan(0);
    expect(parsed.capabilities.some((entry) => entry.kind === 'construction')).toBe(true);
    expect(parsed.capabilities.some((entry) => entry.kind === 'composition')).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('librarian constructions run');
    expect(JSON.stringify(parsed)).not.toContain('compile_technique_composition');
  });

  it('rejects --full in public mode', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-capabilities-public-'));
    try {
      await expect(capabilitiesCommand({
        workspace,
        args: [],
        rawArgs: ['capabilities', '--json', '--full'],
      })).rejects.toThrow(/unavailable in the public release surface/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
