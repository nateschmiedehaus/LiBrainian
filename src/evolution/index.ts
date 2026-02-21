/**
 * @fileoverview EvolutionOps Module for LiBrainian
 *
 * Provides self-evolution capabilities:
 * - Multi-objective fitness evaluation (FitnessReport.v1)
 * - Staged evaluation pipeline
 * - MAP-Elites quality-diversity archive
 * - UCB1 bandit emitter allocation
 * - Evolution controller
 *
 * @packageDocumentation
 */

// Types
export type {
  FitnessReport,
  FitnessVector,
  BehaviorDescriptors,
  FitnessDelta,
  StageResult,
  StagedEvaluator,
  EvaluationContext,
  EvaluationBudget,
  Variant,
  VariantGenotype,
  ArchiveCell,
  ArchiveCellKey,
  ArchiveState,
  Emitter,
  EmitterStats,
  BanditState,
  ResourceUsage,
  EvolutionCycleResult,
  EvolutionConfig,
} from './types.js';

export { DEFAULT_EVOLUTION_CONFIG } from './types.js';

// Fitness
export {
  computeFitnessReport,
  computeFitnessVector,
  computeBehaviorDescriptors,
  computeFitnessDelta,
  isFitnessReport,
} from './fitness.js';

// Staged Evaluators
export {
  Stage0StaticEvaluator,
  Stage1Tier0Evaluator,
  Stage2Tier1Evaluator,
  Stage3Tier2Evaluator,
  Stage4AdversarialEvaluator,
  runStagedEvaluation,
} from './staged_evaluators.js';

// Archive
export {
  EvolutionArchive,
  createArchive,
} from './archive.js';

// Bandit
export {
  UCB1Bandit,
  createBandit,
} from './bandit.js';

// Emitters
export {
  BaseEmitter,
  RetrievalWeightEmitter,
  PromptEmitter,
  EvaluationEmitter,
  CodeEmitter,
  createDefaultEmitters,
} from './emitters/index.js';

// Controller
export {
  EvolutionController,
  createEvolutionController,
} from './controller.js';

// Reward Signal
export {
  RewardSignalCalculator,
  createRewardSignalCalculator,
  type RewardInput,
  type RewardResult,
  type RewardConfig,
  type Archive as RewardArchive,
  type PopulationMember,
  type EmitterRewardInput,
} from './reward_signal.js';
