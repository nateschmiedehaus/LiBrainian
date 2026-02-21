import { ensureOutputEnvelope, type LiBrainianQuery, type LiBrainianResponse } from '../types.js';
import type { LiBrainianStorage } from '../storage/types.js';
import type { EmbeddingService } from './embeddings.js';
import type { GovernorContext } from './governor_context.js';
import type { QueryStageObserver } from '../types.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId, resolveReplaySessionId } from '../epistemics/evidence_ledger.js';
import {
  TechniqueExecutionEngine,
  createLlmPrimitiveExecutor,
  type CompositionExecutionOptions,
  type CompositionStepResult,
  type ExecutionContext,
  type LlmPrimitiveExecutorOptions,
  type PrimitiveExecutionHandler,
} from './technique_execution.js';
import { queryLiBrainian } from './query.js';
import {
  planWorkFromIntentWithContext,
  type PlanWorkOptions,
  type PlanWorkResult,
} from './plan_compiler.js';
import { ensureTechniquePrimitives } from './technique_library.js';
import {
  recordExecutionTrace,
  type ExecutionOutcome,
  type ExecutionTrace,
} from '../state/execution_traces.js';
import { randomUUID } from 'node:crypto';

export interface ExecutionPipelineOptions {
  embeddingService?: EmbeddingService;
  governorContext?: GovernorContext;
  onStage?: QueryStageObserver;
  evidenceLedger?: IEvidenceLedger;
  sessionId?: SessionId;
  planOptions?: PlanWorkOptions;
  planIndex?: number;
  executionInputs?: Record<string, unknown>;
  executionContext?: Partial<ExecutionContext>;
  executionOptions?: CompositionExecutionOptions;
  handlers?: Map<string, PrimitiveExecutionHandler>;
  defaultHandler?: PrimitiveExecutionHandler;
  useLlmExecutor?: boolean;
  llmExecutorOptions?: LlmPrimitiveExecutorOptions;
  allowMissingPrimitives?: boolean;
  recordTrace?: boolean;
}

export interface ExecutionPipelineResult {
  query: LiBrainianQuery;
  response: LiBrainianResponse;
  plan: PlanWorkResult;
  steps: CompositionStepResult[];
  executionId: string;
  outcome: ExecutionOutcome;
  trace: ExecutionTrace;
}

export async function executeQueryPipeline(
  query: LiBrainianQuery,
  storage: LiBrainianStorage,
  options: ExecutionPipelineOptions = {}
): Promise<ExecutionPipelineResult> {
  const querySessionId = options.evidenceLedger
    ? (options.sessionId ?? createSessionId())
    : undefined;
  const response = ensureOutputEnvelope(await queryLiBrainian(
    query,
    storage,
    options.embeddingService,
    options.governorContext,
    options.onStage,
    {
      evidenceLedger: options.evidenceLedger,
      sessionId: querySessionId,
    }
  ));

  const planResults = await planWorkFromIntentWithContext(
    storage,
    query.intent,
    response,
    options.planOptions
  );
  if (planResults.length === 0) {
    throw new Error(`unverified_by_trace(composition_selection_empty): ${query.intent}`);
  }
  const planIndex = options.planIndex ?? 0;
  const plan = planResults[Math.min(planResults.length - 1, Math.max(0, planIndex))];
  if (plan.missingPrimitiveIds.length > 0 && !options.allowMissingPrimitives) {
    throw new Error(
      `unverified_by_trace(composition_missing_primitives): ${plan.missingPrimitiveIds.join(',')}`
    );
  }

  const primitives = await ensureTechniquePrimitives(storage);
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const resolvePrimitive = (id: string) => primitiveById.get(id);
  const handlers = options.handlers ?? new Map<string, PrimitiveExecutionHandler>();
  const shouldUseLlm = options.useLlmExecutor === true && !options.defaultHandler;
  const defaultHandler = options.defaultHandler ?? (shouldUseLlm ? createLlmPrimitiveExecutor(options.llmExecutorOptions) : undefined);
  const engine = new TechniqueExecutionEngine({
    handlers,
    defaultHandler,
    resolvePrimitive,
  });

  const executionId = options.executionOptions?.executionId ?? randomUUID();
  const compositionOptions: CompositionExecutionOptions = {
    ...options.executionOptions,
    executionId,
  };
  const executionSessionId = options.executionContext?.sessionId
    ?? resolveReplaySessionId(response.traceId)
    ?? (options.evidenceLedger ? createSessionId() : undefined);
  const executionContext: ExecutionContext = {
    knowledge: response,
    evidenceLedger: options.executionContext?.evidenceLedger ?? options.evidenceLedger,
    sessionId: executionSessionId,
    workspaceRoot: options.executionContext?.workspaceRoot,
    llm: options.executionContext?.llm,
    governor: options.executionContext?.governor ?? options.governorContext,
    tools: options.executionContext?.tools,
    onProgress: options.executionContext?.onProgress,
  };

  const baseInputs: Record<string, unknown> = {};
  if (query.intent) baseInputs.intent = query.intent;
  if (query.taskType) baseInputs.taskType = query.taskType;
  if (query.affectedFiles?.length) baseInputs.affectedFiles = query.affectedFiles;
  const executionInputs = {
    ...baseInputs,
    ...(options.executionInputs ?? {}),
  };

  const steps: CompositionStepResult[] = [];
  const startedAt = Date.now();
  for await (const step of engine.executeComposition(
    plan.composition,
    executionInputs,
    executionContext,
    compositionOptions
  )) {
    steps.push(step);
  }
  const durationMs = Date.now() - startedAt;
  const outcome = deriveExecutionOutcome(steps);
  const primitiveSequence = steps
    .slice()
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((step) => step.primitiveId);
  const operatorsUsed = plan.composition.operators?.map((op) => op.id) ?? [];
  const trace: ExecutionTrace = {
    executionId,
    compositionId: plan.composition.id,
    primitiveSequence,
    operatorsUsed,
    intent: query.intent,
    outcome,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  if (options.recordTrace !== false) {
    await recordExecutionTrace(storage, trace);
  }

  return {
    query,
    response,
    plan,
    steps,
    executionId,
    outcome,
    trace,
  };
}

function deriveExecutionOutcome(steps: CompositionStepResult[]): ExecutionOutcome {
  if (steps.length === 0) return 'unknown';
  if (steps.some((step) => step.status === 'failed')) return 'failure';
  if (steps.some((step) => step.status === 'partial')) return 'partial';
  return 'success';
}
