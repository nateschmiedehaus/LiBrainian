import { describe, it, expect } from 'vitest';
import type { ASTFact } from '../evaluation/ast_fact_extractor.js';
import type { StructuralGroundTruthCorpus, StructuralGroundTruthQuery } from '../evaluation/ground_truth_generator.js';
import {
  buildSelfUnderstandingQuestionSet,
  evaluateSelfUnderstanding,
  renderSelfUnderstandingDashboard,
  toSelfUnderstandingHistoryEntry,
} from '../evaluation/self_understanding.js';

function makeFact(partial: Partial<ASTFact>): ASTFact {
  return {
    type: partial.type ?? 'function_def',
    identifier: partial.identifier ?? 'unknown',
    file: partial.file ?? 'src/unknown.ts',
    line: partial.line ?? 1,
    details: partial.details ?? {},
  };
}

function makeQuery(partial: Partial<StructuralGroundTruthQuery>): StructuralGroundTruthQuery {
  return {
    id: partial.id ?? 'q-1',
    query: partial.query ?? 'What functions call target?',
    category: partial.category ?? 'behavioral',
    difficulty: partial.difficulty ?? 'medium',
    expectedAnswer: partial.expectedAnswer ?? {
      type: 'contains',
      value: ['foo'],
      evidence: [makeFact({ type: 'call', identifier: 'target' })],
    },
    tags: partial.tags,
  };
}

function makeCorpus(queries: StructuralGroundTruthQuery[]): StructuralGroundTruthCorpus {
  return {
    repoName: 'self',
    repoPath: '/tmp/self',
    generatedAt: new Date('2026-02-24T00:00:00.000Z').toISOString(),
    queries,
    factCount: 10,
    coverage: {
      functions: 2,
      classes: 0,
      imports: 0,
      exports: 0,
    },
  };
}

describe('self_understanding', () => {
  it('builds a mixed question set with callers and implementation probes', () => {
    const functionFact = makeFact({
      type: 'function_def',
      identifier: 'foo',
      file: 'src/sample.ts',
      details: {
        parameters: [],
        isAsync: false,
        isExported: true,
      },
    });
    const callFact = makeFact({
      type: 'call',
      identifier: 'bar',
      file: 'src/sample.ts',
      details: {
        caller: 'foo',
        callee: 'bar',
      },
    });
    const corpus = makeCorpus([
      makeQuery({
        id: 'called-by-bar-1',
        query: 'What functions or methods are callers of bar?',
        expectedAnswer: {
          type: 'contains',
          value: ['foo'],
          evidence: [callFact],
        },
      }),
      makeQuery({
        id: 'func-exported-foo-2',
        query: 'Is function foo exported?',
        expectedAnswer: {
          type: 'exists',
          value: true,
          evidence: [functionFact],
        },
      }),
      makeQuery({
        id: 'func-count-src-sample-ts-3',
        query: 'How many functions are in file sample.ts?',
        expectedAnswer: {
          type: 'count',
          value: 1,
          evidence: [functionFact],
        },
      }),
    ]);

    const { questions, generatedQuestionCount } = buildSelfUnderstandingQuestionSet(corpus, 3, 10);
    expect(generatedQuestionCount).toBeGreaterThanOrEqual(3);
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.some((item) => item.type === 'callers')).toBe(true);
    expect(questions.some((item) => item.type === 'implementation')).toBe(true);
  });

  it('passes thresholds when callers and implementation answers are present', async () => {
    const functionFact = makeFact({
      type: 'function_def',
      identifier: 'foo',
      file: 'src/sample.ts',
      details: {
        parameters: [],
        isAsync: false,
        isExported: true,
      },
    });
    const corpus = makeCorpus([
      makeQuery({
        id: 'called-by-bar-1',
        query: 'What functions or methods are callers of bar?',
        expectedAnswer: {
          type: 'contains',
          value: ['foo'],
          evidence: [makeFact({ type: 'call', details: { caller: 'foo', callee: 'bar' } })],
        },
      }),
      makeQuery({
        id: 'func-exported-foo-2',
        query: 'Is function foo exported?',
        expectedAnswer: {
          type: 'exists',
          value: true,
          evidence: [functionFact],
        },
      }),
    ]);

    const report = await evaluateSelfUnderstanding({
      workspace: '/tmp/self',
      repoName: 'self',
      minQuestionCount: 2,
      maxQuestionCount: 10,
      generateCorpus: async () => corpus,
      answerQuestion: async (intent) => {
        if (intent.toLowerCase().includes('callers of bar')) {
          return { summary: 'foo is a caller of bar in src/sample.ts' };
        }
        if (intent.toLowerCase().includes('how is foo implemented')) {
          return { summary: 'foo is implemented in src/sample.ts' };
        }
        return { summary: 'foo appears in src/sample.ts' };
      },
      now: () => new Date('2026-02-24T12:00:00.000Z'),
    });

    expect(report.summary.passed).toBe(true);
    expect(report.metrics.callersAccuracy).toBeGreaterThanOrEqual(1);
    expect(report.metrics.implementationAccuracy).toBeGreaterThanOrEqual(1);
    expect(report.generatedQuestionCount).toBeGreaterThanOrEqual(2);
  });

  it('fails thresholds when answers are empty', async () => {
    const functionFact = makeFact({
      type: 'function_def',
      identifier: 'foo',
      file: 'src/sample.ts',
      details: {
        parameters: [],
        isAsync: false,
        isExported: true,
      },
    });
    const corpus = makeCorpus([
      makeQuery({
        id: 'called-by-bar-1',
        query: 'What functions or methods are callers of bar?',
        expectedAnswer: {
          type: 'contains',
          value: ['foo'],
          evidence: [makeFact({ type: 'call', details: { caller: 'foo', callee: 'bar' } })],
        },
      }),
      makeQuery({
        id: 'func-exported-foo-2',
        query: 'Is function foo exported?',
        expectedAnswer: {
          type: 'exists',
          value: true,
          evidence: [functionFact],
        },
      }),
    ]);

    const report = await evaluateSelfUnderstanding({
      workspace: '/tmp/self',
      repoName: 'self',
      minQuestionCount: 2,
      maxQuestionCount: 10,
      generateCorpus: async () => corpus,
      answerQuestion: async () => ({ summary: '' }),
      now: () => new Date('2026-02-24T12:00:00.000Z'),
    });

    expect(report.summary.passed).toBe(false);
    expect(report.summary.reasons.some((item) => item.startsWith('callers_accuracy_below_threshold'))).toBe(true);
    expect(report.summary.reasons.some((item) => item.startsWith('implementation_accuracy_below_threshold'))).toBe(
      true
    );
  });

  it('times out unanswered queries and records timeout reason', async () => {
    const functionFact = makeFact({
      type: 'function_def',
      identifier: 'foo',
      file: 'src/sample.ts',
      details: {
        parameters: [],
        isAsync: false,
        isExported: true,
      },
    });
    const corpus = makeCorpus([
      makeQuery({
        id: 'called-by-bar-1',
        query: 'What functions or methods are callers of bar?',
        expectedAnswer: {
          type: 'contains',
          value: ['foo'],
          evidence: [makeFact({ type: 'call', details: { caller: 'foo', callee: 'bar' } })],
        },
      }),
      makeQuery({
        id: 'func-exported-foo-2',
        query: 'Is function foo exported?',
        expectedAnswer: {
          type: 'exists',
          value: true,
          evidence: [functionFact],
        },
      }),
    ]);

    const report = await evaluateSelfUnderstanding({
      workspace: '/tmp/self',
      repoName: 'self',
      minQuestionCount: 2,
      maxQuestionCount: 10,
      generateCorpus: async () => corpus,
      answerTimeoutMs: 10,
      answerQuestion: async () => new Promise(() => undefined),
      now: () => new Date('2026-02-24T12:00:00.000Z'),
    });

    expect(report.summary.passed).toBe(false);
    expect(report.evaluatedQuestionCount).toBeGreaterThanOrEqual(2);
    expect(report.summary.reasons).toContain(`answer_timeout_count:${report.evaluatedQuestionCount}`);
  });

  it('creates history entries and dashboard markdown', async () => {
    const corpus = makeCorpus([
      makeQuery({
        id: 'called-by-bar-1',
        query: 'What functions or methods are callers of bar?',
      }),
      makeQuery({
        id: 'func-exported-foo-2',
        query: 'Is function foo exported?',
        expectedAnswer: {
          type: 'exists',
          value: true,
          evidence: [makeFact({ type: 'function_def', identifier: 'foo', file: 'src/sample.ts' })],
        },
      }),
    ]);

    const report = await evaluateSelfUnderstanding({
      workspace: '/tmp/self',
      minQuestionCount: 2,
      generateCorpus: async () => corpus,
      answerQuestion: async () => ({ summary: 'foo src/sample.ts' }),
      now: () => new Date('2026-02-24T12:00:00.000Z'),
    });

    const historyEntry = toSelfUnderstandingHistoryEntry(report, 'abc1234');
    const dashboard = renderSelfUnderstandingDashboard(report, [historyEntry]);
    expect(historyEntry.commitSha).toBe('abc1234');
    expect(dashboard).toContain('Self-understanding report');
    expect(dashboard).toContain('abc1234');
  });
});
