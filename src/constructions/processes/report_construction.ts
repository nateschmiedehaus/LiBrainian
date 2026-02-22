import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import type { AggregationOutput, PatrolRunAggregateInput } from './aggregation_construction.js';

export interface ReportConstructionInput {
  mode: 'quick' | 'full' | 'release';
  commitSha?: string;
  runs: PatrolRunAggregateInput[];
  aggregate: AggregationOutput;
}

export interface ReportConstructionOutput {
  kind: 'PatrolReport.v1';
  createdAt: string;
  mode: 'quick' | 'full' | 'release';
  commitSha?: string;
  runs: PatrolRunAggregateInput[];
  aggregate: AggregationOutput;
  aggregateHealthScore: number;
}

export function createReportConstruction(): Construction<
  ReportConstructionInput,
  ReportConstructionOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'patrol-reporter',
    name: 'Patrol Reporter',
    description: 'Builds a normalized patrol report payload and aggregate health score.',
    async execute(input: ReportConstructionInput) {
      const score = Math.max(
        0,
        Math.min(
          10,
          input.aggregate.meanNps
          - (input.aggregate.avgNegativeFindings * 0.5)
          - (input.aggregate.implicitFallbackRate * 2),
        ),
      );

      return ok<ReportConstructionOutput, ConstructionError>({
        kind: 'PatrolReport.v1',
        createdAt: new Date().toISOString(),
        mode: input.mode,
        commitSha: input.commitSha,
        runs: input.runs,
        aggregate: input.aggregate,
        aggregateHealthScore: Number(score.toFixed(2)),
      });
    },
  };
}
