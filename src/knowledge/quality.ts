/**
 * @fileoverview Quality Knowledge System
 *
 * Comprehensive code quality analysis:
 * - Complexity metrics (cyclomatic, cognitive, lines)
 * - Code smells detection
 * - Technical debt assessment
 * - Refactoring candidates
 * - Maintainability scoring
 * - Test coverage gaps
 */

import type { LiBrainianStorage, ModuleKnowledge } from '../storage/types.js';
import { computeGraphMetrics } from '../graphs/metrics.js';
import { buildModuleGraphs } from './module_graph.js';
import {
  buildComplexityAnalysis,
  calculateModuleComplexity,
  detectCodeSmells,
  findImprovementOpportunities,
  findRefactoringCandidates,
} from './quality_metrics.js';

// ============================================================================
// TYPES
// ============================================================================

export interface QualityQuery {
  type:
    | 'complexity'        // Complexity hotspots
    | 'smells'            // Code smells
    | 'debt'              // Technical debt
    | 'improvements'      // Improvement opportunities
    | 'refactoring'       // Refactoring candidates
    | 'hotspots'          // High-churn + high-complexity
    | 'maintainability'   // Overall maintainability
    | 'test_coverage';    // Test coverage gaps

  target?: string;
  threshold?: number;
}

export interface QualityResult {
  query: QualityQuery;
  complexity?: ComplexityAnalysis;
  smells?: CodeSmell[];
  debt?: TechnicalDebt;
  improvements?: ImprovementOpportunity[];
  refactoring?: RefactoringCandidate[];
  score?: QualityScore;
  summary: string;
  recommendations: string[];
}

export interface ComplexityAnalysis {
  average: number;
  max: number;
  hotspots: ComplexityHotspot[];
  distribution: ComplexityDistribution;
}

export interface ComplexityHotspot {
  path: string;
  function?: string;
  complexity: number;
  lines: number;
  reason: string;
}

export interface ComplexityDistribution {
  low: number;      // < 10 lines
  medium: number;   // 10-50 lines
  high: number;     // 50-100 lines
  critical: number; // > 100 lines
}

export interface CodeSmell {
  type: string;
  severity: 'low' | 'medium' | 'high';
  location: { file: string; line?: number };
  description: string;
  suggestion: string;
}

export interface TechnicalDebt {
  totalItems: number;
  estimatedHours: number;
  byCategory: Record<string, number>;
  highPriority: TechnicalDebtItem[];
}

export interface TechnicalDebtItem {
  type: string;
  location: string;
  description: string;
  estimatedHours: number;
  priority: 'low' | 'medium' | 'high';
}

export interface ImprovementOpportunity {
  type: 'performance' | 'readability' | 'maintainability' | 'security' | 'testing';
  location: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
}

export interface RefactoringCandidate {
  type: 'extract_function' | 'extract_module' | 'inline' | 'rename' | 'move' | 'split';
  source: string;
  target?: string;
  reason: string;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface QualityScore {
  overall: number;        // 0-100
  maintainability: number;
  testability: number;
  readability: number;
  complexity: number;
  trend: 'improving' | 'stable' | 'declining';
}

// ============================================================================
// QUALITY KNOWLEDGE
// ============================================================================

export class QualityKnowledge {
  constructor(private storage: LiBrainianStorage) {}

  async query(q: QualityQuery): Promise<QualityResult> {
    switch (q.type) {
      case 'complexity':
        return this.analyzeComplexity(q);
      case 'smells':
        return this.detectSmells(q);
      case 'debt':
        return this.assessDebt(q);
      case 'improvements':
        return this.findImprovements(q);
      case 'refactoring':
        return this.findRefactoringCandidates(q);
      case 'hotspots':
        return this.findHotspots(q);
      case 'maintainability':
        return this.assessMaintainability(q);
      case 'test_coverage':
        return this.analyzeTestCoverage(q);
      default:
        return { query: q, summary: 'Unknown query type', recommendations: [] };
    }
  }

  private async analyzeComplexity(query: QualityQuery): Promise<QualityResult> {
    const functions = await this.storage.getFunctions();
    const threshold = query.threshold ?? 10;
    const analysis = buildComplexityAnalysis(functions, threshold);

    return {
      query,
      complexity: {
        ...analysis,
        hotspots: analysis.hotspots.slice(0, 20),
      },
      summary: `${analysis.hotspots.length} complexity hotspots, ${analysis.distribution.critical} critical functions`,
      recommendations: analysis.distribution.critical > 5
        ? ['Focus on reducing complexity in critical hotspots', 'Consider extracting helper functions']
        : [],
    };
  }

  private async detectSmells(query: QualityQuery): Promise<QualityResult> {
    const functions = await this.storage.getFunctions();
    const modules = await this.storage.getModules();
    const smells = detectCodeSmells(functions, modules);

    return {
      query,
      smells,
      summary: `Detected ${smells.length} code smells`,
      recommendations: smells.filter(s => s.severity === 'high')
        .slice(0, 3)
        .map(s => `Fix ${s.type} in ${s.location.file}`),
    };
  }

  private async assessDebt(query: QualityQuery): Promise<QualityResult> {
    const smellsResult = await this.detectSmells(query);
    const complexityResult = await this.analyzeComplexity(query);

    const byCategory: Record<string, number> = {};
    let totalHours = 0;
    const highPriority: TechnicalDebtItem[] = [];

    // Convert smells to debt
    for (const smell of smellsResult.smells ?? []) {
      const hours = smell.severity === 'high' ? 4 : smell.severity === 'medium' ? 2 : 1;
      totalHours += hours;
      byCategory[smell.type] = (byCategory[smell.type] ?? 0) + hours;

      if (smell.severity === 'high') {
        highPriority.push({
          type: smell.type,
          location: smell.location.file,
          description: smell.description,
          estimatedHours: hours,
          priority: 'high',
        });
      }
    }

    // Complexity debt
    for (const hotspot of complexityResult.complexity?.hotspots ?? []) {
      if (hotspot.complexity > 20) {
        const hours = Math.ceil(hotspot.complexity / 5);
        totalHours += hours;
        byCategory['Complexity'] = (byCategory['Complexity'] ?? 0) + hours;

        if (hotspot.complexity > 30) {
          highPriority.push({
            type: 'High Complexity',
            location: `${hotspot.path}:${hotspot.function}`,
            description: `Complexity score: ${hotspot.complexity}`,
            estimatedHours: hours,
            priority: 'high',
          });
        }
      }
    }

    return {
      query,
      debt: {
        totalItems: (smellsResult.smells?.length ?? 0) + (complexityResult.complexity?.hotspots?.length ?? 0),
        estimatedHours: totalHours,
        byCategory,
        highPriority: highPriority.slice(0, 10),
      },
      summary: `Technical debt: ~${totalHours} hours to address`,
      recommendations: totalHours > 100
        ? ['Consider allocating 20% of sprint capacity to debt reduction']
        : totalHours > 40
        ? ['Schedule focused debt reduction sessions']
        : [],
    };
  }

  private async findImprovements(query: QualityQuery): Promise<QualityResult> {
    const functions = await this.storage.getFunctions();
    const modules = await this.storage.getModules();
    const improvements = findImprovementOpportunities(functions, modules);

    return {
      query,
      improvements: improvements.slice(0, 20),
      summary: `Found ${improvements.length} improvement opportunities`,
      recommendations: improvements.slice(0, 3).map(i => i.description),
    };
  }

  private async findRefactoringCandidates(query: QualityQuery): Promise<QualityResult> {
    const functions = await this.storage.getFunctions();
    const modules = await this.storage.getModules();
    const candidates = findRefactoringCandidates(functions, modules);

    return {
      query,
      refactoring: candidates,
      summary: `Found ${candidates.length} refactoring candidates`,
      recommendations: candidates
        .filter(c => c.complexity === 'simple')
        .slice(0, 3)
        .map(c => `${c.type}: ${c.reason}`),
    };
  }

  private async findHotspots(query: QualityQuery): Promise<QualityResult> {
    const modules = await this.storage.getModules();
    const functions = await this.storage.getFunctions();
    const { graph } = buildModuleGraphs(modules);
    const { metrics } = computeGraphMetrics({ module: graph });
    const threshold = query.threshold ?? 10;
    const complexity = buildComplexityAnalysis(functions, threshold);

    const moduleScores = new Map<string, number>();
    for (const mod of modules) {
      const moduleComplexity = calculateModuleComplexity(functions, mod.path);
      const metric = metrics.find((m) => m.entityId === mod.path);
      const centrality = (metric?.betweenness ?? 0) + (metric?.pagerank ?? 0);
      const score = moduleComplexity.averageComplexity + centrality * 20;
      moduleScores.set(mod.path, score);
    }

    complexity.hotspots = complexity.hotspots.map((hotspot) => {
      const score = moduleScores.get(hotspot.path) ?? hotspot.complexity;
      return {
        ...hotspot,
        reason: `${hotspot.reason}; hotspot score ${score.toFixed(1)}`,
      };
    });

    return {
      query,
      complexity,
      summary: `${complexity.hotspots.length} complexity hotspots weighted by centrality`,
      recommendations: complexity.hotspots.length > 0
        ? ['Address high-centrality hotspots first to reduce systemic risk']
        : [],
    };
  }

  private async assessMaintainability(query: QualityQuery): Promise<QualityResult> {
    const complexityResult = await this.analyzeComplexity(query);
    const smellsResult = await this.detectSmells(query);
    const modules = await this.storage.getModules();
    const coverage = this.calculateTestCoverage(modules);

    const complexity = complexityResult.complexity;
    const smells = smellsResult.smells ?? [];

    // Calculate component scores
    const avgComplexity = complexity?.average ?? 5;
    const complexityScore = Math.max(0, 100 - avgComplexity * 3);
    const smellScore = Math.max(0, 100 - smells.length * 2);
    const readabilityScore = Math.max(0, 100 - (complexity?.distribution?.critical ?? 0) * 10);
    const testabilityScore = coverage.coverageEstimate;

    const overall = Math.round((complexityScore + smellScore + readabilityScore + testabilityScore) / 4);
    const maintainability = Math.round((complexityScore + smellScore) / 2);

    // Compute trend from historical data
    const trend = await this.computeTrend(overall);

    const score: QualityScore = {
      overall,
      maintainability,
      testability: testabilityScore,
      readability: readabilityScore,
      complexity: complexityScore,
      trend,
    };

    // Record score for future trend tracking
    await this.storage.recordQualityScore({
      overall,
      maintainability,
      testability: testabilityScore,
      readability: readabilityScore,
      complexity: complexityScore,
    }).catch(() => {
      // Ignore errors - trend tracking is non-critical
    });

    return {
      query,
      score,
      summary: `Maintainability score: ${overall}/100 (${trend})`,
      recommendations: overall < 70
        ? ['Focus on reducing complexity and addressing code smells']
        : overall < 85
        ? ['Good maintainability - continue incremental improvements']
        : ['Excellent maintainability - maintain current practices'],
    };
  }

  private async computeTrend(currentOverall: number): Promise<'improving' | 'stable' | 'declining'> {
    try {
      const history = await this.storage.getQualityScoreHistory(10);
      if (history.length < 2) return 'stable';

      // Compare with average of previous scores
      const previousAvg = history.slice(0, Math.min(5, history.length))
        .reduce((sum, h) => sum + h.overall, 0) / Math.min(5, history.length);

      const delta = currentOverall - previousAvg;
      if (delta > 3) return 'improving';
      if (delta < -3) return 'declining';
      return 'stable';
    } catch {
      return 'stable';
    }
  }

  private async analyzeTestCoverage(query: QualityQuery): Promise<QualityResult> {
    const modules = await this.storage.getModules();
    const coverage = this.calculateTestCoverage(modules);

    return {
      query,
      improvements: coverage.untested.slice(0, 20),
      summary: `${coverage.testModules.length} test files, ~${coverage.coverageEstimate}% modules have tests`,
      recommendations: coverage.coverageEstimate < 50
        ? ['Test coverage is low - prioritize testing core modules']
        : coverage.coverageEstimate < 80
        ? ['Continue adding tests for uncovered modules']
        : [],
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------
  private calculateTestCoverage(modules: ModuleKnowledge[]): {
    testModules: ModuleKnowledge[];
    sourceModules: ModuleKnowledge[];
    untested: ImprovementOpportunity[];
    coverageEstimate: number;
  } {
    const testModules = modules.filter((m) =>
      m.path.includes('.test.') || m.path.includes('.spec.') || m.path.includes('__tests__')
    );

    const sourceModules = modules.filter((m) =>
      !m.path.includes('.test.') &&
      !m.path.includes('.spec.') &&
      !m.path.includes('__tests__') &&
      !m.path.includes('/types') &&
      m.path.endsWith('.ts')
    );

    const untested: ImprovementOpportunity[] = [];
    for (const mod of sourceModules) {
      const baseName = mod.path.replace(/\.ts$/, '');
      const baseFile = mod.path.split('/').pop()?.replace('.ts', '') ?? '';
      const hasTest = testModules.some((t) => t.path.includes(baseName) || t.path.includes(baseFile));
      if (!hasTest) {
        untested.push({
          type: 'testing',
          location: mod.path,
          description: `No tests found for ${mod.path}`,
          effort: 'medium',
          impact: 'high',
        });
      }
    }

    const coverageEstimate = sourceModules.length > 0
      ? Math.round(((sourceModules.length - untested.length) / sourceModules.length) * 100)
      : 0;

    return {
      testModules,
      sourceModules,
      untested,
      coverageEstimate,
    };
  }
}
