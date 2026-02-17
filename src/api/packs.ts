import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createDefaultLlmServiceAdapter,
  getLlmServiceAdapter,
  type LlmServiceAdapter,
} from '../adapters/llm_service.js';
import { getErrorMessage } from '../utils/errors.js';
import { logWarning } from '../telemetry/logger.js';
import type { LibrarianStorage, EvolutionOutcome } from '../storage/types.js';
import type {
  ContextPack,
  ContextPackType,
  FunctionKnowledge,
  ModuleKnowledge,
  CodeSnippet,
  LibrarianVersion,
} from '../types.js';
import { LIBRARIAN_VERSION } from '../index.js';
import { getLanguageFromPath } from '../utils/language.js';
import { minimizeSnippet } from './redaction.js';
import { GovernorContext } from './governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from './governors.js';
import { ProviderUnavailableError } from './provider_check.js';
import { noResult } from './empty_values.js';
import { PatternKnowledge } from '../knowledge/patterns.js';
import type { AdrRecord } from '../ingest/adr_indexer.js';

export interface PackGenerationOptions {
  governorContext?: GovernorContext;
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  llmService?: LlmServiceAdapter;
  skipLlm?: boolean;
  maxPacks?: number;
  functions?: FunctionKnowledge[];
  modules?: ModuleKnowledge[];
  includeFunctionPacks?: boolean; includeModulePacks?: boolean;
  includeSupplemental?: boolean;
  force?: boolean;
  version?: LibrarianVersion;
}

export interface PackRankingInput {
  packs: ContextPack[];
  scoreByTarget?: Map<string, number>;
  maxPacks?: number;
  taskType?: string;
  depth?: PackDepth;
}

export interface PackRankingResult {
  packs: ContextPack[];
  averageScore: number;
}

const DEFAULT_MAX_PACKS = 2000;
const SUMMARY_CHAR_LIMIT = 240;
type TaskTaxonomy = 'bug_fix' | 'feature' | 'refactor' | 'review' | 'guidance';
type PackDepth = 'L0' | 'L1' | 'L2' | 'L3';

const DEPTH_PACK_WEIGHTS: Record<PackDepth, Partial<Record<ContextPackType, number>>> = {
  L0: { function_context: 1.2, module_context: 0.9, change_impact: 0.3, decision_context: 0.4, pattern_context: 0.4, similar_tasks: 0.4, doc_context: 0.8, project_understanding: 1.5 },
  L1: { function_context: 1.1, module_context: 1.1, change_impact: 0.8, decision_context: 0.6, pattern_context: 0.7, similar_tasks: 0.6, doc_context: 1.0, project_understanding: 1.8 },
  L2: { function_context: 1.0, module_context: 1.2, change_impact: 1.2, decision_context: 0.8, pattern_context: 0.9, similar_tasks: 0.8, doc_context: 1.2, project_understanding: 2.0 },
  L3: { function_context: 0.9, module_context: 1.2, change_impact: 1.3, decision_context: 1.1, pattern_context: 1.2, similar_tasks: 1.2, doc_context: 1.3, project_understanding: 2.0 },
};

const TASK_PACK_WEIGHTS: Record<TaskTaxonomy, Partial<Record<ContextPackType, number>>> = {
  bug_fix: { function_context: 1.2, module_context: 1.0, change_impact: 0.9, decision_context: 0.7, pattern_context: 0.7, similar_tasks: 0.8, doc_context: 0.5, project_understanding: 0.3 },
  feature: { function_context: 0.9, module_context: 1.3, change_impact: 1.0, decision_context: 0.9, pattern_context: 1.2, similar_tasks: 0.8, doc_context: 1.0, project_understanding: 1.0 },
  refactor: { function_context: 0.8, module_context: 1.1, change_impact: 1.4, decision_context: 0.8, pattern_context: 1.0, similar_tasks: 1.0, doc_context: 0.6, project_understanding: 0.4 },
  review: { function_context: 0.9, module_context: 1.0, change_impact: 1.1, decision_context: 1.2, pattern_context: 1.2, similar_tasks: 1.2, doc_context: 1.1, project_understanding: 0.8 },
  guidance: { function_context: 0.4, module_context: 0.6, change_impact: 0.3, decision_context: 1.0, pattern_context: 0.8, similar_tasks: 0.5, doc_context: 2.0, project_understanding: 2.5 },
};

const BUG_KEYWORDS = ['error', 'exception', 'regression', 'failure', 'bug', 'fix', 'crash', 'panic'];
const FEATURE_KEYWORDS = ['api', 'interface', 'endpoint', 'schema', 'contract', 'workflow', 'ux'];
const REFACTOR_KEYWORDS = ['refactor', 'cleanup', 'rename', 'migrate', 'debt', 'coupling'];
const REVIEW_KEYWORDS = ['review', 'audit', 'risk', 'deprecated', 'anti-pattern', 'lint', 'security'];
const TEST_PATH_HINTS = ['__tests__', '/tests/', '/test/', '.test.', '.spec.'];

export async function generateContextPacks(
  storage: LibrarianStorage,
  options: PackGenerationOptions = {}
): Promise<number> {
  options.governorContext?.checkBudget();
  const functions = options.functions ?? await storage.getFunctions();
  const modules = options.modules ?? await storage.getModules();
  const maxPacks = options.maxPacks ?? DEFAULT_MAX_PACKS;
  const includeFunctionPacks = options.includeFunctionPacks ?? true;
  const includeModulePacks = options.includeModulePacks ?? true;
  const summarizer = createSummarizer(options);
  const functionsByPath = groupFunctionsByPath(functions);
  const force = options.force ?? false;
  const includeSupplemental = options.includeSupplemental ?? true;
  const storedVersion = await storage.getVersion().catch((err) => {
    logWarning('[packs] Failed to retrieve stored version', { error: getErrorMessage(err) });
    return null;
  });
  const version = options.version ?? storedVersion ?? getCurrentVersion();
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  const patternFacts = includeSupplemental ? await collectPatternFacts(storage) : emptyPatternFacts();
  const decisionFacts = includeSupplemental ? await collectDecisionFacts(storage, workspaceRoot) : new Map();
  const taskFacts = includeSupplemental ? await collectSimilarTaskFacts(storage, workspaceRoot) : new Map();
  const tasks: Array<() => Promise<number>> = [];
  const enqueue = (task: () => Promise<number>): void => { if (tasks.length < maxPacks) tasks.push(task); };
  const enqueuePack = (builder: () => Promise<ContextPack | null>): void => enqueue(async () => {
    const pack = await builder();
    if (!pack) return 0;
    pack.version = version;
    await storage.upsertContextPack(pack);
    return 1;
  });
  const runConcurrent = async (queue: Array<() => Promise<number>>, maxConcurrency: number): Promise<number> => {
    if (!queue.length) return 0;
    const workerCount = Math.max(1, Math.min(maxConcurrency, queue.length));
    let index = 0; let created = 0; let failure: unknown = null;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const current = index++;
        if (current >= queue.length || failure) break;
        try {
          created += await queue[current]();
        } catch (error) {
          failure = error;
          break;
        }
      }
    }));
    if (failure) throw failure; return created;
  };
  if (includeFunctionPacks) {
    for (const fn of functions) {
      if (tasks.length >= maxPacks) break;
      if (force || !(await storage.getContextPackForTarget(fn.id, 'function_context'))) enqueuePack(() => buildFunctionPack(fn, summarizer, storage));
    }
  }
  if (includeModulePacks) {
    for (const mod of modules) {
      if (tasks.length >= maxPacks) break;
      if (force || !(await storage.getContextPackForTarget(mod.id, 'module_context'))) enqueuePack(() => buildModulePack(mod, functionsByPath.get(mod.path) ?? [], summarizer, storage));
      if (tasks.length >= maxPacks) break;
      if (force || !(await storage.getContextPackForTarget(mod.id, 'change_impact'))) enqueuePack(() => buildChangeImpactPack(mod, functionsByPath.get(mod.path) ?? [], summarizer, storage));
      if (!includeSupplemental || tasks.length >= maxPacks) continue;
      const patternNotes = patternFacts.patternsByFile.get(mod.path) ?? []; const antiNotes = patternFacts.antiPatternsByFile.get(mod.path) ?? [];
      if (patternNotes.length || antiNotes.length) {
        if (force || !(await storage.getContextPackForTarget(mod.id, 'pattern_context'))) enqueuePack(() => buildPatternPack(mod, patternNotes, antiNotes, summarizer));
      }
      if (tasks.length >= maxPacks) continue;
      const decisions = decisionFacts.get(mod.path) ?? [];
      if (decisions.length) {
        if (force || !(await storage.getContextPackForTarget(mod.id, 'decision_context'))) enqueuePack(() => buildDecisionPack(mod, decisions, summarizer));
      }
      if (tasks.length >= maxPacks) continue;
      const tasksForModule = taskFacts.get(mod.path) ?? [];
      if (tasksForModule.length) {
        if (force || !(await storage.getContextPackForTarget(mod.id, 'similar_tasks'))) enqueuePack(() => buildSimilarTasksPack(mod, tasksForModule, summarizer));
      }
    }
  }
  return runConcurrent(
    tasks,
    options.governorContext?.snapshot().config.maxConcurrentWorkers ?? DEFAULT_GOVERNOR_CONFIG.maxConcurrentWorkers
  );
}

/**
 * Check if a path is from eval-corpus or external test fixtures.
 * These should be heavily penalized in query results to prevent pollution.
 */
function isEvalCorpusPath(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.includes('eval-corpus') ||
         normalizedPath.includes('external-repos') ||
         normalizedPath.includes('test/fixtures') ||
         normalizedPath.includes('test-fixtures');
}

export function rankContextPacks(input: PackRankingInput): PackRankingResult {
  // Default to L1 pack limit (6) for agent ergonomics - reduced from previous 10
  const maxPacks = Math.max(1, input.maxPacks ?? 6);
  const depth = input.depth ?? 'L1';
  const taskType = normalizeTaskType(input.taskType);
  const deduped = new Map<string, ContextPack>();
  for (const pack of input.packs) {
    if (!deduped.has(pack.packId)) deduped.set(pack.packId, pack);
  }

  const scored = Array.from(deduped.values()).map((pack) => {
    const score = resolvePackScore(pack, input.scoreByTarget);
    const weightedScore = applyPersonaWeight(pack, score, depth, taskType);

    // Apply heavy penalty (0.1x) to eval-corpus and test fixture paths
    // This is defense-in-depth for any already-indexed files that should be excluded
    const hasEvalCorpusFile = pack.relatedFiles.some(isEvalCorpusPath);
    const finalScore = hasEvalCorpusFile ? weightedScore * 0.1 : weightedScore;

    return { pack, score: finalScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxPacks).map((entry) => entry.pack);
  const averageScore = selected.length
    ? scored.slice(0, maxPacks).reduce((sum, entry) => sum + entry.score, 0) / selected.length
    : 0;

  return { packs: selected, averageScore };
}

function normalizeTaskType(taskType?: string): TaskTaxonomy {
  const normalized = (taskType ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'feature';
  // Guidance/meta queries should boost documentation and project understanding
  // Project-level queries like "what does this do" should also use guidance
  if (normalized.includes('guidance') || normalized.includes('meta') || normalized.includes('how_to') ||
      normalized.includes('overview') || normalized.includes('understand') || normalized.includes('learn') ||
      normalized.includes('documentation') || normalized.includes('agent') ||
      normalized.includes('project') || normalized.includes('purpose') || normalized.includes('architecture') ||
      normalized.includes('codebase') || normalized.includes('what_does')) return 'guidance';
  if (normalized.includes('bug') || normalized.includes('fix') || normalized.includes('issue')) return 'bug_fix';
  if (normalized.includes('refactor') || normalized.includes('cleanup') || normalized.includes('migrate')) return 'refactor';
  if (normalized.includes('review') || normalized.includes('audit') || normalized.includes('analysis')) return 'review';
  return 'feature';
}

function applyPersonaWeight(
  pack: ContextPack,
  score: number,
  depth: PackDepth,
  taskType: TaskTaxonomy
): number {
  const depthWeights = DEPTH_PACK_WEIGHTS[depth] ?? {};
  const taskWeights = TASK_PACK_WEIGHTS[taskType] ?? {};
  const depthWeight = depthWeights[pack.packType] ?? 1;
  const taskWeight = taskWeights[pack.packType] ?? 1;
  const boost = computePersonaBoost(pack, taskType);
  const rawWeight = depthWeight * taskWeight + boost;
  const clamped = Math.max(0.2, Math.min(2.5, rawWeight));
  return score * clamped;
}

function computePersonaBoost(pack: ContextPack, taskType: TaskTaxonomy): number {
  const text = `${pack.summary} ${pack.keyFacts.join(' ')}`.toLowerCase();
  const files = pack.relatedFiles.join(' ').toLowerCase();
  let boost = 0;

  if (taskType === 'bug_fix') {
    if (containsAny(text, BUG_KEYWORDS)) boost += 0.2;
    if (containsAny(files, TEST_PATH_HINTS)) boost += 0.12;
  } else if (taskType === 'feature') {
    if (containsAny(text, FEATURE_KEYWORDS)) boost += 0.12;
    if (text.includes('exports:') || text.includes('public')) boost += 0.05;
  } else if (taskType === 'refactor') {
    if (containsAny(text, REFACTOR_KEYWORDS)) boost += 0.12;
    if (extractDependencyCount(pack.keyFacts) >= 4) boost += 0.1;
  } else if (taskType === 'review') {
    if (containsAny(text, REVIEW_KEYWORDS)) boost += 0.12;
    if (text.includes('gotcha') || text.includes('risk')) boost += 0.08;
  }

  return boost;
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function extractDependencyCount(keyFacts: string[]): number {
  for (const fact of keyFacts) {
    if (!fact.toLowerCase().startsWith('dependencies:')) continue;
    const remainder = fact.split(':').slice(1).join(':').trim();
    if (!remainder || remainder === 'none') return 0;
    return remainder.split(',').map((entry) => entry.trim()).filter(Boolean).length;
  }
  return 0;
}

interface FunctionGraphContext {
  callers: string[];
  callees: string[];
  pageRank?: number;
  centrality?: number;
}

async function getFunctionGraphContext(
  fn: FunctionKnowledge,
  storage: LibrarianStorage | null
): Promise<FunctionGraphContext> {
  const result: FunctionGraphContext = { callers: [], callees: [] };
  if (!storage) return result;

  try {
    // Get graph edges for this function
    const edges = await storage.getGraphEdges({
      edgeTypes: ['calls'],
      limit: 50,
    });

    const fnId = fn.id;
    const fnPathId = `${fn.filePath}:${fn.name}`;

    for (const edge of edges) {
      // Check if this function is called by others (incoming calls)
      if (edge.toId === fnId || edge.toId === fnPathId || edge.toId === fn.name) {
        const callerName = extractEntityName(edge.fromId);
        if (callerName && !result.callers.includes(callerName)) {
          result.callers.push(callerName);
        }
      }
      // Check if this function calls others (outgoing calls)
      if (edge.fromId === fnId || edge.fromId === fnPathId || edge.fromId === fn.name) {
        const calleeName = extractEntityName(edge.toId);
        if (calleeName && !result.callees.includes(calleeName)) {
          result.callees.push(calleeName);
        }
      }
    }

    // Try to get graph metrics for PageRank/centrality
    const metrics = await storage.getGraphMetrics({ entityIds: [fnId], limit: 1 });
    if (metrics.length > 0) {
      result.pageRank = metrics[0].pagerank;
      result.centrality = metrics[0].betweenness;
    }
  } catch {
    // Graph context is optional - fail silently
  }

  return result;
}

function extractEntityName(id: string): string {
  // Extract readable name from various ID formats
  // Format: "path/to/file.ts:functionName" -> "functionName"
  // Format: "functionName" -> "functionName"
  // Format: "path/to/file.ts" -> "file.ts"
  if (id.includes(':')) {
    return id.split(':').pop() || id;
  }
  if (id.includes('/')) {
    return path.basename(id);
  }
  return id;
}

function extractReturnType(signature: string): string | null {
  // Extract return type from TypeScript/JavaScript signature
  // Format: "function name(args): ReturnType" -> "ReturnType"
  // Format: "(args) => ReturnType" -> "ReturnType"
  // Format: "name(args): Promise<T>" -> "Promise<T>"
  const colonMatch = signature.match(/\):\s*(.+)$/);
  if (colonMatch) {
    return colonMatch[1].trim();
  }
  const arrowMatch = signature.match(/=>\s*(.+)$/);
  if (arrowMatch) {
    return arrowMatch[1].trim();
  }
  return null;
}

async function buildFunctionPack(
  fn: FunctionKnowledge,
  summarizer: PackSummarizer,
  storage: LibrarianStorage | null = null
): Promise<ContextPack> {
  const snippet = await loadFunctionSnippet(fn);
  const summaryFallback = fn.purpose || `Function ${fn.name} in ${path.basename(fn.filePath)}`;
  const summary = await summarizer.summarize('function', buildFunctionSummaryInput(fn), summaryFallback);
  // Use path-based targetId to align with embedding entity_id format
  // This enables semantic search results to match context packs
  const targetId = `${fn.filePath}:${fn.name}`;

  // Get graph context for semantic facts
  const graphContext = await getFunctionGraphContext(fn, storage);

  // Build semantic keyFacts
  const keyFacts: string[] = [];

  // Always include signature (useful for understanding the function)
  keyFacts.push(`Signature: ${fn.signature}`);

  // Add purpose if available (most useful fact for agents)
  if (fn.purpose) {
    keyFacts.push(`Purpose: ${fn.purpose}`);
  }

  // Extract and add return type
  const returnType = extractReturnType(fn.signature);
  if (returnType) {
    keyFacts.push(`Returns: ${returnType}`);
  }

  // Add caller information (who uses this function)
  if (graphContext.callers.length > 0) {
    const callerList = graphContext.callers.slice(0, 5).join(', ');
    const suffix = graphContext.callers.length > 5 ? ` (+${graphContext.callers.length - 5} more)` : '';
    keyFacts.push(`Called by: ${callerList}${suffix}`);
  }

  // Add callee information (what this function calls)
  if (graphContext.callees.length > 0) {
    const calleeList = graphContext.callees.slice(0, 5).join(', ');
    const suffix = graphContext.callees.length > 5 ? ` (+${graphContext.callees.length - 5} more)` : '';
    keyFacts.push(`Calls: ${calleeList}${suffix}`);
  }

  // Add importance metrics if available
  if (graphContext.pageRank !== undefined && graphContext.pageRank > 0.01) {
    const importance = graphContext.pageRank >= 0.1 ? 'high' : graphContext.pageRank >= 0.05 ? 'medium' : 'low';
    keyFacts.push(`Importance: ${importance} (PageRank: ${graphContext.pageRank.toFixed(3)})`);
  }

  // Add file context (simplified)
  keyFacts.push(`File: ${path.basename(fn.filePath)}`);

  return {
    packId: randomUUID(),
    packType: 'function_context',
    targetId,
    summary,
    keyFacts,
    codeSnippets: snippet ? [snippet] : [],
    relatedFiles: [fn.filePath],
    confidence: fn.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: [fn.filePath],
  };
}

interface ModuleGraphContext {
  importedByCount: number;
  importsCount: number;
  pageRank?: number;
  centrality?: number;
  isBridge?: boolean;
}

async function getModuleGraphContext(
  mod: ModuleKnowledge,
  storage: LibrarianStorage | null
): Promise<ModuleGraphContext> {
  const result: ModuleGraphContext = { importedByCount: 0, importsCount: mod.dependencies.length };
  if (!storage) return result;

  try {
    // Get edges where this module is imported by others
    const incomingEdges = await storage.getGraphEdges({
      toIds: [mod.id, mod.path],
      edgeTypes: ['imports'],
      limit: 100,
    });
    result.importedByCount = incomingEdges.length;

    // Try to get graph metrics
    const metrics = await storage.getGraphMetrics({ entityIds: [mod.id], limit: 1 });
    if (metrics.length > 0) {
      result.pageRank = metrics[0].pagerank;
      result.centrality = metrics[0].betweenness;
      result.isBridge = metrics[0].isBridge;
    }
  } catch {
    // Graph context is optional
  }

  return result;
}

function categorizeExports(exports: string[]): { types: string[]; functions: string[]; constants: string[] } {
  const types: string[] = [];
  const functions: string[] = [];
  const constants: string[] = [];

  for (const exp of exports) {
    // Heuristic categorization based on naming conventions
    if (exp.startsWith('I') && exp[1] && exp[1] === exp[1].toUpperCase()) {
      // Interface (e.g., IStorage, IConfig)
      types.push(exp);
    } else if (exp[0] === exp[0].toUpperCase() && !exp.includes('_')) {
      // PascalCase - likely a type, class, or React component
      types.push(exp);
    } else if (exp === exp.toUpperCase()) {
      // ALL_CAPS - likely a constant
      constants.push(exp);
    } else {
      // camelCase - likely a function
      functions.push(exp);
    }
  }

  return { types, functions, constants };
}

async function buildModulePack(
  mod: ModuleKnowledge,
  functions: FunctionKnowledge[],
  summarizer: PackSummarizer,
  storage: LibrarianStorage | null = null
): Promise<ContextPack> {
  const snippet = await loadModuleSnippet(mod.path);
  const summaryFallback = mod.purpose || `Module ${path.basename(mod.path, path.extname(mod.path))}`;
  const summary = await summarizer.summarize('module', buildModuleSummaryInput(mod, functions), summaryFallback);
  const relatedFiles = collectRelatedFiles(mod);
  // Use path-based targetId to align with embedding entity_id format
  // This enables semantic search results to match context packs
  const targetId = mod.path;

  // Get graph context for semantic facts
  const graphContext = await getModuleGraphContext(mod, storage);
  const exportCategories = categorizeExports(mod.exports);

  // Build semantic keyFacts
  const keyFacts: string[] = [];

  // Add purpose if available (most useful for agents)
  if (mod.purpose) {
    keyFacts.push(`Purpose: ${mod.purpose}`);
  }

  // Categorized exports (more useful than raw list)
  if (exportCategories.functions.length > 0) {
    const fnList = exportCategories.functions.slice(0, 4).join(', ');
    const suffix = exportCategories.functions.length > 4 ? ` (+${exportCategories.functions.length - 4} more)` : '';
    keyFacts.push(`Exports functions: ${fnList}${suffix}`);
  }
  if (exportCategories.types.length > 0) {
    const typeList = exportCategories.types.slice(0, 4).join(', ');
    const suffix = exportCategories.types.length > 4 ? ` (+${exportCategories.types.length - 4} more)` : '';
    keyFacts.push(`Exports types: ${typeList}${suffix}`);
  }
  if (exportCategories.constants.length > 0) {
    const constList = exportCategories.constants.slice(0, 3).join(', ');
    const suffix = exportCategories.constants.length > 3 ? ` (+${exportCategories.constants.length - 3} more)` : '';
    keyFacts.push(`Exports constants: ${constList}${suffix}`);
  }

  // Import/dependency summary (count is more useful than list of paths)
  if (mod.dependencies.length > 0) {
    const localDeps = mod.dependencies.filter(d => d.startsWith('.') || d.startsWith('/'));
    const externalDeps = mod.dependencies.filter(d => !d.startsWith('.') && !d.startsWith('/'));
    const parts: string[] = [];
    if (localDeps.length > 0) parts.push(`${localDeps.length} local`);
    if (externalDeps.length > 0) parts.push(`${externalDeps.length} external`);
    keyFacts.push(`Imports: ${parts.join(', ')} modules`);
  }

  // Usage information (who imports this module)
  if (graphContext.importedByCount > 0) {
    keyFacts.push(`Imported by: ${graphContext.importedByCount} modules`);
  }

  // Key functions in this module
  if (functions.length > 0) {
    const fnNames = functions.map(fn => fn.name).slice(0, 5).join(', ');
    const suffix = functions.length > 5 ? ` (+${functions.length - 5} more)` : '';
    keyFacts.push(`Contains: ${fnNames}${suffix}`);
  }

  // Structural importance
  if (graphContext.isBridge) {
    keyFacts.push('Role: Bridge module (connects different parts of codebase)');
  } else if (graphContext.pageRank !== undefined && graphContext.pageRank >= 0.05) {
    keyFacts.push(`Role: Core module (high PageRank: ${graphContext.pageRank.toFixed(3)})`);
  }

  return {
    packId: randomUUID(),
    packType: 'module_context',
    targetId,
    summary,
    keyFacts,
    codeSnippets: snippet ? [snippet] : [],
    relatedFiles,
    confidence: mod.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: relatedFiles,
  };
}

async function buildChangeImpactPack(
  mod: ModuleKnowledge,
  functions: FunctionKnowledge[],
  summarizer: PackSummarizer,
  storage: LibrarianStorage | null = null
): Promise<ContextPack> {
  const relatedFiles = collectRelatedFiles(mod);
  const summaryFallback = `Changing ${path.basename(mod.path)} may affect ${relatedFiles.slice(0, 3).join(', ') || 'dependent modules'}`;
  const summary = await summarizer.summarize('change_impact', buildImpactSummaryInput(mod, functions), summaryFallback);
  // Use path-based targetId to align with embedding entity_id format
  const targetId = mod.path;

  // Get graph context for impact analysis
  const graphContext = await getModuleGraphContext(mod, storage);

  // Build semantic keyFacts focused on change impact
  const keyFacts: string[] = [];

  // Impact radius (most important for change impact)
  if (graphContext.importedByCount > 0) {
    const riskLevel = graphContext.importedByCount >= 20 ? 'high' : graphContext.importedByCount >= 5 ? 'medium' : 'low';
    keyFacts.push(`Impact radius: ${graphContext.importedByCount} modules depend on this (${riskLevel} risk)`);
  } else {
    keyFacts.push('Impact radius: No direct dependents (isolated module)');
  }

  // Public API changes - what exports could break consumers
  if (mod.exports.length > 0) {
    const exportList = mod.exports.slice(0, 5).join(', ');
    const suffix = mod.exports.length > 5 ? ` (+${mod.exports.length - 5} more)` : '';
    keyFacts.push(`Breaking change risk: ${exportList}${suffix}`);
  }

  // Functions that may need updating
  if (functions.length > 0) {
    const publicFns = functions.filter(fn => mod.exports.includes(fn.name));
    if (publicFns.length > 0) {
      const fnList = publicFns.map(fn => fn.name).slice(0, 4).join(', ');
      keyFacts.push(`Public functions: ${fnList}`);
    }
  }

  // Downstream dependencies (what this module depends on)
  if (mod.dependencies.length > 0) {
    const localDeps = mod.dependencies.filter(d => d.startsWith('.') || d.startsWith('/'));
    if (localDeps.length > 0) {
      keyFacts.push(`Depends on: ${localDeps.length} local modules (changes there affect this)`);
    }
  }

  // Bridge module warning
  if (graphContext.isBridge) {
    keyFacts.push('Warning: Bridge module - changes may cascade across codebase sections');
  }

  // High centrality warning
  if (graphContext.centrality !== undefined && graphContext.centrality >= 0.1) {
    keyFacts.push(`Centrality: High (${graphContext.centrality.toFixed(3)}) - critical path for many modules`);
  }

  return {
    packId: randomUUID(),
    packType: 'change_impact',
    targetId,
    summary,
    keyFacts,
    codeSnippets: [],
    relatedFiles,
    confidence: mod.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: relatedFiles,
  };
}

async function buildPatternPack(
  mod: ModuleKnowledge,
  patterns: string[],
  antiPatterns: string[],
  summarizer: PackSummarizer
): Promise<ContextPack | null> {
  const relatedFiles = collectRelatedFiles(mod);
  const entries = [...patterns, ...antiPatterns];
  if (!entries.length) return noResult();
  const summaryFallback = `Patterns in ${path.basename(mod.path)}: ${entries.slice(0, 2).join('; ')}`;
  const summary = await summarizer.summarize(
    'pattern_context',
    buildPatternSummaryInput(mod, patterns, antiPatterns),
    summaryFallback
  );
  // Use path-based targetId to align with embedding entity_id format
  const targetId = mod.path;
  return {
    packId: randomUUID(),
    packType: 'pattern_context',
    targetId,
    summary,
    keyFacts: [
      `Module: ${mod.path}`,
      patterns.length ? `Patterns: ${formatList(patterns, 6)}` : '',
      antiPatterns.length ? `Anti-patterns: ${formatList(antiPatterns, 4)}` : '',
      `ID: ${mod.id}`, // Keep original ID for reference
    ].filter(Boolean),
    codeSnippets: [],
    relatedFiles,
    confidence: Math.min(0.9, mod.confidence),
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: relatedFiles,
  };
}

async function buildDecisionPack(
  mod: ModuleKnowledge,
  decisions: string[],
  summarizer: PackSummarizer
): Promise<ContextPack | null> {
  if (!decisions.length) return noResult();
  const relatedFiles = collectRelatedFiles(mod);
  const summaryFallback = `Decisions for ${path.basename(mod.path)}: ${decisions[0]}`;
  const summary = await summarizer.summarize(
    'decision_context',
    buildDecisionSummaryInput(mod, decisions),
    summaryFallback
  );
  // Use path-based targetId to align with embedding entity_id format
  const targetId = mod.path;
  return {
    packId: randomUUID(),
    packType: 'decision_context',
    targetId,
    summary,
    keyFacts: [
      `Module: ${mod.path}`,
      `Decisions: ${formatList(decisions, 6)}`,
      `ID: ${mod.id}`, // Keep original ID for reference
    ],
    codeSnippets: [],
    relatedFiles,
    confidence: Math.min(0.9, mod.confidence),
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: relatedFiles,
  };
}

async function buildSimilarTasksPack(
  mod: ModuleKnowledge,
  tasks: string[],
  summarizer: PackSummarizer
): Promise<ContextPack | null> {
  if (!tasks.length) return noResult();
  const relatedFiles = collectRelatedFiles(mod);
  const summaryFallback = `Similar tasks touching ${path.basename(mod.path)}: ${tasks[0]}`;
  const summary = await summarizer.summarize(
    'similar_tasks',
    buildTaskSummaryInput(mod, tasks),
    summaryFallback
  );
  // Use path-based targetId to align with embedding entity_id format
  const targetId = mod.path;
  return {
    packId: randomUUID(),
    packType: 'similar_tasks',
    targetId,
    summary,
    keyFacts: [
      `Module: ${mod.path}`,
      `Recent tasks: ${formatList(tasks, 6)}`,
      `ID: ${mod.id}`, // Keep original ID for reference
    ],
    codeSnippets: [],
    relatedFiles,
    confidence: Math.min(0.85, mod.confidence),
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: relatedFiles,
  };
}

async function loadFunctionSnippet(fn: FunctionKnowledge): Promise<CodeSnippet | null> {
  try {
    const content = await fs.readFile(fn.filePath, 'utf8');
    const lines = content.split('\n');
    const startIdx = Math.max(0, fn.startLine - 1);
    const endIdx = Math.min(lines.length, fn.endLine);
    const snippet = lines.slice(startIdx, endIdx).join('\n');
    const minimized = minimizeSnippet(snippet);
    return {
      filePath: fn.filePath,
      startLine: fn.startLine,
      endLine: fn.endLine,
      content: minimized.text,
      language: getLanguage(fn.filePath),
    };
  } catch {
    return noResult();
  }
}

async function loadModuleSnippet(filePath: string): Promise<CodeSnippet | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const snippet = lines.slice(0, Math.min(lines.length, 40)).join('\n');
    const minimized = minimizeSnippet(snippet);
    return {
      filePath,
      startLine: 1,
      endLine: Math.min(lines.length, 40),
      content: minimized.text,
      language: getLanguage(filePath),
    };
  } catch {
    return noResult();
  }
}

function buildFunctionSummaryInput(fn: FunctionKnowledge): string {
  return [
    `Function: ${fn.name}`,
    `Signature: ${fn.signature}`,
    fn.purpose ? `Purpose: ${fn.purpose}` : '',
    `File: ${fn.filePath}`,
  ].filter(Boolean).join('\n');
}

function buildModuleSummaryInput(mod: ModuleKnowledge, functions: FunctionKnowledge[]): string {
  return [
    `Module: ${mod.path}`,
    mod.purpose ? `Purpose: ${mod.purpose}` : '',
    `Exports: ${mod.exports.join(', ') || 'none'}`,
    `Dependencies: ${mod.dependencies.join(', ') || 'none'}`,
    `Functions: ${functions.map((fn) => fn.name).join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');
}

function buildImpactSummaryInput(mod: ModuleKnowledge, functions: FunctionKnowledge[]): string {
  return [
    `Module: ${mod.path}`,
    `Exports: ${mod.exports.join(', ') || 'none'}`,
    `Dependencies: ${mod.dependencies.join(', ') || 'none'}`,
    `Functions: ${functions.map((fn) => fn.name).join(', ') || 'none'}`,
  ].join('\n');
}

function collectRelatedFiles(mod: ModuleKnowledge): string[] {
  const related = new Set<string>();
  related.add(mod.path);
  for (const dep of mod.dependencies) {
    if (dep.startsWith('.')) {
      related.add(path.resolve(path.dirname(mod.path), dep));
    } else if (dep.startsWith('/')) {
      related.add(dep);
    }
  }
  return Array.from(related);
}

type PatternFacts = { patternsByFile: Map<string, string[]>; antiPatternsByFile: Map<string, string[]> };

function emptyPatternFacts(): PatternFacts {
  return { patternsByFile: new Map(), antiPatternsByFile: new Map() };
}

async function collectPatternFacts(storage: LibrarianStorage): Promise<PatternFacts> {
  const facts = emptyPatternFacts();
  const patterns = new PatternKnowledge(storage);
  const queries: Array<{ type: 'design_patterns' | 'error_handling' | 'async_patterns' | 'testing_patterns'; minOccurrences?: number }> = [
    { type: 'design_patterns', minOccurrences: 2 },
    { type: 'error_handling' },
    { type: 'async_patterns' },
    { type: 'testing_patterns' },
  ];

  for (const query of queries) {
    const result = await patterns.query(query);
    for (const pattern of result.patterns ?? []) {
      const summary = `${pattern.name}: ${pattern.description}`;
      for (const occurrence of pattern.occurrences) {
        addFact(facts.patternsByFile, occurrence.file, summary);
      }
    }
  }

  const anti = await patterns.query({ type: 'anti_patterns' });
  for (const antiPattern of anti.antiPatterns ?? []) {
    const summary = `${antiPattern.name} (${antiPattern.severity}): ${antiPattern.description}`;
    for (const occurrence of antiPattern.occurrences) {
      addFact(facts.antiPatternsByFile, occurrence.file, summary);
    }
  }

  return facts;
}

async function collectDecisionFacts(storage: LibrarianStorage, workspaceRoot: string | null): Promise<Map<string, string[]>> {
  const decisions = new Map<string, string[]>();
  const items = await storage.getIngestionItems({ sourceType: 'adr', limit: 200 });
  for (const item of items) {
    if (!isAdrPayload(item.payload)) continue;
    const adr = item.payload;
    const summary = buildAdrSummary(adr);
    const files = adr.relatedFiles?.length ? adr.relatedFiles : [adr.path];
    for (const file of files) {
      const resolved = resolveWorkspacePath(workspaceRoot, file);
      if (!resolved) continue;
      addFact(decisions, resolved, summary);
    }
  }
  return decisions;
}

async function collectSimilarTaskFacts(storage: LibrarianStorage, workspaceRoot: string | null): Promise<Map<string, string[]>> {
  const tasks = new Map<string, string[]>();
  const outcomes = await storage.getEvolutionOutcomes({ limit: 200, orderBy: 'timestamp', orderDirection: 'desc' });
  for (const outcome of outcomes) {
    if (!outcome.filesChanged?.length) continue;
    const summary = buildTaskSummary(outcome);
    for (const file of outcome.filesChanged) {
      const resolved = resolveWorkspacePath(workspaceRoot, file);
      if (!resolved) continue;
      addFact(tasks, resolved, summary);
    }
  }
  return tasks;
}

async function resolveWorkspaceRoot(storage: LibrarianStorage): Promise<string | null> {
  try {
    const metadata = await storage.getMetadata();
    if (metadata?.workspace) return metadata.workspace;
  } catch {
    // ignore
  }
  return null;
}

function resolveWorkspacePath(workspaceRoot: string | null, filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  if (!workspaceRoot) return normalized;
  if (path.isAbsolute(normalized)) return path.resolve(normalized);
  return path.resolve(workspaceRoot, normalized);
}

function addFact(map: Map<string, string[]>, key: string, value: string): void {
  if (!key || !value) return;
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  if (list.length > 8) list.length = 8;
  map.set(key, list);
}

function buildPatternSummaryInput(mod: ModuleKnowledge, patterns: string[], antiPatterns: string[]): string {
  return [
    `Module: ${mod.path}`,
    patterns.length ? `Patterns: ${patterns.join('; ')}` : '',
    antiPatterns.length ? `Anti-patterns: ${antiPatterns.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function buildDecisionSummaryInput(mod: ModuleKnowledge, decisions: string[]): string {
  return [
    `Module: ${mod.path}`,
    'Decisions:',
    decisions.join('\n'),
  ].join('\n');
}

function buildTaskSummaryInput(mod: ModuleKnowledge, tasks: string[]): string {
  return [
    `Module: ${mod.path}`,
    'Similar tasks:',
    tasks.join('\n'),
  ].join('\n');
}

function buildAdrSummary(adr: AdrRecord): string {
  const detail = adr.summary || adr.decision || adr.context || 'Decision recorded';
  const status = adr.status ? ` (${adr.status})` : '';
  return `ADR${status}: ${adr.title} - ${detail}`;
}

function buildTaskSummary(outcome: EvolutionOutcome): string {
  const status = outcome.success ? 'success' : 'failure';
  const quality = Number.isFinite(outcome.qualityScore) ? `, quality ${(outcome.qualityScore * 100).toFixed(0)}%` : '';
  const duration = Number.isFinite(outcome.durationMs) && outcome.durationMs > 0 ? `, ${Math.round(outcome.durationMs / 1000)}s` : '';
  return `${outcome.taskType} (${status}${quality}${duration})`;
}

function formatList(items: string[], limit: number): string {
  const trimmed = items.map((item) => item.trim()).filter(Boolean);
  if (trimmed.length <= limit) return trimmed.join('; ');
  return `${trimmed.slice(0, limit).join('; ')} (+${trimmed.length - limit} more)`;
}

function isAdrPayload(value: unknown): value is AdrRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === 'string' && typeof record.title === 'string';
}

function groupFunctionsByPath(functions: FunctionKnowledge[]): Map<string, FunctionKnowledge[]> {
  const map = new Map<string, FunctionKnowledge[]>();
  for (const fn of functions) {
    const list = map.get(fn.filePath) ?? [];
    list.push(fn);
    map.set(fn.filePath, list);
  }
  return map;
}

class PackSummarizer {
  private readonly llm: LlmServiceAdapter | null;
  private readonly provider: 'claude' | 'codex' | null;
  private readonly modelId: string | null;
  private readonly governor: GovernorContext | null;
  private readonly skipLlm: boolean;

  constructor(options: PackGenerationOptions) {
    this.provider = options.llmProvider ?? null;
    this.modelId = options.llmModelId ?? null;
    this.skipLlm = options.skipLlm ?? false;
    const canUseLlm = !this.skipLlm && Boolean(this.provider && this.modelId);
    this.llm = canUseLlm
      ? (options.llmService ?? getLlmServiceAdapter() ?? createDefaultLlmServiceAdapter())
      : null;
    this.governor = options.governorContext ?? (canUseLlm ? new GovernorContext({
      phase: 'context_pack_generation',
      config: DEFAULT_GOVERNOR_CONFIG,
    }) : null);
  }

  async summarize(kind: string, input: string, fallback: string): Promise<string> {
    if (this.skipLlm) return coerceSummary(fallback, fallback);
    if (!this.llm || !this.provider || !this.modelId) {
      // LLM is REQUIRED - no bypass allowed
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): Context pack generation requires live LLM providers. There is no non-agentic mode.',
        missing: ['context_pack_llm_not_configured'],
        suggestion: 'Authenticate via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`) and set LLM provider/model env vars. LLM providers are mandatory.',
      });
    }
    this.governor?.checkBudget();
    const prompt = [
      `Summarize the ${kind} context in 1-2 sentences.`,
      'Keep it concise and grounded in the input.',
      '',
      input,
    ].join('\n');
    try {
      const response = await this.llm.chat({
        provider: this.provider,
        modelId: this.modelId,
        messages: [
          { role: 'system', content: 'You summarize code context for retrieval packs.' },
          { role: 'user', content: prompt },
        ],
        governorContext: this.governor ?? undefined,
      });
      return coerceSummary(response.content, fallback);
    } catch (error: unknown) {
      if (isBudgetExceeded(error)) throw error;
      // LLM errors must propagate - no graceful degradation
      const message = getErrorMessage(error);
      if (message.includes('provider_unavailable') || message.includes('No LLM providers available')) {
        throw new ProviderUnavailableError({
          message: 'unverified_by_trace(provider_unavailable): Context pack generation requires live LLM providers. There is no non-agentic mode.',
          missing: [message],
          suggestion: 'Authenticate via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`). LLM providers are mandatory.',
        });
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }
}

function createSummarizer(options: PackGenerationOptions): PackSummarizer {
  return new PackSummarizer(options);
}

function coerceSummary(text: string, fallback: string): string {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= SUMMARY_CHAR_LIMIT) return cleaned;
  return cleaned.slice(0, SUMMARY_CHAR_LIMIT).trim();
}

function resolvePackScore(pack: ContextPack, scoreByTarget?: Map<string, number>): number {
  const defaultScore = pack.confidence;
  if (!scoreByTarget || scoreByTarget.size === 0) return defaultScore;
  const keyVariants = [pack.targetId, `${pack.packType}:${pack.targetId}`];
  let targetScore: number | undefined;
  for (const key of keyVariants) {
    const value = scoreByTarget.get(key);
    if (typeof value === 'number') {
      targetScore = value;
      break;
    }
  }
  if (typeof targetScore !== 'number') return defaultScore;
  return (targetScore * 0.7) + (defaultScore * 0.3);
}

function isBudgetExceeded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('unverified_by_trace(budget_exhausted)');
}

function getLanguage(filePath: string): string {
  const fallback = path.extname(filePath).toLowerCase().replace(/^\./, '') || 'plaintext';
  const language = getLanguageFromPath(filePath, 'text');
  return language === 'text' ? fallback : language;
}

function getCurrentVersion(): LibrarianVersion {
  return {
    major: LIBRARIAN_VERSION.major,
    minor: LIBRARIAN_VERSION.minor,
    patch: LIBRARIAN_VERSION.patch,
    string: LIBRARIAN_VERSION.string,
    qualityTier: 'full',
    indexedAt: new Date(),
    indexerVersion: LIBRARIAN_VERSION.string,
    features: [...LIBRARIAN_VERSION.features],
  };
}
