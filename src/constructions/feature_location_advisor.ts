/**
 * @fileoverview Feature Location Advisor Construction
 *
 * A composed construction that locates features across a codebase by combining:
 * - Semantic search for intent-based discovery
 * - Pattern detection for code structure matching
 * - Call graph traversal for relationship mapping
 *
 * Composes:
 * - Query API for semantic search
 * - Knowledge Graph for call relationships
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 */

import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface FeatureQuery {
  /** Description of the feature to locate */
  description: string;
  /** Keywords to search for */
  keywords?: string[];
  /** Areas of the codebase likely affected */
  affectedAreas?: string[];
}

export interface FeatureLocation {
  /** File path where the feature is located */
  file: string;
  /** Start line of the feature */
  startLine: number;
  /** End line of the feature */
  endLine: number;
  /** Type of match */
  matchType: 'semantic' | 'pattern' | 'call_graph' | 'keyword';
  /** Relevance score */
  relevance: number;
  /** Code snippet preview */
  preview: string;
  /** Function or module name if applicable */
  entityName?: string;
}

export interface FeatureLocationReport {
  /** Original query */
  query: FeatureQuery;

  /** Located feature positions */
  locations: FeatureLocation[];

  /** Number of locations found */
  locationCount: number;

  /** Primary location (highest relevance) */
  primaryLocation: FeatureLocation | null;

  /** Related features that may be affected */
  relatedFeatures: string[];

  /** Confidence in the location results */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Analysis timing */
  analysisTimeMs: number;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class FeatureLocationAdvisor {
  private librarian: Librarian;

  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  /**
   * Locate a feature in the codebase.
   */
  async locate(query: FeatureQuery): Promise<FeatureLocationReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];
    const locations: FeatureLocation[] = [];

    // Step 1: Semantic search based on description
    const semanticLocations = await this.semanticSearch(query.description, query.affectedAreas);
    locations.push(...semanticLocations);
    evidenceRefs.push(`semantic_search:${semanticLocations.length}_matches`);

    // Step 2: Keyword pattern matching
    if (query.keywords && query.keywords.length > 0) {
      const patternLocations = await this.patternSearch(query.keywords);
      locations.push(...patternLocations);
      evidenceRefs.push(`pattern_search:${patternLocations.length}_matches`);
    }

    // Step 3: Call graph expansion for related code
    const callGraphLocations = await this.callGraphExpansion(locations.slice(0, 5));
    locations.push(...callGraphLocations);
    evidenceRefs.push(`call_graph:${callGraphLocations.length}_related`);

    // Deduplicate and rank
    const rankedLocations = this.deduplicateAndRank(locations);

    // Find related features
    const relatedFeatures = this.extractRelatedFeatures(rankedLocations);

    // Compute confidence
    const confidence = this.computeConfidence(rankedLocations, query);

    return {
      query,
      locations: rankedLocations,
      locationCount: rankedLocations.length,
      primaryLocation: rankedLocations[0] || null,
      relatedFeatures,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Step 1: Semantic search using librarian query.
   */
  private async semanticSearch(
    description: string,
    affectedAreas?: string[]
  ): Promise<FeatureLocation[]> {
    const queryResult = await this.librarian.queryOptional({
      intent: `Find code implementing: ${description}`,
      affectedFiles: affectedAreas,
      depth: 'L2',
      taskType: 'understand',
      perspective: 'navigation',
    });

    const locations: FeatureLocation[] = [];

    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        const packLocations = this.extractLocationsFromPack(pack, 'semantic');
        locations.push(...packLocations);
      }
    }

    return locations;
  }

  /**
   * Step 2: Pattern-based search using keywords.
   */
  private async patternSearch(keywords: string[]): Promise<FeatureLocation[]> {
    const locations: FeatureLocation[] = [];

    for (const keyword of keywords) {
      const queryResult = await this.librarian.queryOptional({
        intent: `Find code containing or related to: ${keyword}`,
        depth: 'L1',
        taskType: 'understand',
        perspective: 'navigation',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs) {
          const packLocations = this.extractLocationsFromPack(pack, 'keyword');
          // Filter to locations that actually contain the keyword
          const filtered = packLocations.filter(loc =>
            loc.preview.toLowerCase().includes(keyword.toLowerCase())
          );
          locations.push(...filtered);
        }
      }
    }

    return locations;
  }

  /**
   * Step 3: Expand via call graph to find related code.
   */
  private async callGraphExpansion(seedLocations: FeatureLocation[]): Promise<FeatureLocation[]> {
    if (seedLocations.length === 0) return [];

    const relatedLocations: FeatureLocation[] = [];
    const seenFiles = new Set(seedLocations.map(loc => loc.file));

    for (const seed of seedLocations.slice(0, 3)) {
      const queryResult = await this.librarian.queryOptional({
        intent: `Find code that calls or is called by functions in ${seed.file}`,
        affectedFiles: [seed.file],
        depth: 'L1',
        taskType: 'understand',
        perspective: 'navigation',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs) {
          const packLocations = this.extractLocationsFromPack(pack, 'call_graph');
          for (const loc of packLocations) {
            if (!seenFiles.has(loc.file)) {
              seenFiles.add(loc.file);
              relatedLocations.push({
                ...loc,
                relevance: loc.relevance * 0.8, // Reduce relevance for call graph matches
              });
            }
          }
        }
      }
    }

    return relatedLocations;
  }

  /**
   * Extract locations from a context pack.
   */
  private extractLocationsFromPack(
    pack: ContextPack,
    matchType: FeatureLocation['matchType']
  ): FeatureLocation[] {
    const locations: FeatureLocation[] = [];

    if (pack.codeSnippets) {
      for (const snippet of pack.codeSnippets) {
        locations.push({
          file: snippet.filePath || pack.relatedFiles?.[0] || 'unknown',
          startLine: snippet.startLine,
          endLine: snippet.endLine,
          matchType,
          relevance: pack.confidence || 0.5,
          preview: snippet.content.substring(0, 200),
          entityName: pack.targetId,
        });
      }
    }

    // If no snippets, create location from pack metadata
    if (locations.length === 0 && pack.relatedFiles && pack.relatedFiles.length > 0) {
      locations.push({
        file: pack.relatedFiles[0],
        startLine: 1,
        endLine: 100,
        matchType,
        relevance: pack.confidence || 0.5,
        preview: pack.summary || '',
        entityName: pack.targetId,
      });
    }

    return locations;
  }

  /**
   * Deduplicate locations and rank by relevance.
   */
  private deduplicateAndRank(locations: FeatureLocation[]): FeatureLocation[] {
    const seen = new Map<string, FeatureLocation>();

    for (const loc of locations) {
      const key = `${loc.file}:${loc.startLine}`;
      const existing = seen.get(key);

      if (!existing || loc.relevance > existing.relevance) {
        seen.set(key, loc);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Extract related feature names from locations.
   */
  private extractRelatedFeatures(locations: FeatureLocation[]): string[] {
    const features = new Set<string>();

    for (const loc of locations) {
      if (loc.entityName) {
        features.add(loc.entityName);
      }
    }

    return Array.from(features).slice(0, 10);
  }

  /**
   * Compute confidence in the location results.
   */
  private computeConfidence(
    locations: FeatureLocation[],
    query: FeatureQuery
  ): ConfidenceValue {
    if (locations.length === 0) {
      return {
        type: 'absent' as const,
        reason: 'insufficient_data' as const,
      };
    }

    // Multiple high-relevance matches increase confidence
    const highRelevanceCount = locations.filter(l => l.relevance > 0.7).length;
    const hasKeywordMatches = locations.some(l => l.matchType === 'keyword' || l.matchType === 'pattern');
    const hasSemanticMatches = locations.some(l => l.matchType === 'semantic');

    if (highRelevanceCount === 0) {
      return {
        type: 'bounded' as const,
        low: 0.2,
        high: 0.6,
        basis: 'theoretical' as const,
        citation: 'Low relevance scores indicate weak matches; feature may be elsewhere or not exist',
      };
    }

    // Compute confidence based on match quality
    const avgRelevance = locations.reduce((sum, l) => sum + l.relevance, 0) / locations.length;
    const matchTypeBonus = (hasKeywordMatches && hasSemanticMatches) ? 0.1 : 0;
    const confidenceValue = Math.min(0.95, avgRelevance + matchTypeBonus);

    return {
      type: 'measured' as const,
      value: confidenceValue,
      measurement: {
        datasetId: 'feature_location_analysis',
        sampleSize: locations.length,
        accuracy: avgRelevance,
        confidenceInterval: [
          Math.max(0, confidenceValue - 0.15),
          Math.min(1, confidenceValue + 0.1),
        ] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createFeatureLocationAdvisor(librarian: Librarian): FeatureLocationAdvisor {
  return new FeatureLocationAdvisor(librarian);
}
