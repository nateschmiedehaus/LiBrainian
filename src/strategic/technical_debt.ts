/**
 * @fileoverview Technical Debt Management System
 *
 * A comprehensive system for tracking, prioritizing, and managing technical debt
 * in world-class software. This module provides:
 *
 * - Debt Classification: Categorize and classify technical debt items
 * - Debt Tracking: Maintain an inventory of debt with interest calculations
 * - Debt Prioritization: ROI-based prioritization and paydown scheduling
 * - Debt Prevention: Policies and gates to prevent debt accumulation
 * - Debt Metrics: Dashboard and trend analysis
 *
 * Key Principles:
 * - Technical debt is like financial debt: principal + interest
 * - Not all debt is bad - sometimes it's a strategic choice
 * - Visibility is the first step to management
 * - Prevention is better than cure
 */

import type { ConfidenceAssessment, Provenance } from './types.js';

// ============================================================================
// DEBT CLASSIFICATION
// ============================================================================

/**
 * Categories of technical debt by its origin and nature
 */
export type DebtType =
  | 'code'           // Implementation-level issues
  | 'architecture'   // Structural/design issues
  | 'infrastructure' // DevOps, CI/CD, deployment issues
  | 'process'        // Development process issues
  | 'documentation'  // Missing or outdated docs
  | 'dependency';    // Outdated or problematic dependencies

/**
 * Specific categories of debt within each type
 */
export type DebtCategory =
  | 'complexity'          // High cyclomatic complexity
  | 'duplication'         // Code clones
  | 'outdated_dependency' // Old versions
  | 'missing_tests'       // Low coverage
  | 'poor_naming'         // Unclear identifiers
  | 'tight_coupling'      // High coupling between modules
  | 'missing_docs'        // No documentation
  | 'workaround'          // Temporary fixes / hacks
  | 'deprecated_usage';   // Using deprecated APIs

/**
 * Severity of the debt - impacts prioritization
 */
export type DebtSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * How the debt was discovered
 */
export type DiscoveryMethod = 'automated' | 'manual' | 'incident';

/**
 * Current status of the debt item
 */
export type DebtStatus =
  | 'identified'   // Newly found
  | 'accepted'     // Acknowledged, will address later
  | 'scheduled'    // Planned for a specific time
  | 'in_progress'  // Actively being addressed
  | 'resolved';    // Fixed

/**
 * A single technical debt item
 */
export interface TechnicalDebtItem {
  id: string;
  title: string;
  description: string;
  type: DebtType;
  category: DebtCategory;
  severity: DebtSeverity;

  /** Was this debt taken on deliberately? */
  intentional: boolean;

  /** Cost multiplier per sprint if not addressed (1.0 = no growth) */
  interestRate: number;

  /** Hours estimated to fix this debt */
  principalCost: number;

  /** Files affected by this debt */
  affectedFiles: string[];

  /** When this debt was created/incurred */
  createdAt: Date;

  /** When this debt was discovered */
  discoveredAt: Date;

  /** How this debt was discovered */
  discoveredBy: DiscoveryMethod;

  /** Current status */
  status: DebtStatus;

  /** Optional: Sprint when this should be addressed */
  scheduledSprint?: string;

  /** Optional: Assigned owner */
  assignedTo?: string;

  /** Optional: Related work item or ticket ID */
  relatedWorkId?: string;

  /** Optional: Decision record for intentional debt */
  decisionRecordId?: string;

  /** Tags for filtering and categorization */
  tags: string[];

  /** Evidence supporting this debt identification */
  evidence: DebtEvidence[];

  /** History of status changes */
  statusHistory: DebtStatusChange[];

  /** Confidence in the assessment */
  confidence: ConfidenceAssessment;

  /** Optional: Provenance of this debt item */
  provenance?: Provenance;
}

/**
 * Evidence supporting a debt identification
 */
export interface DebtEvidence {
  type: 'metric' | 'code_sample' | 'tool_output' | 'incident_report' | 'manual_review';
  description: string;
  data?: unknown;
  source: string;
  collectedAt: Date;
}

/**
 * Record of a status change
 */
export interface DebtStatusChange {
  from: DebtStatus;
  to: DebtStatus;
  changedAt: Date;
  changedBy: string;
  reason?: string;
}

// ============================================================================
// DEBT TRACKING
// ============================================================================

/**
 * Overall inventory of technical debt
 */
export interface DebtInventory {
  /** All debt items */
  items: TechnicalDebtItem[];

  /** Total hours to fix all debt */
  totalPrincipal: number;

  /** Total interest cost per sprint (hours) */
  totalInterest: number;

  /** Current trend */
  trend: DebtTrendDirection;

  /** Last full audit date */
  lastAuditDate: Date;

  /** Summary by category */
  byCategory: Record<DebtCategory, DebtCategorySummary>;

  /** Summary by type */
  byType: Record<DebtType, number>;

  /** Summary by severity */
  bySeverity: Record<DebtSeverity, number>;
}

export type DebtTrendDirection = 'increasing' | 'stable' | 'decreasing';

/**
 * Summary for a specific debt category
 */
export interface DebtCategorySummary {
  count: number;
  totalPrincipal: number;
  totalInterest: number;
  averageSeverity: number; // 0-1 scale
  oldestItem: Date | null;
}

/**
 * Interface for automated debt detectors
 */
export interface DebtDetector {
  /** Unique identifier for this detector */
  id: string;

  /** Human-readable name */
  name: string;

  /** What category of debt this detects */
  type: DebtCategory;

  /** Description of what this detector finds */
  description: string;

  /** Detect debt in a codebase path */
  detect(codebasePath: string): Promise<TechnicalDebtItem[]>;

  /** Confidence in this detector's results (0-1) */
  confidence: number;

  /** Whether this detector is currently enabled */
  enabled: boolean;
}

/**
 * Configuration for a debt detector
 */
export interface DetectorConfig {
  /** Paths to include in scanning */
  includePaths: string[];

  /** Paths to exclude from scanning */
  excludePaths: string[];

  /** Severity thresholds for this detector */
  thresholds: DetectorThresholds;

  /** Custom options for the detector */
  options: Record<string, unknown>;
}

export interface DetectorThresholds {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// ============================================================================
// DEBT PRIORITIZATION
// ============================================================================

/**
 * Interface for debt prioritization strategies
 */
export interface DebtPrioritization {
  /**
   * Calculate ROI for addressing a debt item
   * Higher ROI = more valuable to fix
   */
  calculateROI(item: TechnicalDebtItem): number;

  /**
   * Calculate risk score if debt is not addressed
   * Higher risk = more dangerous to ignore
   */
  calculateRiskScore(item: TechnicalDebtItem): number;

  /**
   * Rank items by overall value (combination of ROI and risk)
   */
  rankByValue(items: TechnicalDebtItem[]): TechnicalDebtItem[];

  /**
   * Suggest optimal paydown order given a time budget
   */
  suggestPaydownOrder(
    items: TechnicalDebtItem[],
    budgetHours: number
  ): PaydownPlan;
}

/**
 * Factors considered in prioritization
 */
export interface PrioritizationFactors {
  /** Return on investment (cost to fix vs. ongoing interest) */
  roi: number;

  /** Risk if not addressed */
  risk: number;

  /** How much other work this unblocks */
  dependencies: number;

  /** Alignment with business priorities */
  strategicAlignment: number;
}

/**
 * A suggested plan for paying down debt
 */
export interface PaydownPlan {
  /** Ordered list of items to address */
  items: PaydownPlanItem[];

  /** Total hours in this plan */
  totalHours: number;

  /** Expected interest saved per sprint */
  expectedInterestSaved: number;

  /** Expected risk reduction */
  expectedRiskReduction: number;

  /** Confidence in this plan */
  confidence: number;
}

export interface PaydownPlanItem {
  item: TechnicalDebtItem;
  priority: number;
  estimatedHours: number;
  expectedValue: number;
  rationale: string;
}

// ============================================================================
// DEBT PREVENTION
// ============================================================================

/**
 * A check that must pass before work is considered "done"
 */
export interface DebtCheck {
  id: string;
  name: string;
  description: string;
  category: DebtCategory;
  check: (context: CheckContext) => Promise<CheckResult>;
  severity: 'blocking' | 'warning' | 'info';
  autoFix?: (context: CheckContext) => Promise<boolean>;
}

export interface CheckContext {
  files: string[];
  changes: CodeChange[];
  config: DebtPreventionPolicy;
}

export interface CodeChange {
  file: string;
  additions: number;
  deletions: number;
  content?: string;
}

export interface CheckResult {
  passed: boolean;
  message: string;
  details?: string[];
  suggestedFix?: string;
}

/**
 * Complexity budget constraints
 */
export interface ComplexityBudget {
  /** Maximum cyclomatic complexity per function */
  maxCyclomaticComplexity: number;

  /** Maximum lines per file */
  maxFileLines: number;

  /** Maximum lines per function */
  maxFunctionLines: number;

  /** Maximum dependencies per module */
  maxDependencies: number;

  /** Maximum depth of nesting */
  maxNestingDepth: number;

  /** Maximum parameters per function */
  maxParameters: number;
}

/**
 * Policy for managing dependencies
 */
export interface DependencyPolicy {
  /** How often to check for outdated dependencies */
  checkFrequency: 'daily' | 'weekly' | 'monthly';

  /** Maximum age of dependencies before flagging */
  maxDependencyAge: number; // days

  /** Dependencies that must always be latest */
  alwaysLatest: string[];

  /** Dependencies with pinned versions */
  pinnedVersions: Record<string, string>;

  /** Disallowed dependencies */
  blocklist: string[];

  /** Required license types */
  allowedLicenses: string[];
}

/**
 * Review gate for preventing debt
 */
export interface ReviewGate {
  id: string;
  name: string;
  description: string;
  trigger: GateTrigger;
  checks: DebtCheck[];
  required: boolean;
}

export type GateTrigger =
  | 'pull_request'
  | 'merge'
  | 'deploy'
  | 'release'
  | 'scheduled';

/**
 * Complete debt prevention policy
 */
export interface DebtPreventionPolicy {
  /** Checks required for "Definition of Done" */
  definitionOfDone: DebtCheck[];

  /** Complexity budgets */
  complexityBudgets: ComplexityBudget;

  /** Dependency management policy */
  dependencyPolicy: DependencyPolicy;

  /** Review gates */
  reviewGates: ReviewGate[];

  /** Whether to block on debt check failures */
  blockOnFailure: boolean;

  /** Grace period for addressing detected issues (hours) */
  gracePeriodHours: number;
}

// ============================================================================
// DEBT METRICS DASHBOARD
// ============================================================================

/**
 * High-level debt summary
 */
export interface DebtSummary {
  /** Total debt items */
  totalItems: number;

  /** Items by status */
  byStatus: Record<DebtStatus, number>;

  /** Total principal (hours) */
  totalPrincipal: number;

  /** Total interest per sprint (hours) */
  totalInterestPerSprint: number;

  /** Estimated full payoff time (sprints) */
  estimatedPayoffSprints: number;

  /** Debt-to-capacity ratio */
  debtRatio: number;

  /** Health score (0-100) */
  healthScore: number;
}

/**
 * Trend data point
 */
export interface DebtTrend {
  date: Date;
  totalPrincipal: number;
  totalInterest: number;
  itemCount: number;
  newItems: number;
  resolvedItems: number;
}

/**
 * Recommendation for debt management
 */
export interface DebtRecommendation {
  id: string;
  type: 'immediate' | 'short_term' | 'long_term';
  title: string;
  description: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
  priority: number;
  relatedItems: string[]; // Debt item IDs
}

/**
 * Complete debt dashboard
 */
export interface DebtDashboard {
  /** High-level summary */
  summary: DebtSummary;

  /** Breakdown by category */
  byCategory: Record<DebtCategory, DebtCategorySummary>;

  /** Historical trends */
  trends: DebtTrend[];

  /** Actionable recommendations */
  recommendations: DebtRecommendation[];

  /** Last updated */
  lastUpdated: Date;

  /** Data quality score */
  dataQuality: number;
}

// ============================================================================
// DEBT DETECTOR IMPLEMENTATIONS
// ============================================================================

/**
 * Detect complexity-related debt
 */
export function createComplexityDetector(
  config: DetectorConfig
): DebtDetector {
  return {
    id: 'complexity-detector',
    name: 'Complexity Detector',
    type: 'complexity',
    description: 'Detects functions and files with high cyclomatic complexity',
    confidence: 0.85,
    enabled: true,
    detect: async (codebasePath: string): Promise<TechnicalDebtItem[]> => {
      // In a real implementation, this would analyze the codebase
      // For now, return an empty array as a placeholder
      const items: TechnicalDebtItem[] = [];

      // Analysis would go here:
      // 1. Parse files in codebasePath
      // 2. Calculate cyclomatic complexity
      // 3. Compare against thresholds
      // 4. Create TechnicalDebtItem for violations

      return items;
    },
  };
}

/**
 * Detect code duplication
 */
export function createDuplicationDetector(
  config: DetectorConfig
): DebtDetector {
  return {
    id: 'duplication-detector',
    name: 'Duplication Detector',
    type: 'duplication',
    description: 'Detects duplicated code blocks across the codebase',
    confidence: 0.90,
    enabled: true,
    detect: async (codebasePath: string): Promise<TechnicalDebtItem[]> => {
      const items: TechnicalDebtItem[] = [];

      // Analysis would go here:
      // 1. Use AST-based or token-based clone detection
      // 2. Find similar code blocks
      // 3. Calculate duplication metrics
      // 4. Create TechnicalDebtItem for significant duplicates

      return items;
    },
  };
}

/**
 * Detect outdated dependencies
 */
export function createOutdatedDependencyDetector(
  config: DetectorConfig
): DebtDetector {
  return {
    id: 'outdated-deps-detector',
    name: 'Outdated Dependency Detector',
    type: 'outdated_dependency',
    description: 'Detects outdated package dependencies',
    confidence: 0.95,
    enabled: true,
    detect: async (codebasePath: string): Promise<TechnicalDebtItem[]> => {
      const items: TechnicalDebtItem[] = [];

      // Analysis would go here:
      // 1. Read package.json or equivalent
      // 2. Check npm registry for latest versions
      // 3. Compare with current versions
      // 4. Check for security advisories
      // 5. Create TechnicalDebtItem for outdated deps

      return items;
    },
  };
}

/**
 * Detect missing test coverage
 */
export function createMissingTestsDetector(
  config: DetectorConfig
): DebtDetector {
  return {
    id: 'missing-tests-detector',
    name: 'Missing Tests Detector',
    type: 'missing_tests',
    description: 'Detects code with insufficient test coverage',
    confidence: 0.80,
    enabled: true,
    detect: async (codebasePath: string): Promise<TechnicalDebtItem[]> => {
      const items: TechnicalDebtItem[] = [];

      // Analysis would go here:
      // 1. Run test coverage analysis
      // 2. Identify uncovered code paths
      // 3. Prioritize by code criticality
      // 4. Create TechnicalDebtItem for coverage gaps

      return items;
    },
  };
}

// ============================================================================
// ROI CALCULATOR
// ============================================================================

/**
 * Calculate the return on investment for fixing a debt item
 *
 * ROI = (Interest Saved over Time) / (Principal Cost to Fix)
 *
 * Higher ROI means better value for the time investment
 */
export function calculateDebtROI(
  item: TechnicalDebtItem,
  timeHorizonSprints: number = 12
): number {
  const { principalCost, interestRate } = item;

  if (principalCost <= 0) {
    return 0;
  }

  // Calculate total interest over the time horizon
  // Using compound interest: totalInterest = principal * ((1 + rate)^n - 1)
  // But for debt interest, we use simpler accumulation
  const interestPerSprint = principalCost * (interestRate - 1);
  const totalInterestSaved = interestPerSprint * timeHorizonSprints;

  // ROI as a ratio
  const roi = totalInterestSaved / principalCost;

  return Math.max(0, roi);
}

/**
 * Calculate risk score for a debt item
 *
 * Risk is based on:
 * - Severity of the debt
 * - Number of affected files
 * - How long it's been unaddressed
 * - Interest rate (growth potential)
 */
export function calculateDebtRisk(item: TechnicalDebtItem): number {
  const severityScores: Record<DebtSeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  };

  const severityScore = severityScores[item.severity];

  // File impact factor (more files = more risk)
  const fileImpact = Math.min(1, item.affectedFiles.length / 20);

  // Age factor (older debt is riskier)
  const ageMs = Date.now() - item.createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const ageFactor = Math.min(1, ageDays / 365); // Max out at 1 year

  // Interest rate factor (faster growing debt is riskier)
  const interestFactor = Math.min(1, (item.interestRate - 1) * 10);

  // Weighted combination
  const riskScore =
    severityScore * 0.4 +
    fileImpact * 0.2 +
    ageFactor * 0.2 +
    interestFactor * 0.2;

  return Math.min(100, Math.max(0, riskScore * 100));
}

/**
 * Rank debt items by combined value (ROI + Risk)
 */
export function rankDebtByValue(
  items: TechnicalDebtItem[],
  roiWeight: number = 0.6,
  riskWeight: number = 0.4
): TechnicalDebtItem[] {
  const scored = items.map(item => ({
    item,
    roi: calculateDebtROI(item),
    risk: calculateDebtRisk(item),
  }));

  // Normalize scores
  const maxROI = Math.max(...scored.map(s => s.roi), 1);
  const maxRisk = Math.max(...scored.map(s => s.risk), 1);

  const ranked = scored
    .map(s => ({
      ...s,
      normalizedROI: s.roi / maxROI,
      normalizedRisk: s.risk / maxRisk,
      totalScore:
        (s.roi / maxROI) * roiWeight + (s.risk / maxRisk) * riskWeight,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  return ranked.map(r => r.item);
}

// ============================================================================
// PAYDOWN SCHEDULER
// ============================================================================

/**
 * Create a paydown plan given a time budget
 *
 * Uses a greedy algorithm to maximize value within the budget
 */
export function createPaydownPlan(
  items: TechnicalDebtItem[],
  budgetHours: number,
  options: PaydownOptions = {}
): PaydownPlan {
  const {
    roiWeight = 0.6,
    riskWeight = 0.4,
    timeHorizonSprints = 12,
  } = options;

  // Filter to only addressable items
  const addressableItems = items.filter(
    item => item.status !== 'resolved' && item.status !== 'in_progress'
  );

  // Score all items
  const scoredItems = addressableItems.map(item => {
    const roi = calculateDebtROI(item, timeHorizonSprints);
    const risk = calculateDebtRisk(item);
    const valuePerHour =
      (roi * roiWeight + risk / 100 * riskWeight) / Math.max(1, item.principalCost);

    return {
      item,
      roi,
      risk,
      valuePerHour,
      estimatedHours: item.principalCost,
    };
  });

  // Sort by value per hour (best bang for buck)
  scoredItems.sort((a, b) => b.valuePerHour - a.valuePerHour);

  // Greedily select items within budget
  const selectedItems: PaydownPlanItem[] = [];
  let remainingBudget = budgetHours;
  let totalInterestSaved = 0;
  let totalRiskReduction = 0;

  for (const scored of scoredItems) {
    if (scored.estimatedHours <= remainingBudget) {
      selectedItems.push({
        item: scored.item,
        priority: selectedItems.length + 1,
        estimatedHours: scored.estimatedHours,
        expectedValue: scored.valuePerHour * scored.estimatedHours,
        rationale: generateRationale(scored.item, scored.roi, scored.risk),
      });

      remainingBudget -= scored.estimatedHours;
      totalInterestSaved +=
        scored.item.principalCost * (scored.item.interestRate - 1);
      totalRiskReduction += scored.risk;
    }
  }

  return {
    items: selectedItems,
    totalHours: budgetHours - remainingBudget,
    expectedInterestSaved: totalInterestSaved,
    expectedRiskReduction: totalRiskReduction / Math.max(1, selectedItems.length),
    confidence: calculatePlanConfidence(selectedItems),
  };
}

export interface PaydownOptions {
  roiWeight?: number;
  riskWeight?: number;
  timeHorizonSprints?: number;
}

function generateRationale(
  item: TechnicalDebtItem,
  roi: number,
  risk: number
): string {
  const parts: string[] = [];

  if (roi > 2) {
    parts.push('High ROI - pays for itself quickly');
  } else if (roi > 1) {
    parts.push('Good ROI');
  }

  if (risk > 75) {
    parts.push('Critical risk if unaddressed');
  } else if (risk > 50) {
    parts.push('Significant risk');
  }

  if (item.severity === 'critical') {
    parts.push('Critical severity');
  }

  if (item.affectedFiles.length > 10) {
    parts.push(`Affects ${item.affectedFiles.length} files`);
  }

  return parts.join('. ') || 'Standard priority debt item';
}

function calculatePlanConfidence(items: PaydownPlanItem[]): number {
  if (items.length === 0) return 1.0;

  // Average confidence of all items
  const totalConfidence = items.reduce((sum, planItem) => {
    return sum + planItem.item.confidence.score;
  }, 0);

  return totalConfidence / items.length;
}

// ============================================================================
// PREVENTION POLICY VALIDATOR
// ============================================================================

/**
 * Validate code changes against a debt prevention policy
 */
export async function validateAgainstPolicy(
  context: CheckContext
): Promise<PolicyValidationResult> {
  const results: CheckResult[] = [];
  const failedChecks: string[] = [];
  const warnings: string[] = [];

  for (const check of context.config.definitionOfDone) {
    const result = await check.check(context);
    results.push(result);

    if (!result.passed) {
      if (check.severity === 'blocking') {
        failedChecks.push(check.name);
      } else if (check.severity === 'warning') {
        warnings.push(check.name);
      }
    }
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    warnings,
    results,
    canProceed:
      !context.config.blockOnFailure || failedChecks.length === 0,
  };
}

export interface PolicyValidationResult {
  passed: boolean;
  failedChecks: string[];
  warnings: string[];
  results: CheckResult[];
  canProceed: boolean;
}

/**
 * Validate complexity budget
 */
export function validateComplexityBudget(
  metrics: CodeMetrics,
  budget: ComplexityBudget
): ComplexityValidationResult {
  const violations: ComplexityViolation[] = [];

  if (metrics.cyclomaticComplexity > budget.maxCyclomaticComplexity) {
    violations.push({
      type: 'cyclomatic_complexity',
      actual: metrics.cyclomaticComplexity,
      budget: budget.maxCyclomaticComplexity,
      severity: getSeverity(
        metrics.cyclomaticComplexity,
        budget.maxCyclomaticComplexity
      ),
    });
  }

  if (metrics.fileLines > budget.maxFileLines) {
    violations.push({
      type: 'file_lines',
      actual: metrics.fileLines,
      budget: budget.maxFileLines,
      severity: getSeverity(metrics.fileLines, budget.maxFileLines),
    });
  }

  if (metrics.functionLines > budget.maxFunctionLines) {
    violations.push({
      type: 'function_lines',
      actual: metrics.functionLines,
      budget: budget.maxFunctionLines,
      severity: getSeverity(metrics.functionLines, budget.maxFunctionLines),
    });
  }

  if (metrics.dependencies > budget.maxDependencies) {
    violations.push({
      type: 'dependencies',
      actual: metrics.dependencies,
      budget: budget.maxDependencies,
      severity: getSeverity(metrics.dependencies, budget.maxDependencies),
    });
  }

  if (metrics.nestingDepth > budget.maxNestingDepth) {
    violations.push({
      type: 'nesting_depth',
      actual: metrics.nestingDepth,
      budget: budget.maxNestingDepth,
      severity: getSeverity(metrics.nestingDepth, budget.maxNestingDepth),
    });
  }

  if (metrics.parameters > budget.maxParameters) {
    violations.push({
      type: 'parameters',
      actual: metrics.parameters,
      budget: budget.maxParameters,
      severity: getSeverity(metrics.parameters, budget.maxParameters),
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    score: calculateComplexityScore(metrics, budget),
  };
}

export interface CodeMetrics {
  cyclomaticComplexity: number;
  fileLines: number;
  functionLines: number;
  dependencies: number;
  nestingDepth: number;
  parameters: number;
}

export interface ComplexityValidationResult {
  passed: boolean;
  violations: ComplexityViolation[];
  score: number;
}

export interface ComplexityViolation {
  type: string;
  actual: number;
  budget: number;
  severity: DebtSeverity;
}

function getSeverity(actual: number, budget: number): DebtSeverity {
  const ratio = actual / budget;
  if (ratio >= 2) return 'critical';
  if (ratio >= 1.5) return 'high';
  if (ratio >= 1.25) return 'medium';
  return 'low';
}

function calculateComplexityScore(
  metrics: CodeMetrics,
  budget: ComplexityBudget
): number {
  const scores = [
    1 - Math.min(1, metrics.cyclomaticComplexity / budget.maxCyclomaticComplexity),
    1 - Math.min(1, metrics.fileLines / budget.maxFileLines),
    1 - Math.min(1, metrics.functionLines / budget.maxFunctionLines),
    1 - Math.min(1, metrics.dependencies / budget.maxDependencies),
    1 - Math.min(1, metrics.nestingDepth / budget.maxNestingDepth),
    1 - Math.min(1, metrics.parameters / budget.maxParameters),
  ];

  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.round(average * 100);
}

// ============================================================================
// DASHBOARD GENERATION
// ============================================================================

/**
 * Generate a debt dashboard from an inventory
 */
export function generateDebtDashboard(
  inventory: DebtInventory,
  history: DebtTrend[]
): DebtDashboard {
  const summary = generateDebtSummary(inventory);
  const recommendations = generateRecommendations(inventory, history);

  return {
    summary,
    byCategory: inventory.byCategory,
    trends: history,
    recommendations,
    lastUpdated: new Date(),
    dataQuality: calculateDataQuality(inventory),
  };
}

function generateDebtSummary(inventory: DebtInventory): DebtSummary {
  const byStatus: Record<DebtStatus, number> = {
    identified: 0,
    accepted: 0,
    scheduled: 0,
    in_progress: 0,
    resolved: 0,
  };

  for (const item of inventory.items) {
    byStatus[item.status]++;
  }

  // Assume 40 hours per sprint capacity for debt work
  const sprintCapacity = 40;
  const estimatedPayoffSprints =
    inventory.totalPrincipal / Math.max(1, sprintCapacity);

  const debtRatio = inventory.totalInterest / sprintCapacity;
  const healthScore = Math.max(0, 100 - debtRatio * 20);

  return {
    totalItems: inventory.items.length,
    byStatus,
    totalPrincipal: inventory.totalPrincipal,
    totalInterestPerSprint: inventory.totalInterest,
    estimatedPayoffSprints: Math.ceil(estimatedPayoffSprints),
    debtRatio,
    healthScore: Math.round(healthScore),
  };
}

function generateRecommendations(
  inventory: DebtInventory,
  history: DebtTrend[]
): DebtRecommendation[] {
  const recommendations: DebtRecommendation[] = [];

  // Check for critical items
  const criticalItems = inventory.items.filter(i => i.severity === 'critical');
  if (criticalItems.length > 0) {
    recommendations.push({
      id: 'address-critical',
      type: 'immediate',
      title: 'Address Critical Debt Items',
      description: `${criticalItems.length} critical debt items require immediate attention`,
      expectedImpact: 'Significant risk reduction',
      effort: criticalItems.length > 5 ? 'high' : 'medium',
      priority: 1,
      relatedItems: criticalItems.map(i => i.id),
    });
  }

  // Check for increasing trend
  if (
    history.length >= 2 &&
    history[history.length - 1].totalPrincipal >
      history[history.length - 2].totalPrincipal * 1.1
  ) {
    recommendations.push({
      id: 'control-debt-growth',
      type: 'short_term',
      title: 'Control Debt Growth',
      description:
        'Technical debt is growing faster than it is being addressed. Consider allocating more capacity to debt reduction.',
      expectedImpact: 'Stabilize debt levels',
      effort: 'medium',
      priority: 2,
      relatedItems: [],
    });
  }

  // Check for high interest items
  const highInterestItems = inventory.items.filter(
    i => i.interestRate > 1.2 && i.status !== 'resolved'
  );
  if (highInterestItems.length > 0) {
    recommendations.push({
      id: 'address-high-interest',
      type: 'short_term',
      title: 'Prioritize High-Interest Debt',
      description: `${highInterestItems.length} debt items have high interest rates (>20% per sprint)`,
      expectedImpact: 'Reduce ongoing costs',
      effort: 'medium',
      priority: 3,
      relatedItems: highInterestItems.slice(0, 5).map(i => i.id),
    });
  }

  // Check for old unaddressed items
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const staleItems = inventory.items.filter(
    i =>
      i.status === 'identified' &&
      i.createdAt < oneMonthAgo
  );
  if (staleItems.length > 0) {
    recommendations.push({
      id: 'triage-stale-items',
      type: 'short_term',
      title: 'Triage Stale Debt Items',
      description: `${staleItems.length} debt items have been open for over a month without action`,
      expectedImpact: 'Better debt visibility and planning',
      effort: 'low',
      priority: 4,
      relatedItems: staleItems.slice(0, 10).map(i => i.id),
    });
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}

function calculateDataQuality(inventory: DebtInventory): number {
  if (inventory.items.length === 0) return 1.0;

  // Average confidence of all items
  const totalConfidence = inventory.items.reduce((sum, item) => {
    return sum + item.confidence.score;
  }, 0);

  return totalConfidence / inventory.items.length;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default complexity budget - suitable for most projects
 */
export const DEFAULT_COMPLEXITY_BUDGET: ComplexityBudget = {
  maxCyclomaticComplexity: 10,
  maxFileLines: 400,
  maxFunctionLines: 50,
  maxDependencies: 15,
  maxNestingDepth: 4,
  maxParameters: 5,
};

/**
 * Strict complexity budget - for high-quality codebases
 */
export const STRICT_COMPLEXITY_BUDGET: ComplexityBudget = {
  maxCyclomaticComplexity: 5,
  maxFileLines: 200,
  maxFunctionLines: 30,
  maxDependencies: 10,
  maxNestingDepth: 3,
  maxParameters: 4,
};

/**
 * Default dependency policy
 */
export const DEFAULT_DEPENDENCY_POLICY: DependencyPolicy = {
  checkFrequency: 'weekly',
  maxDependencyAge: 365,
  alwaysLatest: [],
  pinnedVersions: {},
  blocklist: [],
  allowedLicenses: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'],
};

/**
 * Default debt prevention policy
 */
export const DEFAULT_PREVENTION_POLICY: DebtPreventionPolicy = {
  definitionOfDone: [],
  complexityBudgets: DEFAULT_COMPLEXITY_BUDGET,
  dependencyPolicy: DEFAULT_DEPENDENCY_POLICY,
  reviewGates: [],
  blockOnFailure: false,
  gracePeriodHours: 24,
};

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new technical debt item
 */
export function createDebtItem(
  input: CreateDebtItemInput
): TechnicalDebtItem {
  const now = new Date();

  return {
    id: input.id ?? generateId('debt'),
    title: input.title,
    description: input.description,
    type: input.type,
    category: input.category,
    severity: input.severity,
    intentional: input.intentional ?? false,
    interestRate: input.interestRate ?? 1.1,
    principalCost: input.principalCost,
    affectedFiles: input.affectedFiles ?? [],
    createdAt: input.createdAt ?? now,
    discoveredAt: input.discoveredAt ?? now,
    discoveredBy: input.discoveredBy ?? 'manual',
    status: 'identified',
    tags: input.tags ?? [],
    evidence: input.evidence ?? [],
    statusHistory: [],
    confidence: input.confidence ?? {
      level: 'probable',
      score: 0.6,
      factors: [],
      lastAssessed: now.toISOString(),
      assessedBy: 'automated',
    },
  };
}

export interface CreateDebtItemInput {
  id?: string;
  title: string;
  description: string;
  type: DebtType;
  category: DebtCategory;
  severity: DebtSeverity;
  intentional?: boolean;
  interestRate?: number;
  principalCost: number;
  affectedFiles?: string[];
  createdAt?: Date;
  discoveredAt?: Date;
  discoveredBy?: DiscoveryMethod;
  tags?: string[];
  evidence?: DebtEvidence[];
  confidence?: ConfidenceAssessment;
}

/**
 * Create a debt inventory from a list of items
 */
export function createDebtInventory(
  items: TechnicalDebtItem[]
): DebtInventory {
  const byCategory: Record<DebtCategory, DebtCategorySummary> = {
    complexity: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    duplication: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    outdated_dependency: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    missing_tests: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    poor_naming: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    tight_coupling: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    missing_docs: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    workaround: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
    deprecated_usage: { count: 0, totalPrincipal: 0, totalInterest: 0, averageSeverity: 0, oldestItem: null },
  };

  const byType: Record<DebtType, number> = {
    code: 0,
    architecture: 0,
    infrastructure: 0,
    process: 0,
    documentation: 0,
    dependency: 0,
  };

  const bySeverity: Record<DebtSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const severityScores: Record<DebtSeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  };

  let totalPrincipal = 0;
  let totalInterest = 0;

  for (const item of items) {
    if (item.status === 'resolved') continue;

    totalPrincipal += item.principalCost;
    totalInterest += item.principalCost * (item.interestRate - 1);

    byType[item.type]++;
    bySeverity[item.severity]++;

    const catSummary = byCategory[item.category];
    catSummary.count++;
    catSummary.totalPrincipal += item.principalCost;
    catSummary.totalInterest += item.principalCost * (item.interestRate - 1);
    catSummary.averageSeverity =
      (catSummary.averageSeverity * (catSummary.count - 1) +
        severityScores[item.severity]) /
      catSummary.count;

    if (!catSummary.oldestItem || item.createdAt < catSummary.oldestItem) {
      catSummary.oldestItem = item.createdAt;
    }
  }

  // Determine trend based on recent status changes
  const recentResolved = items.filter(
    i =>
      i.status === 'resolved' &&
      i.statusHistory.some(
        sh =>
          sh.to === 'resolved' &&
          new Date(sh.changedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
      )
  ).length;

  const recentAdded = items.filter(
    i => i.createdAt.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
  ).length;

  let trend: DebtTrendDirection = 'stable';
  if (recentAdded > recentResolved * 1.5) {
    trend = 'increasing';
  } else if (recentResolved > recentAdded * 1.5) {
    trend = 'decreasing';
  }

  return {
    items,
    totalPrincipal,
    totalInterest,
    trend,
    lastAuditDate: new Date(),
    byCategory,
    byType,
    bySeverity,
  };
}

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================================================
// PRIORITIZATION IMPLEMENTATION
// ============================================================================

/**
 * Create a debt prioritization engine
 */
export function createDebtPrioritization(
  options: DebtPrioritizationOptions = {}
): DebtPrioritization {
  const {
    roiWeight = 0.6,
    riskWeight = 0.4,
    timeHorizonSprints = 12,
  } = options;

  return {
    calculateROI(item: TechnicalDebtItem): number {
      return calculateDebtROI(item, timeHorizonSprints);
    },

    calculateRiskScore(item: TechnicalDebtItem): number {
      return calculateDebtRisk(item);
    },

    rankByValue(items: TechnicalDebtItem[]): TechnicalDebtItem[] {
      return rankDebtByValue(items, roiWeight, riskWeight);
    },

    suggestPaydownOrder(
      items: TechnicalDebtItem[],
      budgetHours: number
    ): PaydownPlan {
      return createPaydownPlan(items, budgetHours, {
        roiWeight,
        riskWeight,
        timeHorizonSprints,
      });
    },
  };
}

export interface DebtPrioritizationOptions {
  roiWeight?: number;
  riskWeight?: number;
  timeHorizonSprints?: number;
}

// ============================================================================
// LIBRARIAN-ENHANCED DEBT DETECTION
// ============================================================================

import type { LiBrainian } from '../api/librainian.js';
import type { LiBrainianResponse, LlmOptional, ContextPack } from '../types.js';
import type { EvidenceRef } from '../api/evidence.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { bounded, absent, deriveSequentialConfidence, getNumericValue } from '../epistemics/confidence.js';

/**
 * Semantic debt indicator discovered through librainian analysis.
 */
export interface SemanticDebtIndicator {
  /** Type of debt indicator */
  type:
    | 'complexity_hotspot'
    | 'coupling_issue'
    | 'abstraction_leak'
    | 'code_smell'
    | 'outdated_pattern'
    | 'inconsistent_style'
    | 'magic_number'
    | 'god_object'
    | 'feature_envy'
    | 'shotgun_surgery';
  /** Description of the indicator */
  description: string;
  /** File path where indicator was found */
  filePath: string;
  /** Function or class name */
  entityName?: string;
  /** Line number where indicator was found */
  line?: number;
  /** Estimated complexity score */
  complexityScore?: number;
  /** Suggested debt type */
  suggestedDebtType: DebtType;
  /** Suggested debt category */
  suggestedCategory: DebtCategory;
  /** Estimated severity */
  estimatedSeverity: DebtSeverity;
  /** Estimated hours to fix */
  estimatedPrincipal: number;
  /** Estimated interest rate */
  estimatedInterestRate: number;
  /** Evidence supporting this finding */
  evidence: EvidenceRef[];
}

/**
 * Result of librainian-enhanced debt detection.
 */
export interface LiBrainianEnhancedDebtDetection {
  /** Semantic debt indicators found through code analysis */
  indicators: SemanticDebtIndicator[];
  /** Suggested debt items to add to inventory */
  suggestedItems: Partial<TechnicalDebtItem>[];
  /** Overall confidence in the detection */
  confidence: ConfidenceValue;
  /** Evidence references for traceability */
  evidenceRefs: EvidenceRef[];
  /** Whether librainian was available for semantic analysis */
  librainianAvailable: boolean;
  /** LiBrainian query trace ID */
  traceId?: string;
  /** Summary of detected debt patterns */
  summary: {
    complexityIssues: number;
    couplingIssues: number;
    codeSmells: number;
    outdatedPatterns: number;
    estimatedTotalHours: number;
  };
}

/**
 * Analyze code for debt indicators using librainian semantic analysis.
 */
async function analyzeCodeForDebtIndicators(
  librainian: LiBrainian
): Promise<{ indicators: SemanticDebtIndicator[]; evidenceRefs: EvidenceRef[] }> {
  const indicators: SemanticDebtIndicator[] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Query librainian for technical debt patterns
  const queryResult = await librainian.queryOptional({
    intent: 'Find technical debt patterns and code quality issues. ' +
            'Look for: high complexity functions, tight coupling between modules, ' +
            'god classes, feature envy, code smells, outdated patterns, ' +
            'magic numbers, inconsistent code styles, and abstraction leaks.',
    depth: 'L2',
    taskType: 'understand',
  });

  if (!queryResult || !queryResult.packs || queryResult.packs.length === 0) {
    return { indicators, evidenceRefs };
  }

  // Analyze packs for debt indicators
  for (const pack of queryResult.packs) {
    for (const snippet of pack.codeSnippets) {
      const content = snippet.content;
      const contentLower = content.toLowerCase();
      const snippetIndicators = analyzeSnippetForDebt(snippet, pack, content, contentLower);
      indicators.push(...snippetIndicators);

      // Build evidence refs
      evidenceRefs.push({
        file: snippet.filePath,
        line: snippet.startLine,
        endLine: snippet.endLine,
        snippet: content.slice(0, 300),
        claim: pack.summary.slice(0, 100),
        confidence: pack.confidence > 0.7 ? 'verified' : 'inferred',
      });
    }
  }

  return { indicators, evidenceRefs };
}

/**
 * Analyze a code snippet for technical debt indicators.
 */
function analyzeSnippetForDebt(
  snippet: { filePath: string; startLine: number; endLine: number; content: string },
  pack: ContextPack,
  content: string,
  contentLower: string
): SemanticDebtIndicator[] {
  const indicators: SemanticDebtIndicator[] = [];
  const lines = snippet.endLine - snippet.startLine + 1;

  // Check for complexity hotspots
  const nestingDepth = (content.match(/\{/g) || []).length;
  const conditionCount = (contentLower.match(/if\s*\(|else\s*if|switch\s*\(|case\s+|while\s*\(|for\s*\(/g) || []).length;
  const complexityScore = nestingDepth * 0.5 + conditionCount * 2;

  if (complexityScore > 15 || lines > 100) {
    indicators.push({
      type: 'complexity_hotspot',
      description: `High complexity code: ${conditionCount} conditionals, ${nestingDepth} nesting levels, ${lines} lines`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      complexityScore,
      suggestedDebtType: 'code',
      suggestedCategory: 'complexity',
      estimatedSeverity: complexityScore > 25 ? 'high' : 'medium',
      estimatedPrincipal: Math.ceil(complexityScore / 5) * 2, // Hours
      estimatedInterestRate: 1.1 + (complexityScore / 100), // Higher interest for more complex code
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: content.slice(0, 200),
        claim: `Complexity score ${complexityScore.toFixed(1)}`,
        confidence: 'inferred',
      }],
    });
  }

  // Check for magic numbers
  const magicNumbers = content.match(/[^a-zA-Z0-9_]\d{2,}[^a-zA-Z0-9_]/g) || [];
  if (magicNumbers.length > 2) {
    indicators.push({
      type: 'magic_number',
      description: `${magicNumbers.length} magic numbers found without named constants`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      suggestedDebtType: 'code',
      suggestedCategory: 'poor_naming',
      estimatedSeverity: 'low',
      estimatedPrincipal: 0.5 * magicNumbers.length,
      estimatedInterestRate: 1.05,
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: content.slice(0, 200),
        claim: `Magic numbers: ${magicNumbers.slice(0, 3).join(', ')}`,
        confidence: 'verified',
      }],
    });
  }

  // Check for potential code duplication patterns
  if (pack.summary.toLowerCase().includes('duplicate') ||
      pack.summary.toLowerCase().includes('similar') ||
      pack.summary.toLowerCase().includes('copy')) {
    indicators.push({
      type: 'code_smell',
      description: `Potential code duplication detected: ${pack.summary.slice(0, 100)}`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      suggestedDebtType: 'code',
      suggestedCategory: 'duplication',
      estimatedSeverity: 'medium',
      estimatedPrincipal: 4,
      estimatedInterestRate: 1.15,
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: pack.summary.slice(0, 200),
        claim: 'Code duplication pattern detected',
        confidence: 'inferred',
      }],
    });
  }

  // Check for tight coupling indicators
  const importCount = (content.match(/import\s+/g) || []).length;
  const newCount = (content.match(/new\s+[A-Z]/g) || []).length;
  if (importCount > 10 || newCount > 5) {
    indicators.push({
      type: 'coupling_issue',
      description: `High coupling detected: ${importCount} imports, ${newCount} direct instantiations`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      suggestedDebtType: 'architecture',
      suggestedCategory: 'tight_coupling',
      estimatedSeverity: importCount > 15 ? 'high' : 'medium',
      estimatedPrincipal: 8,
      estimatedInterestRate: 1.2,
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: content.slice(0, 200),
        claim: `${importCount} imports, ${newCount} direct instantiations`,
        confidence: 'inferred',
      }],
    });
  }

  // Check for TODO/FIXME/HACK comments
  const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[:\s].*/gi) || [];
  for (const match of todoMatches.slice(0, 3)) { // Limit to 3
    indicators.push({
      type: 'code_smell',
      description: `Workaround marker found: ${match.slice(0, 80)}`,
      filePath: snippet.filePath,
      line: snippet.startLine,
      suggestedDebtType: 'code',
      suggestedCategory: 'workaround',
      estimatedSeverity: match.toLowerCase().includes('hack') ? 'medium' : 'low',
      estimatedPrincipal: 2,
      estimatedInterestRate: 1.1,
      evidence: [{
        file: snippet.filePath,
        line: snippet.startLine,
        snippet: match,
        claim: 'TODO/FIXME marker indicates known debt',
        confidence: 'verified',
      }],
    });
  }

  return indicators;
}

/**
 * Convert semantic debt indicators to partial debt items for inventory.
 */
function convertIndicatorsToItems(
  indicators: SemanticDebtIndicator[]
): Partial<TechnicalDebtItem>[] {
  return indicators.map((indicator) => ({
    title: `${indicator.type}: ${indicator.description.slice(0, 50)}`,
    description: indicator.description,
    type: indicator.suggestedDebtType,
    category: indicator.suggestedCategory,
    severity: indicator.estimatedSeverity,
    intentional: false,
    interestRate: indicator.estimatedInterestRate,
    principalCost: indicator.estimatedPrincipal,
    affectedFiles: [indicator.filePath],
    discoveredBy: 'automated' as DiscoveryMethod,
    status: 'identified' as DebtStatus,
    tags: [indicator.type, 'semantic-detection'],
    evidence: indicator.evidence.map((e) => ({
      type: 'code_sample' as const,
      description: e.claim,
      source: e.file,
      collectedAt: new Date(),
    })),
  }));
}

/**
 * Detect technical debt using librainian-enhanced semantic analysis.
 *
 * This function uses complexity analysis from the librainian to identify
 * technical debt patterns that traditional static analysis might miss.
 * It analyzes code for complexity hotspots, coupling issues, code smells,
 * and other debt indicators, then suggests debt items for the inventory.
 *
 * @param librainian - LiBrainian instance for semantic analysis
 * @returns Enhanced debt detection result with semantic findings
 *
 * @example
 * ```typescript
 * const result = await detectDebtWithLiBrainian(librainian);
 * console.log(result.indicators); // Debt indicators found
 * console.log(result.suggestedItems); // Items to add to inventory
 * console.log(result.summary); // Summary by category
 * ```
 */
export async function detectDebtWithLiBrainian(
  librainian: LiBrainian
): Promise<LiBrainianEnhancedDebtDetection> {
  // Perform librainian-enhanced analysis
  let indicators: SemanticDebtIndicator[] = [];
  let evidenceRefs: EvidenceRef[] = [];
  let librainianAvailable = false;
  let traceId: string | undefined;

  try {
    const analysis = await analyzeCodeForDebtIndicators(librainian);
    indicators = analysis.indicators;
    evidenceRefs = analysis.evidenceRefs;
    librainianAvailable = true;

    // Get trace ID
    const statusQuery = await librainian.queryOptional({
      intent: 'Technical debt detection trace',
      depth: 'L0',
    });
    traceId = statusQuery?.traceId;
  } catch {
    // LiBrainian query failed
    librainianAvailable = false;
  }

  // Convert indicators to suggested debt items
  const suggestedItems = convertIndicatorsToItems(indicators);

  // Calculate summary
  const summary = {
    complexityIssues: indicators.filter(i => i.type === 'complexity_hotspot').length,
    couplingIssues: indicators.filter(i => i.type === 'coupling_issue').length,
    codeSmells: indicators.filter(i => i.type === 'code_smell').length,
    outdatedPatterns: indicators.filter(i => i.type === 'outdated_pattern').length,
    estimatedTotalHours: indicators.reduce((sum, i) => sum + i.estimatedPrincipal, 0),
  };

  // Derive confidence
  const confidence = librainianAvailable
    ? bounded(
        0.5,
        0.75,
        'literature',
        'Semantic debt detection identifies patterns but requires human validation'
      )
    : absent('uncalibrated');

  return {
    indicators,
    suggestedItems,
    confidence,
    evidenceRefs,
    librainianAvailable,
    traceId,
    summary,
  };
}
