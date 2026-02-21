import { describe, expect, it } from 'vitest';
import type { ContextPack } from '../types.js';
import type { StructuralGroundTruthCorpus, StructuralGroundTruthQuery } from '../evaluation/ground_truth_generator.js';
import {
  evaluateSelfUnderstandingQuery,
  inferSelfUnderstandingQueryType,
  runSelfUnderstandingEvaluation,
  type SelfUnderstandingQueryExecutor,
} from '../evaluation/self_understanding.js';

function makePack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    packId: 'pack-1',
    packType: 'function_context',
    targetId: 'target-1',
    summary: 'default summary',
    keyFacts: [],
    codeSnippets: [],
    relatedFiles: [],
    confidence: 0.9,
    createdAt: new Date(0),
    ...overrides,
  };
}

function makeCallersQuery(id: string): StructuralGroundTruthQuery {
  return {
    id,
    query: 'What functions or methods are callers of parseArgs? (Who called by parseArgs)',
    category: 'behavioral',
    difficulty: 'hard',
    expectedAnswer: {
      type: 'contains',
      value: ['run', 'main'],
      evidence: [
        {
          type: 'call',
          identifier: 'parseArgs',
          file: 'src/evaluation/example.ts',
          line: 10,
          details: { caller: 'run', callee: 'parseArgs' },
        },
      ],
    },
  };
}

function makeImplementationQuery(id: string): StructuralGroundTruthQuery {
  return {
    id,
    query: 'How is createLiBrainian implemented?',
    category: 'behavioral',
    difficulty: 'medium',
    expectedAnswer: {
      type: 'contains',
      value: ['createLiBrainian'],
      evidence: [
        {
          type: 'function_def',
          identifier: 'createLiBrainian',
          file: 'src/api/librarian.ts',
          line: 1,
          details: { parameters: [], isAsync: false, isExported: true },
        },
      ],
    },
  };
}

describe('inferSelfUnderstandingQueryType', () => {
  it('detects callers queries', () => {
    expect(
      inferSelfUnderstandingQueryType('What functions or methods are callers of parseArgs?')
    ).toBe('callers');
  });

  it('detects implementation queries', () => {
    expect(inferSelfUnderstandingQueryType('How is createLiBrainian implemented?')).toBe('implementation');
  });

  it('classifies non-specialized prompts as other', () => {
    expect(inferSelfUnderstandingQueryType('What modules does this file import?')).toBe('other');
  });
});

describe('evaluateSelfUnderstandingQuery', () => {
  it('passes when evidence file and expected tokens are present', () => {
    const query = makeImplementationQuery('impl-pass');
    const result = evaluateSelfUnderstandingQuery(query, [
      makePack({
        relatedFiles: ['src/api/librarian.ts'],
        summary: 'createLiBrainian implemented with bootstrap setup',
      }),
    ]);

    expect(result.passed).toBe(true);
    expect(result.matchedFiles).toContain('src/api/librarian.ts');
    expect(result.matchedTokens).toContain('createLiBrainian');
  });

  it('fails when expected evidence file is absent', () => {
    const query = makeImplementationQuery('impl-fail');
    const result = evaluateSelfUnderstandingQuery(query, [
      makePack({
        relatedFiles: ['src/other/file.ts'],
        summary: 'createLiBrainian implemented with bootstrap setup',
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.matchedFiles).toHaveLength(0);
  });
});

describe('runSelfUnderstandingEvaluation', () => {
  it('evaluates 50+ generated questions and computes threshold checks', async () => {
    const callersQueries = Array.from({ length: 30 }, (_, index) => makeCallersQuery(`caller-${index}`));
    const implementationQueries = Array.from({ length: 30 }, (_, index) =>
      makeImplementationQuery(`impl-${index}`));
    const corpus: StructuralGroundTruthCorpus = {
      repoName: 'librainian',
      repoPath: '/repo',
      generatedAt: new Date(0).toISOString(),
      queries: [...callersQueries, ...implementationQueries],
      factCount: 100,
      coverage: { functions: 40, classes: 5, imports: 20, exports: 10 },
    };

    const executeQuery: SelfUnderstandingQueryExecutor = async (queryText) => {
      if (queryText.includes('callers')) {
        return {
          packs: [
            makePack({
              relatedFiles: ['src/evaluation/example.ts'],
              summary: 'run main parseArgs callers',
            }),
          ],
        };
      }
      return {
        packs: [
          makePack({
            relatedFiles: ['src/api/librarian.ts'],
            summary: 'createLiBrainian implementation details',
          }),
        ],
      };
    };

    const report = await runSelfUnderstandingEvaluation({
      workspace: '/repo',
      repoName: 'librainian',
      minQuestions: 50,
      executeQuery,
      groundTruthGenerator: {
        async generateForRepo() {
          return corpus;
        },
      },
    });

    expect(report.totalQuestions).toBe(60);
    expect(report.callers.total).toBe(30);
    expect(report.implementation.total).toBe(30);
    expect(report.thresholdsPassed).toBe(true);
  });

  it('fails fast when generated question count is below configured minimum', async () => {
    const corpus: StructuralGroundTruthCorpus = {
      repoName: 'small',
      repoPath: '/repo',
      generatedAt: new Date(0).toISOString(),
      queries: [makeImplementationQuery('small-1')],
      factCount: 1,
      coverage: { functions: 1, classes: 0, imports: 0, exports: 0 },
    };

    await expect(() =>
      runSelfUnderstandingEvaluation({
        workspace: '/repo',
        repoName: 'small',
        minQuestions: 50,
        executeQuery: async () => ({ packs: [] }),
        groundTruthGenerator: {
          async generateForRepo() {
            return corpus;
          },
        },
      })
    ).rejects.toThrow('self_understanding_insufficient_questions');
  });
});
