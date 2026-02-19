export {
  MemoryBridgeDaemon,
  type MemoryBridgeDaemonConfig,
  type MemoryBridgeHarvestResult,
  type MemoryBridgeKnowledgeClaim,
  type MemoryBridgeStaleResult,
} from './daemon.js';
export {
  appendAnnotatedClaims,
  markEvidenceEntriesStale,
  type AnnotatedClaimInput,
  type AnnotationWriteResult,
  type MarkStaleInput,
  type MarkStaleResult,
} from './annotator.js';
export type {
  MemoryBridgeEntry,
  MemoryBridgeSource,
  MemoryBridgeState,
} from './entry.js';
