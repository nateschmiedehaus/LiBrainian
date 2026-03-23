import path from 'node:path';
import type {
  ContextPack,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import {
  checkDefeaters,
  STANDARD_DEFEATERS,
  type ActivationSummary,
} from '../knowledge/defeater_activation.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const CONFIDENCE_ADJUSTMENT_FLOOR = q(
  0.1,
  [0, 1],
  'Minimum confidence after summary adjustments.'
);

const DEFEATER_BATCH_SIZE = 10;

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

function resolveDefeaterFilePath(pack: ContextPack, workspaceRoot?: string): string | null {
  const candidate = pack.relatedFiles[0];
  if (!candidate) return null;
  const normalized = candidate.replace(/\\/g, '/').trim();
  if (!normalized) return null;
  if (!workspaceRoot) {
    return path.isAbsolute(normalized) ? null : normalized;
  }
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return null;
  return relative;
}

export async function runDefeaterStage(options: {
  storage: LibrarianStorage;
  finalPacks: ContextPack[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  workspaceRoot: string;
  checkDefeatersFn?: typeof checkDefeaters;
}): Promise<ContextPack[]> {
  const { storage, finalPacks: initialPacks, stageTracker, recordCoverageGap, workspaceRoot, checkDefeatersFn } = options;
  const defeaterStage = stageTracker.start('defeater_check', initialPacks.length);
  const defeaterInputCount = initialPacks.length;
  const defeaterResults: Map<string, ActivationSummary> = new Map();
  const failedPacks = new Set<string>();
  const runDefeaters = checkDefeatersFn ?? checkDefeaters;
  let missingPathCount = 0;
  let firstFailureMessage: string | null = null;

  for (let i = 0; i < initialPacks.length; i += DEFEATER_BATCH_SIZE) {
    const chunk = initialPacks.slice(i, i + DEFEATER_BATCH_SIZE);
    const chunkResults = await Promise.allSettled(chunk.map(async (pack) => {
      const meta = {
        confidence: { overall: pack.confidence, bySection: {} as Record<string, number> },
        evidence: [] as Array<{
          type: 'code' | 'test' | 'commit' | 'comment' | 'usage' | 'doc' | 'inferred';
          source: string;
          description: string;
          confidence: number;
        }>,
        generatedAt: pack.createdAt.toISOString(),
        generatedBy: 'librarian',
        defeaters: [STANDARD_DEFEATERS.codeChange, STANDARD_DEFEATERS.testFailure],
      };
      const filePath = resolveDefeaterFilePath(pack, workspaceRoot);
      if (!filePath) missingPathCount += 1;
      const result = await runDefeaters(meta, {
        entityId: pack.targetId,
        filePath: filePath ?? undefined,
        storage,
        workspaceRoot,
      });
      return { packId: pack.packId, result };
    }));

    for (let index = 0; index < chunkResults.length; index += 1) {
      const outcome = chunkResults[index];
      const pack = chunk[index];
      if (outcome.status === 'fulfilled') {
        const { result } = outcome.value;
        if (result.activeDefeaters > 0 || result.confidenceAdjustment !== 0 || !result.knowledgeValid) {
          defeaterResults.set(outcome.value.packId, result);
        }
      } else {
        failedPacks.add(pack.packId);
        if (!firstFailureMessage) {
          const reason = outcome.reason;
          firstFailureMessage = reason instanceof Error ? reason.message : String(reason);
        }
      }
    }
  }

  if (missingPathCount > 0) {
    recordCoverageGap(
      'defeater_check',
      `Skipped code-change checks for ${missingPathCount} pack(s) without valid file paths.`,
      'minor'
    );
  }
  if (failedPacks.size > 0) {
    const detail = firstFailureMessage ? ` (${firstFailureMessage})` : '';
    recordCoverageGap(
      'defeater_check',
      `Defeater checks failed for ${failedPacks.size} pack(s); excluding them from results.${detail}`,
      'significant'
    );
  }

  const finalPacks: ContextPack[] = [];
  for (const pack of initialPacks) {
    if (failedPacks.has(pack.packId)) {
      continue;
    }
    const summary = defeaterResults.get(pack.packId);
    if (!summary) {
      finalPacks.push(pack);
      continue;
    }
    if (!summary.knowledgeValid) {
      recordCoverageGap(
        'defeater_check',
        `Filtered stale pack for ${pack.targetId} (${summary.results.find((r) => r.activated)?.reason ?? 'code changed'})`,
        'moderate'
      );
      continue;
    }
    const adjustedConfidence = Math.max(
      CONFIDENCE_ADJUSTMENT_FLOOR,
      pack.confidence + summary.confidenceAdjustment
    );
    if (adjustedConfidence !== pack.confidence) {
      finalPacks.push({ ...pack, confidence: adjustedConfidence });
    } else {
      finalPacks.push(pack);
    }
  }
  stageTracker.finish(defeaterStage, {
    outputCount: finalPacks.length,
    filteredCount: Math.max(0, defeaterInputCount - finalPacks.length),
  });
  return finalPacks;
}
