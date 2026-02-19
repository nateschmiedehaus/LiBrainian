/**
 * @fileoverview OpenClaw calibration feedback bridge.
 *
 * Maps OpenClaw coding-agent outcome signals onto stage calibration outcomes.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getStagePredictionCounts,
  recordStageOutcome,
} from '../api/stage_calibration.js';
import type { VerificationMethod } from '../constructions/calibration_tracker.js';

export type OpenclawOutcomeMethod =
  | 'test_execution'
  | 'user_acceptance'
  | 'user_correction'
  | 'unknown';

export interface OpenclawOutcomeSignal {
  method: OpenclawOutcomeMethod;
  correct: boolean | null;
  confidence: 'high' | 'medium' | 'low';
  sourceText: string;
}

export interface SharedCalibrationSnapshot {
  workspaceId: string;
  updatedAt: string;
  byStage: Record<string, { total: number; withOutcome: number }>;
}

const sessionPredictions = new Map<string, Set<string>>();

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function classifyOpenclawOutcomeSignal(text: string): OpenclawOutcomeSignal {
  const normalized = normalize(text);

  if (
    /tests?\s+passed|all tests passed|\b\d+\s*\/\s*\d+\s+passed/.test(normalized)
  ) {
    return {
      method: 'test_execution',
      correct: true,
      confidence: 'high',
      sourceText: text,
    };
  }

  if (
    /tests?\s+failed|failing tests|failed\s*\(\d+\s*\/\s*\d+/.test(normalized)
  ) {
    return {
      method: 'test_execution',
      correct: false,
      confidence: 'high',
      sourceText: text,
    };
  }

  if (
    /\blgtm\b|looks good|ship it|approved|thanks[,! ]+works|great[,! ]+thanks|done/.test(normalized)
  ) {
    return {
      method: 'user_acceptance',
      correct: true,
      confidence: 'medium',
      sourceText: text,
    };
  }

  if (
    /not right|try again|this breaks|that's wrong|doesn'?t handle|you forgot|regression|still failing/.test(normalized)
  ) {
    return {
      method: 'user_correction',
      correct: false,
      confidence: 'high',
      sourceText: text,
    };
  }

  return {
    method: 'unknown',
    correct: null,
    confidence: 'low',
    sourceText: text,
  };
}

function toVerificationMethod(method: OpenclawOutcomeMethod): VerificationMethod {
  switch (method) {
    case 'test_execution':
      return 'test_result';
    case 'user_acceptance':
    case 'user_correction':
      return 'user_feedback';
    default:
      return 'system_observation';
  }
}

export function registerOpenclawSessionPredictions(
  sessionId: string,
  predictionIds: string[],
): void {
  if (!sessionId || predictionIds.length === 0) return;
  const set = sessionPredictions.get(sessionId) ?? new Set<string>();
  for (const predictionId of predictionIds) {
    if (predictionId.trim().length > 0) {
      set.add(predictionId);
    }
  }
  sessionPredictions.set(sessionId, set);
}

export function applyOpenclawOutcomeSignal(
  predictionIds: string[],
  signal: OpenclawOutcomeSignal,
): number {
  if (signal.correct === null || signal.method === 'unknown') return 0;
  let recorded = 0;
  const verificationMethod = toVerificationMethod(signal.method);
  for (const predictionId of predictionIds) {
    try {
      recordStageOutcome(predictionId, signal.correct, verificationMethod, signal.sourceText);
      recorded += 1;
    } catch {
      // Keep processing remaining predictions; this bridge is best-effort.
    }
  }
  return recorded;
}

export function ingestOpenclawSessionEvent(
  sessionId: string,
  text: string,
): { recorded: number; signal: OpenclawOutcomeSignal } {
  const signal = classifyOpenclawOutcomeSignal(text);
  const ids = Array.from(sessionPredictions.get(sessionId) ?? []);
  const recorded = applyOpenclawOutcomeSignal(ids, signal);
  if (recorded > 0 && signal.correct !== null) {
    sessionPredictions.delete(sessionId);
  }
  return { recorded, signal };
}

export function clearOpenclawSessionPredictions(): void {
  sessionPredictions.clear();
}

export class SharedCalibrationStore {
  readonly workspaceId: string;
  readonly calibrationPath: string;

  constructor(workspaceId: string, calibrationPath?: string) {
    this.workspaceId = workspaceId;
    this.calibrationPath = calibrationPath
      ?? path.join(os.homedir(), '.librainian', 'calibration', `${workspaceId}.json`);
  }

  async load(): Promise<SharedCalibrationSnapshot> {
    try {
      const raw = await fs.readFile(this.calibrationPath, 'utf8');
      const parsed = JSON.parse(raw) as SharedCalibrationSnapshot;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('invalid snapshot');
      }
      return parsed;
    } catch {
      return {
        workspaceId: this.workspaceId,
        updatedAt: new Date(0).toISOString(),
        byStage: {},
      };
    }
  }

  async persist(snapshot: SharedCalibrationSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.calibrationPath), { recursive: true });
    await fs.writeFile(this.calibrationPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  async merge(remote: SharedCalibrationSnapshot): Promise<SharedCalibrationSnapshot> {
    const local = await this.load();
    const merged: SharedCalibrationSnapshot = {
      workspaceId: this.workspaceId,
      updatedAt: new Date().toISOString(),
      byStage: { ...local.byStage },
    };

    for (const [stage, stats] of Object.entries(remote.byStage)) {
      const current = merged.byStage[stage] ?? { total: 0, withOutcome: 0 };
      merged.byStage[stage] = {
        total: Math.max(current.total, stats.total),
        withOutcome: Math.max(current.withOutcome, stats.withOutcome),
      };
    }

    await this.persist(merged);
    return merged;
  }
}

export async function persistCurrentCalibrationSnapshot(
  workspaceId: string,
  store: SharedCalibrationStore = new SharedCalibrationStore(workspaceId),
): Promise<SharedCalibrationSnapshot> {
  const counts = getStagePredictionCounts();
  const byStage: SharedCalibrationSnapshot['byStage'] = {};
  for (const [stageId, stats] of counts.entries()) {
    byStage[stageId] = {
      total: stats.total,
      withOutcome: stats.withOutcome,
    };
  }

  const snapshot: SharedCalibrationSnapshot = {
    workspaceId,
    updatedAt: new Date().toISOString(),
    byStage,
  };
  await store.persist(snapshot);
  return snapshot;
}
