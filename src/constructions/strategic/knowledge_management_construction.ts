/**
 * @fileoverview Knowledge Management Construction
 *
 * Construction wrapper for the knowledge_management strategic module.
 * Assesses knowledge management practices and identifies gaps.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as km from '../../strategic/knowledge_management.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for knowledge management assessment.
 */
export interface KnowledgeManagementAssessmentInput {
  /** Files to analyze (docs, decision records, runbooks) */
  files: string[];
  /** Existing knowledge graph if available */
  knowledgeGraph?: km.KnowledgeGraph;
  /** Focus areas for assessment */
  focus?: Array<km.KnowledgeType>;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for knowledge management assessment.
 */
export interface KnowledgeManagementAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Knowledge gaps identified */
  gaps: km.KnowledgeGapItem[];
  /** Stale knowledge items */
  staleItems: km.KnowledgeItem[];
  /** Contradictions found */
  contradictions: km.Contradiction[];
  /** Improvement suggestions */
  improvements: km.KnowledgeImprovement[];
  /** Knowledge coverage by type */
  coverageByType: Record<km.KnowledgeType, number>;
  /** Confidence in this result */
  confidence: ConfidenceValue;
  /** Evidence references */
  evidenceRefs: string[];
  /** Analysis time in milliseconds */
  analysisTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Construction for assessing knowledge management practices.
 *
 * Uses the knowledge_management strategic module to evaluate
 * knowledge coverage, staleness, and organizational learning.
 *
 * @example
 * ```typescript
 * const construction = new KnowledgeManagementConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['docs/**', 'adr/**', 'runbooks/**'],
 *   focus: ['decision', 'operational'],
 * });
 * console.log(`Knowledge Gaps: ${result.gaps.length}`);
 * ```
 */
export class KnowledgeManagementConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'KnowledgeManagementConstruction';
  readonly CONSTRUCTION_ID = KnowledgeManagementConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return KnowledgeManagementConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (this.calibrationTracker) {
      this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
    }
  }

  /**
   * Get the default knowledge graph (empty in-memory graph).
   */
  getStandard(): km.KnowledgeGraph {
    return km.createKnowledgeGraph();
  }

  /**
   * Assess knowledge management practices.
   *
   * @param input - Files and optional knowledge graph
   * @param options - Assessment options
   * @returns Knowledge management assessment
   */
  async assess(
    input: KnowledgeManagementAssessmentInput,
    options?: AssessmentOptions
  ): Promise<KnowledgeManagementAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand knowledge context
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze knowledge management including documentation, decision records, runbooks, and domain knowledge',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:km_analysis:${queryResult.packs?.length || 0}_packs`);

    // Get or create knowledge graph
    const graph = input.knowledgeGraph || this.getStandard();
    evidenceRefs.push(`graph:${graph.items.length}_items`);

    // Extract knowledge items from query results
    const extractedItems = this.extractKnowledgeItems(queryResult, input.focus);
    evidenceRefs.push(`extracted:${extractedItems.length}_items`);

    // Find gaps
    const gaps = this.identifyKnowledgeGaps(graph, extractedItems, input.focus);
    evidenceRefs.push(`gaps:${gaps.length}`);

    // Find stale items
    const staleItems = this.findStaleItems([...graph.items, ...extractedItems]);
    evidenceRefs.push(`stale:${staleItems.length}`);

    // Find contradictions (simplified)
    const contradictions = this.findContradictions(graph);
    evidenceRefs.push(`contradictions:${contradictions.length}`);

    // Generate improvements
    const improvements = this.generateImprovements(gaps, staleItems, contradictions);
    evidenceRefs.push(`improvements:${improvements.length}`);

    // Compute coverage by type
    const coverageByType = this.computeCoverageByType(extractedItems, input.focus);
    evidenceRefs.push(`coverage:computed`);

    // Compute breakdown
    const breakdown: Record<string, number> = {
      documentation: this.computeTypeScore(coverageByType, 'technical'),
      decisions: this.computeTypeScore(coverageByType, 'decision'),
      operational: this.computeTypeScore(coverageByType, 'operational'),
      domain: this.computeTypeScore(coverageByType, 'domain'),
      freshness: this.computeFreshnessScore(staleItems, extractedItems.length),
    };

    // Overall score
    const values = Object.values(breakdown);
    const score = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

    // Generate recommendations
    const recommendations = this.generateKMRecommendations(gaps, staleItems, improvements);

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, { score });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Knowledge management assessment: ${score}/100`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      gaps,
      staleItems,
      contradictions,
      improvements,
      coverageByType,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }

  /**
   * Record a prediction for calibration tracking.
   */
  private recordPrediction(claim: string, confidence: ConfidenceValue): string {
    const predictionId = generatePredictionId(this.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        this.CONSTRUCTION_ID,
        predictionId,
        confidence,
        claim
      );
    }
    return predictionId;
  }

  /**
   * Compute a letter grade from a numeric score.
   */
  private computeGrade(score: number): string {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 67) return 'D+';
    if (score >= 63) return 'D';
    if (score >= 60) return 'D-';
    return 'F';
  }

  /**
   * Extract knowledge items from query results.
   */
  private extractKnowledgeItems(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    focus?: km.KnowledgeType[]
  ): km.KnowledgeItem[] {
    const items: km.KnowledgeItem[] = [];
    const packs = queryResult.packs || [];

    for (const pack of packs) {
      // Determine knowledge type based on content
      const type = this.inferKnowledgeType(pack);

      if (focus && !focus.includes(type)) {
        continue;
      }

      const item: km.KnowledgeItem = {
        id: pack.packId,
        type,
        title: pack.targetId || 'Unknown',
        content: pack.summary || '',
        tags: [],
        confidence: {
          type: 'measured' as const,
          value: pack.confidence || 0.5,
          measurement: {
            datasetId: 'knowledge_extraction',
            sampleSize: 1,
            accuracy: pack.confidence || 0.5,
            confidenceInterval: [
              Math.max(0, (pack.confidence || 0.5) - 0.1),
              Math.min(1, (pack.confidence || 0.5) + 0.1),
            ] as [number, number],
            measuredAt: new Date().toISOString(),
          },
        },
        evidenceRefs: pack.relatedFiles || [],
        createdAt: pack.createdAt || new Date(),
        updatedAt: pack.createdAt || new Date(),
        author: 'system',
        staleness: km.createDefaultStalenessInfo(),
        feedback: km.createDefaultFeedbackStats(),
      };

      items.push(item);
    }

    return items;
  }

  /**
   * Infer knowledge type from pack content.
   */
  private inferKnowledgeType(
    pack: Awaited<ReturnType<LiBrainian['queryOptional']>>['packs'][number]
  ): km.KnowledgeType {
    const summary = (pack.summary || '').toLowerCase();
    const files = (pack.relatedFiles || []).join(' ').toLowerCase();

    if (files.includes('adr') || summary.includes('decision')) return 'decision';
    if (files.includes('runbook') || summary.includes('operation')) return 'operational';
    if (summary.includes('domain') || summary.includes('business')) return 'domain';
    if (summary.includes('lesson') || summary.includes('learned')) return 'lesson';
    if (summary.includes('recipe') || summary.includes('how to')) return 'recipe';
    if (summary.includes('glossary') || summary.includes('term')) return 'glossary';
    return 'technical';
  }

  /**
   * Identify knowledge gaps.
   */
  private identifyKnowledgeGaps(
    graph: km.KnowledgeGraph,
    extracted: km.KnowledgeItem[],
    focus?: km.KnowledgeType[]
  ): km.KnowledgeGapItem[] {
    const gaps: km.KnowledgeGapItem[] = [];
    const knowledgeTypes: km.KnowledgeType[] = focus || [
      'decision',
      'operational',
      'domain',
      'technical',
      'lesson',
      'recipe',
      'glossary',
    ];

    // Check for missing knowledge types
    const existingTypes = new Set([
      ...graph.items.map((i) => i.type),
      ...extracted.map((i) => i.type),
    ]);

    for (const type of knowledgeTypes) {
      if (!existingTypes.has(type)) {
        gaps.push({
          area: `Missing ${type} knowledge`,
          importance: type === 'decision' || type === 'operational' ? 'high' : 'medium',
          suggestedActions: [`Create ${type} documentation`, `Document existing ${type} knowledge`],
          detectedAt: new Date(),
        });
      }
    }

    // Check for sparse coverage
    const itemCounts = new Map<km.KnowledgeType, number>();
    for (const item of [...graph.items, ...extracted]) {
      itemCounts.set(item.type, (itemCounts.get(item.type) || 0) + 1);
    }

    for (const [type, count] of itemCounts) {
      if (count < 3) {
        gaps.push({
          area: `Sparse ${type} coverage`,
          importance: 'medium',
          suggestedActions: [`Expand ${type} documentation`, `Review and document more ${type} items`],
          detectedAt: new Date(),
        });
      }
    }

    return gaps;
  }

  /**
   * Find stale knowledge items.
   */
  private findStaleItems(items: km.KnowledgeItem[]): km.KnowledgeItem[] {
    return items.filter((item) => km.isKnowledgeStale(item));
  }

  /**
   * Find contradictions in knowledge graph.
   */
  private findContradictions(graph: km.KnowledgeGraph): km.Contradiction[] {
    // Use graph's findContradictions if available
    if ('findContradictions' in graph && typeof graph.findContradictions === 'function') {
      return (graph as unknown as { findContradictions: () => km.Contradiction[] }).findContradictions();
    }

    // Otherwise check relations for explicit contradictions
    return graph.relations
      .filter((r) => r.type === 'contradicts')
      .map((r) => ({
        itemAId: r.fromId,
        itemBId: r.toId,
        description: r.description || 'Contradicting knowledge items',
        severity: 'significant' as const,
        detectedAt: r.createdAt || new Date(),
      }));
  }

  /**
   * Generate improvement suggestions.
   */
  private generateImprovements(
    gaps: km.KnowledgeGapItem[],
    staleItems: km.KnowledgeItem[],
    contradictions: km.Contradiction[]
  ): km.KnowledgeImprovement[] {
    const improvements: km.KnowledgeImprovement[] = [];

    // Improvements for stale items
    for (const item of staleItems) {
      improvements.push({
        itemId: item.id,
        improvementType: 'update',
        suggestion: `Review and update ${item.title}`,
        reason: `Knowledge is stale (last verified: ${item.staleness.lastVerified.toDateString()})`,
        priority: item.staleness.refreshPriority,
        confidence: bounded(0.7, 0.9, 'theoretical', 'Staleness detection based on time since last verification'),
      });
    }

    // Improvements for contradictions
    for (const contradiction of contradictions) {
      improvements.push({
        itemId: contradiction.itemAId,
        improvementType: 'merge',
        suggestion: contradiction.suggestedResolution || `Resolve contradiction with ${contradiction.itemBId}`,
        reason: contradiction.description,
        priority: contradiction.severity === 'blocking' ? 'high' : 'medium',
        confidence: bounded(0.6, 0.8, 'theoretical', 'Contradiction detection based on semantic analysis'),
      });
    }

    return improvements;
  }

  /**
   * Compute coverage by knowledge type.
   */
  private computeCoverageByType(
    items: km.KnowledgeItem[],
    focus?: km.KnowledgeType[]
  ): Record<km.KnowledgeType, number> {
    const types: km.KnowledgeType[] = focus || [
      'decision',
      'operational',
      'domain',
      'technical',
      'lesson',
      'recipe',
      'glossary',
    ];

    const coverage: Record<km.KnowledgeType, number> = {} as Record<km.KnowledgeType, number>;

    for (const type of types) {
      const typeItems = items.filter((i) => i.type === type);
      // Score based on item count (diminishing returns)
      coverage[type] = Math.min(100, typeItems.length * 20);
    }

    return coverage;
  }

  /**
   * Compute score for a specific knowledge type.
   */
  private computeTypeScore(coverage: Record<km.KnowledgeType, number>, type: km.KnowledgeType): number {
    return coverage[type] || 0;
  }

  /**
   * Compute freshness score.
   */
  private computeFreshnessScore(staleItems: km.KnowledgeItem[], totalItems: number): number {
    if (totalItems === 0) return 100;
    const staleRatio = staleItems.length / totalItems;
    return Math.max(0, Math.round(100 * (1 - staleRatio)));
  }

  /**
   * Generate KM-specific recommendations.
   */
  private generateKMRecommendations(
    gaps: km.KnowledgeGapItem[],
    staleItems: km.KnowledgeItem[],
    improvements: km.KnowledgeImprovement[]
  ): string[] {
    const recommendations: string[] = [];

    // Critical gaps
    for (const gap of gaps.filter((g) => g.importance === 'critical' || g.importance === 'high')) {
      recommendations.push(`[${gap.importance.toUpperCase()}] ${gap.area}: ${gap.suggestedActions[0]}`);
    }

    // Stale items
    if (staleItems.length > 0) {
      recommendations.push(
        `[FRESHNESS] ${staleItems.length} knowledge items need review/update`
      );
    }

    // Top improvements
    for (const improvement of improvements.slice(0, 3)) {
      recommendations.push(
        `[${improvement.priority.toUpperCase()}] ${improvement.suggestion}`
      );
    }

    return recommendations.slice(0, 10);
  }

  /**
   * Compute confidence based on query results and assessment data.
   */
  private computeConfidence(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    data: { score: number }
  ): ConfidenceValue {
    const packCount = queryResult.packs?.length || 0;

    // More packs = more evidence = higher confidence
    const baseConfidence = 0.55;
    const packBonus = Math.min(0.2, packCount * 0.04);

    const low = Math.min(0.85, baseConfidence + packBonus);
    const high = Math.min(0.92, low + 0.1);

    return bounded(low, high, 'theoretical', 'Knowledge management assessment based on graph analysis');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new knowledge management construction.
 *
 * @param librainian - The librainian instance
 * @returns A new KnowledgeManagementConstruction
 */
export function createKnowledgeManagementConstruction(
  librainian: LiBrainian
): KnowledgeManagementConstruction {
  return new KnowledgeManagementConstruction(librainian);
}
