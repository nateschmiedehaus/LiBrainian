/**
 * @fileoverview Fix Planning Primitive (tp_improve_plan_fix)
 *
 * Plan how to fix an identified issue with rollback strategy,
 * test plan, and risk assessment.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { ConfidenceValue, EffortEstimate, Evidence } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of issues that can be fixed.
 */
export type IssueType =
  | 'bug'
  | 'architecture'
  | 'performance'
  | 'consistency'
  | 'theoretical';

/**
 * Severity levels for issues.
 */
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * An identified issue that needs fixing.
 */
export interface Issue {
  /** Unique identifier */
  id: string;
  /** Type of issue */
  type: IssueType;
  /** Human-readable description */
  description: string;
  /** Location in the codebase */
  location: string;
  /** Severity level */
  severity: IssueSeverity;
  /** Evidence supporting this issue */
  evidence: Evidence[];
}

/**
 * Types of changes that can be proposed.
 */
export type ChangeType = 'add' | 'modify' | 'delete' | 'refactor';

/**
 * A proposed change as part of the fix.
 */
export interface Change {
  /** Step order in the fix plan */
  order: number;
  /** Description of what this change does */
  description: string;
  /** File to modify */
  file: string;
  /** Type of change */
  changeType: ChangeType;
  /** Estimated lines of code affected */
  estimatedLoc: number;
  /** Dependencies on other changes */
  dependsOn?: number[];
}

/**
 * Test strategy for verifying the fix.
 */
export interface TestPlan {
  /** Unit tests to run or create */
  unitTests: string[];
  /** Integration tests to run or create */
  integrationTests: string[];
  /** Manual verification steps */
  manualChecks: string[];
  /** Performance benchmarks if relevant */
  performanceBenchmarks?: string[];
  /** Expected coverage improvement */
  expectedCoverageImprovement?: number;
}

/**
 * Rollback strategy if the fix fails.
 */
export interface RollbackPlan {
  /** Description of rollback approach */
  strategy: string;
  /** Steps to rollback */
  steps: string[];
  /** Files that can be reverted */
  revertibleFiles: string[];
  /** Data migrations to undo if any */
  dataMigrations?: string[];
  /** Estimated time to rollback */
  estimatedTimeMinutes: number;
}

/**
 * An individual risk in the fix.
 */
export interface Risk {
  /** Type of risk */
  type: string;
  /** Description of the risk */
  description: string;
  /** Likelihood (0.0-1.0) */
  likelihood: number;
  /** Impact if it occurs (0.0-1.0) */
  impact: number;
  /** Mitigation strategy */
  mitigation: string;
  /** Risk score (likelihood * impact) */
  score: number;
}

/**
 * Overall risk assessment for the fix.
 */
export interface RiskAssessment {
  /** Overall risk level */
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  /** Individual risks */
  risks: Risk[];
  /** Total risk score */
  totalRiskScore: number;
  /** Recommended mitigations */
  prioritizedMitigations: string[];
}

/**
 * Criteria for verifying the fix was successful.
 */
export interface VerificationCriteria {
  /** Test assertions that must pass */
  assertions: string[];
  /** Metrics that must improve */
  metricThresholds: Array<{
    metric: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    value: number;
  }>;
  /** Manual verification checklist */
  manualChecklist: string[];
  /** Timeout for verification */
  timeoutMs: number;
}

/**
 * Effort estimate for the fix.
 */
export interface Effort {
  /** Lines of code estimate */
  loc: { min: number; max: number };
  /** Hours estimate */
  hours: { min: number; max: number };
  /** Complexity level */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  /** Confidence in estimate */
  confidence: ConfidenceValue;
}

/**
 * Complete fix plan for an issue.
 */
export interface FixPlan {
  /** The issue being fixed */
  issue: Issue;
  /** Summary of the fix approach */
  summary: string;
  /** Proposed changes in order */
  proposedChanges: Change[];
  /** Testing strategy */
  testPlan: TestPlan;
  /** Rollback strategy */
  rollbackPlan: RollbackPlan;
  /** Risk assessment */
  riskAssessment: RiskAssessment;
  /** Verification criteria */
  verificationCriteria: VerificationCriteria;
  /** Effort estimate */
  estimatedEffort: Effort;
  /** Files that will be affected */
  affectedFiles: string[];
}

/**
 * Constraints for fix planning.
 */
export interface FixConstraints {
  /** Maximum files to change */
  maxFilesChanged: number;
  /** Preserve public API */
  preservePublicApi: boolean;
  /** Require backward compatibility */
  requireBackwardCompatibility: boolean;
  /** Maximum LOC per file */
  maxLocPerFile?: number;
}

/**
 * Complexity budget for the fix.
 */
export interface ComplexityBudget {
  /** Maximum total LOC */
  maxLoc: number;
  /** Maximum cyclomatic complexity per function */
  maxCyclomaticComplexity: number;
  /** Maximum functions to modify */
  maxFunctions?: number;
}

/**
 * Options for fix planning.
 */
export interface PlanFixOptions {
  /** Constraints on the fix */
  constraints?: FixConstraints;
  /** Complexity budget */
  maxComplexity?: ComplexityBudget;
  /** Maximum changes to propose */
  maxChanges?: number;
  /** Require tests for fix */
  requireTests?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Result of fix planning.
 */
export interface PlanFixResult {
  /** The generated fix plan */
  plan: FixPlan;
  /** Files that will be affected */
  affectedFiles: string[];
  /** Risk assessment */
  riskAssessment: RiskAssessment;
  /** Verification criteria */
  verificationCriteria: VerificationCriteria;
  /** Whether the plan meets constraints */
  meetsConstraints: boolean;
  /** Constraint violations if any */
  constraintViolations: string[];
  /** Duration of planning in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONSTRAINTS: FixConstraints = {
  maxFilesChanged: 10,
  preservePublicApi: true,
  requireBackwardCompatibility: true,
};

const DEFAULT_COMPLEXITY_BUDGET: ComplexityBudget = {
  maxLoc: 500,
  maxCyclomaticComplexity: 10,
};

const DEFAULT_MAX_CHANGES = 20;

// ============================================================================
// RISK ANALYSIS
// ============================================================================

/**
 * Analyze risks associated with a proposed change.
 */
function analyzeChangeRisks(change: Change, issue: Issue): Risk[] {
  const risks: Risk[] = [];

  // Risk of introducing new bugs
  if (change.changeType === 'modify' || change.changeType === 'refactor') {
    const likelihood = change.estimatedLoc > 100 ? 0.4 : change.estimatedLoc > 50 ? 0.3 : 0.2;
    risks.push({
      type: 'regression',
      description: `Modifying ${change.file} may introduce regressions`,
      likelihood,
      impact: issue.severity === 'critical' ? 0.9 : issue.severity === 'high' ? 0.7 : 0.5,
      mitigation: 'Add comprehensive tests before and after the change',
      score: 0,
    });
  }

  // Risk of breaking dependencies
  if (change.changeType === 'delete' || change.changeType === 'refactor') {
    risks.push({
      type: 'dependency_break',
      description: `Change to ${change.file} may break dependent code`,
      likelihood: 0.3,
      impact: 0.6,
      mitigation: 'Check all callers and update accordingly',
      score: 0,
    });
  }

  // Risk of performance impact
  if (change.changeType === 'add' || change.estimatedLoc > 200) {
    risks.push({
      type: 'performance',
      description: 'Large changes may impact performance',
      likelihood: 0.2,
      impact: 0.4,
      mitigation: 'Run performance benchmarks before merging',
      score: 0,
    });
  }

  // Calculate scores
  for (const risk of risks) {
    risk.score = risk.likelihood * risk.impact;
  }

  return risks;
}

/**
 * Generate overall risk assessment for a fix plan.
 */
function generateRiskAssessment(changes: Change[], issue: Issue): RiskAssessment {
  const allRisks: Risk[] = [];

  // Collect risks from all changes
  for (const change of changes) {
    allRisks.push(...analyzeChangeRisks(change, issue));
  }

  // Add cross-cutting risks
  if (changes.length > 5) {
    allRisks.push({
      type: 'coordination',
      description: 'Many files changed increases coordination risk',
      likelihood: 0.3,
      impact: 0.5,
      mitigation: 'Break into smaller PRs if possible',
      score: 0.15,
    });
  }

  // Calculate total risk score
  const totalRiskScore = allRisks.reduce((sum, r) => sum + r.score, 0) / Math.max(allRisks.length, 1);

  // Determine overall risk level
  let overallRisk: 'low' | 'medium' | 'high' | 'critical';
  if (totalRiskScore >= 0.6 || issue.severity === 'critical') {
    overallRisk = 'critical';
  } else if (totalRiskScore >= 0.4 || issue.severity === 'high') {
    overallRisk = 'high';
  } else if (totalRiskScore >= 0.2) {
    overallRisk = 'medium';
  } else {
    overallRisk = 'low';
  }

  // Prioritize mitigations
  const sortedRisks = [...allRisks].sort((a, b) => b.score - a.score);
  const prioritizedMitigations = sortedRisks
    .filter((r) => r.score > 0.1)
    .map((r) => r.mitigation);

  return {
    overallRisk,
    risks: allRisks,
    totalRiskScore,
    prioritizedMitigations: [...new Set(prioritizedMitigations)],
  };
}

// ============================================================================
// CHANGE PLANNING
// ============================================================================

/**
 * Generate proposed changes for an issue.
 */
function generateProposedChanges(issue: Issue, maxChanges: number): Change[] {
  const changes: Change[] = [];
  let order = 1;

  // Determine changes based on issue type
  switch (issue.type) {
    case 'bug':
      // Bug fix typically involves modifying the file where the bug is
      changes.push({
        order: order++,
        description: `Fix bug: ${issue.description}`,
        file: issue.location,
        changeType: 'modify',
        estimatedLoc: estimateLocForBugFix(issue),
      });
      break;

    case 'architecture':
      // Architecture issues often require refactoring
      changes.push({
        order: order++,
        description: `Refactor architecture: ${issue.description}`,
        file: issue.location,
        changeType: 'refactor',
        estimatedLoc: estimateLocForArchitectureFix(issue),
      });

      // May need to extract interfaces or create new files
      if (issue.severity === 'high' || issue.severity === 'critical') {
        changes.push({
          order: order++,
          description: 'Extract interface or shared abstraction',
          file: issue.location.replace(/\.ts$/, '.interface.ts'),
          changeType: 'add',
          estimatedLoc: 30,
          dependsOn: [1],
        });
      }
      break;

    case 'performance':
      changes.push({
        order: order++,
        description: `Optimize performance: ${issue.description}`,
        file: issue.location,
        changeType: 'modify',
        estimatedLoc: estimateLocForPerformanceFix(issue),
      });
      break;

    case 'consistency':
      // Consistency fixes may involve documentation and code alignment
      changes.push({
        order: order++,
        description: `Fix consistency issue: ${issue.description}`,
        file: issue.location,
        changeType: 'modify',
        estimatedLoc: 20,
      });

      // If doc-code mismatch, update docs too
      if (issue.description.toLowerCase().includes('doc')) {
        const docFile = issue.location.replace(/\.ts$/, '.md');
        changes.push({
          order: order++,
          description: 'Update documentation to match code',
          file: docFile,
          changeType: 'modify',
          estimatedLoc: 10,
          dependsOn: [1],
        });
      }
      break;

    case 'theoretical':
      // Theoretical issues may require deeper refactoring
      changes.push({
        order: order++,
        description: `Address theoretical issue: ${issue.description}`,
        file: issue.location,
        changeType: 'refactor',
        estimatedLoc: 50,
      });
      break;
  }

  // Limit to max changes
  return changes.slice(0, maxChanges);
}

/**
 * Estimate LOC for bug fix based on severity.
 */
function estimateLocForBugFix(issue: Issue): number {
  switch (issue.severity) {
    case 'critical': return 100;
    case 'high': return 50;
    case 'medium': return 30;
    case 'low': return 15;
  }
}

/**
 * Estimate LOC for architecture fix.
 */
function estimateLocForArchitectureFix(issue: Issue): number {
  switch (issue.severity) {
    case 'critical': return 300;
    case 'high': return 150;
    case 'medium': return 75;
    case 'low': return 40;
  }
}

/**
 * Estimate LOC for performance fix.
 */
function estimateLocForPerformanceFix(issue: Issue): number {
  switch (issue.severity) {
    case 'critical': return 150;
    case 'high': return 80;
    case 'medium': return 40;
    case 'low': return 20;
  }
}

// ============================================================================
// TEST PLANNING
// ============================================================================

/**
 * Generate test plan for verifying the fix.
 */
function generateTestPlan(issue: Issue, changes: Change[], requireTests: boolean): TestPlan {
  const unitTests: string[] = [];
  const integrationTests: string[] = [];
  const manualChecks: string[] = [];
  const performanceBenchmarks: string[] = [];

  // Generate test entries based on changes
  for (const change of changes) {
    const testFile = change.file.replace(/\.ts$/, '.test.ts').replace('/src/', '/src/__tests__/');

    if (change.changeType === 'add' || change.changeType === 'modify') {
      unitTests.push(`${testFile}: test ${change.description}`);
    }

    if (change.changeType === 'refactor') {
      unitTests.push(`${testFile}: ensure behavior unchanged after refactor`);
      integrationTests.push(`Integration test for ${change.file}`);
    }
  }

  // Add issue-specific tests
  switch (issue.type) {
    case 'bug':
      unitTests.push(`Regression test: ${issue.description}`);
      unitTests.push(`Edge case test for ${issue.location}`);
      break;

    case 'performance':
      performanceBenchmarks.push(`Benchmark ${issue.location} before/after`);
      manualChecks.push('Compare performance metrics before and after');
      break;

    case 'consistency':
      manualChecks.push('Verify documentation matches code');
      manualChecks.push('Check for type alignment');
      break;
  }

  // Always add basic manual checks
  manualChecks.push('Review all changed files');
  if (requireTests) {
    manualChecks.push('Ensure test coverage does not decrease');
  }

  return {
    unitTests,
    integrationTests,
    manualChecks,
    performanceBenchmarks: performanceBenchmarks.length > 0 ? performanceBenchmarks : undefined,
    expectedCoverageImprovement: requireTests ? 0.05 : undefined,
  };
}

// ============================================================================
// ROLLBACK PLANNING
// ============================================================================

/**
 * Generate rollback plan for the fix.
 */
function generateRollbackPlan(changes: Change[]): RollbackPlan {
  const steps: string[] = [];
  const revertibleFiles: string[] = [];

  // Reverse order of changes for rollback
  const reversedChanges = [...changes].reverse();

  for (const change of reversedChanges) {
    revertibleFiles.push(change.file);

    switch (change.changeType) {
      case 'add':
        steps.push(`Delete newly added file: ${change.file}`);
        break;
      case 'delete':
        steps.push(`Restore deleted file: ${change.file} from version control`);
        break;
      case 'modify':
      case 'refactor':
        steps.push(`Revert changes to: ${change.file}`);
        break;
    }
  }

  // Estimate time based on number of changes
  const estimatedTimeMinutes = Math.max(5, changes.length * 2);

  return {
    strategy: 'Git revert to previous commit or cherry-pick specific changes',
    steps,
    revertibleFiles: [...new Set(revertibleFiles)],
    estimatedTimeMinutes,
  };
}

// ============================================================================
// VERIFICATION CRITERIA
// ============================================================================

/**
 * Generate verification criteria for the fix.
 */
function generateVerificationCriteria(issue: Issue, testPlan: TestPlan): VerificationCriteria {
  const assertions: string[] = [];
  const metricThresholds: VerificationCriteria['metricThresholds'] = [];
  const manualChecklist: string[] = [];

  // Add test-based assertions
  for (const test of testPlan.unitTests) {
    assertions.push(`Unit test passes: ${test}`);
  }

  for (const test of testPlan.integrationTests) {
    assertions.push(`Integration test passes: ${test}`);
  }

  // Add issue-specific metrics
  switch (issue.type) {
    case 'bug':
      assertions.push('Bug reproduction test now passes');
      break;

    case 'performance':
      metricThresholds.push({
        metric: 'execution_time_ms',
        operator: 'lt',
        value: 1000, // Example threshold
      });
      metricThresholds.push({
        metric: 'memory_usage_mb',
        operator: 'lte',
        value: 100,
      });
      break;

    case 'architecture':
      metricThresholds.push({
        metric: 'cyclomatic_complexity',
        operator: 'lte',
        value: 15,
      });
      metricThresholds.push({
        metric: 'coupling_score',
        operator: 'lt',
        value: 0.7,
      });
      break;
  }

  // Standard verification items
  metricThresholds.push({
    metric: 'test_coverage',
    operator: 'gte',
    value: 0.8,
  });

  manualChecklist.push('Code review completed');
  manualChecklist.push('No new linting errors');
  manualChecklist.push('CI pipeline passes');
  manualChecklist.push(...testPlan.manualChecks);

  return {
    assertions,
    metricThresholds,
    manualChecklist: [...new Set(manualChecklist)],
    timeoutMs: 300000, // 5 minutes
  };
}

// ============================================================================
// EFFORT ESTIMATION
// ============================================================================

/**
 * Estimate effort for the fix.
 */
function estimateEffort(changes: Change[], issue: Issue): Effort {
  // Calculate total LOC
  const totalLoc = changes.reduce((sum, c) => sum + c.estimatedLoc, 0);

  // Calculate hours based on LOC and complexity
  const baseHours = totalLoc / 20; // ~20 LOC per hour
  const complexityMultiplier = issue.severity === 'critical' ? 2 :
    issue.severity === 'high' ? 1.5 :
    issue.severity === 'medium' ? 1.2 : 1;

  const minHours = baseHours * complexityMultiplier * 0.8;
  const maxHours = baseHours * complexityMultiplier * 1.5;

  // Determine complexity
  let complexity: Effort['complexity'];
  if (totalLoc <= 20) {
    complexity = 'trivial';
  } else if (totalLoc <= 50) {
    complexity = 'simple';
  } else if (totalLoc <= 150) {
    complexity = 'moderate';
  } else if (totalLoc <= 300) {
    complexity = 'complex';
  } else {
    complexity = 'very_complex';
  }

  return {
    loc: { min: Math.round(totalLoc * 0.8), max: Math.round(totalLoc * 1.2) },
    hours: { min: Math.round(minHours * 10) / 10, max: Math.round(maxHours * 10) / 10 },
    complexity,
    confidence: {
      score: changes.length <= 3 ? 0.8 : changes.length <= 6 ? 0.6 : 0.4,
      tier: changes.length <= 3 ? 'high' : changes.length <= 6 ? 'medium' : 'low',
      source: 'estimated',
    },
  };
}

// ============================================================================
// CONSTRAINT VALIDATION
// ============================================================================

/**
 * Validate fix plan against constraints.
 */
function validateConstraints(
  changes: Change[],
  constraints: FixConstraints,
  complexityBudget: ComplexityBudget
): { meetsConstraints: boolean; violations: string[] } {
  const violations: string[] = [];

  // Check max files changed
  const uniqueFiles = new Set(changes.map((c) => c.file));
  if (uniqueFiles.size > constraints.maxFilesChanged) {
    violations.push(
      `Exceeds max files: ${uniqueFiles.size} > ${constraints.maxFilesChanged}`
    );
  }

  // Check total LOC
  const totalLoc = changes.reduce((sum, c) => sum + c.estimatedLoc, 0);
  if (totalLoc > complexityBudget.maxLoc) {
    violations.push(
      `Exceeds max LOC: ${totalLoc} > ${complexityBudget.maxLoc}`
    );
  }

  // Check for API changes if preservePublicApi is set
  if (constraints.preservePublicApi) {
    const apiChanges = changes.filter(
      (c) => c.file.includes('index.ts') || c.file.includes('/api/')
    );
    if (apiChanges.some((c) => c.changeType === 'delete')) {
      violations.push('Plan would delete public API elements');
    }
  }

  return {
    meetsConstraints: violations.length === 0,
    violations,
  };
}

// ============================================================================
// MAIN PLANNING FUNCTION
// ============================================================================

/**
 * Plan how to fix an identified issue.
 *
 * This function:
 * 1. Analyzes the issue and generates proposed changes
 * 2. Creates a test plan for verification
 * 3. Develops a rollback strategy
 * 4. Assesses risks associated with the fix
 * 5. Estimates effort required
 *
 * @param issue - The issue to fix
 * @param options - Planning options
 * @returns Fix plan result
 *
 * @example
 * ```typescript
 * const result = await planFix({
 *   id: 'issue-1',
 *   type: 'bug',
 *   description: 'Function throws on null input',
 *   location: 'src/utils/parser.ts',
 *   severity: 'high',
 *   evidence: [],
 * });
 * console.log(`Fix requires ${result.plan.proposedChanges.length} changes`);
 * console.log(`Risk level: ${result.riskAssessment.overallRisk}`);
 * ```
 */
export async function planFix(
  issue: Issue,
  options: PlanFixOptions = {}
): Promise<PlanFixResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    constraints = DEFAULT_CONSTRAINTS,
    maxComplexity = DEFAULT_COMPLEXITY_BUDGET,
    maxChanges = DEFAULT_MAX_CHANGES,
    requireTests = true,
    verbose = false,
  } = options;

  if (verbose) {
    console.log(`[planFix] Planning fix for issue: ${issue.id}`);
  }

  // Generate proposed changes
  const proposedChanges = generateProposedChanges(issue, maxChanges);

  if (verbose) {
    console.log(`[planFix] Generated ${proposedChanges.length} proposed changes`);
  }

  // Generate test plan
  const testPlan = generateTestPlan(issue, proposedChanges, requireTests);

  // Generate rollback plan
  const rollbackPlan = generateRollbackPlan(proposedChanges);

  // Generate risk assessment
  const riskAssessment = generateRiskAssessment(proposedChanges, issue);

  // Generate verification criteria
  const verificationCriteria = generateVerificationCriteria(issue, testPlan);

  // Estimate effort
  const estimatedEffort = estimateEffort(proposedChanges, issue);

  // Validate constraints
  const { meetsConstraints, violations } = validateConstraints(
    proposedChanges,
    constraints,
    maxComplexity
  );

  if (!meetsConstraints) {
    errors.push(...violations.map((v) => `Constraint violation: ${v}`));
  }

  // Collect affected files
  const affectedFiles = [...new Set(proposedChanges.map((c) => c.file))];

  // Build fix plan
  const plan: FixPlan = {
    issue,
    summary: `Fix ${issue.type} issue: ${issue.description}`,
    proposedChanges,
    testPlan,
    rollbackPlan,
    riskAssessment,
    verificationCriteria,
    estimatedEffort,
    affectedFiles,
  };

  if (verbose) {
    console.log(`[planFix] Plan complete. Risk: ${riskAssessment.overallRisk}`);
  }

  return {
    plan,
    affectedFiles,
    riskAssessment,
    verificationCriteria,
    meetsConstraints,
    constraintViolations: violations,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a fix planning primitive with bound options.
 */
export function createPlanFix(
  defaultOptions: Partial<PlanFixOptions>
): (issue: Issue, options?: Partial<PlanFixOptions>) => Promise<PlanFixResult> {
  return async (issue, options = {}) => {
    return planFix(issue, {
      ...defaultOptions,
      ...options,
    });
  };
}
