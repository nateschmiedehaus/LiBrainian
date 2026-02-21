import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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

type MetamorphicTransformKind =
  | 'format_whitespace'
  | 'prepend_banner_comment'
  | 'inject_noop_statement'
  | 'rename_function_parameter'
  | 'reorder_function_declarations';

type MetamorphicTransformResult = {
  transform: MetamorphicTransformKind;
  file: string | null;
  applied: boolean;
  pass: boolean;
  failureReason?: string;
  queryComparisons: Array<{
    intent: string;
    baselineTopFiles: string[];
    transformedTopFiles: string[];
    overlap: number;
  }>;
};

type MetamorphicTransform = {
  kind: MetamorphicTransformKind;
  apply: (source: string) => string | null;
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
    {
      kind: 'metamorphic',
      query: DEFAULT_QUERY,
      description: 'Apply semantic-preserving transforms and verify query stability.',
    },
    { kind: 'status', description: 'Capture final readiness status' },
  ],
};

const DEFAULT_EVALUATION: Required<UnitPatrolEvaluationCriteria> = {
  minPassRate: 0.67,
  minQueryPacks: 1,
  requireBootstrapped: true,
  maxDurationMs: 120_000,
  minMetamorphicTransforms: 5,
  maxMetamorphicFailureRate: 1,
};

const DEFAULT_METAMORPHIC_TOP_K = 5;
const DEFAULT_METAMORPHIC_MIN_OVERLAP = 0.6;

const METAMORPHIC_TRANSFORMS: MetamorphicTransform[] = [
  {
    kind: 'format_whitespace',
    apply: (source) => {
      const formatted = `${source.replace(/[ \t]+$/gmu, '').replace(/\n{3,}/gmu, '\n\n').trimEnd()}\n`;
      return formatted === source ? null : formatted;
    },
  },
  {
    kind: 'prepend_banner_comment',
    apply: (source) => {
      if (source.includes('metamorphic-preserving-transform')) {
        return null;
      }
      return `// metamorphic-preserving-transform\n${source}`;
    },
  },
  {
    kind: 'inject_noop_statement',
    apply: (source) => {
      const match = /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/u.exec(source);
      if (!match) return null;
      const braceIndex = match.index + match[0].length - 1;
      const bodyEnd = findMatchingBrace(source, braceIndex);
      if (bodyEnd <= braceIndex) return null;
      const insertion = source.includes('void 0;') ? '/* metamorphic-noop */' : 'void 0;';
      return `${source.slice(0, braceIndex + 1)}\n  ${insertion}${source.slice(braceIndex + 1)}`;
    },
  },
  {
    kind: 'rename_function_parameter',
    apply: (source) => {
      const match = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/u.exec(source);
      if (!match) return null;
      const fullMatch = match[0];
      const params = match[2]
        .split(',')
        .map((part) => part.trim())
        .filter((part) => /^[A-Za-z_$][\w$]*$/u.test(part));
      if (params.length === 0) return null;
      const current = params[0];
      const renamed = `${current}Input`;
      if (renamed === current) return null;
      const declarationIndex = match.index;
      const openBraceIndex = declarationIndex + fullMatch.length - 1;
      const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
      if (closeBraceIndex <= openBraceIndex) return null;
      const functionText = source.slice(declarationIndex, closeBraceIndex + 1);
      const replacedDeclaration = functionText.replace(
        new RegExp(`\\b${escapeRegExp(current)}\\b`, 'u'),
        renamed,
      );
      const replacedBody = replaceWordBoundary(replacedDeclaration, current, renamed);
      if (replacedBody === functionText) return null;
      return `${source.slice(0, declarationIndex)}${replacedBody}${source.slice(closeBraceIndex + 1)}`;
    },
  },
  {
    kind: 'reorder_function_declarations',
    apply: (source) => {
      const blocks = collectTopLevelFunctionBlocks(source);
      if (blocks.length < 2) return null;
      const first = blocks[0];
      const second = blocks[1];
      const firstText = source.slice(first.start, first.end);
      const secondText = source.slice(second.start, second.end);
      if (firstText === secondText) return null;
      return [
        source.slice(0, first.start),
        secondText,
        source.slice(first.end, second.start),
        firstText,
        source.slice(second.end),
      ].join('');
    },
  },
];

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
    return { reliability: 0, coverage: 0, speed: 0, metamorphicFailureRate: null };
  }

  const passed = operations.filter((operation) => operation.pass).length;
  const totalDuration = operations.reduce((sum, operation) => sum + operation.durationMs, 0);
  const reliability = passed / operations.length;
  const coverage = 1;
  const speed = Math.max(0, 1 - (totalDuration / Math.max(criteria.maxDurationMs, 1)));
  const metamorphicFailureRate = readMetamorphicFailureRate(operations);

  return { reliability, coverage, speed, metamorphicFailureRate };
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
                  operations.push(await this.runOperation(operation, workspace, ensureLibrarian, findings));
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

        const metamorphicStep = operations.find((operation) => operation.operation === 'metamorphic');
        if (metamorphicStep) {
          const transformationCount = Number(metamorphicStep.details.transformationCount ?? 0);
          if (transformationCount < criteria.minMetamorphicTransforms) {
            findings.push({
              severity: 'error',
              code: 'metamorphic_transform_floor',
              message: `Metamorphic transform count ${transformationCount} is below threshold ${criteria.minMetamorphicTransforms}.`,
              operation: 'metamorphic',
            });
          }

          const failureRate = Number(metamorphicStep.details.failureRate);
          if (Number.isFinite(failureRate) && failureRate > criteria.maxMetamorphicFailureRate) {
            findings.push({
              severity: 'warning',
              code: 'metamorphic_failure_rate_exceeded',
              message: `Metamorphic failure rate ${(failureRate * 100).toFixed(1)}% exceeded threshold ${(criteria.maxMetamorphicFailureRate * 100).toFixed(1)}%.`,
              operation: 'metamorphic',
            });
          }
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
    workspace: string,
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

      if (operation.kind === 'metamorphic') {
        const librarian = await ensureLibrarian();
        const queryConfig = operation.query ?? DEFAULT_QUERY;
        const queryIntents = [queryConfig.intent];
        const baseline = await Promise.all(
          queryIntents.map(async (intent) => {
            const response = await librarian.queryOptional({
              intent,
              depth: queryConfig.depth ?? 'L1',
              llmRequirement: queryConfig.llmRequirement ?? 'disabled',
              timeoutMs: queryConfig.timeoutMs ?? DEFAULT_QUERY.timeoutMs,
              deterministic: true,
            });
            return {
              intent,
              topFiles: collectTopFiles(response, workspace, DEFAULT_METAMORPHIC_TOP_K),
            };
          }),
        );

        const candidateFiles = await collectCandidateSourceFiles(workspace);
        const transformResults: MetamorphicTransformResult[] = [];
        let comparedQueries = 0;

        for (const transform of METAMORPHIC_TRANSFORMS) {
          let appliedResult: MetamorphicTransformResult | null = null;

          for (const file of candidateFiles) {
            const absolutePath = path.join(workspace, file);
            const original = await fs.readFile(absolutePath, 'utf8');
            const transformed = transform.apply(original);
            if (!transformed || transformed === original) continue;

            await fs.writeFile(absolutePath, transformed, 'utf8');
            let compareResult: MetamorphicTransformResult;
            try {
              await librarian.reindexFiles([absolutePath]);

              const queryComparisons = await Promise.all(
                baseline.map(async (baselineQuery) => {
                  const response = await librarian.queryOptional({
                    intent: baselineQuery.intent,
                    depth: queryConfig.depth ?? 'L1',
                    llmRequirement: queryConfig.llmRequirement ?? 'disabled',
                    timeoutMs: queryConfig.timeoutMs ?? DEFAULT_QUERY.timeoutMs,
                    deterministic: true,
                  });
                  const transformedTopFiles = collectTopFiles(response, workspace, DEFAULT_METAMORPHIC_TOP_K);
                  const overlap = computeFileOverlapRatio(baselineQuery.topFiles, transformedTopFiles);
                  return {
                    intent: baselineQuery.intent,
                    baselineTopFiles: baselineQuery.topFiles,
                    transformedTopFiles,
                    overlap,
                  };
                }),
              );
              comparedQueries += queryComparisons.length;
              const pass = queryComparisons.every((comparison) => comparison.overlap >= DEFAULT_METAMORPHIC_MIN_OVERLAP);
              compareResult = {
                transform: transform.kind,
                file,
                applied: true,
                pass,
                queryComparisons,
              };
            } catch (error) {
              compareResult = {
                transform: transform.kind,
                file,
                applied: true,
                pass: false,
                failureReason: toSingleLine(error),
                queryComparisons: [],
              };
            } finally {
              await fs.writeFile(absolutePath, original, 'utf8');
              await librarian.reindexFiles([absolutePath]);
            }

            appliedResult = compareResult;
            break;
          }

          if (!appliedResult) {
            appliedResult = {
              transform: transform.kind,
              file: null,
              applied: false,
              pass: false,
              failureReason: 'No compatible source file found for transform.',
              queryComparisons: [],
            };
          }

          transformResults.push(appliedResult);
        }

        const failureCount = transformResults.filter((result) => !result.pass).length;
        const transformationCount = transformResults.length;
        const failureRate = transformationCount > 0 ? failureCount / transformationCount : 1;

        if (failureCount > 0) {
          findings.push({
            severity: 'warning',
            code: 'metamorphic_regression_detected',
            message: `Metamorphic query stability failures: ${failureCount}/${transformationCount} transforms.`,
            operation: 'metamorphic',
          });
        }

        return {
          operation: 'metamorphic',
          pass: transformationCount >= 5,
          durationMs: Date.now() - startedAt,
          details: {
            transformationCount,
            failureCount,
            failureRate,
            comparedQueries,
            transforms: transformResults,
            minOverlapThreshold: DEFAULT_METAMORPHIC_MIN_OVERLAP,
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

function readMetamorphicFailureRate(operations: UnitPatrolOperationResult[]): number | null {
  const metamorphic = operations.find((operation) => operation.operation === 'metamorphic');
  if (!metamorphic) return null;
  const raw = Number(metamorphic.details.failureRate);
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function replaceWordBoundary(source: string, current: string, renamed: string): string {
  return source.replace(new RegExp(`\\b${escapeRegExp(current)}\\b`, 'gu'), renamed);
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function collectTopLevelFunctionBlocks(source: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  const regex = /^(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gmu;
  let match: RegExpExecArray | null = regex.exec(source);
  while (match) {
    const start = match.index;
    const openBraceIndex = start + match[0].length - 1;
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex > openBraceIndex) {
      blocks.push({ start, end: closeBraceIndex + 1 });
    }
    match = regex.exec(source);
  }
  return blocks;
}

async function collectCandidateSourceFiles(workspace: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [workspace];
  const skipped = new Set(['.git', '.librarian', 'node_modules', 'dist', 'coverage']);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) {
          queue.push(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name);
      if (!['.js', '.ts', '.mjs', '.cjs'].includes(extension)) continue;
      const absolutePath = path.join(current, entry.name);
      results.push(path.relative(workspace, absolutePath).replace(/\\/gu, '/'));
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function collectTopFiles(
  response: Awaited<ReturnType<LiBrainian['queryOptional']>>,
  workspace: string,
  topK: number,
): string[] {
  const files: string[] = [];
  const packs = Array.isArray(response.packs) ? response.packs : [];
  for (const pack of packs.slice(0, topK)) {
    for (const relatedFile of pack.relatedFiles ?? []) {
      files.push(toWorkspaceRelativePath(relatedFile, workspace));
    }
    for (const snippet of pack.codeSnippets ?? []) {
      if (snippet.filePath) {
        files.push(toWorkspaceRelativePath(snippet.filePath, workspace));
      }
    }
  }
  return Array.from(new Set(files));
}

function toWorkspaceRelativePath(filePath: string, workspace: string): string {
  const normalizedWorkspace = workspace.replace(/\\/gu, '/');
  const normalizedPath = filePath.replace(/\\/gu, '/');
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

function computeFileOverlapRatio(baseline: string[], transformed: string[]): number {
  if (baseline.length === 0) return transformed.length === 0 ? 1 : 0;
  const baselineSet = new Set(baseline);
  let overlap = 0;
  for (const file of transformed) {
    if (baselineSet.has(file)) {
      overlap += 1;
    }
  }
  return overlap / baseline.length;
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
