import type { EvidenceId } from '../epistemics/evidence_ledger.js';

export type MemoryBridgeSource = 'openclaw-session' | 'manual' | 'harvest';

export interface MemoryBridgeEntry {
  evidenceId: EvidenceId;
  confidence: number;
  validUntil?: string;
  defeatedBy?: EvidenceId;
  source: MemoryBridgeSource;
  memoryFilePath: string;
  memoryLineRange: [number, number];
  claim: string;
  createdAt: string;
  sessionId?: string;
  workspace?: string;
}

export interface MemoryBridgeState {
  updatedAt: string;
  entries: MemoryBridgeEntry[];
}

export function clampMemoryConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
