import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateContextPacks } from '../packs.js';
import type { ContextPack, LibrarianVersion, ModuleKnowledge } from '../../types.js';
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

describe('module context pack depth', () => {
  it('includes structural facts and snippet anchored to real declarations', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'librainian-module-pack-'));
    tempDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'ptx.c');

    const header = Array.from({ length: 52 }, (_, idx) => `/* header line ${idx + 1} */`).join('\n');
    await writeFile(filePath, [
      header,
      '',
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '',
      'typedef struct PtxNode {',
      '  int id;',
      '  struct PtxNode* next;',
      '} PtxNode;',
      '',
      'typedef enum TokenKind {',
      '  TK_WORD,',
      '  TK_SPACE,',
      '} TokenKind;',
      '',
      'static PtxNode* create_node(int id) {',
      '  PtxNode* node = malloc(sizeof(PtxNode));',
      '  node->id = id;',
      '  node->next = NULL;',
      '  return node;',
      '}',
      '',
    ].join('\n'));

    const moduleInfo: ModuleKnowledge = {
      id: 'module:ptx',
      path: filePath,
      purpose: '',
      exports: [],
      dependencies: ['stdio.h', 'stdlib.h'],
      confidence: 0.82,
    };

    const capturedPacks: ContextPack[] = [];
    const storage = {
      getFunctions: async () => [],
      getModules: async () => [moduleInfo],
      getVersion: async () => baseVersion,
      getMetadata: async () => ({ workspace: tmpDir }),
      getContextPackForTarget: async () => null,
      upsertContextPack: async (pack: ContextPack) => {
        capturedPacks.push(pack);
      },
    } as unknown as LibrarianStorage;

    const created = await generateContextPacks(storage, {
      functions: [],
      modules: [moduleInfo],
      includeFunctionPacks: false,
      includeModulePacks: true,
      includeSupplemental: false,
      skipLlm: true,
      force: true,
      maxPacks: 10,
      version: baseVersion,
    });

    expect(created).toBeGreaterThan(0);

    const modulePack = capturedPacks.find((pack) => pack.packType === 'module_context');
    expect(modulePack).toBeDefined();
    expect(modulePack?.keyFacts.some((fact) => fact.startsWith('Data structures:'))).toBe(true);
    expect(modulePack?.summary).toContain('PtxNode');
    expect(modulePack?.codeSnippets).toHaveLength(1);
    expect(modulePack?.codeSnippets[0]?.startLine).toBeGreaterThan(40);
    expect(modulePack?.codeSnippets[0]?.content).toContain('typedef struct PtxNode');
  });
});
