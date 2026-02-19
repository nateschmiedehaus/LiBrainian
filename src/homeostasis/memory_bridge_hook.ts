import type { SqliteEvidenceLedger } from '../epistemics/evidence_ledger.js';
import { MemoryBridgeDaemon } from '../memory_bridge/daemon.js';
import type { MarkStaleInput } from '../memory_bridge/annotator.js';

export interface MemoryBridgeHookOptions {
  workspaceRoot: string;
  memoryFilePath: string;
  defeaters: MarkStaleInput[];
  evidenceLedger?: SqliteEvidenceLedger;
}

export interface MemoryBridgeHookResult {
  success: boolean;
  updated: number;
  replacementsWritten: number;
  memoryFilePath: string;
}

/**
 * Homeostasis extension point for memory-bridge stale marking.
 * Called after a reindex/health cycle when new defeaters are detected.
 */
export async function applyMemoryBridgeDefeaters(
  options: MemoryBridgeHookOptions,
): Promise<MemoryBridgeHookResult> {
  const daemon = new MemoryBridgeDaemon({
    workspaceRoot: options.workspaceRoot,
    evidenceLedger: options.evidenceLedger,
  });
  const result = await daemon.applyDefeaters({
    memoryFilePath: options.memoryFilePath,
    defeaters: options.defeaters,
  });
  return {
    success: true,
    updated: result.updated,
    replacementsWritten: result.replacementsWritten,
    memoryFilePath: result.memoryFilePath,
  };
}
