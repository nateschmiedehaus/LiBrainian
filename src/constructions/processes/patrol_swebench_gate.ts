import {
  materializePatrolTestPairs,
  runPatrolSwebenchHarness,
  type PatrolPairHarnessResult,
  type PatrolTestPair,
} from '../../evaluation/patrol_swebench_pairs.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

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
