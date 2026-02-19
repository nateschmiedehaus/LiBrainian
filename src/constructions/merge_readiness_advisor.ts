import { parseUnifiedDiff } from '../ingest/diff_indexer.js';
import type {
  FileLineRange,
  FunctionRangeMapper,
  ResolvedRange,
} from '../core/function_range_mapper.js';

export type MergeReadinessVerdict = 'SAFE' | 'CAUTION' | 'RISKY' | 'BLOCKED';

export interface MergeReadinessThresholds {
  blockedCoverageThreshold: number;
  riskyCoverageThreshold: number;
  cautionCoverageThreshold: number;
  cautionBlastRadiusThreshold: number;
  riskyBlastRadiusThreshold: number;
}

export interface MergeReadinessCoverageSignals {
  totalRanges: number;
  mappedRanges: number;
  unmappedRanges: number;
  rangeCoverage: number;
}

export interface MergeReadinessBlastRadiusSignals {
  uniqueFunctionCount: number;
  maxFunctionsInSingleRange: number;
}

export interface MergeReadinessReport {
  verdict: MergeReadinessVerdict;
  diffRanges: FileLineRange[];
  resolvedRanges: ResolvedRange[];
  mappedFunctionIds: string[];
  coverage: MergeReadinessCoverageSignals;
  blastRadius: MergeReadinessBlastRadiusSignals;
}

export interface MergeReadinessAdvisorDeps {
  functionRangeMapper: FunctionRangeMapper;
  thresholds?: Partial<MergeReadinessThresholds>;
}

export interface MergeReadinessSignalsInput {
  totalRanges: number;
  rangeCoverage: number;
  blastRadius: number;
}

const DEFAULT_THRESHOLDS: MergeReadinessThresholds = {
  blockedCoverageThreshold: 0.25,
  riskyCoverageThreshold: 0.5,
  cautionCoverageThreshold: 0.8,
  cautionBlastRadiusThreshold: 6,
  riskyBlastRadiusThreshold: 12,
};

export class MergeReadinessAdvisor {
  private readonly functionRangeMapper: FunctionRangeMapper;
  private readonly thresholds: MergeReadinessThresholds;

  constructor(deps: MergeReadinessAdvisorDeps) {
    this.functionRangeMapper = deps.functionRangeMapper;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
  }

  async assess(diff: string): Promise<MergeReadinessReport> {
    const diffRanges = parseDiffRanges(diff);
    const resolvedRanges = diffRanges.length > 0
      ? await this.functionRangeMapper.resolve({ type: 'explicit', ranges: diffRanges })
      : [];

    const mappedFunctionIds = collectMappedFunctionIds(resolvedRanges);
    const mappedRanges = resolvedRanges.filter((entry) => entry.functionIds.length > 0).length;
    const totalRanges = diffRanges.length;
    const rangeCoverage = totalRanges > 0 ? mappedRanges / totalRanges : 0;
    const coverage: MergeReadinessCoverageSignals = {
      totalRanges,
      mappedRanges,
      unmappedRanges: Math.max(0, totalRanges - mappedRanges),
      rangeCoverage,
    };

    const maxFunctionsInSingleRange = resolvedRanges.reduce(
      (max, entry) => Math.max(max, entry.functionIds.length),
      0
    );
    const blastRadius: MergeReadinessBlastRadiusSignals = {
      uniqueFunctionCount: mappedFunctionIds.length,
      maxFunctionsInSingleRange,
    };

    const verdict = determineMergeReadinessVerdict(
      {
        totalRanges,
        rangeCoverage,
        blastRadius: mappedFunctionIds.length,
      },
      this.thresholds
    );

    return {
      verdict,
      diffRanges,
      resolvedRanges,
      mappedFunctionIds,
      coverage,
      blastRadius,
    };
  }
}

export function parseDiffRanges(diff: string): FileLineRange[] {
  const parsed = parseUnifiedDiff(diff);
  const ranges: FileLineRange[] = [];

  for (const file of parsed) {
    for (const hunk of file.hunks) {
      const startLine = sanitizeLine(hunk.startLine);
      const hunkLength = Math.max(1, Math.trunc(hunk.length));
      const endLine = Math.max(startLine, startLine + hunkLength - 1);
      ranges.push({
        filePath: file.filePath,
        startLine,
        endLine,
      });
    }
  }

  return ranges;
}

export function determineMergeReadinessVerdict(
  input: MergeReadinessSignalsInput,
  thresholds: Partial<MergeReadinessThresholds> = {}
): MergeReadinessVerdict {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (input.totalRanges === 0 || input.rangeCoverage < merged.blockedCoverageThreshold) {
    return 'BLOCKED';
  }
  if (
    input.blastRadius >= merged.riskyBlastRadiusThreshold
    || input.rangeCoverage < merged.riskyCoverageThreshold
  ) {
    return 'RISKY';
  }
  if (
    input.blastRadius >= merged.cautionBlastRadiusThreshold
    || input.rangeCoverage < merged.cautionCoverageThreshold
  ) {
    return 'CAUTION';
  }
  return 'SAFE';
}

function collectMappedFunctionIds(resolvedRanges: ResolvedRange[]): string[] {
  const ids = new Set<string>();
  for (const entry of resolvedRanges) {
    for (const functionId of entry.functionIds) {
      ids.add(functionId);
    }
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

function sanitizeLine(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}
