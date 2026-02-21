import * as fs from 'node:fs/promises';
import { createLiBrainian, type LiBrainian } from '../../api/librarian.js';
import type { LlmRequirement } from '../../types.js';
import { AgenticProcess, type ConstructionPipeline } from './process_base.js';
import { createSandboxLifecycleConstruction, type SandboxLifecycleOutput } from './sandbox_construction.js';
import type {
  UnitPatrolEvaluationCriteria,
  UnitPatrolFinding,
  UnitPatrolInput,
  UnitPatrolOperation,
  UnitPatrolOperationResult,
  UnitPatrolQualityScores,
  UnitPatrolResult,
  UnitPatrolScenario,
} from './types.js';

type UnitPatrolState = {
  workspace: string;
  sandbox?: SandboxLifecycleOutput;
  operations: UnitPatrolOperationResult[];
  findings: UnitPatrolFinding[];
};

const DEFAULT_QUERY = {
  intent: 'Summarize the repository architecture and entry points',
  depth: 'L1' as const,
  llmRequirement: 'disabled' as LlmRequirement,
  timeoutMs: 45_000,
};

const DEFAULT_SCENARIO: UnitPatrolScenario = {
  name: 'unit-patrol-smoke',
  operations: [
    { kind: 'bootstrap', description: 'Bootstrap the fixture repository' },
    { kind: 'query', query: DEFAULT_QUERY, description: 'Run a retrieval query against indexed data' },
    { kind: 'status', description: 'Capture final readiness status' },
  ],
};

const DEFAULT_EVALUATION: Required<UnitPatrolEvaluationCriteria> = {
  minPassRate: 0.67,
  minQueryPacks: 1,
  requireBootstrapped: true,
  maxDurationMs: 120_000,
};

function toSingleLine(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  return text.replace(/\s+/gu, ' ').trim();
}

function resolveEmbeddingMetadata(): UnitPatrolResult['embedding'] {
  const provider =
    process.env.LIBRARIAN_EMBEDDING_PROVIDER ??
    process.env.LIBRARIAN_EMBED_PROVIDER ??
    'xenova';
  const model =
    process.env.LIBRARIAN_EMBEDDING_MODEL ??
    process.env.LIBRARIAN_EMBED_MODEL ??
    'all-MiniLM-L6-v2';
  const realProviderExpected = provider === 'xenova' || provider === 'sentence-transformers';
  return { provider, model, realProviderExpected };
}

function computeQualityScores(
  operations: UnitPatrolOperationResult[],
  criteria: Required<UnitPatrolEvaluationCriteria>,
): UnitPatrolQualityScores {
  if (operations.length === 0) {
    return { reliability: 0, coverage: 0, speed: 0 };
  }

  const passed = operations.filter((operation) => operation.pass).length;
  const totalDuration = operations.reduce((sum, operation) => sum + operation.durationMs, 0);
  const reliability = passed / operations.length;
  const coverage = 1;
  const speed = Math.max(0, 1 - (totalDuration / Math.max(criteria.maxDurationMs, 1)));

  return { reliability, coverage, speed };
}

export class UnitPatrolConstruction extends AgenticProcess<UnitPatrolInput, UnitPatrolResult, UnitPatrolState> {
  constructor(
    id = 'unit-patrol-base',
    name = 'Unit Patrol Base',
    description = 'Base process construction for fixture-based unit patrol scenarios.',
    private readonly defaultScenario: UnitPatrolScenario = DEFAULT_SCENARIO,
    private readonly defaultEvaluation: UnitPatrolEvaluationCriteria = DEFAULT_EVALUATION,
  ) {
    super(id, name, description);
  }

  protected buildPipeline(input: UnitPatrolInput): ConstructionPipeline<UnitPatrolInput, UnitPatrolState, UnitPatrolResult> {
    const scenario = input.scenario ?? this.defaultScenario;
    const sandboxConstruction = createSandboxLifecycleConstruction();

    return {
      initialState: () => ({
        workspace: input.fixtureRepoPath,
        operations: [],
        findings: [],
      }),
      stages: [
        {
          id: 'sandbox',
          mode: 'sequential',
          tasks: [
            {
              id: 'sandbox.setup',
              run: async (stageInput) => {
                const sandbox = await sandboxConstruction.execute({
                  repoPath: stageInput.fixtureRepoPath,
                  mode: 'copy',
                  cleanupOnExit: stageInput.keepSandbox !== true,
                });
                if (sandbox.created && sandbox.cleanupOnExit) {
                  this.registerCleanup(async () => {
                    await fs.rm(sandbox.sandboxPath, { recursive: true, force: true });
                  });
                }
                return {
                  sandbox,
                  workspace: sandbox.sandboxPath,
                };
              },
            },
          ],
        },
        {
          id: 'unit-patrol',
          mode: 'sequential',
          tasks: [
            {
              id: 'unit-patrol.execute',
              run: async (stageInput, state) => {
                const workspace = state.workspace || stageInput.fixtureRepoPath;
                const operations: UnitPatrolOperationResult[] = [];
                const findings: UnitPatrolFinding[] = [];
                let librarian: LiBrainian | null = null;

                const ensureLibrarian = async (): Promise<LiBrainian> => {
                  if (librarian) return librarian;
                  librarian = await createLiBrainian({
                    workspace,
                    autoBootstrap: true,
                    autoWatch: false,
                    skipEmbeddings: false,
                  });
                  this.registerCleanup(async () => {
                    if (librarian) {
                      await librarian.shutdown();
                      librarian = null;
                    }
                  });
                  return librarian;
                };

                for (const operation of scenario.operations) {
                  operations.push(await this.runOperation(operation, ensureLibrarian, findings));
                }

                return { operations, findings, workspace };
              },
            },
          ],
        },
      ],
      finalize: async (stageInput, state, events) => {
        const criteria: Required<UnitPatrolEvaluationCriteria> = {
          ...DEFAULT_EVALUATION,
          ...this.defaultEvaluation,
          ...(stageInput.evaluation ?? {}),
        };
        const operations = state.operations;
        const passed = operations.filter((operation) => operation.pass).length;
        const passRate = operations.length > 0 ? passed / operations.length : 0;
        const qualityScores = computeQualityScores(operations, criteria);
        const findings = [...state.findings];

        const totalDurationMs = operations.reduce((sum, operation) => sum + operation.durationMs, 0);
        if (criteria.requireBootstrapped) {
          const bootstrapStep = operations.find((operation) => operation.operation === 'bootstrap');
          if (!bootstrapStep?.pass) {
            findings.push({
              severity: 'error',
              code: 'bootstrap_required',
              message: 'Bootstrap operation did not pass.',
              operation: 'bootstrap',
            });
          }
        }

        const querySteps = operations.filter((operation) => operation.operation === 'query');
        const queryPackCount = querySteps.reduce((sum, operation) => {
          const packs = operation.details.packCount;
          return sum + (typeof packs === 'number' ? packs : 0);
        }, 0);
        if (querySteps.length > 0 && queryPackCount < criteria.minQueryPacks) {
          findings.push({
            severity: 'warning',
            code: 'query_pack_floor',
            message: `Query pack count ${queryPackCount} is below threshold ${criteria.minQueryPacks}.`,
            operation: 'query',
          });
        }

        if (totalDurationMs > criteria.maxDurationMs) {
          findings.push({
            severity: 'warning',
            code: 'duration_budget_exceeded',
            message: `Unit patrol duration ${totalDurationMs}ms exceeded max ${criteria.maxDurationMs}ms.`,
          });
        }

        const hardErrors = findings.filter((finding) => finding.severity === 'error');
        const pass = passRate >= criteria.minPassRate && hardErrors.length === 0;

        return {
          kind: 'UnitPatrolResult.v1',
          scenario: (stageInput.scenario ?? this.defaultScenario).name,
          workspace: state.workspace || stageInput.fixtureRepoPath,
          pass,
          passRate,
          operations,
          findings,
          qualityScores,
          embedding: resolveEmbeddingMetadata(),
          observations: {
            scenario: (stageInput.scenario ?? this.defaultScenario).name,
            operationCount: operations.length,
            eventCount: events.length,
          },
          costSummary: {
            durationMs: totalDurationMs,
          },
          exitReason: pass ? 'completed' : 'failed',
          events,
        };
      },
    };
  }

  private async runOperation(
    operation: UnitPatrolOperation,
    ensureLibrarian: () => Promise<LiBrainian>,
    findings: UnitPatrolFinding[],
  ): Promise<UnitPatrolOperationResult> {
    const startedAt = Date.now();
    try {
      if (operation.kind === 'bootstrap') {
        const librarian = await ensureLibrarian();
        const status = await librarian.getStatus();
        const pass = Boolean(status.bootstrapped && status.initialized);
        if (!pass) {
          findings.push({
            severity: 'error',
            code: 'bootstrap_incomplete',
            message: 'LiBrainian did not report bootstrapped+initialized state.',
            operation: 'bootstrap',
          });
        }
        return {
          operation: 'bootstrap',
          pass,
          durationMs: Date.now() - startedAt,
          details: {
            initialized: status.initialized,
            bootstrapped: status.bootstrapped,
            totalContextPacks: status.stats.totalContextPacks,
          },
        };
      }

      if (operation.kind === 'status') {
        const librarian = await ensureLibrarian();
        const status = await librarian.getStatus();
        return {
          operation: 'status',
          pass: status.initialized,
          durationMs: Date.now() - startedAt,
          details: {
            initialized: status.initialized,
            bootstrapped: status.bootstrapped,
            modules: status.stats.totalModules,
            functions: status.stats.totalFunctions,
            contextPacks: status.stats.totalContextPacks,
          },
        };
      }

      const librarian = await ensureLibrarian();
      const queryConfig = operation.query ?? DEFAULT_QUERY;
      const response = await librarian.queryOptional({
        intent: queryConfig.intent,
        depth: queryConfig.depth ?? 'L1',
        llmRequirement: queryConfig.llmRequirement ?? 'disabled',
        timeoutMs: queryConfig.timeoutMs ?? DEFAULT_QUERY.timeoutMs,
        deterministic: true,
      });
      const packCount = Array.isArray(response.packs) ? response.packs.length : 0;
      const pass = packCount > 0 && response.latencyMs >= 0;
      if (!pass) {
        findings.push({
          severity: 'warning',
          code: 'query_low_signal',
          message: 'Query operation returned no packs.',
          operation: 'query',
        });
      }
      return {
        operation: 'query',
        pass,
        durationMs: Date.now() - startedAt,
        details: {
          packCount,
          latencyMs: response.latencyMs,
          llmAvailable: response.llmAvailable ?? null,
          llmRequirement: response.llmRequirement ?? queryConfig.llmRequirement ?? 'disabled',
        },
      };
    } catch (error) {
      const message = toSingleLine(error);
      findings.push({
        severity: 'error',
        code: 'operation_failed',
        message,
        operation: operation.kind,
      });
      return {
        operation: operation.kind,
        pass: false,
        durationMs: Date.now() - startedAt,
        details: {},
        error: message,
      };
    }
  }
}

export function createFixtureSmokeUnitPatrolConstruction(): UnitPatrolConstruction {
  return new UnitPatrolConstruction(
    'unit-patrol-fixture-smoke',
    'Unit Patrol Fixture Smoke',
    'Bootstraps a fixture repository, executes a query, and reports structured quality findings.',
    DEFAULT_SCENARIO,
    DEFAULT_EVALUATION,
  );
}

export const UNIT_PATROL_DEFAULT_SCENARIO = DEFAULT_SCENARIO;

export const UNIT_PATROL_DEFAULT_EVALUATION = DEFAULT_EVALUATION;
