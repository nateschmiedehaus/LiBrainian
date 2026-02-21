import type { LiBrainianStorage } from '../storage/types.js';
import type { ClaimId } from '../epistemics/types.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import type { CalibrationReportSnapshot } from '../epistemics/calibration.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

export type ClaimOutcomeResult = 'correct' | 'incorrect' | 'partial' | 'unknown';
export type ClaimOutcomeVerification =
  | 'human'
  | 'automated_test'
  | 'downstream_success'
  | 'system_observation';

export interface TrackedClaimRecord {
  id: string;
  claimRef?: ClaimId;
  claim: string;
  claimType: string;
  category?: string;
  contextHash: string;
  statedConfidence: ConfidenceValue;
  createdAt: string;
  subjectId?: string;
  subjectType?: string;
  source?: string;
  ledgerEntryId?: string;
}

export interface ClaimOutcomeRecord {
  id: string;
  claimId: string;
  outcome: ClaimOutcomeResult;
  verifiedBy: ClaimOutcomeVerification;
  observation: string;
  observedAt: string;
  recordedAt: string;
  traceId?: string;
  ledgerEntryId?: string;
}

type OutcomeState = {
  schema_version: 1;
  updatedAt: string;
  claims: TrackedClaimRecord[];
  outcomes: ClaimOutcomeRecord[];
};

const OUTCOME_STATE_KEY = 'librarian.claim_outcomes.v1';

type OutcomeCalibrationState = {
  schema_version: 1;
  updatedAt: string;
  reports: CalibrationReportSnapshot[];
};

const OUTCOME_CALIBRATION_KEY = 'librarian.claim_outcome_calibration.v1';

export async function listTrackedClaims(storage: LiBrainianStorage): Promise<TrackedClaimRecord[]> {
  const state = await loadOutcomeState(storage);
  return state.claims.map((item) => ({ ...item }));
}

export async function getTrackedClaim(
  storage: LiBrainianStorage,
  id: string
): Promise<TrackedClaimRecord | null> {
  const state = await loadOutcomeState(storage);
  const found = state.claims.find((item) => item.id === id);
  return found ? { ...found } : null;
}

export async function recordTrackedClaim(
  storage: LiBrainianStorage,
  record: TrackedClaimRecord,
  options: { maxClaims?: number } = {}
): Promise<TrackedClaimRecord> {
  const state = await loadOutcomeState(storage);
  const existing = state.claims.find((item) => item.id === record.id);
  if (existing) return { ...existing };

  const nextClaims = [...state.claims, { ...record }];
  const maxClaims = options.maxClaims;
  const trimmedClaims =
    typeof maxClaims === 'number' && maxClaims > 0 && nextClaims.length > maxClaims
      ? nextClaims.slice(nextClaims.length - maxClaims)
      : nextClaims;

  await writeOutcomeState(storage, {
    ...state,
    claims: trimmedClaims,
  });

  return { ...record };
}

export async function listOutcomeCalibrationReports(
  storage: LiBrainianStorage,
  options: { limit?: number } = {}
): Promise<CalibrationReportSnapshot[]> {
  const state = await loadOutcomeCalibrationState(storage);
  const sorted = [...state.reports].sort((a, b) => Date.parse(b.computedAt) - Date.parse(a.computedAt));
  const limit = options.limit;
  const sliced = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
  return sliced.map((item) => ({ ...item }));
}

export async function recordOutcomeCalibrationReport(
  storage: LiBrainianStorage,
  report: CalibrationReportSnapshot,
  options: { maxReports?: number } = {}
): Promise<CalibrationReportSnapshot> {
  const state = await loadOutcomeCalibrationState(storage);
  const existing = state.reports.find((item) => item.id === report.id);
  if (existing) return { ...existing };

  const nextReports = [...state.reports, { ...report }];
  const maxReports = options.maxReports;
  const trimmedReports =
    typeof maxReports === 'number' && maxReports > 0 && nextReports.length > maxReports
      ? nextReports.slice(nextReports.length - maxReports)
      : nextReports;

  await writeOutcomeCalibrationState(storage, {
    ...state,
    reports: trimmedReports,
  });

  return { ...report };
}

export async function listClaimOutcomes(
  storage: LiBrainianStorage,
  options: { claimId?: string; limit?: number } = {}
): Promise<ClaimOutcomeRecord[]> {
  const state = await loadOutcomeState(storage);
  const filtered = typeof options.claimId === 'string'
    ? state.outcomes.filter((item) => item.claimId === options.claimId)
    : state.outcomes;
  const sorted = filtered.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const limit = options.limit;
  const sliced = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
  return sliced.map((item) => ({ ...item }));
}

export async function recordClaimOutcome(
  storage: LiBrainianStorage,
  record: ClaimOutcomeRecord,
  options: { maxOutcomes?: number } = {}
): Promise<ClaimOutcomeRecord> {
  const state = await loadOutcomeState(storage);
  const existing = state.outcomes.find((item) => item.id === record.id);
  if (existing) return { ...existing };

  const nextOutcomes = [...state.outcomes, { ...record }];
  const maxOutcomes = options.maxOutcomes;
  const trimmedOutcomes =
    typeof maxOutcomes === 'number' && maxOutcomes > 0 && nextOutcomes.length > maxOutcomes
      ? nextOutcomes.slice(nextOutcomes.length - maxOutcomes)
      : nextOutcomes;

  await writeOutcomeState(storage, {
    ...state,
    outcomes: trimmedOutcomes,
  });

  return { ...record };
}

async function loadOutcomeState(storage: LiBrainianStorage): Promise<OutcomeState> {
  const raw = await storage.getState(OUTCOME_STATE_KEY);
  if (!raw) {
    return {
      schema_version: 1,
      updatedAt: new Date().toISOString(),
      claims: [],
      outcomes: [],
    };
  }
  const parsed = safeJsonParseSimple<OutcomeState>(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      schema_version: 1,
      updatedAt: new Date().toISOString(),
      claims: [],
      outcomes: [],
    };
  }
  return {
    schema_version: 1,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    claims: Array.isArray(parsed.claims) ? parsed.claims.map((item) => ({ ...item })) : [],
    outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.map((item) => ({ ...item })) : [],
  };
}

async function writeOutcomeState(storage: LiBrainianStorage, state: OutcomeState): Promise<void> {
  const payload: OutcomeState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    claims: state.claims,
    outcomes: state.outcomes,
  };
  await storage.setState(OUTCOME_STATE_KEY, JSON.stringify(payload));
}

async function loadOutcomeCalibrationState(storage: LiBrainianStorage): Promise<OutcomeCalibrationState> {
  const raw = await storage.getState(OUTCOME_CALIBRATION_KEY);
  if (!raw) {
    return {
      schema_version: 1,
      updatedAt: new Date().toISOString(),
      reports: [],
    };
  }
  const parsed = safeJsonParseSimple<OutcomeCalibrationState>(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      schema_version: 1,
      updatedAt: new Date().toISOString(),
      reports: [],
    };
  }
  return {
    schema_version: 1,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    reports: Array.isArray(parsed.reports) ? parsed.reports.map((item) => ({ ...item })) : [],
  };
}

async function writeOutcomeCalibrationState(
  storage: LiBrainianStorage,
  state: OutcomeCalibrationState
): Promise<void> {
  const payload: OutcomeCalibrationState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    reports: state.reports,
  };
  await storage.setState(OUTCOME_CALIBRATION_KEY, JSON.stringify(payload));
}
