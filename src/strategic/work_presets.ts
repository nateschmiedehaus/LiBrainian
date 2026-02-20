/**
 * @fileoverview Work Process Presets
 *
 * Reusable, composable presets for reliable, world-class orchestration.
 * These presets standardize work processes across different contexts:
 *
 * 1. **Quality Gates** - Checkpoints before phase transitions
 * 2. **Orchestration** - Multi-agent coordination patterns
 * 3. **Deliverables** - Output standards and requirements
 * 4. **Review** - Validation and verification procedures
 *
 * Standard preset configurations:
 * - STRICT_PRESET: High-stakes production code
 * - STANDARD_PRESET: Normal development work
 * - EXPLORATORY_PRESET: Research/prototyping
 *
 * @packageDocumentation
 */

import type { ValidationResult, ValidationError, ValidationWarning } from './types.js';

// ============================================================================
// GATE REQUIREMENT TYPES
// ============================================================================

/**
 * Types of gate requirements that must be satisfied before phase transitions.
 */
export type GateRequirementType =
  | 'test_coverage'
  | 'lint_pass'
  | 'type_check'
  | 'review_approved'
  | 'confidence_threshold'
  | 'evidence_complete';

/**
 * A single requirement that must be met at a quality gate.
 */
export interface PresetGateRequirement {
  /** Type of requirement */
  type: GateRequirementType;

  /** Numeric threshold (for coverage, confidence, etc.) */
  threshold?: number;

  /** Human-readable description of the requirement */
  description: string;
}

/**
 * A quality gate that must be passed before transitioning phases.
 */
export interface PresetQualityGate {
  /** Phase this gate guards (e.g., 'implementation', 'review', 'deploy') */
  phase: string;

  /** Requirements that must be met */
  requirements: PresetGateRequirement[];

  /** If true, must pass to proceed; if false, warning only */
  blocking: boolean;
}

/**
 * Preset configuration for quality gates.
 */
export interface QualityGatesPreset {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this preset is for */
  description?: string;

  /** Quality gates in this preset */
  gates: PresetQualityGate[];
}

// Backwards compatibility aliases
/** @deprecated Use PresetGateRequirement instead */
export type GateRequirement = PresetGateRequirement;
/** @deprecated Use PresetQualityGate instead */
export type QualityGate = PresetQualityGate;

// ============================================================================
// ORCHESTRATION TYPES
// ============================================================================

/**
 * Policy for handling failures during orchestration.
 */
export type FailurePolicy = 'fail_fast' | 'continue' | 'retry';

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Base backoff time in milliseconds */
  backoffMs: number;

  /** Backoff multiplier for exponential backoff */
  backoffMultiplier?: number;

  /** Maximum backoff time in milliseconds */
  maxBackoffMs?: number;
}

/**
 * Preset configuration for multi-agent orchestration.
 */
export interface OrchestrationPreset {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name?: string;

  /** Description of this orchestration pattern */
  description?: string;

  /** Maximum agents that can run concurrently */
  maxConcurrentAgents: number;

  /** Interval for progress checks in milliseconds */
  progressCheckIntervalMs: number;

  /** Time threshold for detecting stalled agents */
  stallDetectionThresholdMs: number;

  /** Policy for handling agent failures */
  failurePolicy: FailurePolicy;

  /** Retry configuration (required if failurePolicy is 'retry') */
  retryConfig?: RetryConfig;

  /** Maximum total runtime in milliseconds */
  maxTotalRuntimeMs?: number;

  /** Minimum agents required to consider success */
  minSuccessfulAgents?: number;
}

// ============================================================================
// DELIVERABLE TYPES
// ============================================================================

/**
 * Type of deliverable output.
 */
export type DeliverableType = 'code' | 'documentation' | 'report' | 'artifact';

/**
 * A single requirement for a deliverable.
 */
export interface DeliverableRequirement {
  /** Requirement identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of the requirement */
  description: string;

  /** Is this requirement mandatory? */
  mandatory: boolean;

  /** Verification method */
  verification: 'automated' | 'manual' | 'hybrid';

  /** Command to run for automated verification */
  verificationCommand?: string;
}

/**
 * Preset configuration for deliverable standards.
 */
export interface DeliverablePreset {
  /** Unique identifier */
  id?: string;

  /** Type of deliverable */
  type: DeliverableType;

  /** Human-readable name */
  name?: string;

  /** Description of this deliverable preset */
  description?: string;

  /** Requirements for this type of deliverable */
  requirements: DeliverableRequirement[];
}

// ============================================================================
// REVIEW TYPES
// ============================================================================

/**
 * Condition that triggers peer review.
 */
export type ReviewTriggerCondition =
  | 'high_complexity'
  | 'security_sensitive'
  | 'breaking_change'
  | 'new_dependency'
  | 'large_change'
  | 'critical_path'
  | 'custom';

/**
 * Trigger for initiating peer review.
 */
export interface ReviewTrigger {
  /** Condition that triggers review */
  condition: ReviewTriggerCondition;

  /** Threshold value (for quantitative conditions) */
  threshold?: number;

  /** Custom condition expression */
  customCondition?: string;

  /** Description of when this triggers */
  description: string;

  /** Minimum number of reviewers required */
  minReviewers?: number;
}

/**
 * Type of automated check.
 */
export type AutomatedCheckType =
  | 'lint'
  | 'type_check'
  | 'test'
  | 'security_scan'
  | 'dependency_audit'
  | 'coverage'
  | 'performance'
  | 'accessibility'
  | 'custom';

/**
 * Configuration for an automated check.
 */
export interface AutomatedCheck {
  /** Type of check */
  type: AutomatedCheckType;

  /** Human-readable name */
  name: string;

  /** Description of what this check verifies */
  description?: string;

  /** Command to execute */
  command?: string;

  /** Is this check required to pass? */
  required: boolean;

  /** Threshold for passing (if applicable) */
  threshold?: number;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Preset configuration for review procedures.
 */
export interface ReviewPreset {
  /** Unique identifier */
  id?: string;

  /** Human-readable name */
  name?: string;

  /** Description of this review preset */
  description?: string;

  /** Checklist items for self-review */
  selfReviewChecklist: string[];

  /** Triggers for requiring peer review */
  peerReviewTriggers: ReviewTrigger[];

  /** Automated checks to run */
  automatedChecks: AutomatedCheck[];

  /** Minimum self-review confidence to skip peer review */
  minSelfReviewConfidence?: number;
}

// ============================================================================
// COMPOSITE WORK PRESET
// ============================================================================

/**
 * Complete work preset combining all preset types.
 */
export interface WorkPreset {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this preset is for */
  description: string;

  /** Version of the preset */
  version: string;

  /** Quality gates configuration */
  qualityGates: QualityGatesPreset;

  /** Orchestration configuration */
  orchestration: OrchestrationPreset;

  /** Deliverable presets by type */
  deliverables: DeliverablePreset[];

  /** Review configuration */
  review: ReviewPreset;

  /** When this preset was created */
  createdAt: string;

  /** When this preset was last updated */
  updatedAt: string;

  /** Tags for categorization */
  tags?: string[];
}

// ============================================================================
// STANDARD QUALITY GATES
// ============================================================================

/**
 * Quality gates for strict/high-stakes work.
 */
export const STRICT_QUALITY_GATES: QualityGatesPreset = {
  id: 'strict-quality-gates',
  name: 'Strict Quality Gates',
  description: 'Rigorous quality gates for high-stakes production code',
  gates: [
    {
      phase: 'implementation',
      blocking: true,
      requirements: [
        {
          type: 'type_check',
          description: 'All TypeScript strict mode checks must pass',
        },
        {
          type: 'lint_pass',
          description: 'Zero linting errors or warnings',
        },
      ],
    },
    {
      phase: 'testing',
      blocking: true,
      requirements: [
        {
          type: 'test_coverage',
          threshold: 90,
          description: 'Minimum 90% code coverage required',
        },
        {
          type: 'evidence_complete',
          description: 'All test evidence must be documented',
        },
      ],
    },
    {
      phase: 'review',
      blocking: true,
      requirements: [
        {
          type: 'review_approved',
          description: 'At least two peer reviewers must approve',
        },
        {
          type: 'confidence_threshold',
          threshold: 0.85,
          description: 'Minimum 85% confidence in changes',
        },
      ],
    },
    {
      phase: 'deploy',
      blocking: true,
      requirements: [
        {
          type: 'evidence_complete',
          description: 'All deployment evidence documented',
        },
        {
          type: 'confidence_threshold',
          threshold: 0.90,
          description: 'Minimum 90% deployment confidence',
        },
      ],
    },
  ],
};

/**
 * Quality gates for standard development work.
 */
export const STANDARD_QUALITY_GATES: QualityGatesPreset = {
  id: 'standard-quality-gates',
  name: 'Standard Quality Gates',
  description: 'Balanced quality gates for normal development work',
  gates: [
    {
      phase: 'implementation',
      blocking: true,
      requirements: [
        {
          type: 'type_check',
          description: 'TypeScript type checks must pass',
        },
        {
          type: 'lint_pass',
          description: 'No linting errors (warnings acceptable)',
        },
      ],
    },
    {
      phase: 'testing',
      blocking: true,
      requirements: [
        {
          type: 'test_coverage',
          threshold: 70,
          description: 'Minimum 70% code coverage',
        },
      ],
    },
    {
      phase: 'review',
      blocking: false,
      requirements: [
        {
          type: 'review_approved',
          description: 'At least one peer reviewer approval recommended',
        },
        {
          type: 'confidence_threshold',
          threshold: 0.70,
          description: 'Minimum 70% confidence in changes',
        },
      ],
    },
  ],
};

/**
 * Quality gates for exploratory/prototyping work.
 */
export const EXPLORATORY_QUALITY_GATES: QualityGatesPreset = {
  id: 'exploratory-quality-gates',
  name: 'Exploratory Quality Gates',
  description: 'Minimal quality gates for research and prototyping',
  gates: [
    {
      phase: 'implementation',
      blocking: false,
      requirements: [
        {
          type: 'type_check',
          description: 'Type checks recommended but not required',
        },
      ],
    },
    {
      phase: 'testing',
      blocking: false,
      requirements: [
        {
          type: 'test_coverage',
          threshold: 30,
          description: 'Minimal coverage for critical paths',
        },
      ],
    },
  ],
};

// ============================================================================
// STANDARD ORCHESTRATION PRESETS
// ============================================================================

/**
 * Orchestration preset for strict/high-stakes work.
 */
export const STRICT_ORCHESTRATION: OrchestrationPreset = {
  id: 'strict-orchestration',
  name: 'Strict Orchestration',
  description: 'Conservative orchestration for high-stakes work',
  maxConcurrentAgents: 2,
  progressCheckIntervalMs: 5000,
  stallDetectionThresholdMs: 30000,
  failurePolicy: 'fail_fast',
  maxTotalRuntimeMs: 3600000, // 1 hour
  minSuccessfulAgents: undefined, // All must succeed
};

/**
 * Orchestration preset for standard development work.
 */
export const STANDARD_ORCHESTRATION: OrchestrationPreset = {
  id: 'standard-orchestration',
  name: 'Standard Orchestration',
  description: 'Balanced orchestration for normal development',
  maxConcurrentAgents: 4,
  progressCheckIntervalMs: 10000,
  stallDetectionThresholdMs: 60000,
  failurePolicy: 'retry',
  retryConfig: {
    maxRetries: 2,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 10000,
  },
  maxTotalRuntimeMs: 7200000, // 2 hours
};

/**
 * Orchestration preset for exploratory/prototyping work.
 */
export const EXPLORATORY_ORCHESTRATION: OrchestrationPreset = {
  id: 'exploratory-orchestration',
  name: 'Exploratory Orchestration',
  description: 'Flexible orchestration for research and prototyping',
  maxConcurrentAgents: 8,
  progressCheckIntervalMs: 30000,
  stallDetectionThresholdMs: 120000,
  failurePolicy: 'continue',
  maxTotalRuntimeMs: 14400000, // 4 hours
  minSuccessfulAgents: 1, // At least one must succeed
};

// ============================================================================
// STANDARD DELIVERABLE PRESETS
// ============================================================================

/**
 * Deliverable requirements for production code.
 */
export const CODE_DELIVERABLE_STRICT: DeliverablePreset = {
  id: 'code-deliverable-strict',
  type: 'code',
  name: 'Strict Code Deliverable',
  description: 'Requirements for production-ready code',
  requirements: [
    {
      id: 'typed',
      name: 'Full Type Coverage',
      description: 'All code must have explicit types, no "any"',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npx tsc --noEmit --strict',
    },
    {
      id: 'tested',
      name: 'Comprehensive Tests',
      description: 'Unit tests for all public APIs, integration tests for flows',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npm test -- --coverage',
    },
    {
      id: 'documented',
      name: 'API Documentation',
      description: 'JSDoc comments for all public APIs',
      mandatory: true,
      verification: 'hybrid',
    },
    {
      id: 'linted',
      name: 'Lint Clean',
      description: 'No linting errors or warnings',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npm run lint',
    },
    {
      id: 'security-reviewed',
      name: 'Security Review',
      description: 'Security implications reviewed and documented',
      mandatory: true,
      verification: 'manual',
    },
  ],
};

/**
 * Deliverable requirements for standard code.
 */
export const CODE_DELIVERABLE_STANDARD: DeliverablePreset = {
  id: 'code-deliverable-standard',
  type: 'code',
  name: 'Standard Code Deliverable',
  description: 'Requirements for normal development code',
  requirements: [
    {
      id: 'typed',
      name: 'Type Coverage',
      description: 'Code should have types, minimal "any" usage',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npx tsc --noEmit',
    },
    {
      id: 'tested',
      name: 'Tests',
      description: 'Unit tests for main functionality',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npm test',
    },
    {
      id: 'linted',
      name: 'Lint Clean',
      description: 'No linting errors',
      mandatory: true,
      verification: 'automated',
      verificationCommand: 'npm run lint',
    },
  ],
};

/**
 * Deliverable requirements for exploratory code.
 */
export const CODE_DELIVERABLE_EXPLORATORY: DeliverablePreset = {
  id: 'code-deliverable-exploratory',
  type: 'code',
  name: 'Exploratory Code Deliverable',
  description: 'Minimal requirements for research/prototype code',
  requirements: [
    {
      id: 'runnable',
      name: 'Runnable',
      description: 'Code must execute without errors',
      mandatory: true,
      verification: 'automated',
    },
    {
      id: 'documented-intent',
      name: 'Intent Documented',
      description: 'High-level intent and approach documented',
      mandatory: true,
      verification: 'manual',
    },
  ],
};

/**
 * Deliverable requirements for documentation.
 */
export const DOCUMENTATION_DELIVERABLE: DeliverablePreset = {
  id: 'documentation-deliverable',
  type: 'documentation',
  name: 'Documentation Deliverable',
  description: 'Requirements for documentation deliverables',
  requirements: [
    {
      id: 'accurate',
      name: 'Accuracy',
      description: 'Documentation accurately reflects the code/system',
      mandatory: true,
      verification: 'manual',
    },
    {
      id: 'complete',
      name: 'Completeness',
      description: 'All relevant topics are covered',
      mandatory: true,
      verification: 'manual',
    },
    {
      id: 'examples',
      name: 'Examples',
      description: 'Includes working examples where applicable',
      mandatory: false,
      verification: 'hybrid',
    },
  ],
};

/**
 * Deliverable requirements for reports.
 */
export const REPORT_DELIVERABLE: DeliverablePreset = {
  id: 'report-deliverable',
  type: 'report',
  name: 'Report Deliverable',
  description: 'Requirements for report deliverables',
  requirements: [
    {
      id: 'structured',
      name: 'Structure',
      description: 'Report has clear sections and organization',
      mandatory: true,
      verification: 'manual',
    },
    {
      id: 'evidence-backed',
      name: 'Evidence',
      description: 'Claims are backed by evidence',
      mandatory: true,
      verification: 'manual',
    },
    {
      id: 'actionable',
      name: 'Actionable',
      description: 'Includes actionable recommendations',
      mandatory: false,
      verification: 'manual',
    },
  ],
};

// ============================================================================
// STANDARD REVIEW PRESETS
// ============================================================================

/**
 * Review preset for strict/high-stakes work.
 */
export const STRICT_REVIEW: ReviewPreset = {
  id: 'strict-review',
  name: 'Strict Review',
  description: 'Comprehensive review process for high-stakes code',
  selfReviewChecklist: [
    'All acceptance criteria are met',
    'No TODOs or FIXMEs remain in production code',
    'Error handling is comprehensive',
    'Security implications have been considered',
    'Performance implications have been considered',
    'Backward compatibility is maintained',
    'All edge cases are handled',
    'Documentation is complete and accurate',
    'Tests cover all new functionality',
    'No sensitive data is exposed or logged',
  ],
  peerReviewTriggers: [
    {
      condition: 'security_sensitive',
      description: 'Changes involving authentication, authorization, or data handling',
      minReviewers: 2,
    },
    {
      condition: 'breaking_change',
      description: 'Changes to public APIs or contracts',
      minReviewers: 2,
    },
    {
      condition: 'new_dependency',
      description: 'Adding new external dependencies',
      minReviewers: 1,
    },
    {
      condition: 'large_change',
      threshold: 500,
      description: 'Changes exceeding 500 lines',
      minReviewers: 2,
    },
    {
      condition: 'critical_path',
      description: 'Changes to critical system paths',
      minReviewers: 2,
    },
  ],
  automatedChecks: [
    {
      type: 'type_check',
      name: 'TypeScript Strict',
      description: 'Full TypeScript strict mode checking',
      command: 'npx tsc --noEmit --strict',
      required: true,
      timeoutMs: 120000,
    },
    {
      type: 'lint',
      name: 'ESLint',
      description: 'Linting with all rules enabled',
      command: 'npm run lint',
      required: true,
      timeoutMs: 60000,
    },
    {
      type: 'test',
      name: 'Full Test Suite',
      description: 'Run all tests with coverage',
      command: 'npm test -- --coverage',
      required: true,
      timeoutMs: 300000,
    },
    {
      type: 'coverage',
      name: 'Coverage Threshold',
      description: 'Ensure minimum coverage',
      threshold: 90,
      required: true,
    },
    {
      type: 'security_scan',
      name: 'Security Audit',
      description: 'Scan for security vulnerabilities',
      command: 'npm audit',
      required: true,
      timeoutMs: 60000,
    },
    {
      type: 'dependency_audit',
      name: 'Dependency Check',
      description: 'Check for outdated or vulnerable dependencies',
      command: 'npm outdated',
      required: false,
      timeoutMs: 60000,
    },
  ],
  minSelfReviewConfidence: 0.90,
};

/**
 * Review preset for standard development work.
 */
export const STANDARD_REVIEW: ReviewPreset = {
  id: 'standard-review',
  name: 'Standard Review',
  description: 'Balanced review process for normal development',
  selfReviewChecklist: [
    'Code compiles without errors',
    'Tests pass locally',
    'No obvious bugs or issues',
    'Code is reasonably documented',
    'Changes match the requirements',
  ],
  peerReviewTriggers: [
    {
      condition: 'security_sensitive',
      description: 'Changes involving security-sensitive code',
      minReviewers: 1,
    },
    {
      condition: 'breaking_change',
      description: 'Changes to public APIs',
      minReviewers: 1,
    },
    {
      condition: 'large_change',
      threshold: 300,
      description: 'Changes exceeding 300 lines',
      minReviewers: 1,
    },
  ],
  automatedChecks: [
    {
      type: 'type_check',
      name: 'TypeScript',
      description: 'TypeScript type checking',
      command: 'npx tsc --noEmit',
      required: true,
      timeoutMs: 120000,
    },
    {
      type: 'lint',
      name: 'ESLint',
      description: 'Linting check',
      command: 'npm run lint',
      required: true,
      timeoutMs: 60000,
    },
    {
      type: 'test',
      name: 'Test Suite',
      description: 'Run tests',
      command: 'npm test',
      required: true,
      timeoutMs: 180000,
    },
  ],
  minSelfReviewConfidence: 0.75,
};

/**
 * Review preset for exploratory/prototyping work.
 */
export const EXPLORATORY_REVIEW: ReviewPreset = {
  id: 'exploratory-review',
  name: 'Exploratory Review',
  description: 'Lightweight review for research and prototyping',
  selfReviewChecklist: [
    'Code runs without crashing',
    'Intent is documented',
    'Known limitations are noted',
  ],
  peerReviewTriggers: [
    {
      condition: 'security_sensitive',
      description: 'Security-sensitive exploration',
      minReviewers: 1,
    },
  ],
  automatedChecks: [
    {
      type: 'type_check',
      name: 'TypeScript',
      description: 'Basic type checking',
      command: 'npx tsc --noEmit',
      required: false,
      timeoutMs: 60000,
    },
  ],
  minSelfReviewConfidence: 0.50,
};

// ============================================================================
// COMPLETE WORK PRESETS
// ============================================================================

/**
 * Strict preset for high-stakes production code.
 */
export const STRICT_PRESET: WorkPreset = {
  id: 'strict',
  name: 'Strict',
  description: 'High-stakes production code requiring rigorous quality controls',
  version: '1.0.0',
  qualityGates: STRICT_QUALITY_GATES,
  orchestration: STRICT_ORCHESTRATION,
  deliverables: [
    CODE_DELIVERABLE_STRICT,
    DOCUMENTATION_DELIVERABLE,
    REPORT_DELIVERABLE,
  ],
  review: STRICT_REVIEW,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: ['production', 'high-stakes', 'strict'],
};

/**
 * Standard preset for normal development work.
 */
export const STANDARD_PRESET: WorkPreset = {
  id: 'standard',
  name: 'Standard',
  description: 'Balanced preset for normal development work',
  version: '1.0.0',
  qualityGates: STANDARD_QUALITY_GATES,
  orchestration: STANDARD_ORCHESTRATION,
  deliverables: [
    CODE_DELIVERABLE_STANDARD,
    DOCUMENTATION_DELIVERABLE,
  ],
  review: STANDARD_REVIEW,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: ['development', 'standard'],
};

/**
 * Exploratory preset for research and prototyping.
 */
export const EXPLORATORY_PRESET: WorkPreset = {
  id: 'exploratory',
  name: 'Exploratory',
  description: 'Lightweight preset for research and prototyping',
  version: '1.0.0',
  qualityGates: EXPLORATORY_QUALITY_GATES,
  orchestration: EXPLORATORY_ORCHESTRATION,
  deliverables: [
    CODE_DELIVERABLE_EXPLORATORY,
  ],
  review: EXPLORATORY_REVIEW,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: ['research', 'prototype', 'exploratory'],
};

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a quality gates preset with defaults applied.
 */
export function createQualityGatesPreset(
  input: Partial<QualityGatesPreset> & Pick<QualityGatesPreset, 'id' | 'name'>
): QualityGatesPreset {
  return {
    gates: [],
    ...input,
  };
}

/**
 * Create an orchestration preset with defaults applied.
 */
export function createOrchestrationPreset(
  input: Partial<OrchestrationPreset> & Pick<OrchestrationPreset, 'id'>
): OrchestrationPreset {
  const preset: OrchestrationPreset = {
    maxConcurrentAgents: 4,
    progressCheckIntervalMs: 10000,
    stallDetectionThresholdMs: 60000,
    failurePolicy: 'retry',
    ...input,
  };

  // Ensure retry config exists if policy is retry
  if (preset.failurePolicy === 'retry' && !preset.retryConfig) {
    preset.retryConfig = {
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 30000,
    };
  }

  return preset;
}

/**
 * Create a deliverable preset with defaults applied.
 */
export function createDeliverablePreset(
  input: Partial<DeliverablePreset> & Pick<DeliverablePreset, 'type'>
): DeliverablePreset {
  return {
    requirements: [],
    ...input,
  };
}

/**
 * Create a review preset with defaults applied.
 */
export function createReviewPreset(
  input: Partial<ReviewPreset>
): ReviewPreset {
  return {
    selfReviewChecklist: [],
    peerReviewTriggers: [],
    automatedChecks: [],
    ...input,
  };
}

/**
 * Create a complete work preset with defaults applied.
 */
export function createWorkPreset(
  input: Partial<WorkPreset> & Pick<WorkPreset, 'id' | 'name'>
): WorkPreset {
  const now = new Date().toISOString();

  return {
    description: '',
    version: '1.0.0',
    qualityGates: STANDARD_QUALITY_GATES,
    orchestration: STANDARD_ORCHESTRATION,
    deliverables: [CODE_DELIVERABLE_STANDARD],
    review: STANDARD_REVIEW,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

/**
 * Merge two work presets, with the second taking precedence.
 */
export function mergeWorkPresets(
  base: WorkPreset,
  overrides: Partial<WorkPreset>
): WorkPreset {
  return {
    ...base,
    ...overrides,
    qualityGates: overrides.qualityGates ?? base.qualityGates,
    orchestration: overrides.orchestration ?? base.orchestration,
    deliverables: overrides.deliverables ?? base.deliverables,
    review: overrides.review ?? base.review,
    updatedAt: new Date().toISOString(),
    tags: Array.from(new Set([...(base.tags ?? []), ...(overrides.tags ?? [])])),
  };
}

/**
 * Get a preset by ID.
 */
export function getPresetById(id: string): WorkPreset | undefined {
  const presets: Record<string, WorkPreset> = {
    strict: STRICT_PRESET,
    standard: STANDARD_PRESET,
    exploratory: EXPLORATORY_PRESET,
  };
  return presets[id];
}

/**
 * List all available preset IDs.
 *
 * Note: The 'patrol' preset is available via direct import from
 * `./patrol_preset.js` but is not included here to avoid circular
 * dependencies. Use `PATROL_PRESET` from `../strategic/patrol_preset.js`.
 */
export function listPresetIds(): string[] {
  return ['strict', 'standard', 'exploratory'];
}

// ============================================================================
// VALIDATORS
// ============================================================================

const GATE_REQUIREMENT_TYPES: GateRequirementType[] = [
  'test_coverage',
  'lint_pass',
  'type_check',
  'review_approved',
  'confidence_threshold',
  'evidence_complete',
];

const FAILURE_POLICIES: FailurePolicy[] = ['fail_fast', 'continue', 'retry'];

const DELIVERABLE_TYPES: DeliverableType[] = ['code', 'documentation', 'report', 'artifact'];

const REVIEW_TRIGGER_CONDITIONS: ReviewTriggerCondition[] = [
  'high_complexity',
  'security_sensitive',
  'breaking_change',
  'new_dependency',
  'large_change',
  'critical_path',
  'custom',
];

const AUTOMATED_CHECK_TYPES: AutomatedCheckType[] = [
  'lint',
  'type_check',
  'test',
  'security_scan',
  'dependency_audit',
  'coverage',
  'performance',
  'accessibility',
  'custom',
];

/**
 * Validate a gate requirement.
 */
export function validateGateRequirement(req: PresetGateRequirement): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!GATE_REQUIREMENT_TYPES.includes(req.type)) {
    errors.push({
      path: 'type',
      message: `Invalid gate requirement type: ${req.type}`,
      code: 'invalid_gate_requirement_type',
    });
  }

  if (!req.description || req.description.trim().length === 0) {
    errors.push({
      path: 'description',
      message: 'Gate requirement must have a description',
      code: 'missing_description',
    });
  }

  // Threshold validation for types that require it
  const thresholdTypes: GateRequirementType[] = ['test_coverage', 'confidence_threshold'];
  if (thresholdTypes.includes(req.type)) {
    if (req.threshold === undefined) {
      warnings.push({
        path: 'threshold',
        message: `Threshold recommended for ${req.type}`,
        suggestion: 'Add a threshold value',
      });
    } else if (req.threshold < 0 || req.threshold > 100) {
      if (req.type === 'test_coverage') {
        errors.push({
          path: 'threshold',
          message: 'Test coverage threshold must be between 0 and 100',
          code: 'invalid_threshold',
        });
      }
    } else if (req.type === 'confidence_threshold' && (req.threshold < 0 || req.threshold > 1)) {
      errors.push({
        path: 'threshold',
        message: 'Confidence threshold must be between 0 and 1',
        code: 'invalid_threshold',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a quality gate.
 */
export function validateQualityGate(gate: PresetQualityGate): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!gate.phase || gate.phase.trim().length === 0) {
    errors.push({
      path: 'phase',
      message: 'Quality gate must have a phase',
      code: 'missing_phase',
    });
  }

  if (!gate.requirements || gate.requirements.length === 0) {
    warnings.push({
      path: 'requirements',
      message: 'Quality gate has no requirements',
      suggestion: 'Add at least one requirement',
    });
  }

  for (let i = 0; i < (gate.requirements ?? []).length; i++) {
    const reqResult = validateGateRequirement(gate.requirements[i]);
    errors.push(...reqResult.errors.map(e => ({
      ...e,
      path: `requirements[${i}].${e.path}`,
    })));
    warnings.push(...reqResult.warnings.map(w => ({
      ...w,
      path: `requirements[${i}].${w.path}`,
    })));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a quality gates preset.
 */
export function validateQualityGatesPreset(preset: QualityGatesPreset): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!preset.id || preset.id.trim().length === 0) {
    errors.push({
      path: 'id',
      message: 'Quality gates preset must have an id',
      code: 'missing_id',
    });
  }

  if (!preset.name || preset.name.trim().length === 0) {
    errors.push({
      path: 'name',
      message: 'Quality gates preset must have a name',
      code: 'missing_name',
    });
  }

  for (let i = 0; i < (preset.gates ?? []).length; i++) {
    const gateResult = validateQualityGate(preset.gates[i]);
    errors.push(...gateResult.errors.map(e => ({
      ...e,
      path: `gates[${i}].${e.path}`,
    })));
    warnings.push(...gateResult.warnings.map(w => ({
      ...w,
      path: `gates[${i}].${w.path}`,
    })));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate an orchestration preset.
 */
export function validateOrchestrationPreset(preset: OrchestrationPreset): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!preset.id || preset.id.trim().length === 0) {
    errors.push({
      path: 'id',
      message: 'Orchestration preset must have an id',
      code: 'missing_id',
    });
  }

  if (preset.maxConcurrentAgents < 1) {
    errors.push({
      path: 'maxConcurrentAgents',
      message: 'maxConcurrentAgents must be at least 1',
      code: 'invalid_max_concurrent_agents',
    });
  }

  if (preset.progressCheckIntervalMs < 100) {
    warnings.push({
      path: 'progressCheckIntervalMs',
      message: 'Very short progress check interval may cause overhead',
      suggestion: 'Consider using at least 1000ms',
    });
  }

  if (preset.stallDetectionThresholdMs < preset.progressCheckIntervalMs) {
    errors.push({
      path: 'stallDetectionThresholdMs',
      message: 'stallDetectionThresholdMs should be >= progressCheckIntervalMs',
      code: 'invalid_stall_detection_threshold',
    });
  }

  if (!FAILURE_POLICIES.includes(preset.failurePolicy)) {
    errors.push({
      path: 'failurePolicy',
      message: `Invalid failure policy: ${preset.failurePolicy}`,
      code: 'invalid_failure_policy',
    });
  }

  if (preset.failurePolicy === 'retry' && !preset.retryConfig) {
    errors.push({
      path: 'retryConfig',
      message: 'retryConfig is required when failurePolicy is "retry"',
      code: 'missing_retry_config',
    });
  }

  if (preset.retryConfig) {
    if (preset.retryConfig.maxRetries < 1) {
      errors.push({
        path: 'retryConfig.maxRetries',
        message: 'maxRetries must be at least 1',
        code: 'invalid_max_retries',
      });
    }

    if (preset.retryConfig.backoffMs < 0) {
      errors.push({
        path: 'retryConfig.backoffMs',
        message: 'backoffMs must be non-negative',
        code: 'invalid_backoff',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a deliverable requirement.
 */
export function validateDeliverableRequirement(req: DeliverableRequirement): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!req.id || req.id.trim().length === 0) {
    errors.push({
      path: 'id',
      message: 'Deliverable requirement must have an id',
      code: 'missing_id',
    });
  }

  if (!req.name || req.name.trim().length === 0) {
    errors.push({
      path: 'name',
      message: 'Deliverable requirement must have a name',
      code: 'missing_name',
    });
  }

  if (!['automated', 'manual', 'hybrid'].includes(req.verification)) {
    errors.push({
      path: 'verification',
      message: `Invalid verification type: ${req.verification}`,
      code: 'invalid_verification_type',
    });
  }

  if (req.verification === 'automated' && !req.verificationCommand) {
    warnings.push({
      path: 'verificationCommand',
      message: 'Automated verification should have a command',
      suggestion: 'Add a verificationCommand',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a deliverable preset.
 */
export function validateDeliverablePreset(preset: DeliverablePreset): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!DELIVERABLE_TYPES.includes(preset.type)) {
    errors.push({
      path: 'type',
      message: `Invalid deliverable type: ${preset.type}`,
      code: 'invalid_deliverable_type',
    });
  }

  if (!preset.requirements || preset.requirements.length === 0) {
    warnings.push({
      path: 'requirements',
      message: 'Deliverable preset has no requirements',
      suggestion: 'Add at least one requirement',
    });
  }

  for (let i = 0; i < (preset.requirements ?? []).length; i++) {
    const reqResult = validateDeliverableRequirement(preset.requirements[i]);
    errors.push(...reqResult.errors.map(e => ({
      ...e,
      path: `requirements[${i}].${e.path}`,
    })));
    warnings.push(...reqResult.warnings.map(w => ({
      ...w,
      path: `requirements[${i}].${w.path}`,
    })));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a review trigger.
 */
export function validateReviewTrigger(trigger: ReviewTrigger): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!REVIEW_TRIGGER_CONDITIONS.includes(trigger.condition)) {
    errors.push({
      path: 'condition',
      message: `Invalid review trigger condition: ${trigger.condition}`,
      code: 'invalid_review_trigger_condition',
    });
  }

  if (trigger.condition === 'custom' && !trigger.customCondition) {
    errors.push({
      path: 'customCondition',
      message: 'Custom condition is required when condition is "custom"',
      code: 'missing_custom_condition',
    });
  }

  if (!trigger.description || trigger.description.trim().length === 0) {
    errors.push({
      path: 'description',
      message: 'Review trigger must have a description',
      code: 'missing_description',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate an automated check.
 */
export function validateAutomatedCheck(check: AutomatedCheck): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!AUTOMATED_CHECK_TYPES.includes(check.type)) {
    errors.push({
      path: 'type',
      message: `Invalid automated check type: ${check.type}`,
      code: 'invalid_automated_check_type',
    });
  }

  if (!check.name || check.name.trim().length === 0) {
    errors.push({
      path: 'name',
      message: 'Automated check must have a name',
      code: 'missing_name',
    });
  }

  if (check.required && !check.command && check.type !== 'coverage') {
    warnings.push({
      path: 'command',
      message: 'Required automated check should have a command',
      suggestion: 'Add a command to execute',
    });
  }

  if (check.type === 'coverage' && check.threshold === undefined) {
    warnings.push({
      path: 'threshold',
      message: 'Coverage check should have a threshold',
      suggestion: 'Add a coverage threshold',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a review preset.
 */
export function validateReviewPreset(preset: ReviewPreset): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!preset.selfReviewChecklist || preset.selfReviewChecklist.length === 0) {
    warnings.push({
      path: 'selfReviewChecklist',
      message: 'Review preset has no self-review checklist items',
      suggestion: 'Add checklist items for self-review',
    });
  }

  for (let i = 0; i < (preset.peerReviewTriggers ?? []).length; i++) {
    const triggerResult = validateReviewTrigger(preset.peerReviewTriggers[i]);
    errors.push(...triggerResult.errors.map(e => ({
      ...e,
      path: `peerReviewTriggers[${i}].${e.path}`,
    })));
    warnings.push(...triggerResult.warnings.map(w => ({
      ...w,
      path: `peerReviewTriggers[${i}].${w.path}`,
    })));
  }

  for (let i = 0; i < (preset.automatedChecks ?? []).length; i++) {
    const checkResult = validateAutomatedCheck(preset.automatedChecks[i]);
    errors.push(...checkResult.errors.map(e => ({
      ...e,
      path: `automatedChecks[${i}].${e.path}`,
    })));
    warnings.push(...checkResult.warnings.map(w => ({
      ...w,
      path: `automatedChecks[${i}].${w.path}`,
    })));
  }

  if (preset.minSelfReviewConfidence !== undefined) {
    if (preset.minSelfReviewConfidence < 0 || preset.minSelfReviewConfidence > 1) {
      errors.push({
        path: 'minSelfReviewConfidence',
        message: 'minSelfReviewConfidence must be between 0 and 1',
        code: 'invalid_confidence',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a complete work preset.
 */
export function validateWorkPreset(preset: WorkPreset): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!preset.id || preset.id.trim().length === 0) {
    errors.push({
      path: 'id',
      message: 'Work preset must have an id',
      code: 'missing_id',
    });
  }

  if (!preset.name || preset.name.trim().length === 0) {
    errors.push({
      path: 'name',
      message: 'Work preset must have a name',
      code: 'missing_name',
    });
  }

  // Validate quality gates
  const gatesResult = validateQualityGatesPreset(preset.qualityGates);
  errors.push(...gatesResult.errors.map(e => ({
    ...e,
    path: `qualityGates.${e.path}`,
  })));
  warnings.push(...gatesResult.warnings.map(w => ({
    ...w,
    path: `qualityGates.${w.path}`,
  })));

  // Validate orchestration
  const orchResult = validateOrchestrationPreset(preset.orchestration);
  errors.push(...orchResult.errors.map(e => ({
    ...e,
    path: `orchestration.${e.path}`,
  })));
  warnings.push(...orchResult.warnings.map(w => ({
    ...w,
    path: `orchestration.${w.path}`,
  })));

  // Validate deliverables
  for (let i = 0; i < (preset.deliverables ?? []).length; i++) {
    const delResult = validateDeliverablePreset(preset.deliverables[i]);
    errors.push(...delResult.errors.map(e => ({
      ...e,
      path: `deliverables[${i}].${e.path}`,
    })));
    warnings.push(...delResult.warnings.map(w => ({
      ...w,
      path: `deliverables[${i}].${w.path}`,
    })));
  }

  // Validate review
  const reviewResult = validateReviewPreset(preset.review);
  errors.push(...reviewResult.errors.map(e => ({
    ...e,
    path: `review.${e.path}`,
  })));
  warnings.push(...reviewResult.warnings.map(w => ({
    ...w,
    path: `review.${w.path}`,
  })));

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a phase has blocking gates.
 */
export function hasBlockingGates(
  preset: QualityGatesPreset,
  phase: string
): boolean {
  return preset.gates.some(gate => gate.phase === phase && gate.blocking);
}

/**
 * Get all requirements for a phase.
 */
export function getPhaseRequirements(
  preset: QualityGatesPreset,
  phase: string
): GateRequirement[] {
  const gate = preset.gates.find(g => g.phase === phase);
  return gate?.requirements ?? [];
}

/**
 * Check if peer review is triggered based on conditions.
 */
export function isPeerReviewTriggered(
  preset: ReviewPreset,
  context: {
    isSecuritySensitive?: boolean;
    isBreakingChange?: boolean;
    hasNewDependency?: boolean;
    linesChanged?: number;
    isCriticalPath?: boolean;
    customConditions?: Record<string, boolean>;
  }
): { triggered: boolean; reasons: string[]; minReviewers: number } {
  const reasons: string[] = [];
  let maxReviewers = 0;

  for (const trigger of preset.peerReviewTriggers) {
    let matched = false;

    switch (trigger.condition) {
      case 'security_sensitive':
        matched = context.isSecuritySensitive === true;
        break;
      case 'breaking_change':
        matched = context.isBreakingChange === true;
        break;
      case 'new_dependency':
        matched = context.hasNewDependency === true;
        break;
      case 'large_change':
        matched = context.linesChanged !== undefined &&
          trigger.threshold !== undefined &&
          context.linesChanged > trigger.threshold;
        break;
      case 'critical_path':
        matched = context.isCriticalPath === true;
        break;
      case 'custom':
        matched = trigger.customCondition !== undefined &&
          context.customConditions?.[trigger.customCondition] === true;
        break;
    }

    if (matched) {
      reasons.push(trigger.description);
      maxReviewers = Math.max(maxReviewers, trigger.minReviewers ?? 1);
    }
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    minReviewers: maxReviewers,
  };
}

/**
 * Calculate backoff time for retry.
 */
export function calculateBackoff(
  config: RetryConfig,
  attempt: number
): number {
  const multiplier = config.backoffMultiplier ?? 2;
  const baseDelay = config.backoffMs * Math.pow(multiplier, attempt);
  const maxDelay = config.maxBackoffMs ?? Number.MAX_SAFE_INTEGER;
  return Math.min(baseDelay, maxDelay);
}
