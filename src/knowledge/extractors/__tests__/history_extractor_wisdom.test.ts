import { describe, expect, it } from 'vitest';
import type { TribalKnowledgeInfo } from '../../universal_types.js';
import { extractOwnership } from '../history_extractor.js';

describe('history_extractor wisdom integration', () => {
  it('does not inject generic learning path steps when no explicit wisdom exists', async () => {
    const denseContent = Array.from({ length: 220 }, (_, index) => `if (cond${index}) { value += ${index}; }`).join('\n');
    const result = await extractOwnership({
      filePath: '/tmp/example.ts',
      workspaceRoot: '/tmp',
      content: denseContent,
    });

    expect(result.ownership.knowledge.learningPath).toEqual([]);
  });

  it('merges semantic wisdom with extracted comment knowledge and deduplicates by content', async () => {
    const semanticWisdom: TribalKnowledgeInfo = {
      tribal: [
        {
          knowledge: 'Normalize all paths before comparison.',
          source: 'LLM semantic extraction',
          importance: 'important',
        },
      ],
      gotchas: [
        {
          description: 'Normalize all paths before comparison.',
          consequence: 'Mismatched separators will break cache hits.',
          prevention: 'Call normalizePath() before map lookups.',
        },
        {
          description: 'Guard against empty workspace roots.',
          consequence: 'Relative path logic may throw.',
          prevention: 'Validate workspaceRoot before slicing.',
        },
      ],
      tips: [
        {
          description: 'Prefer deterministic path canonicalization.',
          context: 'LLM semantic extraction',
        },
      ],
      learningPath: [
        { order: 1, description: 'Understand path normalization boundaries.' },
      ],
    };

    const result = await extractOwnership({
      filePath: '/tmp/example.ts',
      workspaceRoot: '/tmp',
      content: `// GOTCHA: Normalize all paths before comparison.\n// @see docs/path-normalization.md`,
      semanticWisdom,
    });

    const gotchaDescriptions = result.ownership.knowledge.gotchas.map((item) => item.description);
    const pathNormalizationEntries = gotchaDescriptions.filter(
      (value) => value.toLowerCase() === 'normalize all paths before comparison.',
    );

    expect(pathNormalizationEntries).toHaveLength(1);
    expect(gotchaDescriptions).toContain('Guard against empty workspace roots.');
    expect(result.ownership.knowledge.tips.map((item) => item.description)).toContain(
      'Prefer deterministic path canonicalization.',
    );
    expect(result.ownership.knowledge.learningPath.map((item) => item.description)).toContain(
      'Understand path normalization boundaries.',
    );
  });
});
