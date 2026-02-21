/**
 * @fileoverview Claim-outcome tracking for calibration (Track F C1).
 *
 * Records claim predictions with confidence and later outcomes for
 * calibration analysis. Stores append-only state plus ledger evidence.
 */

import { randomUUID } from 'node:crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { ConfidenceAdjustmentResult, ConfidenceValue } from './confidence.js';
import { adjustConfidenceValue, deterministic, getNumericValue } from './confidence.js';
import type { ClaimId } from './types.js';
import type { EvidenceEntry, EvidenceId, IEvidenceLedger, OutcomeEvidence } from './evidence_ledger.js';
import {
  recordTrackedClaim,
  recordClaimOutcome,
  listClaimOutcomes,
  listTrackedClaims,
  getTrackedClaim,
  listOutcomeCalibrationReports,
  recordOutcomeCalibrationReport,
  type TrackedClaimRecord,
  type ClaimOutcomeRecord,
  type ClaimOutcomeResult,
  type ClaimOutcomeVerification,
} from '../state/outcomes.js';
import { computeChecksum16 } from '../utils/checksums.js';
import {
  buildCalibrationReport,
  computeCalibrationCurve,
  snapshotCalibrationReport,
  restoreCalibrationReport,
  type CalibrationAdjustmentOptions,
  type CalibrationReport,
  type CalibrationReportSnapshot,
  type CalibrationSample,
} from './calibration.js';

export type ClaimOutcomeCategory =
  | 'existence'
  | 'relationship'
  | 'behavior'
  | 'quality'
  | 'recommendation';

export interface TrackClaimInput {
  claim: string;
  claimType: string;
  statedConfidence: ConfidenceValue;
  context?: string | Record<string, unknown> | Array<unknown>;
  contextHash?: string;
  subjectId?: string;
  subjectType?: EvidenceSubjectType;
  source?: string;
  category?: ClaimOutcomeCategory;
  supportingEvidence?: string[];
  knownDefeaters?: string[];
  claimRef?: ClaimId;
  id?: string;
  createdAt?: Date;
}

export interface RecordOutcomeInput {
  claimId: string;
  outcome: ClaimOutcomeResult;
  verifiedBy: ClaimOutcomeVerification;
  observation: string;
  observedAt?: Date;
  traceId?: string;
  id?: string;
}

export interface ClaimOutcomeTrackerConfig {
  ledger?: IEvidenceLedger;
  maxClaims?: number;
  maxOutcomes?: number;
  maxCalibrationReports?: number;
}

type EvidenceSubjectType = 'file' | 'function' | 'class' | 'pattern' | 'system';

export class ClaimOutcomeTracker {
  constructor(
    private storage: LiBrainianStorage,
    private config: ClaimOutcomeTrackerConfig = {}
  ) {}

  async recordClaim(input: TrackClaimInput): Promise<{ record: TrackedClaimRecord; ledgerEntry?: EvidenceEntry }> {
    const contextHash = resolveContextHash(input.contextHash, input.context);
    const claimId = input.id ?? `claim_${randomUUID()}`;
    const createdAt = input.createdAt ?? new Date();

    let ledgerEntry: EvidenceEntry | undefined;
    if (this.config.ledger) {
      ledgerEntry = await this.config.ledger.append({
        kind: 'claim',
        payload: {
          claim: input.claim,
          category: input.category ?? 'behavior',
          subject: {
            type: coerceSubjectType(input.subjectType),
            identifier: input.subjectId ?? 'claim_outcome',
          },
          supportingEvidence: coerceEvidenceIds(input.supportingEvidence),
          knownDefeaters: coerceEvidenceIds(input.knownDefeaters),
          confidence: input.statedConfidence,
        },
        provenance: {
          source: 'system_observation',
          method: input.source ?? 'claim_outcome_tracking',
        },
        relatedEntries: [],
        confidence: input.statedConfidence,
      });
    }

    const record: TrackedClaimRecord = {
      id: claimId,
      claimRef: input.claimRef,
      claim: input.claim,
      claimType: input.claimType,
      category: input.category,
      contextHash,
      statedConfidence: input.statedConfidence,
      createdAt: createdAt.toISOString(),
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      source: input.source,
      ledgerEntryId: ledgerEntry?.id,
    };

    const stored = await recordTrackedClaim(this.storage, record, {
      maxClaims: this.config.maxClaims,
    });

    return { record: stored, ledgerEntry };
  }

  async recordOutcome(input: RecordOutcomeInput): Promise<{ record: ClaimOutcomeRecord; ledgerEntry?: EvidenceEntry }> {
    const tracked = await getTrackedClaim(this.storage, input.claimId);
    if (!tracked) {
      throw new Error('unverified_by_trace(claim_outcome_missing_claim)');
    }

    const observedAt = input.observedAt ?? new Date();
    const recordedAt = new Date();

    let ledgerEntry: EvidenceEntry | undefined;
    if (this.config.ledger) {
      ledgerEntry = await this.config.ledger.append({
        kind: 'outcome',
        payload: {
          predictionId: coerceEvidenceId(tracked.ledgerEntryId ?? tracked.id),
          predicted: {
            claim: tracked.claim,
            confidence: tracked.statedConfidence,
          },
          actual: {
            outcome: input.outcome,
            observation: input.observation,
          },
          verificationMethod: mapVerificationMethod(input.verifiedBy),
        } satisfies OutcomeEvidence,
        provenance: {
          source: 'system_observation',
          method: input.verifiedBy,
        },
        relatedEntries: tracked.ledgerEntryId ? [coerceEvidenceId(tracked.ledgerEntryId)] : [],
        confidence: deterministic(true, 'observed_outcome'),
      });
    }

    const record: ClaimOutcomeRecord = {
      id: input.id ?? `outcome_${randomUUID()}`,
      claimId: tracked.id,
      outcome: input.outcome,
      verifiedBy: input.verifiedBy,
      observation: input.observation,
      observedAt: observedAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
      traceId: input.traceId,
      ledgerEntryId: ledgerEntry?.id,
    };

    const stored = await recordClaimOutcome(this.storage, record, {
      maxOutcomes: this.config.maxOutcomes,
    });

    return { record: stored, ledgerEntry };
  }

  async listClaims(): Promise<TrackedClaimRecord[]> {
    return listTrackedClaims(this.storage);
  }

  async listOutcomes(claimId?: string): Promise<ClaimOutcomeRecord[]> {
    return listClaimOutcomes(this.storage, { claimId });
  }

  async getClaim(id: string): Promise<TrackedClaimRecord | null> {
    return getTrackedClaim(this.storage, id);
  }

  async computeCalibrationReport(
    options: OutcomeCalibrationOptions = {}
  ): Promise<{ report: CalibrationReport; snapshot: CalibrationReportSnapshot }> {
    const claims = await listTrackedClaims(this.storage);
    const outcomes = await listClaimOutcomes(this.storage);
    const samples = buildCalibrationSamples(claims, outcomes, options);

    const curve = computeCalibrationCurve(samples, {
      bucketCount: options.bucketCount,
    });

    const datasetId = options.datasetId ?? `claim_outcomes_${new Date().toISOString()}`;
    const report = buildCalibrationReport(datasetId, curve);
    const snapshot = snapshotCalibrationReport(report, {
      id: options.id ?? `calibration_${randomUUID()}`,
      bucketCount: options.bucketCount ?? 10,
      claimType: options.claimType,
      category: options.category,
    });

    await recordOutcomeCalibrationReport(this.storage, snapshot, {
      maxReports: this.config.maxCalibrationReports,
    });

    return { report, snapshot };
  }

  async adjustConfidence(
    confidence: ConfidenceValue,
    options: OutcomeCalibrationOptions & CalibrationAdjustmentOptions = {}
  ): Promise<ConfidenceAdjustmentResult> {
    const { report } = await this.computeCalibrationReport(options);
    return adjustConfidenceValue(confidence, report, options);
  }

  async listCalibrationReports(limit?: number): Promise<CalibrationReport[]> {
    const snapshots = await listOutcomeCalibrationReports(this.storage, { limit });
    return snapshots.map((snapshot) => restoreCalibrationReport(snapshot));
  }
}

export function createClaimOutcomeTracker(
  storage: LiBrainianStorage,
  config: ClaimOutcomeTrackerConfig = {}
): ClaimOutcomeTracker {
  return new ClaimOutcomeTracker(storage, config);
}

export interface OutcomeCalibrationOptions {
  bucketCount?: number;
  datasetId?: string;
  claimType?: string;
  category?: ClaimOutcomeCategory;
  includePartial?: boolean;
  includeUnknown?: boolean;
  id?: string;
}

function resolveContextHash(contextHash: string | undefined, context: TrackClaimInput['context']): string {
  if (typeof contextHash === 'string' && contextHash.trim()) return contextHash;
  if (context === undefined) return computeChecksum16('');
  if (typeof context === 'string') return computeChecksum16(context);
  try {
    return computeChecksum16(JSON.stringify(context));
  } catch {
    return computeChecksum16(String(context));
  }
}

function buildCalibrationSamples(
  claims: TrackedClaimRecord[],
  outcomes: ClaimOutcomeRecord[],
  options: OutcomeCalibrationOptions
): CalibrationSample[] {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const latestOutcomes = selectLatestOutcomes(outcomes);

  const samples: CalibrationSample[] = [];
  for (const outcome of latestOutcomes.values()) {
    const claim = claimById.get(outcome.claimId);
    if (!claim) continue;
    if (options.claimType && claim.claimType !== options.claimType) continue;
    if (options.category && claim.category !== options.category) continue;

    const confidence = getNumericValue(claim.statedConfidence);
    if (confidence === null) continue;

    const outcomeScore = mapOutcomeToScore(outcome.outcome, options);
    if (outcomeScore === null) continue;

    samples.push({ confidence, outcome: outcomeScore });
  }

  return samples;
}

function selectLatestOutcomes(outcomes: ClaimOutcomeRecord[]): Map<string, ClaimOutcomeRecord> {
  const latest = new Map<string, ClaimOutcomeRecord>();
  for (const outcome of outcomes) {
    const existing = latest.get(outcome.claimId);
    if (!existing) {
      latest.set(outcome.claimId, outcome);
      continue;
    }
    const currentTime = Date.parse(outcome.recordedAt);
    const existingTime = Date.parse(existing.recordedAt);
    if (currentTime >= existingTime) {
      latest.set(outcome.claimId, outcome);
    }
  }
  return latest;
}

function mapOutcomeToScore(
  outcome: ClaimOutcomeResult,
  options: OutcomeCalibrationOptions
): number | null {
  switch (outcome) {
    case 'correct':
      return 1;
    case 'incorrect':
      return 0;
    case 'partial':
      if (options.includePartial === false) return null;
      return 0.5;
    case 'unknown':
      if (options.includeUnknown) return 0.5;
      return null;
    default:
      return null;
  }
}

function coerceSubjectType(subjectType: EvidenceSubjectType | undefined): EvidenceSubjectType {
  if (!subjectType) return 'system';
  if (subjectType === 'file' || subjectType === 'function' || subjectType === 'class' || subjectType === 'pattern') {
    return subjectType;
  }
  return 'system';
}

function mapVerificationMethod(method: ClaimOutcomeVerification): OutcomeEvidence['verificationMethod'] {
  switch (method) {
    case 'human':
      return 'user_feedback';
    case 'automated_test':
      return 'test_result';
    case 'downstream_success':
      return 'system_observation';
    case 'system_observation':
      return 'system_observation';
    default:
      return 'system_observation';
  }
}

function coerceEvidenceId(id: string): EvidenceId {
  return id as EvidenceId;
}

function coerceEvidenceIds(ids?: string[]): EvidenceId[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === 'string' && id.length > 0).map((id) => id as EvidenceId);
}
