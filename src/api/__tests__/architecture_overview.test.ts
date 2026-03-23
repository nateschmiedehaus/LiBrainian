import { describe, expect, it } from 'vitest';
import { generateArchitectureOverview, handleArchitectureQuery } from '../architecture_overview.js';
import type { ContextPack, LibrarianVersion } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';

const TEST_VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0-test',
  qualityTier: 'full',
  indexedAt: new Date('2026-03-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

describe('architecture_overview', () => {
  it('falls back to the filesystem when directory knowledge is missing', async () => {
    const storage = {
      getDirectories: async () => [],
      getGraphEdges: async () => [],
    } as unknown as LibrarianStorage;

    const pack = await generateArchitectureOverview(storage, process.cwd(), TEST_VERSION);

    expect(pack.summary).toContain('Architecture has');
    expect(pack.keyFacts.some((fact) => fact.includes('api/'))).toBe(true);
    expect(pack.relatedFiles.some((file) => file === 'src/api')).toBe(true);
  });

  it('filters architecture query results down to structural, non-test context', async () => {
    const storage = {
      getDirectories: async () => [
        {
          id: 'dir-api',
          path: '/repo/src/api',
          relativePath: 'src/api',
          name: 'api',
          fingerprint: 'api',
          purpose: 'Application API layer',
          role: 'layer',
          description: 'API layer',
          pattern: 'flat',
          depth: 1,
          fileCount: 3,
          subdirectoryCount: 0,
          totalFiles: 3,
          mainFiles: ['src/api/query.ts'],
          subdirectories: [],
          fileTypes: { '.ts': 3 },
          parent: 'src',
          siblings: ['mcp', 'utils'],
          relatedDirectories: ['src/mcp'],
          hasReadme: false,
          hasIndex: false,
          hasTests: false,
          complexity: 'medium',
          confidence: 0.8,
          lastIndexed: '2026-03-19T00:00:00.000Z',
        },
        {
          id: 'dir-mcp',
          path: '/repo/src/mcp',
          relativePath: 'src/mcp',
          name: 'mcp',
          fingerprint: 'mcp',
          purpose: 'MCP server layer',
          role: 'layer',
          description: 'MCP layer',
          pattern: 'flat',
          depth: 1,
          fileCount: 3,
          subdirectoryCount: 0,
          totalFiles: 3,
          mainFiles: ['src/mcp/authentication.ts'],
          subdirectories: [],
          fileTypes: { '.ts': 3 },
          parent: 'src',
          siblings: ['api', 'utils'],
          relatedDirectories: ['src/utils'],
          hasReadme: false,
          hasIndex: false,
          hasTests: false,
          complexity: 'medium',
          confidence: 0.85,
          lastIndexed: '2026-03-19T00:00:00.000Z',
        },
        {
          id: 'dir-utils',
          path: '/repo/src/utils',
          relativePath: 'src/utils',
          name: 'utils',
          fingerprint: 'utils',
          purpose: 'Utility layer',
          role: 'utility',
          description: 'Utilities',
          pattern: 'flat',
          depth: 1,
          fileCount: 2,
          subdirectoryCount: 0,
          totalFiles: 2,
          mainFiles: ['src/utils/auth_checker.ts'],
          subdirectories: [],
          fileTypes: { '.ts': 2 },
          parent: 'src',
          siblings: ['api', 'mcp'],
          relatedDirectories: ['src/mcp'],
          hasReadme: false,
          hasIndex: false,
          hasTests: false,
          complexity: 'low',
          confidence: 0.75,
          lastIndexed: '2026-03-19T00:00:00.000Z',
        },
      ],
      getGraphEdges: async () => [],
    } as unknown as LibrarianStorage;

    const createPack = (overrides: Partial<ContextPack>): ContextPack => ({
      packId: 'pack-1',
      packType: 'module_context',
      targetId: 'module-1',
      summary: 'Module summary',
      keyFacts: [],
      codeSnippets: [],
      relatedFiles: ['src/api/query.ts'],
      confidence: 0.6,
      createdAt: new Date('2026-03-19T00:00:00.000Z'),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: TEST_VERSION,
      invalidationTriggers: [],
      ...overrides,
    });

    const packs = [
      createPack({
        packId: 'fixture-pack',
        relatedFiles: ['tests/fixtures/index-correctness-fixture/src/auth/session.ts'],
        summary: 'Fixture auth session helpers',
        confidence: 0.92,
      }),
      createPack({
        packId: 'auth-pack',
        relatedFiles: ['src/mcp/authentication.ts'],
        summary: 'Authentication module structure and session/token flows',
        confidence: 0.74,
      }),
      createPack({
        packId: 'auth-checker-pack',
        relatedFiles: ['src/utils/auth_checker.ts'],
        summary: 'Auth checker module that summarizes provider auth state',
        confidence: 0.69,
      }),
      createPack({
        packId: 'identity-pack',
        relatedFiles: ['src/knowledge/extractors/identity.ts'],
        summary: 'Identity extraction internals',
        confidence: 0.88,
      }),
      createPack({
        packId: 'function-pack',
        packType: 'function_context',
        relatedFiles: ['src/mcp/authentication.ts'],
        summary: 'authorize() implementation details',
        confidence: 0.81,
      }),
    ];

    const result = await handleArchitectureQuery(
      storage,
      '/repo',
      packs,
      TEST_VERSION,
      'how is the auth module structured?'
    );

    expect(result[0]?.packType).toBe('architecture_overview');
    expect(result.some(pack => pack.packType === 'function_context')).toBe(false);
    expect(result.some(pack => pack.relatedFiles.some(file => file.includes('tests/fixtures')))).toBe(false);
    expect(result.some(pack => pack.relatedFiles.includes('src/mcp/authentication.ts'))).toBe(true);
    expect(result.some(pack => pack.relatedFiles.includes('src/utils/auth_checker.ts'))).toBe(true);
    expect(result.some(pack => pack.relatedFiles.includes('src/knowledge/extractors/identity.ts'))).toBe(false);
  });
});
