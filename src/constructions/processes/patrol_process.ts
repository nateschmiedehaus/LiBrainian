import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgenticProcess, type ConstructionPipeline, type ProcessInput, type ProcessOutput } from './process_base.js';
import { createSandboxLifecycleConstruction, type SandboxLifecycleOutput } from './sandbox_construction.js';
import { createAgentDispatchConstruction, type AgentDispatchOutput } from './agent_dispatch_construction.js';
import { createObservationExtractionConstruction, type ObservationExtractionOutput } from './observation_extraction_construction.js';
import { createImplicitSignalConstruction, type ImplicitSignalOutput } from './implicit_signal_construction.js';
import { createCostControlConstruction, type CostControlOutput } from './cost_control_construction.js';
import { createAggregationConstruction, type AggregationOutput, type PatrolRunAggregateInput } from './aggregation_construction.js';
import { createReportConstruction, type ReportConstructionOutput } from './report_construction.js';

export interface PatrolInput extends ProcessInput {
  repoPath?: string;
  mode?: 'quick' | 'full' | 'release';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  dryRun?: boolean;
  keepSandbox?: boolean;
  observationProtocol?: {
    incrementalPrefix?: string;
    blockStart?: string;
    blockEnd?: string;
  };
}

export interface PatrolOutput extends ProcessOutput {
  report: ReportConstructionOutput;
  findings: Array<{
    category: string;
    severity: string;
    title: string;
    detail: string;
  }>;
  implicitSignals: ImplicitSignalOutput;
  aggregate: AggregationOutput;
}

type PatrolProcessState = {
  sandbox?: SandboxLifecycleOutput;
  dispatch?: AgentDispatchOutput;
  extraction?: ObservationExtractionOutput;
  implicitSignals?: ImplicitSignalOutput;
  costControl?: CostControlOutput;
  aggregate?: AggregationOutput;
  report?: ReportConstructionOutput;
};

function createSyntheticPatrolOutput(mode: 'quick' | 'full' | 'release'): string {
  const observation = {
    overallVerdict: {
      wouldRecommend: mode !== 'quick',
      npsScore: mode === 'release' ? 8 : mode === 'full' ? 7 : 6,
      biggestStrength: 'Structured construction workflow',
      biggestWeakness: 'Needs more live-repo coverage',
    },
    negativeFindingsMandatory: [
      {
        category: 'process',
        severity: 'medium',
        title: 'Synthetic run (dry-run mode)',
        detail: 'No external agent command supplied; generated synthetic patrol observation.',
      },
    ],
  };

  return [
    'PATROL_OBS: {"type":"feature","feature":"constructions run","quality":"good","notes":"patrol-process invoked"}',
    `PATROL_OBS: ${JSON.stringify({
      type: 'verdict',
      wouldRecommend: observation.overallVerdict.wouldRecommend,
      npsScore: observation.overallVerdict.npsScore,
    })}`,
    'PATROL_OBSERVATION_JSON_START',
    JSON.stringify(observation, null, 2),
    'PATROL_OBSERVATION_JSON_END',
  ].join('\n');
}

function normalizeFindings(
  extraction: ObservationExtractionOutput | undefined,
): Array<{ category: string; severity: string; title: string; detail: string }> {
  const observation = extraction?.fullObservation;
  const negatives = observation?.negativeFindingsMandatory;
  if (!Array.isArray(negatives)) return [];
  return negatives
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      category: String(entry.category ?? 'unknown'),
      severity: String(entry.severity ?? 'medium'),
      title: String(entry.title ?? 'Untitled finding'),
      detail: String(entry.detail ?? ''),
    }));
}

export class PatrolProcess extends AgenticProcess<PatrolInput, PatrolOutput, PatrolProcessState> {
  constructor() {
    super('patrol-process', 'Patrol Process', 'Agent Patrol as a first-class process construction.');
  }

  protected buildPipeline(
    input: PatrolInput,
  ): ConstructionPipeline<PatrolInput, PatrolProcessState, PatrolOutput> {
    const sandboxConstruction = createSandboxLifecycleConstruction();
    const dispatchConstruction = createAgentDispatchConstruction();
    const extractionConstruction = createObservationExtractionConstruction();
    const implicitSignalConstruction = createImplicitSignalConstruction();
    const costControlConstruction = createCostControlConstruction();
    const aggregationConstruction = createAggregationConstruction();
    const reportConstruction = createReportConstruction();

    const mode = input.mode ?? 'quick';

    return {
      initialState: () => ({}),
      stages: [
        {
          id: 'sandbox',
          mode: 'sequential',
          tasks: [
            {
              id: 'sandbox.setup',
              run: async (taskInput) => {
                if (!taskInput.repoPath) return {};
                const sandbox = await sandboxConstruction.execute({
                  repoPath: taskInput.repoPath,
                  mode: 'copy',
                  cleanupOnExit: taskInput.keepSandbox !== true,
                });
                if (sandbox.created && sandbox.cleanupOnExit) {
                  this.registerCleanup(async () => {
                    await fs.rm(sandbox.sandboxPath, { recursive: true, force: true });
                  });
                }
                return { sandbox };
              },
            },
          ],
        },
        {
          id: 'dispatch',
          mode: 'sequential',
          tasks: [
            {
              id: 'dispatch.agent',
              run: async (taskInput, state) => {
                const shouldDryRun = taskInput.dryRun !== false && !taskInput.command;
                if (shouldDryRun) {
                  return {
                    dispatch: {
                      commandLine: 'synthetic-dry-run',
                      exitCode: 0,
                      timedOut: false,
                      durationMs: 0,
                      stdout: createSyntheticPatrolOutput(mode),
                      stderr: '',
                    },
                  };
                }

                if (!taskInput.command) {
                  throw new Error('patrol_process_missing_command');
                }

                const cwd = state.sandbox?.sandboxPath ?? taskInput.cwd ?? process.cwd();
                const dispatch = await dispatchConstruction.execute({
                  command: taskInput.command,
                  args: taskInput.args ?? [],
                  cwd,
                  env: taskInput.env,
                  timeoutMs: taskInput.timeoutMs,
                });
                return { dispatch };
              },
            },
          ],
        },
        {
          id: 'extract-signals',
          mode: 'parallel',
          tasks: [
            {
              id: 'extract.observations',
              run: async (taskInput, state) => {
                const output = state.dispatch?.stdout ?? '';
                const extraction = await extractionConstruction.execute({
                  output,
                  incrementalPrefix: taskInput.observationProtocol?.incrementalPrefix,
                  blockStart: taskInput.observationProtocol?.blockStart,
                  blockEnd: taskInput.observationProtocol?.blockEnd,
                });
                return { extraction };
              },
            },
            {
              id: 'extract.implicit',
              run: async (_, state) => {
                const dispatch = state.dispatch;
                const implicitSignals = await implicitSignalConstruction.execute({
                  stdout: dispatch?.stdout ?? '',
                  stderr: dispatch?.stderr,
                  exitCode: dispatch?.exitCode,
                  timedOut: dispatch?.timedOut,
                  durationMs: dispatch?.durationMs,
                  timeoutMs: input.timeoutMs,
                });
                return { implicitSignals };
              },
            },
          ],
        },
        {
          id: 'budget',
          mode: 'sequential',
          tasks: [
            {
              id: 'budget.evaluate',
              run: async (taskInput, state) => {
                const costControl = await costControlConstruction.execute({
                  budget: {
                    maxDurationMs: taskInput.budget?.maxDurationMs,
                    maxTokens: taskInput.budget?.maxTokenBudget,
                    maxUsd: taskInput.budget?.maxUsd,
                  },
                  usage: {
                    durationMs: state.dispatch?.durationMs ?? 0,
                  },
                });
                return { costControl };
              },
            },
          ],
        },
        {
          id: 'aggregate-report',
          mode: 'sequential',
          tasks: [
            {
              id: 'aggregate.compute',
              run: async (_, state) => {
                const run: PatrolRunAggregateInput = {
                  repo: state.sandbox?.sourcePath,
                  durationMs: state.dispatch?.durationMs,
                  observations: state.extraction?.fullObservation as PatrolRunAggregateInput['observations'],
                  implicitSignals: state.implicitSignals,
                };
                const aggregate = await aggregationConstruction.execute({ runs: [run] });
                return { aggregate };
              },
            },
            {
              id: 'report.build',
              run: async (_, state) => {
                const run: PatrolRunAggregateInput = {
                  repo: state.sandbox?.sourcePath,
                  durationMs: state.dispatch?.durationMs,
                  observations: state.extraction?.fullObservation as PatrolRunAggregateInput['observations'],
                  implicitSignals: state.implicitSignals,
                };
                const report = await reportConstruction.execute({
                  mode,
                  commitSha: process.env.GITHUB_SHA,
                  runs: [run],
                  aggregate: state.aggregate ?? {
                    runCount: 1,
                    meanNps: 0,
                    wouldRecommendRate: 0,
                    avgNegativeFindings: 0,
                    implicitFallbackRate: 0,
                  },
                });
                return { report };
              },
            },
          ],
        },
      ],
      finalize: async (taskInput, state, events) => {
        const report = state.report ?? await reportConstruction.execute({
          mode,
          commitSha: process.env.GITHUB_SHA,
          runs: [],
          aggregate: {
            runCount: 0,
            meanNps: 0,
            wouldRecommendRate: 0,
            avgNegativeFindings: 0,
            implicitFallbackRate: 0,
          },
        });
        const findings = normalizeFindings(state.extraction);

        const baseExitReason = taskInput.dryRun !== false && !taskInput.command
          ? 'dry_run'
          : (state.costControl?.allowed === false ? 'budget_exceeded' : 'completed');

        return {
          report,
          findings,
          implicitSignals: state.implicitSignals ?? {
            fellBackToGrep: false,
            catInsteadOfContext: false,
            commandsFailed: 0,
            abortedEarly: false,
            timeoutRatio: 0,
            stderrAnomalies: [],
          },
          aggregate: state.aggregate ?? {
            runCount: 0,
            meanNps: 0,
            wouldRecommendRate: 0,
            avgNegativeFindings: 0,
            implicitFallbackRate: 0,
          },
          observations: {
            extraction: state.extraction,
            costControl: state.costControl,
            report,
          },
          costSummary: {
            durationMs: state.dispatch?.durationMs ?? 0,
          },
          exitReason: baseExitReason,
          events,
        };
      },
    };
  }
}

export function createPatrolProcessConstruction(): PatrolProcess {
  return new PatrolProcess();
}

export const PATROL_PROCESS_DESCRIPTION =
  'PatrolInput/PatrolOutput typed process that runs an agent command (or dry-run synthetic mode), extracts observations/signals, aggregates outcomes, and emits PatrolReport.v1.';

export const PATROL_PROCESS_EXAMPLE_INPUT = {
  mode: 'quick',
  repoPath: '.',
  dryRun: true,
};
