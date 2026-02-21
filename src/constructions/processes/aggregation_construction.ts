import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface PatrolRunAggregateInput {
  repo?: string;
  durationMs?: number;
  observations?: {
    overallVerdict?: {
      npsScore?: number;
      wouldRecommend?: boolean;
    };
    negativeFindingsMandatory?: Array<{ category?: string; severity?: string }>;
  };
  implicitSignals?: {
    commandsFailed?: number;
    timeoutRatio?: number;
  };
}

export interface AggregationInput {
  runs: PatrolRunAggregateInput[];
}

export interface AggregationOutput {
  runCount: number;
  meanNps: number;
  wouldRecommendRate: number;
  avgNegativeFindings: number;
  implicitFallbackRate: number;
}

export function createAggregationConstruction(): Construction<
  AggregationInput,
  AggregationOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'patrol-aggregator',
    name: 'Patrol Aggregator',
    description: 'Aggregates per-run patrol observations into rollup metrics.',
    async execute(input: AggregationInput): Promise<AggregationOutput> {
      const runs = input.runs ?? [];
      if (runs.length === 0) {
        return {
          runCount: 0,
          meanNps: 0,
          wouldRecommendRate: 0,
          avgNegativeFindings: 0,
          implicitFallbackRate: 0,
        };
      }

      const npsValues = runs
        .map((run) => run.observations?.overallVerdict?.npsScore)
        .filter((value): value is number => typeof value === 'number');
      const recommendCount = runs.filter((run) => run.observations?.overallVerdict?.wouldRecommend === true).length;
      const negativeCountTotal = runs
        .map((run) => run.observations?.negativeFindingsMandatory?.length ?? 0)
        .reduce((sum, value) => sum + value, 0);
      const implicitFallbackCount = runs.filter((run) => (run.implicitSignals?.commandsFailed ?? 0) > 0).length;

      const meanNps = npsValues.length
        ? npsValues.reduce((sum, value) => sum + value, 0) / npsValues.length
        : 0;

      return {
        runCount: runs.length,
        meanNps: Number(meanNps.toFixed(3)),
        wouldRecommendRate: Number((recommendCount / runs.length).toFixed(3)),
        avgNegativeFindings: Number((negativeCountTotal / runs.length).toFixed(3)),
        implicitFallbackRate: Number((implicitFallbackCount / runs.length).toFixed(3)),
      };
    },
  };
}
