import { loadEvaluationModule } from '../../utils/evaluation_loader.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

type PatrolTestPair = Record<string, unknown>;

interface PatrolPairEvaluationResult {
  pairId: string;
  pass: boolean;
  findings: string[];
}

interface PatrolPairHarnessResult {
  pass: boolean;
  resolvedCount: number;
  resolveRate: number;
  evaluations: PatrolPairEvaluationResult[];
}

interface PatrolSwebenchMaterialized {
  pairCount: number;
  outputPath: string;
  pairs: PatrolTestPair[];
}

interface PatrolSwebenchModule {
  materializePatrolTestPairs: (input: {
    repoRoot: string;
    corpusPath?: string;
    outputPath?: string;
  }) => Promise<PatrolSwebenchMaterialized>;
  runPatrolSwebenchHarness: (
    pairs: PatrolTestPair[],
    options: {
      repoRoot: string;
      executeVerificationCommands?: boolean;
      verificationTimeoutMs?: number;
    }
  ) => Promise<PatrolPairHarnessResult>;
}

export interface PatrolSwebenchGateInput {
  repoRoot?: string;
  corpusPath?: string;
  outputPath?: string;
  minPairCount?: number;
  executeVerificationCommands?: boolean;
  verificationTimeoutMs?: number;
}

export interface PatrolSwebenchGateOutput {
  kind: 'PatrolSwebenchGateResult.v1';
  pass: boolean;
  pairCount: number;
  minPairCount: number;
  resolvedCount: number;
  resolveRate: number;
  outputPath: string;
  pairs: PatrolTestPair[];
  harness: PatrolPairHarnessResult;
  findings: string[];
  durationMs: number;
}

const DEFAULT_MIN_PAIR_COUNT = 3;

async function loadPatrolSwebenchModule(): Promise<PatrolSwebenchModule> {
  const externalModuleId = 'librainian-eval/patrol_swebench_pairs.js';
  return loadEvaluationModule<PatrolSwebenchModule>(
    'patrol-swebench-gate',
    () => import('../../evaluation/patrol_swebench_pairs.js') as unknown as Promise<PatrolSwebenchModule>,
    () => import(externalModuleId) as unknown as Promise<PatrolSwebenchModule>,
  );
}

export function createPatrolSwebenchGateConstruction(): Construction<
  PatrolSwebenchGateInput,
  PatrolSwebenchGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'patrol-swebench-gate',
    name: 'Patrol SWE-bench Gate',
    description:
      'Auto-generates FAIL_TO_PASS + PASS_TO_PASS patrol test pairs, runs the harness, and enforces a minimum pair count.',
    async execute(input: PatrolSwebenchGateInput = {}) {
      const startedAt = Date.now();
      const repoRoot = input.repoRoot ?? process.cwd();
      const minPairCount = input.minPairCount ?? DEFAULT_MIN_PAIR_COUNT;
      const { materializePatrolTestPairs, runPatrolSwebenchHarness } = await loadPatrolSwebenchModule().catch((error) => {
        throw new ConstructionError(
          `Patrol SWE-bench dependency unavailable: ${error instanceof Error ? error.message : String(error)}`,
          'patrol-swebench-gate',
        );
      });
      const materialized = await materializePatrolTestPairs({
        repoRoot,
        corpusPath: input.corpusPath,
        outputPath: input.outputPath,
      });
      const harness = await runPatrolSwebenchHarness(materialized.pairs, {
        repoRoot,
        executeVerificationCommands: input.executeVerificationCommands ?? false,
        verificationTimeoutMs: input.verificationTimeoutMs,
      });

      const findings: string[] = [];
      if (materialized.pairCount < minPairCount) {
        findings.push(`Patrol SWE-bench pair count ${materialized.pairCount} is below minimum ${minPairCount}`);
      }
      for (const evaluation of harness.evaluations) {
        if (evaluation.pass) continue;
        const detail = evaluation.findings.length > 0 ? evaluation.findings.join('; ') : 'unknown failure';
        findings.push(`Pair ${evaluation.pairId} failed: ${detail}`);
      }

      return ok<PatrolSwebenchGateOutput, ConstructionError>({
        kind: 'PatrolSwebenchGateResult.v1',
        pass: findings.length === 0 && harness.pass,
        pairCount: materialized.pairCount,
        minPairCount,
        resolvedCount: harness.resolvedCount,
        resolveRate: harness.resolveRate,
        outputPath: materialized.outputPath,
        pairs: materialized.pairs,
        harness,
        findings,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}
