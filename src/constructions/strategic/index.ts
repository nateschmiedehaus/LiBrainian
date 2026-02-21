/**
 * @fileoverview Strategic Constructions Module
 *
 * Construction wrappers for all strategic modules. Each construction provides:
 * - Intelligent analysis using the LiBrainian API
 * - Assessment against configurable standards/presets
 * - Confidence tracking and evidence collection
 * - Graded results with recommendations
 *
 * Available Constructions:
 *
 * Original Strategic Constructions (CalibratedConstruction pattern):
 * - QualityAssessmentConstruction: Quality assessment with calibration
 * - ArchitectureValidationConstruction: Architecture validation with calibration
 * - WorkflowValidationConstruction: Workflow validation with calibration
 *
 * New Strategic Constructions (AssessmentConstruction pattern):
 * - QualityStandardsConstruction: Assess code quality against world-class standards
 * - WorkPresetsConstruction: Validate work against quality gates
 * - ArchitectureDecisionsConstruction: Detect architecture drift and violations
 * - TestingStrategyConstruction: Evaluate testing practices
 * - OperationalExcellenceConstruction: Assess operational maturity
 * - DeveloperExperienceConstruction: Measure developer experience quality
 * - TechnicalDebtConstruction: Track and prioritize technical debt
 * - KnowledgeManagementConstruction: Evaluate knowledge coverage and freshness
 *
 * @packageDocumentation
 */

// ============================================================================
// ORIGINAL STRATEGIC CONSTRUCTIONS (CalibratedConstruction pattern)
// ============================================================================

export {
  QualityAssessmentConstruction,
  createQualityAssessmentConstruction,
  type QualityAssessmentResult,
} from './quality_assessment_construction.js';

export {
  ArchitectureValidationConstruction,
  createArchitectureValidationConstruction,
  type ArchitectureValidationConfig,
  type ArchitectureValidationResult,
} from './architecture_validation_construction.js';

export {
  WorkflowValidationConstruction,
  createWorkflowValidationConstruction,
  type WorkflowPhaseContext,
  type GateCheckResult,
  type WorkflowValidationResult,
} from './workflow_validation_construction.js';

// ============================================================================
// QUALITY STANDARDS (AssessmentConstruction pattern)
// ============================================================================

export {
  QualityStandardsConstruction,
  createQualityStandardsConstruction,
  type QualityAssessmentInput,
  type QualityAssessmentOutput,
} from './quality_standards_construction.js';

// ============================================================================
// WORK PRESETS (AssessmentConstruction pattern)
// ============================================================================

export {
  WorkPresetsConstruction,
  createWorkPresetsConstruction,
  type WorkPresetAssessmentInput,
  type WorkPresetAssessmentOutput,
  type GateCheckResult as WorkPresetGateCheckResult,
} from './work_presets_construction.js';

// ============================================================================
// ARCHITECTURE DECISIONS (AssessmentConstruction pattern)
// ============================================================================

export {
  ArchitectureDecisionsConstruction,
  createArchitectureDecisionsConstruction,
  type ArchitectureAssessmentInput,
  type ArchitectureAssessmentOutput,
} from './architecture_decisions_construction.js';

// ============================================================================
// TESTING STRATEGY (AssessmentConstruction pattern)
// ============================================================================

export {
  TestingStrategyConstruction,
  createTestingStrategyConstruction,
  type TestingStrategyAssessmentInput,
  type TestingStrategyAssessmentOutput,
} from './testing_strategy_construction.js';

// ============================================================================
// OPERATIONAL EXCELLENCE (AssessmentConstruction pattern)
// ============================================================================

export {
  OperationalExcellenceConstruction,
  createOperationalExcellenceConstruction,
  type OperationalExcellenceAssessmentInput,
  type OperationalExcellenceAssessmentOutput,
} from './operational_excellence_construction.js';

// ============================================================================
// DEVELOPER EXPERIENCE (AssessmentConstruction pattern)
// ============================================================================

export {
  DeveloperExperienceConstruction,
  createDeveloperExperienceConstruction,
  type DeveloperExperienceAssessmentInput,
  type DeveloperExperienceAssessmentOutput,
} from './developer_experience_construction.js';

// ============================================================================
// TECHNICAL DEBT (AssessmentConstruction pattern)
// ============================================================================

export {
  TechnicalDebtConstruction,
  createTechnicalDebtConstruction,
  type TechnicalDebtAssessmentInput,
  type TechnicalDebtAssessmentOutput,
} from './technical_debt_construction.js';

// ============================================================================
// KNOWLEDGE MANAGEMENT (AssessmentConstruction pattern)
// ============================================================================

export {
  KnowledgeManagementConstruction,
  createKnowledgeManagementConstruction,
  type KnowledgeManagementAssessmentInput,
  type KnowledgeManagementAssessmentOutput,
} from './knowledge_management_construction.js';
