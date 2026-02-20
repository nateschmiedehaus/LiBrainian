import { describe, expect, it } from 'vitest';
import type { LibrarianQuery } from '../../types.js';

function makeQuery(intent: string): LibrarianQuery {
  return {
    intent,
    depth: 'L1',
    taskType: 'search',
    filter: {
      pathPrefix: 'src/',
      language: 'typescript',
    },
  };
}

describe('adaptive semantic cache helpers', () => {
  it('classifies lookup vs conceptual vs diagnostic intents', async () => {
    const { __testing } = await import('../query.js');

    expect(__testing.classifySemanticCacheCategory('authenticateUser function')).toBe('lookup');
    expect(__testing.classifySemanticCacheCategory('how does auth architecture work')).toBe('conceptual');
    expect(__testing.classifySemanticCacheCategory('why does auth fail with timeout error')).toBe('diagnostic');
  });

  it('maps implementation/function paraphrases to high lookup similarity', async () => {
    const { __testing } = await import('../query.js');

    const a = __testing.normalizeIntentForCache('authenticateUser function');
    const b = __testing.normalizeIntentForCache('authenticateUser implementation');
    const similarity = __testing.computeSemanticIntentSimilarity(a, b);

    expect(similarity).toBe(1);
  });

  it('keeps semantic cache scope stable across intent paraphrases', async () => {
    const { __testing } = await import('../query.js');

    const sigA = __testing.buildSemanticCacheScopeSignature(makeQuery('how does auth work'));
    const sigB = __testing.buildSemanticCacheScopeSignature(makeQuery('explain authentication flow'));

    expect(sigA).toBe(sigB);
  });
});
