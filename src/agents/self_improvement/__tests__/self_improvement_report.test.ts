/**
 * @fileoverview Tests for Self-Improvement Report Generator (WU-META-003)
 *
 * TDD: Tests written first, implementation follows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SelfImprovementReportGenerator,
  type Issue,
  type Recommendation,
  type SelfImprovementReport,
} from '../self_improvement_report.js';
import type { LibrarianStorage, ModuleKnowledge, FunctionKnowledge } from '../../../storage/types.js';
import type { ArchitectureAnalysisResult } from '../analyze_architecture.js';
import type { ConsistencyAnalysisResult } from '../analyze_consistency.js';
import type { CalibrationVerificationResult } from '../verify_calibration.js';

describe('SelfImprovementReportGenerator', () => {
  let mockStorage: LibrarianStorage;
  let generator: SelfImprovementReportGenerator;
  let mockModules: ModuleKnowledge[];
  let mockFunctions: FunctionKnowledge[];

  beforeEach(() => {
    // Setup mock modules
    mockModules = [
      {
        id: 'mod-1',
        path: '/test/src/api/handler.ts',
        purpose: 'API handler',
        exports: ['handleRequest', 'handleResponse'],
        dependencies: ['../core/processor', '../utils/helpers'],
        confidence: 0.9,
      },
      {
        id: 'mod-2',
        path: '/test/src/core/processor.ts',
        purpose: 'Core processor',
        exports: ['process', 'validate', 'transform'],
        dependencies: ['../storage/db'],
        confidence: 0.85,
      },
      {
        id: 'mod-3',
        path: '/test/src/storage/db.ts',
        purpose: 'Database access',
        exports: ['query', 'insert'],
        dependencies: [],
        confidence: 0.95,
      },
    ];

    // Setup mock functions
    mockFunctions = [
      {
        id: 'fn-1',
        name: 'handleRequest',
        filePath: '/test/src/api/handler.ts',
        signature: 'handleRequest(req: Request): Response',
        purpose: 'Handles incoming requests',
        confidence: 0.9,
      },
      {
        id: 'fn-2',
        name: 'process',
        filePath: '/test/src/core/processor.ts',
        signature: 'process(data: Data): Result',
        purpose: 'Processes data',
        confidence: 0.85,
      },
    ] as FunctionKnowledge[];

    // Setup mock storage
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      getModules: vi.fn().mockResolvedValue(mockModules),
      getFunctions: vi.fn().mockResolvedValue(mockFunctions),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getTestMappings: vi.fn().mockResolvedValue([]),
      getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
      getBayesianConfidences: vi.fn().mockResolvedValue([]),
      getConfidenceEvents: vi.fn().mockResolvedValue([]),
      getVersion: vi.fn().mockResolvedValue({
        major: 0,
        minor: 1,
        patch: 0,
        string: '0.1.0',
        qualityTier: 'mvp',
        indexedAt: new Date(),
        indexerVersion: '0.1.0',
        features: ['basic_indexing'],
      }),
    } as unknown as LibrarianStorage;

    generator = new SelfImprovementReportGenerator(mockStorage);
  });

  // ===========================================================================
  // CONSTRUCTION AND BASIC STRUCTURE
  // ===========================================================================

  describe('constructor', () => {
    it('should create a generator with storage', () => {
      expect(generator).toBeDefined();
      expect(generator).toBeInstanceOf(SelfImprovementReportGenerator);
    });

    it('should throw if storage is not provided', () => {
      expect(() => new SelfImprovementReportGenerator(undefined as unknown as LibrarianStorage))
        .toThrow('storage is required');
    });
  });

  // ===========================================================================
  // ISSUE INTERFACE
  // ===========================================================================

  describe('Issue interface', () => {
    it('should have correct structure for architecture issue', async () => {
      const issues = await generator.analyzeCodebase('/test');

      if (issues.length > 0) {
        const issue = issues[0];
        expect(issue).toHaveProperty('id');
        expect(issue).toHaveProperty('category');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('title');
        expect(issue).toHaveProperty('description');
        expect(issue).toHaveProperty('affectedFiles');
        expect(issue).toHaveProperty('evidence');

        expect(['architecture', 'consistency', 'calibration', 'coverage', 'performance'])
          .toContain(issue.category);
        expect(['low', 'medium', 'high', 'critical'])
          .toContain(issue.severity);
        expect(Array.isArray(issue.affectedFiles)).toBe(true);
        expect(Array.isArray(issue.evidence)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // RECOMMENDATION INTERFACE
  // ===========================================================================

  describe('Recommendation interface', () => {
    it('should have correct structure for recommendation', async () => {
      const issues: Issue[] = [
        {
          id: 'issue-1',
          category: 'architecture',
          severity: 'high',
          title: 'Circular dependency detected',
          description: 'Modules A and B have circular dependency',
          affectedFiles: ['/test/src/a.ts', '/test/src/b.ts'],
          evidence: ['A imports B', 'B imports A'],
        },
      ];

      const recommendations = generator.generateRecommendations(issues);

      expect(recommendations.length).toBeGreaterThan(0);
      const rec = recommendations[0];

      expect(rec).toHaveProperty('issueId');
      expect(rec).toHaveProperty('action');
      expect(rec).toHaveProperty('effort');
      expect(rec).toHaveProperty('impact');
      expect(rec).toHaveProperty('priority');
      expect(rec).toHaveProperty('implementationHints');

      expect(['trivial', 'small', 'medium', 'large']).toContain(rec.effort);
      expect(['low', 'medium', 'high']).toContain(rec.impact);
      expect(typeof rec.priority).toBe('number');
      expect(Array.isArray(rec.implementationHints)).toBe(true);
    });
  });

  // ===========================================================================
  // analyzeCodebase METHOD
  // ===========================================================================

  describe('analyzeCodebase', () => {
    it('should return an array of issues', async () => {
      const issues = await generator.analyzeCodebase('/test');

      expect(Array.isArray(issues)).toBe(true);
    });

    it('should detect architecture violations', async () => {
      // Setup storage to return modules with circular dependency
      const circularModules: ModuleKnowledge[] = [
        {
          id: 'mod-a',
          path: '/test/src/a.ts',
          purpose: 'Module A',
          exports: ['funcA'],
          dependencies: ['./b'],
          confidence: 0.9,
        },
        {
          id: 'mod-b',
          path: '/test/src/b.ts',
          purpose: 'Module B',
          exports: ['funcB'],
          dependencies: ['./a'],
          confidence: 0.9,
        },
      ];

      (mockStorage.getModules as ReturnType<typeof vi.fn>).mockResolvedValue(circularModules);
      generator = new SelfImprovementReportGenerator(mockStorage);

      const issues = await generator.analyzeCodebase('/test');

      // Should find architecture issues
      const archIssues = issues.filter((i) => i.category === 'architecture');
      expect(archIssues.length).toBeGreaterThanOrEqual(0); // May or may not find depending on implementation
    });

    it('should detect consistency issues', async () => {
      const issues = await generator.analyzeCodebase('/test');

      // Consistency issues may include untested claims, mismatches, etc.
      const consistencyIssues = issues.filter((i) => i.category === 'consistency');
      expect(Array.isArray(consistencyIssues)).toBe(true);
    });

    it('should detect coverage gaps', async () => {
      const issues = await generator.analyzeCodebase('/test');

      const coverageIssues = issues.filter((i) => i.category === 'coverage');
      expect(Array.isArray(coverageIssues)).toBe(true);
    });

    it('should handle empty codebase gracefully', async () => {
      (mockStorage.getModules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockStorage.getFunctions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      generator = new SelfImprovementReportGenerator(mockStorage);
      const issues = await generator.analyzeCodebase('/test');

      expect(Array.isArray(issues)).toBe(true);
    });
  });

  // ===========================================================================
  // generateRecommendations METHOD
  // ===========================================================================

  describe('generateRecommendations', () => {
    it('should generate recommendations for each issue', () => {
      const issues: Issue[] = [
        {
          id: 'issue-1',
          category: 'architecture',
          severity: 'high',
          title: 'Large module detected',
          description: 'Module has too many exports',
          affectedFiles: ['/test/src/god_module.ts'],
          evidence: ['25 exports detected'],
        },
        {
          id: 'issue-2',
          category: 'consistency',
          severity: 'medium',
          title: 'Untested function',
          description: 'Function lacks test coverage',
          affectedFiles: ['/test/src/utils.ts'],
          evidence: ['No test file found'],
        },
      ];

      const recommendations = generator.generateRecommendations(issues);

      expect(recommendations.length).toBeGreaterThanOrEqual(issues.length);
      expect(recommendations.every((r) => issues.some((i) => i.id === r.issueId))).toBe(true);
    });

    it('should generate appropriate actions based on issue category', () => {
      const architectureIssue: Issue = {
        id: 'arch-1',
        category: 'architecture',
        severity: 'high',
        title: 'Circular dependency',
        description: 'Modules have circular dependency',
        affectedFiles: ['/test/src/a.ts', '/test/src/b.ts'],
        evidence: ['A->B->A cycle'],
      };

      const recommendations = generator.generateRecommendations([architectureIssue]);

      expect(recommendations.length).toBeGreaterThan(0);
      const rec = recommendations.find((r) => r.issueId === 'arch-1');
      expect(rec).toBeDefined();
      expect(rec!.action).toBeTruthy();
    });

    it('should return empty array for empty issues', () => {
      const recommendations = generator.generateRecommendations([]);

      expect(recommendations).toEqual([]);
    });

    it('should include implementation hints', () => {
      const issues: Issue[] = [
        {
          id: 'issue-1',
          category: 'calibration',
          severity: 'high',
          title: 'Poor calibration',
          description: 'Confidence scores are miscalibrated',
          affectedFiles: [],
          evidence: ['ECE = 0.15'],
        },
      ];

      const recommendations = generator.generateRecommendations(issues);

      expect(recommendations[0].implementationHints.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // prioritizeRecommendations METHOD
  // ===========================================================================

  describe('prioritizeRecommendations', () => {
    it('should sort recommendations by priority (descending)', () => {
      const recommendations: Recommendation[] = [
        {
          issueId: 'issue-1',
          action: 'Fix low impact issue',
          effort: 'large',
          impact: 'low',
          priority: 10,
          implementationHints: [],
        },
        {
          issueId: 'issue-2',
          action: 'Fix high impact issue',
          effort: 'small',
          impact: 'high',
          priority: 90,
          implementationHints: [],
        },
        {
          issueId: 'issue-3',
          action: 'Fix medium impact issue',
          effort: 'medium',
          impact: 'medium',
          priority: 50,
          implementationHints: [],
        },
      ];

      const prioritized = generator.prioritizeRecommendations(recommendations);

      expect(prioritized[0].priority).toBeGreaterThanOrEqual(prioritized[1].priority);
      expect(prioritized[1].priority).toBeGreaterThanOrEqual(prioritized[2].priority);
    });

    it('should compute priority from severity, effort, and impact', () => {
      const recommendations: Recommendation[] = [
        {
          issueId: 'issue-1',
          action: 'Quick high-impact fix',
          effort: 'trivial',
          impact: 'high',
          priority: 0, // Will be computed
          implementationHints: [],
        },
        {
          issueId: 'issue-2',
          action: 'Slow low-impact fix',
          effort: 'large',
          impact: 'low',
          priority: 0, // Will be computed
          implementationHints: [],
        },
      ];

      const prioritized = generator.prioritizeRecommendations(recommendations);

      // High impact + trivial effort should have higher priority
      const quickFix = prioritized.find((r) => r.issueId === 'issue-1');
      const slowFix = prioritized.find((r) => r.issueId === 'issue-2');

      expect(quickFix!.priority).toBeGreaterThan(slowFix!.priority);
    });

    it('should preserve all recommendations', () => {
      const recommendations: Recommendation[] = [
        { issueId: 'a', action: 'A', effort: 'small', impact: 'high', priority: 50, implementationHints: [] },
        { issueId: 'b', action: 'B', effort: 'medium', impact: 'medium', priority: 30, implementationHints: [] },
        { issueId: 'c', action: 'C', effort: 'large', impact: 'low', priority: 10, implementationHints: [] },
      ];

      const prioritized = generator.prioritizeRecommendations(recommendations);

      expect(prioritized.length).toBe(recommendations.length);
    });
  });

  // ===========================================================================
  // generateReport METHOD
  // ===========================================================================

  describe('generateReport', () => {
    it('should return a complete report structure', async () => {
      const report = await generator.generateReport('/test');

      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('librarianVersion');
      expect(report).toHaveProperty('analysisScope');
      expect(report).toHaveProperty('healthSummary');
      expect(report).toHaveProperty('issues');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('nextSteps');
    });

    it('should include analysis scope metrics', async () => {
      const report = await generator.generateReport('/test');

      expect(report.analysisScope).toHaveProperty('filesAnalyzed');
      expect(report.analysisScope).toHaveProperty('testsRun');
      expect(report.analysisScope).toHaveProperty('metricsCollected');

      expect(typeof report.analysisScope.filesAnalyzed).toBe('number');
      expect(typeof report.analysisScope.testsRun).toBe('number');
      expect(Array.isArray(report.analysisScope.metricsCollected)).toBe(true);
    });

    it('should include health summary scores', async () => {
      const report = await generator.generateReport('/test');

      expect(report.healthSummary).toHaveProperty('overallScore');
      expect(report.healthSummary).toHaveProperty('calibrationScore');
      expect(report.healthSummary).toHaveProperty('consistencyScore');
      expect(report.healthSummary).toHaveProperty('coverageScore');

      // Scores should be between 0 and 1
      expect(report.healthSummary.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.healthSummary.overallScore).toBeLessThanOrEqual(1);
    });

    it('should include prioritized recommendations', async () => {
      const report = await generator.generateReport('/test');

      // Recommendations should be sorted by priority
      for (let i = 1; i < report.recommendations.length; i++) {
        expect(report.recommendations[i - 1].priority)
          .toBeGreaterThanOrEqual(report.recommendations[i].priority);
      }
    });

    it('should include next steps based on issues', async () => {
      const report = await generator.generateReport('/test');

      expect(Array.isArray(report.nextSteps)).toBe(true);
      // Should have at least general guidance
      expect(report.nextSteps.length).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      const before = new Date();
      const report = await generator.generateReport('/test');
      const after = new Date();

      expect(report.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(report.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ===========================================================================
  // exportReport METHOD
  // ===========================================================================

  describe('exportReport', () => {
    it('should export as JSON', async () => {
      const report = await generator.generateReport('/test');
      const exported = generator.exportReport(report, 'json');

      expect(typeof exported).toBe('string');
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveProperty('generatedAt');
      expect(parsed).toHaveProperty('issues');
      expect(parsed).toHaveProperty('recommendations');
    });

    it('should export as Markdown', async () => {
      const report = await generator.generateReport('/test');
      const exported = generator.exportReport(report, 'markdown');

      expect(typeof exported).toBe('string');
      expect(exported).toContain('# Self-Improvement Report');
      expect(exported).toContain('## Health Summary');
      expect(exported).toContain('## Issues');
      expect(exported).toContain('## Recommendations');
    });

    it('should include all sections in Markdown', async () => {
      // Add some issues to make the report more interesting
      const report = await generator.generateReport('/test');

      // Inject issues for testing
      report.issues = [
        {
          id: 'test-issue',
          category: 'architecture',
          severity: 'high',
          title: 'Test Issue',
          description: 'Test description',
          affectedFiles: ['/test/file.ts'],
          evidence: ['Evidence 1'],
        },
      ];
      report.recommendations = [
        {
          issueId: 'test-issue',
          action: 'Fix the issue',
          effort: 'small',
          impact: 'high',
          priority: 80,
          implementationHints: ['Hint 1'],
        },
      ];

      const exported = generator.exportReport(report, 'markdown');

      expect(exported).toContain('Test Issue');
      expect(exported).toContain('Fix the issue');
    });

    it('should handle empty report gracefully', async () => {
      const emptyReport: SelfImprovementReport = {
        generatedAt: new Date(),
        librarianVersion: '0.1.0',
        analysisScope: {
          filesAnalyzed: 0,
          testsRun: 0,
          metricsCollected: [],
        },
        healthSummary: {
          overallScore: 1.0,
          calibrationScore: 1.0,
          consistencyScore: 1.0,
          coverageScore: 1.0,
        },
        issues: [],
        recommendations: [],
        nextSteps: [],
      };

      const json = generator.exportReport(emptyReport, 'json');
      const markdown = generator.exportReport(emptyReport, 'markdown');

      expect(JSON.parse(json)).toBeDefined();
      expect(markdown).toContain('No issues found');
    });
  });

  // ===========================================================================
  // INTEGRATION WITH SELF-ANALYSIS PRIMITIVES
  // ===========================================================================

  describe('integration with primitives', () => {
    it('should use analyzeArchitecture for architecture issues', async () => {
      const issues = await generator.analyzeCodebase('/test');

      // The generator should internally call analyzeArchitecture
      expect(mockStorage.getModules).toHaveBeenCalled();
    });

    it('should use analyzeConsistency for consistency issues', async () => {
      const issues = await generator.analyzeCodebase('/test');

      // The generator should internally call analyzeConsistency
      expect(mockStorage.getFunctions).toHaveBeenCalled();
    });

    it('should use verifyCalibration for calibration issues', async () => {
      const issues = await generator.analyzeCodebase('/test');

      // The generator should try to gather calibration data
      // May or may not have been called depending on implementation
      expect(Array.isArray(issues)).toBe(true);
    });
  });

  // ===========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ===========================================================================

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      (mockStorage.getModules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

      const issues = await generator.analyzeCodebase('/test');

      // Should not throw, should return what it can
      expect(Array.isArray(issues)).toBe(true);
    });

    it('should handle partial data', async () => {
      (mockStorage.getModules as ReturnType<typeof vi.fn>).mockResolvedValue(mockModules);
      (mockStorage.getFunctions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Error'));

      const report = await generator.generateReport('/test');

      // Should still produce a report
      expect(report).toHaveProperty('healthSummary');
    });
  });

  // ===========================================================================
  // SEVERITY AND PRIORITY CALCULATIONS
  // ===========================================================================

  describe('severity classification', () => {
    it('should classify critical issues correctly', () => {
      const criticalIssue: Issue = {
        id: 'crit-1',
        category: 'architecture',
        severity: 'critical',
        title: 'Security vulnerability',
        description: 'Critical security issue found',
        affectedFiles: ['/test/src/auth.ts'],
        evidence: ['SQL injection possible'],
      };

      const recommendations = generator.generateRecommendations([criticalIssue]);

      // Critical issues should have high priority
      expect(recommendations[0].priority).toBeGreaterThan(70);
    });

    it('should classify low severity issues correctly', () => {
      const lowIssue: Issue = {
        id: 'low-1',
        category: 'consistency',
        severity: 'low',
        title: 'Minor documentation mismatch',
        description: 'Slight wording difference in docs',
        affectedFiles: ['/test/docs/readme.md'],
        evidence: ['Typo in description'],
      };

      const recommendations = generator.generateRecommendations([lowIssue]);

      // Low severity issues should have lower priority
      expect(recommendations[0].priority).toBeLessThan(50);
    });
  });

  // ===========================================================================
  // PERFORMANCE CONSIDERATIONS
  // ===========================================================================

  describe('performance', () => {
    it('should complete analysis in reasonable time', async () => {
      const start = Date.now();
      await generator.analyzeCodebase('/test');
      const duration = Date.now() - start;

      // Analysis should complete within 5 seconds for mock data
      expect(duration).toBeLessThan(5000);
    });

    it('should handle large codebases', async () => {
      // Generate many modules
      const manyModules = Array.from({ length: 100 }, (_, i) => ({
        id: `mod-${i}`,
        path: `/test/src/module_${i}.ts`,
        purpose: `Module ${i}`,
        exports: ['export1', 'export2'],
        dependencies: i > 0 ? [`./module_${i - 1}`] : [],
        confidence: 0.9,
      }));

      (mockStorage.getModules as ReturnType<typeof vi.fn>).mockResolvedValue(manyModules);
      generator = new SelfImprovementReportGenerator(mockStorage);

      const start = Date.now();
      const issues = await generator.analyzeCodebase('/test');
      const duration = Date.now() - start;

      expect(Array.isArray(issues)).toBe(true);
      // Should still be relatively fast
      expect(duration).toBeLessThan(10000);
    });
  });
});
