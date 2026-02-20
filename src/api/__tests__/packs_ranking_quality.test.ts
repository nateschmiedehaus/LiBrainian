import { describe, expect, it } from 'vitest';
import { rankContextPacks } from '../packs.js';
import type { ContextPack } from '../../types.js';

function createPack(overrides: Partial<ContextPack>): ContextPack {
  return {
    packId: overrides.packId ?? 'pack',
    packType: overrides.packType ?? 'module_context',
    targetId: overrides.targetId ?? 'src/default.ts',
    summary: overrides.summary ?? 'Default summary',
    keyFacts: overrides.keyFacts ?? [],
    codeSnippets: overrides.codeSnippets ?? [],
    relatedFiles: overrides.relatedFiles ?? ['src/default.ts'],
    confidence: overrides.confidence ?? 0.8,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    accessCount: overrides.accessCount ?? 0,
    lastOutcome: overrides.lastOutcome ?? 'unknown',
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    version: overrides.version ?? {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'full',
      indexedAt: new Date('2026-01-01T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    invalidationTriggers: overrides.invalidationTriggers ?? ['src/default.ts'],
  };
}

describe('context pack ranking quality', () => {
  it('drops internal artifact-only packs from ranking output', () => {
    const internalPack = createPack({
      packId: 'internal',
      targetId: '.librarian/state/retrieval_confidence_log.jsonl',
      summary: 'internal log',
      relatedFiles: ['.librarian/state/retrieval_confidence_log.jsonl'],
      keyFacts: ['Purpose: Internal state'],
      confidence: 0.99,
    });
    const realPack = createPack({
      packId: 'real',
      targetId: 'src/auth/token.ts',
      summary: 'auth token utilities',
      relatedFiles: ['src/auth/token.ts'],
      keyFacts: ['Contains: issueToken, verifyToken'],
      confidence: 0.7,
    });

    const ranked = rankContextPacks({
      packs: [internalPack, realPack],
      maxPacks: 5,
      depth: 'L1',
      taskType: 'feature',
    });

    expect(ranked.packs.map((pack) => pack.packId)).toEqual(['real']);
  });

  it('prefers richer module packs over shallow stubs when base confidence is equal', () => {
    const shallow = createPack({
      packId: 'shallow',
      targetId: 'src/ptx.c',
      summary: 'Module ptx',
      keyFacts: [
        'Purpose: Module ptx',
        'Imports: 8 external modules',
        'Role: Core module (high PageRank: 0.250)',
      ],
      codeSnippets: [],
      relatedFiles: ['src/ptx.c'],
      confidence: 0.8,
    });
    const rich = createPack({
      packId: 'rich',
      targetId: 'src/ptx.c',
      summary: 'PTX parser state and token tree definitions',
      keyFacts: [
        'Data structures: PtxNode, TokenKind',
        'Top-level routines: create_node, parse_token',
        'Contains: create_node, parse_token',
      ],
      codeSnippets: [{
        filePath: 'src/ptx.c',
        startLine: 80,
        endLine: 125,
        language: 'c',
        content: 'typedef struct PtxNode { int id; struct PtxNode* next; } PtxNode;',
      }],
      relatedFiles: ['src/ptx.c'],
      confidence: 0.8,
    });

    const ranked = rankContextPacks({
      packs: [shallow, rich],
      maxPacks: 2,
      depth: 'L1',
      taskType: 'feature',
    });

    expect(ranked.packs[0]?.packId).toBe('rich');
  });
});
