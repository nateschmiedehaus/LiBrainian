import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Construction } from '../types.js';
import { fail, ok, unwrapConstructionExecutionResult } from '../types.js';
import { ConstructionError, ConstructionInputError } from '../base/construction_base.js';
import type { ProcessEvent, ProcessInput, ProcessOutput } from './process_base.js';
import { createAgentDispatchConstruction } from './agent_dispatch_construction.js';
import { createProofContractEvaluatorConstruction } from './proof_contract_evaluator.js';
import {
  createOperationalProofBundle,
  type OperationalProofBundle,
} from './proof_bundle.js';
import {
  createWetTestingPolicyDecisionArtifact,
  evaluateWetTestingPolicy,
  parseWetTestingPolicyConfig,
  parseWetTestingPolicyContext,
  type WetTestingPolicyConfig,
  type WetTestingPolicyContext,
  type WetTestingPolicyDecisionArtifact,
} from './wet_testing_policy.js';

export interface OperationalProofCheck {
  id: string;
  description?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  requiredOutputSubstrings?: string[];
  requiredFilePaths?: string[];
}

export interface OperationalProofGateInput extends ProcessInput {
  checks: OperationalProofCheck[];
  failFast?: boolean;
  policyConfig?: WetTestingPolicyConfig;
  policyContext?: WetTestingPolicyContext;
  policyDecisionOutputPath?: string;
  proofBundleOutputPath?: string;
  proofBundleSource?: string;
}

export interface OperationalProofCheckResult {
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

export interface OperationalProofGateOutput extends ProcessOutput {
  kind: 'OperationalProofGateResult.v1';
  passed: boolean;
  failureCount: number;
  checkResults: OperationalProofCheckResult[];
  proofBundle: OperationalProofBundle;
  policyDecisionArtifact?: WetTestingPolicyDecisionArtifact;
}

function uniqueValues(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(new Set(values.map((value) => String(value))));
}

export const OPERATIONAL_PROOF_GATE_DESCRIPTION =
  'Runs real command checks and validates concrete output/artifact evidence for operational proof.';

function buildPolicyFailClosedResult(
  reason: string,
): OperationalProofCheckResult {
  return {
    id: 'policy.fail_closed',
    description: 'wet-testing policy rejected execution before command dispatch',
    commandLine: 'policy:evaluate',
    exitCode: 1,
    timedOut: false,
    durationMs: 0,
    passed: false,
    missingOutputSubstrings: [],
    missingFilePaths: [reason],
    stdout: '',
    stderr: reason,
  };
}

export function createOperationalProofGateConstruction(): Construction<
  OperationalProofGateInput,
  OperationalProofGateOutput,
  ConstructionError,
  unknown
> {
  const dispatchConstruction = createAgentDispatchConstruction();
  const proofEvaluator = createProofContractEvaluatorConstruction();
  return {
    id: 'operational-proof-gate',
    name: 'Operational Proof Gate',
    description: OPERATIONAL_PROOF_GATE_DESCRIPTION,
    async execute(input: OperationalProofGateInput) {
      const checks = input.checks ?? [];
      if (checks.length === 0) {
        return fail(
          new ConstructionInputError(
            'Operational proof gate requires at least one check',
            'operational-proof-gate',
            'checks',
          ),
        );
      }

      const startedAtMs = Date.now();
      const events: ProcessEvent[] = [];
      const checkResults: OperationalProofCheckResult[] = [];
      const failFast = input.failFast !== false;
      let policyDecisionArtifact: WetTestingPolicyDecisionArtifact | undefined;

      if (input.policyConfig) {
        if (!input.policyContext) {
          return fail(
            new ConstructionInputError(
              'Operational proof gate requires policyContext when policyConfig is provided',
              'operational-proof-gate',
              'policyContext',
            ),
          );
        }

        let parsedPolicy: WetTestingPolicyConfig;
        let parsedContext: WetTestingPolicyContext;
        try {
          parsedPolicy = parseWetTestingPolicyConfig(input.policyConfig);
          parsedContext = parseWetTestingPolicyContext(input.policyContext);
        } catch (error) {
          return fail(
            new ConstructionInputError(
              `Operational proof gate policy validation failed: ${error instanceof Error ? error.message : String(error)}`,
              'operational-proof-gate',
              'policyConfig',
            ),
          );
        }

        const decision = evaluateWetTestingPolicy(parsedPolicy, parsedContext);
        policyDecisionArtifact = createWetTestingPolicyDecisionArtifact(decision, parsedPolicy);
        if (input.policyDecisionOutputPath) {
          await mkdir(dirname(input.policyDecisionOutputPath), { recursive: true });
          await writeFile(
            input.policyDecisionOutputPath,
            JSON.stringify(policyDecisionArtifact, null, 2),
            'utf8',
          );
        }

        const requiresArtifactContracts = decision.requiredEvidenceMode !== 'dry'
          && decision.requireOperationalProofArtifacts
          && decision.failClosed;
        if (requiresArtifactContracts) {
          const hasRequiredArtifacts = checks.some(
            (check) => uniqueValues(check.requiredFilePaths).length > 0,
          );
          if (!hasRequiredArtifacts) {
            const reason = [
              'policy requires wet or mixed evidence with artifact contracts',
              `matchedRule=${decision.matchedRuleId ?? 'default'}`,
              `contextKey=${decision.contextKey}`,
            ].join(';');
            const policyFailure = buildPolicyFailClosedResult(reason);
            checkResults.push(policyFailure);
            const proofBundle = createOperationalProofBundle({
              source: input.proofBundleSource ?? 'operational-proof-gate',
              checks: checkResults,
            });
            if (input.proofBundleOutputPath) {
              await mkdir(dirname(input.proofBundleOutputPath), { recursive: true });
              await writeFile(
                input.proofBundleOutputPath,
                JSON.stringify(proofBundle, null, 2),
                'utf8',
              );
            }
            events.push({
              stage: 'policy',
              type: 'warning',
              timestamp: new Date().toISOString(),
              detail: 'operational_proof_policy_fail_closed',
            });

            return ok({
              kind: 'OperationalProofGateResult.v1',
              passed: false,
              failureCount: 1,
              checkResults,
              proofBundle,
              policyDecisionArtifact,
              observations: {
                checks: checkResults,
                policyDecision: policyDecisionArtifact.decision,
              },
              costSummary: {
                durationMs: Date.now() - startedAtMs,
              },
              exitReason: 'failed',
              events,
            });
          }
        }
      }

      for (const check of checks) {
        events.push({
          stage: check.id,
          type: 'stage_start',
          timestamp: new Date().toISOString(),
        });

        const dispatch = unwrapConstructionExecutionResult(
          await dispatchConstruction.execute({
            command: check.command,
            args: check.args ?? [],
            cwd: check.cwd,
            env: check.env,
            timeoutMs: check.timeoutMs ?? input.timeoutMs,
          }),
        );

        const requiredOutputSubstrings = uniqueValues(check.requiredOutputSubstrings);
        const requiredFilePaths = uniqueValues(check.requiredFilePaths);
        const evaluation = unwrapConstructionExecutionResult(
          await proofEvaluator.execute({
            id: check.id,
            description: check.description,
            commandLine: dispatch.commandLine,
            exitCode: dispatch.exitCode,
            timedOut: dispatch.timedOut,
            durationMs: dispatch.durationMs,
            stdout: dispatch.stdout,
            stderr: dispatch.stderr,
            requiredOutputSubstrings,
            requiredFilePaths,
          }),
        );

        checkResults.push({
          id: evaluation.id,
          description: evaluation.description,
          commandLine: evaluation.commandLine,
          exitCode: evaluation.exitCode,
          timedOut: evaluation.timedOut,
          durationMs: evaluation.durationMs,
          passed: evaluation.passed,
          missingOutputSubstrings: evaluation.missingOutputSubstrings,
          missingFilePaths: evaluation.missingFilePaths,
          stdout: evaluation.stdout,
          stderr: evaluation.stderr,
        });

        events.push({
          stage: check.id,
          type: evaluation.passed ? 'stage_end' : 'warning',
          timestamp: new Date().toISOString(),
          detail: evaluation.passed ? 'operational_proof_check_passed' : 'operational_proof_check_failed',
        });

        if (!evaluation.passed && failFast) {
          break;
        }
      }

      const failureCount = checkResults.filter((entry) => !entry.passed).length;
      const passed = failureCount === 0 && checkResults.length === checks.length;
      const proofBundle = createOperationalProofBundle({
        source: input.proofBundleSource ?? 'operational-proof-gate',
        checks: checkResults,
      });
      if (input.proofBundleOutputPath) {
        await mkdir(dirname(input.proofBundleOutputPath), { recursive: true });
        await writeFile(
          input.proofBundleOutputPath,
          JSON.stringify(proofBundle, null, 2),
          'utf8',
        );
      }
      return ok({
        kind: 'OperationalProofGateResult.v1',
        passed,
        failureCount,
        checkResults,
        proofBundle,
        policyDecisionArtifact,
        observations: {
          checks: checkResults,
          policyDecision: policyDecisionArtifact?.decision,
          proofBundleSummary: {
            source: proofBundle.source,
            passed: proofBundle.passed,
            failureCount: proofBundle.failureCount,
          },
        },
        costSummary: {
          durationMs: Date.now() - startedAtMs,
        },
        exitReason: passed ? 'completed' : 'failed',
        events,
      });
    },
  };
}
