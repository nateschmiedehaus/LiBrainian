/**
 * @fileoverview Inspector for debugging librainian entities (G10)
 *
 * Provides detailed inspection capabilities for:
 * - Modules: purpose, exports, dependencies, confidence
 * - Functions: signature, purpose, call graph, confidence history
 * - Queries: execution details, timing, packs returned
 * - Confidence: breakdown of scoring factors
 */

import type { LiBrainianStorage } from '../storage/types.js';
import type {
  FunctionKnowledge,
  ModuleKnowledge,
  ContextPack,
  LiBrainianQuery,
  LiBrainianResponse,
} from '../types.js';
import type { TraceSpan } from './tracer.js';

// ============================================================================
// INSPECTION TYPES
// ============================================================================

/**
 * Detailed module inspection result.
 */
export interface ModuleInspection {
  id: string;
  path: string;
  purpose: string;
  exports: string[];
  dependencies: string[];
  confidence: number;
  dependents: string[];
  functions: FunctionSummary[];
  contextPacks: ContextPackSummary[];
  graphMetrics?: {
    pagerank: number;
    betweenness: number;
    closeness: number;
    communityId: number | null;
  };
}

/**
 * Detailed function inspection result.
 */
export interface FunctionInspection {
  id: string;
  name: string;
  filePath: string;
  signature: string;
  purpose: string;
  startLine: number;
  endLine: number;
  confidence: number;
  accessCount: number;
  lastAccessed: Date | null;
  validationCount: number;
  outcomeHistory: {
    successes: number;
    failures: number;
    successRate: number;
  };
  callers: string[];
  callees: string[];
  contextPacks: ContextPackSummary[];
  hasEmbedding: boolean;
}

/**
 * Query execution inspection result.
 */
export interface QueryInspection {
  queryId: string;
  query: LiBrainianQuery;
  response: LiBrainianResponse;
  timing: {
    totalMs: number;
    embeddingMs?: number;
    searchMs?: number;
    rankingMs?: number;
  };
  packsReturned: number;
  cacheHit: boolean;
  drillDownHints: string[];
  methodHints?: string[];
  methodFamilies?: string[];
  methodHintSource?: string;
  coverageGaps?: string[];
  trace?: TraceSpan;
}

/**
 * Confidence breakdown for an entity.
 */
export interface ConfidenceInspection {
  entityId: string;
  entityType: 'function' | 'module' | 'context_pack';
  overallConfidence: number;
  breakdown: {
    baseConfidence: number;
    outcomeAdjustment: number;
    timeDecay: number;
    accessBonus: number;
  };
  history: ConfidenceHistoryEntry[];
  recommendations: string[];
}

/**
 * Summary of a function for module inspection.
 */
export interface FunctionSummary {
  id: string;
  name: string;
  signature: string;
  confidence: number;
}

/**
 * Summary of a context pack.
 */
export interface ContextPackSummary {
  packId: string;
  packType: string;
  summary: string;
  confidence: number;
  accessCount: number;
}

/**
 * A historical confidence update.
 */
export interface ConfidenceHistoryEntry {
  timestamp: Date;
  confidence: number;
  reason: string;
}

// ============================================================================
// INSPECTOR IMPLEMENTATION
// ============================================================================

/**
 * LiBrainianInspector provides detailed inspection of librainian entities.
 *
 * Usage:
 * ```typescript
 * const inspector = new LiBrainianInspector(storage);
 * const moduleInfo = await inspector.inspectModule('src/api/index.ts');
 * const funcInfo = await inspector.inspectFunction('handleRequest');
 * ```
 */
export class LiBrainianInspector {
  constructor(private readonly storage: LiBrainianStorage) {}

  /**
   * Inspect a module by ID or path.
   * @param moduleId - The module ID or file path
   * @returns Detailed module information
   */
  async inspectModule(moduleId: string): Promise<ModuleInspection | null> {
    const module = await this.storage.getModule(moduleId);
    if (!module) {
      // Try to find by path
      const modules = await this.storage.getModules();
      const byPath = modules.find(m => m.path === moduleId || m.path.endsWith(moduleId));
      if (!byPath) {
        return null;
      }
      return this.buildModuleInspection(byPath);
    }
    return this.buildModuleInspection(module);
  }

  /**
   * Inspect a function by ID.
   * @param funcId - The function ID
   * @returns Detailed function information
   */
  async inspectFunction(funcId: string): Promise<FunctionInspection | null> {
    const func = await this.storage.getFunction(funcId);
    if (!func) {
      // Try to find by name
      const functions = await this.storage.getFunctions();
      const byName = functions.find(f => f.name === funcId || f.id === funcId);
      if (!byName) {
        return null;
      }
      return this.buildFunctionInspection(byName);
    }
    return this.buildFunctionInspection(func);
  }

  /**
   * Inspect a query execution.
   * @param queryId - The query ID (from LiBrainianResponse)
   * @param response - The query response to inspect
   * @param trace - Optional trace span from the query
   * @returns Query execution details
   */
  inspectQuery(queryId: string, response: LiBrainianResponse, trace?: TraceSpan): QueryInspection {
    return {
      queryId,
      query: response.query,
      response,
      timing: {
        totalMs: response.latencyMs,
        // Timing breakdown would come from trace events if available
        embeddingMs: trace?.events.find(e => e.name === 'embedding_complete')?.attributes['durationMs'] as number | undefined,
        searchMs: trace?.events.find(e => e.name === 'search_complete')?.attributes['durationMs'] as number | undefined,
        rankingMs: trace?.events.find(e => e.name === 'ranking_complete')?.attributes['durationMs'] as number | undefined,
      },
      packsReturned: response.packs.length,
      cacheHit: response.cacheHit,
      drillDownHints: response.drillDownHints,
      methodHints: response.methodHints,
      methodFamilies: response.methodFamilies,
      methodHintSource: response.methodHintSource,
      coverageGaps: response.coverageGaps,
      trace,
    };
  }

  /**
   * Inspect confidence breakdown for an entity.
   * @param entityId - The entity ID
   * @returns Confidence breakdown with recommendations
   */
  async inspectConfidence(entityId: string): Promise<ConfidenceInspection | null> {
    // Try to find the entity
    const func = await this.storage.getFunction(entityId);
    if (func) {
      return this.buildFunctionConfidenceInspection(func);
    }

    const module = await this.storage.getModule(entityId);
    if (module) {
      return this.buildModuleConfidenceInspection(module);
    }

    const pack = await this.storage.getContextPack(entityId);
    if (pack) {
      return this.buildPackConfidenceInspection(pack);
    }

    return null;
  }

  /**
   * List all modules with their confidence scores.
   */
  async listModules(): Promise<Array<{ id: string; path: string; confidence: number }>> {
    const modules = await this.storage.getModules();
    return modules.map(m => ({
      id: m.id,
      path: m.path,
      confidence: m.confidence,
    }));
  }

  /**
   * List all functions with their confidence scores.
   */
  async listFunctions(): Promise<Array<{ id: string; name: string; filePath: string; confidence: number }>> {
    const functions = await this.storage.getFunctions();
    return functions.map(f => ({
      id: f.id,
      name: f.name,
      filePath: f.filePath,
      confidence: f.confidence,
    }));
  }

  /**
   * Find entities with low confidence.
   * @param threshold - Confidence threshold (default 0.5)
   */
  async findLowConfidenceEntities(threshold: number = 0.5): Promise<Array<{
    entityId: string;
    entityType: 'function' | 'module' | 'context_pack';
    confidence: number;
    reason: string;
  }>> {
    const results: Array<{
      entityId: string;
      entityType: 'function' | 'module' | 'context_pack';
      confidence: number;
      reason: string;
    }> = [];

    const functions = await this.storage.getFunctions();
    for (const func of functions) {
      if (func.confidence < threshold) {
        results.push({
          entityId: func.id,
          entityType: 'function',
          confidence: func.confidence,
          reason: this.determineConfidenceIssue(func),
        });
      }
    }

    const modules = await this.storage.getModules();
    for (const mod of modules) {
      if (mod.confidence < threshold) {
        results.push({
          entityId: mod.id,
          entityType: 'module',
          confidence: mod.confidence,
          reason: 'Low module confidence',
        });
      }
    }

    return results.sort((a, b) => a.confidence - b.confidence);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async buildModuleInspection(module: ModuleKnowledge): Promise<ModuleInspection> {
    // Get functions in this module
    const allFunctions = await this.storage.getFunctions();
    const moduleFunctions = allFunctions.filter(f => f.filePath === module.path);

    // Get context packs for this module
    const packs = await this.storage.getContextPacks({ limit: 100 });
    const modulePacks = packs.filter(p =>
      p.targetId === module.id || p.relatedFiles.includes(module.path)
    );

    // Get graph edges to find dependents
    const edges = await this.storage.getGraphEdges({
      toIds: [module.id],
      edgeTypes: ['imports'],
    });
    const dependents = edges.map(e => e.fromId);

    // Try to get graph metrics if available
    let graphMetrics: ModuleInspection['graphMetrics'] | undefined;
    const graphStore = this.storage as LiBrainianStorage & {
      getGraphMetrics?: (options?: { entityIds?: string[] }) => Promise<Array<{
        entityId: string;
        pagerank: number;
        betweenness: number;
        closeness: number;
        communityId: number | null;
      }>>;
    };
    if (graphStore.getGraphMetrics) {
      const metrics = await graphStore.getGraphMetrics({ entityIds: [module.id] });
      const moduleMetrics = metrics.find(m => m.entityId === module.id);
      if (moduleMetrics) {
        graphMetrics = {
          pagerank: moduleMetrics.pagerank,
          betweenness: moduleMetrics.betweenness,
          closeness: moduleMetrics.closeness,
          communityId: moduleMetrics.communityId,
        };
      }
    }

    return {
      id: module.id,
      path: module.path,
      purpose: module.purpose,
      exports: module.exports,
      dependencies: module.dependencies,
      confidence: module.confidence,
      dependents,
      functions: moduleFunctions.map(f => ({
        id: f.id,
        name: f.name,
        signature: f.signature,
        confidence: f.confidence,
      })),
      contextPacks: modulePacks.map(p => ({
        packId: p.packId,
        packType: p.packType,
        summary: p.summary,
        confidence: p.confidence,
        accessCount: p.accessCount,
      })),
      graphMetrics,
    };
  }

  private async buildFunctionInspection(func: FunctionKnowledge): Promise<FunctionInspection> {
    // Get call graph edges
    const outgoingEdges = await this.storage.getGraphEdges({
      fromIds: [func.id],
      edgeTypes: ['calls'],
    });
    const incomingEdges = await this.storage.getGraphEdges({
      toIds: [func.id],
      edgeTypes: ['calls'],
    });

    // Get context packs for this function
    const packs = await this.storage.getContextPacks({ limit: 100 });
    const funcPacks = packs.filter(p =>
      p.targetId === func.id || p.relatedFiles.includes(func.filePath)
    );

    const total = func.outcomeHistory.successes + func.outcomeHistory.failures;
    const successRate = total > 0 ? func.outcomeHistory.successes / total : 0;

    return {
      id: func.id,
      name: func.name,
      filePath: func.filePath,
      signature: func.signature,
      purpose: func.purpose,
      startLine: func.startLine,
      endLine: func.endLine,
      confidence: func.confidence,
      accessCount: func.accessCount,
      lastAccessed: func.lastAccessed,
      validationCount: func.validationCount,
      outcomeHistory: {
        ...func.outcomeHistory,
        successRate,
      },
      callers: incomingEdges.map(e => e.fromId),
      callees: outgoingEdges.map(e => e.toId),
      contextPacks: funcPacks.map(p => ({
        packId: p.packId,
        packType: p.packType,
        summary: p.summary,
        confidence: p.confidence,
        accessCount: p.accessCount,
      })),
      hasEmbedding: Boolean(func.embedding),
    };
  }

  private buildFunctionConfidenceInspection(func: FunctionKnowledge): ConfidenceInspection {
    const total = func.outcomeHistory.successes + func.outcomeHistory.failures;
    const outcomeAdjustment = total > 0
      ? (func.outcomeHistory.successes - func.outcomeHistory.failures) * 0.1
      : 0;

    const daysSinceAccess = func.lastAccessed
      ? (Date.now() - func.lastAccessed.getTime()) / (1000 * 60 * 60 * 24)
      : 30;
    const timeDecay = Math.min(0, -daysSinceAccess * 0.01);

    const accessBonus = Math.min(0.1, func.accessCount * 0.01);

    const recommendations: string[] = [];
    if (func.confidence < 0.5) {
      if (total === 0) {
        recommendations.push('No usage data - use this function to build confidence');
      }
      if (func.outcomeHistory.failures > func.outcomeHistory.successes) {
        recommendations.push('High failure rate - review function correctness');
      }
      if (daysSinceAccess > 14) {
        recommendations.push('Stale data - reindex to refresh confidence');
      }
    }

    return {
      entityId: func.id,
      entityType: 'function',
      overallConfidence: func.confidence,
      breakdown: {
        baseConfidence: 0.5,
        outcomeAdjustment,
        timeDecay,
        accessBonus,
      },
      history: [], // Would need to be tracked separately
      recommendations,
    };
  }

  private buildModuleConfidenceInspection(module: ModuleKnowledge): ConfidenceInspection {
    const recommendations: string[] = [];
    if (module.confidence < 0.5) {
      if (module.exports.length === 0) {
        recommendations.push('No exports detected - verify module structure');
      }
      if (module.dependencies.length === 0) {
        recommendations.push('No dependencies - may be isolated or incomplete');
      }
      recommendations.push('Consider reindexing to improve coverage');
    }

    return {
      entityId: module.id,
      entityType: 'module',
      overallConfidence: module.confidence,
      breakdown: {
        baseConfidence: 0.5,
        outcomeAdjustment: 0,
        timeDecay: 0,
        accessBonus: 0,
      },
      history: [],
      recommendations,
    };
  }

  private buildPackConfidenceInspection(pack: ContextPack): ConfidenceInspection {
    const total = pack.successCount + pack.failureCount;
    const outcomeAdjustment = total > 0
      ? (pack.successCount - pack.failureCount) * 0.1
      : 0;

    const daysSinceCreation = (Date.now() - pack.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const timeDecay = Math.min(0, -daysSinceCreation * 0.01);

    const accessBonus = Math.min(0.1, pack.accessCount * 0.01);

    const recommendations: string[] = [];
    if (pack.confidence < 0.5) {
      if (pack.lastOutcome === 'failure') {
        recommendations.push('Last outcome was failure - review pack content');
      }
      if (pack.failureCount > pack.successCount) {
        recommendations.push('High failure rate - consider regenerating pack');
      }
    }

    return {
      entityId: pack.packId,
      entityType: 'context_pack',
      overallConfidence: pack.confidence,
      breakdown: {
        baseConfidence: 0.5,
        outcomeAdjustment,
        timeDecay,
        accessBonus,
      },
      history: [],
      recommendations,
    };
  }

  private determineConfidenceIssue(func: FunctionKnowledge): string {
    const total = func.outcomeHistory.successes + func.outcomeHistory.failures;
    if (total === 0) {
      return 'No usage data';
    }
    if (func.outcomeHistory.failures > func.outcomeHistory.successes) {
      return 'High failure rate';
    }
    if (!func.lastAccessed) {
      return 'Never accessed';
    }
    const daysSince = (Date.now() - func.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      return 'Stale data';
    }
    return 'Low base confidence';
  }
}

/**
 * Create a new inspector instance.
 */
export function createInspector(storage: LiBrainianStorage): LiBrainianInspector {
  return new LiBrainianInspector(storage);
}
