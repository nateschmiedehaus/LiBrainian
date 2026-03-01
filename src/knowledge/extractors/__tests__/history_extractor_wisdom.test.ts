import { describe, expect, it } from 'vitest';
import { extractOwnership } from '../history_extractor.js';

describe('extractOwnership wisdom integration', () => {
  it('populates ownership knowledge from LLM wisdom even without comment markers', async () => {
    const result = await extractOwnership({
      filePath: '/repo/src/api/query.ts',
      workspaceRoot: '/repo',
      ownershipData: [{ author: 'alice', score: 0.8, lastModified: '2026-02-20T00:00:00.000Z' }],
      wisdom: {
        gotchas: ['Query cache key must include semantic status.'],
        tips: ['Use staged retrieval before synthesis for long intents.'],
        tribal: ['Synthesis warnings are treated as blockers in patrol.'],
        learningPath: [
          { order: 2, description: 'Trace synthesis stage fallbacks.' },
          { order: 1, description: 'Start with query pipeline stages.' },
        ],
      },
    });

    expect(result.ownership.knowledge.gotchas.map((g) => g.description)).toContain(
      'Query cache key must include semantic status.'
    );
    expect(result.ownership.knowledge.tips.map((t) => t.description)).toContain(
      'Use staged retrieval before synthesis for long intents.'
    );
    expect(result.ownership.knowledge.tribal.map((k) => k.knowledge)).toContain(
      'Synthesis warnings are treated as blockers in patrol.'
    );
    expect(result.ownership.knowledge.learningPath).toEqual([
      { order: 1, description: 'Start with query pipeline stages.' },
      { order: 2, description: 'Trace synthesis stage fallbacks.' },
    ]);
  });

  it('does not inject generic hardcoded learning path for complex files', async () => {
    const veryComplexContent = Array.from(
      { length: 220 },
      (_value, index) => `if (flag${index}) { process(item${index}); }`
    ).join('\n');

    const result = await extractOwnership({
      filePath: '/repo/src/core/complex.ts',
      workspaceRoot: '/repo',
      content: veryComplexContent,
      ownershipData: [{ author: 'bob', score: 0.9, lastModified: '2026-02-20T00:00:00.000Z' }],
    });

    expect(result.ownership.knowledge.learningPath).toEqual([]);
  });

  it('merges wisdom and comment-derived gotchas without duplicates', async () => {
    const result = await extractOwnership({
      filePath: '/repo/src/core/merge.ts',
      workspaceRoot: '/repo',
      content: `// GOTCHA: Keep lock acquisition order consistent.\n// NOTE: release lock in finally.`,
      ownershipData: [{ author: 'charlie', score: 0.6, lastModified: '2026-02-20T00:00:00.000Z' }],
      wisdom: {
        gotchas: [
          'Keep lock acquisition order consistent.',
          'Nested retries can duplicate side effects.',
        ],
      },
    });

    const gotchas = result.ownership.knowledge.gotchas.map((g) => g.description);
    expect(gotchas).toContain('Keep lock acquisition order consistent.');
    expect(gotchas).toContain('Nested retries can duplicate side effects.');
    expect(gotchas.filter((g) => g === 'Keep lock acquisition order consistent.')).toHaveLength(1);
  });
});
