import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createSessionId,
  type EvidenceId,
  type SqliteEvidenceLedger,
} from '../epistemics/evidence_ledger.js';
import { bounded } from '../epistemics/confidence.js';
import {
  appendAnnotatedClaims,
  markEvidenceEntriesStale,
  type MarkStaleInput,
} from './annotator.js';
import {
  clampMemoryConfidence,
  type MemoryBridgeEntry,
  type MemoryBridgeSource,
  type MemoryBridgeState,
} from './entry.js';

export interface MemoryBridgeKnowledgeClaim {
  claimId: string;
  claim: string;
  workspace?: string;
  sessionId: string;
  confidence: number;
  tags: string[];
  evidence: string[];
  sourceTool?: string;
  createdAt: string;
}

export interface MemoryBridgeHarvestResult {
  memoryFilePath: string;
  source: MemoryBridgeSource;
  written: number;
  skipped: number;
  entries: MemoryBridgeEntry[];
}

export interface MemoryBridgeStaleResult {
  memoryFilePath: string;
  updated: number;
  replacementsWritten: number;
}

export interface MemoryBridgeDaemonConfig {
  workspaceRoot: string;
  evidenceLedger?: SqliteEvidenceLedger;
}

const STATE_FILE_NAME = '.librainian-memory-bridge.json';

async function loadState(statePath: string): Promise<MemoryBridgeState> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as MemoryBridgeState;
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  } catch {
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  }
}

async function saveState(statePath: string, state: MemoryBridgeState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function statePathForMemory(memoryFilePath: string): string {
  return path.join(path.dirname(memoryFilePath), STATE_FILE_NAME);
}

export class MemoryBridgeDaemon {
  private readonly workspaceRoot: string;
  private readonly evidenceLedger?: SqliteEvidenceLedger;

  constructor(config: MemoryBridgeDaemonConfig) {
    this.workspaceRoot = path.resolve(config.workspaceRoot);
    this.evidenceLedger = config.evidenceLedger;
  }

  async harvestToMemory(params: {
    claims: MemoryBridgeKnowledgeClaim[];
    memoryFilePath: string;
    source: MemoryBridgeSource;
  }): Promise<MemoryBridgeHarvestResult> {
    const memoryFilePath = path.resolve(params.memoryFilePath);
    const annotated = [];
    const bridgeEntries: MemoryBridgeEntry[] = [];

    for (const claim of params.claims) {
      let evidenceId: EvidenceId = claim.claimId as EvidenceId;
      if (this.evidenceLedger) {
        const confidence = clampMemoryConfidence(claim.confidence);
        const low = Math.max(0, confidence - 0.1);
        const high = Math.min(1, confidence + 0.1);
        const appended = await this.evidenceLedger.append({
          kind: 'claim',
          payload: {
            claim: claim.claim,
            category: 'behavior',
            subject: {
              type: 'system',
              identifier: claim.workspace ?? this.workspaceRoot,
            },
            supportingEvidence: [],
            knownDefeaters: [],
            confidence: bounded(
              low,
              high,
              'theoretical',
              'memory_bridge_harvest',
            ),
          },
          provenance: {
            source: 'tool_output',
            method: 'memory_bridge_harvest',
            agent: {
              type: 'tool',
              identifier: claim.sourceTool ?? 'harvest_session_knowledge',
            },
            config: {
              claimId: claim.claimId,
              source: params.source,
              tags: claim.tags,
            },
          },
          relatedEntries: [],
          sessionId: createSessionId(claim.sessionId),
        });
        evidenceId = appended.id;
      }

      annotated.push({
        claim: claim.claim,
        evidenceId,
        confidence: claim.confidence,
      });

      bridgeEntries.push({
        evidenceId,
        confidence: clampMemoryConfidence(claim.confidence),
        source: params.source,
        memoryFilePath,
        memoryLineRange: [0, 0],
        claim: claim.claim,
        createdAt: claim.createdAt,
        sessionId: claim.sessionId,
        workspace: claim.workspace,
      });
    }

    const writeResult = await appendAnnotatedClaims(memoryFilePath, annotated);
    for (const entry of bridgeEntries) {
      const lineRange = writeResult.lineRanges[String(entry.evidenceId)];
      if (lineRange) {
        entry.memoryLineRange = lineRange;
      }
    }

    const statePath = statePathForMemory(memoryFilePath);
    const prior = await loadState(statePath);
    const dedup = new Map<string, MemoryBridgeEntry>();
    for (const entry of prior.entries) {
      dedup.set(String(entry.evidenceId), entry);
    }
    for (const entry of bridgeEntries) {
      dedup.set(String(entry.evidenceId), entry);
    }
    await saveState(statePath, {
      updatedAt: new Date().toISOString(),
      entries: Array.from(dedup.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    });

    return {
      memoryFilePath,
      source: params.source,
      written: writeResult.written,
      skipped: writeResult.skipped,
      entries: bridgeEntries,
    };
  }

  async applyDefeaters(params: {
    memoryFilePath: string;
    defeaters: MarkStaleInput[];
  }): Promise<MemoryBridgeStaleResult> {
    const memoryFilePath = path.resolve(params.memoryFilePath);
    const result = await markEvidenceEntriesStale(memoryFilePath, params.defeaters);
    const statePath = statePathForMemory(memoryFilePath);
    const prior = await loadState(statePath);
    const defeatedByMap = new Map<string, string | undefined>();
    for (const defeater of params.defeaters) {
      defeatedByMap.set(defeater.evidenceId, defeater.replacement?.evidenceId);
    }
    const nextEntries = prior.entries.map((entry) => {
      const defeatedBy = defeatedByMap.get(String(entry.evidenceId));
      if (!defeatedByMap.has(String(entry.evidenceId))) return entry;
      return {
        ...entry,
        defeatedBy: defeatedBy as EvidenceId | undefined,
      };
    });
    await saveState(statePath, {
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    });

    return {
      memoryFilePath,
      updated: result.updated,
      replacementsWritten: result.replacementsWritten,
    };
  }
}
