import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createLiBrainianMCPServer } from '../server.js';
import type { ValidateChangePlanToolInput } from '../types.js';

interface ValidateChangePlanResult {
  success: boolean;
  tool: string;
  verdict?: 'COMPLETE' | 'INCOMPLETE' | 'RISKY';
  workspace?: string;
  missing_files?: Array<{ path: string }>;
}

interface ValidateChangePlanInternals {
  getAvailableTools(): Array<{ name: string }>;
  executeValidateChangePlan(input: ValidateChangePlanToolInput): Promise<ValidateChangePlanResult>;
  getOrCreateStorage(workspace: string): Promise<unknown>;
}

describe('MCP validate_change_plan tool', () => {
  it('is discoverable in MCP tool registry', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });
    const internals = server as unknown as ValidateChangePlanInternals;
    const tools = internals.getAvailableTools();
    expect(tools.some((tool) => tool.name === 'validate_change_plan')).toBe(true);
  });

  it('returns INCOMPLETE when planned files miss known caller impacts', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-validate-plan-'));
    const targetFile = path.join(workspace, 'src', 'auth', 'service.ts');
    const callerFile = path.join(workspace, 'src', 'api', 'login.ts');
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.mkdir(path.dirname(callerFile), { recursive: true });
    await fs.writeFile(targetFile, 'export function login(user: string, pass: string) { return `${user}:${pass}`; }\n', 'utf8');
    await fs.writeFile(callerFile, 'import { login } from "../auth/service";\nexport function route(){ return login("u","p"); }\n', 'utf8');

    try {
      const server = await createLiBrainianMCPServer({
        authorization: { enabledScopes: ['read'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      const internals = server as unknown as ValidateChangePlanInternals;
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      vi.spyOn(internals, 'getOrCreateStorage').mockResolvedValue({
        getModules: vi.fn().mockResolvedValue([]),
        getFunctionsByName: vi.fn().mockResolvedValue([
          {
            id: 'fn:auth:login',
            filePath: targetFile,
            name: 'login',
            signature: 'login(user: string, pass: string): string',
            purpose: 'login purpose',
            startLine: 1,
            endLine: 1,
            confidence: 0.9,
            accessCount: 0,
            lastAccessed: null,
            validationCount: 0,
            outcomeHistory: { successes: 0, failures: 0 },
          },
        ]),
        getGraphEdges: vi.fn().mockResolvedValue([
          {
            fromId: 'fn:api:route',
            fromType: 'function',
            toId: 'fn:auth:login',
            toType: 'function',
            edgeType: 'calls',
            sourceFile: callerFile,
            sourceLine: 2,
            confidence: 0.9,
            computedAt: new Date('2026-02-21T00:00:00.000Z'),
          },
        ]),
      });

      const result = await internals.executeValidateChangePlan({
        description: 'Rename login to authenticate',
        planned_files: [targetFile],
        workspace,
        change_type: 'rename',
        symbols_affected: ['login'],
      });

      expect(result.success).toBe(true);
      expect(result.tool).toBe('validate_change_plan');
      expect(result.verdict).toBe('INCOMPLETE');
      expect(Array.isArray(result.missing_files)).toBe(true);
      expect(result.missing_files.some((entry: { path: string }) => entry.path === callerFile)).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('runs against LiBrainian workspace path without failures', async () => {
    const workspace = path.resolve(process.cwd());
    const server = await createLiBrainianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });
    const internals = server as unknown as ValidateChangePlanInternals;
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    const result = await internals.executeValidateChangePlan({
      description: 'Sanity-check this workspace for plan validation wiring',
      planned_files: [path.join(workspace, 'src', 'mcp', 'server.ts')],
      workspace,
      change_type: 'general',
      symbols_affected: [],
    });

    expect(result.success).toBe(true);
    expect(result.tool).toBe('validate_change_plan');
    expect(result.workspace).toBe(workspace);
  });
});
