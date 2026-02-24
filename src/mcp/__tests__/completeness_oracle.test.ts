import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLibrarianMCPServer } from '../server.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';

function createFunction(filePath: string, name: string, idx: number) {
  return {
    id: `fn-${idx}-${name}`,
    filePath,
    name,
    signature: `${name}(): Promise<void>`,
    purpose: `${name} purpose`,
    startLine: 1,
    endLine: 20,
    confidence: 0.8,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

describe('librarian_completeness_check MCP tool', () => {
  it('returns a structured completeness report payload', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-completeness-'));
    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    try {
      const names = ['User', 'Invoice', 'Product', 'Cart', 'Team', 'Project'];
      let idx = 0;
      for (const name of names) {
        const token = name.toLowerCase();
        await storage.upsertFunction(createFunction(path.join(workspace, 'src', `${token}.ts`), `create${name}`, idx++));
        await storage.upsertFunction(createFunction(path.join(workspace, 'tests', `${token}.test.ts`), `test${name}`, idx++));
        await storage.upsertFunction(createFunction(path.join(workspace, 'migrations', `${token}.sql.ts`), `migration${name}`, idx++));
        await storage.upsertFunction(createFunction(path.join(workspace, 'src', 'routes', `${token}.ts`), `route${name}`, idx++));
      }
      await storage.upsertFunction(createFunction(path.join(workspace, 'src', 'order.ts'), 'createOrder', 999));
    } finally {
      await storage.close();
    }

    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write', 'execute', 'network', 'admin'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const response = await (server as any).callTool('librarian_completeness_check', {
      workspace,
      mode: 'full',
      supportThreshold: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as {
      success?: boolean;
      tool?: string;
      report?: {
        checkedElements?: number;
        templates?: Array<{ artifact?: string }>;
        gaps?: Array<{ artifact?: string }>;
        suggestions?: Array<{ artifact?: string }>;
      };
    };

    expect(payload.success).toBe(true);
    expect(payload.tool).toBe('librarian_completeness_check');
    expect((payload.report?.checkedElements ?? 0) > 0).toBe(true);
    expect(Array.isArray(payload.report?.templates)).toBe(true);
    expect((payload.report?.templates?.length ?? 0) > 0).toBe(true);
    expect(Array.isArray(payload.report?.gaps)).toBe(true);
    expect(Array.isArray(payload.report?.suggestions)).toBe(true);
  });
});
