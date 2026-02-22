import {
  evaluatePatrolRegressionOracle,
  type PatrolRegressionOracleArtifact,
  type PatrolRegressionOracleCaseResult,
  type PatrolRegressionOracleEvaluationResult,
} from '../../evaluation/patrol_regression_oracle.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface PatrolRegressionOracleGateInput {
  repoRoot?: string;
  corpusPath?: string;
  outputDir?: string;
  minGeneratedTests?: number;
  runGeneratedTests?: boolean;
  testTimeoutMs?: number;
}

export interface PatrolRegressionOracleGateOutput {
  kind: 'PatrolRegressionOracleGateResult.v1';
  pass: boolean;
  minGeneratedTests: number;
  generatedTestCount: number;
  passingGeneratedTestCount: number;
  artifact: PatrolRegressionOracleArtifact;
  evaluation: PatrolRegressionOracleEvaluationResult;
  results: PatrolRegressionOracleCaseResult[];
  findings: string[];
  durationMs: number;
}

const DEFAULT_MIN_GENERATED_TESTS = 3;

export function createPatrolRegressionOracleGateConstruction(): Construction<
  PatrolRegressionOracleGateInput,
  PatrolRegressionOracleGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'patrol-regression-oracle-gate',
    name: 'Patrol Regression Oracle Gate',
    description:
      'Auto-generates minimal vitest reproductions from patrol findings and validates pre-fix failure + current pass behavior.',
    async execute(input: PatrolRegressionOracleGateInput = {}) {
      const startedAt = Date.now();
      const minGeneratedTests = input.minGeneratedTests ?? DEFAULT_MIN_GENERATED_TESTS;
      const evaluation = await evaluatePatrolRegressionOracle({
        repoRoot: input.repoRoot,
        corpusPath: input.corpusPath,
        outputDir: input.outputDir,
        runGeneratedTests: input.runGeneratedTests ?? true,
        testTimeoutMs: input.testTimeoutMs,
      });

      const findings = [...evaluation.findings];
      if (evaluation.testCount < minGeneratedTests) {
        findings.push(
          `Generated regression test count ${evaluation.testCount} is below minimum ${minGeneratedTests}`,
        );
      }

      return ok<PatrolRegressionOracleGateOutput, ConstructionError>({
        kind: 'PatrolRegressionOracleGateResult.v1',
        pass: findings.length === 0 && evaluation.pass,
        minGeneratedTests,
        generatedTestCount: evaluation.testCount,
        passingGeneratedTestCount: evaluation.passCount,
        artifact: evaluation.artifact,
        evaluation,
        results: evaluation.results,
        findings,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}
