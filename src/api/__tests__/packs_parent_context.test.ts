import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateContextPacks } from '../packs.js';
import type { ContextPack, FunctionKnowledge, LibrarianVersion } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';

const baseVersion: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'full',
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('function pack parent context', () => {
  it('prepends parent class/import/constructor context and reports token overhead', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'librainian-packs-'));
    tempDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'service.ts');
    await writeFile(filePath, [
      "import { Repo } from './repo';",
      "import { Logger } from './logger';",
      '',
      'export class UserService {',
      '  constructor(private readonly repo: Repo, private readonly logger: Logger) {}',
      '',
      '  authenticate(userId: string): boolean {',
      "    this.logger.info('auth');",
      '    return this.repo.hasSession(userId);',
      '  }',
      '}',
      '',
    ].join('\n'));

    const fn: FunctionKnowledge = {
      id: 'fn-auth',
      filePath,
      name: 'authenticate',
      signature: 'authenticate(userId: string): boolean',
      purpose: 'Authenticates a user by checking session state',
      startLine: 7,
      endLine: 10,
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const capturedPacks: ContextPack[] = [];
    const storage = {
      getFunctions: async () => [fn],
      getModules: async () => [],
      getVersion: async () => baseVersion,
      getMetadata: async () => ({ workspace: tmpDir }),
      getContextPackForTarget: async () => null,
      upsertContextPack: async (pack: ContextPack) => {
        capturedPacks.push(pack);
      },
    } as unknown as LibrarianStorage;

    const created = await generateContextPacks(storage, {
      functions: [fn],
      modules: [],
      includeModulePacks: false,
      includeSupplemental: false,
      skipLlm: true,
      force: true,
      maxPacks: 10,
      version: baseVersion,
    });

    expect(created).toBe(1);
    expect(capturedPacks).toHaveLength(1);

    const pack = capturedPacks[0]!;
    expect(pack.packType).toBe('function_context');
    expect(pack.codeSnippets).toHaveLength(1);
    const content = pack.codeSnippets[0]!.content;
    expect(content).toContain('Parent module imports');
    expect(content).toContain("import { Repo } from './repo';");
    expect(content).toContain('Parent class signature');
    expect(content).toContain('export class UserService {');
    expect(content).toContain('Parent constructor signature');
    expect(content).toContain('constructor(private readonly repo: Repo, private readonly logger: Logger) {}');
    expect(content).toContain('authenticate(userId: string): boolean');

    expect(pack.keyFacts.some((fact) => fact.startsWith('Parent class: export class UserService {'))).toBe(true);
    expect(pack.keyFacts.some((fact) => fact.startsWith('Constructor context: constructor('))).toBe(true);
    expect(pack.keyFacts.some((fact) => fact.startsWith('Parent context overhead: ~'))).toBe(true);
    expect((content.match(/export class UserService \{/g) ?? []).length).toBe(1);
  });
});
