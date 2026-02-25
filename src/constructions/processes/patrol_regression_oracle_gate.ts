import { loadEvaluationModule } from '../../utils/evaluation_loader.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

type PatrolRegressionOracleArtifact = Record<string, unknown>;
type PatrolRegressionOracleCaseResult = Record<string, unknown>;

interface PatrolRegressionOracleEvaluationResult {
  pass: boolean;
  testCount: number;
  passCount: number;
  artifact: PatrolRegressionOracleArtifact;
  results: PatrolRegressionOracleCaseResult[];
  findings: string[];
}

interface PatrolRegressionOracleModule {
  evaluatePatrolRegressionOracle: (input: {
    repoRoot?: string;
    corpusPath?: string;
    outputDir?: string;
    runGeneratedTests?: boolean;
    testTimeoutMs?: number;
  }) => Promise<PatrolRegressionOracleEvaluationResult>;
}

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

async function loadPatrolRegressionOracleModule(): Promise<PatrolRegressionOracleModule> {
  const externalModuleId = 'librainian-eval/patrol_regression_oracle.js';
  return loadEvaluationModule<PatrolRegressionOracleModule>(
    'patrol-regression-oracle-gate',
    () => import('../../evaluation/patrol_regression_oracle.js') as unknown as Promise<PatrolRegressionOracleModule>,
    () => import(externalModuleId) as unknown as Promise<PatrolRegressionOracleModule>,
  );
}

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
      const { evaluatePatrolRegressionOracle } = await loadPatrolRegressionOracleModule().catch((error) => {
        throw new ConstructionError(
          `Patrol regression oracle dependency unavailable: ${error instanceof Error ? error.message : String(error)}`,
          'patrol-regression-oracle-gate',
        );
      });
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
