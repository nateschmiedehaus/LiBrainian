import path from 'node:path';
import type { LibrarianStorage } from '../storage/types.js';
import type { GraphEntityType, LibrarianQuery, ContextPack, Perspective } from '../types.js';
import type { FileKnowledge, FunctionKnowledge, ModuleKnowledge, UniversalKnowledgeRecord } from '../storage/types.js';
import { EmbeddingService } from '../api/embeddings.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  multiSignalScorer,
  DirectoryAffinitySignalComputer,
  type QueryContext,
  type EntityData,
  type ScoredEntity,
  type SignalWeight,
  type FeedbackRecord,
} from './multi_signal_scorer.js';
import type { EntityId } from '../core/contracts.js';
import {
  inferPerspective,
  getEntityTypeWeight,
  calculatePerspectiveBoost,
  type PerspectiveConfig,
  getPerspectiveConfig,
} from '../api/perspective.js';

const MULTI_SIGNAL_STATE_KEY = 'librarian.multi_signal_scorer.v1';
const DEFAULT_TARGET_TYPES = ['function', 'module'];

type ScoringCandidate = {
  entityId: string;
  entityType: GraphEntityType;
  path?: string;
};

type UniversalKnowledgeLookup = Map<string, UniversalKnowledgeRecord>;

let loadedWorkspace: string | null = null;
let loadPromise: Promise<void> | null = null;

export async function ensureMultiSignalState(storage: LibrarianStorage): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  if (workspaceRoot && loadedWorkspace === workspaceRoot) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const raw = await storage.getState(MULTI_SIGNAL_STATE_KEY);
    if (raw) {
      const parsed = safeJsonParse<{ weights?: Record<string, unknown>; recentFeedback?: unknown }>(raw);
      if (parsed.ok) {
        try {
          multiSignalScorer.fromJSON(parsed.value as { weights?: Record<string, SignalWeight>; recentFeedback?: FeedbackRecord[] });
        } catch (error) {
          logWarning('[librarian] Failed to restore multi-signal scorer state', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    loadedWorkspace = workspaceRoot ?? null;
  })();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function persistMultiSignalState(storage: LibrarianStorage): Promise<void> {
  const payload = JSON.stringify(multiSignalScorer.toJSON());
  await storage.setState(MULTI_SIGNAL_STATE_KEY, payload);
}

export function buildQueryContext(
  query: Pick<LibrarianQuery, 'intent' | 'affectedFiles' | 'taskType' | 'perspective'>,
  queryEmbedding?: Float32Array | null,
  options: { currentUser?: string; currentTeam?: string } = {}
): QueryContext {
  const intent = query.intent ?? '';
  const queryTerms = tokenize(intent);
  const currentFile = query.affectedFiles?.find(Boolean);

  // Determine target entity types based on perspective
  let targetEntityTypes = DEFAULT_TARGET_TYPES;
  const perspective = inferPerspective(query);
  if (perspective) {
    // Sort entity types by their perspective weights
    const config = getPerspectiveConfig(perspective);
    const typesWithWeights = (Object.entries(config.entityTypeWeights) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
    targetEntityTypes = typesWithWeights;
  }

  // Detect target directories from query intent
  // This enables the directory_affinity signal to boost results from relevant paths
  // e.g., "CLI command implementation" -> targetDirectories: ['cli', 'commands']
  const targetDirectories = DirectoryAffinitySignalComputer.detectDirectoryPatterns(intent);

  return {
    queryText: intent,
    queryTerms,
    queryEmbedding: queryEmbedding ? Array.from(queryEmbedding) : undefined,
    targetDomains: queryTerms.length ? queryTerms : undefined,
    targetEntityTypes,
    currentFile,
    currentUser: options.currentUser,
    currentTeam: options.currentTeam,
    targetDirectories: targetDirectories.length > 0 ? targetDirectories : undefined,
  };
}

export async function scoreCandidatesWithMultiSignals(
  storage: LibrarianStorage,
  candidates: ScoringCandidate[],
  query: LibrarianQuery,
  queryEmbedding?: Float32Array | null
): Promise<Map<string, ScoredEntity>> {
  if (!candidates.length) return new Map();
  await ensureMultiSignalState(storage);
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  const queryContext = buildQueryContext(query, queryEmbedding, {
    currentUser: resolveCurrentUser(),
  });
  const entityData = await buildEntityData(storage, candidates, workspaceRoot);
  const entityDataById = new Map(entityData.map(e => [e.id, e]));
  const scored = await multiSignalScorer.scoreEntities(entityData, queryContext);

  // Apply keyword boost for obvious filename/path matches
  // This ensures queries like "bootstrap" strongly prefer bootstrap.ts
  for (const entry of scored) {
    const entity = entityDataById.get(entry.entityId);
    if (entity) {
      const keywordBoost = computeKeywordBoost(
        queryContext.queryTerms,
        entity.path,
        entity.name
      );
      if (keywordBoost > 1.0) {
        entry.combinedScore = Math.min(1.0, entry.combinedScore * keywordBoost);
      }
    }
  }

  // Apply perspective-based score adjustments
  const perspective = inferPerspective(query);
  if (perspective) {
    for (const entry of scored) {
      // Find the candidate to get entity type
      const candidate = candidates.find(c => c.entityId === entry.entityId);
      if (candidate) {
        // Adjust score based on entity type weight for this perspective
        const entityTypeWeight = getEntityTypeWeight(
          candidate.entityType as 'function' | 'module' | 'document',
          perspective
        );

        // Adjust score based on content relevance to perspective
        const contentBoost = calculatePerspectiveBoost(
          entry.explanation || '',
          perspective
        );

        // Apply perspective adjustments: entity type weight and content boost
        // Use a weighted combination to avoid over-boosting
        const perspectiveMultiplier = 0.7 + (0.3 * entityTypeWeight * contentBoost);
        entry.combinedScore = Math.min(1.0, entry.combinedScore * perspectiveMultiplier);
      }
    }
  }

  // Re-sort after all score adjustments (keyword boost + perspective)
  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  return new Map(scored.map((entry) => [entry.entityId, entry]));
}

export async function recordMultiSignalFeedback(options: {
  storage: LibrarianStorage;
  embeddingService?: EmbeddingService | null;
  intent: string;
  packs: ContextPack[];
  success: boolean;
}): Promise<void> {
  const { storage, embeddingService, intent, packs, success } = options;
  if (!packs.length || !intent) return;
  await ensureMultiSignalState(storage);

  let queryEmbedding: Float32Array | null = null;
  if (embeddingService) {
    try {
      const embedding = await embeddingService.generateEmbedding({ text: intent, kind: 'query' });
      queryEmbedding = embedding.embedding;
    } catch (error) {
      logWarning('[librarian] Feedback embedding failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const candidates: ScoringCandidate[] = packs.map((pack) => ({
    entityId: pack.targetId,
    entityType: inferPackEntityType(pack),
    path: pack.relatedFiles[0],
  }));
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  const queryContext = buildQueryContext(
    { intent, affectedFiles: packs.flatMap((pack) => pack.relatedFiles.slice(0, 1)) },
    queryEmbedding,
    { currentUser: resolveCurrentUser() }
  );
  const entityData = await buildEntityData(storage, candidates, workspaceRoot);
  const scored = await multiSignalScorer.scoreEntities(entityData, queryContext);
  for (const entry of scored) {
    multiSignalScorer.recordFeedback(entry.entityId, success, entry.signals);
  }
  await persistMultiSignalState(storage);
}

async function buildEntityData(
  storage: LibrarianStorage,
  candidates: ScoringCandidate[],
  workspaceRoot: string | null
): Promise<EntityData[]> {
  const functionIds = new Set<string>();
  const moduleIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.entityType === 'function') functionIds.add(candidate.entityId);
    else moduleIds.add(candidate.entityId);
  }

  const functions = await loadFunctions(storage, Array.from(functionIds));
  const modules = await loadModules(storage, Array.from(moduleIds));
  const functionById = new Map(functions.map((fn) => [fn.id, fn]));
  const moduleById = new Map(modules.map((mod) => [mod.id, mod]));

  const filePaths = new Set<string>();
  for (const fn of functions) filePaths.add(fn.filePath);
  for (const mod of modules) filePaths.add(mod.path);

  const fileKnowledgeByPath = await loadFileKnowledge(storage, filePaths);
  const ownershipByPath = await loadOwnership(storage, filePaths);
  const universalByPath = await loadUniversalKnowledge(storage, filePaths);
  const changeFrequencyByPath = await computeChangeFrequency(storage, filePaths, workspaceRoot);
  const embeddingById = await loadEmbeddings(storage, candidates.map((candidate) => candidate.entityId));
  const moduleGraph = await buildModuleGraph(storage, modules, moduleById);

  return candidates.map((candidate) => {
    const fn = candidate.entityType === 'function' ? functionById.get(candidate.entityId) : undefined;
    const mod = candidate.entityType === 'module' ? moduleById.get(candidate.entityId) : undefined;
    const resolvedPath = fn?.filePath ?? mod?.path ?? candidate.path ?? '';
    const fileInfo = resolvedPath ? fileKnowledgeByPath.get(resolvedPath) : undefined;
    const owners = resolvedPath ? ownershipByPath.get(resolvedPath) : undefined;
    const universal = resolvedPath ? universalByPath.get(universalKey(resolvedPath, candidate.entityType)) : undefined;
    const changeFrequency = resolvedPath ? changeFrequencyByPath.get(resolvedPath) : undefined;
    const embedding = embeddingById.get(candidate.entityId);

    return {
      id: candidate.entityId as EntityId,
      type: candidate.entityType,
      path: resolvedPath || undefined,
      embedding: embedding ? Array.from(embedding) : undefined,
      lastAccessed: fn?.lastAccessed ? fn.lastAccessed.getTime() : undefined,
      lastModified: fileInfo ? Date.parse(fileInfo.lastModified) : undefined,
      domains: fileInfo?.mainConcepts?.length ? fileInfo.mainConcepts : undefined,
      owners,
      dependencies: candidate.entityType === 'module'
        ? moduleGraph.dependencies.get(candidate.entityId)
        : resolvedPath
          ? [resolvedPath]
          : undefined,
      dependents: candidate.entityType === 'module'
        ? moduleGraph.dependents.get(candidate.entityId)
        : resolvedPath
          ? [resolvedPath]
          : undefined,
      riskLevel: universal?.riskScore ?? undefined,
      testCoverage: universal?.testCoverage ?? fileInfo?.testCoverage ?? undefined,
      changeFrequency,
      content: buildContent(fn, mod, fileInfo),
      name: fn?.name ?? (mod?.path ? path.basename(mod.path) : undefined),
    } satisfies EntityData;
  });
}

function buildContent(
  fn: FunctionKnowledge | undefined,
  mod: ModuleKnowledge | undefined,
  fileInfo: FileKnowledge | undefined
): string | undefined {
  const parts: string[] = [];
  if (fn) {
    parts.push(fn.signature, fn.purpose);
  }
  if (mod) {
    parts.push(mod.purpose, mod.exports.join(' '));
  }
  if (fileInfo) {
    parts.push(fileInfo.summary, fileInfo.purpose, fileInfo.role);
  }
  const content = parts.filter(Boolean).join(' ');
  return content || undefined;
}

async function loadFunctions(storage: LibrarianStorage, ids: string[]): Promise<FunctionKnowledge[]> {
  const results = await Promise.all(ids.map((id) => storage.getFunction(id).catch((err) => {
    logWarning('[scoring] getFunction failed', { operation: 'getFunction', error: getErrorMessage(err), id });
    return null;
  })));
  return results.filter((value): value is FunctionKnowledge => Boolean(value));
}

async function loadModules(storage: LibrarianStorage, ids: string[]): Promise<ModuleKnowledge[]> {
  const results = await Promise.all(ids.map((id) => storage.getModule(id).catch((err) => {
    logWarning('[scoring] getModule failed', { operation: 'getModule', error: getErrorMessage(err), id });
    return null;
  })));
  return results.filter((value): value is ModuleKnowledge => Boolean(value));
}

async function loadFileKnowledge(
  storage: LibrarianStorage,
  filePaths: Set<string>
): Promise<Map<string, FileKnowledge>> {
  const entries = await Promise.all(
    Array.from(filePaths).map(async (filePath) => {
      const file = await storage.getFileByPath(filePath).catch((err) => {
        logWarning('[scoring] getFileByPath failed', { operation: 'getFileByPath', error: getErrorMessage(err), filePath });
        return null;
      });
      return file ? ([filePath, file] as const) : null;
    })
  );
  const map = new Map<string, FileKnowledge>();
  for (const entry of entries) {
    if (!entry) continue;
    map.set(entry[0], entry[1]);
  }
  return map;
}

async function loadOwnership(
  storage: LibrarianStorage,
  filePaths: Set<string>
): Promise<Map<string, string[]>> {
  const entries = await Promise.all(
    Array.from(filePaths).map(async (filePath) => {
      const owners = await storage.getOwnershipByFilePath(filePath).catch((err) => {
        logWarning('[scoring] getOwnershipByFilePath failed', { operation: 'getOwnershipByFilePath', error: getErrorMessage(err), filePath });
        return [];
      });
      if (!owners.length) return null;
      const sorted = owners
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((owner) => owner.author);
      return [filePath, Array.from(new Set(sorted)).slice(0, 4)] as const;
    })
  );
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry) continue;
    map.set(entry[0], entry[1]);
  }
  return map;
}

async function loadUniversalKnowledge(
  storage: LibrarianStorage,
  filePaths: Set<string>
): Promise<UniversalKnowledgeLookup> {
  const map: UniversalKnowledgeLookup = new Map();
  const entries = await Promise.all(
    Array.from(filePaths).map(async (filePath) => {
      const records = await storage.getUniversalKnowledgeByFile(filePath).catch((err) => {
        logWarning('[scoring] getUniversalKnowledgeByFile failed', { operation: 'getUniversalKnowledgeByFile', error: getErrorMessage(err), filePath });
        return [];
      });
      return { filePath, records };
    })
  );
  for (const { filePath, records } of entries) {
    for (const record of records) {
      if (!record.kind) continue;
      const key = universalKey(filePath, record.kind);
      const existing = map.get(key);
      if (!existing || record.confidence >= existing.confidence) {
        map.set(key, record);
      }
    }
  }
  return map;
}

async function loadEmbeddings(
  storage: LibrarianStorage,
  entityIds: string[]
): Promise<Map<string, Float32Array>> {
  const entries = await Promise.all(
    entityIds.map(async (entityId) => {
      const embedding = await storage.getEmbedding(entityId).catch((err) => {
        logWarning('[scoring] getEmbedding failed', { operation: 'getEmbedding', error: getErrorMessage(err), entityId });
        return null;
      });
      return embedding ? ([entityId, embedding] as const) : null;
    })
  );
  const map = new Map<string, Float32Array>();
  for (const entry of entries) {
    if (!entry) continue;
    map.set(entry[0], entry[1]);
  }
  return map;
}

async function buildModuleGraph(
  storage: LibrarianStorage,
  modules: ModuleKnowledge[],
  moduleById: Map<string, ModuleKnowledge>
): Promise<{ dependencies: Map<string, string[]>; dependents: Map<string, string[]> }> {
  if (!modules.length) return { dependencies: new Map(), dependents: new Map() };
  const moduleIds = modules.map((mod) => mod.id);
  const edgesFrom = await storage.getGraphEdges({
    fromIds: moduleIds,
    edgeTypes: ['imports'],
    fromTypes: ['module'],
    toTypes: ['module'],
  }).catch((err) => {
    logWarning('[scoring] getGraphEdges (from) failed', { operation: 'getGraphEdges', error: getErrorMessage(err), moduleIds });
    return [];
  });
  const edgesTo = await storage.getGraphEdges({
    toIds: moduleIds,
    edgeTypes: ['imports'],
    fromTypes: ['module'],
    toTypes: ['module'],
  }).catch((err) => {
    logWarning('[scoring] getGraphEdges (to) failed', { operation: 'getGraphEdges', error: getErrorMessage(err), moduleIds });
    return [];
  });
  const relatedModuleIds = new Set<string>();
  for (const edge of edgesFrom) relatedModuleIds.add(edge.toId);
  for (const edge of edgesTo) relatedModuleIds.add(edge.fromId);
  const missingIds = Array.from(relatedModuleIds).filter((id) => !moduleById.has(id));
  if (missingIds.length) {
    const missingModules = await loadModules(storage, missingIds);
    for (const mod of missingModules) moduleById.set(mod.id, mod);
  }
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const edge of edgesFrom) {
    const target = moduleById.get(edge.toId);
    if (!target) continue;
    const list = dependencies.get(edge.fromId) ?? [];
    list.push(target.path);
    dependencies.set(edge.fromId, list);
  }
  for (const edge of edgesTo) {
    const source = moduleById.get(edge.fromId);
    if (!source) continue;
    const list = dependents.get(edge.toId) ?? [];
    list.push(source.path);
    dependents.set(edge.toId, list);
  }
  return { dependencies, dependents };
}

async function computeChangeFrequency(
  storage: LibrarianStorage,
  filePaths: Set<string>,
  workspaceRoot: string | null
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!filePaths.size) return map;
  const commits = await storage.getCommits({ limit: 240, orderBy: 'created_at', orderDirection: 'desc' }).catch((err) => {
    logWarning('[scoring] getCommits failed', { operation: 'getCommits', error: getErrorMessage(err) });
    return [];
  });
  if (!commits.length) return map;

  const relativeLookup = new Map<string, string>();
  for (const filePath of filePaths) {
    const relative = workspaceRoot ? normalizePath(path.relative(workspaceRoot, filePath)) : normalizePath(filePath);
    relativeLookup.set(relative, filePath);
  }

  for (const commit of commits) {
    for (const file of commit.filesChanged ?? []) {
      const normalized = normalizePath(file);
      const absolute = relativeLookup.get(normalized);
      if (!absolute) continue;
      map.set(absolute, (map.get(absolute) ?? 0) + 1);
    }
  }
  return map;
}

function resolveCurrentUser(): string | undefined {
  return process.env.USER || process.env.LOGNAME || undefined;
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9_]+/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);
}

function inferPackEntityType(pack: ContextPack): GraphEntityType {
  if (pack.packType === 'function_context') return 'function';
  if (pack.packType === 'module_context') return 'module';
  if (pack.packType === 'change_impact') return 'module';
  return pack.packType === 'similar_tasks' ? 'module' : 'function';
}

function universalKey(filePath: string, kind: string): string {
  return `${filePath}::${kind}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Calculate keyword boost for query terms matching entity path/name.
 * This ensures obvious matches like "bootstrap" -> bootstrap.ts rank highly.
 *
 * The boost is a multiplier applied to the combined score:
 * - 3.0x for exact filename match (e.g., "query" -> query.ts)
 *        Strong enough to overcome any task-type penalty (e.g., guidance 0.4x).
 * - 2.0x for filename contains term (e.g., "bootstrap" -> bootstrap_utils.ts)
 * - 1.3x for path contains term (e.g., "bootstrap" -> src/bootstrap/index.ts)
 * - 1.0x (no boost) otherwise
 */
function computeKeywordBoost(
  queryTerms: string[],
  entityPath: string | undefined,
  entityName: string | undefined
): number {
  if (!queryTerms.length) return 1.0;

  const pathLower = (entityPath ?? '').toLowerCase();
  const nameLower = (entityName ?? '').toLowerCase();

  // Extract filename from path if name not provided
  const filename = nameLower || (pathLower ? path.basename(pathLower).replace(/\.[^.]+$/, '') : '');

  let bestBoost = 1.0;

  for (const term of queryTerms) {
    const termLower = term.toLowerCase();

    // Skip very short terms (likely noise)
    if (termLower.length < 3) continue;

    // Check for exact filename match (highest boost - must overcome task-type penalties)
    if (filename === termLower) {
      bestBoost = Math.max(bestBoost, 3.0);
      continue;
    }

    // Check if filename contains the term
    if (filename.includes(termLower)) {
      bestBoost = Math.max(bestBoost, 2.0);
      continue;
    }

    // Check if path contains the term (as a segment or part of segment)
    const pathSegments = pathLower.split('/');
    const hasPathMatch = pathSegments.some(segment =>
      segment === termLower || segment.includes(termLower)
    );
    if (hasPathMatch) {
      bestBoost = Math.max(bestBoost, 1.3);
    }
  }

  return bestBoost;
}

async function resolveWorkspaceRoot(storage: LibrarianStorage): Promise<string | null> {
  try {
    const metadata = await storage.getMetadata();
    return metadata?.workspace ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a path is from eval-corpus or external test fixtures.
 * These should be heavily penalized in query results.
 */
export function isEvalCorpusPath(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.includes('eval-corpus') ||
         normalizedPath.includes('external-repos') ||
         normalizedPath.includes('test/fixtures') ||
         normalizedPath.includes('test-fixtures');
}
