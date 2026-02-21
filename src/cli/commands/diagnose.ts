import * as fs from 'node:fs/promises';
import { Librarian } from '../../api/librarian.js';
import {
  classifyRunDiagnosticsScope,
  type BaselineIssueRef,
  type CommandDiagnosticResult,
  type RepositoryRole,
  type RunDiagnosticsScopeInput,
} from '../../api/run_diagnostics_scope.js';

export interface DiagnoseCommandOptions {
  workspace?: string;
  pretty?: boolean;
  config?: boolean;
  heal?: boolean;
  riskTolerance?: 'safe' | 'low' | 'medium';
  format?: 'json' | 'text';
  runOutput?: RunDiagnosticsScopeInput;
  runOutputFile?: string;
  repositoryRole?: RepositoryRole;
}

function isRepositoryRole(value: unknown): value is RepositoryRole {
  return value === 'core' || value === 'client';
}

function isCommandDiagnosticResult(value: unknown): value is CommandDiagnosticResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const commandOk = typeof candidate.command === 'string' && candidate.command.trim().length > 0;
  const exitCodeOk = typeof candidate.exitCode === 'number' || candidate.exitCode === null;
  const stdoutOk = typeof candidate.stdout === 'string' || typeof candidate.stdout === 'undefined';
  const stderrOk = typeof candidate.stderr === 'string' || typeof candidate.stderr === 'undefined';
  return commandOk && exitCodeOk && stdoutOk && stderrOk;
}

function isBaselineIssueRef(value: unknown): value is BaselineIssueRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.pattern === 'string'
    && (typeof candidate.issue === 'string' || typeof candidate.issue === 'undefined');
}

async function resolveRunOutput(options: DiagnoseCommandOptions): Promise<RunDiagnosticsScopeInput | undefined> {
  if (options.runOutput) {
    return options.runOutput;
  }
  if (!options.runOutputFile) {
    return undefined;
  }

  const raw = await fs.readFile(options.runOutputFile, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const commandResultsRaw = parsed.commandResults;
  if (!Array.isArray(commandResultsRaw) || !commandResultsRaw.every((entry) => isCommandDiagnosticResult(entry))) {
    throw new Error('run output file must include commandResults[] with command and exitCode fields');
  }

  const parsedRole = isRepositoryRole(parsed.repositoryRole) ? parsed.repositoryRole : undefined;
  const explicitRole = isRepositoryRole(options.repositoryRole) ? options.repositoryRole : undefined;
  const repositoryRole = explicitRole ?? parsedRole ?? 'core';

  const baselineRaw = parsed.baselineIssueRefs;
  const baselineIssueRefs = Array.isArray(baselineRaw) && baselineRaw.every((entry) => isBaselineIssueRef(entry))
    ? baselineRaw
    : undefined;

  return {
    repositoryRole,
    commandResults: commandResultsRaw,
    baselineIssueRefs,
  };
}

export async function diagnoseCommand(options: DiagnoseCommandOptions): Promise<void> {
  const workspace = options.workspace || process.cwd();
  const pretty = options.pretty ?? false;
  const format = options.format ?? 'json';
  const includeConfig = Boolean(options.config || options.heal);
  const runHeal = Boolean(options.heal);
  const riskTolerance = options.riskTolerance ?? 'low';

  const envProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const envModel = process.env.LIBRARIAN_LLM_MODEL;
  const llmProvider = envProvider === 'claude' || envProvider === 'codex' ? envProvider : undefined;
  const llmModelId = typeof envModel === 'string' && envModel.trim().length > 0 ? envModel : undefined;
  const hasLlmConfig = Boolean(llmProvider && llmModelId);

  const librarian = new Librarian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: hasLlmConfig ? llmProvider : undefined,
    llmModelId: hasLlmConfig ? llmModelId : undefined,
  });

  await librarian.initialize();
  const diagnosis = await librarian.diagnoseSelf();
  let outputPayload: unknown = diagnosis;

  if (includeConfig) {
    const configReport = await librarian.diagnoseConfig();
    const healingResult = runHeal ? await librarian.healConfig({ riskTolerance }) : undefined;
    outputPayload = {
      self: diagnosis,
      config: configReport,
      ...(healingResult ? { healing: healingResult } : {}),
    };
  }

  const runOutput = await resolveRunOutput(options);
  if (runOutput) {
    const diagnosticsScope = classifyRunDiagnosticsScope(runOutput);
    outputPayload = {
      ...(typeof outputPayload === 'object' && outputPayload !== null
        ? outputPayload as Record<string, unknown>
        : { self: outputPayload }),
      diagnosticsScope,
    };
  }

  if (format === 'text') {
    const base = diagnosis;
    console.log('Self Diagnosis');
    console.log('==============');
    console.log(`Status: ${base.status}`);
    const issues = Array.isArray(base.issues) ? base.issues : [];
    if (issues.length > 0) {
      console.log(`Issues: ${issues.join(', ')}`);
    }
    if (typeof base.stopReason === 'string' && base.stopReason) {
      console.log(`Stop Reason: ${base.stopReason}`);
    }
    if (includeConfig && typeof outputPayload === 'object' && outputPayload !== null) {
      const payload = outputPayload as { config?: { healthScore?: number; isOptimal?: boolean } };
      if (payload.config) {
        console.log(`Config Health: ${payload.config.healthScore ?? 'unknown'}`);
        if (typeof payload.config.isOptimal === 'boolean') {
          console.log(`Config Optimal: ${payload.config.isOptimal}`);
        }
      }
    }
    if (runOutput && typeof outputPayload === 'object' && outputPayload !== null) {
      const payload = outputPayload as {
        diagnosticsScope?: {
          overallVerdict?: string;
          summary?: {
            mustFixNowCount?: number;
            expectedDiagnosticCount?: number;
            deferNonScopeCount?: number;
          };
          deferIssueQueue?: unknown[];
        };
      };
      if (payload.diagnosticsScope) {
        console.log(`Diagnostics Scope Verdict: ${payload.diagnosticsScope.overallVerdict ?? 'unknown'}`);
        console.log(
          `Diagnostics Scope Counts: must_fix_now=${payload.diagnosticsScope.summary?.mustFixNowCount ?? 0}, expected_diagnostic=${payload.diagnosticsScope.summary?.expectedDiagnosticCount ?? 0}, defer_non_scope=${payload.diagnosticsScope.summary?.deferNonScopeCount ?? 0}`,
        );
        const deferQueueCount = Array.isArray(payload.diagnosticsScope.deferIssueQueue)
          ? payload.diagnosticsScope.deferIssueQueue.length
          : 0;
        console.log(`Deferred Issue Actions: ${deferQueueCount}`);
      }
    }
  } else {
    const output = JSON.stringify(outputPayload, null, pretty ? 2 : 0);
    console.log(output);
  }
  await librarian.shutdown();
}
