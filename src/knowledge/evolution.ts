/**
 * @fileoverview Evolution Knowledge System
 *
 * Supports self-evolution capabilities:
 * - Agent fitness tracking
 * - Task outcome learning
 * - Optimization opportunities
 * - Performance trends
 * - Pattern emergence detection
 */

import type { LiBrainianStorage, EvolutionOutcome } from '../storage/types.js';
import {
  buildPerformanceMetrics,
  buildTrendAnalysis,
  calculateQualityScore,
  calculateSpeedScore,
  calculateSuccessRate,
  determineTrend,
  filterOutcomes,
  getAgentComparisons,
} from './evolution_metrics.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EvolutionQuery {
  type:
    | 'fitness'           // Agent/policy fitness metrics
    | 'learning'          // Learned insights from tasks
    | 'optimization'      // What can be optimized?
    | 'trends'            // Performance trends
    | 'performance'       // Current performance metrics
    | 'patterns'          // Successful patterns
    | 'failures'          // Failure patterns
    | 'recommendations';  // System recommendations

  target?: string;
  timeRange?: { start: Date; end: Date };
}

export interface EvolutionResult {
  query: EvolutionQuery;
  fitness?: FitnessMetrics;
  learnings?: LearningInsight[];
  optimizations?: OptimizationOpportunity[];
  trends?: TrendAnalysis;
  performance?: PerformanceMetrics;
  summary: string;
  recommendations: string[];
}

export interface FitnessMetrics {
  overall: number;        // 0-1
  byDimension: Record<string, number>;
  trend: 'improving' | 'stable' | 'declining';
  comparisons: Array<{ name: string; fitness: number; delta: number }>;
}

export interface LearningInsight {
  type: 'success_pattern' | 'failure_pattern' | 'correlation' | 'anomaly';
  description: string;
  confidence: number;
  occurrences: number;
  lastSeen: Date;
  actionable: boolean;
  recommendation?: string;
}

export interface OptimizationOpportunity {
  target: string;
  currentValue: number;
  potentialValue: number;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  description: string;
  steps: string[];
}

export interface TrendAnalysis {
  metric: string;
  direction: 'up' | 'down' | 'stable';
  magnitude: number;
  confidence: number;
  prediction: string;
}

export interface PerformanceMetrics {
  taskSuccessRate: number;
  averageTaskDuration: number;
  errorRate: number;
  throughput: number;
  qualityScore: number;
}

export interface TaskOutcome {
  taskId: string;
  taskType: string;
  agentId: string;
  success: boolean;
  durationMs: number;
  qualityScore: number;
  filesChanged: string[];
  testsAdded: number;
  testsPass: boolean;
  context: {
    librainianContextUsed: boolean;
    contextPackCount: number;
    decomposed: boolean;
  };
  timestamp: Date;
}

// ============================================================================
// EVOLUTION KNOWLEDGE
// ============================================================================

export class EvolutionKnowledge {
  private outcomes: TaskOutcome[] = [];

  constructor(private storage: LiBrainianStorage) {}

  /**
   * Record a task outcome for learning.
   * Persists to storage for long-term learning across restarts.
   */
  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    this.outcomes.push(this.normalizeOutcome(outcome));

    // Convert TaskOutcome to EvolutionOutcome and persist
    const evolutionOutcome: EvolutionOutcome = {
      taskId: outcome.taskId,
      taskType: outcome.taskType,
      agentId: outcome.agentId,
      success: outcome.success,
      durationMs: outcome.durationMs,
      qualityScore: outcome.qualityScore,
      filesChanged: outcome.filesChanged,
      testsAdded: outcome.testsAdded,
      testsPass: outcome.testsPass,
      context: outcome.context,
      timestamp: outcome.timestamp,
    };
    await this.storage.recordEvolutionOutcome(evolutionOutcome);
  }

  async query(q: EvolutionQuery): Promise<EvolutionResult> {
    switch (q.type) {
      case 'fitness':
        return this.analyzeFitness(q);
      case 'learning':
        return this.analyzeLearning(q);
      case 'optimization':
        return this.findOptimizations(q);
      case 'trends':
        return this.analyzeTrends(q);
      case 'performance':
        return this.analyzePerformance(q);
      case 'patterns':
        return this.analyzeSuccessPatterns(q);
      case 'failures':
        return this.analyzeFailurePatterns(q);
      case 'recommendations':
        return this.generateRecommendations(q);
      default:
        return { query: q, summary: 'Unknown query type', recommendations: [] };
    }
  }

  private async analyzeFitness(query: EvolutionQuery): Promise<EvolutionResult> {
    const outcomes = await this.getOutcomes(query.timeRange);
    const successRate = calculateSuccessRate(outcomes);
    const qualityScore = calculateQualityScore(outcomes);
    const speedScore = calculateSpeedScore(outcomes);

    const overall = (successRate + qualityScore + speedScore) / 3;

    const fitness: FitnessMetrics = {
      overall,
      byDimension: {
        taskCompletion: successRate,
        codeQuality: qualityScore,
        speed: speedScore,
      },
      trend: determineTrend(outcomes),
      comparisons: getAgentComparisons(outcomes),
    };

    return {
      query,
      fitness,
      summary: `Overall fitness: ${Math.round(overall * 100)}%`,
      recommendations: overall < 0.7
        ? ['Focus on improving weak dimensions']
        : [],
    };
  }

  private async analyzeLearning(query: EvolutionQuery): Promise<EvolutionResult> {
    const learnings: LearningInsight[] = [];
    const outcomes = await this.getOutcomes(query.timeRange);

    // Analyze success patterns
    const successfulOutcomes = outcomes.filter(o => o.success);
    const failedOutcomes = outcomes.filter(o => !o.success);

    // Pattern: Tasks with librainian context
    const withContext = successfulOutcomes.filter(o => o.context.librainianContextUsed);
    const withoutContext = successfulOutcomes.filter(o => !o.context.librainianContextUsed);
    if (withContext.length > withoutContext.length) {
      learnings.push({
        type: 'success_pattern',
        description: 'Tasks using librainian context have higher success rate',
        confidence: withContext.length / (withContext.length + withoutContext.length),
        occurrences: withContext.length,
        lastSeen: new Date(),
        actionable: true,
        recommendation: 'Always include librainian context for tasks',
      });
    }

    // Pattern: Decomposed tasks
    const decomposed = successfulOutcomes.filter(o => o.context.decomposed);
    if (decomposed.length > successfulOutcomes.length * 0.3) {
      learnings.push({
        type: 'success_pattern',
        description: 'Decomposed tasks complete more reliably',
        confidence: 0.8,
        occurrences: decomposed.length,
        lastSeen: new Date(),
        actionable: true,
        recommendation: 'Decompose complex tasks into smaller subtasks',
      });
    }

    // Pattern: Tests improve success
    const withTests = successfulOutcomes.filter(o => o.testsAdded > 0 && o.testsPass);
    if (withTests.length > 0) {
      learnings.push({
        type: 'success_pattern',
        description: 'Tasks with tests pass quality gates faster',
        confidence: 0.85,
        occurrences: withTests.length,
        lastSeen: new Date(),
        actionable: true,
        recommendation: 'Include tests with all code changes',
      });
    }

    // Failure patterns
    if (failedOutcomes.length > 0) {
      const noContext = failedOutcomes.filter(o => !o.context.librainianContextUsed);
      if (noContext.length > failedOutcomes.length * 0.4) {
        learnings.push({
          type: 'failure_pattern',
          description: 'Tasks without context often fail',
          confidence: noContext.length / failedOutcomes.length,
          occurrences: noContext.length,
          lastSeen: new Date(),
          actionable: true,
          recommendation: 'Always gather context before starting tasks',
        });
      }
    }

    return {
      query,
      learnings,
      summary: `${learnings.length} learning insights from ${outcomes.length} tasks`,
      recommendations: learnings
        .filter(l => l.actionable)
        .slice(0, 3)
        .map(l => l.recommendation!)
        .filter(Boolean),
    };
  }

  private async findOptimizations(query: EvolutionQuery): Promise<EvolutionResult> {
    const optimizations: OptimizationOpportunity[] = [];
    const outcomes = await this.getOutcomes(query.timeRange);

    // Context assembly optimization
    const contextUsage = outcomes.filter(o => o.context.librainianContextUsed).length / (outcomes.length || 1);
    if (contextUsage < 0.8) {
      optimizations.push({
        target: 'context_usage',
        currentValue: contextUsage,
        potentialValue: 0.95,
        effort: 'low',
        impact: 'high',
        description: 'Increase librainian context usage',
        steps: [
          'Enable context assembly by default',
          'Include relevant file context',
          'Add recent change history',
        ],
      });
    }

    // Task decomposition optimization
    const decompositionRate = outcomes.filter(o => o.context.decomposed).length / (outcomes.length || 1);
    if (decompositionRate < 0.5) {
      optimizations.push({
        target: 'task_decomposition',
        currentValue: decompositionRate,
        potentialValue: 0.7,
        effort: 'medium',
        impact: 'high',
        description: 'Decompose more tasks for better success rate',
        steps: [
          'Analyze task complexity before starting',
          'Break large tasks into subtasks',
          'Set complexity thresholds for auto-decomposition',
        ],
      });
    }

    // Test coverage optimization
    const testRate = outcomes.filter(o => o.testsAdded > 0).length / (outcomes.length || 1);
    if (testRate < 0.6) {
      optimizations.push({
        target: 'test_coverage',
        currentValue: testRate,
        potentialValue: 0.8,
        effort: 'medium',
        impact: 'medium',
        description: 'Add more tests to changes',
        steps: [
          'Require tests for all code changes',
          'Provide test templates',
          'Track test addition in quality gates',
        ],
      });
    }

    // Sort by impact/effort ratio
    optimizations.sort((a, b) => {
      const scoreA = this.impactScore(a.impact) / this.effortScore(a.effort);
      const scoreB = this.impactScore(b.impact) / this.effortScore(b.effort);
      return scoreB - scoreA;
    });

    return {
      query,
      optimizations,
      summary: `${optimizations.length} optimization opportunities`,
      recommendations: optimizations.slice(0, 2).map(o => o.description),
    };
  }

  private async analyzeTrends(query: EvolutionQuery): Promise<EvolutionResult> {
    const outcomes = await this.getOutcomes(query.timeRange);
    const trends = buildTrendAnalysis(outcomes);

    return {
      query,
      trends,
      summary: `Success rate trending ${trends.direction} (${Math.round(trends.magnitude * 100)}%)`,
      recommendations: trends.direction === 'down'
        ? ['Investigate recent changes that may have caused decline']
        : [],
    };
  }

  private async analyzePerformance(query: EvolutionQuery): Promise<EvolutionResult> {
    const outcomes = await this.getOutcomes(query.timeRange);
    const performance = buildPerformanceMetrics(outcomes);

    return {
      query,
      performance,
      summary: `Success: ${Math.round(performance.taskSuccessRate * 100)}%, Quality: ${Math.round(performance.qualityScore * 100)}%`,
      recommendations: performance.errorRate > 0.15
        ? ['Error rate above threshold - investigate common failures']
        : [],
    };
  }

  private async analyzeSuccessPatterns(query: EvolutionQuery): Promise<EvolutionResult> {
    const learningResult = await this.analyzeLearning(query);
    const successPatterns = learningResult.learnings?.filter(l => l.type === 'success_pattern') ?? [];

    return {
      query,
      learnings: successPatterns,
      summary: `${successPatterns.length} success patterns identified`,
      recommendations: successPatterns.map(l => l.recommendation!).filter(Boolean),
    };
  }

  private async analyzeFailurePatterns(query: EvolutionQuery): Promise<EvolutionResult> {
    const learnings: LearningInsight[] = [];
    const outcomes = await this.getOutcomes(query.timeRange);
    const failed = outcomes.filter(o => !o.success);

    if (failed.length === 0) {
      return { query, learnings, summary: 'No failures to analyze', recommendations: [] };
    }

    // Analyze common failure characteristics
    const noContextFailures = failed.filter(o => !o.context.librainianContextUsed);
    if (noContextFailures.length > failed.length * 0.3) {
      learnings.push({
        type: 'failure_pattern',
        description: 'Tasks without context fail more often',
        confidence: noContextFailures.length / failed.length,
        occurrences: noContextFailures.length,
        lastSeen: new Date(),
        actionable: true,
        recommendation: 'Ensure context is gathered before task execution',
      });
    }

    const largeTaskFailures = failed.filter(o => o.filesChanged.length > 5);
    if (largeTaskFailures.length > failed.length * 0.4) {
      learnings.push({
        type: 'failure_pattern',
        description: 'Large tasks (>5 files) fail more frequently',
        confidence: largeTaskFailures.length / failed.length,
        occurrences: largeTaskFailures.length,
        lastSeen: new Date(),
        actionable: true,
        recommendation: 'Decompose tasks that touch many files',
      });
    }

    return {
      query,
      learnings,
      summary: `${learnings.length} failure patterns from ${failed.length} failures`,
      recommendations: learnings.map(l => l.recommendation!).filter(Boolean),
    };
  }

  private async generateRecommendations(query: EvolutionQuery): Promise<EvolutionResult> {
    const [fitness, learning, optimization, patterns, failures] = await Promise.all([
      this.analyzeFitness(query),
      this.analyzeLearning(query),
      this.findOptimizations(query),
      this.analyzeSuccessPatterns(query),
      this.analyzeFailurePatterns(query),
    ]);

    const allRecommendations = [
      ...fitness.recommendations,
      ...learning.recommendations,
      ...optimization.recommendations,
      ...patterns.recommendations,
      ...failures.recommendations,
    ];

    const unique = [...new Set(allRecommendations)];

    return {
      query,
      fitness: fitness.fitness,
      learnings: learning.learnings,
      optimizations: optimization.optimizations,
      summary: `${unique.length} recommendations for improvement`,
      recommendations: unique.slice(0, 5),
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------
  private impactScore(impact: 'low' | 'medium' | 'high'): number {
    return impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
  }

  private effortScore(effort: 'low' | 'medium' | 'high'): number {
    return effort === 'high' ? 3 : effort === 'medium' ? 2 : 1;
  }

  private async getOutcomes(timeRange?: EvolutionQuery['timeRange']): Promise<TaskOutcome[]> {
    // Load from persistent storage
    const queryOptions = timeRange ? { timeRange } : {};
    const stored = await this.storage.getEvolutionOutcomes(queryOptions);

    // Combine with in-memory outcomes and deduplicate
    const combined = [
      ...stored.map((outcome) => this.normalizeOutcome(outcome as TaskOutcome)),
      ...this.outcomes
    ];
    const deduped = new Map<string, TaskOutcome>();
    for (const outcome of combined) {
      const key = `${outcome.taskId}:${outcome.timestamp.toISOString()}`;
      if (!deduped.has(key)) deduped.set(key, outcome);
    }

    return filterOutcomes([...deduped.values()], timeRange);
  }

  private normalizeOutcome(outcome: TaskOutcome): TaskOutcome {
    const timestamp = outcome.timestamp instanceof Date ? outcome.timestamp : new Date(outcome.timestamp);
    return { ...outcome, timestamp };
  }
}
