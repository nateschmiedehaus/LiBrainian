/**
 * @fileoverview Self-Improvement Compositions Module
 *
 * This module provides compositions that orchestrate multiple primitives
 * to perform complex self-improvement workflows.
 *
 * Based on self-improvement-primitives.md specification.
 *
 * Compositions:
 * - tc_self_audit_full: Complete audit of Librarian health (WU-SELF-201)
 * - tc_self_check_incremental: Quick check after changes (WU-SELF-202)
 * - tc_resolve_gettier_case: Resolve accidentally true beliefs (WU-SELF-203)
 * - tc_adversarial_self_test: Generate and run adversarial tests (WU-SELF-204)
 * - tc_continuous_improvement: Continuous improvement pipeline (WU-SELF-205)
 */

// Full Audit Composition (WU-SELF-201)
export {
  fullSelfAudit,
  type FullAuditResult,
  type FullAuditOptions,
  type HealthScore,
} from './full_audit.js';

// Incremental Check Composition (WU-SELF-202)
export {
  incrementalSelfCheck,
  type IncrementalCheckResult,
  type IncrementalCheckOptions,
  type AnalysisResult,
  type Issue,
} from './incremental_check.js';

// Gettier Resolution Composition (WU-SELF-203)
export {
  resolveGettierCase,
  type GettierResolutionResult,
  type GettierResolutionOptions,
} from './resolve_gettier.js';

// Adversarial Self-Test Composition (WU-SELF-204)
export {
  adversarialSelfTest,
  createAdversarialSelfTest,
  type AdversarialSelfTestResult,
  type AdversarialSelfTestOptions,
  type AdversarialTest,
  type PhaseReport as AdversarialPhaseReport,
} from './adversarial_self_test.js';

// Continuous Improvement Composition (WU-SELF-205)
export {
  runContinuousImprovement,
  createContinuousImprovement,
  type ContinuousImprovementResult,
  type ContinuousImprovementOptions,
  type CheckResult,
  type AppliedFix,
  type PhaseReport as ContinuousPhaseReport,
} from './continuous_improvement.js';
