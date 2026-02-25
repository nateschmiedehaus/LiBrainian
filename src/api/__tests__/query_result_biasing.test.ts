import { describe, expect, it } from 'vitest';
import type { SimilarityResult } from '../../storage/types.js';
import {
  applyDefinitionBias,
  applyDocumentBias,
  isDefinitionEntity,
} from '../query_result_biasing.js';

function result(
  entityId: string,
  entityType: SimilarityResult['entityType'],
  similarity: number
): SimilarityResult {
  return {
    entityId,
    entityType,
    similarity,
    sourceText: '',
    source: 'semantic',
  };
}

describe('query_result_biasing', () => {
  it('boosts documents and keeps descending similarity order', () => {
    const input: SimilarityResult[] = [
      result('doc:README.md', 'document', 0.5),
      result('func:src/core/engine.ts::run', 'function', 0.7),
      result('mod:src/core', 'module', 0.6),
    ];

    const ranked = applyDocumentBias(input, 0.9);

    expect(ranked[0].entityId).toBe('func:src/core/engine.ts::run');
    expect(ranked[1].entityId).toBe('doc:README.md');
    expect(ranked[1].similarity).toBeCloseTo(0.65, 10);
  });

  it('detects definition entities using id and naming conventions', () => {
    expect(isDefinitionEntity('type:QueryOptions')).toBe(true);
    expect(isDefinitionEntity('func:test', 'IStorage')).toBe(true);
    expect(isDefinitionEntity('mod:src/storage/types.ts')).toBe(true);
    expect(isDefinitionEntity('func:src/storage/sqlite.ts::getStorage')).toBe(false);
  });

  it('boosts definitions and penalizes implementation-style usage names', () => {
    const input: SimilarityResult[] = [
      result('func:src/storage/types.ts::LibrarianStorage::interface', 'function', 0.4),
      result('func:src/storage/sqlite.ts::getStorage', 'function', 0.8),
      result('mod:src/storage/index.ts', 'module', 0.5),
    ];
    const names = new Map<string, string>([
      ['func:src/storage/types.ts::LibrarianStorage::interface', 'LibrarianStorage'],
      ['func:src/storage/sqlite.ts::getStorage', 'getStorage'],
    ]);

    const ranked = applyDefinitionBias(input, 0.8, names);

    expect(ranked[0].entityId).toBe('func:src/storage/types.ts::LibrarianStorage::interface');
    expect(ranked[0].similarity).toBeCloseTo(0.88, 10);
    const usage = ranked.find((entry) => entry.entityId.includes('getStorage'));
    expect(usage?.similarity).toBeCloseTo(0.352, 10);
  });
});
