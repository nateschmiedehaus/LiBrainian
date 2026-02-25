import { describe, expect, it } from 'vitest';
import type { ContextPack } from '../../types.js';
import {
  buildExplanation,
  dedupePacks,
  resolveEvidenceEntityType,
} from '../query_pack_postprocessing.js';

function pack(packId: string, packType: string): ContextPack {
  return {
    packId,
    packType,
  } as unknown as ContextPack;
}

describe('query_pack_postprocessing', () => {
  it('deduplicates context packs by packId while preserving first occurrence order', () => {
    const deduped = dedupePacks([
      pack('p1', 'module_context'),
      pack('p2', 'function_context'),
      pack('p1', 'doc_context'),
    ]);

    expect(deduped.map((entry) => entry.packId)).toEqual(['p1', 'p2']);
    expect(deduped[0].packType).toBe('module_context');
  });

  it('appends ranking summary when candidate score metadata is available', () => {
    const explanation = buildExplanation(['Retrieved semantic candidates.'], 0.734, 4);
    expect(explanation).toContain('Retrieved semantic candidates.');
    expect(explanation).toContain('Ranked 4 candidates (avg score 0.73).');
  });

  it('maps context-pack types to evidence entity types', () => {
    expect(resolveEvidenceEntityType(pack('f', 'function_context'))).toBe('function');
    expect(resolveEvidenceEntityType(pack('m', 'module_context'))).toBe('module');
    expect(resolveEvidenceEntityType(pack('d', 'doc_context'))).toBe('module');
    expect(resolveEvidenceEntityType(pack('x', 'test_context'))).toBeNull();
  });
});
