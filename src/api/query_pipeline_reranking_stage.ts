import type {
  ContextPack,
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import { applyMmrDiversification } from './query_mmr_utils.js';
import { resolveQueryDepthProfile, resolveRerankWindow } from './query_depth_profile.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const CROSS_ENCODER_BI_WEIGHT = q(0.4, [0, 1], 'Bi-encoder weight for hybrid rerank.');
const CROSS_ENCODER_CROSS_WEIGHT = q(0.6, [0, 1], 'Cross-encoder weight for hybrid rerank.');

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export async function runRerankStage(options: {
  query: LibrarianQuery;
  finalPacks: ContextPack[];
  candidateScoreMap: Map<string, number>;
  stageTracker: StageTracker;
  explanationParts: string[];
  recordCoverageGap: RecordCoverageGap;
  rerank?: typeof maybeRerankWithCrossEncoder;
  forceRerank?: boolean;
}): Promise<ContextPack[]> {
  const {
    query,
    finalPacks,
    candidateScoreMap,
    stageTracker,
    explanationParts,
    recordCoverageGap,
    rerank,
    forceRerank,
  } = options;
  const rerankRunner = rerank ?? maybeRerankWithCrossEncoder;
  const depthProfile = resolveQueryDepthProfile(query.depth);
  const rerankWindow = resolveRerankWindow(query.depth);
  const rerankInputCount = Math.min(finalPacks.length, rerankWindow);
  const rerankInput = rerankInputCount > 0 ? finalPacks.slice(0, rerankInputCount) : [];
  const rerankTail = rerankInputCount < finalPacks.length ? finalPacks.slice(rerankInputCount) : [];
  const mmrEligible = query.diversify === true && finalPacks.length >= 2;
  const deterministicRerankDisabled = query.deterministic === true;
  const rerankEligible =
    Boolean(query.intent) &&
    rerankInput.length >= 2 &&
    !deterministicRerankDisabled &&
    (forceRerank || isCrossEncoderEnabled());
  const inferSkipReason = (): string => {
    if (!query.intent) return 'missing_intent';
    if (rerankInput.length < 2) {
      if (rerankWindow <= 0) return 'depth_profile_disabled';
      return 'insufficient_candidates';
    }
    if (deterministicRerankDisabled) return 'deterministic_mode_disabled';
    if (!(forceRerank || isCrossEncoderEnabled())) return 'cross_encoder_disabled';
    return 'not_applicable';
  };
  const skipReasonMessages: Record<string, string> = {
    missing_intent: 'query intent is missing',
    depth_profile_disabled: 'depth profile disables cross-encoder rerank',
    insufficient_candidates: 'insufficient candidates for reranking',
    deterministic_mode_disabled: 'deterministic mode disables cross-encoder rerank',
    cross_encoder_disabled: 'cross-encoder is disabled',
    invalid_output: 'cross-encoder produced invalid output',
    invalid_pack_ids: 'cross-encoder returned invalid pack IDs',
    mismatched_packs: 'cross-encoder returned mismatched packs',
    rerank_error: 'cross-encoder failed at runtime',
  };
  const rerankStageInputCount = rerankEligible
    ? rerankInput.length
    : (mmrEligible ? finalPacks.length : 0);
  const rerankStage = stageTracker.start('reranking', rerankStageInputCount);
  if (!rerankEligible) {
    const reason = inferSkipReason();
    const humanReason = skipReasonMessages[reason] ?? reason;
    explanationParts.push(`Skipped cross-encoder rerank: ${humanReason}.`);
  } else if (rerankInput.length < finalPacks.length) {
    explanationParts.push(`Bounded rerank window to top ${rerankInput.length} packs for depth ${depthProfile}.`);
  }
  const applyMmr = (packs: ContextPack[]): ContextPack[] => applyMmrDiversification({
    packs,
    query,
    candidateScoreMap,
    explanationParts,
    recordCoverageGap,
  });
  if (rerankEligible) {
    try {
      const reranked = await rerankRunner(
        query,
        rerankInput,
        candidateScoreMap,
        explanationParts,
        recordCoverageGap
      );
      if (!Array.isArray(reranked) || reranked.length === 0 || reranked.length !== rerankInput.length) {
        explanationParts.push('Cross-encoder rerank fallback: invalid output shape; preserved original order.');
        recordCoverageGap('reranking', 'Cross-encoder rerank produced invalid output; using original order.', 'minor');
        stageTracker.finish(rerankStage, {
          outputCount: finalPacks.length,
          filteredCount: 0,
          status: 'partial',
          telemetry: {
            rerankWindow,
            rerankInputCount: rerankInput.length,
            rerankAppliedCount: 0,
            rerankSkipReason: 'invalid_output',
          },
        });
        return applyMmr(finalPacks);
      }
      const outputIds = reranked.map((pack) => pack?.packId);
      if (outputIds.some((id) => !id)) {
        explanationParts.push('Cross-encoder rerank fallback: invalid pack identifiers; preserved original order.');
        recordCoverageGap('reranking', 'Cross-encoder rerank returned invalid pack IDs; using original order.', 'minor');
        stageTracker.finish(rerankStage, {
          outputCount: finalPacks.length,
          filteredCount: 0,
          status: 'partial',
          telemetry: {
            rerankWindow,
            rerankInputCount: rerankInput.length,
            rerankAppliedCount: 0,
            rerankSkipReason: 'invalid_pack_ids',
          },
        });
        return applyMmr(finalPacks);
      }
      const normalizedOutputIds = outputIds as string[];
      const inputIds = new Set(rerankInput.map((pack) => pack.packId));
      const outputIdSet = new Set(normalizedOutputIds);
      if (outputIdSet.size !== normalizedOutputIds.length || outputIdSet.size !== inputIds.size) {
        explanationParts.push('Cross-encoder rerank fallback: mismatched rerank set; preserved original order.');
        recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
        stageTracker.finish(rerankStage, {
          outputCount: finalPacks.length,
          filteredCount: 0,
          status: 'partial',
          telemetry: {
            rerankWindow,
            rerankInputCount: rerankInput.length,
            rerankAppliedCount: 0,
            rerankSkipReason: 'mismatched_packs',
          },
        });
        return applyMmr(finalPacks);
      }
      for (const id of inputIds) {
        if (!outputIdSet.has(id)) {
          explanationParts.push('Cross-encoder rerank fallback: missing reranked candidates; preserved original order.');
          recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
          stageTracker.finish(rerankStage, {
            outputCount: finalPacks.length,
            filteredCount: 0,
            status: 'partial',
            telemetry: {
              rerankWindow,
              rerankInputCount: rerankInput.length,
              rerankAppliedCount: 0,
              rerankSkipReason: 'mismatched_packs',
            },
          });
          return applyMmr(finalPacks);
        }
      }
      const merged = rerankTail.length ? [...reranked, ...rerankTail] : reranked;
      stageTracker.finish(rerankStage, {
        outputCount: merged.length,
        filteredCount: 0,
        telemetry: {
          rerankWindow,
          rerankInputCount: rerankInput.length,
          rerankAppliedCount: reranked.length,
        },
      });
      return applyMmr(merged);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      explanationParts.push(`Cross-encoder rerank fallback: ${message}; preserved original order.`);
      recordCoverageGap('reranking', `Cross-encoder rerank failed: ${message}`, 'minor');
      stageTracker.finish(rerankStage, {
        outputCount: finalPacks.length,
        filteredCount: 0,
        status: 'failed',
        telemetry: {
          rerankWindow,
          rerankInputCount: rerankInput.length,
          rerankAppliedCount: 0,
          rerankSkipReason: 'rerank_error',
        },
      });
      return applyMmr(finalPacks);
    }
  }
  if (mmrEligible) {
    stageTracker.finish(rerankStage, {
      outputCount: finalPacks.length,
      filteredCount: 0,
      telemetry: {
        rerankWindow,
        rerankInputCount: rerankInput.length,
        rerankAppliedCount: 0,
        rerankSkipReason: inferSkipReason(),
      },
    });
    return applyMmr(finalPacks);
  }
  stageTracker.finish(rerankStage, {
    outputCount: finalPacks.length,
    filteredCount: 0,
    status: 'skipped',
    telemetry: {
      rerankWindow,
      rerankInputCount: rerankInput.length,
      rerankAppliedCount: 0,
      rerankSkipReason: inferSkipReason(),
    },
  });
  return finalPacks;
}

async function maybeRerankWithCrossEncoder(
  query: LibrarianQuery,
  packs: ContextPack[],
  scoreByTarget: Map<string, number>,
  explanationParts: string[],
  recordCoverageGap: RecordCoverageGap
): Promise<ContextPack[]> {
  if (!query.intent || packs.length < 2) return packs;
  if (query.coldStartStructuralOnly) {
    explanationParts.push('Skipped cross-encoder rerank during cold-start structural-only retrieval.');
    return packs;
  }
  if (query.depth === 'L0') return packs;
  if (!isCrossEncoderEnabled()) return packs;

  const rerankTop = Math.min(packs.length, resolveRerankWindow(query.depth));
  if (rerankTop < 2) return packs;
  const rerankSlice = packs.slice(0, rerankTop);
  const inputs = rerankSlice.map((pack) => ({
    document: buildCrossEncoderDocument(pack),
    biEncoderScore: scoreByTarget.get(pack.targetId) ?? pack.confidence,
  }));

  try {
    const { hybridRerank } = await import('./embedding_providers/cross_encoder_reranker.js');
    const reranked = await hybridRerank(query.intent, inputs, {
      topK: rerankTop,
      returnTopN: rerankTop,
      biEncoderWeight: CROSS_ENCODER_BI_WEIGHT,
      crossEncoderWeight: CROSS_ENCODER_CROSS_WEIGHT,
    });
    const reordered = reranked.map((entry) => rerankSlice[entry.index]).filter(Boolean);
    if (reordered.length === rerankSlice.length) {
      explanationParts.push(`Re-ranked top ${rerankTop} packs with cross-encoder.`);
      return [...reordered, ...packs.slice(rerankTop)];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCoverageGap('reranking', `Cross-encoder rerank unavailable (${message}).`, 'minor');
  }

  return packs;
}

function buildCrossEncoderDocument(pack: ContextPack): string {
  const parts = [
    `Type: ${pack.packType}`,
    pack.summary,
    pack.keyFacts.slice(0, 6).join(' | '),
    pack.relatedFiles.length ? `Files: ${pack.relatedFiles.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean);
  const joined = parts.join('\n');
  return joined.length > 1200 ? joined.slice(0, 1200) : joined;
}

function isCrossEncoderEnabled(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true' || process.env.LIBRARIAN_DETERMINISTIC === '1') {
    return false;
  }
  const flag = process.env.LIBRARIAN_CROSS_ENCODER?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';
}
