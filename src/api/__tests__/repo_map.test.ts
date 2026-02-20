import { describe, expect, it, vi } from 'vitest';
import { generateRepoMap } from '../repo_map.js';
import type { FunctionKnowledge } from '../../types.js';

function makeFunction(id: string, filePath: string, name: string, startLine: number): FunctionKnowledge {
  return {
    id,
    filePath,
    name,
    signature: `${name}()`,
    purpose: `${name} purpose`,
    startLine,
    endLine: startLine + 5,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

describe('generateRepoMap', () => {
  it('boosts focused paths ahead of higher base pagerank files', async () => {
    const workspace = '/workspace';
    const authFn = makeFunction('fn-auth', '/workspace/src/auth/login.ts', 'loginHandler', 10);
    const utilFn = makeFunction('fn-util', '/workspace/src/utils/math.ts', 'sum', 4);

    const storage = {
      getFunctions: vi.fn().mockResolvedValue([authFn, utilFn]),
      getGraphMetrics: vi.fn().mockResolvedValue([
        { entityId: 'fn-auth', pagerank: 0.1 },
        { entityId: 'fn-util', pagerank: 0.9 },
      ]),
    } as any;

    const result = await generateRepoMap(storage, workspace, {
      style: 'json',
      focus: ['src/auth'],
    });

    expect(result.entries[0]?.path).toBe('src/auth/login.ts');
    expect(result.entries[1]?.path).toBe('src/utils/math.ts');
  });

  it('respects maxTokens by truncating low-ranked entries', async () => {
    const workspace = '/workspace';
    const a = makeFunction('fn-a', '/workspace/src/a.ts', 'a', 1);
    const b = makeFunction('fn-b', '/workspace/src/b.ts', 'b', 1);
    const c = makeFunction('fn-c', '/workspace/src/c.ts', 'c', 1);
    const d = makeFunction('fn-d', '/workspace/src/d.ts', 'd', 1);
    a.signature = 'x '.repeat(120);
    b.signature = 'x '.repeat(120);
    c.signature = 'x '.repeat(120);
    d.signature = 'x '.repeat(120);

    const storage = {
      getFunctions: vi.fn().mockResolvedValue([a, b, c, d]),
      getGraphMetrics: vi.fn().mockResolvedValue([
        { entityId: 'fn-a', pagerank: 0.8 },
        { entityId: 'fn-b', pagerank: 0.6 },
        { entityId: 'fn-c', pagerank: 0.4 },
        { entityId: 'fn-d', pagerank: 0.2 },
      ]),
    } as any;

    const result = await generateRepoMap(storage, workspace, {
      style: 'compact',
      maxTokens: 128,
    });

    expect(result.entries.length).toBeLessThan(4);
    expect(result.consumedTokens).toBeLessThanOrEqual(128);
    expect(result.entries[0]?.path).toBe('src/a.ts');
  });
});
