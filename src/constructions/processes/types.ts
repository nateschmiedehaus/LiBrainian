import type { LlmRequirement } from '../../types.js';
import type { ProcessInput, ProcessOutput } from './process_base.js';

export type UnitPatrolOperationKind = 'bootstrap' | 'status' | 'query' | 'metamorphic';
export type UnitPatrolExecutionProfile = 'quick' | 'strict' | 'deep-bounded';
export type UnitPatrolDomain =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'polyglot'
  | 'unknown';
export type UnitPatrolTask = 'smoke' | 'retrieval' | 'metamorphic' | 'deep-audit';

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
  minMetamorphicTransforms?: number;
  maxMetamorphicFailureRate?: number;
}

export interface UnitPatrolInput extends ProcessInput {
  fixtureRepoPath: string;
  keepSandbox?: boolean;
  profile?: UnitPatrolExecutionProfile;
  domain?: UnitPatrolDomain;
  task?: UnitPatrolTask;
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
  metamorphicFailureRate: number | null;
}

export interface UnitPatrolSelectorDecisionTrace {
  profile: UnitPatrolExecutionProfile;
  domain: UnitPatrolDomain;
  task: UnitPatrolTask;
  strategyPack: UnitPatrolExecutionProfile;
  budgets: {
    maxDurationMs: number;
    maxOperations: number;
    maxQueries: number;
    maxMetamorphicTransforms: number;
  };
  rationale: string[];
  enforcement: {
    droppedOperations: number;
    droppedQueries: number;
    droppedMetamorphic: number;
  };
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
  selectorTrace: UnitPatrolSelectorDecisionTrace;
  embedding: {
    provider: string;
    model: string;
    realProviderExpected: boolean;
  };
}
