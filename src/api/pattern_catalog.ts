import type { TechniqueOperatorType } from '../strategic/techniques.js';
import type { LearningOutcome } from './learning_loop.js';
import { DEFAULT_TECHNIQUE_COMPOSITIONS_BY_ID } from './technique_compositions.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID } from './technique_library.js';
import {
  absent,
  assertConfidenceValue,
  getNumericValue,
  type ConfidenceValue,
} from '../epistemics/confidence.js';

export type PatternId = string & { readonly __patternId: unique symbol };
export type PrimitiveId = string & { readonly __primitiveId: unique symbol };
export type ConfidenceScore = ConfidenceValue & { readonly __confidenceScore: unique symbol };
export type NonEmptyArray<T> = [T, ...T[]];

export type CompositionArchetype =
  | 'investigation'
  | 'verification'
  | 'construction'
  | 'transformation'
  | 'analysis'
  | 'coordination'
  | 'recovery'
  | 'optimization'
  | 'evolution';

export interface CompositionPattern {
  id: PatternId;
  name: string;
  archetype: CompositionArchetype;
  situations: NonEmptyArray<Situation>;
  corePrimitives: NonEmptyArray<PrimitiveId>;
  optionalPrimitives: OptionalPrimitive[];
  operators: OperatorRecommendation[];
  antiPatterns: AntiPattern[];
  /** Example composition IDs (tc_*) or freeform labels describing known implementations. */
  examples: string[];
  successSignals: string[];
  failureSignals: string[];
  embedding?: Float32Array;
}

export interface Situation {
  trigger: string;
  context: string[];
  /** Heuristic confidence with provenance, used for ranking situations. */
  confidence: ConfidenceScore;
  examples: NonEmptyArray<string>;
}

export interface OptionalPrimitive {
  primitiveId: PrimitiveId;
  /** Freeform inclusion hints; used for simple substring matching, not a formal grammar. */
  includeWhen: string[];
  /** Freeform exclusion hints; used for simple substring matching, not a formal grammar. */
  excludeWhen: string[];
  rationale: string;
}

export interface OperatorRecommendation {
  type: TechniqueOperatorType;
  purpose: string;
  placement: 'early' | 'middle' | 'late' | 'wrapper';
  conditions?: string[];
}

export interface AntiPattern {
  description: string;
  whyBad: string;
  betterAlternative: string;
}

export interface CompositionPatternMatch {
  pattern: CompositionPattern;
  score: ConfidenceScore;
  matchedSituation: Situation;
  suggestedPrimitives: {
    core: PrimitiveId[];
    optional: Array<{ primitiveId: PrimitiveId; reason: string }>;
  };
}

export interface PatternCatalogContext {
  codebaseFeatures?: string[];
  recentOutcomes?: ReadonlyArray<LearningOutcome>;
}

const PATTERN_ID_PATTERN = /^pattern_[a-z0-9_]+$/;
const PRIMITIVE_ID_PATTERN = /^tp_[a-z0-9_]+$/;
const MAX_EMBEDDING_DIMENSION = 4096;
const MAX_LIST_ENTRIES = 128;

type SituationInput = {
  trigger: string;
  context: string[];
  confidence: ConfidenceValue;
  examples: NonEmptyArray<string>;
};

type OptionalPrimitiveInput = {
  primitiveId: string;
  includeWhen: string[];
  excludeWhen: string[];
  rationale: string;
};

type OperatorRecommendationInput = {
  type: TechniqueOperatorType;
  purpose: string;
  placement: OperatorRecommendation['placement'];
  conditions?: string[];
};

export type CompositionPatternInput = {
  id: string;
  name: string;
  archetype: CompositionArchetype;
  situations: NonEmptyArray<SituationInput>;
  corePrimitives: NonEmptyArray<string>;
  optionalPrimitives?: OptionalPrimitiveInput[];
  operators?: OperatorRecommendationInput[];
  antiPatterns?: AntiPattern[];
  examples?: string[];
  successSignals?: string[];
  failureSignals?: string[];
  embedding?: Float32Array | number[];
};

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`unverified_by_trace(pattern_catalog_${label}_invalid)`);
  }
  return value.trim();
}

function assertPatternId(value: string): PatternId {
  const normalized = assertNonEmptyString(value, 'id');
  if (!PATTERN_ID_PATTERN.test(normalized)) {
    throw new Error(`unverified_by_trace(pattern_catalog_id_invalid): ${normalized}`);
  }
  return normalized as PatternId;
}

function assertPrimitiveId(value: string): PrimitiveId {
  const normalized = assertNonEmptyString(value, 'primitive_id');
  if (!PRIMITIVE_ID_PATTERN.test(normalized)) {
    throw new Error(`unverified_by_trace(pattern_catalog_primitive_id_invalid): ${normalized}`);
  }
  return normalized as PrimitiveId;
}

function assertConfidence(value: ConfidenceValue): ConfidenceScore {
  assertConfidenceValue(value, 'pattern_catalog_confidence');
  if (value.type === 'absent') {
    return value as ConfidenceScore;
  }
  if (value.type === 'bounded') {
    if (!Number.isFinite(value.low) || !Number.isFinite(value.high) || value.low > value.high) {
      throw new Error('unverified_by_trace(pattern_catalog_confidence_invalid)');
    }
    if (value.low < 0 || value.high > 1) {
      throw new Error('unverified_by_trace(pattern_catalog_confidence_invalid)');
    }
    return value as ConfidenceScore;
  }
  const numeric = getNumericValue(value);
  if (numeric === null || !Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error('unverified_by_trace(pattern_catalog_confidence_invalid)');
  }
  return value as ConfidenceScore;
}

function assertListLimit<T>(values: T[], label: string, minLength = 0): T[] {
  if (values.length > MAX_LIST_ENTRIES) {
    throw new Error(`unverified_by_trace(pattern_catalog_${label}_too_long)`);
  }
  if (values.length < minLength) {
    throw new Error(`unverified_by_trace(pattern_catalog_${label}_too_short)`);
  }
  return values;
}

function normalizeEmbedding(embedding?: Float32Array | number[]): Float32Array | undefined {
  if (!embedding) return undefined;
  let normalized: Float32Array;
  if (embedding instanceof Float32Array) {
    normalized = embedding;
  } else {
    for (const entry of embedding) {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw new Error('unverified_by_trace(pattern_catalog_embedding_non_numeric)');
      }
    }
    try {
      normalized = Float32Array.from(embedding);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sanitized = message.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200);
      throw new Error(`unverified_by_trace(pattern_catalog_embedding_invalid): ${sanitized}`);
    }
  }
  if (normalized.length === 0 || normalized.length > MAX_EMBEDDING_DIMENSION) {
    throw new Error('unverified_by_trace(pattern_catalog_embedding_invalid)');
  }
  for (const entry of normalized) {
    if (!Number.isFinite(entry)) {
      throw new Error('unverified_by_trace(pattern_catalog_embedding_non_numeric)');
    }
  }
  return normalized;
}

function patternConfidence(_patternId: string, _situationIndex: number): ConfidenceValue {
  return absent('uncalibrated');
}

function normalizeStringArray(values: string[], label: string, minLength = 0): string[] {
  const limited = assertListLimit(values.slice(), label, minLength);
  return limited.map((value) => assertNonEmptyString(value, label));
}

function createSituation(input: SituationInput): Situation {
  return {
    trigger: assertNonEmptyString(input.trigger, 'situation_trigger'),
    context: normalizeStringArray(input.context, 'situation_context'),
    confidence: assertConfidence(input.confidence),
    examples: normalizeStringArray(
      input.examples,
      'situation_examples',
      1
    ) as NonEmptyArray<string>,
  };
}

function createOptionalPrimitive(input: OptionalPrimitiveInput): OptionalPrimitive {
  return {
    primitiveId: assertPrimitiveId(input.primitiveId),
    includeWhen: normalizeStringArray(input.includeWhen, 'optional_include_when'),
    excludeWhen: normalizeStringArray(input.excludeWhen, 'optional_exclude_when'),
    rationale: assertNonEmptyString(input.rationale, 'optional_rationale'),
  };
}

function createOperatorRecommendation(input: OperatorRecommendationInput): OperatorRecommendation {
  return {
    type: input.type,
    purpose: assertNonEmptyString(input.purpose, 'operator_purpose'),
    placement: input.placement,
    conditions: input.conditions
      ? normalizeStringArray(input.conditions, 'operator_conditions')
      : undefined,
  };
}

function createAntiPattern(input: AntiPattern): AntiPattern {
  return {
    description: assertNonEmptyString(input.description, 'anti_pattern_description'),
    whyBad: assertNonEmptyString(input.whyBad, 'anti_pattern_why_bad'),
    betterAlternative: assertNonEmptyString(input.betterAlternative, 'anti_pattern_better_alternative'),
  };
}

export function createCompositionPattern(input: CompositionPatternInput): CompositionPattern {
  const corePrimitives = assertListLimit(input.corePrimitives.slice(), 'core_primitives', 1).map(assertPrimitiveId);
  const situations = assertListLimit(input.situations.slice(), 'situations', 1)
    .map(createSituation) as NonEmptyArray<Situation>;
  const optionalPrimitives = assertListLimit(
    (input.optionalPrimitives ?? []).slice(),
    'optional_primitives'
  ).map(createOptionalPrimitive);
  const operators = assertListLimit(
    (input.operators ?? []).slice(),
    'operators'
  ).map(createOperatorRecommendation);
  const antiPatterns = assertListLimit((input.antiPatterns ?? []).slice(), 'anti_patterns').map(createAntiPattern);
  const examples = normalizeStringArray(input.examples ?? [], 'examples');
  const successSignals = normalizeStringArray(input.successSignals ?? [], 'success_signals');
  const failureSignals = normalizeStringArray(input.failureSignals ?? [], 'failure_signals');

  return {
    id: assertPatternId(input.id),
    name: assertNonEmptyString(input.name, 'name'),
    archetype: input.archetype,
    situations,
    corePrimitives: corePrimitives as NonEmptyArray<PrimitiveId>,
    optionalPrimitives,
    operators,
    antiPatterns,
    examples,
    successSignals,
    failureSignals,
    embedding: normalizeEmbedding(input.embedding),
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
  }
  return value;
}

function recordIssue(issues: string[], code: string, detail: string): void {
  issues.push(`${code}:${detail}`);
}

function collectKnownPrimitive(issues: string[], id: PrimitiveId): void {
  if (!DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID.has(id)) {
    recordIssue(issues, 'pattern_catalog_primitive_missing', id);
  }
}

function collectKnownExample(issues: string[], example: string): void {
  // Non tc_ examples are descriptive labels, not strict references.
  if (!example.startsWith('tc_')) return;
  if (!DEFAULT_TECHNIQUE_COMPOSITIONS_BY_ID.has(example)) {
    recordIssue(issues, 'pattern_catalog_example_missing', example);
  }
}

export function validatePatternCatalog(patterns: CompositionPattern[]): void {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (seen.has(pattern.id)) {
      recordIssue(issues, 'pattern_catalog_duplicate_id', pattern.id);
    } else {
      seen.add(pattern.id);
    }
    for (const primitiveId of pattern.corePrimitives) {
      collectKnownPrimitive(issues, primitiveId);
    }
    for (const optional of pattern.optionalPrimitives) {
      collectKnownPrimitive(issues, optional.primitiveId);
    }
    for (const example of pattern.examples) {
      collectKnownExample(issues, example);
    }
  }
  if (issues.length > 0) {
    throw new Error(`unverified_by_trace(pattern_catalog_invalid): ${issues.join('; ')}`);
  }
}

function freezeCatalog(patterns: CompositionPattern[]): readonly CompositionPattern[] {
  validatePatternCatalog(patterns);
  deepFreeze(patterns);
  return patterns;
}

export const COMPOSITION_PATTERN_CATALOG = freezeCatalog([
  createCompositionPattern({
    id: 'pattern_bug_investigation',
    name: 'Bug Investigation',
    archetype: 'investigation',
    situations: [
      {
        trigger: 'Something is broken and we need to find why',
        context: ['error message', 'failing test', 'unexpected behavior', 'regression'],
        confidence: patternConfidence('pattern_bug_investigation', 1),
        examples: [
          'Why is the login failing?',
          'Debug the checkout error',
          'Find the source of this exception',
          'Investigate why tests are flaky',
        ],
      },
    ],
    corePrimitives: [
      'tp_hypothesis',
      'tp_bisect',
      'tp_root_cause',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_min_repro',
        includeWhen: ['bug is intermittent', 'reproduction steps unclear'],
        excludeWhen: ['bug is deterministic and well-understood'],
        rationale: 'Minimal reproduction isolates the issue',
      },
      {
        primitiveId: 'tp_instrument',
        includeWhen: ['need more observability', 'logs insufficient'],
        excludeWhen: ['already have sufficient logging'],
        rationale: 'Adds visibility into execution',
      },
      {
        primitiveId: 'tp_failure_mode_analysis',
        includeWhen: ['critical system', 'need to prevent recurrence'],
        excludeWhen: ['simple one-off bug'],
        rationale: 'Systematic failure analysis for critical bugs',
      },
    ],
    operators: [
      {
        type: 'loop',
        purpose: 'Iterate hypothesis-test until signal stabilizes',
        placement: 'wrapper',
        conditions: ['hypothesis unresolved', 'signal unstable'],
      },
    ],
    antiPatterns: [
      {
        description: 'Fixing without understanding',
        whyBad: 'May introduce new bugs or mask the real issue',
        betterAlternative: 'Always verify root cause before implementing fix',
      },
      {
        description: 'Skipping minimal reproduction',
        whyBad: 'Wastes time investigating non-essential factors',
        betterAlternative: 'Create minimal repro first to isolate variables',
      },
    ],
    examples: ['tc_root_cause_recovery'],
    successSignals: [
      'Root cause identified with evidence',
      'Reproduction is deterministic',
      'Fix addresses root cause, not symptoms',
    ],
    failureSignals: [
      'Multiple hypotheses remain viable',
      'Bug cannot be reproduced',
      'Fix introduced new failures',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_performance_investigation',
    name: 'Performance Investigation',
    archetype: 'investigation',
    situations: [
      {
        trigger: 'System is slow and we need to find why',
        context: ['latency increase', 'throughput decrease', 'resource exhaustion', 'timeout'],
        confidence: patternConfidence('pattern_performance_investigation', 1),
        examples: [
          'Why is the API slow?',
          'Find the performance bottleneck',
          'Investigate memory leak',
          'Profile CPU usage',
        ],
      },
    ],
    corePrimitives: [
      'tp_hypothesis',
      'tp_instrument',
      'tp_bisect',
      'tp_root_cause',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['performance issue may be in dependency', 'complex call graph'],
        excludeWhen: ['isolated component'],
        rationale: 'Understand what the slow path touches',
      },
      {
        primitiveId: 'tp_cost_estimation',
        includeWhen: ['need to quantify improvement value'],
        excludeWhen: ['improvement is obviously worthwhile'],
        rationale: 'Justify optimization investment',
      },
    ],
    operators: [
      {
        type: 'loop',
        purpose: 'Profile-optimize-measure cycle',
        placement: 'wrapper',
        conditions: ['performance target not met'],
      },
    ],
    antiPatterns: [
      {
        description: 'Premature optimization',
        whyBad: 'May optimize the wrong thing',
        betterAlternative: 'Always profile first to find actual bottleneck',
      },
      {
        description: 'Optimizing without baseline',
        whyBad: 'Cannot measure improvement',
        betterAlternative: 'Establish baseline metrics before optimizing',
      },
    ],
    examples: ['tc_performance_reliability'],
    successSignals: [
      'Bottleneck identified with profiling data',
      'Optimization provides measurable improvement',
      'No regression in other areas',
    ],
    failureSignals: [
      'Optimization provides no measurable improvement',
      'New bottleneck appears',
      'Correctness compromised for performance',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_change_verification',
    name: 'Change Verification',
    archetype: 'verification',
    situations: [
      {
        trigger: 'Code change needs validation before merge/deploy',
        context: ['pull request', 'code review', 'pre-merge', 'pre-deploy'],
        confidence: patternConfidence('pattern_change_verification', 1),
        examples: [
          'Review this PR',
          'Is this change safe?',
          'Verify the refactor',
          'Check for breaking changes',
        ],
      },
    ],
    corePrimitives: [
      'tp_assumption_audit',
      'tp_change_impact',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['complex logic', 'many branches', 'user input handling'],
        excludeWhen: ['simple refactor', 'no new logic'],
        rationale: 'Ensure edge cases are handled',
      },
      {
        primitiveId: 'tp_security_abuse_cases',
        includeWhen: ['auth changes', 'input handling', 'external data'],
        excludeWhen: ['internal-only code', 'no security surface'],
        rationale: 'Security review for sensitive changes',
      },
      {
        primitiveId: 'tp_accessibility_review',
        includeWhen: ['UI changes', 'user-facing'],
        excludeWhen: ['backend only', 'no UI impact'],
        rationale: 'Ensure accessibility compliance',
      },
    ],
    operators: [
      {
        type: 'parallel',
        purpose: 'Run independent verification sweeps concurrently',
        placement: 'middle',
      },
      {
        type: 'gate',
        purpose: 'Stop if critical issues found',
        placement: 'late',
        conditions: ['missing evidence', 'critical risk identified'],
      },
    ],
    antiPatterns: [
      {
        description: 'Approving without understanding impact',
        whyBad: 'May approve breaking changes',
        betterAlternative: 'Always run change impact analysis',
      },
      {
        description: 'Ignoring test gaps',
        whyBad: 'Untested code is unknown code',
        betterAlternative: 'Address test gaps before approval',
      },
    ],
    examples: ['tc_agentic_review_v1'],
    successSignals: [
      'All assumptions validated',
      'Impact understood and acceptable',
      'Test coverage adequate',
      'No security issues',
    ],
    failureSignals: [
      'Unknown assumptions remain',
      'Impact unclear or too broad',
      'Critical test gaps',
      'Security concerns unaddressed',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_release_verification',
    name: 'Release Verification',
    archetype: 'verification',
    situations: [
      {
        trigger: 'Preparing to release/deploy to production',
        context: ['release', 'deploy', 'ship', 'production', 'launch'],
        confidence: patternConfidence('pattern_release_verification', 1),
        examples: [
          'Is this ready to ship?',
          'Release readiness check',
          'Pre-production verification',
          'Deploy safety check',
        ],
      },
    ],
    corePrimitives: [
      'tp_release_plan',
      'tp_risk_scan',
      'tp_dependency_map',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_accessibility_review',
        includeWhen: ['user-facing changes'],
        excludeWhen: ['backend only'],
        rationale: 'Ensure accessibility for all users',
      },
      {
        primitiveId: 'tp_threat_model',
        includeWhen: ['security-sensitive release', 'new attack surface'],
        excludeWhen: ['no security changes'],
        rationale: 'Comprehensive security review',
      },
      {
        primitiveId: 'tp_graceful_degradation',
        includeWhen: ['critical service', 'high availability required'],
        excludeWhen: ['non-critical feature'],
        rationale: 'Ensure system degrades gracefully under failure',
      },
    ],
    operators: [
      {
        type: 'gate',
        purpose: 'Block release if verification fails',
        placement: 'late',
        conditions: ['verification incomplete', 'rollback plan missing', 'critical risk'],
      },
    ],
    antiPatterns: [
      {
        description: 'Releasing without rollback plan',
        whyBad: 'Cannot recover from failed release',
        betterAlternative: 'Always have tested rollback procedure',
      },
      {
        description: 'Skipping dependency verification',
        whyBad: 'May break downstream consumers',
        betterAlternative: 'Verify all dependencies are compatible',
      },
    ],
    examples: ['tc_release_readiness'],
    successSignals: [
      'All verification gates pass',
      'Rollback plan tested',
      'Dependencies verified',
      'Risk acknowledged and mitigated',
    ],
    failureSignals: [
      'Verification gates fail',
      'No rollback plan',
      'Dependency conflicts',
      'Unmitigated critical risks',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_feature_construction',
    name: 'Feature Construction',
    archetype: 'construction',
    situations: [
      {
        trigger: 'Building a new feature from scratch',
        context: ['new feature', 'implement', 'build', 'create', 'add'],
        confidence: patternConfidence('pattern_feature_construction', 1),
        examples: [
          'Add user authentication',
          'Implement the search feature',
          'Build the dashboard',
          'Create the API endpoint',
        ],
      },
    ],
    corePrimitives: [
      'tp_clarify_goal',
      'tp_list_constraints',
      'tp_decompose',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_threat_model',
        includeWhen: ['security-sensitive feature', 'handles user data'],
        excludeWhen: ['internal tooling', 'no security surface'],
        rationale: 'Security-first design for sensitive features',
      },
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['complex user interactions', 'many states'],
        excludeWhen: ['simple CRUD'],
        rationale: 'Enumerate edge cases before building',
      },
      {
        primitiveId: 'tp_cost_estimation',
        includeWhen: ['large feature', 'needs resource planning'],
        excludeWhen: ['small feature', 'no budget constraints'],
        rationale: 'Estimate effort before committing',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Ensure planning precedes execution',
        placement: 'early',
      },
      {
        type: 'parallel',
        purpose: 'Build independent sub-components concurrently',
        placement: 'middle',
      },
    ],
    antiPatterns: [
      {
        description: 'Building without clear requirements',
        whyBad: 'May build the wrong thing',
        betterAlternative: 'Always clarify goal and constraints first',
      },
      {
        description: 'Monolithic implementation',
        whyBad: 'Hard to test, review, and iterate',
        betterAlternative: 'Decompose into smaller, testable pieces',
      },
    ],
    examples: ['Feature development'],
    successSignals: [
      'Requirements clear and agreed',
      'Plan decomposed into testable pieces',
      'Each piece verified before integration',
    ],
    failureSignals: [
      'Requirements changed mid-build',
      'Integration issues discovered late',
      "Feature doesn't meet actual needs",
    ],
  }),
  createCompositionPattern({
    id: 'pattern_refactoring',
    name: 'Safe Refactoring',
    archetype: 'transformation',
    situations: [
      {
        trigger: 'Changing code structure without changing behavior',
        context: ['refactor', 'rename', 'extract', 'reorganize', 'clean up'],
        confidence: patternConfidence('pattern_refactoring', 1),
        examples: [
          'Refactor the auth module',
          'Extract this into a service',
          'Rename the API endpoints',
          'Split this file',
        ],
      },
    ],
    corePrimitives: [
      'tp_change_impact',
      'tp_dependency_map',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_min_repro',
        includeWhen: ["need to verify behavior doesn't change"],
        excludeWhen: ['comprehensive test suite exists'],
        rationale: 'Create characterization tests before refactoring',
      },
      {
        primitiveId: 'tp_semantic_dedup',
        includeWhen: ['consolidating duplicate code'],
        excludeWhen: ['not removing duplication'],
        rationale: 'Ensure deduplication is semantically correct',
      },
    ],
    operators: [
      {
        type: 'gate',
        purpose: 'Stop if behavior change detected',
        placement: 'late',
        conditions: ['test failure', 'behavior change detected'],
      },
    ],
    antiPatterns: [
      {
        description: 'Refactoring without tests',
        whyBad: 'Cannot verify behavior is preserved',
        betterAlternative: 'Add characterization tests first',
      },
      {
        description: 'Big bang refactoring',
        whyBad: 'Hard to review, easy to break',
        betterAlternative: 'Small, incremental refactorings with verification',
      },
    ],
    examples: ['Safe refactor'],
    successSignals: [
      'All existing tests pass',
      'No behavior change detected',
      'Code structure improved',
    ],
    failureSignals: [
      'Tests fail after refactor',
      'Behavior changed unintentionally',
      'New bugs introduced',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_multi_agent_task',
    name: 'Multi-Agent Coordination',
    archetype: 'coordination',
    situations: [
      {
        trigger: 'Task requires multiple agents working together',
        context: ['parallel work', 'multiple files', 'complex task', 'team coordination'],
        confidence: patternConfidence('pattern_multi_agent_task', 1),
        examples: [
          'Implement this across the stack',
          'Parallelize this work',
          'Coordinate frontend and backend changes',
          'Distributed implementation',
        ],
      },
    ],
    corePrimitives: [
      'tp_decompose',
      'tp_ownership_matrix',
      'tp_blackboard_coordination',
      'tp_arbitration',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_contract_net_leasing',
        includeWhen: ['dynamic task assignment needed'],
        excludeWhen: ['static assignment is fine'],
        rationale: 'Dynamic resource allocation',
      },
      {
        primitiveId: 'tp_worktree_isolation',
        includeWhen: ['git conflicts possible'],
        excludeWhen: ['no overlapping file changes'],
        rationale: 'Prevent git conflicts between agents',
      },
      {
        primitiveId: 'tp_communication_cadence',
        includeWhen: ['long-running coordination', 'need checkpoints'],
        excludeWhen: ['short task'],
        rationale: 'Structured communication for long tasks',
      },
    ],
    operators: [
      {
        type: 'parallel',
        purpose: 'Execute independent sub-tasks concurrently',
        placement: 'middle',
      },
      {
        type: 'quorum',
        purpose: 'Require agreement from multiple agents',
        placement: 'late',
      },
      {
        type: 'gate',
        purpose: 'Synchronization point before integration',
        placement: 'late',
        conditions: ['sub-tasks incomplete', 'conflicts detected'],
      },
    ],
    antiPatterns: [
      {
        description: 'No ownership boundaries',
        whyBad: 'Agents step on each other',
        betterAlternative: 'Clear ownership matrix before parallel work',
      },
      {
        description: 'No conflict resolution',
        whyBad: 'Conflicts discovered at integration',
        betterAlternative: 'Arbitration mechanism for conflicts',
      },
    ],
    examples: ['tc_multi_agent_coordination'],
    successSignals: [
      'Sub-tasks complete without conflicts',
      'Integration succeeds',
      'No duplicated work',
    ],
    failureSignals: [
      'Git conflicts at merge',
      'Duplicated or conflicting implementations',
      'Integration failures',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_self_improvement',
    name: 'Self-Improvement',
    archetype: 'evolution',
    situations: [
      {
        trigger: 'System needs to improve its own capabilities',
        context: ['meta', 'self', 'improve', 'evolve', 'learn'],
        confidence: patternConfidence('pattern_self_improvement', 1),
        examples: [
          "Improve LiBrainian's accuracy",
          "Evolve the agent's strategies",
          'Learn from past failures',
          'Optimize the system itself',
        ],
      },
    ],
    corePrimitives: [
      'tp_self_bootstrap',
      'tp_analyze_architecture',
      'tp_hebbian_learning',
      'tp_homeostasis_loop',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_novelty_search',
        includeWhen: ['stuck in local optimum', 'need exploration'],
        excludeWhen: ['current approach working well'],
        rationale: 'Explore new approaches when stuck',
      },
      {
        primitiveId: 'tp_evolution_tournament',
        includeWhen: ['multiple competing strategies'],
        excludeWhen: ['single strategy'],
        rationale: 'Select best strategy through competition',
      },
      {
        primitiveId: 'tp_diversity_enforcer',
        includeWhen: ['risk of monoculture', 'need robustness'],
        excludeWhen: ['diversity not needed'],
        rationale: 'Maintain strategic diversity',
      },
    ],
    operators: [
      {
        type: 'loop',
        purpose: 'Continuous improvement cycle',
        placement: 'wrapper',
        conditions: ['min_improvement_pct>=2', 'stability_regression_pct<=1', 'max_iterations<=10'],
      },
    ],
    antiPatterns: [
      {
        description: 'Improving without stability checks',
        whyBad: 'May break working functionality',
        betterAlternative: 'Always maintain homeostasis while evolving',
      },
      {
        description: 'Greedy optimization',
        whyBad: 'Gets stuck in local optima',
        betterAlternative: 'Include novelty search for exploration',
      },
    ],
    examples: ['Self audit', 'Continuous improvement'],
    successSignals: [
      'Measurable improvement in target metric',
      'No regression in stability',
      'Learning persists to future tasks',
    ],
    failureSignals: [
      'Regression in other metrics',
      'Instability introduced',
      'No measurable improvement',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_codebase_onboarding',
    name: 'Codebase Onboarding',
    archetype: 'analysis',
    situations: [
      {
        trigger: 'New to codebase, need to understand structure',
        context: ['new repo', 'onboarding', 'architecture', 'where to start'],
        confidence: patternConfidence('pattern_codebase_onboarding', 1),
        examples: [
          'How is this codebase organized?',
          'What are the main components?',
          'Where should I start reading?',
          'Explain the architecture',
        ],
      },
    ],
    corePrimitives: [
      'tp_analyze_architecture',
      'tp_dependency_map',
      'tp_clarify_goal',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_arch_mapping',
        includeWhen: ['large codebase', 'need module map'],
        excludeWhen: ['small repo'],
        rationale: 'Build a high-level architecture map.',
      },
      {
        primitiveId: 'tp_search_history',
        includeWhen: ['legacy decisions', 'prior migrations'],
        excludeWhen: ['greenfield'],
        rationale: 'Surface prior reasoning and decisions.',
      },
      {
        primitiveId: 'tp_review_tests',
        includeWhen: ['tests exist', 'behavior unclear'],
        excludeWhen: ['no tests'],
        rationale: 'Use tests to learn system behavior quickly.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Move from high-level mapping to focused goals',
        placement: 'early',
      },
    ],
    antiPatterns: [
      {
        description: 'Reading files randomly',
        whyBad: 'Misses system structure and boundaries',
        betterAlternative: 'Start with architecture map and dependency graph',
      },
      {
        description: 'Skipping goal clarification',
        whyBad: 'Leads to unfocused exploration',
        betterAlternative: 'Define scope before diving deep',
      },
    ],
    examples: ['Onboard to new service', 'First-pass architecture review'],
    successSignals: [
      'Clear component map',
      'Identified entry points',
      'Defined onboarding scope',
    ],
    failureSignals: [
      'No clear map',
      'Confusion about responsibilities',
      'Unbounded exploration',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_security_audit',
    name: 'Security Audit',
    archetype: 'analysis',
    situations: [
      {
        trigger: 'Need to assess security posture of code',
        context: ['security', 'vulnerability', 'audit', 'threat modeling'],
        confidence: patternConfidence('pattern_security_audit', 1),
        examples: [
          'Find security vulnerabilities',
          'Audit authentication code',
          'Check for injection risks',
          'Review access controls',
        ],
      },
    ],
    corePrimitives: [
      'tp_threat_model',
      'tp_security_abuse_cases',
      'tp_risk_scan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_policy_enforcement',
        includeWhen: ['policy requirements', 'compliance controls'],
        excludeWhen: ['no compliance scope'],
        rationale: 'Check enforcement of required security policies.',
      },
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['third-party dependencies', 'supply chain concerns'],
        excludeWhen: ['no external dependencies'],
        rationale: 'Identify dependency-related security exposure.',
      },
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['input handling', 'authorization checks'],
        excludeWhen: ['purely internal workflows'],
        rationale: 'Enumerate edge cases that could trigger security gaps.',
      },
    ],
    operators: [
      {
        type: 'parallel',
        purpose: 'Run threat modeling and abuse-case enumeration concurrently',
        placement: 'middle',
      },
    ],
    antiPatterns: [
      {
        description: 'Assuming default frameworks are secure',
        whyBad: 'Misconfigurations and misuse are common',
        betterAlternative: 'Verify threat model and abuse cases explicitly',
      },
      {
        description: 'Ignoring dependency risk',
        whyBad: 'Supply chain issues can undermine security posture',
        betterAlternative: 'Map dependencies and assess their exposure',
      },
    ],
    examples: ['Auth surface audit', 'Pre-release security review'],
    successSignals: [
      'Threats enumerated with mitigations',
      'No high-risk abuse cases unaddressed',
      'Security risks documented and prioritized',
    ],
    failureSignals: [
      'Critical threats undocumented',
      'No mitigation plan for high-risk findings',
      'Audit ignores dependency surface',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_api_design',
    name: 'API Design Review',
    archetype: 'analysis',
    situations: [
      {
        trigger: 'Designing or reviewing an API',
        context: ['API', 'endpoint', 'interface', 'breaking change'],
        confidence: patternConfidence('pattern_api_design', 1),
        examples: [
          'Review this API design',
          'Is this endpoint well-designed?',
          'Check API consistency',
          'Evaluate breaking changes',
        ],
      },
    ],
    corePrimitives: [
      'tp_assumption_audit',
      'tp_change_impact',
      'tp_edge_case_catalog',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_interface_contract',
        includeWhen: ['public API', 'multiple consumers'],
        excludeWhen: ['private helper API'],
        rationale: 'Define expectations and invariants for consumers.',
      },
      {
        primitiveId: 'tp_list_constraints',
        includeWhen: ['performance or compliance limits', 'strict SLAs'],
        excludeWhen: ['no explicit constraints'],
        rationale: 'Capture non-negotiable constraints up front.',
      },
      {
        primitiveId: 'tp_risk_scan',
        includeWhen: ['breaking changes', 'migration risks'],
        excludeWhen: ['no consumer impact'],
        rationale: 'Assess rollout and change risk.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Audit assumptions before modeling edge cases',
        placement: 'early',
      },
    ],
    antiPatterns: [
      {
        description: 'Designing without consumer empathy',
        whyBad: 'Leads to confusing or inconsistent interfaces',
        betterAlternative: 'Explicitly audit assumptions and use cases',
      },
      {
        description: 'Skipping edge cases',
        whyBad: 'APIs break on unexpected inputs',
        betterAlternative: 'Catalog edge cases and error handling',
      },
    ],
    examples: ['API review', 'Breaking change analysis'],
    successSignals: [
      'Interface contract documented',
      'Edge cases enumerated',
      'Change impact understood',
    ],
    failureSignals: [
      'Ambiguous API responsibilities',
      'Unhandled edge cases',
      'Unclear rollout plan',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_incident_response',
    name: 'Incident Response',
    archetype: 'recovery',
    situations: [
      {
        trigger: 'Production incident needs immediate response',
        context: ['incident', 'outage', 'production', 'urgent', 'emergency'],
        confidence: patternConfidence('pattern_incident_response', 1),
        examples: [
          'Production is down',
          'Users cannot login',
          'API returning 500s',
          'Database connection failed',
        ],
      },
    ],
    corePrimitives: [
      'tp_hypothesis',
      'tp_bisect',
      'tp_root_cause',
      'tp_graceful_degradation',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_instrument',
        includeWhen: ['missing telemetry', 'insufficient logs'],
        excludeWhen: ['observability already strong'],
        rationale: 'Collect signals needed for diagnosis.',
      },
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['multi-service failure', 'complex dependency graph'],
        excludeWhen: ['single service issue'],
        rationale: 'Identify upstream and downstream dependencies quickly.',
      },
      {
        primitiveId: 'tp_verify_plan',
        includeWhen: ['hotfix applied', 'need verification steps'],
        excludeWhen: ['incident unresolved'],
        rationale: 'Ensure recovery steps are verifiable.',
      },
    ],
    operators: [
      {
        type: 'loop',
        purpose: 'Iterate hypothesis-test-recover until stable',
        placement: 'wrapper',
        conditions: ['incident_active', 'signal unstable'],
      },
    ],
    antiPatterns: [
      {
        description: 'Applying fixes without diagnosis',
        whyBad: 'May worsen instability or mask the root cause',
        betterAlternative: 'Stabilize, instrument, and verify root cause before permanent fixes',
      },
      {
        description: 'Ignoring graceful degradation',
        whyBad: 'Full outages reduce options and increase risk',
        betterAlternative: 'Restore partial service while investigating',
      },
    ],
    examples: ['Incident triage', 'Production outage response'],
    successSignals: [
      'Service stabilized quickly',
      'Root cause identified with evidence',
      'Mitigation verified',
    ],
    failureSignals: [
      'Repeated regressions during incident',
      'No clear root cause',
      'Mitigations not verified',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_dependency_update',
    name: 'Safe Dependency Update',
    archetype: 'recovery',
    situations: [
      {
        trigger: 'Need to update dependencies safely',
        context: ['dependency', 'upgrade', 'version', 'security patch'],
        confidence: patternConfidence('pattern_dependency_update', 1),
        examples: [
          'Update to latest React',
          'Apply security patches',
          'Upgrade Node version',
          'Update vulnerable packages',
        ],
      },
    ],
    corePrimitives: [
      'tp_dependency_map',
      'tp_change_impact',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_review_tests',
        includeWhen: ['tests exist', 'integration risk'],
        excludeWhen: ['no tests'],
        rationale: 'Confirm test coverage before upgrading.',
      },
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['breaking changes', 'critical paths'],
        excludeWhen: ['patch-level update'],
        rationale: 'Identify edge cases likely to break.',
      },
      {
        primitiveId: 'tp_risk_scan',
        includeWhen: ['major upgrade', 'security fixes'],
        excludeWhen: ['minor update'],
        rationale: 'Assess upgrade risk and mitigation plan.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Map dependencies before verifying impact',
        placement: 'early',
      },
    ],
    antiPatterns: [
      {
        description: 'Upgrading without impact analysis',
        whyBad: 'Breaks downstream dependencies unexpectedly',
        betterAlternative: 'Map dependencies and assess impact first',
      },
      {
        description: 'Skipping verification plan',
        whyBad: 'No evidence that upgrade is safe',
        betterAlternative: 'Define verification steps and run them',
      },
    ],
    examples: ['Dependency upgrade plan', 'Security patch rollout'],
    successSignals: [
      'Upgrade impact mapped',
      'Verification plan executed',
      'No regressions detected',
    ],
    failureSignals: [
      'Regressions after upgrade',
      'Unknown dependency breakage',
      'Unverified upgrade claims',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_technical_debt',
    name: 'Technical Debt Assessment',
    archetype: 'optimization',
    situations: [
      {
        trigger: 'Need to identify and prioritize technical debt',
        context: ['tech debt', 'cleanup', 'modernize', 'legacy', 'maintenance'],
        confidence: patternConfidence('pattern_technical_debt', 1),
        examples: [
          'What tech debt should we address?',
          'Identify cleanup priorities',
          'Find code that needs modernization',
          'Assess maintenance burden',
        ],
      },
    ],
    corePrimitives: [
      'tp_analyze_architecture',
      'tp_cost_estimation',
      'tp_decompose',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['complex dependencies', 'shared components'],
        excludeWhen: ['isolated module'],
        rationale: 'Reveal high-impact dependencies.',
      },
      {
        primitiveId: 'tp_change_impact',
        includeWhen: ['refactor candidates', 'high risk modules'],
        excludeWhen: ['low-risk cleanup'],
        rationale: 'Quantify the impact of refactors.',
      },
      {
        primitiveId: 'tp_verify_plan',
        includeWhen: ['large refactor', 'critical module'],
        excludeWhen: ['small cleanup'],
        rationale: 'Define evidence before paying down debt.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Estimate cost before decomposition planning',
        placement: 'middle',
      },
    ],
    antiPatterns: [
      {
        description: 'Fixing debt without prioritization',
        whyBad: 'Wastes effort on low-impact areas',
        betterAlternative: 'Estimate cost and impact first',
      },
      {
        description: 'Modernizing without verification',
        whyBad: 'Introduces regressions',
        betterAlternative: 'Plan verification before refactors',
      },
    ],
    examples: ['Debt inventory', 'Refactor roadmap'],
    successSignals: [
      'Debt inventory ranked by impact',
      'Clear refactor plan',
      'Verification plan documented',
    ],
    failureSignals: [
      'Unprioritized backlog',
      'Refactors without evidence',
      'No clarity on impact',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_test_generation',
    name: 'Test Generation',
    archetype: 'construction',
    situations: [
      {
        trigger: 'Need to create tests for existing code',
        context: ['test', 'coverage', 'unit test', 'integration test'],
        confidence: patternConfidence('pattern_test_generation', 1),
        examples: [
          'Add tests for this function',
          'Improve test coverage',
          'Write integration tests',
          'Generate test cases',
        ],
      },
    ],
    corePrimitives: [
      'tp_test_gap_analysis',
      'tp_edge_case_catalog',
      'tp_min_repro',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_review_tests',
        includeWhen: ['existing tests', 'coverage gaps'],
        excludeWhen: ['no existing tests'],
        rationale: 'Align new tests with existing coverage.',
      },
      {
        primitiveId: 'tp_verify_plan',
        includeWhen: ['critical behavior', 'high risk changes'],
        excludeWhen: ['simple unit tests'],
        rationale: 'Define proof obligations for generated tests.',
      },
      {
        primitiveId: 'tp_change_impact',
        includeWhen: ['refactor underway', 'API changes'],
        excludeWhen: ['static code'],
        rationale: 'Focus tests on risky changes.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Catalog edge cases before generating tests',
        placement: 'early',
      },
    ],
    antiPatterns: [
      {
        description: 'Generating tests without understanding failures',
        whyBad: 'Produces shallow tests with low value',
        betterAlternative: 'Use gap analysis and edge cases first',
      },
      {
        description: 'Ignoring minimal reproduction',
        whyBad: 'Tests become brittle and slow',
        betterAlternative: 'Use minimal repro to keep tests focused',
      },
    ],
    examples: ['Coverage expansion', 'Test suite bootstrap'],
    successSignals: [
      'Coverage gaps closed',
      'Edge cases covered',
      'Tests are deterministic',
    ],
    failureSignals: [
      'Flaky tests added',
      'Edge cases still missing',
      'Coverage unchanged',
    ],
  }),
  createCompositionPattern({
    id: 'pattern_documentation',
    name: 'Documentation Generation',
    archetype: 'construction',
    situations: [
      {
        trigger: 'Need to create or update documentation',
        context: ['docs', 'documentation', 'README', 'API docs', 'comments'],
        confidence: patternConfidence('pattern_documentation', 1),
        examples: [
          'Document this API',
          'Update the README',
          'Add code comments',
          'Generate API docs',
        ],
      },
    ],
    corePrimitives: [
      'tp_clarify_goal',
      'tp_analyze_architecture',
      'tp_decompose',
    ],
    optionalPrimitives: [
      {
        primitiveId: 'tp_interface_contract',
        includeWhen: ['public API', 'shared components'],
        excludeWhen: ['internal-only docs'],
        rationale: 'Define the contract before documenting usage.',
      },
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['complex modules', 'cross-team dependencies'],
        excludeWhen: ['single module docs'],
        rationale: 'Clarify dependencies for documentation readers.',
      },
      {
        primitiveId: 'tp_review_tests',
        includeWhen: ['examples from tests', 'usage unclear'],
        excludeWhen: ['no tests'],
        rationale: 'Use tests to ground documentation examples.',
      },
    ],
    operators: [
      {
        type: 'sequence',
        purpose: 'Clarify scope before drafting documentation',
        placement: 'early',
      },
    ],
    antiPatterns: [
      {
        description: 'Writing docs without scope',
        whyBad: 'Leads to incomplete or irrelevant documentation',
        betterAlternative: 'Clarify audience and goals first',
      },
      {
        description: 'Documenting without architecture context',
        whyBad: 'Readers cannot orient themselves',
        betterAlternative: 'Include architecture and dependency overview',
      },
    ],
    examples: ['API documentation refresh', 'README update'],
    successSignals: [
      'Documentation matches system behavior',
      'Examples are accurate and runnable',
      'Audience goals addressed',
    ],
    failureSignals: [
      'Docs contradict code',
      'Missing usage context',
      'Unclear audience or scope',
    ],
  }),
]);
