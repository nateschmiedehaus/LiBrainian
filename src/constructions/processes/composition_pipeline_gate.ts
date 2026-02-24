import { deterministic } from '../../epistemics/confidence.js';
import {
  createConstruction,
  parallel,
  sequence,
  withTimeout,
} from '../composition.js';
import { ConstructionError, ConstructionTimeoutError, type ConstructionResult } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

export interface CompositionPipelineGateInput {
  timeoutMs?: number;
  slowStepDelayMs?: number;
  maxDurationMs?: number;
}

export interface CompositionSequenceCheck {
  requestId: string;
  observedRequestId: string;
  dataFlowValid: boolean;
  coherent: boolean;
  summary: string;
}

export interface CompositionParallelCheck {
  branchCount: number;
  metricsAligned: boolean;
  mergedCoherent: boolean;
  mergedSummary: string;
}

export interface CompositionTimeoutCheck {
  enforced: boolean;
  timeoutMs: number;
  elapsedMs: number;
  errorKind?: string;
}

export interface CompositionErrorPropagationCheck {
  propagated: boolean;
  downstreamExecuted: boolean;
  errorMessage: string;
}

export interface CompositionPipelineGateOutput {
  kind: 'CompositionPipelineGateResult.v1';
  pass: boolean;
  sequence: CompositionSequenceCheck;
  parallel: CompositionParallelCheck;
  timeout: CompositionTimeoutCheck;
  errorPropagation: CompositionErrorPropagationCheck;
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

const DEFAULT_TIMEOUT_MS = 40;
const DEFAULT_SLOW_STEP_DELAY_MS = 120;
const DEFAULT_MAX_DURATION_MS = 180_000;

interface SequenceSeedInput {
  requestId: string;
  prompt: string;
}

interface NormalizedPayload {
  requestId: string;
  normalizedPrompt: string;
  tokenCount: number;
}

interface SequenceSummary {
  requestIdSeen: string;
  summary: string;
}

interface ParallelBranchData {
  requestId: string;
  tokenCount?: number;
  normalizedPrompt?: string;
}

function tokenizePrompt(prompt: string): string[] {
  return prompt
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

function createNormalizeConstruction() {
  return createConstruction<SequenceSeedInput, NormalizedPayload>(
    'composition-gate-normalize',
    'Composition Gate Normalize',
    async (input) => {
      const normalizedPrompt = tokenizePrompt(input.prompt).join(' ').toLowerCase();
      const tokenCount = tokenizePrompt(input.prompt).length;
      return {
        data: {
          requestId: input.requestId,
          normalizedPrompt,
          tokenCount,
        },
        confidence: deterministic(true, 'composition_pipeline_gate:normalize'),
        evidenceRefs: ['composition-pipeline-gate:sequence:normalize'],
      };
    },
  );
}

function createSummarizeConstruction() {
  return createConstruction<ConstructionResult & { data: NormalizedPayload }, SequenceSummary>(
    'composition-gate-summarize',
    'Composition Gate Summarize',
    async (input) => {
      const summary = `request ${input.data.requestId}: ${input.data.normalizedPrompt} [tokens=${input.data.tokenCount}]`;
      return {
        data: {
          requestIdSeen: input.data.requestId,
          summary,
        },
        confidence: deterministic(true, 'composition_pipeline_gate:summarize'),
        evidenceRefs: ['composition-pipeline-gate:sequence:summarize'],
      };
    },
  );
}

function createParallelTokenBranch() {
  return createConstruction<SequenceSeedInput, ParallelBranchData>(
    'composition-gate-token-branch',
    'Composition Gate Token Branch',
    async (input) => ({
      data: {
        requestId: input.requestId,
        tokenCount: tokenizePrompt(input.prompt).length,
      },
      confidence: deterministic(true, 'composition_pipeline_gate:parallel_tokens'),
      evidenceRefs: ['composition-pipeline-gate:parallel:tokens'],
    }),
  );
}

function createParallelPromptBranch() {
  return createConstruction<SequenceSeedInput, ParallelBranchData>(
    'composition-gate-prompt-branch',
    'Composition Gate Prompt Branch',
    async (input) => ({
      data: {
        requestId: input.requestId,
        normalizedPrompt: tokenizePrompt(input.prompt).join(' ').toLowerCase(),
      },
      confidence: deterministic(true, 'composition_pipeline_gate:parallel_prompt'),
      evidenceRefs: ['composition-pipeline-gate:parallel:prompt'],
    }),
  );
}

function createSlowConstruction() {
  return createConstruction<{ delayMs: number }, { completed: true }>(
    'composition-gate-slow',
    'Composition Gate Slow Branch',
    async (input) => {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return {
        data: { completed: true },
        confidence: deterministic(true, 'composition_pipeline_gate:slow'),
        evidenceRefs: ['composition-pipeline-gate:timeout:slow'],
      };
    },
  );
}

function createFailingConstruction() {
  return createConstruction<SequenceSeedInput, { unreachable: true }>(
    'composition-gate-failure',
    'Composition Gate Failure Branch',
    async () => {
      throw new Error('forced-step-failure');
    },
  );
}

function createDownstreamConstruction(track: { executed: boolean }) {
  return createConstruction<ConstructionResult & { data: { unreachable: true } }, { reached: true }>(
    'composition-gate-downstream',
    'Composition Gate Downstream',
    async () => {
      track.executed = true;
      return {
        data: { reached: true },
        confidence: deterministic(true, 'composition_pipeline_gate:downstream'),
        evidenceRefs: ['composition-pipeline-gate:error:downstream'],
      };
    },
  );
}

export function createCompositionPipelineGateConstruction(): Construction<
  CompositionPipelineGateInput,
  CompositionPipelineGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'composition-pipeline-gate',
    name: 'Composition Pipeline Gate',
    description:
      'Composes sequence and parallel constructions to verify data flow, timeout enforcement, coherence, and error propagation.',
    async execute(input: CompositionPipelineGateInput = {}) {
      const startedAt = Date.now();
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const slowStepDelayMs = input.slowStepDelayMs ?? DEFAULT_SLOW_STEP_DELAY_MS;
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const findings: string[] = [];
      const seedInput: SequenceSeedInput = {
        requestId: 'REQ-COMPOSITION-GATE-01',
        prompt: '  Validate Composition Pipeline Gate Signal  ',
      };

      const normalize = createNormalizeConstruction();
      const summarize = createSummarizeConstruction();
      const sequenced = sequence(normalize, summarize);
      const sequenceResult = await sequenced.execute(seedInput);
      const sequenceDataFlowValid = sequenceResult.data.requestIdSeen === seedInput.requestId;
      const sequenceCoherent =
        sequenceResult.data.summary.startsWith(`request ${seedInput.requestId}:`) &&
        sequenceResult.data.summary.includes('validate composition pipeline gate signal') &&
        !sequenceResult.data.summary.includes('unrelated');
      if (!sequenceDataFlowValid) {
        findings.push('Sequence composition did not preserve requestId across step boundaries.');
      }
      if (!sequenceCoherent) {
        findings.push('Sequence composition produced an incoherent final summary.');
      }

      const tokenBranch = createParallelTokenBranch();
      const promptBranch = createParallelPromptBranch();
      const parallelResult = await parallel<
        SequenceSeedInput,
        [
          ConstructionResult & { data: ParallelBranchData },
          ConstructionResult & { data: ParallelBranchData },
        ]
      >([tokenBranch, promptBranch]).execute(seedInput);
      const tokenData = parallelResult.results.find((branch) => typeof branch.data.tokenCount === 'number')?.data;
      const promptData = parallelResult.results.find(
        (branch) => typeof branch.data.normalizedPrompt === 'string',
      )?.data;
      const parallelMetricsAligned = Boolean(
        tokenData &&
        promptData &&
        tokenData.requestId === promptData.requestId &&
        tokenData.requestId === seedInput.requestId,
      );
      const mergedSummary = tokenData && promptData
        ? `${promptData.requestId}:${promptData.normalizedPrompt}:tokens=${tokenData.tokenCount}`
        : 'missing-parallel-branch-data';
      const parallelMergedCoherent = Boolean(
        tokenData &&
        promptData &&
        mergedSummary.includes('validate composition pipeline gate signal') &&
        mergedSummary.includes('tokens=5') &&
        !mergedSummary.includes('unrelated'),
      );
      if (!tokenData || !promptData) {
        findings.push('Parallel composition did not return both expected branch payloads.');
      }
      if (!parallelMetricsAligned) {
        findings.push('Parallel composition branches produced misaligned request identifiers.');
      }
      if (!parallelMergedCoherent) {
        findings.push('Parallel composition merge output is incoherent.');
      }

      const slow = createSlowConstruction();
      const timeoutWrapped = withTimeout(slow, timeoutMs);
      let timeoutEnforced = false;
      let timeoutErrorKind: string | undefined;
      const timeoutStartedAt = Date.now();
      try {
        await timeoutWrapped.execute({ delayMs: slowStepDelayMs });
      } catch (error) {
        if (error instanceof ConstructionTimeoutError) {
          timeoutEnforced = true;
          timeoutErrorKind = error.kind;
        }
      }
      const timeoutElapsedMs = Date.now() - timeoutStartedAt;
      if (!timeoutEnforced) {
        findings.push('Timeout enforcement failed: slow composed step did not time out.');
      }
      if (timeoutElapsedMs > timeoutMs * 4) {
        findings.push(`Timeout enforcement exceeded expected budget: ${timeoutElapsedMs}ms for timeout ${timeoutMs}ms.`);
      }

      const downstreamTracker = { executed: false };
      const failing = createFailingConstruction();
      const downstream = createDownstreamConstruction(downstreamTracker);
      const failingSequence = sequence(failing, downstream);
      let errorPropagated = false;
      let errorMessage = '';
      try {
        await failingSequence.execute(seedInput);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        errorPropagated = errorMessage.includes('forced-step-failure');
      }
      if (!errorPropagated) {
        findings.push('Error propagation failed: sequence did not bubble failure from upstream step.');
      }
      if (downstreamTracker.executed) {
        findings.push('Error propagation failed: downstream step executed after upstream failure.');
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`Composition pipeline gate exceeded duration budget: ${durationMs}ms > ${maxDurationMs}ms.`);
      }

      return ok<CompositionPipelineGateOutput, ConstructionError>({
        kind: 'CompositionPipelineGateResult.v1',
        pass: findings.length === 0,
        sequence: {
          requestId: seedInput.requestId,
          observedRequestId: sequenceResult.data.requestIdSeen,
          dataFlowValid: sequenceDataFlowValid,
          coherent: sequenceCoherent,
          summary: sequenceResult.data.summary,
        },
        parallel: {
          branchCount: parallelResult.results.length,
          metricsAligned: parallelMetricsAligned,
          mergedCoherent: parallelMergedCoherent,
          mergedSummary,
        },
        timeout: {
          enforced: timeoutEnforced,
          timeoutMs,
          elapsedMs: timeoutElapsedMs,
          errorKind: timeoutErrorKind,
        },
        errorPropagation: {
          propagated: errorPropagated,
          downstreamExecuted: downstreamTracker.executed,
          errorMessage,
        },
        findings,
        durationMs,
        maxDurationMs,
      });
    },
  };
}
