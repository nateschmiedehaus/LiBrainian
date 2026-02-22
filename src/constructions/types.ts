import type { Librarian } from '../api/librarian.js';
import type { IEvidenceLedger } from '../epistemics/evidence_ledger.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import type { ConstructionError } from './base/construction_base.js';
import type { ConstructionCalibrationTracker } from './calibration_tracker.js';
import type { Framework, Language } from './constructable_types.js';

/**
 * Canonical official construction slugs maintained by LiBrainian.
 */
export const OFFICIAL_CONSTRUCTION_SLUGS = [
  'refactoring-safety-checker',
  'bug-investigation-assistant',
  'feature-location-advisor',
  'code-quality-reporter',
  'architecture-verifier',
  'security-audit-helper',
  'skill-audit-construction',
  'comprehensive-quality-construction',
  'preflight-checker',
  'quality-standards',
  'work-presets',
  'architecture-decisions',
  'testing-strategy',
  'operational-excellence',
  'developer-experience',
  'technical-debt',
  'knowledge-management',
  'typescript-patterns',
  'python-patterns',
  'rust-patterns',
  'go-patterns',
  'react-components',
  'vue-components',
  'angular-modules',
  'express-routes',
  'django-views',
  'fastapi-endpoints',
  'jest-testing',
  'vitest-testing',
  'pytest-testing',
  'cypress-e2e',
  'playwright-e2e',
  'blast-radius-oracle',
  'agent-briefing',
  'regression-fence',
  'contract-sentinel',
  'architecture-map',
  'safe-rename',
  'debt-prioritizer',
  'dead-code-detector',
  'onboarding-guide',
  'patrol-dogfood',
] as const;

export type OfficialConstructionSlug = typeof OFFICIAL_CONSTRUCTION_SLUGS[number];
export type NamespacedOfficialConstructionId = `librainian:${OfficialConstructionSlug}`;

/**
 * Legacy class-style construction IDs still emitted by older construction classes.
 */
export const LEGACY_CONSTRUCTION_CLASS_IDS = [
  'RefactoringSafetyChecker',
  'BugInvestigationAssistant',
  'FeatureLocationAdvisor',
  'CodeQualityReporter',
  'ArchitectureVerifier',
  'SecurityAuditHelper',
  'ComprehensiveQualityConstruction',
  'QualityAssessmentConstruction',
  'ArchitectureValidationConstruction',
  'WorkflowValidationConstruction',
  'QualityStandardsConstruction',
  'WorkPresetsConstruction',
  'ArchitectureDecisionsConstruction',
  'TestingStrategyConstruction',
  'OperationalExcellenceConstruction',
  'DeveloperExperienceConstruction',
  'TechnicalDebtConstruction',
  'KnowledgeManagementConstruction',
  'RationaleConstruction',
] as const;

export type LegacyConstructionClassId = typeof LEGACY_CONSTRUCTION_CLASS_IDS[number];
export type LegacyConstructionId = OfficialConstructionSlug | LegacyConstructionClassId;
export type ThirdPartyConstructionId = `@${string}/${string}`;

/**
 * Discriminated construction identifier.
 *
 * - Official IDs are namespaced as `librainian:<slug>`.
 * - Legacy IDs are accepted for compatibility during migration.
 * - Third-party IDs use npm-like scoped coordinates (`@scope/name`).
 */
export type ConstructionId =
  | NamespacedOfficialConstructionId
  | LegacyConstructionId
  | ThirdPartyConstructionId;

const OFFICIAL_CONSTRUCTION_SLUG_SET = new Set<string>(OFFICIAL_CONSTRUCTION_SLUGS);
const LEGACY_CONSTRUCTION_ID_SET = new Set<string>([
  ...OFFICIAL_CONSTRUCTION_SLUGS,
  ...LEGACY_CONSTRUCTION_CLASS_IDS,
]);

/**
 * Legacy class-ID aliases to canonical namespaced IDs.
 */
export const LEGACY_CONSTRUCTION_ALIASES: Partial<Record<LegacyConstructionClassId, NamespacedOfficialConstructionId>> = {
  RefactoringSafetyChecker: 'librainian:refactoring-safety-checker',
  BugInvestigationAssistant: 'librainian:bug-investigation-assistant',
  FeatureLocationAdvisor: 'librainian:feature-location-advisor',
  CodeQualityReporter: 'librainian:code-quality-reporter',
  ArchitectureVerifier: 'librainian:architecture-verifier',
  SecurityAuditHelper: 'librainian:security-audit-helper',
  ComprehensiveQualityConstruction: 'librainian:comprehensive-quality-construction',
  QualityStandardsConstruction: 'librainian:quality-standards',
  WorkPresetsConstruction: 'librainian:work-presets',
  ArchitectureDecisionsConstruction: 'librainian:architecture-decisions',
  TestingStrategyConstruction: 'librainian:testing-strategy',
  OperationalExcellenceConstruction: 'librainian:operational-excellence',
  DeveloperExperienceConstruction: 'librainian:developer-experience',
  TechnicalDebtConstruction: 'librainian:technical-debt',
  KnowledgeManagementConstruction: 'librainian:knowledge-management',
};

/**
 * Runtime type guard for `ConstructionId`.
 */
export function isConstructionId(id: string): id is ConstructionId {
  if (LEGACY_CONSTRUCTION_ID_SET.has(id)) {
    return true;
  }
  if (id.startsWith('librainian:')) {
    return OFFICIAL_CONSTRUCTION_SLUG_SET.has(id.slice('librainian:'.length));
  }
  return /^@[^/\s]+\/[^/\s]+$/.test(id);
}

/**
 * Convert legacy IDs to canonical namespaced IDs when an alias exists.
 */
export function toCanonicalConstructionId(id: string): ConstructionId | undefined {
  if (id.startsWith('librainian:')) {
    return isConstructionId(id) ? id : undefined;
  }
  const alias = LEGACY_CONSTRUCTION_ALIASES[id as LegacyConstructionClassId];
  if (alias) {
    return alias;
  }
  if (LEGACY_CONSTRUCTION_ID_SET.has(id)) {
    return id as LegacyConstructionId;
  }
  return isConstructionId(id) ? id : undefined;
}

/**
 * Base dependency requirements for constructions.
 */
export interface ConstructionRequirements {
  readonly librarian: Librarian;
}

/**
 * Default dependency context for canonical constructions.
 */
export interface LibrarianContext extends ConstructionRequirements {
  readonly librarian: Librarian;
  readonly calibrationTracker?: ConstructionCalibrationTracker;
  readonly evidenceLedger?: IEvidenceLedger;
}

export type LiBrainianContext = LibrarianContext;

/**
 * Call-time execution context for canonical constructions.
 */
export interface Context<R = LibrarianContext> {
  deps: R;
  signal: AbortSignal;
  sessionId: string;
  tokenBudget?: number;
  metadata?: Record<string, unknown>;
  traceContext?: Record<string, unknown>;
}

export type ConstructionFailureKind =
  | 'timeout'
  | 'cancelled'
  | 'input_error'
  | 'capability_missing'
  | 'llm_error'
  | 'construction_error'
  | 'unknown';

export interface ConstructionFailureHint {
  readonly kind: ConstructionFailureKind;
  readonly constructionId: string;
  readonly message: string;
  readonly retriable: boolean;
  readonly suggestions: readonly string[];
  readonly cause?: string;
}

export interface ConstructionExecutionTraceStep {
  readonly constructionId: string;
  readonly constructionName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: 'succeeded' | 'failed';
  readonly inputType: string;
  readonly outputType?: string;
  readonly errorKind?: ConstructionFailureKind;
  readonly errorMessage?: string;
}

export interface ConstructionExecutionTrace {
  readonly mode: 'execution_trace';
  readonly rootConstructionId: string;
  readonly rootConstructionName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly steps: readonly ConstructionExecutionTraceStep[];
  readonly failed?: ConstructionFailureHint;
}

export interface ConstructionDebugOptions {
  readonly includeSuccessfulSteps?: boolean;
}

/**
 * Railway-style construction outcome.
 *
 * Canonical construction operators may return this typed channel instead of throwing.
 * A compatibility path still allows legacy constructions to return raw values.
 */
export type ConstructionOutcome<O, E extends ConstructionError = ConstructionError> =
  | {
      readonly ok: true;
      readonly value: O;
      readonly result: O;
    }
  | {
      readonly ok: false;
      readonly error: E;
      readonly partial?: Partial<O>;
      readonly errorAt?: string;
    };

/**
 * Compatibility execution result while the construction ecosystem migrates.
 * - Success may be returned as raw O (legacy) or as an explicit ok(...) outcome.
 * - Failure should be returned as fail(...), not thrown.
 */
export type ConstructionExecutionResult<
  O,
  E extends ConstructionError = ConstructionError,
> = O | ConstructionOutcome<O, E>;

/**
 * Outcome constructor for success track.
 */
export function ok<O, E extends ConstructionError = ConstructionError>(
  value: O,
): ConstructionOutcome<O, E> {
  return {
    ok: true,
    value,
    result: value,
  };
}

/**
 * Outcome constructor for error track.
 */
export function fail<O, E extends ConstructionError = ConstructionError>(
  error: E,
  partial?: Partial<O>,
  errorAt?: string,
): ConstructionOutcome<O, E> {
  return {
    ok: false,
    error,
    partial,
    errorAt,
  };
}

/**
 * Runtime type guard for construction outcomes.
 */
export function isConstructionOutcome<O, E extends ConstructionError = ConstructionError>(
  value: unknown,
): value is ConstructionOutcome<O, E> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return false;
  }
  const candidate = value as { ok?: unknown };
  return typeof candidate.ok === 'boolean';
}

export type Either<A, B> =
  | { readonly tag: 'left'; readonly value: A }
  | { readonly tag: 'right'; readonly value: B };

export interface CostRange {
  readonly min: number;
  readonly max: number;
}

export interface CostSemiring {
  readonly llmCalls: CostRange;
  readonly tokens: CostRange;
  readonly latencyMs: CostRange;
  readonly networkRequests: boolean;
  readonly fileReads: CostRange;
}

export interface ConstructionPath {
  readonly label: string;
  readonly constructionIds: readonly string[];
}

/**
 * Layer pattern: upgrade a context with additional requirement capabilities.
 */
export type Layer<R1, R2 extends R1> = (base: Context<R1>) => Context<R2>;

/**
 * Canonical construction interface used for composition and adapter bridging.
 *
 * Type parameters:
 * - I: input type
 * - O: output type
 * - E: error type channel (reserved for typed-outcome migration)
 * - R: dependency context requirements
 */
export interface Construction<
  I,
  O,
  E extends ConstructionError = ConstructionError,
  R = LibrarianContext,
> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  execute(input: I, context?: Context<R>): Promise<O>;
  getEstimatedConfidence?(): ConfidenceValue;
  debug?(
    options?: ConstructionDebugOptions
  ): Construction<I, O, E, R> & { getLastTrace(): ConstructionExecutionTrace | undefined };
  whyFailed?(error: unknown): ConstructionFailureHint;
  readonly __errorType?: E;
}

export interface SelectiveConstruction<
  I,
  O,
  E extends ConstructionError = ConstructionError,
  R = LibrarianContext,
> extends Construction<I, O, E, R> {
  possiblePaths(): ConstructionPath[];
  maxCost(): CostSemiring;
  minCost(): CostSemiring;
  dependencySetUpper(): Set<string>;
  dependencySetLower(): Set<string>;
}

export interface ProgressMetric<S> {
  measure: (state: S) => number;
  capacity: number;
  stateHash?: (state: S) => string;
}

export type FixpointTerminationReason =
  | 'converged'
  | 'stop_condition'
  | 'budget_exhausted'
  | 'cycle'
  | 'monotone_violation_limit';

export interface FixpointMetadata {
  readonly iterations: number;
  readonly finalMeasure: number;
  readonly monotoneViolations: number;
  readonly cycleDetected: boolean;
  readonly terminationReason: FixpointTerminationReason;
}

export type CapabilityId = string;

export interface ConstructionSchema {
  type?: string;
  description?: string;
  properties?: Record<string, ConstructionSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ConstructionSchema | ConstructionSchema[];
  enum?: Array<string | number | boolean>;
  oneOf?: ConstructionSchema[];
  anyOf?: ConstructionSchema[];
  allOf?: ConstructionSchema[];
  $ref?: string;
}

export interface ConstructionManifestExample {
  description: string;
  input: unknown;
  expectedOutputSummary: string;
}

export type ConstructionScope = '@librainian' | '@librainian-community' | `@${string}`;
export type ConstructionTrustTier = 'official' | 'partner' | 'community';

/**
 * Metadata for a registered construction.
 */
export interface ConstructionManifest {
  readonly id: ConstructionId;
  readonly name: string;
  readonly scope: ConstructionScope;
  readonly version: string;
  readonly description: string;
  readonly agentDescription: string;
  readonly inputSchema: ConstructionSchema;
  readonly outputSchema: ConstructionSchema;
  readonly requiredCapabilities: CapabilityId[];
  readonly tags: string[];
  readonly languages?: Language[];
  readonly frameworks?: Framework[];
  readonly trustTier: ConstructionTrustTier;
  readonly examples: ConstructionManifestExample[];
  readonly construction: Construction<unknown, unknown, ConstructionError, unknown>;
  readonly available?: boolean;
  readonly legacyIds?: LegacyConstructionId[];
}

export interface ConstructionListFilter {
  tags?: string[];
  capabilities?: CapabilityId[];
  trustTier?: ConstructionTrustTier;
  availableOnly?: boolean;
}
