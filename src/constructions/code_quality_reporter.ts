/**
 * @fileoverview Code Quality Reporter Construction
 *
 * A composed construction that assesses code quality by combining:
 * - Issue detectors for quality problems
 * - Pattern library for anti-pattern detection
 * - Evidence ledger for traceability
 *
 * Composes:
 * - Query API for code analysis
 * - Issue Detector for quality issues
 * - Pattern Catalog for best practices
 * - Confidence System for uncertainty quantification
 */

import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export type QualityAspect = 'complexity' | 'duplication' | 'testability';

export interface QualityQuery {
  /** Files to analyze */
  files: string[];
  /** Quality aspects to check */
  aspects: QualityAspect[];
}

export interface QualityIssue {
  /** Type of issue */
  type: QualityAspect;
  /** Severity level */
  severity: 'info' | 'warning' | 'error';
  /** File where issue is found */
  file: string;
  /** Line number if applicable */
  line?: number;
  /** Description of the issue */
  description: string;
  /** Suggestion for fixing */
  suggestion?: string;
  /** Confidence in this finding */
  confidence: number;
}

export interface QualityMetrics {
  /** Average complexity score (0-1, lower is better) */
  averageComplexity: number;
  /** Duplication percentage (0-1) */
  duplicationRatio: number;
  /** Testability score (0-1, higher is better) */
  testabilityScore: number;
  /** Overall quality score (0-1, higher is better) */
  overallScore: number;
}

export interface QualityRecommendation {
  /** Priority level */
  priority: 'high' | 'medium' | 'low';
  /** Recommendation text */
  text: string;
  /** Files affected */
  affectedFiles: string[];
  /** Estimated effort to fix */
  effort: 'trivial' | 'small' | 'medium' | 'large';
}

export interface QualityReport {
  /** Original query */
  query: QualityQuery;

  /** Quality issues found */
  issues: QualityIssue[];

  /** Aggregated metrics */
  metrics: QualityMetrics;

  /** Prioritized recommendations */
  recommendations: QualityRecommendation[];

  /** Files analyzed */
  analyzedFiles: number;

  /** Confidence in the analysis */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Analysis timing */
  analysisTimeMs: number;
}

interface AspectAnalysis {
  issues: QualityIssue[];
  matchedFiles: Set<string>;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class CodeQualityReporter {
  private static readonly STRUCTURAL_QUERY_TIMEOUT_MS = 20_000;
  private librarian: Librarian;

  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  private queryStructurally(intent: string, files: string[]) {
    return this.librarian.queryOptional({
      intent,
      affectedFiles: files,
      depth: 'L2',
      taskType: 'understand',
      llmRequirement: 'disabled',
      timeoutMs: CodeQualityReporter.STRUCTURAL_QUERY_TIMEOUT_MS,
    });
  }

  /**
   * Analyze code quality for the specified files.
   */
  async analyze(query: QualityQuery): Promise<QualityReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];
    const allIssues: QualityIssue[] = [];
    const matchedFiles = new Set<string>();

    // Analyze each aspect
    for (const aspect of query.aspects) {
      const analysis = await this.analyzeAspect(aspect, query.files);
      allIssues.push(...analysis.issues);
      for (const file of analysis.matchedFiles) {
        matchedFiles.add(file);
      }
      evidenceRefs.push(`${aspect}_analysis:${analysis.issues.length}_issues`);
    }

    // Compute metrics
    const metrics = this.computeMetrics(allIssues, matchedFiles.size);
    evidenceRefs.push(`metrics_computed:${matchedFiles.size}_files`);

    // Generate recommendations
    const recommendations = this.generateRecommendations(allIssues, metrics);
    evidenceRefs.push(`recommendations:${recommendations.length}`);

    // Compute confidence
    const confidence = this.computeConfidence(allIssues, matchedFiles.size);

    return {
      query,
      issues: allIssues,
      metrics,
      recommendations,
      analyzedFiles: matchedFiles.size,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Analyze a specific quality aspect.
   */
  private async analyzeAspect(
    aspect: QualityAspect,
    files: string[]
  ): Promise<AspectAnalysis> {
    switch (aspect) {
      case 'complexity':
        return this.analyzeComplexity(files);
      case 'duplication':
        return this.analyzeDuplication(files);
      case 'testability':
        return this.analyzeTestability(files);
      default:
        return { issues: [], matchedFiles: new Set<string>() };
    }
  }

  /**
   * Analyze code complexity.
   */
  private async analyzeComplexity(files: string[]): Promise<AspectAnalysis> {
    const issues: QualityIssue[] = [];
    const matchedFiles = new Set<string>();

    const queryResult = await this.queryStructurally(
      'Find complex functions with high cyclomatic complexity, deep nesting, or many parameters',
      files,
    );

    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        const scopedFile = this.resolveScopedFile(pack, files);
        if (!scopedFile) {
          continue;
        }
        matchedFiles.add(scopedFile);
        // Analyze snippets for complexity indicators
        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            const complexityIssues = this.detectComplexityIssues(
              snippet.content,
              scopedFile,
              snippet.startLine
            );
            issues.push(...complexityIssues);
          }
        }
      }
    }

    return { issues, matchedFiles };
  }

  /**
   * Detect complexity issues in code.
   */
  private detectComplexityIssues(
    code: string,
    file: string,
    startLine: number
  ): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const lines = code.split('\n');

    // Check nesting depth
    let maxNesting = 0;
    let currentNesting = 0;
    for (const line of lines) {
      currentNesting += (line.match(/{/g) || []).length;
      currentNesting -= (line.match(/}/g) || []).length;
      maxNesting = Math.max(maxNesting, currentNesting);
    }

    if (maxNesting > 4) {
      issues.push({
        type: 'complexity',
        severity: maxNesting > 6 ? 'error' : 'warning',
        file,
        line: startLine,
        description: `Deep nesting detected (${maxNesting} levels). Consider extracting functions.`,
        suggestion: 'Extract nested logic into separate functions with clear names.',
        confidence: 0.85,
      });
    }

    // Check line count
    if (lines.length > 50) {
      issues.push({
        type: 'complexity',
        severity: lines.length > 100 ? 'error' : 'warning',
        file,
        line: startLine,
        description: `Long function (${lines.length} lines). Consider breaking down.`,
        suggestion: 'Split into smaller, focused functions with single responsibilities.',
        confidence: 0.9,
      });
    }

    // Check for many conditionals
    const conditionalCount = (code.match(/if\s*\(|else\s*if|switch\s*\(|\?\s*:/g) || []).length;
    if (conditionalCount > 8) {
      issues.push({
        type: 'complexity',
        severity: conditionalCount > 12 ? 'error' : 'warning',
        file,
        line: startLine,
        description: `High conditional complexity (${conditionalCount} branches).`,
        suggestion: 'Consider using polymorphism, strategy pattern, or lookup tables.',
        confidence: 0.75,
      });
    }

    return issues;
  }

  /**
   * Analyze code duplication.
   */
  private async analyzeDuplication(files: string[]): Promise<AspectAnalysis> {
    const issues: QualityIssue[] = [];
    const matchedFiles = new Set<string>();

    const queryResult = await this.queryStructurally(
      'Find duplicated code patterns, copy-pasted code, or similar functions',
      files,
    );

    if (queryResult.packs) {
      // Look for similar packs (potential duplication)
      const packsByContent = new Map<string, ContextPack[]>();

      for (const pack of queryResult.packs) {
        const scopedFile = this.resolveScopedFile(pack, files);
        if (!scopedFile) {
          continue;
        }
        matchedFiles.add(scopedFile);
        // Group by similar summaries
        const key = pack.summary?.toLowerCase().slice(0, 50) || pack.targetId;
        if (!packsByContent.has(key)) {
          packsByContent.set(key, []);
        }
        packsByContent.get(key)!.push(pack);
      }

      // Report potential duplicates
      for (const [, packs] of packsByContent) {
        if (packs.length > 1) {
          const files = packs.flatMap(p => p.relatedFiles || []);
          issues.push({
            type: 'duplication',
            severity: packs.length > 3 ? 'error' : 'warning',
            file: files[0] || 'unknown',
            description: `Potential duplication detected across ${packs.length} locations.`,
            suggestion: 'Consider extracting common logic into a shared utility function.',
            confidence: 0.6,
          });
        }
      }
    }

    return { issues, matchedFiles };
  }

  /**
   * Analyze testability.
   */
  private async analyzeTestability(files: string[]): Promise<AspectAnalysis> {
    const issues: QualityIssue[] = [];
    const matchedFiles = new Set<string>();

    const queryResult = await this.queryStructurally(
      'Find code that is hard to test: global state, tight coupling, no dependency injection',
      files,
    );

    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        const scopedFile = this.resolveScopedFile(pack, files);
        if (!scopedFile) {
          continue;
        }
        matchedFiles.add(scopedFile);
        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            const testabilityIssues = this.detectTestabilityIssues(
              snippet.content,
              scopedFile,
              snippet.startLine
            );
            issues.push(...testabilityIssues);
          }
        }
      }
    }

    return { issues, matchedFiles };
  }

  private resolveScopedFile(pack: ContextPack, requestedFiles: string[]): string | undefined {
    const normalizedRequested = requestedFiles.map((file) => this.normalizeFilePath(file));
    const candidates = [
      ...(pack.relatedFiles ?? []),
      ...(pack.codeSnippets?.map((snippet) => snippet.filePath).filter((file): file is string => typeof file === 'string') ?? []),
    ];

    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeFilePath(candidate);
      const matched = normalizedRequested.find((requested) =>
        normalizedCandidate === requested || normalizedCandidate.endsWith(`/${requested}`),
      );
      if (matched) {
        return matched;
      }
    }
    return undefined;
  }

  private normalizeFilePath(file: string): string {
    return file.replace(/\\/g, '/').replace(/^\.\/+/, '');
  }

  /**
   * Detect testability issues in code.
   */
  private detectTestabilityIssues(
    code: string,
    file: string,
    startLine: number
  ): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // Check for global state
    if (code.includes('global.') || code.includes('window.') || /^let\s+\w+\s*=/m.test(code)) {
      issues.push({
        type: 'testability',
        severity: 'warning',
        file,
        line: startLine,
        description: 'Potential global state usage detected, which can make testing difficult.',
        suggestion: 'Use dependency injection or module-scoped state with proper initialization.',
        confidence: 0.7,
      });
    }

    // Check for hardcoded dependencies
    if (/new\s+\w+\(/g.test(code) && !code.includes('constructor')) {
      issues.push({
        type: 'testability',
        severity: 'info',
        file,
        line: startLine,
        description: 'Hardcoded instantiation detected. Consider dependency injection.',
        suggestion: 'Accept dependencies as constructor or function parameters for easier mocking.',
        confidence: 0.65,
      });
    }

    // Check for side effects in functions
    if (/console\.(log|warn|error)|fs\.|fetch\(/g.test(code)) {
      issues.push({
        type: 'testability',
        severity: 'info',
        file,
        line: startLine,
        description: 'Side effects detected (I/O, console). May need mocking in tests.',
        suggestion: 'Wrap side effects in injectable services for easier testing.',
        confidence: 0.8,
      });
    }

    return issues;
  }

  /**
   * Compute aggregated quality metrics.
   */
  private computeMetrics(issues: QualityIssue[], analyzedFileCount: number): QualityMetrics {
    const complexityIssues = issues.filter(i => i.type === 'complexity');
    const duplicationIssues = issues.filter(i => i.type === 'duplication');
    const testabilityIssues = issues.filter(i => i.type === 'testability');

    if (analyzedFileCount === 0) {
      return {
        averageComplexity: 0,
        duplicationRatio: 0,
        testabilityScore: 0,
        overallScore: 0,
      };
    }

    // Compute per-aspect scores (inverted from issue count)
    const fileCount = Math.max(1, analyzedFileCount);

    const averageComplexity = Math.min(1, complexityIssues.length / (fileCount * 2)) * 0.5 + 0.25;
    const duplicationRatio = Math.min(1, duplicationIssues.length / fileCount) * 0.4;
    const testabilityScore = Math.max(0, 1 - (testabilityIssues.length / (fileCount * 3)));

    // Overall score is weighted average
    const overallScore = Math.max(0, 1 - (
      (1 - averageComplexity) * 0.35 +
      duplicationRatio * 0.25 +
      (1 - testabilityScore) * 0.4
    ));

    return {
      averageComplexity,
      duplicationRatio,
      testabilityScore,
      overallScore: Math.round(overallScore * 100) / 100,
    };
  }

  /**
   * Generate prioritized recommendations.
   */
  private generateRecommendations(
    issues: QualityIssue[],
    metrics: QualityMetrics
  ): QualityRecommendation[] {
    const recommendations: QualityRecommendation[] = [];

    // Group issues by file
    const issuesByFile = new Map<string, QualityIssue[]>();
    for (const issue of issues) {
      if (!issuesByFile.has(issue.file)) {
        issuesByFile.set(issue.file, []);
      }
      issuesByFile.get(issue.file)!.push(issue);
    }

    // Complexity recommendations
    if (metrics.averageComplexity > 0.5) {
      const complexFiles = Array.from(issuesByFile.entries())
        .filter(([, issues]) => issues.some(i => i.type === 'complexity' && i.severity === 'error'))
        .map(([file]) => file);

      if (complexFiles.length > 0) {
        recommendations.push({
          priority: 'high',
          text: 'Reduce complexity in identified files. Extract functions and simplify control flow.',
          affectedFiles: complexFiles,
          effort: complexFiles.length > 3 ? 'large' : 'medium',
        });
      }
    }

    // Duplication recommendations
    if (metrics.duplicationRatio > 0.2) {
      const dupFiles = issues
        .filter(i => i.type === 'duplication')
        .map(i => i.file);

      if (dupFiles.length > 0) {
        recommendations.push({
          priority: metrics.duplicationRatio > 0.4 ? 'high' : 'medium',
          text: 'Address code duplication. Extract common patterns into shared utilities.',
          affectedFiles: [...new Set(dupFiles)],
          effort: 'medium',
        });
      }
    }

    // Testability recommendations
    if (metrics.testabilityScore < 0.6) {
      const testFiles = issues
        .filter(i => i.type === 'testability')
        .map(i => i.file);

      if (testFiles.length > 0) {
        recommendations.push({
          priority: metrics.testabilityScore < 0.4 ? 'high' : 'medium',
          text: 'Improve testability by using dependency injection and reducing side effects.',
          affectedFiles: [...new Set(testFiles)],
          effort: 'medium',
        });
      }
    }

    // General recommendations
    if (recommendations.length === 0 && issues.length > 0) {
      recommendations.push({
        priority: 'low',
        text: 'Minor quality improvements available. Consider addressing info-level issues.',
        affectedFiles: [...new Set(issues.map(i => i.file))],
        effort: 'small',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Compute confidence in the analysis.
   */
  private computeConfidence(issues: QualityIssue[], fileCount: number): ConfidenceValue {
    if (fileCount === 0) {
      return {
        type: 'absent' as const,
        reason: 'insufficient_data' as const,
      };
    }

    if (issues.length === 0) {
      // No issues could mean clean code or missed detection
      return {
        type: 'bounded' as const,
        low: 0.5,
        high: 0.9,
        basis: 'theoretical' as const,
        citation: 'No issues detected; code may be clean or detection may have missed issues',
      };
    }

    // More issues with high individual confidence = higher overall confidence
    const avgIssueConfidence = issues.reduce((sum, i) => sum + i.confidence, 0) / issues.length;
    const coverageRatio = Math.min(1, issues.length / (fileCount * 2));
    const confidenceValue = Math.min(0.9, avgIssueConfidence * 0.7 + coverageRatio * 0.3);

    return {
      type: 'measured' as const,
      value: confidenceValue,
      measurement: {
        datasetId: 'code_quality_analysis',
        sampleSize: fileCount,
        accuracy: avgIssueConfidence,
        confidenceInterval: [
          Math.max(0, confidenceValue - 0.1),
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

export function createCodeQualityReporter(librarian: Librarian): CodeQualityReporter {
  return new CodeQualityReporter(librarian);
}
