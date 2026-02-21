import type { LlmRequirement } from '../../types.js';
import type { ProcessInput, ProcessOutput } from './process_base.js';

export type UnitPatrolOperationKind = 'bootstrap' | 'status' | 'query';

export interface UnitPatrolQueryConfig {
  intent: string;
  depth?: 'L0' | 'L1' | 'L2' | 'L3';
  llmRequirement?: LlmRequirement;
  timeoutMs?: number;
}

export interface UnitPatrolOperation {
  kind: UnitPatrolOperationKind;
  description?: string;
  query?: UnitPatrolQueryConfig;
}

export interface UnitPatrolScenario {
  name: string;
  operations: UnitPatrolOperation[];
}

export interface UnitPatrolEvaluationCriteria {
  minPassRate?: number;
  minQueryPacks?: number;
  requireBootstrapped?: boolean;
  maxDurationMs?: number;
}

export interface UnitPatrolInput extends ProcessInput {
  fixtureRepoPath: string;
  keepSandbox?: boolean;
  scenario?: UnitPatrolScenario;
  evaluation?: UnitPatrolEvaluationCriteria;
}

export interface UnitPatrolOperationResult {
  operation: UnitPatrolOperationKind;
  pass: boolean;
  durationMs: number;
  details: Record<string, unknown>;
  error?: string;
}

export interface UnitPatrolFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  operation?: UnitPatrolOperationKind;
}

export interface UnitPatrolQualityScores {
  reliability: number;
  coverage: number;
  speed: number;
}

export interface UnitPatrolResult extends ProcessOutput {
  kind: 'UnitPatrolResult.v1';
  scenario: string;
  workspace: string;
  pass: boolean;
  passRate: number;
  operations: UnitPatrolOperationResult[];
  findings: UnitPatrolFinding[];
  qualityScores: UnitPatrolQualityScores;
  embedding: {
    provider: string;
    model: string;
    realProviderExpected: boolean;
  };
}
