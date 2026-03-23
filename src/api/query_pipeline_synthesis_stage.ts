import type {
  ContextPack,
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
  SynthesisMode,
  SynthesizedResponse,
} from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { resolveWorkspaceRoot } from './query_retrieval_observability.js';
import {
  canAnswerFromSummaries,
  canFallbackToQuickAnswerOnSynthesisFailure,
  createQuickAnswer,
  synthesizeQueryAnswer,
} from './query_synthesis.js';
import { extractReferencedFilePath } from './query_intent_targets.js';
import type { StageTracker } from './query_stage_reporting.js';

const DEFAULT_SYNTHESIS_STAGE_TIMEOUT_MS = 60_000;

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export interface SynthesisStageResult {
  synthesis?: SynthesizedResponse;
  synthesisMode?: SynthesisMode;
  llmError?: string;
}

type WorkspaceResolutionLike = string | { workspace?: string | null } | null | undefined;

function parsePositiveTimeoutValue(raw: string | undefined): number | null {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveStageTimeoutMs(options: {
  explicitMs?: number;
  queryTimeoutMs?: number;
  envVars?: Array<string | undefined>;
  fallbackMs: number;
}): number {
  const explicit = Number.isFinite(options.explicitMs ?? Number.NaN) && (options.explicitMs ?? 0) > 0
    ? Math.floor(options.explicitMs as number)
    : null;
  const envValue = (options.envVars ?? [])
    .map(parsePositiveTimeoutValue)
    .find((value): value is number => value !== null);
  const fallback = explicit ?? envValue ?? options.fallbackMs;
  const queryBudget = Number.isFinite(options.queryTimeoutMs ?? Number.NaN) && (options.queryTimeoutMs ?? 0) > 0
    ? Math.floor(options.queryTimeoutMs as number)
    : null;
  const bounded = queryBudget ? Math.min(fallback, queryBudget) : fallback;
  return Math.max(1, bounded);
}

export function resolveProviderCallTimeoutMs(stageTimeoutMs: number): number {
  const boundedStageTimeout = Number.isFinite(stageTimeoutMs) && stageTimeoutMs > 0
    ? Math.floor(stageTimeoutMs)
    : DEFAULT_SYNTHESIS_STAGE_TIMEOUT_MS;
  return Math.max(1_000, boundedStageTimeout - 250);
}

export async function withStageTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run();
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    run()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function stripTracePrefix(message: string): string {
  const stripped = message.replace(/unverified_by_trace\([^)]+\):\s*/g, '').trim();
  const firstLine = stripped.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  const compact = firstLine.replace(/\s+/g, ' ').trim();
  if (compact.length <= 220) return compact;
  return `${compact.slice(0, 217)}...`;
}

export async function runSynthesisStage(options: {
  query: LibrarianQuery;
  storage: LibrarianStorage;
  finalPacks: ContextPack[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  explanationParts: string[];
  synthesisEnabled: boolean;
  preferQuickSynthesis?: boolean;
  synthesisTimeoutMs?: number;
  workspaceRoot?: string;
  resolveWorkspaceRootFn?: (storage: LibrarianStorage) => Promise<WorkspaceResolutionLike> | WorkspaceResolutionLike;
  canAnswerFromSummariesFn?: typeof canAnswerFromSummaries;
  createQuickAnswerFn?: typeof createQuickAnswer;
  synthesizeQueryAnswerFn?: typeof synthesizeQueryAnswer;
}): Promise<SynthesisStageResult> {
  const {
    query,
    storage,
    finalPacks,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    synthesisEnabled,
    preferQuickSynthesis,
    synthesisTimeoutMs,
    workspaceRoot,
    resolveWorkspaceRootFn,
    canAnswerFromSummariesFn,
    createQuickAnswerFn,
    synthesizeQueryAnswerFn,
  } = options;
  const resolveWorkspace = resolveWorkspaceRootFn
    ?? ((storageLike: LibrarianStorage) => resolveWorkspaceRoot(storageLike));
  const shouldQuickAnswer = canAnswerFromSummariesFn ?? canAnswerFromSummaries;
  const buildQuickAnswer = createQuickAnswerFn ?? createQuickAnswer;
  const synthesizeAnswer = synthesizeQueryAnswerFn ?? synthesizeQueryAnswer;
  let synthesis: SynthesizedResponse | undefined;
  let synthesisMode: SynthesisMode | undefined = synthesisEnabled
    ? undefined
    : (finalPacks.length > 0 ? 'heuristic' : undefined);
  let llmError: string | undefined;
  const applyQuickFallback = (reason: string): boolean => {
    if (!canFallbackToQuickAnswerOnSynthesisFailure(query, finalPacks)) {
      return false;
    }
    try {
      const quickAnswer = buildQuickAnswer(query, finalPacks);
      synthesis = {
        answer: quickAnswer.answer,
        confidence: quickAnswer.confidence,
        citations: quickAnswer.citations,
        keyInsights: quickAnswer.keyInsights,
        uncertainties: quickAnswer.uncertainties,
      };
      synthesisMode = 'heuristic';
      explanationParts.push(`Quick synthesis from pack summaries after ${reason}.`);
      return true;
    } catch {
      return false;
    }
  };
  const synthesisStage = stageTracker.start('synthesis', synthesisEnabled && query.intent && finalPacks.length > 0 ? 1 : 0);
  if (synthesisEnabled && query.intent && finalPacks.length > 0) {
    const resolvedWorkspace = workspaceRoot?.trim().length
      ? workspaceRoot
      : await resolveWorkspace(storage);
    const resolvedWorkspaceRoot = coerceWorkspacePath(resolvedWorkspace);
    if (!resolvedWorkspaceRoot || !resolvedWorkspaceRoot.trim()) {
      recordCoverageGap('synthesis', 'Workspace root unavailable; skipping synthesis.', 'moderate');
      stageTracker.finish(synthesisStage, { outputCount: 0, filteredCount: 0, status: 'failed' });
      return { synthesis: undefined, synthesisMode: 'heuristic', llmError };
    }
    try {
      const forceSummarySynthesis = query.forceSummarySynthesis === true;
      const shouldPreferQuickSynthesis = preferQuickSynthesis === true;
      if (forceSummarySynthesis || shouldPreferQuickSynthesis || shouldQuickAnswer(query, finalPacks)) {
        try {
          const quickAnswer = buildQuickAnswer(query, finalPacks);
          synthesis = {
            answer: quickAnswer.answer,
            confidence: quickAnswer.confidence,
            citations: quickAnswer.citations,
            keyInsights: quickAnswer.keyInsights,
            uncertainties: quickAnswer.uncertainties,
          };
          synthesisMode = 'heuristic';
          explanationParts.push(
            shouldPreferQuickSynthesis && !forceSummarySynthesis
              ? 'Quick synthesis from pack summaries due to degraded retrieval state.'
              : 'Quick synthesis from pack summaries.'
          );
        } catch (quickError) {
          if (!(forceSummarySynthesis || shouldPreferQuickSynthesis)) {
            throw quickError;
          }
          const topPack = finalPacks
            .slice()
            .sort((left, right) => right.confidence - left.confidence)[0];
          const summary = topPack?.summary?.trim().length
            ? topPack.summary.trim()
            : `Relevant context available for ${topPack?.targetId ?? 'this query'}.`;
          synthesis = {
            answer: summary,
            confidence: Math.min(0.6, Math.max(0.2, topPack?.confidence ?? 0.3)),
            citations: topPack
              ? [{
                  packId: topPack.packId,
                  content: summary,
                  relevance: Math.max(0.3, Math.min(1, topPack.confidence)),
                  file: topPack.relatedFiles[0],
                }]
              : [],
            keyInsights: topPack?.keyFacts?.slice(0, 3) ?? [],
            uncertainties: ['Answer synthesized from retrieved context summaries (forced quick mode).'],
          };
          synthesisMode = 'heuristic';
          explanationParts.push('Forced quick synthesis from top retrieved context.');
        }
      } else {
        const timeoutMs = resolveStageTimeoutMs({
          explicitMs: synthesisTimeoutMs,
          queryTimeoutMs: query.timeoutMs,
          envVars: [
            process.env.LIBRARIAN_QUERY_SYNTHESIS_TIMEOUT_MS,
            process.env.LIBRAINIAN_QUERY_SYNTHESIS_TIMEOUT_MS,
          ],
          fallbackMs: DEFAULT_SYNTHESIS_STAGE_TIMEOUT_MS,
        });
        const llmTimeoutMs = resolveProviderCallTimeoutMs(timeoutMs);
        const synthesisResult = await withStageTimeout(
          () => synthesizeAnswer({
            query,
            packs: finalPacks,
            storage,
            workspace: resolvedWorkspaceRoot,
            llmTimeoutMs,
          }),
          timeoutMs,
          `query synthesis timed out after ${timeoutMs}ms`,
        );

        if (synthesisResult.synthesized) {
          synthesis = {
            answer: synthesisResult.answer,
            confidence: synthesisResult.confidence,
            citations: synthesisResult.citations,
            keyInsights: synthesisResult.keyInsights,
            uncertainties: synthesisResult.uncertainties,
          };
          synthesisMode = 'llm';
          explanationParts.push('LLM-synthesized understanding from retrieved knowledge.');
        } else {
          const reason = 'reason' in synthesisResult ? synthesisResult.reason : 'unverified_by_trace(synthesis_unavailable)';
          recordCoverageGap('synthesis', `Synthesis unavailable: ${reason}`, 'moderate');
          synthesisMode = 'heuristic';
          if (query.showLlmErrors !== false) {
            llmError = stripTracePrefix(reason);
          }
          applyQuickFallback('LLM synthesis was unavailable');
        }
      }
    } catch (synthesisError) {
      const message = synthesisError instanceof Error ? synthesisError.message : String(synthesisError);
      const sanitized = stripTracePrefix(message);
      recordCoverageGap('synthesis', `Synthesis failed: ${sanitized}`, 'moderate');
      synthesisMode = 'heuristic';
      if (query.showLlmErrors !== false) {
        llmError = sanitized;
      }
      applyQuickFallback('LLM synthesis failed');
    }
  }
  if (!synthesisMode && finalPacks.length > 0 && !synthesis) {
    synthesisMode = 'heuristic';
  }
  stageTracker.finish(synthesisStage, { outputCount: synthesis ? 1 : 0, filteredCount: 0 });
  return { synthesis, synthesisMode, llmError };
}

function coerceWorkspacePath(value: WorkspaceResolutionLike): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.workspace === 'string') {
    return value.workspace.trim();
  }
  return '';
}

export function applyAdequacyToSynthesis(
  synthesis: SynthesizedResponse | undefined,
  adequacyReport: {
    missingEvidence: Array<{ description: string }>;
    blocking: boolean;
  } | null,
): SynthesizedResponse | undefined {
  if (!synthesis || !adequacyReport) return synthesis;
  if (adequacyReport.missingEvidence.length === 0) return synthesis;
  const missing = adequacyReport.missingEvidence.map((req) => req.description).join('; ');
  const notice = `unverified_by_trace(adequacy_missing): ${missing}`;
  const updated = {
    ...synthesis,
    uncertainties: [...synthesis.uncertainties, notice],
  };
  if (adequacyReport.blocking) {
    updated.confidence = Math.min(updated.confidence, 0.35);
  }
  return updated;
}

export function applyHeuristicSynthesisGuardrail(options: {
  synthesis: SynthesizedResponse | undefined;
  synthesisMode: SynthesisMode | undefined;
  queryIntent?: string;
  finalPacks: ContextPack[];
  coherenceAnalysis: {
    overallCoherence: number;
    explanation: string;
  };
  lowRelevanceTriggered: boolean;
  lowRelevanceReason?: string;
}): SynthesizedResponse | undefined {
  const {
    synthesis,
    synthesisMode,
    queryIntent,
    finalPacks,
    coherenceAnalysis,
    lowRelevanceTriggered,
    lowRelevanceReason,
  } = options;
  if (!synthesis || synthesisMode !== 'heuristic') return synthesis;

  const lowCoherence = coherenceAnalysis.overallCoherence < 0.4;
  if (!lowCoherence && !lowRelevanceTriggered) return synthesis;

  const candidateFiles = Array.from(new Set(
    finalPacks.flatMap((pack) => pack.relatedFiles).filter((file) => file && file.trim().length > 0),
  )).slice(0, 3);
  const targetLabel = queryIntent?.trim().length ? `"${queryIntent.trim()}"` : 'this query';
  const fileGuidance = candidateFiles.length > 0
    ? `Inspect ${candidateFiles.join(', ')} directly`
    : 'Inspect the top retrieved files directly';
  const uncertainties = [...synthesis.uncertainties];
  if (lowCoherence) {
    uncertainties.push(`Heuristic answer guardrail applied: ${coherenceAnalysis.explanation}`);
  }
  if (lowRelevanceTriggered && lowRelevanceReason) {
    uncertainties.push(`Heuristic answer guardrail applied: ${lowRelevanceReason}`);
  }

  if (!lowRelevanceTriggered && shouldPreserveAnchoredPlanningHeuristic(queryIntent, synthesis.answer, finalPacks)) {
    return {
      ...synthesis,
      confidence: Math.min(synthesis.confidence, 0.55),
      uncertainties,
    };
  }

  return {
    ...synthesis,
    answer: `Results are too scattered to answer ${targetLabel} confidently from heuristic retrieval alone. ${fileGuidance}.`,
    confidence: Math.min(synthesis.confidence, 0.35),
    keyInsights: candidateFiles.map((file) => `Candidate file: ${file}`),
    uncertainties,
  };
}

function shouldPreserveAnchoredPlanningHeuristic(
  queryIntent: string | undefined,
  answer: string,
  finalPacks: ContextPack[],
): boolean {
  const intent = queryIntent?.trim() ?? '';
  if (!intent || !answer.trim()) return false;
  if (!isAnchoredImplementationPlanningIntent(intent)) return false;

  const referencedFile = extractReferencedFilePath(intent);
  if (!referencedFile) return false;
  const normalizedReference = referencedFile.replace(/\\/g, '/').trim();
  const basename = normalizedReference.split('/').pop() ?? normalizedReference;
  const normalizedAnswer = answer.toLowerCase();

  const answerMentionsAnchor =
    normalizedAnswer.includes(normalizedReference.toLowerCase())
    || normalizedAnswer.includes(basename.toLowerCase());
  if (!answerMentionsAnchor) return false;

  return finalPacks.some((pack) =>
    (pack.relatedFiles ?? []).some((file) =>
      file === normalizedReference
      || file.endsWith(`/${normalizedReference}`)
      || file.endsWith(`/${basename}`)
    ),
  );
}

export function isAnchoredImplementationPlanningIntent(intent: string): boolean {
  if (isTestTargetingPlanningIntent(intent)) return false;
  return /\bwhat\s+should\s+(?:i|we)\s+touch\b/i.test(intent)
    || /\bsplit\b.*\binto\b.*\b(seams?|layers?|stages?|phases?|modules?)\b/i.test(intent)
    || /\bextract\b.*\binto\b.*\b(seams?|layers?|stages?|phases?|modules?)\b/i.test(intent)
    || /\b(refactor|decompose|separate)\b.*\b(seams?|layers?|stages?|phases?|modules?)\b/i.test(intent)
    || (/\b(routing|retrieval|synthesis)\b/i.test(intent) && /\b(split|seams?|extract|separate)\b/i.test(intent));
}

export function isTestTargetingPlanningIntent(intent: string): boolean {
  const normalized = intent.toLowerCase();
  return /\btests?\b/.test(normalized)
    && /\b(what\s+tests?\s+should|which\s+tests?\s+should|update|change|touch|edit|cover|exercise)\b/.test(normalized);
}

export function shouldSkipSemanticRetrievalForAnchoredPlanning(
  query: LibrarianQuery,
  directPacks: ContextPack[],
): boolean {
  const intent = query.intent?.trim() ?? '';
  if (!intent || directPacks.length === 0) return false;
  if (!isAnchoredImplementationPlanningIntent(intent)) return false;

  const referencedFile = extractReferencedFilePath(intent);
  if (!referencedFile) return false;
  const normalizedReference = referencedFile.replace(/\\/g, '/').trim();
  const basename = normalizedReference.split('/').pop() ?? normalizedReference;
  const hasPathAnchor = normalizedReference.includes('/');
  const seamSignals = Array.from(new Set(
    ['routing', 'retrieval', 'synthesis', 'seam', 'seams', 'orchestration', 'pipeline']
      .filter((token) => new RegExp(`\\b${token}\\b`, 'i').test(intent)),
  ));

  return directPacks.some((pack) => {
    const candidateFiles = [
      pack.targetId,
      ...(pack.relatedFiles ?? []),
      ...(pack.codeSnippets ?? []).map((snippet) => snippet.filePath),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.replace(/\\/g, '/').trim());
    const text = [
      pack.targetId,
      pack.summary,
      ...(pack.keyFacts ?? []),
      ...(pack.relatedFiles ?? []),
      ...(pack.codeSnippets ?? []).map((snippet) => snippet.filePath),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase();

    const exactAnchorMatch = hasPathAnchor && candidateFiles.some((file) =>
      file === normalizedReference || file.endsWith(`/${normalizedReference}`),
    );
    if (exactAnchorMatch) {
      return true;
    }

    const basenameMatch = candidateFiles.some((file) =>
      file === basename || file.endsWith(`/${basename}`),
    );
    if (!basenameMatch) {
      return false;
    }

    return seamSignals.length === 0 || seamSignals.some((signal) => text.includes(signal));
  });
}

export function shouldUseAnchoredPlanningDirectMode(query: LibrarianQuery): boolean {
  const intent = query.intent?.trim() ?? '';
  if (!intent) return false;
  if (!isAnchoredImplementationPlanningIntent(intent)) return false;
  return Boolean(extractReferencedFilePath(intent));
}
