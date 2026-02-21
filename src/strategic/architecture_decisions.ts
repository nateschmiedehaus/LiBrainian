/**
 * @fileoverview Architecture Decision Framework
 *
 * Provides a comprehensive framework for documenting, analyzing, and validating
 * architecture decisions in world-class software development.
 *
 * Key Components:
 *
 * 1. **Architecture Decision Records (ADRs)**: Structured documentation of
 *    significant architecture decisions with full traceability.
 *
 * 2. **Trade-off Analysis**: Systematic evaluation of quality attribute trade-offs
 *    with confidence tracking and transparent recommendations.
 *
 * 3. **Architecture Validation**: Constraint definition and drift detection to
 *    maintain architectural integrity over time.
 *
 * 4. **Pattern Guidance**: Evidence-based pattern recommendations with
 *    applicability contexts and anti-pattern warnings.
 *
 * Design Philosophy:
 *
 * - **Evidence-Based**: Every decision and recommendation has provenance
 * - **Epistemic Humility**: Confidence is tracked, uncertainty acknowledged
 * - **Transparent**: All trade-offs and alternatives are explicit
 * - **Maintainable**: Supports evolution and supersession of decisions
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from '../epistemics/confidence.js';
import { absent, bounded, deterministic } from '../epistemics/confidence.js';

// ============================================================================
// ARCHITECTURE DECISION RECORD (ADR)
// ============================================================================

/**
 * Status of an Architecture Decision Record in this framework.
 *
 * Lifecycle: proposed -> accepted -> (superseded | deprecated)
 *
 * Note: Named with 'Adf' prefix to distinguish from the similar AdfStatus in types.ts
 * which includes 'rejected' status.
 */
export type AdfStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated';

/**
 * An alternative approach that was considered but not chosen.
 */
export interface Alternative {
  /** Description of the alternative approach */
  description: string;
  /** Benefits of this alternative */
  pros: string[];
  /** Drawbacks of this alternative */
  cons: string[];
  /** Explanation of why this alternative was rejected */
  whyRejected: string;
}

/**
 * Architecture Decision Record (ADR) - A structured record of a significant
 * architecture decision.
 *
 * ADRs capture the context, decision, consequences, and alternatives for
 * important architectural choices, enabling future maintainers to understand
 * not just what was decided, but why.
 *
 * @example
 * ```typescript
 * const adr: ArchitectureDecisionRecord = {
 *   id: 'ADR-001',
 *   title: 'Use Event Sourcing for Order Management',
 *   status: 'accepted',
 *   context: 'Order state changes need full audit trail and temporal queries',
 *   decision: 'Implement event sourcing with CQRS for the order bounded context',
 *   consequences: {
 *     positive: ['Full audit trail', 'Temporal queries', 'Event replay'],
 *     negative: ['Increased complexity', 'Eventual consistency challenges'],
 *     neutral: ['Requires new team skills'],
 *   },
 *   alternatives: [...],
 *   confidence: bounded(0.7, 0.9, 'literature', 'Fowler CQRS pattern'),
 *   evidenceRefs: ['RFC-2024-001', 'spike-results.md'],
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface ArchitectureDecisionRecord {
  /** Unique identifier (e.g., 'ADR-001') */
  id: string;
  /** Human-readable title summarizing the decision */
  title: string;
  /** Current status of the decision */
  status: AdfStatus;
  /** Context explaining why this decision is needed */
  context: string;
  /** The actual decision that was made */
  decision: string;
  /** Expected consequences of the decision */
  consequences: {
    /** Benefits and positive outcomes */
    positive: string[];
    /** Drawbacks and risks */
    negative: string[];
    /** Neutral observations */
    neutral: string[];
  };
  /** Alternatives that were considered */
  alternatives: Alternative[];
  /** Confidence in the decision's correctness */
  confidence: ConfidenceValue;
  /** References to supporting evidence (RFCs, spikes, benchmarks) */
  evidenceRefs: string[];
  /** ID of the ADR this supersedes, if any */
  supersedes?: string;
  /** ID of the ADR that superseded this one, if any */
  supersededBy?: string;
  /** When the ADR was created */
  createdAt: Date;
  /** When the ADR was last updated */
  updatedAt: Date;
}

// ============================================================================
// TRADE-OFF ANALYSIS
// ============================================================================

/**
 * Software quality attributes used in trade-off analysis.
 *
 * Based on ISO 25010 with practical additions.
 */
export type QualityAttribute =
  | 'performance'
  | 'maintainability'
  | 'security'
  | 'scalability'
  | 'testability'
  | 'simplicity'
  | 'reliability'
  | 'portability'
  | 'usability';

/**
 * A cell in the trade-off matrix showing the impact of a decision
 * on a quality attribute.
 */
export interface TradeoffCell {
  /** The quality attribute being assessed */
  attribute: QualityAttribute;
  /** Impact score: -2 (strongly negative) to +2 (strongly positive) */
  impact: -2 | -1 | 0 | 1 | 2;
  /** Explanation of the impact */
  rationale: string;
  /** Confidence in this assessment */
  confidence: ConfidenceValue;
}

/**
 * A row in the trade-off matrix representing one option.
 */
export interface TradeoffRow {
  /** Identifier for this option */
  optionId: string;
  /** Description of the option */
  description: string;
  /** Impact assessments for each quality attribute */
  cells: TradeoffCell[];
  /** Overall weighted score for this option */
  weightedScore: number;
}

/**
 * The trade-off matrix comparing multiple options across quality attributes.
 */
export interface TradeoffMatrix {
  /** All options being compared */
  rows: TradeoffRow[];
  /** Weights for each quality attribute (should sum to 1.0) */
  weights: Map<QualityAttribute, number>;
  /** ID of the recommended option */
  recommendedOptionId: string;
}

/**
 * Complete trade-off analysis including matrix and recommendation.
 *
 * @example
 * ```typescript
 * const analysis: TradeoffAnalysis = {
 *   qualities: ['performance', 'maintainability', 'security'],
 *   matrix: {
 *     rows: [...],
 *     weights: new Map([['performance', 0.4], ['maintainability', 0.35], ['security', 0.25]]),
 *     recommendedOptionId: 'option-b',
 *   },
 *   recommendation: 'Option B provides the best balance of performance and maintainability',
 *   confidence: bounded(0.6, 0.8, 'theoretical', 'Based on ATAM analysis'),
 * };
 * ```
 */
export interface TradeoffAnalysis {
  /** Quality attributes being analyzed */
  qualities: QualityAttribute[];
  /** The trade-off matrix */
  matrix: TradeoffMatrix;
  /** Human-readable recommendation */
  recommendation: string;
  /** Confidence in the recommendation */
  confidence: ConfidenceValue;
}

// ============================================================================
// ARCHITECTURE VALIDATION
// ============================================================================

/**
 * Types of architecture constraints that can be defined.
 */
export type ConstraintType =
  | 'layer_dependency'
  | 'module_boundary'
  | 'naming_convention'
  | 'pattern_usage'
  | 'dependency_direction'
  | 'circular_dependency'
  | 'package_structure';

/**
 * Severity of a constraint violation.
 */
export type ConstraintSeverity = 'error' | 'warning' | 'info';

/**
 * An architecture constraint that the codebase should adhere to.
 *
 * @example
 * ```typescript
 * const constraint: ArchitectureConstraint = {
 *   id: 'AC-001',
 *   type: 'layer_dependency',
 *   rule: 'Domain layer must not depend on infrastructure layer',
 *   severity: 'error',
 *   rationale: 'Maintains clean architecture principles',
 *   scope: 'src/domain/**',
 * };
 * ```
 */
export interface ArchitectureConstraint {
  /** Unique identifier */
  id: string;
  /** Type of constraint */
  type: ConstraintType;
  /** Human-readable rule description */
  rule: string;
  /** Severity if violated */
  severity: ConstraintSeverity;
  /** Why this constraint exists */
  rationale?: string;
  /** Glob pattern for scope of constraint */
  scope?: string;
  /** Pattern to match (for naming conventions) */
  pattern?: string;
  /** Allowed dependencies (for layer constraints) */
  allowedDependencies?: string[];
  /** Forbidden dependencies (for layer constraints) */
  forbiddenDependencies?: string[];
}

/**
 * A specific violation of an architecture constraint.
 */
export interface ConstraintViolation {
  /** ID of the violated constraint */
  constraintId: string;
  /** File where the violation was found */
  file: string;
  /** Line number of the violation */
  line?: number;
  /** Description of the violation */
  message: string;
  /** Severity (inherited from constraint) */
  severity: ConstraintSeverity;
  /** Suggested fix */
  suggestion?: string;
  /** Additional context */
  context?: string;
}

/**
 * Estimate of technical debt from architecture drift.
 */
export interface TechnicalDebtEstimate {
  /** Total estimated hours to address all violations */
  totalHours: number;
  /** Breakdown by constraint type */
  byType: Map<ConstraintType, number>;
  /** Breakdown by severity */
  bySeverity: Map<ConstraintSeverity, number>;
  /** Confidence in the estimate */
  confidence: ConfidenceValue;
}

/**
 * Report on architecture drift and violations.
 *
 * @example
 * ```typescript
 * const report: ArchitectureDriftReport = {
 *   constraints: [...],
 *   violations: [...],
 *   technicalDebtEstimate: { totalHours: 40, ... },
 *   recommendations: ['Refactor payment module to remove circular dependency'],
 *   generatedAt: new Date(),
 * };
 * ```
 */
export interface ArchitectureDriftReport {
  /** All constraints that were checked */
  constraints: ArchitectureConstraint[];
  /** All violations found */
  violations: ConstraintViolation[];
  /** Estimated technical debt */
  technicalDebtEstimate: TechnicalDebtEstimate;
  /** Prioritized recommendations */
  recommendations: string[];
  /** When this report was generated */
  generatedAt: Date;
  /** Summary statistics */
  summary: {
    totalConstraints: number;
    totalViolations: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

// ============================================================================
// PATTERN GUIDANCE
// ============================================================================

/**
 * Evidence for a pattern recommendation.
 */
export interface PatternEvidence {
  /** Type of evidence */
  type: 'literature' | 'case_study' | 'benchmark' | 'team_experience';
  /** Reference or description */
  reference: string;
  /** How strongly this supports the recommendation */
  strength: 'strong' | 'moderate' | 'weak';
}

/**
 * An anti-pattern warning.
 */
export interface AntiPatternWarning {
  /** Name of the anti-pattern */
  name: string;
  /** Description of why it's problematic */
  description: string;
  /** Symptoms that indicate this anti-pattern */
  symptoms: string[];
  /** How to avoid or refactor away from it */
  remediation: string;
}

/**
 * A code example demonstrating a pattern.
 */
export interface PatternExample {
  /** Title of the example */
  title: string;
  /** Code snippet or file reference */
  code: string;
  /** Language of the code */
  language: string;
  /** Explanation of the example */
  explanation: string;
}

/**
 * A recommendation for using a specific pattern.
 *
 * @example
 * ```typescript
 * const recommendation: PatternRecommendation = {
 *   pattern: 'Repository Pattern',
 *   description: 'Abstract data access behind a collection-like interface',
 *   applicability: ['Domain entities with CRUD operations', 'Need to swap data sources'],
 *   antiPatterns: [...],
 *   examples: [...],
 *   evidence: [...],
 *   confidence: bounded(0.7, 0.9, 'literature', 'Fowler PoEAA'),
 *   relatedPatterns: ['Unit of Work', 'Data Mapper'],
 * };
 * ```
 */
export interface PatternRecommendation {
  /** Name of the pattern */
  pattern: string;
  /** Description of the pattern */
  description: string;
  /** Contexts where this pattern applies */
  applicability: string[];
  /** Related anti-patterns to avoid */
  antiPatterns: AntiPatternWarning[];
  /** Examples demonstrating the pattern */
  examples: PatternExample[];
  /** Evidence supporting this recommendation */
  evidence: PatternEvidence[];
  /** Confidence in the recommendation */
  confidence: ConfidenceValue;
  /** Names of related patterns */
  relatedPatterns?: string[];
  /** Trade-offs of using this pattern */
  tradeoffs?: {
    benefits: string[];
    costs: string[];
  };
}

// ============================================================================
// ADR TEMPLATE FACTORY
// ============================================================================

/**
 * Input for creating a new ADR.
 */
export interface CreateADRInput {
  /** Unique identifier */
  id: string;
  /** Title of the decision */
  title: string;
  /** Context explaining the need */
  context: string;
  /** The decision made */
  decision: string;
  /** Initial status (defaults to 'proposed') */
  status?: AdfStatus;
  /** Consequences */
  consequences?: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  /** Alternatives considered */
  alternatives?: Alternative[];
  /** Confidence in the decision */
  confidence?: ConfidenceValue;
  /** Evidence references */
  evidenceRefs?: string[];
  /** ADR being superseded */
  supersedes?: string;
}

/**
 * Create a new Architecture Decision Record with sensible defaults.
 *
 * @param input - The ADR creation input
 * @returns A complete ADR with all fields populated
 *
 * @example
 * ```typescript
 * const adr = createADR({
 *   id: 'ADR-002',
 *   title: 'Use PostgreSQL for user data',
 *   context: 'Need ACID transactions and complex queries',
 *   decision: 'Use PostgreSQL 15 with TypeORM',
 * });
 * ```
 */
export function createADR(input: CreateADRInput): ArchitectureDecisionRecord {
  const now = new Date();
  return {
    id: input.id,
    title: input.title,
    status: input.status ?? 'proposed',
    context: input.context,
    decision: input.decision,
    consequences: {
      positive: input.consequences?.positive ?? [],
      negative: input.consequences?.negative ?? [],
      neutral: input.consequences?.neutral ?? [],
    },
    alternatives: input.alternatives ?? [],
    confidence: input.confidence ?? absent('uncalibrated'),
    evidenceRefs: input.evidenceRefs ?? [],
    supersedes: input.supersedes,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing ADR.
 *
 * @param adr - The existing ADR
 * @param updates - Fields to update
 * @returns Updated ADR with new updatedAt timestamp
 */
export function updateADR(
  adr: ArchitectureDecisionRecord,
  updates: Partial<Omit<ArchitectureDecisionRecord, 'id' | 'createdAt' | 'updatedAt'>>
): ArchitectureDecisionRecord {
  return {
    ...adr,
    ...updates,
    updatedAt: new Date(),
  };
}

/**
 * Supersede an ADR with a new one.
 *
 * @param oldAdr - The ADR being superseded
 * @param newAdr - The new ADR that supersedes it
 * @returns Tuple of [updated old ADR, updated new ADR]
 */
export function supersedeADR(
  oldAdr: ArchitectureDecisionRecord,
  newAdr: ArchitectureDecisionRecord
): [ArchitectureDecisionRecord, ArchitectureDecisionRecord] {
  const updatedOld = updateADR(oldAdr, {
    status: 'superseded',
    supersededBy: newAdr.id,
  });
  const updatedNew = updateADR(newAdr, {
    supersedes: oldAdr.id,
  });
  return [updatedOld, updatedNew];
}

// ============================================================================
// TRADE-OFF ANALYSIS HELPERS
// ============================================================================

/**
 * Default weights for quality attributes.
 */
export const DEFAULT_TRADEOFF_WEIGHTS: Map<QualityAttribute, number> = new Map([
  ['performance', 0.15],
  ['maintainability', 0.20],
  ['security', 0.15],
  ['scalability', 0.10],
  ['testability', 0.15],
  ['simplicity', 0.15],
  ['reliability', 0.05],
  ['portability', 0.025],
  ['usability', 0.025],
]);

/**
 * Input for creating a trade-off analysis.
 */
export interface CreateTradeoffAnalysisInput {
  /** Options to compare */
  options: Array<{
    id: string;
    description: string;
    impacts: Array<{
      attribute: QualityAttribute;
      impact: -2 | -1 | 0 | 1 | 2;
      rationale: string;
      confidence?: ConfidenceValue;
    }>;
  }>;
  /** Quality attributes to analyze */
  qualities?: QualityAttribute[];
  /** Custom weights (defaults to DEFAULT_TRADEOFF_WEIGHTS) */
  weights?: Map<QualityAttribute, number>;
}

/**
 * Create a trade-off analysis comparing multiple options.
 *
 * @param input - Analysis input
 * @returns Complete trade-off analysis with recommendation
 *
 * @example
 * ```typescript
 * const analysis = createTradeoffAnalysis({
 *   options: [
 *     {
 *       id: 'monolith',
 *       description: 'Monolithic architecture',
 *       impacts: [
 *         { attribute: 'simplicity', impact: 2, rationale: 'Single deployment' },
 *         { attribute: 'scalability', impact: -1, rationale: 'Horizontal scaling limited' },
 *       ],
 *     },
 *     {
 *       id: 'microservices',
 *       description: 'Microservices architecture',
 *       impacts: [
 *         { attribute: 'simplicity', impact: -1, rationale: 'Distributed complexity' },
 *         { attribute: 'scalability', impact: 2, rationale: 'Independent scaling' },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export function createTradeoffAnalysis(input: CreateTradeoffAnalysisInput): TradeoffAnalysis {
  const weights = input.weights ?? DEFAULT_TRADEOFF_WEIGHTS;
  const qualities = input.qualities ?? Array.from(weights.keys());

  const rows: TradeoffRow[] = input.options.map((option) => {
    const cells: TradeoffCell[] = qualities.map((attr) => {
      const impact = option.impacts.find((i) => i.attribute === attr);
      return {
        attribute: attr,
        impact: impact?.impact ?? 0,
        rationale: impact?.rationale ?? 'No assessment provided',
        confidence: impact?.confidence ?? absent('uncalibrated'),
      };
    });

    const weightedScore = cells.reduce((sum, cell) => {
      const weight = weights.get(cell.attribute) ?? 0;
      return sum + cell.impact * weight;
    }, 0);

    return {
      optionId: option.id,
      description: option.description,
      cells,
      weightedScore,
    };
  });

  // Find best option
  const sortedRows = [...rows].sort((a, b) => b.weightedScore - a.weightedScore);
  const best = sortedRows[0];
  const recommendedOptionId = best?.optionId ?? '';

  // Generate recommendation
  const recommendation = best
    ? `${best.description} scores highest (${best.weightedScore.toFixed(2)}) based on weighted quality attributes`
    : 'No options provided for analysis';

  // Compute overall confidence
  const allConfidences = rows.flatMap((r) => r.cells.map((c) => c.confidence));
  const hasUncalibrated = allConfidences.some((c) => c.type === 'absent');
  const confidence: ConfidenceValue = hasUncalibrated
    ? absent('uncalibrated')
    : bounded(0.5, 0.8, 'theoretical', 'Weighted multi-criteria analysis');

  return {
    qualities,
    matrix: {
      rows,
      weights,
      recommendedOptionId,
    },
    recommendation,
    confidence,
  };
}

/**
 * Compare two options directly for quick decisions.
 *
 * @param optionA - First option impacts
 * @param optionB - Second option impacts
 * @param weights - Quality attribute weights
 * @returns Object with comparison results
 */
export function compareOptions(
  optionA: Array<{ attribute: QualityAttribute; impact: number }>,
  optionB: Array<{ attribute: QualityAttribute; impact: number }>,
  weights: Map<QualityAttribute, number> = DEFAULT_TRADEOFF_WEIGHTS
): { winner: 'A' | 'B' | 'tie'; scoreA: number; scoreB: number; difference: number } {
  const scoreA = optionA.reduce((sum, { attribute, impact }) => {
    return sum + impact * (weights.get(attribute) ?? 0);
  }, 0);

  const scoreB = optionB.reduce((sum, { attribute, impact }) => {
    return sum + impact * (weights.get(attribute) ?? 0);
  }, 0);

  const difference = Math.abs(scoreA - scoreB);
  const winner: 'A' | 'B' | 'tie' = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'tie';

  return { winner, scoreA, scoreB, difference };
}

// ============================================================================
// CONSTRAINT VALIDATOR
// ============================================================================

/**
 * Configuration for the constraint validator.
 */
export interface ConstraintValidatorConfig {
  /** Root directory for scanning */
  rootDir: string;
  /** Patterns to include */
  include?: string[];
  /** Patterns to exclude */
  exclude?: string[];
  /** Whether to fail fast on first error */
  failFast?: boolean;
}

/**
 * Result of validating a single constraint.
 */
export interface ConstraintValidationResult {
  /** The constraint that was validated */
  constraint: ArchitectureConstraint;
  /** Whether the constraint passed */
  passed: boolean;
  /** Violations found (empty if passed) */
  violations: ConstraintViolation[];
  /** Time taken to validate in milliseconds */
  durationMs: number;
}

/**
 * Validate a layer dependency constraint.
 *
 * @param constraint - The constraint to validate
 * @param dependencies - Map of file paths to their dependencies
 * @returns Array of violations
 */
export function validateLayerDependency(
  constraint: ArchitectureConstraint,
  dependencies: Map<string, string[]>
): ConstraintViolation[] {
  if (constraint.type !== 'layer_dependency') {
    return [];
  }

  const violations: ConstraintViolation[] = [];
  const forbidden = new Set(constraint.forbiddenDependencies ?? []);

  for (const [file, deps] of dependencies) {
    // Check if file is in scope
    if (constraint.scope && !matchesGlob(file, constraint.scope)) {
      continue;
    }

    for (const dep of deps) {
      // Check if dependency is forbidden
      for (const forbiddenPattern of forbidden) {
        if (matchesGlob(dep, forbiddenPattern)) {
          violations.push({
            constraintId: constraint.id,
            file,
            message: `${file} depends on ${dep}, violating rule: ${constraint.rule}`,
            severity: constraint.severity,
            suggestion: `Remove dependency on ${dep} or move to an allowed layer`,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Validate a naming convention constraint.
 *
 * @param constraint - The constraint to validate
 * @param filePaths - Array of file paths to check
 * @returns Array of violations
 */
export function validateNamingConvention(
  constraint: ArchitectureConstraint,
  filePaths: string[]
): ConstraintViolation[] {
  if (constraint.type !== 'naming_convention' || !constraint.pattern) {
    return [];
  }

  const violations: ConstraintViolation[] = [];
  const pattern = new RegExp(constraint.pattern);

  for (const file of filePaths) {
    // Check if file is in scope
    if (constraint.scope && !matchesGlob(file, constraint.scope)) {
      continue;
    }

    const fileName = file.split('/').pop() ?? file;
    if (!pattern.test(fileName)) {
      violations.push({
        constraintId: constraint.id,
        file,
        message: `${file} does not match naming convention: ${constraint.rule}`,
        severity: constraint.severity,
        suggestion: `Rename to match pattern: ${constraint.pattern}`,
      });
    }
  }

  return violations;
}

/**
 * Validate for circular dependencies.
 *
 * @param constraint - The constraint to validate
 * @param dependencies - Map of file paths to their dependencies
 * @returns Array of violations
 */
export function validateCircularDependencies(
  constraint: ArchitectureConstraint,
  dependencies: Map<string, string[]>
): ConstraintViolation[] {
  if (constraint.type !== 'circular_dependency') {
    return [];
  }

  const violations: ConstraintViolation[] = [];
  const cycles = detectCycles(dependencies);

  for (const cycle of cycles) {
    violations.push({
      constraintId: constraint.id,
      file: cycle[0] ?? 'unknown',
      message: `Circular dependency detected: ${cycle.join(' -> ')}`,
      severity: constraint.severity,
      suggestion: 'Break the cycle by extracting shared code or using dependency injection',
      context: cycle.join(' -> '),
    });
  }

  return violations;
}

/**
 * Detect cycles in a dependency graph using Tarjan's algorithm.
 */
function detectCycles(dependencies: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let cursor = 0;

  function strongConnect(node: string): void {
    index.set(node, cursor);
    lowlink.set(node, cursor);
    cursor += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of dependencies.get(node) ?? []) {
      if (!index.has(neighbor)) {
        strongConnect(neighbor);
        lowlink.set(node, Math.min(lowlink.get(node) ?? 0, lowlink.get(neighbor) ?? 0));
      } else if (onStack.has(neighbor)) {
        lowlink.set(node, Math.min(lowlink.get(node) ?? 0, index.get(neighbor) ?? 0));
      }
    }

    if ((lowlink.get(node) ?? 0) === (index.get(node) ?? 0)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (current) {
          onStack.delete(current);
          component.push(current);
        }
      } while (current && current !== node);

      if (component.length > 1) {
        cycles.push(component.reverse());
      }
    }
  }

  for (const node of dependencies.keys()) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }

  return cycles;
}

/**
 * Simple glob matching (basic implementation).
 */
function matchesGlob(path: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexPattern}$`).test(path);
}

// ============================================================================
// DRIFT DETECTION UTILITIES
// ============================================================================

/**
 * Calculate technical debt estimate from violations.
 *
 * @param violations - Array of constraint violations
 * @param hoursByType - Estimated hours to fix each violation type
 * @returns Technical debt estimate
 */
export function calculateTechnicalDebt(
  violations: ConstraintViolation[],
  hoursByType: Map<ConstraintType, number> = new Map([
    ['layer_dependency', 4],
    ['module_boundary', 3],
    ['naming_convention', 0.5],
    ['pattern_usage', 2],
    ['dependency_direction', 3],
    ['circular_dependency', 8],
    ['package_structure', 2],
  ])
): TechnicalDebtEstimate {
  const byType = new Map<ConstraintType, number>();
  const bySeverity = new Map<ConstraintSeverity, number>();

  let totalHours = 0;

  for (const violation of violations) {
    // Get constraint type from violation (would need to look up constraint)
    // For now, use a default estimate
    const hours = 2; // Default estimate
    totalHours += hours;

    // Track by severity
    const currentSeverityHours = bySeverity.get(violation.severity) ?? 0;
    bySeverity.set(violation.severity, currentSeverityHours + hours);
  }

  return {
    totalHours,
    byType,
    bySeverity,
    confidence: bounded(0.4, 0.7, 'theoretical', 'Heuristic estimate based on violation counts'),
  };
}

/**
 * Generate a drift report from constraints and violations.
 *
 * @param constraints - All architecture constraints
 * @param violations - All violations found
 * @returns Complete drift report
 */
export function generateDriftReport(
  constraints: ArchitectureConstraint[],
  violations: ConstraintViolation[]
): ArchitectureDriftReport {
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;
  const infoCount = violations.filter((v) => v.severity === 'info').length;

  // Generate prioritized recommendations
  const recommendations: string[] = [];

  if (errorCount > 0) {
    const errorViolations = violations.filter((v) => v.severity === 'error');
    const firstError = errorViolations[0];
    if (firstError) {
      recommendations.push(`Fix critical violation: ${firstError.message}`);
    }
    if (errorCount > 1) {
      recommendations.push(`Address ${errorCount - 1} additional error-level violations`);
    }
  }

  if (warningCount > 5) {
    recommendations.push(`Review and prioritize ${warningCount} warning-level violations`);
  }

  // Look for patterns in violations
  const violationsByConstraint = new Map<string, number>();
  for (const v of violations) {
    const count = violationsByConstraint.get(v.constraintId) ?? 0;
    violationsByConstraint.set(v.constraintId, count + 1);
  }

  const mostViolated = [...violationsByConstraint.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [constraintId, count] of mostViolated) {
    if (count > 3) {
      const constraint = constraints.find((c) => c.id === constraintId);
      if (constraint) {
        recommendations.push(`Systemic issue: ${constraint.rule} has ${count} violations`);
      }
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Architecture is in good health - continue monitoring');
  }

  return {
    constraints,
    violations,
    technicalDebtEstimate: calculateTechnicalDebt(violations),
    recommendations,
    generatedAt: new Date(),
    summary: {
      totalConstraints: constraints.length,
      totalViolations: violations.length,
      errorCount,
      warningCount,
      infoCount,
    },
  };
}

// ============================================================================
// PATTERN RECOMMENDATION FACTORY
// ============================================================================

/**
 * Input for creating a pattern recommendation.
 */
export interface CreatePatternRecommendationInput {
  /** Pattern name */
  pattern: string;
  /** Pattern description */
  description: string;
  /** When to apply this pattern */
  applicability: string[];
  /** Anti-patterns to avoid */
  antiPatterns?: Array<{
    name: string;
    description: string;
    symptoms?: string[];
    remediation?: string;
  }>;
  /** Example code or references */
  examples?: Array<{
    title: string;
    code: string;
    language?: string;
    explanation?: string;
  }>;
  /** Supporting evidence */
  evidence?: PatternEvidence[];
  /** Confidence in recommendation */
  confidence?: ConfidenceValue;
  /** Related patterns */
  relatedPatterns?: string[];
  /** Trade-offs */
  tradeoffs?: {
    benefits: string[];
    costs: string[];
  };
}

/**
 * Create a pattern recommendation with defaults.
 *
 * @param input - Pattern recommendation input
 * @returns Complete pattern recommendation
 */
export function createPatternRecommendation(
  input: CreatePatternRecommendationInput
): PatternRecommendation {
  return {
    pattern: input.pattern,
    description: input.description,
    applicability: input.applicability,
    antiPatterns: (input.antiPatterns ?? []).map((ap) => ({
      name: ap.name,
      description: ap.description,
      symptoms: ap.symptoms ?? [],
      remediation: ap.remediation ?? 'Refactor to use the recommended pattern',
    })),
    examples: (input.examples ?? []).map((ex) => ({
      title: ex.title,
      code: ex.code,
      language: ex.language ?? 'typescript',
      explanation: ex.explanation ?? '',
    })),
    evidence: input.evidence ?? [],
    confidence: input.confidence ?? absent('uncalibrated'),
    relatedPatterns: input.relatedPatterns,
    tradeoffs: input.tradeoffs,
  };
}

/**
 * Check if a pattern is applicable to a given context.
 *
 * @param recommendation - The pattern recommendation
 * @param context - Context tags describing the situation
 * @returns Object with match score and matched applicabilities
 */
export function checkPatternApplicability(
  recommendation: PatternRecommendation,
  context: string[]
): { applicable: boolean; matchScore: number; matchedApplicabilities: string[] } {
  const contextLower = new Set(context.map((c) => c.toLowerCase()));
  const matched: string[] = [];

  for (const applicability of recommendation.applicability) {
    const keywords = applicability.toLowerCase().split(/\s+/);
    const hasMatch = keywords.some((kw) => {
      for (const ctx of contextLower) {
        if (ctx.includes(kw) || kw.includes(ctx)) {
          return true;
        }
      }
      return false;
    });

    if (hasMatch) {
      matched.push(applicability);
    }
  }

  const matchScore = recommendation.applicability.length > 0
    ? matched.length / recommendation.applicability.length
    : 0;

  return {
    applicable: matched.length > 0,
    matchScore,
    matchedApplicabilities: matched,
  };
}

// ============================================================================
// BUILT-IN CONSTRAINTS
// ============================================================================

/**
 * Common architecture constraints for clean architecture.
 */
export const CLEAN_ARCHITECTURE_CONSTRAINTS: ArchitectureConstraint[] = [
  {
    id: 'CA-001',
    type: 'layer_dependency',
    rule: 'Domain layer must not depend on infrastructure',
    severity: 'error',
    rationale: 'Domain logic should be independent of infrastructure concerns',
    scope: 'src/domain/**',
    forbiddenDependencies: ['src/infrastructure/**', 'src/adapters/**'],
  },
  {
    id: 'CA-002',
    type: 'layer_dependency',
    rule: 'Domain layer must not depend on application layer',
    severity: 'error',
    rationale: 'Domain is the innermost layer',
    scope: 'src/domain/**',
    forbiddenDependencies: ['src/application/**'],
  },
  {
    id: 'CA-003',
    type: 'layer_dependency',
    rule: 'Application layer must not depend on infrastructure',
    severity: 'error',
    rationale: 'Application orchestrates but does not implement infrastructure',
    scope: 'src/application/**',
    forbiddenDependencies: ['src/infrastructure/**'],
  },
  {
    id: 'CA-004',
    type: 'circular_dependency',
    rule: 'No circular dependencies between modules',
    severity: 'error',
    rationale: 'Circular dependencies create tight coupling and complicate testing',
  },
];

/**
 * Common naming convention constraints.
 */
export const NAMING_CONVENTION_CONSTRAINTS: ArchitectureConstraint[] = [
  {
    id: 'NC-001',
    type: 'naming_convention',
    rule: 'Test files must end with .test.ts or .spec.ts',
    severity: 'warning',
    pattern: '.*\\.(test|spec)\\.ts$',
    scope: 'src/**/__tests__/**',
  },
  {
    id: 'NC-002',
    type: 'naming_convention',
    rule: 'Type definition files must end with .types.ts',
    severity: 'info',
    pattern: '.*\\.types\\.ts$',
    scope: 'src/**/types/**',
  },
  {
    id: 'NC-003',
    type: 'naming_convention',
    rule: 'Utility modules should be named with snake_case',
    severity: 'info',
    pattern: '^[a-z][a-z0-9_]*\\.ts$',
    scope: 'src/**/utils/**',
  },
];

// ============================================================================
// LIBRARIAN-ENHANCED ARCHITECTURE VALIDATION
// ============================================================================

import type { LiBrainian } from '../api/librainian.js';
import type { LiBrainianResponse, LlmOptional, ContextPack } from '../types.js';
import type { EvidenceRef } from '../api/evidence.js';
import { deriveSequentialConfidence, getNumericValue } from '../epistemics/confidence.js';

/**
 * Architecture issue discovered through librainian semantic analysis.
 */
export interface SemanticArchitectureIssue {
  /** Type of architecture issue */
  type:
    | 'layer_violation'
    | 'circular_dependency'
    | 'god_class'
    | 'feature_envy'
    | 'shotgun_surgery'
    | 'inappropriate_intimacy'
    | 'missing_abstraction'
    | 'leaky_abstraction'
    | 'unstable_dependency'
    | 'acyclic_violation';
  /** Description of the issue */
  description: string;
  /** Severity level */
  severity: ConstraintSeverity;
  /** Files involved in the issue */
  files: string[];
  /** Optional dependency path for violations */
  dependencyPath?: string[];
  /** Suggested remediation */
  remediation: string;
  /** Evidence supporting this finding */
  evidence: EvidenceRef[];
}

/**
 * Result of librainian-enhanced architecture validation.
 */
export interface LiBrainianEnhancedArchitectureResult {
  /** Constraint violations found through static analysis */
  violations: ConstraintViolation[];
  /** Semantic architecture issues found through librainian analysis */
  semanticIssues: SemanticArchitectureIssue[];
  /** Overall confidence in the validation result */
  confidence: ConfidenceValue;
  /** Evidence references for traceability */
  evidenceRefs: EvidenceRef[];
  /** Whether librainian was available for semantic analysis */
  librainianAvailable: boolean;
  /** LiBrainian query trace ID */
  traceId?: string;
  /** Summary statistics */
  summary: {
    totalViolations: number;
    totalSemanticIssues: number;
    errorCount: number;
    warningCount: number;
    estimatedDebtHours: number;
  };
}

/**
 * Analyze call graph for layer violations using librainian.
 */
async function analyzeCallGraphForViolations(
  librainian: LiBrainian,
  constraints: ArchitectureConstraint[]
): Promise<{ issues: SemanticArchitectureIssue[]; evidenceRefs: EvidenceRef[] }> {
  const issues: SemanticArchitectureIssue[] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Query librainian for call graph information
  const queryResult = await librainian.queryOptional({
    intent: 'Find function calls that cross architectural layer boundaries. ' +
            'Identify calls from domain layer to infrastructure, application layer to adapters, ' +
            'or any violation of clean architecture dependency rules.',
    depth: 'L2',
    taskType: 'understand',
  });

  if (!queryResult || !queryResult.packs || queryResult.packs.length === 0) {
    return { issues, evidenceRefs };
  }

  // Analyze packs for layer violations
  for (const pack of queryResult.packs) {
    // Check if pack suggests layer boundary crossing
    const summaryLower = pack.summary.toLowerCase();
    const relatedFiles = pack.relatedFiles;

    // Detect potential layer violations based on file paths
    const layerInfo = relatedFiles.map((file) => ({
      file,
      layer: detectLayer(file),
    }));

    // Check for invalid layer dependencies
    for (const constraint of constraints) {
      if (constraint.type !== 'layer_dependency') continue;

      for (const { file, layer } of layerInfo) {
        if (!constraint.scope || !matchesGlob(file, constraint.scope)) continue;

        for (const dep of relatedFiles) {
          if (dep === file) continue;

          for (const forbidden of constraint.forbiddenDependencies ?? []) {
            if (matchesGlob(dep, forbidden)) {
              issues.push({
                type: 'layer_violation',
                description: `${file} (${layer}) depends on ${dep}, violating ${constraint.rule}`,
                severity: constraint.severity,
                files: [file, dep],
                dependencyPath: [file, dep],
                remediation: constraint.rationale ?? 'Review dependency direction and consider using interfaces or dependency injection',
                evidence: pack.codeSnippets.map((snippet) => ({
                  file: snippet.filePath,
                  line: snippet.startLine,
                  snippet: snippet.content.slice(0, 200),
                  claim: `Call or import suggests layer boundary violation`,
                  confidence: 'inferred' as const,
                })),
              });
            }
          }
        }
      }
    }

    // Detect circular dependencies from pack analysis
    if (summaryLower.includes('circular') || summaryLower.includes('cycle')) {
      issues.push({
        type: 'circular_dependency',
        description: `Potential circular dependency detected involving: ${relatedFiles.slice(0, 3).join(', ')}`,
        severity: 'error',
        files: relatedFiles.slice(0, 5),
        dependencyPath: relatedFiles.slice(0, 5),
        remediation: 'Break the cycle by extracting shared code or using dependency injection',
        evidence: [{
          file: relatedFiles[0] ?? 'unknown',
          line: 1,
          snippet: pack.summary.slice(0, 200),
          claim: 'Circular dependency pattern detected',
          confidence: 'inferred',
        }],
      });
    }

    // Build evidence refs from pack
    for (const snippet of pack.codeSnippets) {
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

  return { issues, evidenceRefs };
}

/**
 * Detect the architectural layer from a file path.
 */
function detectLayer(filePath: string): string {
  const path = filePath.toLowerCase();
  if (path.includes('/domain/') || path.includes('domain.')) return 'domain';
  if (path.includes('/application/') || path.includes('application.')) return 'application';
  if (path.includes('/infrastructure/') || path.includes('infra.')) return 'infrastructure';
  if (path.includes('/adapters/') || path.includes('adapter.')) return 'adapters';
  if (path.includes('/presentation/') || path.includes('ui/')) return 'presentation';
  if (path.includes('/api/')) return 'api';
  return 'unknown';
}

/**
 * Validate architecture constraints with librainian-enhanced semantic analysis.
 *
 * This function combines traditional static constraint validation with semantic
 * code analysis from the librainian. It uses the call graph to detect layer
 * violations, circular dependencies, and other architecture issues that static
 * analysis might miss.
 *
 * @param constraints - Architecture constraints to validate
 * @param dependencies - Map of file paths to their dependencies
 * @param librainian - LiBrainian instance for semantic analysis
 * @returns Enhanced validation result with semantic issues and confidence
 *
 * @example
 * ```typescript
 * const result = await validateArchitectureWithLiBrainian(
 *   CLEAN_ARCHITECTURE_CONSTRAINTS,
 *   dependencyMap,
 *   librainian
 * );
 * console.log(result.semanticIssues); // Issues found through call graph analysis
 * console.log(result.confidence); // Overall confidence in the validation
 * ```
 */
export async function validateArchitectureWithLiBrainian(
  constraints: ArchitectureConstraint[],
  dependencies: Map<string, string[]>,
  librainian: LiBrainian
): Promise<LiBrainianEnhancedArchitectureResult> {
  // Perform static validation first
  const staticViolations: ConstraintViolation[] = [];

  for (const constraint of constraints) {
    switch (constraint.type) {
      case 'layer_dependency':
        staticViolations.push(...validateLayerDependency(constraint, dependencies));
        break;
      case 'circular_dependency':
        staticViolations.push(...validateCircularDependencies(constraint, dependencies));
        break;
      case 'naming_convention':
        staticViolations.push(...validateNamingConvention(constraint, Array.from(dependencies.keys())));
        break;
    }
  }

  // Perform librainian-enhanced analysis
  let semanticIssues: SemanticArchitectureIssue[] = [];
  let evidenceRefs: EvidenceRef[] = [];
  let librainianAvailable = false;
  let traceId: string | undefined;

  try {
    const callGraphAnalysis = await analyzeCallGraphForViolations(librainian, constraints);
    semanticIssues = callGraphAnalysis.issues;
    evidenceRefs = callGraphAnalysis.evidenceRefs;
    librainianAvailable = true;

    // Get trace ID from a follow-up query to capture the session
    const statusQuery = await librainian.queryOptional({
      intent: 'Architecture validation trace',
      depth: 'L0',
    });
    traceId = statusQuery?.traceId;
  } catch {
    // LiBrainian query failed, proceed with static validation only
    librainianAvailable = false;
  }

  // Calculate summary statistics
  const errorCount = staticViolations.filter((v) => v.severity === 'error').length +
                     semanticIssues.filter((i) => i.severity === 'error').length;
  const warningCount = staticViolations.filter((v) => v.severity === 'warning').length +
                       semanticIssues.filter((i) => i.severity === 'warning').length;

  const estimatedDebtHours = staticViolations.length * 2 + semanticIssues.length * 4;

  // Derive confidence
  const staticConfidence = bounded(
    0.8,
    0.95,
    'formal_analysis',
    'Static constraint validation is deterministic given the dependency map'
  );

  const librainianConfidence = librainianAvailable
    ? bounded(0.6, 0.85, 'literature', 'Semantic analysis confidence from call graph interpretation')
    : absent('uncalibrated');

  const confidence = deriveSequentialConfidence([staticConfidence, librainianConfidence]);

  return {
    violations: staticViolations,
    semanticIssues,
    confidence,
    evidenceRefs,
    librainianAvailable,
    traceId,
    summary: {
      totalViolations: staticViolations.length,
      totalSemanticIssues: semanticIssues.length,
      errorCount,
      warningCount,
      estimatedDebtHours,
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  TechnicalDebtEstimate as TechnicalDebt,
};
