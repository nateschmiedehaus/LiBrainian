import { describe, expect, it } from 'vitest';
import { requireEmbeddingModelId } from '../index_librarian.js';

describe('requireEmbeddingModelId', () => {
  it('throws when modelId is undefined', () => {
    expect(() => requireEmbeddingModelId(undefined, 'function:alpha')).toThrowError(
      'unverified_by_trace(embedding_missing_model_id): function:alpha'
    );
  });

  it('throws when modelId is empty', () => {
    expect(() => requireEmbeddingModelId('', 'module:beta')).toThrowError(
      'unverified_by_trace(embedding_missing_model_id): module:beta'
    );
  });

  it('throws when modelId is whitespace-only', () => {
    expect(() => requireEmbeddingModelId('   ', 'module:gamma')).toThrowError(
      'unverified_by_trace(embedding_missing_model_id): module:gamma'
    );
  });

  it('returns trimmed modelId when valid', () => {
    expect(requireEmbeddingModelId('  model-xyz  ', 'function:delta')).toBe('model-xyz');
  });
});
