/**
 * @fileoverview Homeostasis Module
 *
 * Autonomous system maintenance through the MAPE-K control loop.
 * Includes self-healing configuration subsystem and dependency invalidation.
 *
 * @packageDocumentation
 */

// Triggers
export {
  TriggerWiring,
  createTriggerWiring,
  DEFAULT_TRIGGER_CONFIG,
  type TriggerConfig,
  type TriggerSource,
  type TriggerUrgency,
  type TriggeredHealthCheck,
  type TriggerCallback,
} from './triggers.js';

// Daemon
export {
  HomeostasisDaemon,
  createHomeostasisDaemon,
  type HomeostasisDaemonConfig,
  type HealingRecord,
  type ActionRecord,
  type DaemonStatus,
} from './daemon.js';

// LTL safety monitor evaluator
export {
  LTLMonitorEvaluator,
  createLTLMonitorEvaluator,
  type SafetyViolationSeverity,
  type SafetyViolationEvidence,
  type SafetyViolation,
  type LTLSafetyProperty,
  type LTLMonitorEvaluatorConfig,
} from './ltl_monitor_evaluator.js';

// Dependency Tracker (for file change invalidation)
export {
  DependencyTracker,
  createDependencyTracker,
  createHydratedDependencyTracker,
  onFileChanged,
  type DependencyGraph,
  type InvalidationResult,
  type InvalidationOptions,
} from './dependency_tracker.js';

// Memory bridge stale-marking hook
export {
  applyMemoryBridgeDefeaters,
  type MemoryBridgeHookOptions,
  type MemoryBridgeHookResult,
} from './memory_bridge_hook.js';

export {
  validateSeededPacks,
  type SeededPackValidationOptions,
  type SeededPackValidationResult,
} from './seeded_pack_validation.js';

// Re-export config self-healing for convenience
export {
  diagnoseConfiguration,
  autoHealConfiguration,
  rollbackConfiguration,
  getEffectivenessHistory,
  createConfigHealingTrigger,
  type ConfigHealthReport,
  type ConfigIssue,
  type ConfigRecommendation,
  type ConfigFix,
  type HealingResult as ConfigHealingResult,
  type DriftAnalysis,
  type StalenessAnalysis,
} from '../config/self_healing.js';

// Re-export workspace lock for concurrent bootstrap protection
export {
  acquireWorkspaceLock,
  cleanupWorkspaceLock,
  type WorkspaceLockState,
  type WorkspaceLockHandle,
  type WorkspaceLockOptions,
} from '../integration/workspace_lock.js';
