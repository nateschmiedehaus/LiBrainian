import { describe, expect, it } from 'vitest';
import { listToolSchemas } from '../schema.js';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP tool registry consistency', () => {
  it('keeps server tool list in sync with schema registry', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write', 'execute', 'network', 'admin'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const toolEntries = (server as any).getAvailableTools() as Array<Record<string, any>>;
    const serverTools: string[] = toolEntries.map((tool) => tool.name);
    const schemaTools = listToolSchemas();

    expect(new Set(serverTools)).toEqual(new Set(schemaTools));

    for (const tool of toolEntries) {
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
      expect(typeof tool._meta?.requiresIndex).toBe('boolean');
      expect(typeof tool._meta?.requiresEmbeddings).toBe('boolean');
      expect(typeof tool._meta?.estimatedTokens).toBe('number');
    }
  });
});
