/**
 * @fileoverview Failure Corpus (WU-SELF-004)
 *
 * Captures and grows evaluation data from failures, enabling continuous
 * improvement of the evaluation system through pattern analysis and
 * training data export.
 *
 * Target: eval corpus grows +10% monthly
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A recorded failure case from evaluation
 */
export interface FailureCase {
  /** Unique identifier for this failure */
  id: string;
  /** When the failure occurred */
  timestamp: Date;
  /** Category of failure */
  category: 'retrieval' | 'grounding' | 'calibration' | 'consistency' | 'other';
  /** The query that was asked */
  query: string;
  /** What the result should have been (if known) */
  expectedResult?: string;
  /** What was actually returned */
  actualResult: string;
  /** Type of error that occurred */
  errorType: string;
  /** Additional context about the failure */
  context: Record<string, unknown>;
  /** How severe the failure is */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Statistics about the corpus
 */
export interface CorpusStats {
  /** Total number of failure cases */
  totalCases: number;
  /** Count by category */
  byCategory: Record<string, number>;
  /** Count by severity */
  bySeverity: Record<string, number>;
  /** Growth rate in cases per week */
  growthRate: number;
  /** When the corpus was last updated */
  lastUpdated: Date;
}

/**
 * Configuration for the corpus
 */
export interface CorpusConfig {
  /** Where to store the corpus */
  storagePath: string;
  /** Maximum number of cases to store */
  maxSize: number;
  /** How long to retain cases (days) */
  retentionDays: number;
  /** Whether to auto-classify 'other' categories */
  autoClassify: boolean;
}

/**
 * Analysis of failure patterns
 */
export interface FailureAnalysis {
  /** Detected patterns */
  patterns: FailurePattern[];
  /** Top failure categories */
  topCategories: { category: string; count: number }[];
  /** Recent trend in failures */
  recentTrend: 'increasing' | 'stable' | 'decreasing';
  /** Recommendations for improvement */
  recommendations: string[];
}

/**
 * A pattern of failures
 */
export interface FailurePattern {
  /** Pattern identifier/description */
  pattern: string;
  /** Number of occurrences */
  occurrences: number;
  /** Example failure IDs */
  examples: string[];
  /** Suggested fix (if available) */
  suggestedFix?: string;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: CorpusConfig = {
  storagePath: './failure-corpus',
  maxSize: 100000,
  retentionDays: 365,
  autoClassify: true,
};

// ============================================================================
// AUTO-CLASSIFICATION MAPPINGS
// ============================================================================

const ERROR_TYPE_TO_CATEGORY: Record<string, FailureCase['category']> = {
  // Retrieval errors
  retrieval_miss: 'retrieval',
  retrieval_failure: 'retrieval',
  incomplete_list: 'retrieval',
  missing_result: 'retrieval',
  incorrect_parameter_count: 'retrieval',
  parameter_mismatch: 'retrieval',

  // Grounding errors
  incorrect_location: 'grounding',
  file_not_found: 'grounding',
  line_mismatch: 'grounding',
  hallucinated_file: 'grounding',
  wrong_path: 'grounding',

  // Calibration errors
  boolean_mismatch: 'calibration',
  confidence_error: 'calibration',
  overconfident: 'calibration',
  underconfident: 'calibration',

  // Consistency errors
  inconsistent_answers: 'consistency',
  contradiction: 'consistency',
  conflicting_facts: 'consistency',
};

// ============================================================================
// FAILURE CORPUS CLASS
// ============================================================================

/**
 * Manages a corpus of failure cases for evaluation improvement
 */
export class FailureCorpus {
  private config: CorpusConfig;
  private failures: Map<string, FailureCase>;
  private idCounter: number;
  private lastUpdated: Date;

  constructor(config: Partial<CorpusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.failures = new Map();
    this.idCounter = 0;
    this.lastUpdated = new Date();
  }

  /**
   * Record a new failure case
   */
  async recordFailure(failure: FailureCase): Promise<void> {
    // Generate ID if not provided
    let id = failure.id;
    if (!id || id.trim() === '') {
      id = this.generateId();
    }

    // Check for duplicate ID
    if (this.failures.has(id)) {
      return; // Reject duplicate
    }

    // Set timestamp if not provided
    const timestamp = failure.timestamp instanceof Date ? failure.timestamp : new Date();

    // Auto-classify if enabled and category is 'other'
    let category = failure.category;
    if (this.config.autoClassify && category === 'other') {
      category = this.autoClassify(failure.errorType) || 'other';
    }

    const normalizedFailure: FailureCase = {
      ...failure,
      id,
      timestamp,
      category,
    };

    // Check maxSize limit
    if (this.failures.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.failures.set(id, normalizedFailure);
    this.lastUpdated = new Date();
  }

  /**
   * Get statistics about the corpus
   */
  getStats(): CorpusStats {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const failure of this.failures.values()) {
      byCategory[failure.category] = (byCategory[failure.category] || 0) + 1;
      bySeverity[failure.severity] = (bySeverity[failure.severity] || 0) + 1;
    }

    return {
      totalCases: this.failures.size,
      byCategory,
      bySeverity,
      growthRate: this.calculateGrowthRate(),
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Analyze patterns in the failure corpus
   */
  analyzePatterns(): FailureAnalysis {
    if (this.failures.size === 0) {
      return {
        patterns: [],
        topCategories: [],
        recentTrend: 'stable',
        recommendations: [],
      };
    }

    // Group by error type
    const errorTypeGroups = new Map<string, FailureCase[]>();
    for (const failure of this.failures.values()) {
      const group = errorTypeGroups.get(failure.errorType) || [];
      group.push(failure);
      errorTypeGroups.set(failure.errorType, group);
    }

    // Build patterns
    const patterns: FailurePattern[] = [];
    for (const [errorType, failures] of errorTypeGroups) {
      patterns.push({
        pattern: errorType,
        occurrences: failures.length,
        examples: failures.slice(0, 3).map((f) => f.id),
        suggestedFix: this.suggestFix(errorType),
      });
    }

    // Sort patterns by occurrences
    patterns.sort((a, b) => b.occurrences - a.occurrences);

    // Calculate top categories
    const stats = this.getStats();
    const topCategories = Object.entries(stats.byCategory)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Determine trend
    const recentTrend = this.calculateTrend();

    // Generate recommendations
    const recommendations = this.generateRecommendations(patterns, topCategories);

    return {
      patterns,
      topCategories,
      recentTrend,
      recommendations,
    };
  }

  /**
   * Export the corpus for training
   */
  exportForTraining(format: 'json' | 'csv'): string {
    const failures = Array.from(this.failures.values());

    if (format === 'json') {
      return JSON.stringify(
        failures.map((f) => ({
          id: f.id,
          timestamp: f.timestamp.toISOString(),
          category: f.category,
          query: f.query,
          expectedResult: f.expectedResult,
          actualResult: f.actualResult,
          errorType: f.errorType,
          context: f.context,
          severity: f.severity,
        })),
        null,
        2
      );
    } else {
      // CSV format
      const headers = [
        'id',
        'timestamp',
        'category',
        'query',
        'expectedResult',
        'actualResult',
        'errorType',
        'severity',
      ];
      const headerLine = headers.join(',');

      if (failures.length === 0) {
        return headerLine;
      }

      const dataLines = failures.map((f) =>
        headers
          .map((h) => {
            const value = h === 'timestamp'
              ? f.timestamp.toISOString()
              : (f as unknown as Record<string, unknown>)[h];
            return this.escapeCSV(String(value ?? ''));
          })
          .join(',')
      );

      return [headerLine, ...dataLines].join('\n');
    }
  }

  /**
   * Sample failures from the corpus
   */
  sampleFailures(count: number, category?: string): FailureCase[] {
    if (count <= 0) {
      return [];
    }

    let candidates = Array.from(this.failures.values());

    // Filter by category if specified
    if (category) {
      candidates = candidates.filter((f) => f.category === category);
    }

    if (candidates.length === 0) {
      return [];
    }

    if (candidates.length <= count) {
      return [...candidates];
    }

    // Random sampling
    const sampled: FailureCase[] = [];
    const indices = new Set<number>();

    while (sampled.length < count && indices.size < candidates.length) {
      const index = Math.floor(Math.random() * candidates.length);
      if (!indices.has(index)) {
        indices.add(index);
        sampled.push(candidates[index]);
      }
    }

    return sampled;
  }

  /**
   * Remove duplicate failures from the corpus
   * @returns Number of duplicates removed
   */
  deduplicateCorpus(): number {
    const queryMap = new Map<string, FailureCase[]>();

    // Group by normalized query
    for (const failure of this.failures.values()) {
      const normalizedQuery = this.normalizeQuery(failure.query);
      const group = queryMap.get(normalizedQuery) || [];
      group.push(failure);
      queryMap.set(normalizedQuery, group);
    }

    let removedCount = 0;

    // Keep oldest failure from each group, remove rest
    for (const [, group] of queryMap) {
      if (group.length > 1) {
        // Sort by timestamp (oldest first)
        group.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Remove all but the first (oldest)
        for (let i = 1; i < group.length; i++) {
          this.failures.delete(group[i].id);
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      this.lastUpdated = new Date();
    }

    return removedCount;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private generateId(): string {
    return `failure-${Date.now()}-${++this.idCounter}`;
  }

  private autoClassify(errorType: string): FailureCase['category'] | undefined {
    const normalized = errorType.toLowerCase().replace(/[^a-z_]/g, '_');
    return ERROR_TYPE_TO_CATEGORY[normalized];
  }

  private evictOldest(): void {
    // Find and remove the oldest failure
    let oldest: FailureCase | null = null;

    for (const failure of this.failures.values()) {
      if (!oldest || failure.timestamp < oldest.timestamp) {
        oldest = failure;
      }
    }

    if (oldest) {
      this.failures.delete(oldest.id);
    }
  }

  private calculateGrowthRate(): number {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    let recentCount = 0;
    let olderCount = 0;

    for (const failure of this.failures.values()) {
      const time = failure.timestamp.getTime();
      if (time >= oneWeekAgo) {
        recentCount++;
      } else if (time >= twoWeeksAgo) {
        olderCount++;
      }
    }

    // Growth rate is difference in cases per week
    return recentCount - olderCount;
  }

  private calculateTrend(): FailureAnalysis['recentTrend'] {
    const growthRate = this.calculateGrowthRate();

    if (growthRate > 2) {
      return 'increasing';
    } else if (growthRate < -2) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  private suggestFix(errorType: string): string | undefined {
    const suggestions: Record<string, string> = {
      incorrect_parameter_count: 'Improve parameter extraction from AST',
      incorrect_location: 'Enhance file path resolution',
      incomplete_list: 'Ensure complete enumeration in retrieval',
      boolean_mismatch: 'Review boolean logic in response generation',
      inconsistent_answers: 'Add consistency checks before response',
      hallucinated_file: 'Strengthen grounding verification',
      confidence_error: 'Recalibrate confidence scoring model',
    };

    return suggestions[errorType];
  }

  private generateRecommendations(
    patterns: FailurePattern[],
    topCategories: { category: string; count: number }[]
  ): string[] {
    const recommendations: string[] = [];

    // Recommend based on top patterns
    if (patterns.length > 0 && patterns[0].occurrences >= 5) {
      const topPattern = patterns[0];
      recommendations.push(
        `High frequency error: ${topPattern.pattern} (${topPattern.occurrences} occurrences). ${topPattern.suggestedFix || 'Investigate root cause.'}`
      );
    }

    // Recommend based on top categories
    if (topCategories.length > 0) {
      const topCategory = topCategories[0];
      if (topCategory.count >= 10) {
        recommendations.push(
          `Focus on ${topCategory.category} improvements - highest failure category with ${topCategory.count} cases.`
        );
      }
    }

    return recommendations;
  }

  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private escapeCSV(value: string): string {
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new FailureCorpus instance
 */
export function createFailureCorpus(config?: Partial<CorpusConfig>): FailureCorpus {
  return new FailureCorpus(config);
}
