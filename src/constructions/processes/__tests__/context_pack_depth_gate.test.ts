import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextPack, LiBrainianVersion } from '../../../types.js';
import {
  createContextPackDepthGateConstruction,
  isShallowContextPack,
} from '../context_pack_depth_gate.js';

const tempRoots: string[] = [];

const TEST_VERSION: LiBrainianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'full',
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-depth-gate-'));
  tempRoots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
  }
  return root;
}

function buildPack(overrides: Partial<ContextPack>): ContextPack {
  return {
    packId: overrides.packId ?? 'pack-1',
    packType: overrides.packType ?? 'module_context',
    targetId: overrides.targetId ?? 'src/file.ts',
    summary: overrides.summary ?? 'Purpose: module summary',
    keyFacts: overrides.keyFacts ?? ['Purpose: module summary'],
    codeSnippets: overrides.codeSnippets ?? [],
    relatedFiles: overrides.relatedFiles ?? ['src/file.ts'],
    confidence: overrides.confidence ?? 0.8,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    accessCount: overrides.accessCount ?? 0,
    lastOutcome: overrides.lastOutcome ?? 'unknown',
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    version: overrides.version ?? TEST_VERSION,
    invalidationTriggers: overrides.invalidationTriggers ?? ['src/file.ts'],
  };
}

describe('Context Pack Depth Gate', () => {
  it('validates function lookup, module overview, and dependency trace depth checks', async () => {
    const fixture = await createFixture({
      'src/data/db.ts': [
        'type Db = { sessions: string[] };',
        'const singleton: Db = { sessions: [] };',
        'export const getDb = (): Db => singleton;',
        '',
      ].join('\n'),
      'src/utils/id.ts': [
        'let counter = 0;',
        'export const nextId = (prefix: string): string => `${prefix}-${++counter}`;',
        '',
      ].join('\n'),
      'src/auth/sessionStore.ts': [
        "import { getDb } from '../data/db';",
        "import { nextId } from '../utils/id';",
        '',
        'export interface Session {',
        '  token: string;',
        '  userId: string;',
        '}',
        '',
        'export const createSession = (userId: string): Session => {',
        '  const db = getDb();',
        "  const token = nextId('session');",
        '  db.sessions.push(token);',
        '  return { token, userId };',
        '};',
        '',
      ].join('\n'),
    });

    const gate = createContextPackDepthGateConstruction();
    const result = await gate.execute({
      fixtures: [
        {
          name: 'ts-depth-fixture',
          repoPath: fixture,
          queries: [
            {
              type: 'function_lookup',
              intent: 'What is the signature of createSession?',
            },
            {
              type: 'module_overview',
              intent: 'Provide a module overview of sessionStore exports and structure',
            },
            {
              type: 'dependency_trace',
              intent: 'Trace dependencies imported by sessionStore',
              expectedRelatedFiles: ['src/auth/sessionStore.ts', 'src/data/db.ts', 'src/utils/id.ts'],
            },
          ],
        },
      ],
      maxDurationMs: 120_000,
    });

    expect(result.kind).toBe('ContextPackDepthGateResult.v1');
    expect(result.fixtures).toHaveLength(1);
    expect(result.fixtures[0]?.queryResults).toHaveLength(3);
    expect(result.durationMs).toBeLessThan(120_000);
    expect(result.fixtures[0]?.queryResults.every((query) => query.packCount > 0)).toBe(true);
    expect(result.fixtures[0]?.queryResults.every((query) => query.shallowPackCount === 0)).toBe(true);

    const functionQuery = result.fixtures[0]?.queryResults.find((query) => query.type === 'function_lookup');
    expect(functionQuery?.signatureFactCount).toBeGreaterThan(0);

    const dependencyQuery = result.fixtures[0]?.queryResults.find((query) => query.type === 'dependency_trace');
    expect(dependencyQuery?.importRelationshipFactCount).toBeGreaterThan(0);
    expect(dependencyQuery?.invalidRelatedFileCount).toBe(0);
  }, 140_000);

  it('flags shallow summary-only packs', () => {
    const shallow = buildPack({
      summary: 'Purpose: Module helper',
      keyFacts: ['Purpose: Module helper'],
      codeSnippets: [],
    });
    expect(isShallowContextPack(shallow)).toBe(true);

    const deep = buildPack({
      keyFacts: ['Data structures: Session', 'Top-level routines: createSession'],
      codeSnippets: [
        {
          filePath: 'src/auth/sessionStore.ts',
          startLine: 1,
          endLine: 4,
          content: 'export const createSession = (userId: string): Session => ({ token: userId, userId });',
          language: 'typescript',
        },
      ],
    });
    expect(isShallowContextPack(deep)).toBe(false);
  });
});
