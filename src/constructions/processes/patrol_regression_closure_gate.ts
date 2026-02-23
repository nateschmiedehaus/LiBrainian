import * as path from 'node:path';
import { unwrapConstructionExecutionResult, type Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import { createCliOutputSanityGateConstruction, type CliOutputProbeResult } from './cli_output_sanity_gate.js';

export interface PatrolRegressionClosureGateInput {
  repoRoot?: string;
  cliEntry?: string;
  commandTimeoutMs?: number;
  maxDurationMs?: number;
}

export interface PatrolRegressionCheckResult {
  findingId: string;
  issueNumber: number;
  title: string;
  constructionId: string;
  verificationCommand: string;
  pass: boolean;
  details: Record<string, unknown>;
}

export interface PatrolRegressionClosureGateOutput {
  kind: 'PatrolRegressionClosureResult.v1';
  pass: boolean;
  checks: PatrolRegressionCheckResult[];
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_DURATION_MS = 120_000;

function findProbeResult(results: CliOutputProbeResult[], args: string): CliOutputProbeResult | null {
  return results.find((probe) => probe.args.join(' ') === args) ?? null;
}

function pushCheck(
  checks: PatrolRegressionCheckResult[],
  findings: string[],
  check: PatrolRegressionCheckResult,
): void {
  checks.push(check);
  if (!check.pass) {
    findings.push(`Issue #${check.issueNumber} regression (${check.findingId}): ${check.title}`);
  }
}

export function createPatrolRegressionClosureGateConstruction(): Construction<
  PatrolRegressionClosureGateInput,
  PatrolRegressionClosureGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'patrol-regression-closure-gate',
    name: 'Patrol Regression Closure Gate',
    description: 'Verifies patrol findings stay closed using construction-level CLI regression checks.',
    async execute(input: PatrolRegressionClosureGateInput = {}) {
      const startedAt = Date.now();
      const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
      const commandTimeoutMs = input.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const findings: string[] = [];
      const checks: PatrolRegressionCheckResult[] = [];

      const cliGate = createCliOutputSanityGateConstruction();
      const cliResult = unwrapConstructionExecutionResult(await cliGate.execute({
        repoRoot,
        cliEntry: input.cliEntry,
        commandTimeoutMs,
        maxDurationMs,
        probePerCommandHelp: false,
      }));

      const helpCoveragePass = cliResult.helpValidation.pass;
      pushCheck(checks, findings, {
        findingId: 'patrol-587-cli-help-coverage',
        issueNumber: 587,
        title: 'CLI help/output sanity gate remains enforced',
        constructionId: 'cli-output-sanity-gate',
        verificationCommand: 'npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
        pass: helpCoveragePass,
        details: {
          commandCount: cliResult.commandCount,
          unknownListed: cliResult.helpValidation.unknownListed,
          missingListed: cliResult.helpValidation.missingListed,
        },
      });

      const unknownCommandProbe = findProbeResult(cliResult.commandResults, 'definitely-not-a-command');
      pushCheck(checks, findings, {
        findingId: 'patrol-593-unknown-command-envelope',
        issueNumber: 593,
        title: 'Unknown command errors remain single-line and actionable',
        constructionId: 'cli-output-sanity-gate',
        verificationCommand: 'npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
        pass: Boolean(unknownCommandProbe?.pass),
        details: {
          probe: unknownCommandProbe ? {
            exitCode: unknownCommandProbe.exitCode,
            hasSingleLineError: unknownCommandProbe.hasSingleLineError,
            hasActionableError: unknownCommandProbe.hasActionableError,
            errorLineCount: unknownCommandProbe.errorLineCount,
            pass: unknownCommandProbe.pass,
          } : null,
        },
      });

      const configErrorProbe = findProbeResult(cliResult.commandResults, 'config definitely-not-a-subcommand');
      pushCheck(checks, findings, {
        findingId: 'patrol-593-config-subcommand-envelope',
        issueNumber: 593,
        title: 'Invalid config subcommand errors remain single-line and actionable',
        constructionId: 'cli-output-sanity-gate',
        verificationCommand: 'npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
        pass: Boolean(configErrorProbe?.pass),
        details: {
          probe: configErrorProbe ? {
            exitCode: configErrorProbe.exitCode,
            hasSingleLineError: configErrorProbe.hasSingleLineError,
            hasActionableError: configErrorProbe.hasActionableError,
            errorLineCount: configErrorProbe.errorLineCount,
            pass: configErrorProbe.pass,
          } : null,
        },
      });

      const replayDebugProbe = findProbeResult(cliResult.commandResults, 'replay --debug');
      pushCheck(checks, findings, {
        findingId: 'patrol-593-debug-verbosity',
        issueNumber: 593,
        title: 'Debug mode remains verbose for replay failures',
        constructionId: 'cli-output-sanity-gate',
        verificationCommand: 'npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
        pass: Boolean(replayDebugProbe?.pass),
        details: {
          probe: replayDebugProbe ? {
            exitCode: replayDebugProbe.exitCode,
            errorLineCount: replayDebugProbe.errorLineCount,
            pass: replayDebugProbe.pass,
          } : null,
        },
      });

      const capabilitiesProbe = findProbeResult(cliResult.commandResults, 'capabilities --json');
      pushCheck(checks, findings, {
        findingId: 'patrol-598-capability-inventory',
        issueNumber: 598,
        title: 'Capability inventory command remains available and machine-readable',
        constructionId: 'cli-output-sanity-gate',
        verificationCommand: 'npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
        pass: Boolean(capabilitiesProbe?.pass && capabilitiesProbe.parseableJson),
        details: {
          probe: capabilitiesProbe ? {
            exitCode: capabilitiesProbe.exitCode,
            parseableJson: capabilitiesProbe.parseableJson,
            pass: capabilitiesProbe.pass,
          } : null,
        },
      });

      if (checks.length < 5) {
        findings.push(`Expected at least 5 regression checks, received ${checks.length}.`);
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`Patrol regression closure gate exceeded duration budget: ${durationMs}ms > ${maxDurationMs}ms.`);
      }

      return ok<PatrolRegressionClosureGateOutput, ConstructionError>({
        kind: 'PatrolRegressionClosureResult.v1',
        pass: findings.length === 0,
        checks,
        findings,
        durationMs,
        maxDurationMs,
      });
    },
  };
}
