import { describe, expect, it } from 'vitest';
import * as mcpServerModule from '../server.js';
import { MCP_GOLDEN_PATH_TOOLS } from '../types.js';

type MCPFactory = (config: {
  authorization: {
    enabledScopes: string[];
    requireConsent: boolean;
  };
  audit: {
    enabled: boolean;
    retentionDays: number;
    logPath: string;
  };
}) => Promise<unknown>;

function resolveFactory(): MCPFactory {
  const moduleExports = mcpServerModule as unknown as {
    createLiBrainianMCPServer?: MCPFactory;
    createLibrarianMCPServer?: MCPFactory;
  };
  const factory = moduleExports.createLiBrainianMCPServer ?? moduleExports.createLibrarianMCPServer;
  if (!factory) {
    throw new Error('MCP server factory unavailable; expected createLiBrainianMCPServer or createLibrarianMCPServer.');
  }
  return factory;
}

describe('MCP list capabilities tool', () => {
  it('returns versioned public capability inventory by default', async () => {
    const createServer = resolveFactory();
    const server = await createServer({
      authorization: {
        enabledScopes: ['read', 'write', 'execute', 'network', 'admin'],
        requireConsent: false,
      },
      audit: {
        enabled: false,
        retentionDays: 1,
        logPath: '.librarian/audit/mcp',
      },
    });

    const advertisedTools = (server as unknown as {
      getAdvertisedToolsForInventory: () => Array<{ name: string }>;
    }).getAdvertisedToolsForInventory();
    expect(new Set(advertisedTools.map((tool) => tool.name))).toEqual(new Set(MCP_GOLDEN_PATH_TOOLS));

    const result = await (server as unknown as {
      executeListCapabilities: (input: { workspace?: string }) => Promise<{
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
      }>;
    }).executeListCapabilities({});

    expect(result.kind).toBe('LiBrainianCapabilities.v1');
    expect(result.schemaVersion).toBe(1);
    expect(result.surface).toBe('public');
    expect(result.inventoryVersion.startsWith('v1-')).toBe(true);
    expect(result.counts.total).toBe(result.capabilities.length);
    expect(result.counts.mcpTools).toBeGreaterThanOrEqual(5);
    expect(result.counts.constructions).toBe(0);
    expect(result.counts.compositions).toBe(0);

    const hasMcpTool = result.capabilities.some((entry) => entry.kind === 'mcp_tool' && entry.name === 'query');
    expect(hasMcpTool).toBe(true);
    expect(result.capabilities.every((entry) => entry.kind === 'mcp_tool')).toBe(true);
  });

  it('rejects the full inventory surface without maintainer opt-in', async () => {
    const createServer = resolveFactory();
    const server = await createServer({
      authorization: {
        enabledScopes: ['read', 'write', 'execute', 'network', 'admin'],
        requireConsent: false,
      },
      audit: {
        enabled: false,
        retentionDays: 1,
        logPath: '.librarian/audit/mcp',
      },
    });

    await expect((server as unknown as {
      executeListCapabilities: (input: { workspace?: string; surface?: 'public' | 'full' }) => Promise<unknown>;
    }).executeListCapabilities({ surface: 'full' })).rejects.toThrow(/public release surface/);
  });

  it('returns the full inventory when explicitly requested', async () => {
    const createServer = resolveFactory();
    const server = await createServer({
      authorization: {
        enabledScopes: ['read', 'write', 'execute', 'network', 'admin'],
        requireConsent: false,
      },
      audit: {
        enabled: false,
        retentionDays: 1,
        logPath: '.librarian/audit/mcp',
      },
    });

    const previous = process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
    process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = '1';
    try {
      const result = await (server as unknown as {
      executeListCapabilities: (input: { workspace?: string; surface?: 'public' | 'full' }) => Promise<{
        surface: string;
        counts: { constructions: number; compositions: number };
        capabilities: Array<{ kind: string }>;
      }>;
      }).executeListCapabilities({ surface: 'full' });

      expect(result.surface).toBe('full');
      expect(result.counts.constructions).toBeGreaterThan(0);
      expect(result.counts.compositions).toBeGreaterThan(0);
      expect(result.capabilities.some((entry) => entry.kind === 'construction')).toBe(true);
      expect(result.capabilities.some((entry) => entry.kind === 'composition')).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
      } else {
        process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = previous;
      }
    }
  });
});
