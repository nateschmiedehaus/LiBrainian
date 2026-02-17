import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianQuery } from '../types.js';
import { queryLibrarian } from '../api/query.js';
import { EmbeddingService } from '../api/embeddings.js';
import { estimateTokenCount } from '../api/governor_context.js';
import { ImpactKnowledge } from '../knowledge/impact.js';
import { PatternKnowledge } from '../knowledge/patterns.js';
import type { TestMapping } from '../api/context_assembly.js';
import type {
  RelevanceRequest,
  RelevanceResult,
  KnowledgeItem,
  BlindSpot,
  PatternMatch,
  ExampleMatch,
  BlastRadius,
  Outcome,
} from './types.js';
import { globalEventBus, createEngineRelevanceEvent } from '../events.js';

const DEFAULT_BUDGET = { maxFiles: 20, maxTokens: 40_000, maxDepth: 2 };

export class RelevanceEngine {
  private readonly impact: ImpactKnowledge;
  private readonly patterns: PatternKnowledge;
  private learnedMissing = new Set<string>();
  private outcomes = new Map<string, Outcome>();

  constructor(
    private readonly storage: LibrarianStorage,
    private readonly embeddingService: EmbeddingService | null,
    private readonly workspaceRoot?: string,
  ) {
    this.impact = new ImpactKnowledge(storage);
    this.patterns = new PatternKnowledge(storage);
  }

  async query(request: RelevanceRequest): Promise<RelevanceResult> {
    const budget = {
      maxFiles: request.budget?.maxFiles ?? DEFAULT_BUDGET.maxFiles,
      maxTokens: request.budget?.maxTokens ?? DEFAULT_BUDGET.maxTokens,
      maxDepth: request.budget?.maxDepth ?? DEFAULT_BUDGET.maxDepth,
    };
    const depth: LibrarianQuery['depth'] = budget.maxDepth <= 0
      ? 'L0'
      : budget.maxDepth === 1
        ? 'L1'
        : budget.maxDepth === 2
          ? 'L2'
          : 'L3';
    const response = await queryLibrarian(
      {
        intent: request.intent,
        affectedFiles: request.hints,
        depth,
        taskType: undefined,
        // Engines should be safe in offline/degraded mode and must not
        // unexpectedly trigger LLM calls (cost, latency, provider failures).
        llmRequirement: 'disabled',
      },
      this.storage,
      this.embeddingService ?? undefined,
    );

    const items = response.packs.map((pack) => toKnowledgeItem(pack));
    const tiers = buildTiers(items, budget);
    const explanations = new Map<string, string>();
    for (const pack of response.packs) {
      const key = pack.packId;
      explanations.set(
        key,
        `Confidence ${(pack.confidence * 100).toFixed(0)}%, related to ${pack.relatedFiles.slice(0, 3).join(', ') || 'unknown files'}`
      );
    }

    const blindSpots = buildBlindSpots(request, response.packs);
    const learned = [...this.learnedMissing].filter((path) => !items.some((item) => item.relatedFiles.includes(path)));
    for (const missing of learned) {
      blindSpots.push({
        area: missing,
        reason: 'Previously missing context reported by agent',
        risk: 'medium',
        suggestion: `Consider indexing or reviewing ${missing}`,
      });
      tiers.reference.push({
        id: missing,
        summary: `Previously missing context: ${missing}`,
        confidence: 0.35,
        relatedFiles: [missing],
        kind: 'context_pack',
      });
    }

    const confidence = response.totalConfidence || averageConfidence(tiers.essential);

    // Emit engine:relevance event
    void globalEventBus.emit(createEngineRelevanceEvent(
      request.intent,
      items.length,
      confidence
    ));

    return {
      tiers,
      explanations,
      blindSpots,
      confidence,
    };
  }

  async findPatterns(intent: string): Promise<PatternMatch[]> {
    const result = await this.patterns.query({ type: 'recurring', target: intent, minOccurrences: 2 });
    const patterns = result.patterns ?? [];
    return patterns.map((pattern, index) => ({
      id: `${pattern.name}:${index}`,
      summary: pattern.description,
      file: pattern.occurrences[0]?.file ?? 'unknown',
      occurrences: pattern.occurrences.length,
    }));
  }

  async findExamples(query: string, options: { limit?: number } = {}): Promise<ExampleMatch[]> {
    if (!this.embeddingService) {
      throw new Error('unverified_by_trace(provider_unavailable): embedding service not configured');
    }
    const embedding = await this.embeddingService.generateEmbedding({ text: query, kind: 'query' });
    const searchResponse = await this.storage.findSimilarByEmbedding(embedding.embedding, {
      limit: Math.max(1, options.limit ?? 5),
      minSimilarity: 0.35,
      entityTypes: ['function', 'module'],
    });
    // Log if search was degraded (e.g., empty vector index)
    if (searchResponse.degraded) {
      console.warn(`[relevance_engine] Similarity search degraded: ${searchResponse.degradedReason}`);
    }
    const examples: ExampleMatch[] = [];
    for (const match of searchResponse.results) {
      if (match.entityType === 'function') {
        const fn = await this.storage.getFunction(match.entityId);
        if (!fn) continue;
        examples.push({
          id: match.entityId,
          file: fn.filePath,
          snippet: fn.signature,
          confidence: match.similarity,
        });
      } else {
        const mod = await this.storage.getModule(match.entityId);
        if (!mod) continue;
        examples.push({
          id: match.entityId,
          file: mod.path,
          snippet: mod.purpose,
          confidence: match.similarity,
        });
      }
    }
    return examples;
  }

  async getBlastRadius(files: string[]): Promise<BlastRadius> {
    let affectedFiles: string[] = [];
    let direct = 0;
    let transitive = 0;
    for (const file of files) {
      const result = await this.impact.query({ type: 'blast_radius', target: file, depth: 3 });
      for (const item of result.affected ?? []) {
        affectedFiles.push(item.path);
        if (item.type === 'direct') direct += 1;
        else transitive += 1;
      }
    }
    affectedFiles = Array.from(new Set(affectedFiles));
    const total = direct + transitive;
    const riskLevel = total > 20 ? 'high' : total > 8 ? 'medium' : 'low';
    return {
      directDependents: direct,
      transitiveDependents: transitive,
      riskLevel,
      affectedFiles,
    };
  }

  async getTestCoverage(files: string[]): Promise<TestMapping[]> {
    const mappings: TestMapping[] = [];
    for (const file of files) {
      const result = await this.impact.query({ type: 'test_impact', target: file, depth: 2 });
      if (result.tests) {
        mappings.push({ file, tests: result.tests.map((test) => test.testFile) });
      } else {
        mappings.push({ file, tests: [] });
      }
    }
    return mappings;
  }

  async expandScope(files: string[]): Promise<string[]> {
    const expanded = new Set<string>(files);
    for (const file of files) {
      const result = await this.impact.query({ type: 'change_impact', target: file, depth: 3 });
      for (const item of result.affected ?? []) {
        expanded.add(item.path);
      }
    }
    return Array.from(expanded);
  }

  recordOutcome(taskId: string, outcome: Outcome, contextUsed: string[]): void {
    this.outcomes.set(taskId, outcome);
    if (!outcome.success) {
      for (const context of contextUsed) {
        this.learnedMissing.add(context);
        // Persist to storage
        this.storage.recordLearnedMissing(context, taskId).catch(() => {
          // Ignore errors - in-memory is still updated
        });
      }
    }
  }

  learnNegative(taskId: string, missingContext: string[]): void {
    this.outcomes.set(taskId, { success: false, reason: 'missing_context' });
    for (const missing of missingContext) {
      this.learnedMissing.add(missing);
      // Persist to storage
      this.storage.recordLearnedMissing(missing, taskId).catch(() => {
        // Ignore errors - in-memory is still updated
      });
    }
  }

  /**
   * Load learned missing context from storage on initialization.
   * Call this after construction to restore state.
   */
  async loadLearnedMissing(): Promise<void> {
    try {
      const stored = await this.storage.getLearnedMissing();
      for (const entry of stored) {
        this.learnedMissing.add(entry.context);
      }
    } catch {
      // Ignore errors - start with empty set
    }
  }
}

function toKnowledgeItem(pack: { packId: string; summary: string; confidence: number; relatedFiles: string[] }): KnowledgeItem {
  return {
    id: pack.packId,
    packId: pack.packId,
    summary: pack.summary,
    confidence: pack.confidence,
    relatedFiles: pack.relatedFiles,
    kind: 'context_pack',
  };
}

function buildTiers(items: KnowledgeItem[], budget: { maxFiles: number; maxTokens: number }): RelevanceResult['tiers'] {
  const essential: KnowledgeItem[] = [];
  const contextual: KnowledgeItem[] = [];
  const reference: KnowledgeItem[] = [];
  const sorted = items.slice().sort((a, b) => b.confidence - a.confidence);
  let tokenBudget = budget.maxTokens;

  for (const item of sorted) {
    const tokenCost = estimateTokenCount(`${item.summary} ${item.relatedFiles.join(' ')}`);
    if (tokenBudget - tokenCost < 0 && essential.length + contextual.length >= budget.maxFiles) break;
    tokenBudget -= tokenCost;
    if (essential.length < Math.ceil(budget.maxFiles * 0.4) || item.confidence >= 0.75) {
      essential.push(item);
    } else if (contextual.length < Math.ceil(budget.maxFiles * 0.4) || item.confidence >= 0.5) {
      contextual.push(item);
    } else if (reference.length < budget.maxFiles) {
      reference.push(item);
    }
  }

  return { essential, contextual, reference };
}

function buildBlindSpots(request: RelevanceRequest, packs: Array<{ relatedFiles: string[] }>): BlindSpot[] {
  const blindSpots: BlindSpot[] = [];
  const relatedFiles = new Set<string>();
  for (const pack of packs) {
    for (const file of pack.relatedFiles) relatedFiles.add(file);
  }

  if (packs.length === 0) {
    blindSpots.push({
      area: request.intent,
      reason: 'No indexed context packs matched the intent',
      risk: 'high',
      suggestion: 'Reindex the workspace or add more explicit hints.',
    });
  }

  for (const hint of request.hints ?? []) {
    if (!relatedFiles.has(hint)) {
      blindSpots.push({
        area: hint,
        reason: 'Hinted file not present in indexed packs',
        risk: 'medium',
        suggestion: `Consider indexing ${hint} or widening the scope.`,
      });
    }
  }

  return blindSpots;
}

function averageConfidence(items: KnowledgeItem[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, item) => sum + item.confidence, 0);
  return total / items.length;
}
