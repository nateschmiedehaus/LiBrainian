import { describe, expect, it } from 'vitest';
import { getCurrentVersion } from '../versioning.js';
import type { LibrarianQuery } from '../../types.js';

function createBaseQuery(intent: string): LibrarianQuery {
  return {
    intent,
    depth: 'L1',
  };
}

describe('query cache semantic key normalization', () => {
  it('produces the same cache key for paraphrased authentication intents', async () => {
    const { __testing } = await import('../query.js');
    const version = getCurrentVersion();

    const keyA = __testing.buildQueryCacheKey(
      createBaseQuery('how does auth work?'),
      version,
      'disabled',
      false
    );
    const keyB = __testing.buildQueryCacheKey(
      createBaseQuery('explain the authentication flow'),
      version,
      'disabled',
      false
    );

    expect(__testing.normalizeIntentForCache('how does auth work?')).toBe('auth workflow');
    expect(__testing.normalizeIntentForCache('explain the authentication flow')).toBe('auth workflow');
    expect(keyA).toBe(keyB);
  });

  it('keeps unrelated intents on different cache keys', async () => {
    const { __testing } = await import('../query.js');
    const version = getCurrentVersion();

    const authKey = __testing.buildQueryCacheKey(
      createBaseQuery('how does auth work'),
      version,
      'disabled',
      false
    );
    const rateLimitKey = __testing.buildQueryCacheKey(
      createBaseQuery('how does rate limiting work'),
      version,
      'disabled',
      false
    );

    expect(__testing.normalizeIntentForCache('how does rate limiting work')).toContain('rate');
    expect(authKey).not.toBe(rateLimitKey);
  });
});
