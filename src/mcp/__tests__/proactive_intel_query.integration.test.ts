import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { getCurrentVersion } from '../../api/versioning.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, UniversalKnowledgeRecord } from '../../storage/types.js';
import { createLiBrainianMCPServer } from '../server.js';

function parseToolPayload(result: unknown): Record<string, unknown> {
  const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`Expected text content in tool result: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function buildUniversalKnowledge(filePath: string): UniversalKnowledgeRecord {
  return {
    id: `uk_${randomUUID()}`,
    kind: 'function',
    name: 'verifyToken',
    qualifiedName: 'auth.verifyToken',
    file: filePath,
    line: 1,
    knowledge: JSON.stringify({
      semantics: {
        purpose: {
          summary: 'Validates JWT tokens and refresh boundaries.',
        },
      },
      history: {
        churnHistory: {
          changesLast7Days: 6,
        },
      },
    }),
    purposeSummary: 'Validates JWT tokens and refresh boundaries.',
    maintainabilityIndex: 42,
    riskScore: 0.92,
    confidence: 0.91,
    generatedAt: new Date().toISOString(),
    hash: `hash_${randomUUID()}`,
  };
}

async function seedWorkspaceStorage(storage: LiBrainianStorage, filePath: string, partnerPath: string): Promise<void> {
  const version = getCurrentVersion();
  await storage.setVersion(version);

  await storage.upsertModule({
    id: 'module-auth',
    path: filePath,
    purpose: 'Authentication and token validation flow',
    exports: ['verifyToken', 'refreshSession'],
    dependencies: [partnerPath],
    confidence: 0.9,
  });

  await storage.upsertContextPack({
    packId: 'pack-auth-context',
    packType: 'module_context',
    targetId: 'module-auth',
    summary: 'Auth module validates JWT and refresh logic.',
    keyFacts: ['Handles token verification and expiration checks.'],
    codeSnippets: [
      {
        filePath,
        startLine: 1,
        endLine: 3,
        content: 'export function verifyToken(token: string) { return token.length > 0; }',
        language: 'typescript',
      },
    ],
    relatedFiles: [filePath],
    confidence: 0.94,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [filePath, partnerPath],
  });

  await storage.upsertUniversalKnowledge(buildUniversalKnowledge(filePath));

  await storage.upsertOwnership({
    filePath,
    author: '@sarah',
    score: 0.91,
    lastModified: new Date(Date.now() - (23 * 24 * 60 * 60 * 1000)),
  });

  await storage.storeCochangeEdges([
    {
      fileA: filePath,
      fileB: partnerPath,
      strength: 0.87,
      changeCount: 11,
      totalChanges: 20,
    },
  ]);

  await storage.upsertAssessment({
    entityId: 'file-auth',
    entityType: 'file',
    entityPath: filePath,
    findings: [],
    overallHealth: 'at-risk',
    healthScore: 51,
    quickSummary: 'Auth file has elevated operational risk.',
    assessedAt: new Date().toISOString(),
  });
}

describe('MCP query proactive intel integration (real query path)', () => {
  it('returns proactiveIntel to MCP clients from a real LiBrainian query', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-mcp-proactive-integration-'));
    const filePath = path.join(workspace, 'src/auth.ts');
    const partnerPath = path.join(workspace, 'src/config/auth.ts');
    const dbPath = path.join(workspace, '.librarian', 'librarian.db');

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.mkdir(path.dirname(partnerPath), { recursive: true });
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(filePath, 'export function verifyToken(token: string) { return token.length > 0; }\n', 'utf8');
    await fs.writeFile(partnerPath, 'export const AUTH_MODE = "jwt";\n', 'utf8');

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    try {
      await seedWorkspaceStorage(storage, filePath, partnerPath);

      const server = await createLiBrainianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      });
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, {
        indexState: 'ready',
        storage,
      });

      const result = await server.callTool('query', {
        workspace,
        intent: 'Explain auth token verification risks',
        affectedFiles: [filePath],
        sessionId: 'sess-real-query',
        agentId: 'codex-cli',
      });

      expect(result.isError).toBeFalsy();
      const payload = parseToolPayload(result);
      const proactiveIntel = Array.isArray(payload.proactiveIntel) ? payload.proactiveIntel : [];
      expect(proactiveIntel.length).toBeGreaterThan(0);
      expect(proactiveIntel.some((item) => {
        if (!item || typeof item !== 'object') return false;
        return (item as { type?: string }).type === 'security-alert';
      })).toBe(true);
      expect(proactiveIntel.some((item) => {
        if (!item || typeof item !== 'object') return false;
        return (item as { type?: string }).type === 'co-change-alert';
      })).toBe(true);
      expect(payload.proactive_intel).toEqual(payload.proactiveIntel);
    } finally {
      await storage.close();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
