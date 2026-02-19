import type { LibrarianStorage, StorageSlices } from './types.js';

type SliceMethodMap = {
  [K in keyof StorageSlices]?: readonly string[];
};

const SLICE_METHODS: SliceMethodMap = {
  lifecycle: ['initialize', 'close', 'isInitialized', 'getCapabilities'],
  metadata: ['getMetadata', 'setMetadata', 'getState', 'setState', 'getVersion', 'setVersion'],
  knowledge: [
    'getFunctions',
    'getFunction',
    'getFunctionByPath',
    'getFunctionsByPath',
    'upsertFunction',
    'upsertFunctions',
    'deleteFunction',
    'deleteFunctionsByPath',
    'getModules',
    'getModule',
    'getModuleByPath',
    'upsertModule',
    'deleteModule',
    'getFiles',
    'getFile',
    'getFileByPath',
    'getFilesByDirectory',
    'upsertFile',
    'upsertFiles',
    'deleteFile',
    'deleteFileByPath',
    'getDirectories',
    'getDirectory',
    'getDirectoryByPath',
    'getSubdirectories',
    'upsertDirectory',
    'upsertDirectories',
    'deleteDirectory',
    'deleteDirectoryByPath',
    'getContextPacks',
    'getContextPack',
    'getContextPackForTarget',
    'upsertContextPack',
    'invalidateContextPacks',
    'deleteContextPack',
    'recordContextPackAccess',
  ],
  checksums: ['getFileChecksum', 'setFileChecksum', 'deleteFileChecksum'],
  embeddings: [
    'getEmbedding',
    'setEmbedding',
    'findSimilarByEmbedding',
    'getMultiVector',
    'getMultiVectors',
    'upsertMultiVector',
  ],
  cache: ['getQueryCacheEntry', 'upsertQueryCacheEntry', 'recordQueryCacheAccess', 'pruneQueryCache'],
  graphCache: ['getGraphCacheEntry', 'upsertGraphCacheEntry', 'pruneExpiredGraphCache'],
  learning: [
    'recordEvolutionOutcome',
    'getEvolutionOutcomes',
    'recordLearnedMissing',
    'getLearnedMissing',
    'clearLearnedMissing',
    'recordQualityScore',
    'getQualityScoreHistory',
  ],
  evidence: ['setEvidence', 'getEvidenceForTarget', 'deleteEvidence', 'getEvidenceVerificationSummary', 'exportEvidenceMarkdown'],
  confidence: [
    'updateConfidence',
    'applyTimeDecay',
    'getConfidenceEvents',
    'countConfidenceUpdates',
    'getBayesianConfidence',
    'getBayesianConfidences',
    'upsertBayesianConfidence',
    'updateBayesianConfidence',
  ],
  graph: [
    'upsertGraphEdges',
    'deleteGraphEdgesForSource',
    'getGraphEdges',
    'setGraphMetrics',
    'getGraphMetrics',
    'deleteGraphMetrics',
    'storeCochangeEdges',
    'getCochangeEdges',
    'getCochangeEdgeCount',
    'deleteCochangeEdges',
    'getKnowledgeEdges',
    'getKnowledgeEdgesFrom',
    'getKnowledgeEdgesTo',
    'getKnowledgeSubgraph',
    'upsertKnowledgeEdges',
    'deleteKnowledgeEdge',
    'deleteKnowledgeEdgesForEntity',
    'getSCCEntries',
    'getSCCByEntity',
    'upsertSCCEntries',
    'deleteSCCEntries',
    'getCFGEdges',
    'getCFGForFunction',
    'upsertCFGEdges',
    'deleteCFGEdgesForFunction',
  ],
  ingestion: [
    'getIngestionItem',
    'getIngestionItems',
    'upsertIngestionItem',
    'deleteIngestionItem',
    'recordIndexingResult',
    'getLastIndexingResult',
    'recordBootstrapReport',
    'getLastBootstrapReport',
  ],
  tests: [
    'getTestMapping',
    'getTestMappings',
    'getTestMappingsByTestPath',
    'getTestMappingsBySourcePath',
    'upsertTestMapping',
    'deleteTestMapping',
    'deleteTestMappingsByTestPath',
  ],
  commits: [
    'getCommit',
    'getCommitBySha',
    'getCommits',
    'upsertCommit',
    'deleteCommit',
    'deleteCommitBySha',
  ],
  ownership: [
    'getOwnership',
    'getOwnershipByFilePath',
    'getOwnershipByAuthor',
    'getOwnerships',
    'upsertOwnership',
    'deleteOwnership',
    'deleteOwnershipByFilePath',
  ],
  universalKnowledge: [
    'getUniversalKnowledge',
    'getUniversalKnowledgeByFile',
    'getUniversalKnowledgeByKind',
    'queryUniversalKnowledge',
    'upsertUniversalKnowledge',
    'upsertUniversalKnowledgeBatch',
    'deleteUniversalKnowledge',
    'deleteUniversalKnowledgeByFile',
    'searchUniversalKnowledgeBySimilarity',
  ],
  assessments: [
    'getAssessment',
    'getAssessmentByPath',
    'getAssessments',
    'upsertAssessment',
    'upsertAssessments',
    'deleteAssessment',
    'deleteAssessmentByPath',
  ],
  git: [
    'getBlameEntries',
    'getBlameForFile',
    'getBlameStats',
    'upsertBlameEntries',
    'deleteBlameForFile',
    'getDiffRecords',
    'getDiffForCommit',
    'upsertDiffRecords',
    'deleteDiffForCommit',
    'getReflogEntries',
    'upsertReflogEntries',
    'deleteReflogEntries',
  ],
  clones: ['getCloneEntries', 'getClonesByEntity', 'getCloneClusters', 'upsertCloneEntries', 'deleteCloneEntries'],
  debt: ['getDebtMetrics', 'getDebtForEntity', 'getDebtHotspots', 'upsertDebtMetrics', 'deleteDebtMetrics'],
  faults: ['getFaultLocalizations', 'upsertFaultLocalization', 'deleteFaultLocalization'],
  maintenance: ['transaction', 'getStats', 'vacuum'],
};

function buildMissingMethodError(sliceName: string, method: string): Error {
  return new Error(`unverified_by_trace(storage_slice_missing_method): ${sliceName}.${method}`);
}

function bindSliceMethods(
  storage: LibrarianStorage,
  sliceName: string,
  methods: readonly string[],
  strict: boolean
): Record<string, (...args: unknown[]) => unknown> {
  const slice: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of methods) {
    const value = (storage as unknown as Record<string, unknown>)[method];
    if (typeof value === 'function') {
      slice[method] = value.bind(storage);
      continue;
    }
    if (strict) {
      throw buildMissingMethodError(sliceName, method);
    }
    slice[method] = () => {
      throw buildMissingMethodError(sliceName, method);
    };
  }
  return slice;
}

export function createStorageSlices(
  storage: LibrarianStorage,
  options: { strict?: boolean } = {}
): StorageSlices {
  const strict = options.strict ?? true;
  const slices = {
    lifecycle: bindSliceMethods(storage, 'lifecycle', SLICE_METHODS.lifecycle ?? [], strict),
    metadata: bindSliceMethods(storage, 'metadata', SLICE_METHODS.metadata ?? [], strict),
    knowledge: bindSliceMethods(storage, 'knowledge', SLICE_METHODS.knowledge ?? [], strict),
    checksums: bindSliceMethods(storage, 'checksums', SLICE_METHODS.checksums ?? [], strict),
    embeddings: bindSliceMethods(storage, 'embeddings', SLICE_METHODS.embeddings ?? [], strict),
    cache: bindSliceMethods(storage, 'cache', SLICE_METHODS.cache ?? [], strict),
    graphCache: bindSliceMethods(storage, 'graphCache', SLICE_METHODS.graphCache ?? [], strict),
    learning: bindSliceMethods(storage, 'learning', SLICE_METHODS.learning ?? [], strict),
    evidence: bindSliceMethods(storage, 'evidence', SLICE_METHODS.evidence ?? [], strict),
    confidence: bindSliceMethods(storage, 'confidence', SLICE_METHODS.confidence ?? [], strict),
    graph: bindSliceMethods(storage, 'graph', SLICE_METHODS.graph ?? [], strict),
    ingestion: bindSliceMethods(storage, 'ingestion', SLICE_METHODS.ingestion ?? [], strict),
    tests: bindSliceMethods(storage, 'tests', SLICE_METHODS.tests ?? [], strict),
    commits: bindSliceMethods(storage, 'commits', SLICE_METHODS.commits ?? [], strict),
    ownership: bindSliceMethods(storage, 'ownership', SLICE_METHODS.ownership ?? [], strict),
    universalKnowledge: bindSliceMethods(storage, 'universalKnowledge', SLICE_METHODS.universalKnowledge ?? [], strict),
    assessments: bindSliceMethods(storage, 'assessments', SLICE_METHODS.assessments ?? [], strict),
    git: bindSliceMethods(storage, 'git', SLICE_METHODS.git ?? [], strict),
    clones: bindSliceMethods(storage, 'clones', SLICE_METHODS.clones ?? [], strict),
    debt: bindSliceMethods(storage, 'debt', SLICE_METHODS.debt ?? [], strict),
    faults: bindSliceMethods(storage, 'faults', SLICE_METHODS.faults ?? [], strict),
    maintenance: bindSliceMethods(storage, 'maintenance', SLICE_METHODS.maintenance ?? [], strict),
    raw: storage,
  };
  return slices as StorageSlices;
}

export const __testing = {
  sliceMethods: SLICE_METHODS,
};
