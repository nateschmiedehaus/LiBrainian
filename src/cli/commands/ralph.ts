/**
 * @fileoverview Ralph Wiggum Loop
 *
 * A pragmatic DETECT -> FIX -> VERIFY loop for getting Librarian into
 * operational shape, with an evidence audit artifact written to disk.
 *
 * Usage: librarian ralph [--mode fast|full] [--max-cycles N] [--json] [--output <path>] [--skip-eval]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { runOnboardingRecovery, type OnboardingRecoveryResult } from '../../api/onboarding_recovery.js';
import { checkAllProviders } from '../../api/provider_check.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { generateStateReport, type LibrarianStateReport } from '../../measurement/observability.js';
import { runStagedEvaluation, type FitnessReport, type EvaluationContext, type Variant } from '../../evolution/index.js';
import { doctorCommand, type DoctorReport } from './doctor.js';
import { externalReposCommand } from './external_repos.js';

export interface RalphCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type RalphMode = 'fast' | 'full';
type RalphObjective = 'operational' | 'worldclass';

export interface RalphLoopReportV1 {
  schema: 'RalphLoopReport.v1';
  createdAt: string;
  workspace: string;
  mode: RalphMode;
  objective: RalphObjective;
  maxCycles: number;
  cyclesRun: number;
  providerStatus: {
    llmAvailable: boolean;
    embeddingAvailable: boolean;
    llmProvider?: string | null;
    llmModel?: string | null;
    embeddingProvider?: string | null;
    embeddingModel?: string | null;
  };
  cycles: Array<{
    cycle: number;
    startedAt: string;
    completedAt: string;
    doctor?: DoctorReport;
    externalRepos?: unknown;
    recovery: OnboardingRecoveryResult;
    stateAfter: LibrarianStateReport | null;
    fitnessReport?: FitnessReport;
    verdict: 'healthy' | 'degraded' | 'failed';
    nextActions: string[];
  }>;
  artifacts: {
    reportPath: string;
  };
}

export async function ralphCommand(options: RalphCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      mode: { type: 'string', default: 'fast' },
      objective: { type: 'string', default: 'operational' },
      'max-cycles': { type: 'string', default: '2' },
      output: { type: 'string' },
      json: { type: 'boolean', default: false },
      'skip-eval': { type: 'boolean', default: false },
      stages: { type: 'string', default: '0-4' },
      verbose: { type: 'boolean', default: false },
      'repos-root': { type: 'string' },
      'max-repos': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const modeRaw = typeof values.mode === 'string' ? values.mode : 'fast';
  const mode: RalphMode = modeRaw === 'full' ? 'full' : 'fast';
  const objectiveRaw = typeof values.objective === 'string' ? values.objective : 'operational';
  const objective: RalphObjective = objectiveRaw === 'worldclass' ? 'worldclass' : 'operational';
  const maxCycles = Number.parseInt(String(values['max-cycles'] ?? '2'), 10);
  const json = Boolean(values.json);
  const skipEval = Boolean(values['skip-eval']);
  const stages = typeof values.stages === 'string' ? values.stages : '0-4';
  const verbose = Boolean(values.verbose);

  const defaultCycles = objective === 'worldclass' ? 10 : 2;
  const resolvedMaxCycles = Number.isFinite(maxCycles) && maxCycles > 0 ? maxCycles : defaultCycles;
  const dbPath = await resolveDbPath(workspace);

  const providerStatus = await checkAllProviders({ workspaceRoot: workspace });
  const providerSummary = {
    llmAvailable: providerStatus.llm.available,
    embeddingAvailable: providerStatus.embedding.available,
    llmProvider: providerStatus.llm.provider ?? null,
    llmModel: providerStatus.llm.model ?? null,
    embeddingProvider: providerStatus.embedding.provider ?? null,
    embeddingModel: providerStatus.embedding.model ?? null,
  };

  const reportDir = path.join(workspace, 'state', 'audits', 'ralph');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = typeof values.output === 'string' && values.output.trim().length > 0
    ? path.resolve(values.output)
    : path.join(reportDir, `RalphLoopReport.v1_${Date.now()}.json`);

  const report: RalphLoopReportV1 = {
    schema: 'RalphLoopReport.v1',
    createdAt: new Date().toISOString(),
    workspace,
    mode,
    objective,
    maxCycles: resolvedMaxCycles,
    cyclesRun: 0,
    providerStatus: providerSummary,
    cycles: [],
    artifacts: { reportPath },
  };

  const runEval = !skipEval && mode === 'full';
  const bootstrapMode = mode === 'full' ? 'full' : 'fast';

  const reposRoot = typeof values['repos-root'] === 'string' && values['repos-root'].trim().length > 0
    ? values['repos-root'].trim()
    : path.join(workspace, 'eval-corpus', 'external-repos');
  const maxRepos = parseOptionalPositiveInt(values['max-repos']);

  for (let cycle = 1; cycle <= resolvedMaxCycles; cycle += 1) {
    const startedAt = new Date().toISOString();

    const doctor = await maybeRunDoctor({ objective, workspace, jsonMode: true });
    const externalRepos = await maybeRunExternalReposSync({ objective, workspace, reposRoot, maxRepos, jsonMode: true });

    const recovery = await runOnboardingRecovery({
      workspace,
      dbPath,
      autoHealConfig: true,
      allowDegradedEmbeddings: true,
      bootstrapMode,
      emitBaseline: mode === 'full',
      forceBootstrap: false,
      riskTolerance: mode === 'full' ? 'medium' : 'low',
    });

    const stateAfter = await loadStateReport({ workspace, dbPath });

    let fitnessReport: FitnessReport | undefined;
    if (runEval) {
      fitnessReport = await runEvaluation({
        workspace,
        dbPath,
        providerAvailable: providerSummary.llmAvailable && providerSummary.embeddingAvailable,
        stages,
        objective,
      });
    }

    const nextActions = computeNextActions({ mode, objective, recovery, stateAfter, fitnessReport });
    const verdict = computeVerdict({ objective, recovery, stateAfter, fitnessReport });

    report.cyclesRun = cycle;
    report.cycles.push({
      cycle,
      startedAt,
      completedAt: new Date().toISOString(),
      doctor,
      externalRepos,
      recovery,
      stateAfter,
      fitnessReport,
      verdict,
      nextActions,
    });

    // Early exit:
    // - worldclass: require truly healthy (and fitness if enabled)
    // - operational: accept degraded as long as we're not failing
    const fitnessOk = !fitnessReport || fitnessReport.fitness.overall >= 0.7;
    const healthOk = Boolean(
      stateAfter && (objective === 'worldclass'
        ? stateAfter.health.status === 'healthy'
        : stateAfter.health.status !== 'unhealthy')
    );
    const verdictOk = objective === 'worldclass' ? verdict === 'healthy' : verdict !== 'failed';
    if (healthOk && verdictOk && fitnessOk) break;
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== Librarian Ralph Loop ===\n');
    console.log(`Workspace: ${workspace}`);
    console.log(`Mode: ${mode}`);
    console.log(`Cycles: ${report.cyclesRun}/${resolvedMaxCycles}`);
    console.log(`Providers: llm=${providerSummary.llmAvailable ? 'ok' : 'missing'}, embedding=${providerSummary.embeddingAvailable ? 'ok' : 'missing'}`);
    const last = report.cycles[report.cycles.length - 1];
    if (last?.stateAfter) {
      console.log(`Health: ${last.stateAfter.health.status}`);
      if (last.fitnessReport) {
        console.log(`Fitness: ${(last.fitnessReport.fitness.overall * 100).toFixed(1)}%`);
      }
    }
    console.log(`Audit: ${reportPath}\n`);
    if (verbose) {
      for (const cycle of report.cycles) {
        console.log(`Cycle ${cycle.cycle}: ${cycle.verdict}`);
        if (cycle.nextActions.length > 0) {
          console.log(`  Next: ${cycle.nextActions.join(' | ')}`);
        }
      }
      console.log();
    }
  }

  const lastVerdict = report.cycles[report.cycles.length - 1]?.verdict ?? 'failed';
  if (objective === 'worldclass') {
    // Strict: worldclass runs should only pass when the system is fully healthy.
    if (lastVerdict !== 'healthy') process.exitCode = 1;
  } else {
    // Operational: degraded is acceptable (e.g., freshness SLO misses) as long as the system isn't failing.
    if (lastVerdict === 'failed') process.exitCode = 1;
  }
}

async function loadStateReport(options: { workspace: string; dbPath: string }): Promise<LibrarianStateReport | null> {
  const { workspace, dbPath } = options;
  const storage = createSqliteStorage(dbPath, workspace);
  try {
    await storage.initialize();
    return await generateStateReport(storage);
  } catch {
    return null;
  } finally {
    await storage.close().catch(() => {});
  }
}

async function runEvaluation(options: {
  workspace: string;
  dbPath: string;
  providerAvailable: boolean;
  stages: string;
  objective: RalphObjective;
}): Promise<FitnessReport> {
  const { workspace, dbPath, providerAvailable, objective } = options;

  const context: EvaluationContext = {
    workspaceRoot: workspace,
    dbPath,
    providerAvailable,
    budget: {
      maxTokens: 10000,
      maxEmbeddings: 100,
      maxProviderCalls: 10,
      maxDurationMs: 300000,
    },
    retrievalEval: {
      enabled: true,
      corpusPath: 'eval-corpus',
      corpusPaths: ['eval-corpus/external-repos'],
      maxRepos: objective === 'worldclass' ? 5 : 2,
      maxQueries: objective === 'worldclass' ? 150 : 40,
      parallel: 1,
      timeoutMs: 60_000,
    },
  };

  const variant: Variant = {
    id: `ralph_${Date.now().toString(36)}`,
    parentId: null,
    emitterId: 'ralph',
    createdAt: new Date().toISOString(),
    genotype: {
      retrievalParams: {
        lexicalWeight: 0.25,
        semanticWeight: 0.35,
        graphWeight: 0.25,
        coChangeBoost: 0.15,
      },
    },
    mutationDescription: 'Ralph loop evaluation of current state',
    evaluated: false,
  };

  // Stages range currently not configurable via runStagedEvaluation; budgets/providerAvailable
  // drive evaluator skipping. Keep the argument for forward compatibility.
  void options.stages;
  const result = await runStagedEvaluation(variant, context, { stopOnFailure: false });
  return result.fitnessReport;
}

function computeVerdict(options: {
  objective: RalphObjective;
  recovery: OnboardingRecoveryResult;
  stateAfter: LibrarianStateReport | null;
  fitnessReport?: FitnessReport;
}): 'healthy' | 'degraded' | 'failed' {
  const { objective, recovery, stateAfter, fitnessReport } = options;
  if (recovery.errors.length > 0) return 'failed';
  if (!stateAfter) return 'failed';
  if (stateAfter.health.status !== 'healthy') return 'degraded';
  // Operational objective: treat the system as healthy if it is operationally healthy.
  // Fitness is still computed and recorded, but it is not yet a strict gate (since some
  // dimensions may be unmeasured/skipped under budget or provider constraints).
  if (objective === 'operational') {
    if (fitnessReport?.stages) {
      const s0 = fitnessReport.stages.stage0_static?.status;
      const s1 = fitnessReport.stages.stage1_tier0?.status;
      const s2 = fitnessReport.stages.stage2_tier1?.status;
      if (s0 === 'failed' || s1 === 'failed' || s2 === 'failed') return 'degraded';
    }
    return 'healthy';
  }
  if (!fitnessReport) return 'degraded';
  if (fitnessReport.fitness.overall < 0.7) return 'degraded';
  const strictFailures = getWorldclassStrictFailures(fitnessReport);
  if (strictFailures.length > 0) return 'degraded';
  return 'healthy';
}

function computeNextActions(options: {
  mode: RalphMode;
  objective: RalphObjective;
  recovery: OnboardingRecoveryResult;
  stateAfter: LibrarianStateReport | null;
  fitnessReport?: FitnessReport;
}): string[] {
  const { mode, objective, recovery, stateAfter, fitnessReport } = options;
  const actions: string[] = [];

  if (recovery.errors.length > 0) {
    actions.push('Run `librarian doctor --json` and inspect recovery errors');
  }

  const bootstrap = recovery.bootstrap;
  if (bootstrap && bootstrap.attempted && !bootstrap.success) {
    actions.push('Run `librarian bootstrap --force`');
  }

  if (bootstrap?.report?.warnings && bootstrap.report.warnings.length > 0) {
    actions.push('Review bootstrap warnings (likely degraded provider/indexing)');
  }

  if (stateAfter && stateAfter.health.status !== 'healthy') {
    actions.push('Run `librarian doctor --heal --risk-tolerance safe`');
    actions.push('Run `librarian watch` to keep index fresh');
  }

  if (mode === 'full' && fitnessReport && fitnessReport.fitness.overall < 0.7) {
    actions.push('Run `librarian eval --save-baseline` and inspect stage failures');
    actions.push('Run `librarian evolve --cycles 3 --candidates 4` (when providers available)');
  }

  if (objective === 'worldclass' && fitnessReport) {
    const strictFailures = getWorldclassStrictFailures(fitnessReport);
    if (strictFailures.length > 0) {
      actions.push('Run `librarian eval --stages 0-4 --save-baseline` and resolve strict worldclass gate failures');
      actions.push(`Resolve strict failures: ${strictFailures.join('; ')}`);
    }
  }

  if (actions.length === 0) {
    actions.push('No action required (healthy).');
  }

  return actions;
}

function getWorldclassStrictFailures(fitnessReport: FitnessReport): string[] {
  const failures: string[] = [];

  const stageEntries: Array<[string, FitnessReport['stages'][keyof FitnessReport['stages']]]> = [
    ['stage0_static', fitnessReport.stages.stage0_static],
    ['stage1_tier0', fitnessReport.stages.stage1_tier0],
    ['stage2_tier1', fitnessReport.stages.stage2_tier1],
    ['stage3_tier2', fitnessReport.stages.stage3_tier2],
    ['stage4_adversarial', fitnessReport.stages.stage4_adversarial],
  ];

  for (const [name, stage] of stageEntries) {
    if (stage.status !== 'passed') {
      failures.push(`${name}:${stage.status}`);
    }
  }

  const completeness = fitnessReport.measurementCompleteness;
  const scoringIntegrity = fitnessReport.scoringIntegrity;
  if (!scoringIntegrity || scoringIntegrity.status !== 'measured') {
    const reasons = scoringIntegrity?.reasons?.join(',') || 'missing';
    failures.push(`fitness_scoring_unverified:${reasons}`);
  }
  if (!completeness) {
    failures.push('measurement_completeness:missing');
    return failures;
  }

  if (!completeness.retrievalQuality.measured) {
    failures.push(`retrieval_quality_unmeasured:${completeness.retrievalQuality.reason ?? 'unknown'}`);
  }
  if (!completeness.epistemicQuality.measured) {
    failures.push(`epistemic_quality_unmeasured:${completeness.epistemicQuality.reason ?? 'unknown'}`);
  }
  if (!completeness.operationalQuality.measured) {
    failures.push(`operational_quality_unmeasured:${completeness.operationalQuality.reason ?? 'unknown'}`);
  }

  return failures;
}

function parseOptionalPositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

async function captureJsonOutput<T>(run: () => Promise<void>): Promise<T | null> {
  const captured: string[] = [];
  const capturedErr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') captured.push(arg);
      else captured.push(JSON.stringify(arg));
    }
  };
  console.error = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') capturedErr.push(arg);
      else capturedErr.push(JSON.stringify(arg));
    }
  };
  console.warn = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') capturedErr.push(arg);
      else capturedErr.push(JSON.stringify(arg));
    }
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  const candidates = [...captured, ...capturedErr];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!(text.startsWith('{') || text.startsWith('['))) continue;
    try {
      return JSON.parse(text) as T;
    } catch {
      // ignore parse failures; keep scanning.
    }
  }

  // Some commands might emit JSON across multiple console calls. Best-effort join.
  const joined = candidates.join('\n').trim();
  if (joined.startsWith('{') || joined.startsWith('[')) {
    try {
      return JSON.parse(joined) as T;
    } catch {
      return null;
    }
  }

  return null;
}

async function maybeRunDoctor(options: {
  objective: RalphObjective;
  workspace: string;
  jsonMode: boolean;
}): Promise<DoctorReport | undefined> {
  const { objective, workspace, jsonMode } = options;
  if (objective !== 'worldclass') return undefined;

  const report = await captureJsonOutput<DoctorReport>(async () => {
    await doctorCommand({
      workspace,
      json: jsonMode,
      heal: true,
      installGrammars: true,
      riskTolerance: 'safe',
    });
  });
  return report ?? undefined;
}

async function maybeRunExternalReposSync(options: {
  objective: RalphObjective;
  workspace: string;
  reposRoot: string;
  maxRepos?: number;
  jsonMode: boolean;
}): Promise<unknown | undefined> {
  const { objective, workspace, reposRoot, maxRepos, jsonMode } = options;
  if (objective !== 'worldclass') return undefined;

  const rawArgs: string[] = ['external-repos', 'sync', '--repos-root', reposRoot, '--verify'];
  if (typeof maxRepos === 'number') {
    rawArgs.push('--max-repos', String(maxRepos));
  }
  if (jsonMode) rawArgs.push('--json');

  const payload = await captureJsonOutput<unknown>(async () => {
    await externalReposCommand({
      workspace,
      args: ['sync'],
      rawArgs,
    });
  });

  return payload ?? undefined;
}
