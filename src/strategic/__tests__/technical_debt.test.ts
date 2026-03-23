import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  // Types
  type TechnicalDebtItem,
  type DebtInventory,
  type DebtSeverity,
  type ComplexityBudget,
  type CodeMetrics,
  type CheckContext,
  type DebtPreventionPolicy,
  type DebtTrend,
  type PaydownPlan,

  // Functions
  createDebtItem,
  createDebtInventory,
  calculateDebtROI,
  calculateDebtRisk,
  rankDebtByValue,
  createPaydownPlan,
  validateComplexityBudget,
  validateAgainstPolicy,
  generateDebtDashboard,
  createDebtPrioritization,
  createComplexityDetector,
  createDuplicationDetector,
  createOutdatedDependencyDetector,
  createMissingTestsDetector,

  // Constants
  DEFAULT_COMPLEXITY_BUDGET,
  STRICT_COMPLEXITY_BUDGET,
  DEFAULT_DEPENDENCY_POLICY,
  DEFAULT_PREVENTION_POLICY,
} from '../technical_debt.js';

describe('TechnicalDebtItem Creation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a debt item with minimal input', () => {
    const item = createDebtItem({
      title: 'High complexity in auth module',
      description: 'AuthController has cyclomatic complexity of 25',
      type: 'code',
      category: 'complexity',
      severity: 'high',
      principalCost: 16,
    });

    expect(item.title).toBe('High complexity in auth module');
    expect(item.type).toBe('code');
    expect(item.category).toBe('complexity');
    expect(item.severity).toBe('high');
    expect(item.principalCost).toBe(16);
    expect(item.status).toBe('identified');
    expect(item.intentional).toBe(false);
    expect(item.interestRate).toBe(1.1);
    expect(item.createdAt).toEqual(new Date('2026-01-29T12:00:00.000Z'));
    expect(item.id).toMatch(/^debt-/);
  });

  it('creates a debt item with full input', () => {
    const createdAt = new Date('2026-01-15T00:00:00.000Z');
    const item = createDebtItem({
      id: 'debt-custom-001',
      title: 'Intentional workaround for legacy API',
      description: 'Temporary fix until v2 API is ready',
      type: 'architecture',
      category: 'workaround',
      severity: 'medium',
      intentional: true,
      interestRate: 1.15,
      principalCost: 24,
      affectedFiles: ['src/api/legacy.ts', 'src/api/adapter.ts'],
      createdAt,
      discoveredBy: 'manual',
      tags: ['legacy', 'api', 'v2-migration'],
      evidence: [
        {
          type: 'manual_review',
          description: 'Identified during architecture review',
          source: 'Architecture Review 2026-01',
          collectedAt: new Date('2026-01-10T00:00:00.000Z'),
        },
      ],
    });

    expect(item.id).toBe('debt-custom-001');
    expect(item.intentional).toBe(true);
    expect(item.interestRate).toBe(1.15);
    expect(item.affectedFiles).toHaveLength(2);
    expect(item.tags).toContain('legacy');
    expect(item.evidence).toHaveLength(1);
    expect(item.createdAt).toEqual(createdAt);
  });
});

describe('DebtInventory Creation', () => {
  it('creates an empty inventory', () => {
    const inventory = createDebtInventory([]);

    expect(inventory.items).toHaveLength(0);
    expect(inventory.totalPrincipal).toBe(0);
    expect(inventory.totalInterest).toBe(0);
    expect(inventory.trend).toBe('stable');
  });

  it('calculates totals correctly', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Debt 1',
        description: 'First debt',
        type: 'code',
        category: 'complexity',
        severity: 'high',
        principalCost: 10,
        interestRate: 1.2, // 20% interest = 2 hours per sprint
      }),
      createDebtItem({
        title: 'Debt 2',
        description: 'Second debt',
        type: 'code',
        category: 'duplication',
        severity: 'medium',
        principalCost: 20,
        interestRate: 1.1, // 10% interest = 2 hours per sprint
      }),
    ];

    const inventory = createDebtInventory(items);

    expect(inventory.totalPrincipal).toBe(30);
    expect(inventory.totalInterest).toBeCloseTo(4, 5); // 2 + 2
    expect(inventory.byCategory.complexity.count).toBe(1);
    expect(inventory.byCategory.duplication.count).toBe(1);
    expect(inventory.bySeverity.high).toBe(1);
    expect(inventory.bySeverity.medium).toBe(1);
    expect(inventory.byType.code).toBe(2);
  });

  it('excludes resolved items from totals', () => {
    const resolvedItem = createDebtItem({
      title: 'Resolved Debt',
      description: 'Already fixed',
      type: 'code',
      category: 'complexity',
      severity: 'high',
      principalCost: 100,
    });
    resolvedItem.status = 'resolved';
    resolvedItem.statusHistory.push({
      from: 'in_progress',
      to: 'resolved',
      changedAt: new Date(),
      changedBy: 'developer',
    });

    const activeItem = createDebtItem({
      title: 'Active Debt',
      description: 'Still needs work',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
    });

    const inventory = createDebtInventory([resolvedItem, activeItem]);

    expect(inventory.totalPrincipal).toBe(10); // Only active item
    expect(inventory.items).toHaveLength(2); // Both still in list
  });
});

describe('ROI Calculation', () => {
  it('calculates ROI for standard debt item', () => {
    const item = createDebtItem({
      title: 'Test debt',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10, // 10 hours to fix
      interestRate: 1.2, // 20% interest per sprint = 2 hours
    });

    // Over 12 sprints: saves 2 * 12 = 24 hours of interest
    // ROI = 24 / 10 = 2.4
    const roi = calculateDebtROI(item, 12);
    expect(roi).toBeCloseTo(2.4, 1);
  });

  it('returns 0 ROI for zero principal cost', () => {
    const item = createDebtItem({
      title: 'Test debt',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'low',
      principalCost: 0,
    });

    const roi = calculateDebtROI(item);
    expect(roi).toBe(0);
  });

  it('handles different time horizons', () => {
    const item = createDebtItem({
      title: 'Test debt',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
      interestRate: 1.1, // 10% = 1 hour per sprint
    });

    const roi6 = calculateDebtROI(item, 6);
    const roi12 = calculateDebtROI(item, 12);

    expect(roi12).toBeGreaterThan(roi6);
    expect(roi6).toBeCloseTo(0.6, 1); // 6 * 1 / 10
    expect(roi12).toBeCloseTo(1.2, 1); // 12 * 1 / 10
  });
});

describe('Risk Calculation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates higher risk for critical severity', () => {
    const criticalItem = createDebtItem({
      title: 'Critical debt',
      description: 'Very bad',
      type: 'code',
      category: 'complexity',
      severity: 'critical',
      principalCost: 10,
    });

    const lowItem = createDebtItem({
      title: 'Low debt',
      description: 'Not so bad',
      type: 'code',
      category: 'complexity',
      severity: 'low',
      principalCost: 10,
    });

    const criticalRisk = calculateDebtRisk(criticalItem);
    const lowRisk = calculateDebtRisk(lowItem);

    expect(criticalRisk).toBeGreaterThan(lowRisk);
  });

  it('increases risk with more affected files', () => {
    const fewFiles = createDebtItem({
      title: 'Few files',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
      affectedFiles: ['a.ts', 'b.ts'],
    });

    const manyFiles = createDebtItem({
      title: 'Many files',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
      affectedFiles: Array(15).fill(null).map((_, i) => `file${i}.ts`),
    });

    expect(calculateDebtRisk(manyFiles)).toBeGreaterThan(
      calculateDebtRisk(fewFiles)
    );
  });

  it('increases risk for older debt', () => {
    const newDebt = createDebtItem({
      title: 'New debt',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
      createdAt: new Date('2026-01-28T12:00:00.000Z'), // 1 day old
    });

    const oldDebt = createDebtItem({
      title: 'Old debt',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 10,
      createdAt: new Date('2025-07-01T12:00:00.000Z'), // ~7 months old
    });

    expect(calculateDebtRisk(oldDebt)).toBeGreaterThan(
      calculateDebtRisk(newDebt)
    );
  });
});

describe('Debt Ranking', () => {
  it('ranks items by combined ROI and risk', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Low value',
        description: 'Low ROI, low risk',
        type: 'code',
        category: 'poor_naming',
        severity: 'low',
        principalCost: 20,
        interestRate: 1.01,
      }),
      createDebtItem({
        title: 'High value',
        description: 'High ROI, high risk',
        type: 'code',
        category: 'complexity',
        severity: 'critical',
        principalCost: 8,
        interestRate: 1.3,
      }),
      createDebtItem({
        title: 'Medium value',
        description: 'Medium ROI, medium risk',
        type: 'code',
        category: 'duplication',
        severity: 'medium',
        principalCost: 12,
        interestRate: 1.15,
      }),
    ];

    const ranked = rankDebtByValue(items);

    expect(ranked[0].title).toBe('High value');
    expect(ranked[1].title).toBe('Medium value');
    expect(ranked[2].title).toBe('Low value');
  });

  it('respects custom weight configuration', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'High ROI, low risk',
        description: 'Great ROI',
        type: 'code',
        category: 'complexity',
        severity: 'low',
        principalCost: 5,
        interestRate: 1.5,
      }),
      createDebtItem({
        title: 'Low ROI, high risk',
        description: 'High risk',
        type: 'code',
        category: 'complexity',
        severity: 'critical',
        principalCost: 50,
        interestRate: 1.05,
      }),
    ];

    // With ROI weight = 1, risk weight = 0, high ROI item should win
    const roiRanked = rankDebtByValue(items, 1.0, 0.0);
    expect(roiRanked[0].title).toBe('High ROI, low risk');

    // With ROI weight = 0, risk weight = 1, high risk item should win
    const riskRanked = rankDebtByValue(items, 0.0, 1.0);
    expect(riskRanked[0].title).toBe('Low ROI, high risk');
  });
});

describe('Paydown Scheduler', () => {
  it('creates a paydown plan within budget', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Quick win',
        description: 'Easy fix',
        type: 'code',
        category: 'complexity',
        severity: 'medium',
        principalCost: 4,
        interestRate: 1.2,
      }),
      createDebtItem({
        title: 'Big task',
        description: 'Large effort',
        type: 'architecture',
        category: 'tight_coupling',
        severity: 'high',
        principalCost: 40,
        interestRate: 1.15,
      }),
      createDebtItem({
        title: 'Medium task',
        description: 'Medium effort',
        type: 'code',
        category: 'duplication',
        severity: 'medium',
        principalCost: 12,
        interestRate: 1.1,
      }),
    ];

    const plan = createPaydownPlan(items, 20);

    expect(plan.totalHours).toBeLessThanOrEqual(20);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.expectedInterestSaved).toBeGreaterThan(0);
  });

  it('excludes already resolved items', () => {
    const resolved = createDebtItem({
      title: 'Already done',
      description: 'Fixed',
      type: 'code',
      category: 'complexity',
      severity: 'high',
      principalCost: 4,
    });
    resolved.status = 'resolved';

    const active = createDebtItem({
      title: 'Still todo',
      description: 'Needs work',
      type: 'code',
      category: 'complexity',
      severity: 'medium',
      principalCost: 8,
    });

    const plan = createPaydownPlan([resolved, active], 20);

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].item.title).toBe('Still todo');
  });

  it('handles empty item list', () => {
    const plan = createPaydownPlan([], 20);

    expect(plan.items).toHaveLength(0);
    expect(plan.totalHours).toBe(0);
    expect(plan.confidence).toBe(1.0);
  });

  it('handles budget smaller than any item', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Large task',
        description: 'Too big',
        type: 'code',
        category: 'complexity',
        severity: 'high',
        principalCost: 100,
      }),
    ];

    const plan = createPaydownPlan(items, 20);

    expect(plan.items).toHaveLength(0);
    expect(plan.totalHours).toBe(0);
  });
});

describe('Complexity Budget Validation', () => {
  it('passes when all metrics are within budget', () => {
    const metrics: CodeMetrics = {
      cyclomaticComplexity: 5,
      fileLines: 200,
      functionLines: 30,
      dependencies: 10,
      nestingDepth: 3,
      parameters: 4,
    };

    const result = validateComplexityBudget(metrics, DEFAULT_COMPLEXITY_BUDGET);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.score).toBeGreaterThan(0); // Score is calculated as percentage under budget
  });

  it('fails when metrics exceed budget', () => {
    const metrics: CodeMetrics = {
      cyclomaticComplexity: 25, // Exceeds 10
      fileLines: 600, // Exceeds 400
      functionLines: 30,
      dependencies: 10,
      nestingDepth: 3,
      parameters: 4,
    };

    const result = validateComplexityBudget(metrics, DEFAULT_COMPLEXITY_BUDGET);

    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);

    const complexityViolation = result.violations.find(
      v => v.type === 'cyclomatic_complexity'
    );
    expect(complexityViolation).toBeDefined();
    expect(complexityViolation?.actual).toBe(25);
    expect(complexityViolation?.budget).toBe(10);
  });

  it('assigns correct severity based on violation magnitude', () => {
    const metrics: CodeMetrics = {
      cyclomaticComplexity: 30, // 3x budget (critical)
      fileLines: 500, // 1.25x budget (medium)
      functionLines: 30,
      dependencies: 10,
      nestingDepth: 3,
      parameters: 4,
    };

    const result = validateComplexityBudget(metrics, DEFAULT_COMPLEXITY_BUDGET);

    const complexityViolation = result.violations.find(
      v => v.type === 'cyclomatic_complexity'
    );
    const linesViolation = result.violations.find(v => v.type === 'file_lines');

    expect(complexityViolation?.severity).toBe('critical');
    expect(linesViolation?.severity).toBe('medium');
  });

  it('uses strict budget correctly', () => {
    const metrics: CodeMetrics = {
      cyclomaticComplexity: 8, // Would pass default, fails strict
      fileLines: 250, // Would pass default, fails strict
      functionLines: 30,
      dependencies: 10,
      nestingDepth: 3,
      parameters: 4,
    };

    const defaultResult = validateComplexityBudget(
      metrics,
      DEFAULT_COMPLEXITY_BUDGET
    );
    const strictResult = validateComplexityBudget(
      metrics,
      STRICT_COMPLEXITY_BUDGET
    );

    expect(defaultResult.passed).toBe(true);
    expect(strictResult.passed).toBe(false);
  });
});

describe('Policy Validation', () => {
  it('validates against definition of done checks', async () => {
    const policy: DebtPreventionPolicy = {
      ...DEFAULT_PREVENTION_POLICY,
      definitionOfDone: [
        {
          id: 'check-1',
          name: 'Has tests',
          description: 'Must have test files',
          category: 'missing_tests',
          severity: 'blocking',
          check: async (ctx) => ({
            passed: ctx.files.some(f => f.includes('.test.')),
            message: 'Test files required',
          }),
        },
        {
          id: 'check-2',
          name: 'No large files',
          description: 'Files should not be too large',
          category: 'complexity',
          severity: 'warning',
          check: async (ctx) => ({
            passed: ctx.changes.every(c => c.additions < 500),
            message: 'Large file additions detected',
          }),
        },
      ],
    };

    const context: CheckContext = {
      files: ['src/module.ts', 'src/module.test.ts'],
      changes: [{ file: 'src/module.ts', additions: 100, deletions: 50 }],
      config: policy,
    };

    const result = await validateAgainstPolicy(context);

    expect(result.passed).toBe(true);
    expect(result.canProceed).toBe(true);
  });

  it('blocks when blocking check fails', async () => {
    const policy: DebtPreventionPolicy = {
      ...DEFAULT_PREVENTION_POLICY,
      blockOnFailure: true,
      definitionOfDone: [
        {
          id: 'check-1',
          name: 'Has tests',
          description: 'Must have test files',
          category: 'missing_tests',
          severity: 'blocking',
          check: async (ctx) => ({
            passed: ctx.files.some(f => f.includes('.test.')),
            message: 'Test files required',
          }),
        },
      ],
    };

    const context: CheckContext = {
      files: ['src/module.ts'], // No test file
      changes: [],
      config: policy,
    };

    const result = await validateAgainstPolicy(context);

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toContain('Has tests');
    expect(result.canProceed).toBe(false);
  });

  it('allows proceed with warnings', async () => {
    const policy: DebtPreventionPolicy = {
      ...DEFAULT_PREVENTION_POLICY,
      blockOnFailure: true,
      definitionOfDone: [
        {
          id: 'check-1',
          name: 'Small changes',
          description: 'Prefer small changes',
          category: 'complexity',
          severity: 'warning',
          check: async (ctx) => ({
            passed: ctx.changes.every(c => c.additions < 100),
            message: 'Large changes detected',
          }),
        },
      ],
    };

    const context: CheckContext = {
      files: ['src/module.ts'],
      changes: [{ file: 'src/module.ts', additions: 500, deletions: 0 }],
      config: policy,
    };

    const result = await validateAgainstPolicy(context);

    // Warning severity does NOT fail the check - only blocking severity does
    // The "passed" field reflects whether blocking checks failed
    // Warnings are recorded separately
    expect(result.warnings).toContain('Small changes');
    expect(result.failedChecks).toHaveLength(0); // No blocking failures
    expect(result.canProceed).toBe(true); // Can proceed despite warnings
  });
});

describe('Dashboard Generation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates dashboard from inventory', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Debt 1',
        description: 'First',
        type: 'code',
        category: 'complexity',
        severity: 'high',
        principalCost: 10,
        interestRate: 1.2,
      }),
      createDebtItem({
        title: 'Debt 2',
        description: 'Second',
        type: 'code',
        category: 'duplication',
        severity: 'medium',
        principalCost: 20,
        interestRate: 1.1,
      }),
    ];

    const inventory = createDebtInventory(items);
    const history: DebtTrend[] = [];
    const dashboard = generateDebtDashboard(inventory, history);

    expect(dashboard.summary.totalItems).toBe(2);
    expect(dashboard.summary.totalPrincipal).toBe(30);
    expect(dashboard.summary.healthScore).toBeGreaterThan(0);
    expect(dashboard.lastUpdated).toEqual(new Date('2026-01-29T12:00:00.000Z'));
  });

  it('generates critical item recommendations', () => {
    const criticalItem = createDebtItem({
      title: 'Critical debt',
      description: 'Very bad',
      type: 'code',
      category: 'complexity',
      severity: 'critical',
      principalCost: 20,
    });

    const inventory = createDebtInventory([criticalItem]);
    const dashboard = generateDebtDashboard(inventory, []);

    const criticalRec = dashboard.recommendations.find(
      r => r.id === 'address-critical'
    );
    expect(criticalRec).toBeDefined();
    expect(criticalRec?.type).toBe('immediate');
    expect(criticalRec?.priority).toBe(1);
  });

  it('detects increasing debt trend', () => {
    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'Debt 1',
        description: 'Test',
        type: 'code',
        category: 'complexity',
        severity: 'medium',
        principalCost: 10,
      }),
    ];

    const inventory = createDebtInventory(items);
    const history: DebtTrend[] = [
      {
        date: new Date('2026-01-22'),
        totalPrincipal: 50,
        totalInterest: 5,
        itemCount: 3,
        newItems: 1,
        resolvedItems: 2,
      },
      {
        date: new Date('2026-01-29'),
        totalPrincipal: 100, // 100% increase
        totalInterest: 10,
        itemCount: 6,
        newItems: 4,
        resolvedItems: 1,
      },
    ];

    const dashboard = generateDebtDashboard(inventory, history);

    const trendRec = dashboard.recommendations.find(
      r => r.id === 'control-debt-growth'
    );
    expect(trendRec).toBeDefined();
    expect(trendRec?.type).toBe('short_term');
  });
});

describe('Debt Prioritization Engine', () => {
  it('creates a prioritization engine with custom options', () => {
    const engine = createDebtPrioritization({
      roiWeight: 0.8,
      riskWeight: 0.2,
      timeHorizonSprints: 6,
    });

    const item = createDebtItem({
      title: 'Test',
      description: 'Test',
      type: 'code',
      category: 'complexity',
      severity: 'high',
      principalCost: 10,
      interestRate: 1.2,
    });

    // Engine should use 6 sprint horizon for ROI
    const roi = engine.calculateROI(item);
    const expectedROI = calculateDebtROI(item, 6);
    expect(roi).toBeCloseTo(expectedROI, 5);
  });

  it('ranks and suggests paydown order consistently', () => {
    const engine = createDebtPrioritization();

    const items: TechnicalDebtItem[] = [
      createDebtItem({
        title: 'A',
        description: 'A',
        type: 'code',
        category: 'complexity',
        severity: 'high',
        principalCost: 10,
        interestRate: 1.3,
      }),
      createDebtItem({
        title: 'B',
        description: 'B',
        type: 'code',
        category: 'complexity',
        severity: 'low',
        principalCost: 30,
        interestRate: 1.05,
      }),
    ];

    const ranked = engine.rankByValue(items);
    const plan = engine.suggestPaydownOrder(items, 50);

    // Both should prioritize the same items
    expect(ranked[0].title).toBe(plan.items[0].item.title);
  });
});

describe('Debt Detectors', () => {
  it('creates complexity detector with correct configuration', () => {
    const detector = createComplexityDetector({
      includePaths: ['src/'],
      excludePaths: ['node_modules/'],
      thresholds: { critical: 25, high: 15, medium: 10, low: 5 },
      options: {},
    });

    expect(detector.id).toBe('complexity-detector');
    expect(detector.type).toBe('complexity');
    expect(detector.confidence).toBe(0.85);
    expect(detector.enabled).toBe(true);
  });

  it('creates duplication detector', () => {
    const detector = createDuplicationDetector({
      includePaths: ['src/'],
      excludePaths: [],
      thresholds: { critical: 90, high: 70, medium: 50, low: 30 },
      options: {},
    });

    expect(detector.id).toBe('duplication-detector');
    expect(detector.type).toBe('duplication');
    expect(detector.confidence).toBe(0.90);
  });

  it('creates outdated dependency detector', () => {
    const detector = createOutdatedDependencyDetector({
      includePaths: ['./'],
      excludePaths: [],
      thresholds: { critical: 365, high: 180, medium: 90, low: 30 },
      options: {},
    });

    expect(detector.id).toBe('outdated-deps-detector');
    expect(detector.type).toBe('outdated_dependency');
    expect(detector.confidence).toBe(0.95);
  });

  it('creates missing tests detector', () => {
    const detector = createMissingTestsDetector({
      includePaths: ['src/'],
      excludePaths: ['src/__tests__/'],
      thresholds: { critical: 20, high: 50, medium: 70, low: 80 },
      options: {},
    });

    expect(detector.id).toBe('missing-tests-detector');
    expect(detector.type).toBe('missing_tests');
    expect(detector.confidence).toBe(0.80);
  });

  it('complexity detector returns no findings when the target path is missing', async () => {
    const detector = createComplexityDetector({
      includePaths: ['src/'],
      excludePaths: [],
      thresholds: { critical: 25, high: 15, medium: 10, low: 5 },
      options: {},
    });

    const results = await detector.detect('/some/path');
    expect(results).toEqual([]);
  });
});

describe('Default Configurations', () => {
  it('has sensible default complexity budget', () => {
    expect(DEFAULT_COMPLEXITY_BUDGET.maxCyclomaticComplexity).toBe(10);
    expect(DEFAULT_COMPLEXITY_BUDGET.maxFileLines).toBe(400);
    expect(DEFAULT_COMPLEXITY_BUDGET.maxFunctionLines).toBe(50);
    expect(DEFAULT_COMPLEXITY_BUDGET.maxDependencies).toBe(15);
    expect(DEFAULT_COMPLEXITY_BUDGET.maxNestingDepth).toBe(4);
    expect(DEFAULT_COMPLEXITY_BUDGET.maxParameters).toBe(5);
  });

  it('has stricter strict complexity budget', () => {
    expect(STRICT_COMPLEXITY_BUDGET.maxCyclomaticComplexity).toBeLessThan(
      DEFAULT_COMPLEXITY_BUDGET.maxCyclomaticComplexity
    );
    expect(STRICT_COMPLEXITY_BUDGET.maxFileLines).toBeLessThan(
      DEFAULT_COMPLEXITY_BUDGET.maxFileLines
    );
  });

  it('has sensible default dependency policy', () => {
    expect(DEFAULT_DEPENDENCY_POLICY.checkFrequency).toBe('weekly');
    expect(DEFAULT_DEPENDENCY_POLICY.maxDependencyAge).toBe(365);
    expect(DEFAULT_DEPENDENCY_POLICY.allowedLicenses).toContain('MIT');
  });

  it('has sensible default prevention policy', () => {
    expect(DEFAULT_PREVENTION_POLICY.blockOnFailure).toBe(false);
    expect(DEFAULT_PREVENTION_POLICY.gracePeriodHours).toBe(24);
  });
});
