import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { capabilitiesCommand } from '../capabilities.js';

describe('capabilitiesCommand', () => {
  it('emits a versioned capability inventory with required fields', async () => {
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
    expect(parsed.inventoryVersion.startsWith('v1-')).toBe(true);
    expect(parsed.counts.mcpTools).toBeGreaterThan(10);
    expect(parsed.counts.constructions).toBeGreaterThan(0);
    expect(parsed.counts.compositions).toBeGreaterThan(0);
    expect(parsed.counts.total).toBe(parsed.capabilities.length);

    const queryTool = parsed.capabilities.find((entry) => entry.kind === 'mcp_tool' && entry.name === 'query');
    expect(queryTool).toBeDefined();

    const hasConstruction = parsed.capabilities.some((entry) => entry.kind === 'construction');
    const hasComposition = parsed.capabilities.some((entry) => entry.kind === 'composition');
    expect(hasConstruction).toBe(true);
    expect(hasComposition).toBe(true);

    for (const capability of parsed.capabilities.slice(0, 10)) {
      expect(capability.name.length).toBeGreaterThan(0);
      expect(capability.description.length).toBeGreaterThan(0);
      expect(typeof capability.inputSchema).toBe('object');
      expect(capability.exampleUsage.length).toBeGreaterThan(0);
      expect(capability.version.length).toBeGreaterThan(0);
    }
  });
});
