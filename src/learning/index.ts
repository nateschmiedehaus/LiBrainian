/**
 * @fileoverview Learning Module
 *
 * Provides learning capabilities for the LiBrainian system:
 * - Recovery strategy learning using Thompson Sampling
 * - Anti-pattern detection and avoidance
 * - Outcome tracking and persistence
 */

export {
  RecoveryLearner,
  createRecoveryLearner,
  type RecoveryOutcome,
  type StrategyStats,
  type AntiPattern,
  type ConfidenceInterval,
  type RecoveryLearnerState,
} from './recovery_learner.js';

export {
  saveLearnerState,
  loadLearnerState,
  createPersistentLearner,
  hasLearnerState,
  deleteLearnerState,
  getLearnerStatePath,
  getLearnerStateSummary,
  type LearnerPersistenceOptions,
} from './persistence.js';
