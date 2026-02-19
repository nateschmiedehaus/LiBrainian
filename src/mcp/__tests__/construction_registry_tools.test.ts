import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../../constructions/composition.js';
import { createLibrarianMCPServer } from '../server.js';

const GENERATED_ID = '@librainian-community/mcp-invoke-registry-test';

describe('MCP construction registry tools', () => {
  it('lists constructions and includes runtime-generated entries', async () => {
    createConstruction(
      'mcp-invoke-registry-test',
      'MCP Invoke Registry Test',
      async (input: number) => ({
        data: input * 2,
        confidence: deterministic(true, 'mcp_test'),
      }),
    );

    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const results = await (server as any).executeListConstructions({
      tags: ['runtime'],
      availableOnly: true,
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.some((manifest: { id: string }) => manifest.id === GENERATED_ID)).toBe(true);
  });

  it('invokes a registered runtime construction by id', async () => {
    createConstruction(
      'mcp-invoke-registry-test',
      'MCP Invoke Registry Test',
      async (input: number) => ({
        data: input * 2,
        confidence: deterministic(true, 'mcp_test'),
      }),
    );

    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const result = await (server as any).executeInvokeConstruction({
      constructionId: GENERATED_ID,
      input: 21,
    });

    expect(result.success).toBe(true);
    expect(result.constructionId).toBe(GENERATED_ID);
    expect(result.result.data).toBe(42);
  });

  it('rejects unknown construction IDs with an actionable error', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    await expect(
      (server as any).executeInvokeConstruction({
        constructionId: 'librainian:not-real',
        input: {},
      }),
    ).rejects.toThrow(/Unknown Construction ID/i);
  });
});
