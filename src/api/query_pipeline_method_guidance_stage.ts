import type { LibrarianQuery, StageIssueSeverity, StageName } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { resolveMethodGuidance } from '../methods/method_guidance.js';
import { resolveLibrarianModelConfigWithDiscovery } from './llm_env.js';
import type { GovernorContext } from './governor_context.js';
import type { StageTracker } from './query_stage_reporting.js';
import {
  resolveProviderCallTimeoutMs,
  resolveStageTimeoutMs,
  withStageTimeout,
} from './query_pipeline_synthesis_stage.js';

const DEFAULT_METHOD_GUIDANCE_STAGE_TIMEOUT_MS = 10_000;

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export async function runMethodGuidanceStage(options: {
  query: LibrarianQuery;
  storage: LibrarianStorage;
  governor: GovernorContext;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  synthesisEnabled: boolean;
  methodGuidanceTimeoutMs?: number;
  resolveMethodGuidanceFn?: typeof resolveMethodGuidance;
  resolveLlmConfig?: typeof resolveLibrarianModelConfigWithDiscovery;
}): Promise<Awaited<ReturnType<typeof resolveMethodGuidance>> | null> {
  const {
    query,
    storage,
    governor,
    stageTracker,
    recordCoverageGap,
    synthesisEnabled,
    methodGuidanceTimeoutMs,
    resolveMethodGuidanceFn,
    resolveLlmConfig,
  } = options;
  const resolveGuidance = resolveMethodGuidanceFn ?? resolveMethodGuidance;
  const readLlmConfig = resolveLlmConfig ?? resolveLibrarianModelConfigWithDiscovery;
  let methodGuidance: Awaited<ReturnType<typeof resolveMethodGuidance>> | null = null;
  const methodGuidanceEnabled = synthesisEnabled && query.disableMethodGuidance !== true;
  const methodGuidanceStage = stageTracker.start('method_guidance', methodGuidanceEnabled ? 1 : 0);
  if (methodGuidanceEnabled) {
    try {
      const llmConfig = await readLlmConfig();
      if (llmConfig.provider?.trim() && llmConfig.modelId?.trim()) {
        const timeoutMs = resolveStageTimeoutMs({
          explicitMs: methodGuidanceTimeoutMs,
          queryTimeoutMs: query.timeoutMs,
          envVars: [
            process.env.LIBRARIAN_QUERY_METHOD_GUIDANCE_TIMEOUT_MS,
            process.env.LIBRAINIAN_QUERY_METHOD_GUIDANCE_TIMEOUT_MS,
          ],
          fallbackMs: DEFAULT_METHOD_GUIDANCE_STAGE_TIMEOUT_MS,
        });
        const llmTimeoutMs = resolveProviderCallTimeoutMs(timeoutMs);
        methodGuidance = await withStageTimeout(
          () => resolveGuidance({
            ucIds: query.ucRequirements?.ucIds,
            taskType: query.taskType,
            intent: query.intent,
            storage,
            llmProvider: llmConfig.provider,
            llmModelId: llmConfig.modelId,
            llmTimeoutMs,
            governorContext: governor,
          }),
          timeoutMs,
          `method guidance timed out after ${timeoutMs}ms`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('method_guidance', message, 'minor');
    }
  }
  const methodGuidanceOutput = methodGuidance?.hints.length ?? 0;
  const methodGuidanceStatus =
    methodGuidanceStage.inputCount > 0 && methodGuidanceOutput === 0 && methodGuidanceStage.issues.length > 0
      ? 'partial'
      : undefined;
  stageTracker.finish(methodGuidanceStage, {
    outputCount: methodGuidanceOutput,
    filteredCount: 0,
    status: methodGuidanceStatus,
  });
  return methodGuidance;
}
