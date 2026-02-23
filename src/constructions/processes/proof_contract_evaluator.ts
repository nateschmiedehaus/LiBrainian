import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import type { ConstructionError } from '../base/construction_base.js';
import type { ProcessInput, ProcessOutput } from './process_base.js';

export interface ProofContractEvaluationInput extends ProcessInput {
  id: string;
  description?: string;
  commandLine: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  requiredOutputSubstrings?: string[];
  requiredFilePaths?: string[];
}

export interface ProofContractEvaluationOutput extends ProcessOutput {
  kind: 'ProofContractEvaluationResult.v1';
  id: string;
  description?: string;
  commandLine: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  passed: boolean;
  missingOutputSubstrings: string[];
  missingFilePaths: string[];
  stdout: string;
  stderr: string;
}

function uniqueValues(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(new Set(values.map((value) => String(value))));
}

async function listMissingFilePaths(paths: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const filePath of paths) {
    try {
      await access(filePath, fsConstants.F_OK);
    } catch {
      missing.push(filePath);
    }
  }
  return missing;
}

export const PROOF_CONTRACT_EVALUATOR_DESCRIPTION =
  'Evaluates command/output/artifact proof predicates and fails closed when any predicate is unsatisfied.';

export function createProofContractEvaluatorConstruction(): Construction<
  ProofContractEvaluationInput,
  ProofContractEvaluationOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'proof-contract-evaluator',
    name: 'Proof Contract Evaluator',
    description: PROOF_CONTRACT_EVALUATOR_DESCRIPTION,
    async execute(input: ProofContractEvaluationInput) {
      const requiredOutputSubstrings = uniqueValues(input.requiredOutputSubstrings);
      const requiredFilePaths = uniqueValues(input.requiredFilePaths);
      const combinedOutput = `${input.stdout}\n${input.stderr}`;
      const missingOutputSubstrings = requiredOutputSubstrings.filter(
        (snippet) => !combinedOutput.includes(snippet),
      );
      const missingFilePaths = await listMissingFilePaths(requiredFilePaths);
      const passed = input.exitCode === 0
        && !input.timedOut
        && missingOutputSubstrings.length === 0
        && missingFilePaths.length === 0;

      return ok({
        kind: 'ProofContractEvaluationResult.v1',
        id: input.id,
        description: input.description,
        commandLine: input.commandLine,
        exitCode: input.exitCode,
        timedOut: input.timedOut,
        durationMs: input.durationMs,
        passed,
        missingOutputSubstrings,
        missingFilePaths,
        stdout: input.stdout,
        stderr: input.stderr,
        observations: {
          requiredOutputSubstrings,
          requiredFilePaths,
        },
        costSummary: {
          durationMs: 0,
        },
        exitReason: passed ? 'completed' : 'failed',
        events: [],
      });
    },
  };
}
