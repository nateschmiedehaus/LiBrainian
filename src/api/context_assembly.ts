import { randomUUID } from 'node:crypto';
import type { LibrarianQuery, LibrarianResponse, ContextPack, CodeSnippet } from '../types.js';
import { resolveContextLevel, type ContextLevel } from './context_levels.js';
import { enforceTokenBudget } from './token_budget.js';
import { createQueryInterface, type QueryInterface, type QueryRunner } from './query_interface.js';
import { getCurrentGitSha } from '../utils/git.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import { assembleIntentConditionedPacks } from './query_conditioned_assembly.js';

export interface FileKnowledge {
  filePath: string;
  summary: string;
  keyFacts: string[];
  snippets: CodeSnippet[];
  confidence: number;
  packIds: string[];
}

export interface CallEdge { from: string; to: string; sourceFile?: string; sourceLine?: number | null; confidence?: number; }
export interface ImportEdge { from: string; to: string; sourceFile?: string; confidence?: number; }
export interface TestMapping { file: string; tests: string[]; }
export interface OwnerMapping { file: string; owners: string[]; }
export interface ChangeContext { summary: string; relatedFiles: string[]; packId: string; }
export interface PatternMatch { summary: string; packId: string; relatedFiles: string[]; }
export interface AntiPatternMatch { summary: string; packId: string; relatedFiles: string[]; }
export interface SimilarTaskMatch { summary: string; packId: string; relatedFiles: string[]; }
export interface KnowledgeGap { description: string; }
export interface LowConfidenceItem { filePath: string; confidence: number; }
/**
 * Reference to a knowledge source with explicit map codes.
 * Per UNDERSTANDING_LAYER mandate: knowledge maps must be explicitly surfaced.
 */
export interface KnowledgeSourceRef {
  id: string;
  sourceType: string;
  summary: string;
  relatedFiles: string[];
  highlights: string[];
  confidence: number;
  /** Explicit MAP codes this knowledge source relates to (MAP.ARCH, MAP.DEP, etc.) */
  mapCodes?: string[];
  /** Knowledge category (architecture, impact, quality, patterns, structure, evolution) */
  category?: string;
}

export interface ContextConstraints {
  level: ContextLevel;
  maxTokens: number;
  usedTokens: number;
  truncated: boolean;
  truncationSteps: string[];
}

export interface AgentKnowledgeContext {
  contextId: string;
  generatedAt: string;
  knowledgeVersion: string;
  codeVersion: string | null;
  providedFiles: string[];
  required: {
    targetFiles: FileKnowledge[];
    callGraph: CallEdge[];
    importGraph: ImportEdge[];
    testMapping: TestMapping[];
    ownerMapping: OwnerMapping[];
  };
  supplementary: {
    relatedFiles: FileKnowledge[];
    recentChanges: ChangeContext[];
    patterns: PatternMatch[];
    antiPatterns: AntiPatternMatch[];
    similarTasks: SimilarTaskMatch[];
    knowledgeSources: KnowledgeSourceRef[];
  };
  coverage: {
    percentage: number;
    gaps: KnowledgeGap[];
    lowConfidence: LowConfidenceItem[];
  };
  query: QueryInterface;
  constraints: ContextConstraints;
}

export interface ContextAssemblyOptions {
  level?: ContextLevel;
  workspace?: string;
  now?: () => string;
  queryRunner?: QueryRunner;
  graph?: {
    callGraph?: CallEdge[];
    importGraph?: ImportEdge[];
    testMapping?: TestMapping[];
    ownerMapping?: OwnerMapping[];
  };
  supplementary?: Partial<AgentKnowledgeContext['supplementary']>;
}

const LOW_CONFIDENCE_THRESHOLD = configurable(
  0.4,
  [0, 1],
  'Flag files as low-confidence when coverage drops below this threshold.'
);

function createFallbackQueryInterface(): QueryInterface {
  return createQueryInterface({
    query: async () => {
      throw new Error('unverified_by_trace(librarian_unavailable): query interface unavailable');
    },
  });
}

function packSummaries(packs: ContextPack[]): string[] {
  return packs.map((pack) => pack.summary).filter((summary) => summary.trim().length > 0);
}

function mergeByPackId<T extends { packId: string }>(primary: T[], extra: T[]): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const entry of primary) {
    if (seen.has(entry.packId)) continue;
    seen.add(entry.packId);
    merged.push(entry);
  }
  for (const entry of extra) {
    if (seen.has(entry.packId)) continue;
    seen.add(entry.packId);
    merged.push(entry);
  }
  return merged;
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

function buildFileKnowledge(packs: ContextPack[]): FileKnowledge[] {
  const fileMap = new Map<string, FileKnowledge>();
  for (const pack of packs) {
    for (const file of pack.relatedFiles) {
      const existing = fileMap.get(file);
      if (!existing) {
        fileMap.set(file, {
          filePath: file,
          summary: pack.summary,
          keyFacts: [...pack.keyFacts],
          snippets: pack.codeSnippets.map((snippet) => ({ ...snippet })),
          confidence: pack.confidence,
          packIds: [pack.packId],
        });
        continue;
      }
      if (pack.summary && !existing.summary.includes(pack.summary)) {
        existing.summary = `${existing.summary} ${pack.summary}`.trim();
      }
      for (const fact of pack.keyFacts) {
        if (!existing.keyFacts.includes(fact)) existing.keyFacts.push(fact);
      }
      for (const snippet of pack.codeSnippets) {
        existing.snippets.push({ ...snippet });
      }
      existing.confidence = Math.max(existing.confidence, pack.confidence);
      if (!existing.packIds.includes(pack.packId)) existing.packIds.push(pack.packId);
    }
  }
  return Array.from(fileMap.values()).sort((a, b) => b.confidence - a.confidence);
}

function buildCoverage(response: LibrarianResponse, files: FileKnowledge[]): AgentKnowledgeContext['coverage'] {
  const coverageGaps = (response as LibrarianResponse & { coverageGaps?: string[] }).coverageGaps ?? [];
  const gaps = coverageGaps.map((gap) => ({ description: gap }));
  const threshold = resolveQuantifiedValue(LOW_CONFIDENCE_THRESHOLD);
  const lowConfidence = files
    .filter((file) => file.confidence < threshold)
    .map((file) => ({ filePath: file.filePath, confidence: file.confidence }));
  return {
    percentage: Math.max(0, Math.min(100, response.totalConfidence * 100)),
    gaps,
    lowConfidence,
  };
}

export async function assembleContextFromResponse(
  response: LibrarianResponse,
  options: ContextAssemblyOptions = {}
): Promise<AgentKnowledgeContext> {
  const now = options.now ?? (() => new Date().toISOString());
  const definition = resolveContextLevel(options.level);
  const intentConditioned = assembleIntentConditionedPacks(response.packs, {
    queryIntent: response.query.intent ?? '',
    maxTokens: definition.maxTokens,
  });
  const assembledPacks = intentConditioned.packs;
  const packLimit = definition.packLimit;
  const packs = assembledPacks.slice(0, packLimit);
  const supplemental = assembledPacks.slice(packLimit);
  const requiredFiles = buildFileKnowledge(packs);
  const relatedFiles = buildFileKnowledge(supplemental);
  const packRecentChanges = assembledPacks
    .filter((pack) => pack.packType === 'change_impact')
    .map((pack) => ({ summary: pack.summary, relatedFiles: pack.relatedFiles, packId: pack.packId }));
  const packPatterns = assembledPacks
    .filter((pack) => pack.packType === 'pattern_context')
    .map((pack) => ({ summary: pack.summary, relatedFiles: pack.relatedFiles, packId: pack.packId }));
  const packAntiPatterns = assembledPacks
    .filter((pack) => pack.packType === 'decision_context')
    .map((pack) => ({ summary: pack.summary, relatedFiles: pack.relatedFiles, packId: pack.packId }));
  const packSimilarTasks = assembledPacks
    .filter((pack) => pack.packType === 'similar_tasks')
    .map((pack) => ({ summary: pack.summary, relatedFiles: pack.relatedFiles, packId: pack.packId }));
  const extraSupplementary = options.supplementary ?? {};
  const recentChanges = mergeByPackId(packRecentChanges, extraSupplementary.recentChanges ?? []);
  const patterns = mergeByPackId(packPatterns, extraSupplementary.patterns ?? []);
  const antiPatterns = mergeByPackId(packAntiPatterns, extraSupplementary.antiPatterns ?? []);
  const similarTasks = mergeByPackId(packSimilarTasks, extraSupplementary.similarTasks ?? []);
  const knowledgeSources = dedupeById(extraSupplementary.knowledgeSources ?? []);
  const coverage = buildCoverage(response, requiredFiles);
  for (const skipped of intentConditioned.skippedSteps) {
    if (skipped.reason === 'no_matches') continue;
    coverage.gaps.push({ description: `Intent step skipped: ${skipped.step} (${skipped.reason})` });
  }
  if (!assembledPacks.length) {
    coverage.gaps.push({ description: `No packs matched intent template: ${intentConditioned.intent}` });
  }
  const providedFiles = Array.from(new Set([
    ...requiredFiles.map((entry) => entry.filePath),
    ...relatedFiles.map((entry) => entry.filePath),
    ...knowledgeSources.flatMap((source) => source.relatedFiles),
    ...similarTasks.flatMap((task) => task.relatedFiles),
  ]));
  const queryInterface = options.queryRunner ? createQueryInterface(options.queryRunner) : createFallbackQueryInterface();
  const codeVersion = options.workspace ? await getCurrentGitSha(options.workspace) : null;
  const maxTokens = Math.min(definition.maxTokens, intentConditioned.tokenBudget);
  const context: AgentKnowledgeContext = {
    contextId: randomUUID(),
    generatedAt: now(),
    knowledgeVersion: response.version.string,
    codeVersion,
    providedFiles,
    required: {
      targetFiles: requiredFiles,
      callGraph: options.graph?.callGraph ?? [],
      importGraph: options.graph?.importGraph ?? [],
      testMapping: options.graph?.testMapping ?? [],
      ownerMapping: options.graph?.ownerMapping ?? [],
    },
    supplementary: {
      relatedFiles,
      recentChanges,
      patterns,
      antiPatterns,
      similarTasks,
      knowledgeSources,
    },
    coverage,
    query: queryInterface,
    constraints: {
      level: definition.level,
      maxTokens,
      usedTokens: 0,
      truncated: false,
      truncationSteps: [],
    },
  };

  const budget = enforceTokenBudget(context, definition.level, maxTokens);
  budget.context.constraints = {
    level: definition.level,
    maxTokens,
    usedTokens: budget.usedTokens,
    truncated: budget.truncated,
    truncationSteps: budget.truncationSteps,
  };
  if (!budget.context.supplementary.recentChanges.length && !packSummaries(assembledPacks).length) {
    budget.context.coverage.gaps.push({ description: 'No change history available for context level.' });
  }
  return budget.context;
}

export function buildContextQuery(intent: string, depth: LibrarianQuery['depth']): LibrarianQuery {
  return { intent, depth };
}
