import { absent, getNumericValue } from '../epistemics/confidence.js';
import type {
  EvidenceEntry,
  EvidenceFilter,
  FeedbackEvidence,
  IEvidenceLedger,
  OutcomeEvidence,
  VerificationEvidence,
} from '../epistemics/evidence_ledger.js';
import { getRelatedIds } from '../epistemics/evidence_ledger.js';
import { sha256Hex } from '../spine/hashes.js';
import type { LiBrainianStorage } from '../storage/types.js';
import type { CodeSnippet, ContextPack, LibrarianVersion } from '../types.js';
import { ConstructionError } from './base/construction_base.js';
import type { ConstructionResult } from './base/construction_base.js';
import type { ConstructionCalibrationTracker, VerificationMethod } from './calibration_tracker.js';
import { generatePredictionId } from './calibration_tracker.js';
import type {
  Construction,
  ConstructionOutcome,
  Context,
} from './types.js';
import { fail, isConstructionOutcome, ok } from './types.js';

type LedgerOutcomeEventType = 'outcome' | 'feedback' | 'verification';

export interface ImmediateConstructionOutcome {
  readonly correct: boolean;
  readonly method: VerificationMethod;
}

export interface CalibratedOptions<O extends ConstructionResult> {
  readonly immediateOutcomeExtractor?: (output: O) => ImmediateConstructionOutcome | null;
  readonly ledger?: IEvidenceLedger;
  readonly outcomeEventTypes?: readonly LedgerOutcomeEventType[];
  readonly minPredictionsForCalibration?: number;
}

type PendingLedgerOutcome = {
  readonly predictionId: string;
  readonly evidenceRefs: Set<string>;
};

const DEFAULT_SEEDING_THRESHOLD = 0.8;
const DEFAULT_MAX_PACKS_PER_SESSION = 100;
const SEEDED_PACK_VERSION = '0.0.0';

export interface ContextPackSeedingOptions<I> {
  readonly minConfidenceThreshold?: number;
  readonly intentExtractor?: (input: I) => string;
  readonly scopeExtractor?: (input: I) => string;
  readonly maxPacksPerSession?: number;
  readonly includeResultValue?: boolean;
  readonly packType?: ContextPack['packType'];
}

export interface ContextPackSeedingMetadata {
  readonly packsSeeded: string[];
  readonly fromContextPack: boolean;
}

function toOutcome<O, E extends ConstructionError>(
  execution: ConstructionOutcome<O, E>
): ConstructionOutcome<O, E> {
  return isConstructionOutcome<O, E>(execution) ? execution : ok<O, E>(execution as O);
}

function normalizeFailure(error: unknown, constructionId: string): ConstructionError {
  if (error instanceof ConstructionError) {
    return error;
  }
  if (error instanceof Error) {
    return new ConstructionError(error.message, constructionId, error);
  }
  return new ConstructionError(`Non-error construction failure: ${String(error)}`, constructionId);
}

function normalizeVerificationMethod(method: string): VerificationMethod {
  if (method === 'user_feedback' || method === 'test_result' || method === 'system_observation') {
    return method;
  }
  return 'system_observation';
}

function tryRecordOutcome(
  tracker: ConstructionCalibrationTracker,
  predictionId: string,
  correct: boolean,
  verificationMethod: VerificationMethod,
): void {
  try {
    tracker.recordOutcome(predictionId, correct, verificationMethod);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already recorded')) {
      return;
    }
    throw error;
  }
}

function hasEvidenceReference(entry: EvidenceEntry, evidenceRefs: Set<string>): boolean {
  if (evidenceRefs.size === 0) {
    return false;
  }
  const related = getRelatedIds(entry);
  return related.some((id) => evidenceRefs.has(id));
}

function extractOutcomeFromLedgerEntry(
  entry: EvidenceEntry,
  pending: PendingLedgerOutcome
): ImmediateConstructionOutcome | null {
  if (entry.kind === 'outcome') {
    const payload = entry.payload as OutcomeEvidence;
    const payloadPredictionId = String(payload.predictionId);
    const matchesPrediction = payloadPredictionId === pending.predictionId;
    const matchesEvidenceRefs = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!matchesPrediction && !matchesEvidenceRefs) {
      return null;
    }
    if (payload.actual.outcome === 'correct') {
      return {
        correct: true,
        method: normalizeVerificationMethod(payload.verificationMethod),
      };
    }
    if (payload.actual.outcome === 'incorrect') {
      return {
        correct: false,
        method: normalizeVerificationMethod(payload.verificationMethod),
      };
    }
    return null;
  }

  if (entry.kind === 'feedback') {
    const payload = entry.payload as FeedbackEvidence;
    const targetMatches = pending.evidenceRefs.has(String(payload.targetId));
    const relatedMatches = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!targetMatches && !relatedMatches) {
      return null;
    }
    if (payload.feedbackType === 'correct' || payload.feedbackType === 'helpful') {
      return { correct: true, method: 'user_feedback' };
    }
    if (
      payload.feedbackType === 'incorrect'
      || payload.feedbackType === 'unhelpful'
      || payload.feedbackType === 'unclear'
    ) {
      return { correct: false, method: 'user_feedback' };
    }
    return null;
  }

  if (entry.kind === 'verification') {
    const payload = entry.payload as VerificationEvidence;
    const claimIdMatches = pending.evidenceRefs.has(String(payload.claimId));
    const relatedMatches = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!claimIdMatches && !relatedMatches) {
      return null;
    }
    if (payload.result === 'verified') {
      return { correct: true, method: 'system_observation' };
    }
    if (payload.result === 'refuted') {
      return { correct: false, method: 'system_observation' };
    }
    return null;
  }

  return null;
}

function createCalibratedConfidence(
  constructionId: string,
  calibratedValue: number,
  sampleCount: number
): ConstructionResult['confidence'] {
  const low = Math.max(0, calibratedValue - 0.05);
  const high = Math.min(1, calibratedValue + 0.05);
  return {
    type: 'measured',
    value: calibratedValue,
    measurement: {
      datasetId: `construction:${constructionId}`,
      sampleSize: sampleCount,
      accuracy: calibratedValue,
      confidenceInterval: [low, high] as const,
      measuredAt: new Date().toISOString(),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArrayField(record: Record<string, unknown> | null, key: string): string[] {
  if (!record) return [];
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function isCodeSnippet(value: unknown): value is CodeSnippet {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.filePath === 'string'
    && typeof record.startLine === 'number'
    && typeof record.endLine === 'number'
    && typeof record.content === 'string'
    && typeof record.language === 'string'
  );
}

function readCodeSnippets(record: Record<string, unknown> | null): CodeSnippet[] {
  if (!record) return [];
  const value = record.codeSnippets;
  if (!Array.isArray(value)) return [];
  return value.filter(isCodeSnippet);
}

function inferIntentType<I>(constructionId: string, input: I): string {
  const record = asRecord(input);
  const explicit = readStringField(record, 'intentType');
  if (explicit) return explicit;
  return constructionId.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'unknown_intent';
}

function inferScope<I>(input: I): string {
  const record = asRecord(input);
  const explicit = readStringField(record, 'scope');
  if (explicit) return explicit;
  const filePath = readStringField(record, 'filePath');
  if (filePath) return filePath;
  const files = readStringArrayField(record, 'relatedFiles');
  if (files.length > 0) return files[0];
  return 'global';
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function createSeededPackVersion(now: Date): LibrarianVersion {
  return {
    major: 0,
    minor: 0,
    patch: 0,
    string: SEEDED_PACK_VERSION,
    qualityTier: 'full',
    indexedAt: now,
    indexerVersion: 'seeded_from_construction',
    features: ['context_pack_seeding'],
  };
}

function buildSeededContextPack<I, O extends ConstructionResult>(
  constructionId: string,
  input: I,
  output: O,
  intentType: string,
  scope: string,
  sessionId: string,
  options: ContextPackSeedingOptions<I>
): ContextPack {
  const now = new Date();
  const outputRecord = asRecord(output);
  const summary = readStringField(outputRecord, 'summary')
    ?? `Seeded context for ${intentType} within ${scope}`;
  const findings = readStringArrayField(outputRecord, 'findings');
  const keyFactsBase = findings.length > 0
    ? findings
    : output.evidenceRefs.map((ref) => `evidence:${ref}`);
  const includeResultValue = options.includeResultValue ?? true;
  const keyFacts = includeResultValue
    ? [`result_keys:${Object.keys(outputRecord ?? {}).sort().join(',')}`, ...keyFactsBase]
    : keyFactsBase;
  const codeSnippets = readCodeSnippets(outputRecord);
  const relatedFiles = readStringArrayField(outputRecord, 'relatedFiles');
  const invalidationTriggers = relatedFiles.length > 0 ? relatedFiles : [scope];
  const confidenceValue = getNumericValue(output.confidence) ?? 0;
  const tokenEstimate = estimateTokens(
    [summary, ...keyFacts, ...codeSnippets.map((snippet) => snippet.content)].join('\n')
  );
  const targetId = `${intentType}:${scope}`;
  const packId = `seeded_${sha256Hex(`${constructionId}:${targetId}:${JSON.stringify(input)}`).slice(0, 24)}`;

  return {
    packId,
    packType: options.packType ?? 'pattern_context',
    targetId,
    intentType,
    scope,
    provenance: 'seeded_from_construction',
    tokenEstimate,
    sourceConstructionId: constructionId,
    sessionId,
    schemaVersion: 1,
    summary,
    keyFacts,
    codeSnippets,
    relatedFiles,
    confidence: confidenceValue,
    createdAt: now,
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: createSeededPackVersion(now),
    invalidationTriggers,
  };
}

/**
 * Wrap a construction with automatic prediction/outcome calibration wiring.
 */
export function calibrated<I, O extends ConstructionResult, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  tracker: ConstructionCalibrationTracker,
  options: CalibratedOptions<O> = {}
): Construction<I, O, E, R> {
  const minPredictions = Math.max(1, options.minPredictionsForCalibration ?? 20);
  const outcomeEventTypes = options.outcomeEventTypes ?? ['outcome', 'feedback', 'verification'];
  const pendingByPrediction = new Map<string, PendingLedgerOutcome>();
  let subscribed = false;

  const ensureLedgerSubscription = (): void => {
    if (subscribed || !options.ledger) {
      return;
    }
    const filter: EvidenceFilter = {
      kinds: [...outcomeEventTypes],
    };
    options.ledger.subscribe(filter, (entry: EvidenceEntry) => {
      for (const pending of pendingByPrediction.values()) {
        const outcome = extractOutcomeFromLedgerEntry(entry, pending);
        if (!outcome) {
          continue;
        }
        tryRecordOutcome(tracker, pending.predictionId, outcome.correct, outcome.method);
        pendingByPrediction.delete(pending.predictionId);
      }
    });
    subscribed = true;
  };

  return {
    ...construction,
    id: `calibrated(${construction.id})`,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O, E>> {
      const predictionId = generatePredictionId(construction.id);
      let outcome: ConstructionOutcome<O, E>;

      try {
        const execution = await construction.execute(input, context);
        outcome = toOutcome<O, E>(execution);
      } catch (error) {
        const normalized = normalizeFailure(error, construction.id) as E;
        tracker.recordPrediction(
          construction.id,
          predictionId,
          absent('insufficient_data'),
          `Execution failed before producing result: ${construction.id}`,
          {
            reason: normalized.message,
            phase: 'execution_failure',
          }
        );
        tryRecordOutcome(tracker, predictionId, false, 'system_observation');
        return fail<O, E>(normalized, undefined, construction.id);
      }

      if (!outcome.ok) {
        tracker.recordPrediction(
          construction.id,
          predictionId,
          absent('insufficient_data'),
          `Execution returned failure outcome: ${construction.id}`,
          {
            reason: outcome.error.message,
            phase: 'construction_failure_outcome',
          }
        );
        tryRecordOutcome(tracker, predictionId, false, 'system_observation');
        return fail<O, E>(outcome.error, outcome.partial, outcome.errorAt ?? construction.id);
      }

      const resultWithPrediction: O = {
        ...outcome.value,
        predictionId,
      };

      tracker.recordPrediction(
        construction.id,
        predictionId,
        resultWithPrediction.confidence,
        `${construction.name} execution`,
        {
          sessionId: context?.sessionId,
          constructionId: construction.id,
        }
      );

      const rawConfidence = getNumericValue(resultWithPrediction.confidence);
      if (rawConfidence !== null) {
        const calibratedValue = tracker.getCalibratedConfidence(
          construction.id,
          rawConfidence,
          minPredictions,
        );
        if (calibratedValue !== null) {
          const report = tracker.getCalibrationReport(construction.id, { minSamples: minPredictions });
          resultWithPrediction.confidence = createCalibratedConfidence(
            construction.id,
            calibratedValue,
            report.sampleCount,
          );
        }
      }

      if (options.immediateOutcomeExtractor) {
        const immediate = options.immediateOutcomeExtractor(resultWithPrediction);
        if (immediate) {
          tryRecordOutcome(tracker, predictionId, immediate.correct, immediate.method);
        }
      }

      if (options.ledger) {
        ensureLedgerSubscription();
        pendingByPrediction.set(predictionId, {
          predictionId,
          evidenceRefs: new Set(resultWithPrediction.evidenceRefs.map((entry) => String(entry))),
        });
      }

      return ok<O, E>(resultWithPrediction);
    },
  };
}

/**
 * Wrap a construction and seed context packs from high-confidence outcomes.
 */
export function withContextPackSeeding<
  I,
  O extends ConstructionResult,
  E extends ConstructionError = ConstructionError,
  R = unknown,
>(
  construction: Construction<I, O, E, R>,
  storage: LiBrainianStorage,
  options: ContextPackSeedingOptions<I> = {}
): Construction<I, O & ContextPackSeedingMetadata, E, R> {
  const threshold = options.minConfidenceThreshold ?? DEFAULT_SEEDING_THRESHOLD;
  const maxPacksPerSession = Math.max(1, options.maxPacksPerSession ?? DEFAULT_MAX_PACKS_PER_SESSION);
  const seededCountBySession = new Map<string, number>();

  return {
    id: `withContextPackSeeding(${construction.id})`,
    name: construction.name,
    description: construction.description,
    getEstimatedConfidence: construction.getEstimatedConfidence,
    whyFailed: construction.whyFailed,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O & ContextPackSeedingMetadata, E>> {
      const intentType = (options.intentExtractor ? options.intentExtractor(input) : inferIntentType(construction.id, input)).trim();
      const scope = (options.scopeExtractor ? options.scopeExtractor(input) : inferScope(input)).trim();

      let fromContextPack = false;
      if (intentType.length > 0 && scope.length > 0) {
        const existing = await storage.findByIntentAndScope(intentType, scope, { limit: 1 });
        fromContextPack = existing.length > 0;
      }

      const execution = await construction.execute(input, context);
      const outcome = toOutcome<O, E>(execution);
      if (!outcome.ok) {
        return outcome as ConstructionOutcome<O & ContextPackSeedingMetadata, E>;
      }

      if (fromContextPack) {
        return ok<O & ContextPackSeedingMetadata, E>({
          ...outcome.value,
          packsSeeded: [],
          fromContextPack: true,
        });
      }

      const confidenceValue = getNumericValue(outcome.value.confidence);
      if (confidenceValue === null || confidenceValue < threshold || intentType.length === 0 || scope.length === 0) {
        return ok<O & ContextPackSeedingMetadata, E>({
          ...outcome.value,
          packsSeeded: [],
          fromContextPack: false,
        });
      }

      const sessionId = context?.sessionId ?? 'anonymous';
      const sessionSeedCount = seededCountBySession.get(sessionId) ?? 0;
      if (sessionSeedCount >= maxPacksPerSession) {
        return ok<O & ContextPackSeedingMetadata, E>({
          ...outcome.value,
          packsSeeded: [],
          fromContextPack: false,
        });
      }

      const existingAfterExecution = await storage.findByIntentAndScope(intentType, scope, { limit: 1 });
      if (existingAfterExecution.length > 0) {
        return ok<O & ContextPackSeedingMetadata, E>({
          ...outcome.value,
          packsSeeded: [],
          fromContextPack: true,
        });
      }

      const seededPack = buildSeededContextPack(
        construction.id,
        input,
        outcome.value,
        intentType,
        scope,
        sessionId,
        options,
      );
      await storage.upsertContextPack(seededPack);
      seededCountBySession.set(sessionId, sessionSeedCount + 1);

      return ok<O & ContextPackSeedingMetadata, E>({
        ...outcome.value,
        packsSeeded: [seededPack.packId],
        fromContextPack: false,
      });
    },
  };
}
