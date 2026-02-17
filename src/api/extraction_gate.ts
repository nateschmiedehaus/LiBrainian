import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { safeJsonParse } from '../utils/safe_json.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId } from '../epistemics/evidence_ledger.js';

export interface ExtractionGateOptions {
  workspaceRoot?: string;
  gatesPath?: string;
  discloseMissingMetadata?: boolean;
  ledger?: IEvidenceLedger;
  sessionId?: SessionId;
}

export interface ExtractionGateTaskSnapshot {
  status: string;
  lastRun?: string | null;
  evidence?: string | null;
}

export interface ExtractionGateSnapshot {
  workspaceRoot: string;
  gatesPath: string | null;
  tasks: Record<string, ExtractionGateTaskSnapshot>;
  boundaryReady: boolean;
  repoExtractionComplete: boolean;
  missingBoundaryGates: string[];
  disclosures: string[];
}

const REQUIRED_BOUNDARY_GATES = [
  'layer1.noWave0Imports',
  'layer1.noDirectImports',
  'layer1.standaloneTests',
  'layer1.extractionPrereqs',
];

const REPO_EXTRACTION_GATE = 'layer1.repoExtraction';

const GATE_CANDIDATES = [
  path.join('docs', 'librarian', 'GATES.json'),
  path.join('docs', 'GATES.json'),
  'GATES.json',
];

const EXTRACTION_METADATA_UNAVAILABLE =
  'unverified_by_trace(extraction_missing): extraction gate metadata unavailable';

export async function checkExtractionSnapshot(options: ExtractionGateOptions = {}): Promise<ExtractionGateSnapshot> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const startedAt = Date.now();
  const discloseMissingMetadata = options.discloseMissingMetadata ?? true;
  const gatesPath = options.gatesPath ?? await resolveGatesPath(workspaceRoot);
  const snapshot: ExtractionGateSnapshot = {
    workspaceRoot,
    gatesPath,
    tasks: {},
    boundaryReady: false,
    repoExtractionComplete: false,
    missingBoundaryGates: REQUIRED_BOUNDARY_GATES.slice(),
    disclosures: [],
  };

  if (!gatesPath) {
    if (discloseMissingMetadata) {
      snapshot.disclosures.push(EXTRACTION_METADATA_UNAVAILABLE);
    }
    await appendExtractionGateEvidence(snapshot, startedAt, options);
    return snapshot;
  }

  let raw: string;
  try {
    raw = await fs.readFile(gatesPath, 'utf8');
  } catch {
    if (discloseMissingMetadata) {
      snapshot.disclosures.push(EXTRACTION_METADATA_UNAVAILABLE);
    }
    await appendExtractionGateEvidence(snapshot, startedAt, options);
    return snapshot;
  }

  const parsed = safeJsonParse<Record<string, unknown>>(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    if (discloseMissingMetadata) {
      snapshot.disclosures.push(EXTRACTION_METADATA_UNAVAILABLE);
    }
    await appendExtractionGateEvidence(snapshot, startedAt, options);
    return snapshot;
  }

  const tasksRaw = (parsed.value as { tasks?: Record<string, unknown> }).tasks;
  if (!tasksRaw || typeof tasksRaw !== 'object') {
    if (discloseMissingMetadata) {
      snapshot.disclosures.push(EXTRACTION_METADATA_UNAVAILABLE);
    }
    await appendExtractionGateEvidence(snapshot, startedAt, options);
    return snapshot;
  }

  const allTasks = [...REQUIRED_BOUNDARY_GATES, REPO_EXTRACTION_GATE];
  for (const gateId of allTasks) {
    snapshot.tasks[gateId] = normalizeTask((tasksRaw as Record<string, unknown>)[gateId]);
  }

  const missingBoundary = REQUIRED_BOUNDARY_GATES.filter((gateId) => !isPassing(snapshot.tasks[gateId]?.status));
  snapshot.missingBoundaryGates = missingBoundary;
  snapshot.boundaryReady = missingBoundary.length === 0;

  const repoStatus = snapshot.tasks[REPO_EXTRACTION_GATE]?.status ?? 'unknown';
  snapshot.repoExtractionComplete = isPassing(repoStatus);

  if (!snapshot.boundaryReady) {
    const summary = REQUIRED_BOUNDARY_GATES
      .map((gateId) => `${gateId}=${snapshot.tasks[gateId]?.status ?? 'unknown'}`)
      .join(', ');
    snapshot.disclosures.push(`unverified_by_trace(extraction_missing): boundary gates incomplete (${summary})`);
  }

  if (!snapshot.repoExtractionComplete) {
    snapshot.disclosures.push(`unverified_by_trace(extraction_missing): ${REPO_EXTRACTION_GATE}=${repoStatus}`);
  }

  await appendExtractionGateEvidence(snapshot, startedAt, options);
  return snapshot;
}

async function resolveGatesPath(workspaceRoot: string): Promise<string | null> {
  for (const candidate of GATE_CANDIDATES) {
    const resolved = path.join(workspaceRoot, candidate);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) return resolved;
    } catch {
      // continue
    }
  }
  return null;
}

function normalizeTask(task: unknown): ExtractionGateTaskSnapshot {
  if (!task || typeof task !== 'object') return { status: 'unknown' };
  const record = task as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status : 'unknown';
  const lastRun = typeof record.lastRun === 'string' ? record.lastRun : null;
  const evidence = typeof record.evidence === 'string' ? record.evidence : null;
  return { status, lastRun, evidence };
}

function isPassing(status: string | undefined): boolean {
  return status === 'pass';
}

async function appendExtractionGateEvidence(
  snapshot: ExtractionGateSnapshot,
  startedAt: number,
  options: ExtractionGateOptions
): Promise<void> {
  if (!options.ledger) return;
  try {
    const input = {
      workspaceRoot: snapshot.workspaceRoot,
      gatesPath: snapshot.gatesPath,
      boundaryGates: REQUIRED_BOUNDARY_GATES,
      repoGate: REPO_EXTRACTION_GATE,
    };
    const output = {
      boundaryReady: snapshot.boundaryReady,
      repoExtractionComplete: snapshot.repoExtractionComplete,
      missingBoundaryGates: snapshot.missingBoundaryGates,
      disclosures: snapshot.disclosures,
    };
    const inputHash = createHash('sha256')
      .update(JSON.stringify({ input, output }))
      .digest('hex')
      .slice(0, 16);

    await options.ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'extraction_gate',
        arguments: input,
        result: output,
        success: snapshot.boundaryReady && snapshot.repoExtractionComplete,
        durationMs: Date.now() - startedAt,
      },
      provenance: {
        source: 'system_observation',
        method: 'extraction_gate',
        agent: {
          type: 'tool',
          identifier: 'librarian',
        },
        inputHash,
      },
      relatedEntries: [],
      sessionId: options.sessionId ?? createSessionId(),
    });
  } catch {
    // Gate must remain usable even if the ledger is unavailable.
  }
}
