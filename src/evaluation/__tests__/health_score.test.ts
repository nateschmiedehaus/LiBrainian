/**
 * @fileoverview Tests for Health Score Computation
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Health Score Computer computes aggregate health scores from multiple components,
 * combining calibration, freshness, consistency, coverage, and error rate metrics.
 *
 * WU-CALX-003: Health Score Computation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  HealthScoreComputer,
  createHealthScoreComputer,
  type ComponentScore,
  type HealthScoreConfig,
  type AggregateHealthScore,
  type HealthHistory,
  DEFAULT_HEALTH_SCORE_CONFIG,
} from '../health_score.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a mock component score for testing
 */
function createMockComponentScore(overrides: Partial<ComponentScore> = {}): ComponentScore {
  return {
    component: 'test-component',
    score: 75,
    weight: 1.0,
    status: 'healthy',
    details: { metric1: 80, metric2: 70 },
    ...overrides,
  };
}

/**
 * Create mock metrics for a component
 */
function createMockMetrics(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    accuracy: 0.85,
    precision: 0.90,
    recall: 0.80,
    ...overrides,
  };
}

/**
 * Create a full set of component scores for testing
 */
function createFullComponentSet(): ComponentScore[] {
  return [
    createMockComponentScore({
      component: 'calibration',
      score: 85,
      weight: 0.25,
      status: 'healthy',
      details: { ece: 0.05, brier: 0.1 },
    }),
    createMockComponentScore({
      component: 'freshness',
      score: 90,
      weight: 0.2,
      status: 'healthy',
      details: { staleDocs: 2, avgAge: 24 },
    }),
    createMockComponentScore({
      component: 'consistency',
      score: 78,
      weight: 0.2,
      status: 'warning',
      details: { violations: 3, totalChecks: 100 },
    }),
    createMockComponentScore({
      component: 'coverage',
      score: 70,
      weight: 0.2,
      status: 'warning',
      details: { coveredFiles: 80, totalFiles: 100 },
    }),
    createMockComponentScore({
      component: 'errorRate',
      score: 95,
      weight: 0.15,
      status: 'healthy',
      details: { errors: 5, totalRequests: 1000 },
    }),
  ];
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createHealthScoreComputer', () => {
  it('should create a HealthScoreComputer instance', () => {
    const computer = createHealthScoreComputer();
    expect(computer).toBeInstanceOf(HealthScoreComputer);
  });

  it('should accept custom configuration', () => {
    const customConfig: HealthScoreConfig = {
      weights: {
        calibration: 0.3,
        freshness: 0.2,
        consistency: 0.2,
        coverage: 0.15,
        errorRate: 0.15,
      },
      thresholds: {
        healthy: 85,
        warning: 60,
      },
    };

    const computer = createHealthScoreComputer(customConfig);
    expect(computer).toBeInstanceOf(HealthScoreComputer);
  });
});

// ============================================================================
// DEFAULT CONFIGURATION TESTS
// ============================================================================

describe('DEFAULT_HEALTH_SCORE_CONFIG', () => {
  it('should have weights that sum to 1.0', () => {
    const totalWeight =
      DEFAULT_HEALTH_SCORE_CONFIG.weights.calibration +
      DEFAULT_HEALTH_SCORE_CONFIG.weights.freshness +
      DEFAULT_HEALTH_SCORE_CONFIG.weights.consistency +
      DEFAULT_HEALTH_SCORE_CONFIG.weights.coverage +
      DEFAULT_HEALTH_SCORE_CONFIG.weights.errorRate;

    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it('should have valid thresholds', () => {
    expect(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.healthy).toBeGreaterThan(
      DEFAULT_HEALTH_SCORE_CONFIG.thresholds.warning
    );
    expect(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.warning).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.healthy).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// COMPONENT SCORE COMPUTATION TESTS
// ============================================================================

describe('HealthScoreComputer - computeComponentScore', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
  });

  it('should compute a valid component score', () => {
    const metrics = createMockMetrics();
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.component).toBe('calibration');
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.weight).toBeGreaterThan(0);
    expect(['healthy', 'warning', 'critical']).toContain(score.status);
    expect(score.details).toBeDefined();
  });

  it('should use correct weight from configuration', () => {
    const metrics = createMockMetrics();
    const calibrationScore = computer.computeComponentScore('calibration', metrics);
    const freshnessScore = computer.computeComponentScore('freshness', metrics);

    expect(calibrationScore.weight).toBe(DEFAULT_HEALTH_SCORE_CONFIG.weights.calibration);
    expect(freshnessScore.weight).toBe(DEFAULT_HEALTH_SCORE_CONFIG.weights.freshness);
  });

  it('should determine healthy status correctly', () => {
    const metrics = { accuracy: 0.95, precision: 0.95 };
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.status).toBe('healthy');
    expect(score.score).toBeGreaterThanOrEqual(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.healthy);
  });

  it('should determine warning status correctly', () => {
    const metrics = { accuracy: 0.70, precision: 0.70 };
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.status).toBe('warning');
    expect(score.score).toBeGreaterThanOrEqual(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.warning);
    expect(score.score).toBeLessThan(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.healthy);
  });

  it('should determine critical status correctly', () => {
    const metrics = { accuracy: 0.30, precision: 0.30 };
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.status).toBe('critical');
    expect(score.score).toBeLessThan(DEFAULT_HEALTH_SCORE_CONFIG.thresholds.warning);
  });

  it('should store original metrics in details', () => {
    const metrics = { accuracy: 0.85, precision: 0.90, recall: 0.80 };
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.details.accuracy).toBe(0.85);
    expect(score.details.precision).toBe(0.90);
    expect(score.details.recall).toBe(0.80);
  });

  it('should handle empty metrics gracefully', () => {
    const score = computer.computeComponentScore('calibration', {});

    expect(score).toBeDefined();
    expect(score.score).toBe(0);
    expect(score.status).toBe('critical');
  });

  it('should handle unknown component names', () => {
    const metrics = createMockMetrics();
    const score = computer.computeComponentScore('unknown-component', metrics);

    expect(score.component).toBe('unknown-component');
    expect(score.weight).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// AGGREGATE SCORE COMPUTATION TESTS
// ============================================================================

describe('HealthScoreComputer - computeAggregateScore', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
  });

  it('should compute a valid aggregate score', () => {
    const components = createFullComponentSet();
    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.overall).toBeGreaterThanOrEqual(0);
    expect(aggregate.overall).toBeLessThanOrEqual(100);
    expect(['healthy', 'warning', 'critical']).toContain(aggregate.status);
    expect(aggregate.components).toEqual(components);
    expect(aggregate.timestamp).toBeInstanceOf(Date);
    expect(['improving', 'stable', 'degrading']).toContain(aggregate.trend);
    expect(Array.isArray(aggregate.recommendations)).toBe(true);
  });

  it('should compute weighted average correctly', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 100, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 50, weight: 0.5, status: 'warning' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    // Weighted average: (100 * 0.5 + 50 * 0.5) / (0.5 + 0.5) = 75
    expect(aggregate.overall).toBeCloseTo(75, 1);
  });

  it('should apply penalty for critical components', () => {
    const componentsWithCritical: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 90, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 30, weight: 0.5, status: 'critical' }),
    ];

    const componentsNoCritical: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 90, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 70, weight: 0.5, status: 'warning' }),
    ];

    const aggregateWithCritical = computer.computeAggregateScore(componentsWithCritical);
    const aggregateNoCritical = computer.computeAggregateScore(componentsNoCritical);

    // Score should be penalized when there's a critical component
    // The penalty makes it lower than just the weighted average would suggest
    expect(aggregateWithCritical.overall).toBeLessThan(60);
  });

  it('should apply bonus for all-healthy state', () => {
    const allHealthyComponents: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 85, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 85, weight: 0.5, status: 'healthy' }),
    ];

    const mixedComponents: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 85, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 85, weight: 0.5, status: 'warning' }),
    ];

    const aggregateAllHealthy = computer.computeAggregateScore(allHealthyComponents);
    const aggregateMixed = computer.computeAggregateScore(mixedComponents);

    // All-healthy should get a bonus (or at least equal)
    expect(aggregateAllHealthy.overall).toBeGreaterThanOrEqual(aggregateMixed.overall);
  });

  it('should handle empty components array', () => {
    const aggregate = computer.computeAggregateScore([]);

    expect(aggregate.overall).toBe(0);
    expect(aggregate.status).toBe('critical');
    expect(aggregate.components).toEqual([]);
  });

  it('should generate recommendations for non-healthy components', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'calibration', score: 50, status: 'warning' }),
      createMockComponentScore({ component: 'freshness', score: 30, status: 'critical' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.recommendations.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// HISTORY RECORDING TESTS
// ============================================================================

describe('HealthScoreComputer - recordScore', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
  });

  it('should record a score in history', () => {
    const components = createFullComponentSet();
    const score = computer.computeAggregateScore(components);

    computer.recordScore(score);

    const history = computer.getHistory(24);
    expect(history.scores.length).toBe(1);
    expect(history.scores[0]).toEqual(score);
  });

  it('should record multiple scores', () => {
    const components = createFullComponentSet();

    for (let i = 0; i < 5; i++) {
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    const history = computer.getHistory(24);
    expect(history.scores.length).toBe(5);
  });
});

// ============================================================================
// HISTORY RETRIEVAL TESTS
// ============================================================================

describe('HealthScoreComputer - getHistory', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty history when no scores recorded', () => {
    const history = computer.getHistory(24);

    expect(history.scores).toEqual([]);
    expect(history.averageScore).toBe(0);
    expect(history.volatility).toBe(0);
    expect(history.trendDirection).toBe(0);
  });

  it('should filter scores by time window', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    vi.setSystemTime(now);

    const components = createFullComponentSet();

    // Record score 2 hours ago
    vi.setSystemTime(new Date('2026-01-28T10:00:00Z'));
    const oldScore = computer.computeAggregateScore(components);
    computer.recordScore(oldScore);

    // Record score now
    vi.setSystemTime(now);
    const newScore = computer.computeAggregateScore(components);
    computer.recordScore(newScore);

    // Get history for last 1 hour (should only include recent score)
    const history1Hour = computer.getHistory(1);
    expect(history1Hour.scores.length).toBe(1);

    // Get history for last 24 hours (should include both)
    const history24Hours = computer.getHistory(24);
    expect(history24Hours.scores.length).toBe(2);
  });

  it('should compute average score correctly', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    vi.setSystemTime(now);

    // Record scores with known values
    const components1 = [
      createMockComponentScore({ component: 'a', score: 80, weight: 1, status: 'healthy' }),
    ];
    const components2 = [
      createMockComponentScore({ component: 'a', score: 60, weight: 1, status: 'warning' }),
    ];

    const score1 = computer.computeAggregateScore(components1);
    const score2 = computer.computeAggregateScore(components2);

    computer.recordScore(score1);
    computer.recordScore(score2);

    const history = computer.getHistory(24);

    // Average should be close to (score1.overall + score2.overall) / 2
    const expectedAverage = (score1.overall + score2.overall) / 2;
    expect(history.averageScore).toBeCloseTo(expectedAverage, 1);
  });

  it('should compute volatility correctly', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    vi.setSystemTime(now);

    // Record scores with high variance
    const scores = [90, 50, 80, 40, 70];
    for (const scoreVal of scores) {
      const components = [
        createMockComponentScore({ component: 'a', score: scoreVal, weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    const history = computer.getHistory(24);

    // Volatility should be positive (there is variance)
    expect(history.volatility).toBeGreaterThan(0);
  });

  it('should compute trend direction correctly for improving scores', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record improving scores over time
    const scores = [50, 60, 70, 80, 90];
    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);

    // Trend should be positive (improving)
    expect(history.trendDirection).toBeGreaterThan(0);
  });

  it('should compute trend direction correctly for degrading scores', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record degrading scores over time
    const scores = [90, 80, 70, 60, 50];
    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);

    // Trend should be negative (degrading)
    expect(history.trendDirection).toBeLessThan(0);
  });
});

// ============================================================================
// RECOMMENDATION GENERATION TESTS
// ============================================================================

describe('HealthScoreComputer - generateRecommendations', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
  });

  it('should return empty recommendations for all-healthy score', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'calibration', score: 90, status: 'healthy' }),
      createMockComponentScore({ component: 'freshness', score: 90, status: 'healthy' }),
      createMockComponentScore({ component: 'consistency', score: 90, status: 'healthy' }),
    ];
    const aggregate = computer.computeAggregateScore(components);

    const recommendations = computer.generateRecommendations(aggregate);

    expect(recommendations.length).toBe(0);
  });

  it('should generate recommendations for warning components', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'calibration', score: 70, status: 'warning' }),
    ];
    const aggregate = computer.computeAggregateScore(components);

    const recommendations = computer.generateRecommendations(aggregate);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.some((r) => r.toLowerCase().includes('calibration'))).toBe(true);
  });

  it('should generate urgent recommendations for critical components', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'freshness', score: 30, status: 'critical' }),
    ];
    const aggregate = computer.computeAggregateScore(components);

    const recommendations = computer.generateRecommendations(aggregate);

    expect(recommendations.length).toBeGreaterThan(0);
    // Critical recommendations should mention urgency or immediate action
    expect(
      recommendations.some(
        (r) =>
          r.toLowerCase().includes('critical') ||
          r.toLowerCase().includes('urgent') ||
          r.toLowerCase().includes('immediate')
      )
    ).toBe(true);
  });

  it('should prioritize critical over warning recommendations', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'calibration', score: 70, status: 'warning' }),
      createMockComponentScore({ component: 'freshness', score: 30, status: 'critical' }),
    ];
    const aggregate = computer.computeAggregateScore(components);

    const recommendations = computer.generateRecommendations(aggregate);

    // First recommendation should be about the critical component
    expect(recommendations[0].toLowerCase()).toContain('freshness');
  });

  it('should provide actionable recommendations', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({
        component: 'coverage',
        score: 40,
        status: 'critical',
        details: { coveredFiles: 40, totalFiles: 100 },
      }),
    ];
    const aggregate = computer.computeAggregateScore(components);

    const recommendations = computer.generateRecommendations(aggregate);

    // Recommendations should be actionable (contain verbs)
    expect(
      recommendations.some(
        (r) =>
          r.toLowerCase().includes('increase') ||
          r.toLowerCase().includes('improve') ||
          r.toLowerCase().includes('add') ||
          r.toLowerCase().includes('update') ||
          r.toLowerCase().includes('review')
      )
    ).toBe(true);
  });
});

// ============================================================================
// ANOMALY DETECTION TESTS
// ============================================================================

describe('HealthScoreComputer - detectAnomalies', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty anomalies for stable history', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record stable scores
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(new Date(now.getTime() - i * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: 80, weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);
    const anomalies = computer.detectAnomalies(history);

    expect(anomalies.length).toBe(0);
  });

  it('should detect sudden score drop', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record stable high scores, then sudden drop
    const scores = [85, 85, 85, 85, 40]; // Sudden drop at the end
    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);
    const anomalies = computer.detectAnomalies(history);

    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.some((a) => a.toLowerCase().includes('drop') || a.toLowerCase().includes('decrease'))).toBe(true);
  });

  it('should detect high volatility', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record highly volatile scores
    const scores = [90, 30, 85, 40, 80, 35, 90, 25];
    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);
    const anomalies = computer.detectAnomalies(history);

    expect(anomalies.length).toBeGreaterThan(0);
    expect(
      anomalies.some(
        (a) =>
          a.toLowerCase().includes('volatil') ||
          a.toLowerCase().includes('unstable') ||
          a.toLowerCase().includes('fluctuat')
      )
    ).toBe(true);
  });

  it('should detect sustained low scores', () => {
    const now = new Date('2026-01-28T12:00:00Z');

    // Record consistently low scores
    const scores = [40, 38, 42, 35, 40, 38];
    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'critical' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);
    const history = computer.getHistory(24);
    const anomalies = computer.detectAnomalies(history);

    expect(anomalies.length).toBeGreaterThan(0);
    expect(
      anomalies.some(
        (a) =>
          a.toLowerCase().includes('sustained') ||
          a.toLowerCase().includes('persistent') ||
          a.toLowerCase().includes('chronic')
      )
    ).toBe(true);
  });
});

// ============================================================================
// TREND COMPUTATION TESTS
// ============================================================================

describe('HealthScoreComputer - Trend Computation', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should determine improving trend', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    const scores = [50, 55, 60, 65, 70, 75, 80];

    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);

    // The most recent aggregate should have trend 'improving'
    const components = createFullComponentSet();
    const aggregate = computer.computeAggregateScore(components);

    // Check history trend
    const history = computer.getHistory(24);
    expect(history.trendDirection).toBeGreaterThan(0);
  });

  it('should determine stable trend', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    const scores = [75, 76, 74, 75, 76, 75, 74];

    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);

    const history = computer.getHistory(24);
    // Trend should be close to 0 (stable)
    expect(Math.abs(history.trendDirection)).toBeLessThan(5);
  });

  it('should determine degrading trend', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    const scores = [80, 75, 70, 65, 60, 55, 50];

    for (let i = 0; i < scores.length; i++) {
      vi.setSystemTime(new Date(now.getTime() - (scores.length - i - 1) * 3600000));
      const components = [
        createMockComponentScore({ component: 'a', score: scores[i], weight: 1, status: 'healthy' }),
      ];
      const score = computer.computeAggregateScore(components);
      computer.recordScore(score);
    }

    vi.setSystemTime(now);

    const history = computer.getHistory(24);
    expect(history.trendDirection).toBeLessThan(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('HealthScoreComputer - Edge Cases', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
  });

  it('should handle single component', () => {
    const components = [
      createMockComponentScore({ component: 'calibration', score: 80, weight: 1, status: 'healthy' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.overall).toBeGreaterThan(0);
    expect(aggregate.status).toBeDefined();
  });

  it('should handle all critical components', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'calibration', score: 20, status: 'critical' }),
      createMockComponentScore({ component: 'freshness', score: 15, status: 'critical' }),
      createMockComponentScore({ component: 'consistency', score: 25, status: 'critical' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.status).toBe('critical');
    expect(aggregate.overall).toBeLessThan(50);
    expect(aggregate.recommendations.length).toBeGreaterThan(0);
  });

  it('should handle components with zero weight', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 100, weight: 0, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 50, weight: 1, status: 'warning' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    // Zero weight component should not affect the score
    expect(aggregate.overall).toBeCloseTo(50, 1);
  });

  it('should handle components with equal scores', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 75, weight: 0.5, status: 'healthy' }),
      createMockComponentScore({ component: 'b', score: 75, weight: 0.5, status: 'healthy' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    // Base score is 75, with all-healthy bonus of 5% -> 78.75
    // Use wider tolerance to account for bonuses
    expect(aggregate.overall).toBeGreaterThanOrEqual(75);
    expect(aggregate.overall).toBeLessThanOrEqual(80);
  });

  it('should handle score at threshold boundary', () => {
    // Score exactly at healthy threshold
    const healthyBoundary = [
      createMockComponentScore({
        component: 'a',
        score: DEFAULT_HEALTH_SCORE_CONFIG.thresholds.healthy,
        weight: 1,
        status: 'healthy',
      }),
    ];

    const aggregateHealthy = computer.computeAggregateScore(healthyBoundary);
    expect(aggregateHealthy.status).toBe('healthy');

    // Score exactly at warning threshold
    const warningBoundary = [
      createMockComponentScore({
        component: 'a',
        score: DEFAULT_HEALTH_SCORE_CONFIG.thresholds.warning,
        weight: 1,
        status: 'warning',
      }),
    ];

    const aggregateWarning = computer.computeAggregateScore(warningBoundary);
    expect(aggregateWarning.status).toBe('warning');
  });

  it('should clamp scores to 0-100 range', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: 150, weight: 1, status: 'healthy' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.overall).toBeLessThanOrEqual(100);
  });

  it('should handle negative score values', () => {
    const components: ComponentScore[] = [
      createMockComponentScore({ component: 'a', score: -10, weight: 1, status: 'critical' }),
    ];

    const aggregate = computer.computeAggregateScore(components);

    expect(aggregate.overall).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// CUSTOM CONFIGURATION TESTS
// ============================================================================

describe('HealthScoreComputer - Custom Configuration', () => {
  it('should use custom weights', () => {
    const customConfig: HealthScoreConfig = {
      weights: {
        calibration: 0.5,
        freshness: 0.1,
        consistency: 0.1,
        coverage: 0.1,
        errorRate: 0.2,
      },
      thresholds: {
        healthy: 80,
        warning: 50,
      },
    };

    const computer = createHealthScoreComputer(customConfig);

    const calibrationMetrics = { accuracy: 0.9 };
    const calibrationScore = computer.computeComponentScore('calibration', calibrationMetrics);

    expect(calibrationScore.weight).toBe(0.5);
  });

  it('should use custom thresholds', () => {
    const customConfig: HealthScoreConfig = {
      weights: {
        calibration: 0.2,
        freshness: 0.2,
        consistency: 0.2,
        coverage: 0.2,
        errorRate: 0.2,
      },
      thresholds: {
        healthy: 90,
        warning: 70,
      },
    };

    const computer = createHealthScoreComputer(customConfig);

    // Score of 85 should be warning with custom thresholds (< 90)
    const metrics = { accuracy: 0.85 };
    const score = computer.computeComponentScore('calibration', metrics);

    expect(score.status).toBe('warning');
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('HealthScoreComputer - Integration', () => {
  let computer: HealthScoreComputer;

  beforeEach(() => {
    computer = createHealthScoreComputer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should complete full workflow: compute, record, get history, detect anomalies', () => {
    const now = new Date('2026-01-28T12:00:00Z');
    vi.setSystemTime(now);

    // Step 1: Compute component scores
    const calibrationScore = computer.computeComponentScore('calibration', {
      ece: 0.05,
      brier: 0.1,
    });
    const freshnessScore = computer.computeComponentScore('freshness', {
      staleDocs: 2,
      avgAge: 24,
    });
    const consistencyScore = computer.computeComponentScore('consistency', {
      violations: 3,
      totalChecks: 100,
    });

    // Step 2: Compute aggregate score
    const aggregate = computer.computeAggregateScore([
      calibrationScore,
      freshnessScore,
      consistencyScore,
    ]);

    expect(aggregate.overall).toBeGreaterThan(0);
    expect(aggregate.components.length).toBe(3);

    // Step 3: Record score
    computer.recordScore(aggregate);

    // Step 4: Get history
    const history = computer.getHistory(24);

    expect(history.scores.length).toBe(1);
    expect(history.averageScore).toBeCloseTo(aggregate.overall, 1);

    // Step 5: Detect anomalies (should be none with single data point)
    const anomalies = computer.detectAnomalies(history);

    expect(Array.isArray(anomalies)).toBe(true);
  });

  it('should track health evolution over time', () => {
    const baseTime = new Date('2026-01-28T00:00:00Z');

    // Simulate health evolution over 24 hours
    for (let hour = 0; hour < 24; hour++) {
      vi.setSystemTime(new Date(baseTime.getTime() + hour * 3600000));

      // Scores gradually improve
      const score = 60 + hour * 1.5;
      const components = [
        createMockComponentScore({
          component: 'calibration',
          score: Math.min(score, 95),
          weight: 0.25,
          status: score >= 80 ? 'healthy' : 'warning',
        }),
        createMockComponentScore({
          component: 'freshness',
          score: Math.min(score + 5, 95),
          weight: 0.25,
          status: score + 5 >= 80 ? 'healthy' : 'warning',
        }),
      ];

      const aggregate = computer.computeAggregateScore(components);
      computer.recordScore(aggregate);
    }

    // Set time to end of period
    vi.setSystemTime(new Date(baseTime.getTime() + 24 * 3600000));

    const history = computer.getHistory(24);

    expect(history.scores.length).toBe(24);
    expect(history.trendDirection).toBeGreaterThan(0); // Improving
    expect(history.averageScore).toBeGreaterThan(60);
  });
});
