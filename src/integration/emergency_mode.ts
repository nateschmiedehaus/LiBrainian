import * as fs from 'fs/promises';
import * as path from 'path';
import { logWarning } from '../telemetry/logger.js';

export interface EmergencyModeState {
  active: boolean;
  reason?: string;
  enteredAt?: string;
  workspace?: string;
  lastCheckedAt?: number;
  operations: string[];
  confidenceUpdatesSkipped: number;
}

const state: EmergencyModeState = {
  active: false,
  operations: [],
  confidenceUpdatesSkipped: 0,
};

const RECOVERY_INTERVAL_MS = 300_000;
const PROLONGED_MS = 3_600_000;
const TAG = 'unverified_by_trace(emergency_mode)';

const normalize = (value: string): string =>
  value.includes(TAG) ? value : `${TAG}: ${value}`;

const reportDir = (workspace: string): string =>
  path.join(workspace, 'state', 'audits', 'librainian', 'emergency');

interface EmergencyModeReport {
  kind: 'EmergencyModeReport.v1';
  schema_version: 1;
  created_at: string;
  workspace: string;
  active: boolean;
  reason: string;
  entered_at: string;
  duration_ms: number;
  operations_performed: string[];
  confidence_updates_skipped: number;
  trace_refs: string[];
}

const buildReport = (): EmergencyModeReport => ({
  kind: 'EmergencyModeReport.v1',
  schema_version: 1,
  created_at: new Date().toISOString(),
  workspace: state.workspace ?? '',
  active: state.active,
  reason: state.reason ?? '',
  entered_at: state.enteredAt ?? '',
  duration_ms: state.enteredAt ? Date.now() - Date.parse(state.enteredAt) : 0,
  operations_performed: state.operations,
  confidence_updates_skipped: state.confidenceUpdatesSkipped,
  trace_refs: [],
});

const writeReport = async (): Promise<void> => {
  if (!state.workspace) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(reportDir(state.workspace), stamp);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'EmergencyModeReport.v1.json'),
    JSON.stringify(buildReport(), null, 2) + '\n',
    'utf8'
  );
};

const safeWriteReport = (context: string): void => {
  void writeReport().catch((error) => {
    logWarning(`${TAG}: Failed to write emergency report during ${context}`, {
      error: error instanceof Error ? error.message : String(error),
      workspace: state.workspace,
    });
  });
};

export function getEmergencyModeState(): EmergencyModeState {
  return { ...state, operations: [...state.operations] };
}

export function enterEmergencyMode(workspace: string, reason: string): void {
  state.active = true;
  state.workspace = workspace;
  state.reason = normalize(reason);
  state.enteredAt = state.enteredAt ?? new Date().toISOString();
  state.lastCheckedAt = Date.now();

  if (state.enteredAt && Date.now() - Date.parse(state.enteredAt) > PROLONGED_MS) {
    logWarning(`${TAG}: emergency mode exceeded 1 hour`);
  }

  safeWriteReport('enter');
}

export function exitEmergencyMode(workspace?: string): void {
  if (workspace) state.workspace = workspace;
  if (!state.workspace) return;

  safeWriteReport('exit');

  state.active = false;
  state.reason = undefined;
  state.enteredAt = undefined;
  state.lastCheckedAt = undefined;
  state.operations = [];
  state.confidenceUpdatesSkipped = 0;
}

export function recordEmergencyOperation(
  workspace: string,
  operation: string
): void {
  if (!state.active) return;

  state.workspace = workspace;
  state.operations.push(normalize(operation));

  if (state.operations.length > 50) state.operations.shift();

  if (state.enteredAt && Date.now() - Date.parse(state.enteredAt) > PROLONGED_MS) {
    logWarning(`${TAG}: emergency mode exceeded 1 hour`);
  }

  safeWriteReport('record_operation');
}

export function recordConfidenceUpdateSkipped(workspace: string): void {
  if (!state.active) return;

  state.workspace = workspace;
  state.confidenceUpdatesSkipped += 1;

  safeWriteReport('record_confidence_skip');
}

export function shouldAttemptEmergencyRecovery(now: number = Date.now()): boolean {
  return state.active && now - (state.lastCheckedAt ?? 0) >= RECOVERY_INTERVAL_MS;
}

export function markEmergencyRecoveryAttempt(now: number = Date.now()): void {
  if (state.active) state.lastCheckedAt = now;
}
