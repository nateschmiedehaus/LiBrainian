/**
 * @fileoverview Testing Strategy Framework
 *
 * A comprehensive testing strategy framework for world-class software.
 * Provides configuration, validation, gap analysis, and quality reporting
 * for the testing pyramid across unit, integration, E2E, and specialized tests.
 *
 * Key components:
 * - Testing Pyramid Configuration
 * - Specialized Testing (security, accessibility, performance, mutation)
 * - Test Infrastructure (CI, flaky test management, environments)
 * - Test Quality Metrics
 * - Strategy Validator
 * - Coverage Gap Analyzer
 * - Test Quality Reporter
 * - Preset Configurations (COMPREHENSIVE, BALANCED, MINIMAL)
 *
 * @packageDocumentation
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Performance baseline for E2E testing.
 */
export interface PerformanceBaseline {
  name: string;
  metric: 'latency' | 'throughput' | 'memory' | 'cpu' | 'custom';
  threshold: number;
  unit: string;
  percentile?: number;
  degradationTolerance?: number;
}

/**
 * Unit testing configuration in the testing pyramid.
 */
export interface UnitTestingConfig {
  /** Coverage target as decimal (e.g., 0.90 for 90%) */
  coverageTarget: number;
  /** Whether tests must be fully isolated (no shared state) */
  isolationRequired: boolean;
  /** Guidelines for mocking external dependencies */
  mockingGuidelines: string[];
  /** Whether property-based testing is required for critical functions */
  propertyBasedTestingRequired: boolean;
  /** Naming convention pattern for test files/functions */
  namingConvention: string;
  /** Minimum test execution speed requirements */
  maxExecutionTimeMs?: number;
  /** Required assertion patterns */
  assertionPatterns?: string[];
}

/**
 * Integration testing configuration in the testing pyramid.
 */
export interface IntegrationTestingConfig {
  /** Coverage target as decimal */
  coverageTarget: number;
  /** Whether contract testing between services is required */
  contractTestingRequired: boolean;
  /** Strategy for test data management */
  testDataManagement: 'fixtures' | 'factories' | 'snapshots';
  /** Strategy for handling external services */
  externalServiceStrategy: 'mock' | 'stub' | 'container';
  /** Required boundary tests */
  boundaryTests?: string[];
  /** Database testing strategy */
  databaseStrategy?: 'in-memory' | 'container' | 'dedicated';
}

/**
 * End-to-end testing configuration in the testing pyramid.
 */
export interface E2ETestingConfig {
  /** Target coverage for critical user paths */
  criticalPathCoverage: number;
  /** List of required user journey tests */
  userJourneyTests: string[];
  /** Performance baselines that must be maintained */
  performanceBaselines: PerformanceBaseline[];
  /** Whether chaos testing is enabled */
  chaosTestingEnabled: boolean;
  /** Browser/device coverage requirements */
  browserCoverage?: string[];
  /** Maximum acceptable flakiness rate */
  maxFlakinessRate?: number;
}

/**
 * Security testing configuration.
 */
export interface SecurityTestingConfig {
  /** Static Application Security Testing enabled */
  sastEnabled: boolean;
  /** Dynamic Application Security Testing enabled */
  dastEnabled: boolean;
  /** Dependency vulnerability scanning enabled */
  dependencyScanEnabled: boolean;
  /** Frequency of penetration testing */
  penetrationTestFrequency: 'sprint' | 'release' | 'quarterly';
  /** Secret scanning enabled */
  secretScanningEnabled?: boolean;
  /** Container scanning enabled */
  containerScanningEnabled?: boolean;
  /** Required security compliance standards */
  complianceStandards?: string[];
}

/**
 * Accessibility testing configuration.
 */
export interface AccessibilityConfig {
  /** WCAG compliance level target */
  wcagLevel: 'A' | 'AA' | 'AAA';
  /** Automated accessibility testing enabled */
  automatedTestingEnabled: boolean;
  /** Manual accessibility audit frequency */
  manualAuditFrequency: 'sprint' | 'release' | 'quarterly';
  /** Screen reader testing required */
  screenReaderTestingRequired: boolean;
  /** Keyboard navigation testing required */
  keyboardNavigationRequired: boolean;
  /** Color contrast ratio requirements */
  colorContrastRatio?: number;
}

/**
 * Performance testing configuration.
 */
export interface PerformanceTestingConfig {
  /** Load testing enabled */
  loadTestingEnabled: boolean;
  /** Stress testing enabled */
  stressTestingEnabled: boolean;
  /** Soak testing (endurance) enabled */
  soakTestingEnabled: boolean;
  /** Performance regression threshold (percentage) */
  regressionThreshold: number;
  /** Baseline comparison enabled */
  baselineComparisonEnabled: boolean;
  /** Target percentiles to measure */
  targetPercentiles?: number[];
  /** Required SLA definitions */
  slaDefinitions?: SLADefinition[];
}

/**
 * Service Level Agreement definition for performance.
 */
export interface SLADefinition {
  name: string;
  metric: string;
  target: number;
  unit: string;
  percentile?: number;
}

/**
 * Mutation testing configuration.
 */
export interface MutationTestingConfig {
  /** Mutation testing enabled */
  enabled: boolean;
  /** Minimum mutation score target */
  scoreTarget: number;
  /** Mutation operators to use */
  operators: MutationOperator[];
  /** Files/patterns to exclude from mutation */
  excludePatterns: string[];
  /** Timeout multiplier for mutant execution */
  timeoutMultiplier?: number;
}

/**
 * Types of mutation operators.
 */
export type MutationOperator =
  | 'conditionalBoundary'
  | 'negateConditional'
  | 'math'
  | 'increments'
  | 'invertNegatives'
  | 'returnValues'
  | 'voidMethodCalls'
  | 'emptyReturns'
  | 'falseReturns'
  | 'trueReturns'
  | 'nullReturns';

/**
 * Specialized testing configuration combining all specialized test types.
 */
export interface SpecializedTestingConfig {
  security: SecurityTestingConfig;
  accessibility: AccessibilityConfig;
  performance: PerformanceTestingConfig;
  mutation: MutationTestingConfig;
}

/**
 * Complete testing pyramid configuration.
 */
export interface TestingPyramid {
  unit: UnitTestingConfig;
  integration: IntegrationTestingConfig;
  e2e: E2ETestingConfig;
  specialized: SpecializedTestingConfig;
}

// ============================================================================
// TEST INFRASTRUCTURE TYPES
// ============================================================================

/**
 * CI/CD integration configuration.
 */
export interface CIConfig {
  /** CI provider name */
  provider: 'github-actions' | 'gitlab-ci' | 'jenkins' | 'circleci' | 'custom';
  /** Parallel test execution enabled */
  parallelExecutionEnabled: boolean;
  /** Test splitting strategy */
  testSplittingStrategy: 'timing' | 'count' | 'none';
  /** Cache test artifacts */
  cacheEnabled: boolean;
  /** Fail fast on first failure */
  failFastEnabled: boolean;
  /** Required checks before merge */
  requiredChecks: string[];
}

/**
 * Flaky test management configuration.
 */
export interface FlakyTestConfig {
  /** Automatic detection of flaky tests */
  detectionEnabled: boolean;
  /** Automatic quarantine of flaky tests */
  quarantineEnabled: boolean;
  /** Maximum retries for potentially flaky tests */
  maxRetries: number;
  /** Threshold for reporting flakiness (percentage) */
  reportingThreshold: number;
  /** Auto-disable threshold (consecutive failures) */
  autoDisableThreshold?: number;
  /** Notification channels for flaky test alerts */
  notificationChannels?: string[];
}

/**
 * Test environment definition.
 */
export interface TestEnvironment {
  name: string;
  type: 'local' | 'ci' | 'staging' | 'preview' | 'production-like';
  /** Environment-specific configuration overrides */
  configOverrides?: Record<string, unknown>;
  /** Required services/dependencies */
  requiredServices?: string[];
  /** Data seeding strategy */
  dataSeedingStrategy?: 'minimal' | 'realistic' | 'production-clone';
  /** Cleanup strategy */
  cleanupStrategy?: 'after-each' | 'after-suite' | 'manual';
}

/**
 * Complete test infrastructure configuration.
 */
export interface TestInfrastructure {
  ciIntegration: CIConfig;
  flakyTestManagement: FlakyTestConfig;
  testEnvironments: TestEnvironment[];
  analyticsEnabled: boolean;
  /** Test results retention period in days */
  retentionDays?: number;
  /** Test artifact storage configuration */
  artifactStorage?: ArtifactStorageConfig;
}

/**
 * Test artifact storage configuration.
 */
export interface ArtifactStorageConfig {
  enabled: boolean;
  provider: 'local' | 's3' | 'gcs' | 'azure-blob';
  retentionDays: number;
  compressArtifacts: boolean;
}

// ============================================================================
// TEST QUALITY METRICS
// ============================================================================

/**
 * Execution time distribution metrics.
 */
export interface ExecutionTimeMetrics {
  /** 50th percentile execution time in ms */
  p50: number;
  /** 99th percentile execution time in ms */
  p99: number;
  /** Average execution time in ms */
  average?: number;
  /** Maximum execution time in ms */
  max?: number;
}

/**
 * Comprehensive test quality metrics.
 */
export interface TestQualityMetrics {
  /** Code coverage percentage (0-1) */
  coverage: number;
  /** Mutation testing score (0-1) */
  mutationScore: number;
  /** Flaky test rate (0-1) */
  flakyRate: number;
  /** Execution time percentiles */
  executionTime: ExecutionTimeMetrics;
  /** Maintenance burden score (0-1, lower is better) */
  maintenanceBurden: number;
  /** Test-to-code ratio */
  testToCodeRatio?: number;
  /** Average test complexity */
  averageTestComplexity?: number;
  /** Defect escape rate */
  defectEscapeRate?: number;
}

// ============================================================================
// COMPLETE TESTING STRATEGY
// ============================================================================

/**
 * Complete testing strategy configuration.
 */
export interface TestingStrategy {
  id: string;
  name: string;
  description: string;
  pyramid: TestingPyramid;
  infrastructure: TestInfrastructure;
  qualityTargets: TestQualityMetrics;
  metadata: TestingStrategyMetadata;
}

/**
 * Metadata for a testing strategy.
 */
export interface TestingStrategyMetadata {
  version: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Severity levels for validation issues.
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Individual validation issue.
 */
export interface ValidationIssue {
  path: string;
  message: string;
  severity: ValidationSeverity;
  code: string;
  suggestion?: string;
}

/**
 * Result of strategy validation.
 */
export interface StrategyValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}

/**
 * Summary of validation results.
 */
export interface ValidationSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  checkedAt: string;
}

// ============================================================================
// COVERAGE GAP ANALYSIS TYPES
// ============================================================================

/**
 * Severity of a coverage gap.
 */
export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Individual coverage gap identified.
 */
export interface CoverageGap {
  area: string;
  currentCoverage: number;
  targetCoverage: number;
  gap: number;
  severity: GapSeverity;
  recommendation: string;
  estimatedEffort: 'low' | 'medium' | 'high';
}

/**
 * Result of coverage gap analysis.
 */
export interface CoverageGapAnalysis {
  gaps: CoverageGap[];
  overallScore: number;
  prioritizedActions: PrioritizedAction[];
  analyzedAt: string;
}

/**
 * Prioritized action to address coverage gaps.
 */
export interface PrioritizedAction {
  priority: number;
  action: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  affectedGaps: string[];
}

// ============================================================================
// QUALITY REPORT TYPES
// ============================================================================

/**
 * Trend direction for metrics.
 */
export type TrendDirection = 'improving' | 'stable' | 'degrading';

/**
 * Individual metric trend data.
 */
export interface MetricTrend {
  metric: string;
  currentValue: number;
  previousValue: number;
  change: number;
  direction: TrendDirection;
}

/**
 * Test category statistics.
 */
export interface TestCategoryStats {
  category: string;
  totalTests: number;
  passingTests: number;
  failingTests: number;
  skippedTests: number;
  flakyTests: number;
  averageExecutionTimeMs: number;
}

/**
 * Complete test quality report.
 */
export interface TestQualityReport {
  strategy: TestingStrategy;
  currentMetrics: TestQualityMetrics;
  trends: MetricTrend[];
  categoryStats: TestCategoryStats[];
  recommendations: ReportRecommendation[];
  generatedAt: string;
}

/**
 * Recommendation in a quality report.
 */
export interface ReportRecommendation {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'coverage' | 'performance' | 'reliability' | 'maintenance';
  actionItems: string[];
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * COMPREHENSIVE preset: Maximum quality and coverage.
 * Use for mission-critical systems, financial applications, healthcare.
 */
export const COMPREHENSIVE_PRESET: TestingPyramid = {
  unit: {
    coverageTarget: 0.95,
    isolationRequired: true,
    mockingGuidelines: [
      'Mock all external dependencies',
      'Use dependency injection for testability',
      'Avoid mocking internal modules',
      'Prefer fakes over mocks for complex interactions',
    ],
    propertyBasedTestingRequired: true,
    namingConvention: 'describe_when_should',
    maxExecutionTimeMs: 100,
    assertionPatterns: ['expect', 'assert', 'should'],
  },
  integration: {
    coverageTarget: 0.85,
    contractTestingRequired: true,
    testDataManagement: 'factories',
    externalServiceStrategy: 'container',
    boundaryTests: ['API boundaries', 'Database boundaries', 'External service boundaries'],
    databaseStrategy: 'container',
  },
  e2e: {
    criticalPathCoverage: 0.95,
    userJourneyTests: [
      'User registration and onboarding',
      'Core business workflow',
      'Payment and checkout',
      'Account management',
      'Error recovery paths',
    ],
    performanceBaselines: [
      { name: 'Page Load', metric: 'latency', threshold: 2000, unit: 'ms', percentile: 95 },
      { name: 'API Response', metric: 'latency', threshold: 200, unit: 'ms', percentile: 99 },
      { name: 'Memory Usage', metric: 'memory', threshold: 512, unit: 'MB' },
    ],
    chaosTestingEnabled: true,
    browserCoverage: ['Chrome', 'Firefox', 'Safari', 'Edge'],
    maxFlakinessRate: 0.01,
  },
  specialized: {
    security: {
      sastEnabled: true,
      dastEnabled: true,
      dependencyScanEnabled: true,
      penetrationTestFrequency: 'sprint',
      secretScanningEnabled: true,
      containerScanningEnabled: true,
      complianceStandards: ['OWASP Top 10', 'SOC 2', 'PCI-DSS'],
    },
    accessibility: {
      wcagLevel: 'AAA',
      automatedTestingEnabled: true,
      manualAuditFrequency: 'sprint',
      screenReaderTestingRequired: true,
      keyboardNavigationRequired: true,
      colorContrastRatio: 7,
    },
    performance: {
      loadTestingEnabled: true,
      stressTestingEnabled: true,
      soakTestingEnabled: true,
      regressionThreshold: 5,
      baselineComparisonEnabled: true,
      targetPercentiles: [50, 90, 95, 99],
      slaDefinitions: [
        { name: 'API Latency', metric: 'response_time', target: 100, unit: 'ms', percentile: 99 },
        { name: 'Availability', metric: 'uptime', target: 99.99, unit: '%' },
      ],
    },
    mutation: {
      enabled: true,
      scoreTarget: 0.85,
      operators: [
        'conditionalBoundary',
        'negateConditional',
        'math',
        'increments',
        'returnValues',
        'voidMethodCalls',
      ],
      excludePatterns: ['**/*.test.ts', '**/generated/**'],
      timeoutMultiplier: 2,
    },
  },
};

/**
 * BALANCED preset: Good coverage with reasonable effort.
 * Use for most production applications.
 */
export const BALANCED_PRESET: TestingPyramid = {
  unit: {
    coverageTarget: 0.80,
    isolationRequired: true,
    mockingGuidelines: [
      'Mock external dependencies',
      'Use dependency injection',
      'Avoid excessive mocking',
    ],
    propertyBasedTestingRequired: false,
    namingConvention: 'describe_it',
    maxExecutionTimeMs: 200,
  },
  integration: {
    coverageTarget: 0.70,
    contractTestingRequired: false,
    testDataManagement: 'fixtures',
    externalServiceStrategy: 'stub',
    databaseStrategy: 'in-memory',
  },
  e2e: {
    criticalPathCoverage: 0.80,
    userJourneyTests: [
      'User registration',
      'Core business workflow',
      'Error handling',
    ],
    performanceBaselines: [
      { name: 'Page Load', metric: 'latency', threshold: 3000, unit: 'ms', percentile: 95 },
      { name: 'API Response', metric: 'latency', threshold: 500, unit: 'ms', percentile: 95 },
    ],
    chaosTestingEnabled: false,
    browserCoverage: ['Chrome', 'Firefox'],
    maxFlakinessRate: 0.03,
  },
  specialized: {
    security: {
      sastEnabled: true,
      dastEnabled: false,
      dependencyScanEnabled: true,
      penetrationTestFrequency: 'release',
      secretScanningEnabled: true,
    },
    accessibility: {
      wcagLevel: 'AA',
      automatedTestingEnabled: true,
      manualAuditFrequency: 'release',
      screenReaderTestingRequired: false,
      keyboardNavigationRequired: true,
    },
    performance: {
      loadTestingEnabled: true,
      stressTestingEnabled: false,
      soakTestingEnabled: false,
      regressionThreshold: 10,
      baselineComparisonEnabled: true,
      targetPercentiles: [50, 95],
    },
    mutation: {
      enabled: false,
      scoreTarget: 0.60,
      operators: ['conditionalBoundary', 'negateConditional', 'returnValues'],
      excludePatterns: ['**/*.test.ts'],
    },
  },
};

/**
 * MINIMAL preset: Basic coverage for rapid development.
 * Use for prototypes, MVPs, or internal tools.
 */
export const MINIMAL_PRESET: TestingPyramid = {
  unit: {
    coverageTarget: 0.60,
    isolationRequired: false,
    mockingGuidelines: ['Mock external APIs'],
    propertyBasedTestingRequired: false,
    namingConvention: 'test_description',
    maxExecutionTimeMs: 500,
  },
  integration: {
    coverageTarget: 0.50,
    contractTestingRequired: false,
    testDataManagement: 'fixtures',
    externalServiceStrategy: 'mock',
    databaseStrategy: 'in-memory',
  },
  e2e: {
    criticalPathCoverage: 0.50,
    userJourneyTests: ['Happy path only'],
    performanceBaselines: [
      { name: 'Page Load', metric: 'latency', threshold: 5000, unit: 'ms' },
    ],
    chaosTestingEnabled: false,
    maxFlakinessRate: 0.05,
  },
  specialized: {
    security: {
      sastEnabled: false,
      dastEnabled: false,
      dependencyScanEnabled: true,
      penetrationTestFrequency: 'quarterly',
    },
    accessibility: {
      wcagLevel: 'A',
      automatedTestingEnabled: false,
      manualAuditFrequency: 'quarterly',
      screenReaderTestingRequired: false,
      keyboardNavigationRequired: false,
    },
    performance: {
      loadTestingEnabled: false,
      stressTestingEnabled: false,
      soakTestingEnabled: false,
      regressionThreshold: 20,
      baselineComparisonEnabled: false,
    },
    mutation: {
      enabled: false,
      scoreTarget: 0.40,
      operators: [],
      excludePatterns: ['**/*'],
    },
  },
};

/**
 * Default test infrastructure configuration.
 */
export const DEFAULT_TEST_INFRASTRUCTURE: TestInfrastructure = {
  ciIntegration: {
    provider: 'github-actions',
    parallelExecutionEnabled: true,
    testSplittingStrategy: 'timing',
    cacheEnabled: true,
    failFastEnabled: false,
    requiredChecks: ['unit-tests', 'integration-tests', 'lint'],
  },
  flakyTestManagement: {
    detectionEnabled: true,
    quarantineEnabled: true,
    maxRetries: 3,
    reportingThreshold: 0.05,
    autoDisableThreshold: 5,
  },
  testEnvironments: [
    {
      name: 'local',
      type: 'local',
      cleanupStrategy: 'after-each',
    },
    {
      name: 'ci',
      type: 'ci',
      cleanupStrategy: 'after-suite',
    },
  ],
  analyticsEnabled: true,
  retentionDays: 90,
};

/**
 * Default quality targets.
 */
export const DEFAULT_QUALITY_TARGETS: TestQualityMetrics = {
  coverage: 0.80,
  mutationScore: 0.60,
  flakyRate: 0.02,
  executionTime: {
    p50: 30000,
    p99: 120000,
  },
  maintenanceBurden: 0.15,
  testToCodeRatio: 1.5,
};

// ============================================================================
// STRATEGY VALIDATOR
// ============================================================================

/**
 * Validates a testing strategy configuration.
 */
export function validateStrategy(strategy: TestingStrategy): StrategyValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate pyramid configuration
  validatePyramid(strategy.pyramid, issues);

  // Validate infrastructure configuration
  validateInfrastructure(strategy.infrastructure, issues);

  // Validate quality targets
  validateQualityTargets(strategy.qualityTargets, issues);

  // Validate metadata
  validateMetadata(strategy.metadata, issues);

  // Cross-cutting validations
  validateCrossCuttingConcerns(strategy, issues);

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;

  return {
    valid: errorCount === 0,
    issues,
    summary: {
      errorCount,
      warningCount,
      infoCount,
      checkedAt: new Date().toISOString(),
    },
  };
}

function validatePyramid(pyramid: TestingPyramid, issues: ValidationIssue[]): void {
  // Unit testing validations
  if (pyramid.unit.coverageTarget < 0 || pyramid.unit.coverageTarget > 1) {
    issues.push({
      path: 'pyramid.unit.coverageTarget',
      message: 'Coverage target must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_COVERAGE_TARGET',
    });
  }

  if (pyramid.unit.coverageTarget < 0.5) {
    issues.push({
      path: 'pyramid.unit.coverageTarget',
      message: 'Unit test coverage target below 50% may indicate insufficient testing',
      severity: 'warning',
      code: 'LOW_COVERAGE_TARGET',
      suggestion: 'Consider increasing unit test coverage target to at least 60%',
    });
  }

  // Integration testing validations
  if (pyramid.integration.coverageTarget < 0 || pyramid.integration.coverageTarget > 1) {
    issues.push({
      path: 'pyramid.integration.coverageTarget',
      message: 'Coverage target must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_COVERAGE_TARGET',
    });
  }

  // E2E testing validations
  if (pyramid.e2e.criticalPathCoverage < 0 || pyramid.e2e.criticalPathCoverage > 1) {
    issues.push({
      path: 'pyramid.e2e.criticalPathCoverage',
      message: 'Critical path coverage must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_COVERAGE_TARGET',
    });
  }

  if (pyramid.e2e.userJourneyTests.length === 0) {
    issues.push({
      path: 'pyramid.e2e.userJourneyTests',
      message: 'At least one user journey test should be defined',
      severity: 'warning',
      code: 'MISSING_USER_JOURNEYS',
      suggestion: 'Define critical user journey tests for E2E coverage',
    });
  }

  // Mutation testing validations
  if (pyramid.specialized.mutation.enabled) {
    if (pyramid.specialized.mutation.scoreTarget < 0 || pyramid.specialized.mutation.scoreTarget > 1) {
      issues.push({
        path: 'pyramid.specialized.mutation.scoreTarget',
        message: 'Mutation score target must be between 0 and 1',
        severity: 'error',
        code: 'INVALID_MUTATION_SCORE',
      });
    }

    if (pyramid.specialized.mutation.operators.length === 0) {
      issues.push({
        path: 'pyramid.specialized.mutation.operators',
        message: 'No mutation operators specified',
        severity: 'error',
        code: 'MISSING_MUTATION_OPERATORS',
      });
    }
  }

  // Security testing validations
  const security = pyramid.specialized.security;
  if (!security.sastEnabled && !security.dastEnabled && !security.dependencyScanEnabled) {
    issues.push({
      path: 'pyramid.specialized.security',
      message: 'No security testing enabled',
      severity: 'warning',
      code: 'NO_SECURITY_TESTING',
      suggestion: 'Enable at least dependency scanning for basic security coverage',
    });
  }

  // Accessibility validations
  const accessibility = pyramid.specialized.accessibility;
  if (accessibility.wcagLevel === 'AAA' && !accessibility.manualAuditFrequency) {
    issues.push({
      path: 'pyramid.specialized.accessibility',
      message: 'WCAG AAA compliance typically requires manual audits',
      severity: 'info',
      code: 'AAA_WITHOUT_MANUAL_AUDIT',
      suggestion: 'Consider adding manual accessibility audits',
    });
  }
}

function validateInfrastructure(infrastructure: TestInfrastructure, issues: ValidationIssue[]): void {
  // Flaky test configuration
  if (infrastructure.flakyTestManagement.maxRetries < 0) {
    issues.push({
      path: 'infrastructure.flakyTestManagement.maxRetries',
      message: 'Max retries cannot be negative',
      severity: 'error',
      code: 'INVALID_MAX_RETRIES',
    });
  }

  if (infrastructure.flakyTestManagement.maxRetries > 5) {
    issues.push({
      path: 'infrastructure.flakyTestManagement.maxRetries',
      message: 'High retry count may mask flaky tests',
      severity: 'warning',
      code: 'HIGH_RETRY_COUNT',
      suggestion: 'Consider limiting retries to 3 and fixing underlying flakiness',
    });
  }

  if (infrastructure.flakyTestManagement.reportingThreshold < 0 ||
      infrastructure.flakyTestManagement.reportingThreshold > 1) {
    issues.push({
      path: 'infrastructure.flakyTestManagement.reportingThreshold',
      message: 'Reporting threshold must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_THRESHOLD',
    });
  }

  // Environment validations
  if (infrastructure.testEnvironments.length === 0) {
    issues.push({
      path: 'infrastructure.testEnvironments',
      message: 'At least one test environment should be defined',
      severity: 'error',
      code: 'NO_ENVIRONMENTS',
    });
  }

  const envNames = infrastructure.testEnvironments.map(e => e.name);
  const duplicates = envNames.filter((name, index) => envNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    issues.push({
      path: 'infrastructure.testEnvironments',
      message: `Duplicate environment names: ${duplicates.join(', ')}`,
      severity: 'error',
      code: 'DUPLICATE_ENVIRONMENTS',
    });
  }

  // CI integration validations
  if (infrastructure.ciIntegration.requiredChecks.length === 0) {
    issues.push({
      path: 'infrastructure.ciIntegration.requiredChecks',
      message: 'No required checks defined for CI',
      severity: 'warning',
      code: 'NO_REQUIRED_CHECKS',
      suggestion: 'Define required checks to enforce quality gates',
    });
  }
}

function validateQualityTargets(targets: TestQualityMetrics, issues: ValidationIssue[]): void {
  if (targets.coverage < 0 || targets.coverage > 1) {
    issues.push({
      path: 'qualityTargets.coverage',
      message: 'Coverage must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_COVERAGE',
    });
  }

  if (targets.mutationScore < 0 || targets.mutationScore > 1) {
    issues.push({
      path: 'qualityTargets.mutationScore',
      message: 'Mutation score must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_MUTATION_SCORE',
    });
  }

  if (targets.flakyRate < 0 || targets.flakyRate > 1) {
    issues.push({
      path: 'qualityTargets.flakyRate',
      message: 'Flaky rate must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_FLAKY_RATE',
    });
  }

  if (targets.flakyRate > 0.05) {
    issues.push({
      path: 'qualityTargets.flakyRate',
      message: 'Flaky rate target above 5% is considered high',
      severity: 'warning',
      code: 'HIGH_FLAKY_RATE_TARGET',
      suggestion: 'Aim for flaky rate below 3%',
    });
  }

  if (targets.maintenanceBurden < 0 || targets.maintenanceBurden > 1) {
    issues.push({
      path: 'qualityTargets.maintenanceBurden',
      message: 'Maintenance burden must be between 0 and 1',
      severity: 'error',
      code: 'INVALID_MAINTENANCE_BURDEN',
    });
  }

  if (targets.executionTime.p50 > targets.executionTime.p99) {
    issues.push({
      path: 'qualityTargets.executionTime',
      message: 'P50 execution time cannot be greater than P99',
      severity: 'error',
      code: 'INVALID_PERCENTILES',
    });
  }
}

function validateMetadata(metadata: TestingStrategyMetadata, issues: ValidationIssue[]): void {
  if (!metadata.version || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    issues.push({
      path: 'metadata.version',
      message: 'Version should follow semantic versioning (e.g., 1.0.0)',
      severity: 'warning',
      code: 'INVALID_VERSION_FORMAT',
    });
  }

  const createdDate = new Date(metadata.createdAt);
  if (isNaN(createdDate.getTime())) {
    issues.push({
      path: 'metadata.createdAt',
      message: 'Invalid createdAt date format',
      severity: 'error',
      code: 'INVALID_DATE',
    });
  }

  const updatedDate = new Date(metadata.updatedAt);
  if (isNaN(updatedDate.getTime())) {
    issues.push({
      path: 'metadata.updatedAt',
      message: 'Invalid updatedAt date format',
      severity: 'error',
      code: 'INVALID_DATE',
    });
  }

  if (createdDate > updatedDate) {
    issues.push({
      path: 'metadata',
      message: 'createdAt cannot be after updatedAt',
      severity: 'error',
      code: 'INVALID_DATE_ORDER',
    });
  }
}

function validateCrossCuttingConcerns(strategy: TestingStrategy, issues: ValidationIssue[]): void {
  // Quality targets should align with pyramid configuration
  if (strategy.qualityTargets.coverage > strategy.pyramid.unit.coverageTarget) {
    issues.push({
      path: 'qualityTargets.coverage',
      message: 'Overall coverage target exceeds unit test coverage target',
      severity: 'warning',
      code: 'MISALIGNED_COVERAGE_TARGETS',
      suggestion: 'Align quality targets with pyramid configuration',
    });
  }

  // Mutation testing alignment
  if (strategy.pyramid.specialized.mutation.enabled &&
      strategy.qualityTargets.mutationScore > strategy.pyramid.specialized.mutation.scoreTarget) {
    issues.push({
      path: 'qualityTargets.mutationScore',
      message: 'Quality target mutation score exceeds mutation testing configuration',
      severity: 'warning',
      code: 'MISALIGNED_MUTATION_TARGETS',
    });
  }

  // Flaky rate alignment
  const e2eMaxFlakiness = strategy.pyramid.e2e.maxFlakinessRate ?? 0.05;
  if (strategy.qualityTargets.flakyRate > e2eMaxFlakiness) {
    issues.push({
      path: 'qualityTargets.flakyRate',
      message: 'Quality target flaky rate exceeds E2E max flakiness rate',
      severity: 'warning',
      code: 'MISALIGNED_FLAKY_RATES',
    });
  }
}

// ============================================================================
// COVERAGE GAP ANALYZER
// ============================================================================

/**
 * Analyzes coverage gaps in a testing strategy against current metrics.
 */
export function analyzeCoverageGaps(
  strategy: TestingStrategy,
  currentMetrics: TestQualityMetrics
): CoverageGapAnalysis {
  const gaps: CoverageGap[] = [];

  // Analyze unit test coverage gap
  const unitGap = strategy.pyramid.unit.coverageTarget - currentMetrics.coverage;
  if (unitGap > 0) {
    gaps.push({
      area: 'Unit Test Coverage',
      currentCoverage: currentMetrics.coverage,
      targetCoverage: strategy.pyramid.unit.coverageTarget,
      gap: unitGap,
      severity: categorizeGapSeverity(unitGap),
      recommendation: generateCoverageRecommendation('unit', unitGap),
      estimatedEffort: estimateEffort(unitGap),
    });
  }

  // Analyze mutation score gap
  if (strategy.pyramid.specialized.mutation.enabled) {
    const mutationGap = strategy.pyramid.specialized.mutation.scoreTarget - currentMetrics.mutationScore;
    if (mutationGap > 0) {
      gaps.push({
        area: 'Mutation Testing Score',
        currentCoverage: currentMetrics.mutationScore,
        targetCoverage: strategy.pyramid.specialized.mutation.scoreTarget,
        gap: mutationGap,
        severity: categorizeGapSeverity(mutationGap),
        recommendation: generateCoverageRecommendation('mutation', mutationGap),
        estimatedEffort: estimateEffort(mutationGap * 1.5), // Mutation testing typically requires more effort
      });
    }
  }

  // Analyze flaky rate gap (inverted - lower is better)
  const flakyRateGap = currentMetrics.flakyRate - strategy.qualityTargets.flakyRate;
  if (flakyRateGap > 0) {
    gaps.push({
      area: 'Flaky Test Rate',
      currentCoverage: currentMetrics.flakyRate,
      targetCoverage: strategy.qualityTargets.flakyRate,
      gap: flakyRateGap,
      severity: categorizeGapSeverity(flakyRateGap * 2), // Flakiness is more impactful
      recommendation: 'Investigate and fix flaky tests. Consider using retry mechanisms temporarily.',
      estimatedEffort: estimateEffort(flakyRateGap * 3),
    });
  }

  // Analyze maintenance burden gap (inverted - lower is better)
  const maintenanceGap = currentMetrics.maintenanceBurden - strategy.qualityTargets.maintenanceBurden;
  if (maintenanceGap > 0) {
    gaps.push({
      area: 'Test Maintenance Burden',
      currentCoverage: currentMetrics.maintenanceBurden,
      targetCoverage: strategy.qualityTargets.maintenanceBurden,
      gap: maintenanceGap,
      severity: categorizeGapSeverity(maintenanceGap),
      recommendation: 'Refactor complex tests, improve test isolation, and reduce test duplication.',
      estimatedEffort: estimateEffort(maintenanceGap * 2),
    });
  }

  // Analyze execution time gaps
  if (currentMetrics.executionTime.p99 > strategy.qualityTargets.executionTime.p99) {
    const timeGap = (currentMetrics.executionTime.p99 - strategy.qualityTargets.executionTime.p99) /
                    strategy.qualityTargets.executionTime.p99;
    gaps.push({
      area: 'Test Execution Time (P99)',
      currentCoverage: currentMetrics.executionTime.p99,
      targetCoverage: strategy.qualityTargets.executionTime.p99,
      gap: timeGap,
      severity: categorizeGapSeverity(timeGap * 0.5),
      recommendation: 'Optimize slow tests, parallelize execution, and consider test splitting.',
      estimatedEffort: estimateEffort(timeGap),
    });
  }

  // Calculate overall score (0-100)
  const overallScore = calculateOverallScore(gaps, strategy, currentMetrics);

  // Generate prioritized actions
  const prioritizedActions = generatePrioritizedActions(gaps);

  return {
    gaps,
    overallScore,
    prioritizedActions,
    analyzedAt: new Date().toISOString(),
  };
}

function categorizeGapSeverity(gap: number): GapSeverity {
  if (gap >= 0.30) return 'critical';
  if (gap >= 0.15) return 'high';
  if (gap >= 0.05) return 'medium';
  return 'low';
}

function generateCoverageRecommendation(type: string, gap: number): string {
  switch (type) {
    case 'unit':
      if (gap > 0.20) {
        return 'Significant coverage gap. Prioritize testing critical paths and business logic first.';
      } else if (gap > 0.10) {
        return 'Moderate coverage gap. Focus on uncovered edge cases and error handling.';
      }
      return 'Minor coverage gap. Target remaining uncovered branches and conditions.';
    case 'mutation':
      if (gap > 0.20) {
        return 'Low mutation score indicates weak assertions. Review test assertions for thoroughness.';
      } else if (gap > 0.10) {
        return 'Improve assertion quality. Focus on boundary conditions and state changes.';
      }
      return 'Fine-tune assertions for remaining surviving mutants.';
    default:
      return 'Review and address the coverage gap.';
  }
}

function estimateEffort(gap: number): 'low' | 'medium' | 'high' {
  if (gap >= 0.25) return 'high';
  if (gap >= 0.10) return 'medium';
  return 'low';
}

function calculateOverallScore(
  gaps: CoverageGap[],
  strategy: TestingStrategy,
  currentMetrics: TestQualityMetrics
): number {
  if (gaps.length === 0) return 100;

  // Weight different aspects
  const weights = {
    coverage: 0.35,
    mutation: 0.20,
    flakiness: 0.25,
    maintenance: 0.10,
    performance: 0.10,
  };

  let weightedScore = 100;

  // Deduct for each gap based on severity
  for (const gap of gaps) {
    let deduction = 0;
    switch (gap.severity) {
      case 'critical':
        deduction = 25;
        break;
      case 'high':
        deduction = 15;
        break;
      case 'medium':
        deduction = 8;
        break;
      case 'low':
        deduction = 3;
        break;
    }
    weightedScore -= deduction;
  }

  return Math.max(0, Math.min(100, weightedScore));
}

function generatePrioritizedActions(gaps: CoverageGap[]): PrioritizedAction[] {
  const actions: PrioritizedAction[] = [];

  // Sort gaps by severity and impact
  const sortedGaps = [...gaps].sort((a, b) => {
    const severityOrder: Record<GapSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const effortOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };

    // Prioritize high severity with low effort (quick wins)
    const aScore = severityOrder[a.severity] * 3 + effortOrder[a.estimatedEffort];
    const bScore = severityOrder[b.severity] * 3 + effortOrder[b.estimatedEffort];
    return aScore - bScore;
  });

  let priority = 1;
  for (const gap of sortedGaps) {
    actions.push({
      priority,
      action: gap.recommendation,
      impact: gap.severity === 'critical' || gap.severity === 'high' ? 'high' :
              gap.severity === 'medium' ? 'medium' : 'low',
      effort: gap.estimatedEffort,
      affectedGaps: [gap.area],
    });
    priority++;
  }

  return actions;
}

// ============================================================================
// TEST QUALITY REPORTER
// ============================================================================

/**
 * Generates a comprehensive test quality report.
 */
export function generateQualityReport(
  strategy: TestingStrategy,
  currentMetrics: TestQualityMetrics,
  previousMetrics?: TestQualityMetrics
): TestQualityReport {
  const trends = previousMetrics
    ? calculateTrends(currentMetrics, previousMetrics)
    : [];

  const categoryStats = generateCategoryStats(strategy, currentMetrics);
  const recommendations = generateRecommendations(strategy, currentMetrics, trends);

  return {
    strategy,
    currentMetrics,
    trends,
    categoryStats,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

function calculateTrends(
  current: TestQualityMetrics,
  previous: TestQualityMetrics
): MetricTrend[] {
  const trends: MetricTrend[] = [];

  // Coverage trend
  const coverageChange = current.coverage - previous.coverage;
  trends.push({
    metric: 'coverage',
    currentValue: current.coverage,
    previousValue: previous.coverage,
    change: coverageChange,
    direction: determineTrendDirection(coverageChange, true),
  });

  // Mutation score trend
  const mutationChange = current.mutationScore - previous.mutationScore;
  trends.push({
    metric: 'mutationScore',
    currentValue: current.mutationScore,
    previousValue: previous.mutationScore,
    change: mutationChange,
    direction: determineTrendDirection(mutationChange, true),
  });

  // Flaky rate trend (lower is better)
  const flakyChange = current.flakyRate - previous.flakyRate;
  trends.push({
    metric: 'flakyRate',
    currentValue: current.flakyRate,
    previousValue: previous.flakyRate,
    change: flakyChange,
    direction: determineTrendDirection(-flakyChange, true), // Inverted - decrease is improvement
  });

  // Maintenance burden trend (lower is better)
  const maintenanceChange = current.maintenanceBurden - previous.maintenanceBurden;
  trends.push({
    metric: 'maintenanceBurden',
    currentValue: current.maintenanceBurden,
    previousValue: previous.maintenanceBurden,
    change: maintenanceChange,
    direction: determineTrendDirection(-maintenanceChange, true), // Inverted
  });

  // Execution time trend (lower is better)
  const timeChange = current.executionTime.p99 - previous.executionTime.p99;
  trends.push({
    metric: 'executionTime.p99',
    currentValue: current.executionTime.p99,
    previousValue: previous.executionTime.p99,
    change: timeChange,
    direction: determineTrendDirection(-timeChange, true), // Inverted
  });

  return trends;
}

function determineTrendDirection(change: number, higherIsBetter: boolean): TrendDirection {
  const threshold = 0.01; // 1% threshold for significant change

  if (Math.abs(change) < threshold) {
    return 'stable';
  }

  if (higherIsBetter) {
    return change > 0 ? 'improving' : 'degrading';
  } else {
    return change < 0 ? 'improving' : 'degrading';
  }
}

function generateCategoryStats(
  strategy: TestingStrategy,
  metrics: TestQualityMetrics
): TestCategoryStats[] {
  // Generate synthetic stats based on strategy configuration
  // In a real implementation, this would come from actual test results
  const unitStats: TestCategoryStats = {
    category: 'unit',
    totalTests: Math.round(metrics.coverage * 1000),
    passingTests: Math.round(metrics.coverage * 1000 * (1 - metrics.flakyRate * 0.5)),
    failingTests: Math.round(metrics.coverage * 1000 * metrics.flakyRate * 0.3),
    skippedTests: Math.round(metrics.coverage * 1000 * 0.02),
    flakyTests: Math.round(metrics.coverage * 1000 * metrics.flakyRate),
    averageExecutionTimeMs: metrics.executionTime.p50 * 0.1,
  };

  const integrationStats: TestCategoryStats = {
    category: 'integration',
    totalTests: Math.round(metrics.coverage * 200),
    passingTests: Math.round(metrics.coverage * 200 * (1 - metrics.flakyRate)),
    failingTests: Math.round(metrics.coverage * 200 * metrics.flakyRate * 0.5),
    skippedTests: Math.round(metrics.coverage * 200 * 0.03),
    flakyTests: Math.round(metrics.coverage * 200 * metrics.flakyRate * 1.5),
    averageExecutionTimeMs: metrics.executionTime.p50 * 0.5,
  };

  const e2eStats: TestCategoryStats = {
    category: 'e2e',
    totalTests: strategy.pyramid.e2e.userJourneyTests.length * 5,
    passingTests: Math.round(strategy.pyramid.e2e.userJourneyTests.length * 5 * (1 - metrics.flakyRate * 2)),
    failingTests: Math.round(strategy.pyramid.e2e.userJourneyTests.length * 5 * metrics.flakyRate),
    skippedTests: 1,
    flakyTests: Math.round(strategy.pyramid.e2e.userJourneyTests.length * 5 * metrics.flakyRate * 2),
    averageExecutionTimeMs: metrics.executionTime.p50,
  };

  return [unitStats, integrationStats, e2eStats];
}

function generateRecommendations(
  strategy: TestingStrategy,
  metrics: TestQualityMetrics,
  trends: MetricTrend[]
): ReportRecommendation[] {
  const recommendations: ReportRecommendation[] = [];

  // Coverage recommendations
  if (metrics.coverage < strategy.pyramid.unit.coverageTarget) {
    recommendations.push({
      title: 'Improve Test Coverage',
      description: `Current coverage (${(metrics.coverage * 100).toFixed(1)}%) is below target (${(strategy.pyramid.unit.coverageTarget * 100).toFixed(1)}%)`,
      priority: metrics.coverage < 0.6 ? 'critical' : metrics.coverage < 0.75 ? 'high' : 'medium',
      category: 'coverage',
      actionItems: [
        'Identify uncovered code paths using coverage reports',
        'Prioritize testing business-critical functions',
        'Add edge case tests for existing functions',
        'Consider property-based testing for complex logic',
      ],
    });
  }

  // Flaky test recommendations
  if (metrics.flakyRate > strategy.qualityTargets.flakyRate) {
    recommendations.push({
      title: 'Reduce Flaky Tests',
      description: `Flaky rate (${(metrics.flakyRate * 100).toFixed(1)}%) exceeds target (${(strategy.qualityTargets.flakyRate * 100).toFixed(1)}%)`,
      priority: metrics.flakyRate > 0.05 ? 'critical' : 'high',
      category: 'reliability',
      actionItems: [
        'Identify and quarantine flaky tests',
        'Add proper wait mechanisms for async operations',
        'Improve test isolation',
        'Review and fix timing-dependent assertions',
        'Consider using test retries temporarily',
      ],
    });
  }

  // Performance recommendations
  if (metrics.executionTime.p99 > strategy.qualityTargets.executionTime.p99) {
    recommendations.push({
      title: 'Optimize Test Execution Time',
      description: `P99 execution time (${metrics.executionTime.p99}ms) exceeds target (${strategy.qualityTargets.executionTime.p99}ms)`,
      priority: metrics.executionTime.p99 > strategy.qualityTargets.executionTime.p99 * 2 ? 'high' : 'medium',
      category: 'performance',
      actionItems: [
        'Profile slow tests to identify bottlenecks',
        'Parallelize test execution where possible',
        'Optimize database setup/teardown',
        'Consider test splitting for CI',
        'Use in-memory alternatives for external services',
      ],
    });
  }

  // Maintenance recommendations
  if (metrics.maintenanceBurden > strategy.qualityTargets.maintenanceBurden) {
    recommendations.push({
      title: 'Reduce Test Maintenance Burden',
      description: `Maintenance burden (${(metrics.maintenanceBurden * 100).toFixed(1)}%) exceeds target (${(strategy.qualityTargets.maintenanceBurden * 100).toFixed(1)}%)`,
      priority: 'medium',
      category: 'maintenance',
      actionItems: [
        'Refactor complex test setups into reusable fixtures',
        'Reduce test duplication',
        'Improve test naming and documentation',
        'Consider Page Object pattern for E2E tests',
        'Review and consolidate similar test cases',
      ],
    });
  }

  // Trend-based recommendations
  const degradingTrends = trends.filter(t => t.direction === 'degrading');
  if (degradingTrends.length > 0) {
    recommendations.push({
      title: 'Address Degrading Metrics',
      description: `${degradingTrends.length} metric(s) showing negative trends: ${degradingTrends.map(t => t.metric).join(', ')}`,
      priority: degradingTrends.length > 2 ? 'high' : 'medium',
      category: 'reliability',
      actionItems: degradingTrends.map(t => `Investigate ${t.metric} degradation (${t.change > 0 ? '+' : ''}${(t.change * 100).toFixed(1)}%)`),
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}

// ============================================================================
// STRATEGY CREATION HELPERS
// ============================================================================

/**
 * Creates a testing strategy from a preset with optional overrides.
 */
export function createTestingStrategy(input: {
  id: string;
  name: string;
  description: string;
  preset: 'comprehensive' | 'balanced' | 'minimal';
  pyramidOverrides?: Partial<TestingPyramid>;
  infrastructureOverrides?: Partial<TestInfrastructure>;
  qualityTargetOverrides?: Partial<TestQualityMetrics>;
  metadata?: Partial<TestingStrategyMetadata>;
}): TestingStrategy {
  const now = new Date().toISOString();

  const presetMap: Record<string, TestingPyramid> = {
    comprehensive: COMPREHENSIVE_PRESET,
    balanced: BALANCED_PRESET,
    minimal: MINIMAL_PRESET,
  };

  const basePyramid = presetMap[input.preset];

  // Always create copies to prevent mutation of shared preset objects
  const pyramid: TestingPyramid = input.pyramidOverrides
    ? deepMerge(structuredClone(basePyramid), input.pyramidOverrides)
    : structuredClone(basePyramid);

  const infrastructure: TestInfrastructure = input.infrastructureOverrides
    ? deepMerge(structuredClone(DEFAULT_TEST_INFRASTRUCTURE), input.infrastructureOverrides)
    : structuredClone(DEFAULT_TEST_INFRASTRUCTURE);

  const qualityTargets: TestQualityMetrics = input.qualityTargetOverrides
    ? deepMerge(structuredClone(DEFAULT_QUALITY_TARGETS), input.qualityTargetOverrides)
    : structuredClone(DEFAULT_QUALITY_TARGETS);

  const metadata: TestingStrategyMetadata = {
    version: input.metadata?.version ?? '1.0.0',
    createdAt: input.metadata?.createdAt ?? now,
    updatedAt: input.metadata?.updatedAt ?? now,
    author: input.metadata?.author,
    tags: input.metadata?.tags ?? [input.preset],
  };

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    pyramid,
    infrastructure,
    qualityTargets,
    metadata,
  };
}

/**
 * Deep merges two objects, with source values overriding target values.
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue as object,
          sourceValue as object
        );
      } else if (sourceValue !== undefined) {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ============================================================================
// LIBRARIAN-ENHANCED TEST GAP ANALYSIS
// ============================================================================

import type { LiBrainian } from '../api/librainian.js';
import type { LiBrainianResponse, LlmOptional, ContextPack } from '../types.js';
import type { EvidenceRef } from '../api/evidence.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { bounded, absent, deriveSequentialConfidence, getNumericValue } from '../epistemics/confidence.js';

/**
 * Semantic test gap discovered through librainian analysis.
 */
export interface SemanticTestGap {
  /** Type of test gap */
  type:
    | 'untested_branch'
    | 'untested_error_path'
    | 'missing_edge_case'
    | 'missing_integration_test'
    | 'missing_contract_test'
    | 'missing_property_test'
    | 'insufficient_assertion'
    | 'missing_boundary_test'
    | 'missing_negative_test'
    | 'brittle_test';
  /** Description of the gap */
  description: string;
  /** File path of the code that needs testing */
  filePath: string;
  /** Function or method name */
  functionName?: string;
  /** Line number where the gap was identified */
  line?: number;
  /** Severity of the gap */
  severity: GapSeverity;
  /** Suggested test to add */
  suggestedTest: string;
  /** Estimated effort to address */
  estimatedEffort: 'low' | 'medium' | 'high';
  /** Evidence supporting this finding */
  evidence: EvidenceRef[];
}

/**
 * Result of librainian-enhanced test gap analysis.
 */
export interface LiBrainianEnhancedTestGapAnalysis extends CoverageGapAnalysis {
  /** Semantic test gaps found through code analysis */
  semanticGaps: SemanticTestGap[];
  /** Overall confidence in the analysis */
  confidence: ConfidenceValue;
  /** Evidence references for traceability */
  evidenceRefs: EvidenceRef[];
  /** Whether librainian was available for semantic analysis */
  librainianAvailable: boolean;
  /** LiBrainian query trace ID */
  traceId?: string;
  /** Summary of untested code paths */
  untestedPathsSummary: {
    errorPaths: number;
    edgeCases: number;
    boundaryConditions: number;
    integrationPoints: number;
  };
}

/**
 * Analyze code for untested paths using librainian semantic analysis.
 */
async function analyzeUntestedPaths(
  librainian: LiBrainian
): Promise<{ gaps: SemanticTestGap[]; evidenceRefs: EvidenceRef[] }> {
  const gaps: SemanticTestGap[] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Query librainian for untested code paths
  const queryResult = await librainian.queryOptional({
    intent: 'Find code paths that appear to lack test coverage. ' +
            'Look for: error handling branches without tests, edge cases without assertions, ' +
            'complex conditional logic without property tests, integration points without contract tests, ' +
            'and boundary conditions without validation tests.',
    depth: 'L2',
    taskType: 'understand',
  });

  if (!queryResult || !queryResult.packs || queryResult.packs.length === 0) {
    return { gaps, evidenceRefs };
  }

  // Analyze packs for test gaps
  for (const pack of queryResult.packs) {
    for (const snippet of pack.codeSnippets) {
      const content = snippet.content.toLowerCase();
      const snippetGaps = analyzeSnippetForTestGaps(snippet, pack, content);
      gaps.push(...snippetGaps);

      // Build evidence refs
      evidenceRefs.push({
        file: snippet.filePath,
        line: snippet.startLine,
        endLine: snippet.endLine,
        snippet: snippet.content.slice(0, 300),
        claim: pack.summary.slice(0, 100),
        confidence: pack.confidence > 0.7 ? 'verified' : 'inferred',
      });
    }
  }

  return { gaps, evidenceRefs };
}

/**
 * Analyze a code snippet for potential test gaps.
 */
function analyzeSnippetForTestGaps(
  snippet: { filePath: string; startLine: number; endLine: number; content: string },
  pack: ContextPack,
  contentLower: string
): SemanticTestGap[] {
  const gaps: SemanticTestGap[] = [];

  // Skip test files themselves
  if (snippet.filePath.includes('.test.') || snippet.filePath.includes('.spec.')) {
    return gaps;
  }

  // Check for error handling without tests
  if (contentLower.includes('catch') || contentLower.includes('throw')) {
    const hasErrorTest = pack.keyFacts.some(fact =>
      fact.toLowerCase().includes('error') && fact.toLowerCase().includes('test')
    );
    if (!hasErrorTest) {
      gaps.push({
        type: 'untested_error_path',
        description: 'Error handling code may lack test coverage',
        filePath: snippet.filePath,
        line: snippet.startLine,
        severity: 'medium',
        suggestedTest: `Add test for error handling: expect(() => functionCall()).toThrow()`,
        estimatedEffort: 'low',
        evidence: [{
          file: snippet.filePath,
          line: snippet.startLine,
          snippet: snippet.content.slice(0, 200),
          claim: 'Error handling code detected without corresponding test evidence',
          confidence: 'inferred',
        }],
      });
    }
  }

  // Check for conditional logic that may need edge case tests
  const conditionCount = (contentLower.match(/if\s*\(|switch\s*\(|\?\s*:/g) || []).length;
  if (conditionCount >= 3) {
    gaps.push({
      type: 'missing_edge_case',
      description: `Complex conditional logic (${conditionCount} branches) may need edge case tests`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      severity: conditionCount > 5 ? 'high' : 'medium',
      suggestedTest: 'Add property-based tests for complex branching logic',
      estimatedEffort: conditionCount > 5 ? 'high' : 'medium',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: `${conditionCount} conditional branches detected`,
        confidence: 'inferred',
      }],
    });
  }

  // Check for boundary conditions
  if (contentLower.includes('length') || contentLower.includes('size') ||
      contentLower.includes('max') || contentLower.includes('min') ||
      contentLower.includes('limit') || contentLower.includes('bound')) {
    gaps.push({
      type: 'missing_boundary_test',
      description: 'Code with boundary conditions may need boundary tests',
      filePath: snippet.filePath,
      line: snippet.startLine,
      severity: 'medium',
      suggestedTest: 'Add boundary condition tests: empty, single element, at limit, beyond limit',
      estimatedEffort: 'medium',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: 'Boundary-related code detected',
        confidence: 'inferred',
      }],
    });
  }

  // Check for async operations that need integration tests
  if (contentLower.includes('await') || contentLower.includes('promise') ||
      contentLower.includes('fetch') || contentLower.includes('http')) {
    gaps.push({
      type: 'missing_integration_test',
      description: 'Async/external service code may need integration tests',
      filePath: snippet.filePath,
      line: snippet.startLine,
      severity: 'medium',
      suggestedTest: 'Add integration test with proper mocking of external dependencies',
      estimatedEffort: 'medium',
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: snippet.content.slice(0, 200),
        claim: 'Async or external service code detected',
        confidence: 'inferred',
      }],
    });
  }

  return gaps;
}

/**
 * Analyze test coverage gaps with librainian-enhanced semantic analysis.
 *
 * This function combines traditional coverage gap analysis with semantic code
 * analysis from the librainian. It identifies untested code paths, missing edge
 * case tests, and other gaps that coverage metrics alone might miss.
 *
 * @param strategy - Testing strategy configuration
 * @param currentMetrics - Current test quality metrics
 * @param librainian - LiBrainian instance for semantic analysis
 * @returns Enhanced gap analysis with semantic findings and confidence
 *
 * @example
 * ```typescript
 * const result = await analyzeTestGapsWithLiBrainian(
 *   myTestingStrategy,
 *   currentMetrics,
 *   librainian
 * );
 * console.log(result.semanticGaps); // Untested paths found semantically
 * console.log(result.untestedPathsSummary); // Summary by category
 * ```
 */
export async function analyzeTestGapsWithLiBrainian(
  strategy: TestingStrategy,
  currentMetrics: TestQualityMetrics,
  librainian: LiBrainian
): Promise<LiBrainianEnhancedTestGapAnalysis> {
  // Perform traditional coverage gap analysis
  const staticAnalysis = analyzeCoverageGaps(strategy, currentMetrics);

  // Perform librainian-enhanced analysis
  let semanticGaps: SemanticTestGap[] = [];
  let evidenceRefs: EvidenceRef[] = [];
  let librainianAvailable = false;
  let traceId: string | undefined;

  try {
    const semanticAnalysis = await analyzeUntestedPaths(librainian);
    semanticGaps = semanticAnalysis.gaps;
    evidenceRefs = semanticAnalysis.evidenceRefs;
    librainianAvailable = true;

    // Get trace ID
    const statusQuery = await librainian.queryOptional({
      intent: 'Test gap analysis trace',
      depth: 'L0',
    });
    traceId = statusQuery?.traceId;
  } catch {
    // LiBrainian query failed, proceed with static analysis only
    librainianAvailable = false;
  }

  // Calculate untested paths summary
  const untestedPathsSummary = {
    errorPaths: semanticGaps.filter(g => g.type === 'untested_error_path').length,
    edgeCases: semanticGaps.filter(g => g.type === 'missing_edge_case').length,
    boundaryConditions: semanticGaps.filter(g => g.type === 'missing_boundary_test').length,
    integrationPoints: semanticGaps.filter(g => g.type === 'missing_integration_test').length,
  };

  // Derive confidence
  const staticConfidence = bounded(
    0.7,
    0.9,
    'formal_analysis',
    'Coverage metrics provide accurate but incomplete view of test quality'
  );

  const librainianConfidence = librainianAvailable
    ? bounded(0.5, 0.75, 'literature', 'Semantic analysis identifies patterns but may have false positives')
    : absent('uncalibrated');

  const confidence = deriveSequentialConfidence([staticConfidence, librainianConfidence]);

  // Adjust overall score based on semantic findings
  const semanticPenalty = semanticGaps.reduce((penalty, gap) => {
    switch (gap.severity) {
      case 'critical': return penalty + 0.1;
      case 'high': return penalty + 0.05;
      case 'medium': return penalty + 0.02;
      case 'low': return penalty + 0.01;
      default: return penalty;
    }
  }, 0);

  return {
    ...staticAnalysis,
    overallScore: Math.max(0, staticAnalysis.overallScore - Math.min(semanticPenalty, 0.3)),
    semanticGaps,
    confidence,
    evidenceRefs,
    librainianAvailable,
    traceId,
    untestedPathsSummary,
  };
}
