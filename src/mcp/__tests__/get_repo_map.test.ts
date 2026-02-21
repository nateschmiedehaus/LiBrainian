import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';

describe('MCP get_repo_map tool', () => {
  it('is discoverable in MCP tool registry', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librainian/audit/mcp', retentionDays: 1 },
    });
    const tools = (server as any).getAvailableTools() as Array<{ name: string }>;
    expect(tools.some((tool) => tool.name === 'get_repo_map')).toBe(true);
  });

  it('returns a repo map payload for a workspace', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-mcp-repo-map-'));
    try {
      const server = await createLiBrainianMCPServer({
        authorization: { enabledScopes: ['read'], requireConsent: false },
        audit: { enabled: false, logPath: '.librainian/audit/mcp', retentionDays: 1 },
      });

      const result = await (server as any).executeGetRepoMap({
        workspace,
        maxTokens: 1024,
        style: 'json',
      });

      expect(result.success).toBe(true);
      expect(result.workspace).toBe(workspace);
      expect(result.style).toBe('json');
      expect(Array.isArray(result.entries)).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
