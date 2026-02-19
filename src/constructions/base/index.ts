/**
 * @fileoverview Base Construction Classes
 *
 * Provides abstract base classes for building constructions that support
 * all module types universally. These base classes enforce common patterns
 * for confidence tracking, evidence collection, and calibration.
 *
 * Available Base Classes:
 * - BaseConstruction: Core abstract class for all constructions
 * - ValidationConstruction: For rule-based validation
 * - AssessmentConstruction: For scoring/grading
 * - CompositeConstruction: For composing multiple constructions
 *
 * @packageDocumentation
 */

// ============================================================================
// CORE BASE CLASS
// ============================================================================

export {
  BaseConstruction,
  type ConstructionResult,
  type ConstructionExecutionOptions,
  type ConstructionContext,
  type ConstructionMetadata,
  type CalibratedConstruction,
  ConstructionError,
  ConstructionTimeoutError,
  ConstructionCancelledError,
  ConstructionInputError,
  ConstructionCapabilityError,
  ConstructionLLMError,
} from './construction_base.js';

// ============================================================================
// VALIDATION CONSTRUCTION
// ============================================================================

export {
  ValidationConstruction,
  type ValidationResult,
  type ValidationSeverity,
  type Violation,
  type Warning,
  type ValidationRule,
} from './validation_construction.js';

// ============================================================================
// ASSESSMENT CONSTRUCTION
// ============================================================================

export {
  AssessmentConstruction,
  type AssessmentResult,
  type AssessmentOptions,
  type Grade,
  type SimpleGrade,
  type RecommendationPriority,
  type RecommendationEffort,
  type ScoreCategory,
  type ScoreBreakdown,
  type Recommendation,
  DEFAULT_GRADE_THRESHOLDS,
  SIMPLE_GRADE_THRESHOLDS,
} from './assessment_construction.js';

// ============================================================================
// COMPOSITE CONSTRUCTION
// ============================================================================

export {
  CompositeConstruction,
  type CompositeResult,
  type CompositeExecutionOptions,
  type ChildResult,
  type ExecutionMode,
  type ParallelCombineStrategy,
} from './composite_construction.js';
