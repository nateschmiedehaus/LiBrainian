import { describe, it, expect, vi } from 'vitest';
import {
  MergeReadinessAdvisor,
  determineMergeReadinessVerdict,
  parseDiffRanges,
} from '../merge_readiness_advisor.js';
import type { FunctionRangeMapper, FileLineRange, ResolvedRange } from '../../core/function_range_mapper.js';

function createDiff(): string {
  return [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,0 +10,3 @@',
    '+const a = 1;',
    '+const b = 2;',
    '+const c = 3;',
    'diff --git a/src/b.ts b/src/b.ts',
    'index 3333333..4444444 100644',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -20,2 +30,0 @@',
    '-old1',
    '-old2',
  ].join('\n');
}

function createResolved(range: FileLineRange, functionIds: string[]): ResolvedRange {
  return {
    range,
    functionIds,
    confidence: functionIds.length > 0 ? 0.98 : 0,
  };
}

describe('parseDiffRanges', () => {
  it('parses unified diff hunks into normalized file ranges', () => {
    const ranges = parseDiffRanges(createDiff());

    expect(ranges).toEqual([
      {
        filePath: 'src/a.ts',
        startLine: 10,
        endLine: 12,
      },
      {
        filePath: 'src/b.ts',
        startLine: 30,
        endLine: 30,
      },
    ]);
  });
});

describe('MergeReadinessAdvisor', () => {
  it('maps parsed ranges through FunctionRangeMapper and computes signals', async () => {
    const resolve = vi.fn(async ({ ranges }: { ranges: FileLineRange[] }) => [
      createResolved(ranges[0], ['fn_a_1']),
      createResolved(ranges[1], []),
    ]);
    const functionRangeMapper: FunctionRangeMapper = {
      resolve: resolve as FunctionRangeMapper['resolve'],
    };

    const advisor = new MergeReadinessAdvisor({ functionRangeMapper });
    const report = await advisor.assess(createDiff());

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      type: 'explicit',
      ranges: [
        { filePath: 'src/a.ts', startLine: 10, endLine: 12 },
        { filePath: 'src/b.ts', startLine: 30, endLine: 30 },
      ],
    });
    expect(report.mappedFunctionIds).toEqual(['fn_a_1']);
    expect(report.coverage).toEqual({
      totalRanges: 2,
      mappedRanges: 1,
      unmappedRanges: 1,
      rangeCoverage: 0.5,
    });
    expect(report.blastRadius).toEqual({
      uniqueFunctionCount: 1,
      maxFunctionsInSingleRange: 1,
    });
    expect(report.verdict).toBe('CAUTION');
  });

  it('returns BLOCKED when diff has no parseable hunks', async () => {
    const functionRangeMapper: FunctionRangeMapper = {
      resolve: vi.fn(async () => []),
    };
    const advisor = new MergeReadinessAdvisor({ functionRangeMapper });

    const report = await advisor.assess('not-a-diff');

    expect(report.verdict).toBe('BLOCKED');
    expect(functionRangeMapper.resolve).not.toHaveBeenCalled();
    expect(report.coverage.totalRanges).toBe(0);
  });
});

describe('determineMergeReadinessVerdict', () => {
  it('applies verdict thresholds for safe, caution, risky, and blocked states', () => {
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 1, blastRadius: 2 })).toBe('SAFE');
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 0.75, blastRadius: 2 })).toBe('CAUTION');
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 1, blastRadius: 6 })).toBe('CAUTION');
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 0.45, blastRadius: 2 })).toBe('RISKY');
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 1, blastRadius: 12 })).toBe('RISKY');
    expect(determineMergeReadinessVerdict({ totalRanges: 4, rangeCoverage: 0.2, blastRadius: 2 })).toBe('BLOCKED');
    expect(determineMergeReadinessVerdict({ totalRanges: 0, rangeCoverage: 1, blastRadius: 2 })).toBe('BLOCKED');
  });
});
