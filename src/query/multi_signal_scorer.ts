/**
 * @fileoverview Multi-Signal Relevance Scorer
 *
 * Combines 13 relevance signals with learned weights:
 * 1. Semantic similarity (embedding distance)
 * 2. Structural proximity (AST/file distance)
 * 3. History correlation (co-change patterns)
 * 4. Access recency (how recently accessed)
 * 5. Query term match (keyword overlap)
 * 6. Domain relevance (domain match score)
 * 7. Entity type match (type alignment)
 * 8. Ownership match (team/author alignment)
 * 9. Risk correlation (risk signal match)
 * 10. Test correlation (test coverage relevance)
 * 11. Dependency distance (import graph distance)
 * 12. Hotspot (churn + complexity indicator)
 * 13. Directory affinity (path-based domain matching)
 *
 * The directory_affinity signal is particularly important for reducing cross-domain
 * noise. It ensures that queries like "CLI command implementation" strongly prefer
 * files in src/cli/ over random files that happen to contain "command" in their names.
 */

import { Result, Ok, Err } from '../core/result.js';
import { EntityId, Timestamp, now } from '../core/contracts.js';

// ============================================================================
// TYPES
// ============================================================================

export type SignalType =
  | 'semantic'
  | 'structural'
  | 'history'
  | 'recency'
  | 'keyword'
  | 'domain'
  | 'entity_type'
  | 'ownership'
  | 'risk'
  | 'test'
  | 'dependency'
  | 'hotspot'
  | 'directory_affinity';

export interface SignalValue {
  signal: SignalType;
  score: number; // 0-1 normalized
  confidence: number; // 0-1 confidence in this signal
  metadata?: Record<string, unknown>;
}

export interface ScoredEntity {
  entityId: EntityId;
  signals: SignalValue[];
  combinedScore: number;
  confidence: number;
  explanation: string;
}

export interface QueryContext {
  queryText: string;
  queryTerms: string[];
  queryEmbedding?: number[];
  targetDomains?: string[];
  targetEntityTypes?: string[];
  currentFile?: string;
  currentUser?: string;
  currentTeam?: string;
  /** Directory patterns detected from query (e.g., ['cli', 'storage', 'api']) */
  targetDirectories?: string[];
}

export interface SignalWeight {
  signal: SignalType;
  weight: number;
  learningRate: number;
}

export interface FeedbackRecord {
  entityId: EntityId;
  wasRelevant: boolean;
  signals: SignalValue[];
  timestamp: Timestamp;
}

// ============================================================================
// SIGNAL COMPUTERS
// ============================================================================

export interface SignalComputer {
  readonly signal: SignalType;
  compute(
    entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue>;
}

export interface EntityData {
  id: EntityId;
  type: string;
  path?: string;
  embedding?: number[];
  lastAccessed?: number;
  lastModified?: number;
  domains?: string[];
  owners?: string[];
  dependencies?: string[];
  dependents?: string[];
  riskLevel?: number;
  testCoverage?: number;
  changeFrequency?: number;
  content?: string;
  name?: string;

  // Hotspot metrics (for hotspot signal)
  commitCount?: number;
  authorCount?: number;
  cyclomaticComplexity?: number;
  linesOfCode?: number;
}

// ============================================================================
// DEFAULT SIGNAL COMPUTERS
// ============================================================================

/**
 * Semantic similarity using embeddings
 */
export class SemanticSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'semantic';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!context.queryEmbedding || !entityData.embedding) {
      return { signal: this.signal, score: 0, confidence: 0 };
    }

    const similarity = this.cosineSimilarity(
      context.queryEmbedding,
      entityData.embedding
    );

    return {
      signal: this.signal,
      score: Math.max(0, similarity), // Clamp negative similarities
      confidence: 0.9, // High confidence when embeddings exist
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/**
 * Structural proximity based on file path distance
 */
export class StructuralSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'structural';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!context.currentFile || !entityData.path) {
      return { signal: this.signal, score: 0.5, confidence: 0.3 };
    }

    const distance = this.pathDistance(context.currentFile, entityData.path);
    const score = Math.exp(-distance / 5); // Exponential decay

    return {
      signal: this.signal,
      score,
      confidence: 0.7,
      metadata: { pathDistance: distance },
    };
  }

  private pathDistance(path1: string, path2: string): number {
    const parts1 = path1.split('/');
    const parts2 = path2.split('/');

    // Find common prefix length
    let commonLength = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) {
        commonLength++;
      } else {
        break;
      }
    }

    // Distance = steps up from path1 to common ancestor + steps down to path2
    return (parts1.length - commonLength) + (parts2.length - commonLength);
  }
}

/**
 * Access recency signal
 */
export class RecencySignalComputer implements SignalComputer {
  readonly signal: SignalType = 'recency';

  async compute(
    _entityId: EntityId,
    _context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!entityData.lastAccessed) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    const ageMs = Date.now() - entityData.lastAccessed;
    const hoursSinceAccess = ageMs / (1000 * 60 * 60);

    // Exponential decay over 24 hours
    const score = Math.exp(-hoursSinceAccess / 24);

    return {
      signal: this.signal,
      score,
      confidence: 0.6,
      metadata: { hoursSinceAccess },
    };
  }
}

/**
 * Query term keyword match
 *
 * This signal gives weighted scores based on WHERE the keyword matches:
 * - Filename exact match: highest score (1.0)
 * - Filename contains term: very high score (0.9)
 * - Path segment match: high score (0.7)
 * - Content match only: moderate score (0.4)
 *
 * This ensures that a query for "bootstrap" strongly prefers bootstrap.ts
 * over files that merely mention "bootstrap" in their content.
 */
export class KeywordSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'keyword';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (context.queryTerms.length === 0) {
      return { signal: this.signal, score: 0, confidence: 0 };
    }

    const nameLower = (entityData.name ?? '').toLowerCase();
    const pathLower = (entityData.path ?? '').toLowerCase();
    const contentLower = (entityData.content ?? '').toLowerCase();

    // Extract filename without extension from path if name not provided
    const filename = nameLower || (pathLower ? pathLower.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '' : '');
    const pathSegments = pathLower.split('/');

    let totalScore = 0;
    const matchedTerms: string[] = [];
    const matchDetails: { term: string; matchType: string; score: number }[] = [];

    for (const term of context.queryTerms) {
      const termLower = term.toLowerCase();

      // Skip very short terms (likely noise like "the", "and", etc.)
      if (termLower.length < 3) continue;

      let termScore = 0;
      let matchType = 'none';

      // Check for exact filename match (highest priority)
      if (filename === termLower) {
        termScore = 1.0;
        matchType = 'filename_exact';
      }
      // Check if filename contains the term
      else if (filename.includes(termLower)) {
        termScore = 0.9;
        matchType = 'filename_contains';
      }
      // Check if any path segment matches exactly
      else if (pathSegments.some(seg => seg === termLower)) {
        termScore = 0.75;
        matchType = 'path_segment_exact';
      }
      // Check if any path segment contains the term
      else if (pathSegments.some(seg => seg.includes(termLower))) {
        termScore = 0.65;
        matchType = 'path_segment_contains';
      }
      // Check content match (lowest priority)
      else if (contentLower.includes(termLower)) {
        // Give slightly higher score if term appears multiple times in content
        const contentMatches = (contentLower.match(new RegExp(termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        termScore = Math.min(0.5, 0.3 + (contentMatches * 0.05));
        matchType = 'content';
      }

      if (termScore > 0) {
        totalScore += termScore;
        matchedTerms.push(term);
        matchDetails.push({ term, matchType, score: termScore });
      }
    }

    // Normalize by number of meaningful query terms (length >= 3)
    const meaningfulTerms = context.queryTerms.filter(t => t.length >= 3);
    const normalizedScore = meaningfulTerms.length > 0
      ? totalScore / meaningfulTerms.length
      : 0;

    // Confidence is higher when we have filename/path matches
    const hasStrongMatch = matchDetails.some(d =>
      d.matchType.startsWith('filename') || d.matchType.startsWith('path_segment')
    );
    const confidence = hasStrongMatch ? 0.95 : (matchedTerms.length > 0 ? 0.7 : 0.3);

    return {
      signal: this.signal,
      score: Math.min(1.0, normalizedScore),
      confidence,
      metadata: {
        matchedTerms,
        totalTerms: context.queryTerms.length,
        meaningfulTerms: meaningfulTerms.length,
        matchDetails,
      },
    };
  }
}

/**
 * Domain relevance signal
 */
export class DomainSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'domain';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!context.targetDomains?.length || !entityData.domains?.length) {
      return { signal: this.signal, score: 0.5, confidence: 0.3 };
    }

    const entityDomains = new Set(entityData.domains);
    const matchingDomains = context.targetDomains.filter(d => entityDomains.has(d));
    const score = matchingDomains.length / context.targetDomains.length;

    return {
      signal: this.signal,
      score,
      confidence: 0.85,
      metadata: { matchingDomains },
    };
  }
}

/**
 * Entity type match signal
 */
export class EntityTypeSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'entity_type';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!context.targetEntityTypes?.length) {
      return { signal: this.signal, score: 0.5, confidence: 0.3 };
    }

    const matches = context.targetEntityTypes.includes(entityData.type);
    return {
      signal: this.signal,
      score: matches ? 1.0 : 0.0,
      confidence: 0.9,
      metadata: { entityType: entityData.type, targetTypes: context.targetEntityTypes },
    };
  }
}

/**
 * Ownership match signal
 */
export class OwnershipSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'ownership';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!entityData.owners?.length) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    let score = 0.5;
    const matches: string[] = [];

    // Check user match
    if (context.currentUser && entityData.owners.includes(context.currentUser)) {
      score = 1.0;
      matches.push(context.currentUser);
    }

    // Check team match
    if (context.currentTeam && entityData.owners.includes(context.currentTeam)) {
      score = Math.max(score, 0.8);
      matches.push(context.currentTeam);
    }

    return {
      signal: this.signal,
      score,
      confidence: matches.length > 0 ? 0.8 : 0.4,
      metadata: { matches, owners: entityData.owners },
    };
  }
}

/**
 * Risk correlation signal
 */
export class RiskSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'risk';

  async compute(
    _entityId: EntityId,
    _context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (entityData.riskLevel === undefined) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    // Higher risk = more relevant (might need attention)
    // Normalize risk level to 0-1
    const normalizedRisk = Math.min(1, Math.max(0, entityData.riskLevel));

    return {
      signal: this.signal,
      score: normalizedRisk,
      confidence: 0.7,
      metadata: { riskLevel: entityData.riskLevel },
    };
  }
}

/**
 * Test coverage correlation signal
 */
export class TestSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'test';

  async compute(
    _entityId: EntityId,
    _context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (entityData.testCoverage === undefined) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    // Well-tested code might be more relevant for understanding
    const coverage = Math.min(1, Math.max(0, entityData.testCoverage));

    return {
      signal: this.signal,
      score: coverage,
      confidence: 0.6,
      metadata: { testCoverage: entityData.testCoverage },
    };
  }
}

/**
 * Dependency distance signal
 */
export class DependencySignalComputer implements SignalComputer {
  readonly signal: SignalType = 'dependency';

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (!context.currentFile || (!entityData.dependencies?.length && !entityData.dependents?.length)) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    // Check if current file is in dependencies or dependents
    const isDependency = entityData.dependencies?.includes(context.currentFile) ?? false;
    const isDependent = entityData.dependents?.includes(context.currentFile) ?? false;

    let score = 0.5;
    if (isDependency || isDependent) {
      score = 1.0; // Direct dependency
    }

    // Centrality penalty: files imported by many modules are utilities/infrastructure,
    // not the specific implementation a query is looking for. Penalize over-centralized files.
    const dependentCount = entityData.dependents?.length ?? 0;
    if (dependentCount > 15) {
      const centralityPenalty = Math.min(1, 15 / dependentCount);
      score *= centralityPenalty;
    }

    return {
      signal: this.signal,
      score,
      confidence: isDependency || isDependent ? 0.9 : 0.4,
      metadata: { isDependency, isDependent, dependentCount },
    };
  }
}

/**
 * History/co-change correlation signal
 */
export class HistorySignalComputer implements SignalComputer {
  readonly signal: SignalType = 'history';

  async compute(
    _entityId: EntityId,
    _context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    if (entityData.changeFrequency === undefined) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    // Frequently changed files might be more relevant
    // Normalize change frequency (assume 0-100 range)
    const normalized = Math.min(1, entityData.changeFrequency / 100);

    return {
      signal: this.signal,
      score: normalized,
      confidence: 0.6,
      metadata: { changeFrequency: entityData.changeFrequency },
    };
  }
}

/**
 * Hotspot signal - high churn combined with high complexity.
 *
 * This identifies code that is both frequently changed AND complex,
 * which is a strong predictor of bug-prone areas and refactoring ROI.
 *
 * Formula: hotspot = churn^0.7 * complexity^0.5
 * (Exponents dampen outliers per Adam Tornhill's research)
 */
export class HotspotSignalComputer implements SignalComputer {
  readonly signal: SignalType = 'hotspot';

  // Configuration (matches DEFAULT_HOTSPOT_CONFIG from strategic/hotspot.ts)
  private readonly churnExponent = 0.7;
  private readonly complexityExponent = 0.5;
  private readonly maxCommitCount = 100;
  private readonly maxComplexity = 50;
  private readonly maxLinesOfCode = 1000;

  async compute(
    _entityId: EntityId,
    _context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    // Calculate churn score
    const churnScore = this.computeChurnScore(entityData);

    // Calculate complexity score
    const complexityScore = this.computeComplexityScore(entityData);

    // Apply hotspot formula with exponents
    const hotspotScore =
      Math.pow(churnScore, this.churnExponent) *
      Math.pow(complexityScore, this.complexityExponent);

    // Determine confidence based on data availability
    const hasChurn = entityData.commitCount !== undefined || entityData.changeFrequency !== undefined;
    const hasComplexity = entityData.cyclomaticComplexity !== undefined || entityData.linesOfCode !== undefined;

    let confidence = 0.3;
    if (hasChurn && hasComplexity) {
      confidence = 0.9;
    } else if (hasChurn || hasComplexity) {
      confidence = 0.6;
    }

    return {
      signal: this.signal,
      score: hotspotScore,
      confidence,
      metadata: {
        churnScore,
        complexityScore,
        commitCount: entityData.commitCount,
        cyclomaticComplexity: entityData.cyclomaticComplexity,
        isHotspot: hotspotScore >= 0.5,
      },
    };
  }

  private computeChurnScore(entityData: EntityData): number {
    const signals: number[] = [];

    if (entityData.commitCount !== undefined) {
      signals.push(Math.min(1, entityData.commitCount / this.maxCommitCount));
    }

    if (entityData.changeFrequency !== undefined) {
      // Assume 10 changes/month is high
      signals.push(Math.min(1, entityData.changeFrequency / 10));
    }

    if (entityData.authorCount !== undefined) {
      // Many authors = coordination overhead
      signals.push(Math.min(1, entityData.authorCount / 10) * 0.5);
    }

    if (signals.length === 0) return 0.5;
    return Math.min(1, signals.reduce((a, b) => a + b, 0) / signals.length);
  }

  private computeComplexityScore(entityData: EntityData): number {
    const signals: number[] = [];

    if (entityData.cyclomaticComplexity !== undefined) {
      signals.push(Math.min(1, entityData.cyclomaticComplexity / this.maxComplexity) * 1.2);
    }

    if (entityData.linesOfCode !== undefined) {
      signals.push(Math.min(1, entityData.linesOfCode / this.maxLinesOfCode) * 0.8);
    }

    if (signals.length === 0) return 0.5;
    return Math.min(1, signals.reduce((a, b) => a + b, 0) / signals.length);
  }
}

/**
 * Directory Affinity Signal - boosts results from directories matching query context.
 *
 * When a query mentions specific areas like "CLI commands", "storage layer", or "API",
 * this signal boosts files from matching directories (src/cli/, src/storage/, src/api/).
 *
 * Directory patterns are detected from query text and matched against entity paths.
 * This addresses the problem of queries returning scattered results from unrelated modules.
 */
export class DirectoryAffinitySignalComputer implements SignalComputer {
  readonly signal: SignalType = 'directory_affinity';

  /**
   * Common directory patterns and their aliases/synonyms.
   * Maps query terms to directory path patterns.
   */
  private static readonly DIRECTORY_PATTERNS: ReadonlyMap<string, readonly string[]> = new Map([
    // CLI-related
    ['cli', ['cli', 'commands', 'bin']],
    ['command', ['cli', 'commands', 'bin']],
    ['commands', ['cli', 'commands', 'bin']],

    // Storage-related
    ['storage', ['storage', 'db', 'database', 'persistence']],
    ['database', ['storage', 'db', 'database']],
    ['sqlite', ['storage', 'db', 'database']],
    ['persistence', ['storage', 'persistence']],

    // API-related
    ['api', ['api', 'routes', 'endpoints', 'handlers']],
    ['endpoint', ['api', 'routes', 'endpoints']],
    ['route', ['api', 'routes']],

    // Test-related
    ['test', ['test', 'tests', '__tests__', 'spec', 'specs']],
    ['tests', ['test', 'tests', '__tests__', 'spec', 'specs']],
    ['testing', ['test', 'tests', '__tests__', 'spec', 'specs']],
    ['spec', ['test', 'tests', '__tests__', 'spec', 'specs']],

    // Query-related
    ['query', ['query', 'queries', 'search']],
    ['search', ['query', 'search']],
    ['scoring', ['query', 'scoring']],

    // Knowledge-related
    ['knowledge', ['knowledge', 'extractors']],
    ['extractor', ['knowledge', 'extractors']],
    ['extractors', ['knowledge', 'extractors']],

    // Integration-related
    ['integration', ['integration', 'integrations']],
    ['integrations', ['integration', 'integrations']],

    // Config-related
    ['config', ['config', 'configuration', 'settings']],
    ['configuration', ['config', 'configuration']],
    ['settings', ['config', 'settings']],

    // Utils-related
    ['util', ['utils', 'util', 'utilities', 'helpers']],
    ['utils', ['utils', 'util', 'utilities', 'helpers']],
    ['utility', ['utils', 'util', 'utilities']],
    ['helper', ['utils', 'helpers', 'helper']],

    // Graphs-related
    ['graph', ['graphs', 'graph']],
    ['graphs', ['graphs', 'graph']],

    // Ingest-related
    ['ingest', ['ingest', 'ingestion', 'indexer']],
    ['indexer', ['ingest', 'indexer']],
    ['indexing', ['ingest', 'indexer']],

    // Strategic-related
    ['strategic', ['strategic', 'strategy']],
    ['strategy', ['strategic', 'strategy']],

    // State-related
    ['state', ['state', 'store']],
    ['store', ['state', 'store', 'storage']],

    // Events-related
    ['event', ['events', 'event']],
    ['events', ['events', 'event']],

    // Types-related
    ['type', ['types']],
    ['types', ['types']],

    // Core-related
    ['core', ['core']],

    // Adapters-related
    ['adapter', ['adapters', 'adapter']],
    ['adapters', ['adapters', 'adapter']],
  ]);

  async compute(
    _entityId: EntityId,
    context: QueryContext,
    entityData: EntityData
  ): Promise<SignalValue> {
    // If no target directories detected from query, return neutral
    if (!context.targetDirectories?.length) {
      return { signal: this.signal, score: 0.5, confidence: 0.2 };
    }

    // If entity has no path, can't compute affinity
    if (!entityData.path) {
      return { signal: this.signal, score: 0.3, confidence: 0.3 };
    }

    const entityPath = entityData.path.toLowerCase();
    const pathParts = entityPath.split('/');

    // Check for matches
    let bestScore = 0;
    const matchedDirectories: string[] = [];

    for (const targetDir of context.targetDirectories) {
      // Direct path segment match (e.g., "cli" matches "src/cli/commands.ts")
      if (pathParts.some(part => part === targetDir || part.includes(targetDir))) {
        bestScore = Math.max(bestScore, 1.0);
        matchedDirectories.push(targetDir);
        continue;
      }

      // Partial match (e.g., "command" matches "src/cli/commands/")
      const dirPatterns = DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.get(targetDir);
      if (dirPatterns) {
        for (const pattern of dirPatterns) {
          if (pathParts.some(part => part === pattern || part.includes(pattern))) {
            bestScore = Math.max(bestScore, 0.9);
            matchedDirectories.push(targetDir);
            break;
          }
        }
      }
    }

    // If no match found, apply penalty for being outside target directories
    if (bestScore === 0) {
      // Check if this is in a "competing" directory (e.g., query about CLI but result is from storage)
      const isInCompetingArea = this.isInCompetingDirectory(pathParts, context.targetDirectories);
      if (isInCompetingArea) {
        return {
          signal: this.signal,
          score: 0.15, // Strong penalty for competing areas
          confidence: 0.8,
          metadata: { matchedDirectories: [], targetDirectories: context.targetDirectories, penalty: 'competing_area' },
        };
      }
      // Mild penalty for unrelated areas
      return {
        signal: this.signal,
        score: 0.35,
        confidence: 0.6,
        metadata: { matchedDirectories: [], targetDirectories: context.targetDirectories, penalty: 'no_match' },
      };
    }

    return {
      signal: this.signal,
      score: bestScore,
      confidence: 0.85,
      metadata: { matchedDirectories, targetDirectories: context.targetDirectories },
    };
  }

  /**
   * Checks if the entity path is in a directory that "competes" with the target.
   * For example, if querying about "CLI", a result from "storage" is competing.
   */
  private isInCompetingDirectory(pathParts: string[], targetDirectories: string[]): boolean {
    // Define competing directory groups
    const competingGroups: string[][] = [
      ['cli', 'api', 'storage', 'query', 'knowledge', 'graphs', 'ingest', 'strategic'],
    ];

    // Find which group(s) the targets belong to
    const targetGroups = new Set<number>();
    for (const target of targetDirectories) {
      for (let i = 0; i < competingGroups.length; i++) {
        if (competingGroups[i].includes(target)) {
          targetGroups.add(i);
        }
      }
    }

    // Check if entity path is in a different member of the same competing group
    for (const part of pathParts) {
      for (const groupIndex of targetGroups) {
        const group = competingGroups[groupIndex];
        if (group.includes(part) && !targetDirectories.some(t => {
          const patterns = DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.get(t);
          return patterns?.includes(part) || t === part;
        })) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detects directory patterns from query text.
   * This is a static utility method that can be used by buildQueryContext.
   */
  static detectDirectoryPatterns(queryText: string): string[] {
    const queryLower = queryText.toLowerCase();
    const detected: string[] = [];

    // Tokenize query
    const tokens = queryLower.split(/[^a-z0-9_]+/g).filter(t => t.length >= 2);

    // Check each token against known patterns
    for (const token of tokens) {
      if (DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.has(token)) {
        // Get the canonical directory name (first in the array)
        const patterns = DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.get(token);
        if (patterns && patterns.length > 0) {
          const canonical = patterns[0];
          if (!detected.includes(canonical)) {
            detected.push(canonical);
          }
        }
      }
    }

    // Also check for explicit directory mentions (e.g., "src/cli", "the cli folder")
    const explicitPatterns = [
      /\bsrc\/([a-z_]+)/g,
      /\b(cli|api|storage|query|test|config|utils?|graphs?|ingest|knowledge|strategic)\s*(folder|directory|module|layer)/gi,
      /\b(in|from|under)\s+(the\s+)?([a-z_]+)\s*(folder|directory|module|layer)?/gi,
    ];

    for (const pattern of explicitPatterns) {
      const matches = queryLower.matchAll(pattern);
      for (const match of matches) {
        const dirName = (match[1] || match[3])?.toLowerCase();
        if (dirName && DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.has(dirName)) {
          const patterns = DirectoryAffinitySignalComputer.DIRECTORY_PATTERNS.get(dirName);
          if (patterns && patterns.length > 0 && !detected.includes(patterns[0])) {
            detected.push(patterns[0]);
          }
        }
      }
    }

    return detected;
  }
}

// ============================================================================
// MULTI-SIGNAL SCORER
// ============================================================================

export class MultiSignalScorer {
  private weights: Map<SignalType, SignalWeight>;
  private computers: Map<SignalType, SignalComputer>;
  private feedbackHistory: FeedbackRecord[] = [];
  private readonly maxFeedbackHistory = 10000;

  constructor() {
    // Initialize default weights
    // Note: Weights are adjusted to include hotspot signal (10%) and directory_affinity (12%)
    // Per research in docs/research/usage-weighted-prioritization.md
    // Directory affinity is high-weight because it directly addresses the scattered results problem
    // Signal weights tuned for optimal relevance ranking
    // Higher weights for signals that directly identify relevant entities:
    // - semantic (0.16): embedding similarity captures conceptual relevance
    // - keyword (0.18): filename/path matches are strong relevance signals (boosted from 0.12)
    // - directory_affinity (0.16): directory context reduces cross-domain noise
    this.weights = new Map([
      ['semantic', { signal: 'semantic', weight: 0.16, learningRate: 0.1 }],
      ['structural', { signal: 'structural', weight: 0.05, learningRate: 0.1 }],
      ['history', { signal: 'history', weight: 0.04, learningRate: 0.1 }],
      ['recency', { signal: 'recency', weight: 0.04, learningRate: 0.1 }],
      ['keyword', { signal: 'keyword', weight: 0.18, learningRate: 0.1 }],         // Increased: filename matches are critical
      ['domain', { signal: 'domain', weight: 0.06, learningRate: 0.1 }],
      ['entity_type', { signal: 'entity_type', weight: 0.05, learningRate: 0.1 }],
      ['ownership', { signal: 'ownership', weight: 0.04, learningRate: 0.1 }],
      ['risk', { signal: 'risk', weight: 0.03, learningRate: 0.1 }],
      ['test', { signal: 'test', weight: 0.03, learningRate: 0.1 }],
      ['dependency', { signal: 'dependency', weight: 0.04, learningRate: 0.1 }],
      ['hotspot', { signal: 'hotspot', weight: 0.08, learningRate: 0.1 }],
      ['directory_affinity', { signal: 'directory_affinity', weight: 0.16, learningRate: 0.1 }],
    ]);

    // Initialize default signal computers
    this.computers = new Map([
      ['semantic', new SemanticSignalComputer()],
      ['structural', new StructuralSignalComputer()],
      ['history', new HistorySignalComputer()],
      ['recency', new RecencySignalComputer()],
      ['keyword', new KeywordSignalComputer()],
      ['domain', new DomainSignalComputer()],
      ['entity_type', new EntityTypeSignalComputer()],
      ['ownership', new OwnershipSignalComputer()],
      ['risk', new RiskSignalComputer()],
      ['test', new TestSignalComputer()],
      ['dependency', new DependencySignalComputer()],
      ['hotspot', new HotspotSignalComputer()],
      ['directory_affinity', new DirectoryAffinitySignalComputer()],
    ]);
  }

  // ============================================================================
  // SCORING
  // ============================================================================

  /**
   * Score a single entity against a query context
   */
  async scoreEntity(
    entityData: EntityData,
    context: QueryContext
  ): Promise<ScoredEntity> {
    const signals: SignalValue[] = [];

    // Compute all signals in parallel
    const signalPromises = Array.from(this.computers.entries()).map(
      async ([signalType, computer]) => {
        try {
          return await computer.compute(entityData.id, context, entityData);
        } catch {
          // Return neutral signal on error
          return { signal: signalType, score: 0.5, confidence: 0 };
        }
      }
    );

    const computedSignals = await Promise.all(signalPromises);
    signals.push(...computedSignals);

    // Combine signals using weighted sum
    const { score, confidence } = this.combineSignals(signals);

    // Generate explanation
    const explanation = this.generateExplanation(signals);

    return {
      entityId: entityData.id,
      signals,
      combinedScore: score,
      confidence,
      explanation,
    };
  }

  /**
   * Score multiple entities
   */
  async scoreEntities(
    entities: EntityData[],
    context: QueryContext
  ): Promise<ScoredEntity[]> {
    const scored = await Promise.all(
      entities.map(e => this.scoreEntity(e, context))
    );

    // Sort by combined score descending
    return scored.sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Combine signals into a final score
   */
  private combineSignals(signals: SignalValue[]): { score: number; confidence: number } {
    let weightedSum = 0;
    let totalWeight = 0;
    let confidenceSum = 0;
    let confidenceWeightSum = 0;

    for (const signal of signals) {
      const weight = this.weights.get(signal.signal)?.weight ?? 0;

      // Weight by both configured weight and signal confidence
      const effectiveWeight = weight * signal.confidence;
      weightedSum += signal.score * effectiveWeight;
      totalWeight += effectiveWeight;

      // Track confidence separately
      confidenceSum += signal.confidence * weight;
      confidenceWeightSum += weight;
    }

    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const confidence = confidenceWeightSum > 0 ? confidenceSum / confidenceWeightSum : 0;

    return { score, confidence };
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(signals: SignalValue[]): string {
    // Sort by contribution (score * weight * confidence)
    const contributions = signals
      .map(s => ({
        signal: s.signal,
        contribution: s.score * (this.weights.get(s.signal)?.weight ?? 0) * s.confidence,
        score: s.score,
      }))
      .sort((a, b) => b.contribution - a.contribution);

    const top3 = contributions.slice(0, 3);
    const explanations = top3.map(c => {
      const pct = Math.round(c.score * 100);
      return `${c.signal}: ${pct}%`;
    });

    return `Top signals: ${explanations.join(', ')}`;
  }

  // ============================================================================
  // WEIGHT LEARNING
  // ============================================================================

  /**
   * Record feedback on a scored entity
   */
  recordFeedback(entityId: EntityId, wasRelevant: boolean, signals: SignalValue[]): void {
    this.feedbackHistory.push({
      entityId,
      wasRelevant,
      signals,
      timestamp: now(),
    });

    // Prune old feedback
    if (this.feedbackHistory.length > this.maxFeedbackHistory) {
      this.feedbackHistory = this.feedbackHistory.slice(-this.maxFeedbackHistory);
    }

    // Update weights based on feedback
    this.updateWeights(wasRelevant, signals);
  }

  /**
   * Update weights based on feedback
   */
  private updateWeights(wasRelevant: boolean, signals: SignalValue[]): void {
    const target = wasRelevant ? 1.0 : 0.0;

    for (const signal of signals) {
      const weightConfig = this.weights.get(signal.signal);
      if (!weightConfig) continue;

      // Gradient: how much did this signal contribute to the error?
      // If signal was high and result was wrong, reduce weight
      // If signal was high and result was right, increase weight
      const error = target - signal.score;
      const gradient = error * signal.confidence;

      // Update weight with learning rate
      const newWeight = weightConfig.weight + weightConfig.learningRate * gradient;

      // Clamp to reasonable range
      weightConfig.weight = Math.max(0.01, Math.min(0.5, newWeight));
    }

    // Normalize weights to sum to 1
    this.normalizeWeights();
  }

  /**
   * Normalize weights to sum to 1
   */
  private normalizeWeights(): void {
    let total = 0;
    for (const config of this.weights.values()) {
      total += config.weight;
    }

    if (total > 0) {
      for (const config of this.weights.values()) {
        config.weight /= total;
      }
    }
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Register a custom signal computer
   */
  registerComputer(computer: SignalComputer): void {
    this.computers.set(computer.signal, computer);

    // Add default weight if not exists
    if (!this.weights.has(computer.signal)) {
      this.weights.set(computer.signal, {
        signal: computer.signal,
        weight: 0.05, // Low default weight for new signals
        learningRate: 0.1,
      });
      this.normalizeWeights();
    }
  }

  /**
   * Set weight for a signal
   */
  setWeight(signal: SignalType, weight: number): void {
    const config = this.weights.get(signal);
    if (config) {
      config.weight = Math.max(0.01, Math.min(1.0, weight));
      this.normalizeWeights();
    }
  }

  /**
   * Get current weights
   */
  getWeights(): Record<SignalType, number> {
    const result: Partial<Record<SignalType, number>> = {};
    for (const [signal, config] of this.weights) {
      result[signal] = config.weight;
    }
    return result as Record<SignalType, number>;
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get learning statistics
   */
  getStats(): {
    totalFeedback: number;
    positiveRatio: number;
    weights: Record<SignalType, number>;
    signalPerformance: Record<SignalType, { avgScore: number; avgContribution: number }>;
  } {
    const positiveCount = this.feedbackHistory.filter(f => f.wasRelevant).length;
    const positiveRatio = this.feedbackHistory.length > 0
      ? positiveCount / this.feedbackHistory.length
      : 0;

    // Calculate signal performance from feedback
    const signalPerformance: Record<string, { scores: number[]; contributions: number[] }> = {};

    for (const feedback of this.feedbackHistory.slice(-1000)) {
      for (const signal of feedback.signals) {
        if (!signalPerformance[signal.signal]) {
          signalPerformance[signal.signal] = { scores: [], contributions: [] };
        }
        signalPerformance[signal.signal].scores.push(signal.score);

        const weight = this.weights.get(signal.signal)?.weight ?? 0;
        signalPerformance[signal.signal].contributions.push(signal.score * weight);
      }
    }

    const avgPerformance: Record<string, { avgScore: number; avgContribution: number }> = {};
    for (const [signal, data] of Object.entries(signalPerformance)) {
      avgPerformance[signal] = {
        avgScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
        avgContribution: data.contributions.reduce((a, b) => a + b, 0) / data.contributions.length,
      };
    }

    return {
      totalFeedback: this.feedbackHistory.length,
      positiveRatio,
      weights: this.getWeights(),
      signalPerformance: avgPerformance as Record<SignalType, { avgScore: number; avgContribution: number }>,
    };
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  /**
   * Export state for persistence
   */
  toJSON(): {
    weights: Record<SignalType, SignalWeight>;
    recentFeedback: FeedbackRecord[];
  } {
    return {
      weights: Object.fromEntries(this.weights) as Record<SignalType, SignalWeight>,
      recentFeedback: this.feedbackHistory.slice(-1000),
    };
  }

  /**
   * Import state
   */
  fromJSON(data: {
    weights?: Record<string, SignalWeight>;
    recentFeedback?: FeedbackRecord[];
  }): void {
    if (data.weights) {
      for (const [signal, config] of Object.entries(data.weights)) {
        this.weights.set(signal as SignalType, config);
      }
    }

    if (data.recentFeedback) {
      this.feedbackHistory = data.recentFeedback;
    }
  }

  /**
   * Reset to default weights
   */
  reset(): void {
    this.feedbackHistory = [];
    this.weights = new Map([
      ['semantic', { signal: 'semantic', weight: 0.16, learningRate: 0.1 }],
      ['structural', { signal: 'structural', weight: 0.05, learningRate: 0.1 }],
      ['history', { signal: 'history', weight: 0.04, learningRate: 0.1 }],
      ['recency', { signal: 'recency', weight: 0.04, learningRate: 0.1 }],
      ['keyword', { signal: 'keyword', weight: 0.18, learningRate: 0.1 }],
      ['domain', { signal: 'domain', weight: 0.06, learningRate: 0.1 }],
      ['entity_type', { signal: 'entity_type', weight: 0.05, learningRate: 0.1 }],
      ['ownership', { signal: 'ownership', weight: 0.04, learningRate: 0.1 }],
      ['risk', { signal: 'risk', weight: 0.03, learningRate: 0.1 }],
      ['test', { signal: 'test', weight: 0.03, learningRate: 0.1 }],
      ['dependency', { signal: 'dependency', weight: 0.04, learningRate: 0.1 }],
      ['hotspot', { signal: 'hotspot', weight: 0.08, learningRate: 0.1 }],
      ['directory_affinity', { signal: 'directory_affinity', weight: 0.16, learningRate: 0.1 }],
    ]);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const multiSignalScorer = new MultiSignalScorer();
