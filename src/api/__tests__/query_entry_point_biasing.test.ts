import { describe, expect, it } from 'vitest';
import type { SimilarityResult } from '../../storage/types.js';
import {
  applyEntryPointBias,
  isEntryPointEntity,
} from '../query_entry_point_biasing.js';

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

describe('query_entry_point_biasing', () => {
  it('detects entry points from path, naming convention, and source markers', () => {
    expect(isEntryPointEntity('mod:src/index.ts')).toBe(true);
    expect(isEntryPointEntity('func:src/app/bootstrap.ts::createApp', 'createApp')).toBe(true);
    expect(isEntryPointEntity('entry_point:src/cli/index.ts')).toBe(true);
    expect(isEntryPointEntity('func:src/internal/helpers.ts::normalize')).toBe(false);
  });

  it('boosts entry points and keeps descending rank order', () => {
    const input: SimilarityResult[] = [
      result('func:src/internal/helpers.ts::_normalize', 'function', 0.82),
      result('func:src/index.ts::main', 'function', 0.62),
      result('mod:src/core/engine.ts', 'module', 0.7),
    ];

    const ranked = applyEntryPointBias(input, 0.9, new Map([
      ['func:src/index.ts::main', 'main'],
      ['func:src/internal/helpers.ts::_normalize', '_normalize'],
    ]));

    expect(ranked[0].entityId).toBe('func:src/index.ts::main');
    expect(ranked[0].similarity).toBeCloseTo(0.9548, 10);
    expect(ranked[1].entityId).toBe('mod:src/core/engine.ts');
  });

  it('does not alter rankings when entry-point bias is negligible', () => {
    const input: SimilarityResult[] = [
      result('func:src/internal/helpers.ts::_normalize', 'function', 0.82),
      result('func:src/index.ts::main', 'function', 0.62),
    ];

    const ranked = applyEntryPointBias(input, 0.05);
    expect(ranked).toEqual(input);
  });
});
