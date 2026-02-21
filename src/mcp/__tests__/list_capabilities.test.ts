import { describe, expect, it } from 'vitest';
import * as mcpServerModule from '../server.js';

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
  it('returns versioned capability inventory with tools, constructions, and compositions', async () => {
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

    const result = await (server as unknown as {
      executeListCapabilities: (input: { workspace?: string }) => Promise<{
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
      }>;
    }).executeListCapabilities({});

    expect(result.kind).toBe('LiBrainianCapabilities.v1');
    expect(result.schemaVersion).toBe(1);
    expect(result.inventoryVersion.startsWith('v1-')).toBe(true);
    expect(result.counts.total).toBe(result.capabilities.length);
    expect(result.counts.mcpTools).toBeGreaterThan(10);
    expect(result.counts.constructions).toBeGreaterThan(0);
    expect(result.counts.compositions).toBeGreaterThan(0);

    const hasMcpTool = result.capabilities.some((entry) => entry.kind === 'mcp_tool' && entry.name === 'query');
    const hasConstruction = result.capabilities.some((entry) => entry.kind === 'construction');
    const hasComposition = result.capabilities.some((entry) => entry.kind === 'composition');
    expect(hasMcpTool).toBe(true);
    expect(hasConstruction).toBe(true);
    expect(hasComposition).toBe(true);
  });
});
