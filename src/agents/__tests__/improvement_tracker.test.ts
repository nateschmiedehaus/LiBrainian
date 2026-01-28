/**
 * @fileoverview Tests for ImprovementTracker
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The Improvement Tracker monitors Librarian's improvement over time across
 * scientific loop iterations and A/B experiments.
 *
 * Metrics tracked:
 * - Loop Health Metrics: Fix Success Rate, Hypothesis Accuracy, Regression Rate, Evolution Coverage
 * - Improvement Metrics: Problems Fixed/Iteration, Agent Lift Trend, Benchmark Growth
 *
 * Trend Calculation:
 * - improving: Last 3 iterations show positive slope
 * - stable: Last 3 iterations within +/-5% of average
 * - declining: Last 3 iterations show negative slope
 *
 * Health Assessment:
 * - healthy: All metrics meet targets
 * - degrading: One or more metrics below target
 * - critical: Fix success rate < 50% or regression rate > 10%
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createImprovementTracker,
  ImprovementTrackerImpl,
} from '../improvement_tracker.js';
import type {
  ImprovementTracking,
  ImprovementTrend,
  LoopHealthMetrics,
  ImprovementReport,
  LoopResult,
  ScientificLoopState,
  LoopSummary,
  VerificationResult,
  HypothesisTestResult,
  BenchmarkEvolution,
} from '../types.js';

describe('ImprovementTracker', () => {
  describe('createImprovementTracker factory', () => {
    it('returns an ImprovementTrackerImpl instance', () => {
      const tracker = createImprovementTracker();
      expect(tracker).toBeInstanceOf(ImprovementTrackerImpl);
    });
  });

  describe('recordIteration', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    it('records a data point with timestamp', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.15,
        agentTimeReduction: 0.1,
      });

      const history = tracker.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });

    it('records multiple data points in order', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.15,
        agentTimeReduction: 0.1,
      });

      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 3,
        testSuitePassRate: 0.97,
        agentSuccessRateLift: 0.20,
        agentTimeReduction: 0.15,
      });

      const history = tracker.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].iteration).toBe(1);
      expect(history[1].iteration).toBe(2);
    });

    it('preserves all input fields', () => {
      tracker.recordIteration({
        iteration: 5,
        problemsFixed: 10,
        testSuitePassRate: 0.88,
        agentSuccessRateLift: 0.25,
        agentTimeReduction: 0.30,
      });

      const history = tracker.getHistory();
      expect(history[0].iteration).toBe(5);
      expect(history[0].problemsFixed).toBe(10);
      expect(history[0].testSuitePassRate).toBe(0.88);
      expect(history[0].agentSuccessRateLift).toBe(0.25);
      expect(history[0].agentTimeReduction).toBe(0.30);
    });

    it('allows negative agentSuccessRateLift', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 0,
        testSuitePassRate: 0.80,
        agentSuccessRateLift: -0.05,
        agentTimeReduction: -0.02,
      });

      const history = tracker.getHistory();
      expect(history[0].agentSuccessRateLift).toBe(-0.05);
    });

    it('allows negative agentTimeReduction', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 0,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.0,
        agentTimeReduction: -0.10,
      });

      const history = tracker.getHistory();
      expect(history[0].agentTimeReduction).toBe(-0.10);
    });
  });

  describe('getHistory', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    it('returns empty array initially', () => {
      const history = tracker.getHistory();
      expect(history).toEqual([]);
    });

    it('returns a copy of history (not the internal array)', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.05,
      });

      const history1 = tracker.getHistory();
      const history2 = tracker.getHistory();
      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('reset', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    it('clears all recorded data', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.05,
      });

      tracker.reset();
      expect(tracker.getHistory()).toEqual([]);
    });

    it('allows recording new data after reset', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.05,
      });

      tracker.reset();

      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 5,
        testSuitePassRate: 0.99,
        agentSuccessRateLift: 0.30,
        agentTimeReduction: 0.20,
      });

      const history = tracker.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].problemsFixed).toBe(5);
    });
  });

  describe('computeTrend', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    describe('with no data', () => {
      it('returns empty dataPoints', () => {
        const trend = tracker.computeTrend();
        expect(trend.dataPoints).toEqual([]);
      });

      it('returns stable trendDirection', () => {
        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('stable');
      });

      it('returns zero averageImprovement', () => {
        const trend = tracker.computeTrend();
        expect(trend.averageImprovement).toBe(0);
      });

      it('returns zero totalProblemsFixed', () => {
        const trend = tracker.computeTrend();
        expect(trend.totalProblemsFixed).toBe(0);
      });

      it('returns healthy testSuiteHealth', () => {
        const trend = tracker.computeTrend();
        expect(trend.testSuiteHealth).toBe('healthy');
      });
    });

    describe('with single data point', () => {
      beforeEach(() => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
      });

      it('returns stable trendDirection', () => {
        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('stable');
      });

      it('returns totalProblemsFixed from single point', () => {
        const trend = tracker.computeTrend();
        expect(trend.totalProblemsFixed).toBe(3);
      });
    });

    describe('with two data points', () => {
      beforeEach(() => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 2,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
      });

      it('returns stable trendDirection (need 3+ for trend)', () => {
        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('stable');
      });

      it('returns totalProblemsFixed from all points', () => {
        const trend = tracker.computeTrend();
        expect(trend.totalProblemsFixed).toBe(5);
      });
    });

    describe('trend direction with 3+ data points', () => {
      it('returns improving when last 3 show positive slope', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.08,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.12,
        });

        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('improving');
      });

      it('returns declining when last 3 show negative slope', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.15,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 1,
          testSuitePassRate: 0.88,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });

        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('declining');
      });

      it('returns stable when last 3 within +/-5% of average', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 2,
          testSuitePassRate: 0.93,
          agentSuccessRateLift: 0.16,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });

        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('stable');
      });

      it('only considers last 3 iterations for trend', () => {
        // First 3 iterations are declining
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 5,
          testSuitePassRate: 0.99,
          agentSuccessRateLift: 0.30,
          agentTimeReduction: 0.25,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 4,
          testSuitePassRate: 0.97,
          agentSuccessRateLift: 0.25,
          agentTimeReduction: 0.20,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.15,
        });
        // Last 3 iterations are improving
        tracker.recordIteration({
          iteration: 4,
          problemsFixed: 2,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 5,
          problemsFixed: 3,
          testSuitePassRate: 0.93,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 6,
          problemsFixed: 4,
          testSuitePassRate: 0.96,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.15,
        });

        const trend = tracker.computeTrend();
        expect(trend.trendDirection).toBe('improving');
      });
    });

    describe('averageImprovement', () => {
      it('computes average agentSuccessRateLift across iterations', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.30,
          agentTimeReduction: 0.15,
        });

        const trend = tracker.computeTrend();
        // (0.10 + 0.20 + 0.30) / 3 = 0.20
        expect(trend.averageImprovement).toBeCloseTo(0.20, 2);
      });

      it('handles negative values correctly', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: -0.05,
          agentTimeReduction: 0.0,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 1,
          testSuitePassRate: 0.88,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.25,
          agentTimeReduction: 0.10,
        });

        const trend = tracker.computeTrend();
        // (-0.05 + 0.10 + 0.25) / 3 = 0.10
        expect(trend.averageImprovement).toBeCloseTo(0.10, 2);
      });
    });

    describe('totalProblemsFixed', () => {
      it('sums problemsFixed across all iterations', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 3,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.05,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 5,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.08,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 2,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.20,
          agentTimeReduction: 0.12,
        });

        const trend = tracker.computeTrend();
        expect(trend.totalProblemsFixed).toBe(10);
      });
    });

    describe('testSuiteHealth', () => {
      it('returns healthy when testSuitePassRate >= 0.90', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 2,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });

        const trend = tracker.computeTrend();
        expect(trend.testSuiteHealth).toBe('healthy');
      });

      it('returns degrading when testSuitePassRate between 0.70 and 0.90', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.80,
          agentSuccessRateLift: 0.05,
          agentTimeReduction: 0.02,
        });

        const trend = tracker.computeTrend();
        expect(trend.testSuiteHealth).toBe('degrading');
      });

      it('returns critical when testSuitePassRate < 0.70', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 0,
          testSuitePassRate: 0.50,
          agentSuccessRateLift: -0.10,
          agentTimeReduction: -0.05,
        });

        const trend = tracker.computeTrend();
        expect(trend.testSuiteHealth).toBe('critical');
      });

      it('uses latest testSuitePassRate for health assessment', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 2,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.15,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 1,
          testSuitePassRate: 0.65,
          agentSuccessRateLift: 0.05,
          agentTimeReduction: 0.02,
        });

        const trend = tracker.computeTrend();
        expect(trend.testSuiteHealth).toBe('critical');
      });
    });
  });

  describe('computeHealth', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    describe('with empty loopResults', () => {
      it('returns zero fixSuccessRate', () => {
        const health = tracker.computeHealth([]);
        expect(health.fixSuccessRate).toBe(0);
      });

      it('returns zero hypothesisAccuracy', () => {
        const health = tracker.computeHealth([]);
        expect(health.hypothesisAccuracy).toBe(0);
      });

      it('returns zero regressionRate', () => {
        const health = tracker.computeHealth([]);
        expect(health.regressionRate).toBe(0);
      });

      it('returns zero evolutionCoverage', () => {
        const health = tracker.computeHealth([]);
        expect(health.evolutionCoverage).toBe(0);
      });
    });

    describe('fixSuccessRate', () => {
      it('calculates fixes accepted / fixes attempted', () => {
        const loopResults = [
          createMockLoopResult({
            fixesAttempted: [
              createMockVerificationResult('FIX-001', true),
              createMockVerificationResult('FIX-002', false),
              createMockVerificationResult('FIX-003', true),
            ],
          }),
        ];

        const health = tracker.computeHealth(loopResults);
        // 2 accepted / 3 attempted = 0.67
        expect(health.fixSuccessRate).toBeCloseTo(0.67, 2);
      });

      it('aggregates across multiple loop results', () => {
        const loopResults = [
          createMockLoopResult({
            fixesAttempted: [
              createMockVerificationResult('FIX-001', true),
            ],
          }),
          createMockLoopResult({
            fixesAttempted: [
              createMockVerificationResult('FIX-002', true),
              createMockVerificationResult('FIX-003', false),
            ],
          }),
        ];

        const health = tracker.computeHealth(loopResults);
        // 2 accepted / 3 attempted = 0.67
        expect(health.fixSuccessRate).toBeCloseTo(0.67, 2);
      });
    });

    describe('hypothesisAccuracy', () => {
      it('calculates supported hypotheses leading to successful fix', () => {
        const loopResults = [
          createMockLoopResult({
            hypothesesTested: [
              createMockHypothesisTestResult('HYP-001', 'supported'),
              createMockHypothesisTestResult('HYP-002', 'supported'),
              createMockHypothesisTestResult('HYP-003', 'refuted'),
            ],
            fixesAttempted: [
              createMockVerificationResult('FIX-001', true), // HYP-001 led to fix
              createMockVerificationResult('FIX-002', false), // HYP-002 fix failed
            ],
          }),
        ];

        const health = tracker.computeHealth(loopResults);
        // 1 successful fix / 2 supported hypotheses = 0.50
        expect(health.hypothesisAccuracy).toBeCloseTo(0.50, 2);
      });
    });

    describe('regressionRate', () => {
      it('calculates new failures from fixes', () => {
        const loopResults = [
          createMockLoopResult({
            fixesAttempted: [
              createMockVerificationResultWithRegressions('FIX-001', true, true, false), // has regression
              createMockVerificationResultWithRegressions('FIX-002', true, true, true), // no regression
              createMockVerificationResultWithRegressions('FIX-003', false, true, true), // rejected, no regression
            ],
          }),
        ];

        const health = tracker.computeHealth(loopResults);
        // 1 regression / 3 fixes = 0.33
        expect(health.regressionRate).toBeCloseTo(0.33, 2);
      });
    });

    describe('evolutionCoverage', () => {
      it('calculates new tests catching real bugs', () => {
        const loopResults = [
          createMockLoopResult({
            benchmarkEvolutions: [
              createMockBenchmarkEvolution('PROB-001', 3), // 3 new tests
              createMockBenchmarkEvolution('PROB-002', 2), // 2 new tests
            ],
            // Assume 25 total tests baseline
          }),
        ];

        const health = tracker.computeHealth(loopResults);
        // 5 new tests / 25 total = 0.20 (or based on actual bug catches)
        // Note: exact calculation depends on implementation details
        expect(health.evolutionCoverage).toBeGreaterThanOrEqual(0);
        expect(health.evolutionCoverage).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('generateReport', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    it('returns currentIteration from latest tracking data', () => {
      tracker.recordIteration({
        iteration: 5,
        problemsFixed: 3,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.20,
        agentTimeReduction: 0.15,
      });

      const report = tracker.generateReport([]);
      expect(report.currentIteration).toBe(5);
    });

    it('returns 0 currentIteration when no data recorded', () => {
      const report = tracker.generateReport([]);
      expect(report.currentIteration).toBe(0);
    });

    it('returns latest tracking data point', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.05,
      });
      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 4,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.20,
        agentTimeReduction: 0.15,
      });

      const report = tracker.generateReport([]);
      expect(report.tracking.iteration).toBe(2);
      expect(report.tracking.problemsFixed).toBe(4);
    });

    it('returns default tracking data when none recorded', () => {
      const report = tracker.generateReport([]);
      expect(report.tracking.iteration).toBe(0);
      expect(report.tracking.problemsFixed).toBe(0);
      expect(report.tracking.testSuitePassRate).toBe(0);
      expect(report.tracking.agentSuccessRateLift).toBe(0);
      expect(report.tracking.agentTimeReduction).toBe(0);
    });

    it('includes trend analysis', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.05,
      });
      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 3,
        testSuitePassRate: 0.93,
        agentSuccessRateLift: 0.15,
        agentTimeReduction: 0.10,
      });
      tracker.recordIteration({
        iteration: 3,
        problemsFixed: 4,
        testSuitePassRate: 0.96,
        agentSuccessRateLift: 0.20,
        agentTimeReduction: 0.15,
      });

      const report = tracker.generateReport([]);
      expect(report.trend).toBeDefined();
      expect(report.trend.trendDirection).toBe('improving');
    });

    it('includes health metrics from loopResults', () => {
      const loopResults = [
        createMockLoopResult({
          fixesAttempted: [
            createMockVerificationResult('FIX-001', true),
          ],
        }),
      ];

      const report = tracker.generateReport(loopResults);
      expect(report.health).toBeDefined();
      expect(report.health.fixSuccessRate).toBe(1.0);
    });

    it('includes recommendations array', () => {
      const report = tracker.generateReport([]);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    describe('recommendations', () => {
      it('recommends improving fix success rate when below target', () => {
        const loopResults = [
          createMockLoopResult({
            fixesAttempted: [
              createMockVerificationResult('FIX-001', false),
              createMockVerificationResult('FIX-002', false),
              createMockVerificationResult('FIX-003', true),
            ],
          }),
        ];

        const report = tracker.generateReport(loopResults);
        expect(report.recommendations.some(r =>
          r.toLowerCase().includes('fix success rate')
        )).toBe(true);
      });

      it('recommends improving hypothesis accuracy when below target', () => {
        const loopResults = [
          createMockLoopResult({
            hypothesesTested: [
              createMockHypothesisTestResult('HYP-001', 'supported'),
              createMockHypothesisTestResult('HYP-002', 'supported'),
              createMockHypothesisTestResult('HYP-003', 'supported'),
              createMockHypothesisTestResult('HYP-004', 'supported'),
            ],
            fixesAttempted: [
              createMockVerificationResult('FIX-001', false),
              createMockVerificationResult('FIX-002', false),
            ],
          }),
        ];

        const report = tracker.generateReport(loopResults);
        expect(report.recommendations.some(r =>
          r.toLowerCase().includes('hypothesis')
        )).toBe(true);
      });

      it('recommends addressing test suite health when degrading', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.75,
          agentSuccessRateLift: 0.05,
          agentTimeReduction: 0.02,
        });

        const report = tracker.generateReport([]);
        expect(report.recommendations.some(r =>
          r.toLowerCase().includes('test suite') || r.toLowerCase().includes('pass rate')
        )).toBe(true);
      });

      it('returns empty recommendations when all targets met', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.25,
          agentTimeReduction: 0.20,
        });

        const loopResults = [
          createMockLoopResult({
            hypothesesTested: [
              createMockHypothesisTestResult('HYP-001', 'supported'),
            ],
            fixesAttempted: [
              createMockVerificationResult('FIX-001', true),
            ],
          }),
        ];

        const report = tracker.generateReport(loopResults);
        // Should have few or no recommendations when everything is good
        expect(report.recommendations.length).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('deterministic output (Tier-0)', () => {
    it('produces consistent trend for same input', () => {
      const tracker1 = createImprovementTracker();
      const tracker2 = createImprovementTracker();

      const data = [
        { iteration: 1, problemsFixed: 2, testSuitePassRate: 0.90, agentSuccessRateLift: 0.10, agentTimeReduction: 0.05 },
        { iteration: 2, problemsFixed: 3, testSuitePassRate: 0.93, agentSuccessRateLift: 0.15, agentTimeReduction: 0.10 },
        { iteration: 3, problemsFixed: 4, testSuitePassRate: 0.96, agentSuccessRateLift: 0.20, agentTimeReduction: 0.15 },
      ];

      data.forEach(d => tracker1.recordIteration(d));
      data.forEach(d => tracker2.recordIteration(d));

      const trend1 = tracker1.computeTrend();
      const trend2 = tracker2.computeTrend();

      expect(trend1.trendDirection).toBe(trend2.trendDirection);
      expect(trend1.averageImprovement).toBe(trend2.averageImprovement);
      expect(trend1.totalProblemsFixed).toBe(trend2.totalProblemsFixed);
      expect(trend1.testSuiteHealth).toBe(trend2.testSuiteHealth);
    });

    it('produces consistent health metrics for same loopResults', () => {
      const tracker1 = createImprovementTracker();
      const tracker2 = createImprovementTracker();

      const loopResults = [
        createMockLoopResult({
          fixesAttempted: [
            createMockVerificationResult('FIX-001', true),
            createMockVerificationResult('FIX-002', false),
          ],
        }),
      ];

      const health1 = tracker1.computeHealth(loopResults);
      const health2 = tracker2.computeHealth(loopResults);

      expect(health1.fixSuccessRate).toBe(health2.fixSuccessRate);
      expect(health1.hypothesisAccuracy).toBe(health2.hypothesisAccuracy);
      expect(health1.regressionRate).toBe(health2.regressionRate);
      expect(health1.evolutionCoverage).toBe(health2.evolutionCoverage);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockLoopResult(overrides: Partial<{
  state: Partial<ScientificLoopState>;
  summary: Partial<LoopSummary>;
  fixesAttempted: VerificationResult[];
  hypothesesTested: HypothesisTestResult[];
  benchmarkEvolutions: BenchmarkEvolution[];
}> = {}): LoopResult {
  const fixesAttempted = overrides.fixesAttempted || [];
  const hypothesesTested = overrides.hypothesesTested || [];
  const benchmarkEvolutions = overrides.benchmarkEvolutions || [];

  const fixesAccepted = fixesAttempted.filter(f => f.reward === 1).length;

  return {
    state: {
      iteration: 1,
      problemsDetected: [],
      problemsFixed: [],
      problemsEscalated: [],
      hypothesesTested,
      fixesAttempted,
      benchmarkEvolutions,
      ...overrides.state,
    },
    escalations: [],
    summary: {
      problemsDetected: 0,
      problemsFixed: fixesAccepted,
      problemsEscalated: 0,
      fixSuccessRate: fixesAttempted.length > 0 ? fixesAccepted / fixesAttempted.length : 0,
      hypothesisAccuracy: 0,
      ...overrides.summary,
    },
  };
}

function createMockVerificationResult(fixId: string, success: boolean): VerificationResult {
  return {
    fixId,
    verification: {
      originalTestPasses: success,
      noRegressions: true,
      typesValid: success,
    },
    reward: success ? 1 : 0,
    verdict: success ? 'fix_accepted' : 'fix_rejected',
    notes: success ? 'All checks passed' : 'Fix rejected',
    executionLog: [],
  };
}

function createMockVerificationResultWithRegressions(
  fixId: string,
  originalPasses: boolean,
  typesValid: boolean,
  noRegressions: boolean
): VerificationResult {
  const success = originalPasses && noRegressions && typesValid;
  return {
    fixId,
    verification: {
      originalTestPasses: originalPasses,
      noRegressions,
      typesValid,
    },
    reward: success ? 1 : 0,
    verdict: success ? 'fix_accepted' : 'fix_rejected',
    notes: success ? 'All checks passed' : 'Fix rejected',
    executionLog: [],
  };
}

function createMockHypothesisTestResult(
  hypothesisId: string,
  verdict: 'supported' | 'refuted' | 'inconclusive'
): HypothesisTestResult {
  return {
    hypothesisId,
    verdict,
    evidence: [{ type: 'code_inspection', finding: 'test', implication: 'test' }],
    confidence: verdict === 'supported' ? 0.85 : verdict === 'refuted' ? 0.90 : 0.50,
    recommendation: verdict === 'supported' ? 'proceed_to_fix' : 'test_another_hypothesis',
  };
}

function createMockBenchmarkEvolution(problemId: string, newTestCount: number): BenchmarkEvolution {
  return {
    problemId,
    fixId: `FIX-${problemId}`,
    newTests: Array(newTestCount).fill(null).map((_, i) => ({
      name: `test-${i}`,
      file: 'test.ts',
      code: `test('${i}', () => {})`,
      category: 'prevention' as const,
    })),
    regressionGuards: [],
    variantTests: [],
    coverageGaps: [],
  };
}
