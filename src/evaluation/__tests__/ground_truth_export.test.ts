import { describe, it, expect } from 'vitest';
import type { StructuralGroundTruthCorpus } from '../ground_truth_generator.js';
import { exportStructuralGroundTruth } from '../ground_truth_export.js';

describe('exportStructuralGroundTruth', () => {
  it('maps structural corpus into eval-corpus schema', () => {
    const corpus: StructuralGroundTruthCorpus = {
      repoName: 'demo-repo',
      repoPath: '/tmp/demo-repo',
      generatedAt: new Date('2026-02-05T00:00:00Z').toISOString(),
      factCount: 1,
      coverage: { functions: 1, classes: 0, imports: 0, exports: 0 },
      queries: [
        {
          id: 'func-return-add',
          query: 'What does function add return?',
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: 'number',
            evidence: [
              {
                type: 'function_def',
                identifier: 'add',
                file: 'src/math.ts',
                line: 10,
                details: {},
              },
            ],
          },
        },
      ],
    };

    const exported = exportStructuralGroundTruth({
      corpus,
      repoMeta: {
        repoId: 'demo-repo',
        name: 'Demo Repo',
        languages: ['typescript'],
        hasTests: true,
      },
    });

    expect(exported.manifest.repoId).toBe('demo-repo');
    expect(exported.manifest.languages).toContain('typescript');
    expect(exported.manifest.fileCount).toBe(1);
    expect(exported.manifest.annotationLevel).toBe('sparse');

    expect(exported.queries).toHaveLength(1);
    const query = exported.queries[0]!;
    expect(query.repoId).toBe('demo-repo');
    expect(query.category).toBe('structural');
    expect(query.difficulty).toBe('trivial');
    expect(query.correctAnswer.mustIncludeFiles).toContain('src/math.ts');
    expect(query.correctAnswer.evidenceRefs[0]?.location?.startLine).toBe(10);
  });
});
