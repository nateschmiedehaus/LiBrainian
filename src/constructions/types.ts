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
  'comprehensive-quality-construction',
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
  readonly __errorType?: E;
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
