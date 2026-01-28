/**
 * @fileoverview Integration module exports
 */

// First-run gate
export {
  ensureLibrarianReady,
  isLibrarianReady,
  getLibrarian,
  getGateStatus,
  resetGate,
  shutdownAll,
  createLibrarianPreTaskHook,
  withLibrarian,
} from './first_run_gate.js';
export type { FirstRunGateOptions, FirstRunGateResult } from './first_run_gate.js';

// Orchestrator interface
export { ensureLibrarianReadyForOrchestrator } from './orchestrator_interface.js';
export type { OrchestratorLibrarianGateOptions } from './orchestrator_interface.js';

// Wave0 integration
export {
  enrichTaskContext,
  formatLibrarianContext,
  recordTaskOutcome,
  notifyFileChange,
  notifyFileChanges,
  preOrchestrationHook,
  postOrchestrationHook,
} from './wave0_integration.js';
export type { LibrarianContext } from './wave0_integration.js';

// Incremental indexing watcher
export { startFileWatcher, stopFileWatcher } from './file_watcher.js';
export type { FileWatcherHandle, FileWatcherOptions } from './file_watcher.js';

// Agent compliance reporting
export {
  createAgentComplianceReport,
  writeAgentComplianceReport,
} from './compliance_report.js';
export type { AgentComplianceReportV1, AgentComplianceSummary } from './compliance_report.js';

// Agent feedback loop (CONTROL_LOOP.md §Feedback Loop Integration)
export {
  processAgentFeedback,
  logRetrievalGap,
  getRetrievalGaps,
  addressRetrievalGap,
  analyzeFeedbackTrends,
  createTaskOutcomeFeedback,
} from './agent_feedback.js';
export type {
  AgentFeedback,
  RelevanceRating,
  RetrievalGap,
  ConfidenceAdjustment,
  FeedbackProcessingResult,
  FeedbackAnalysis,
} from './agent_feedback.js';

// Agent feedback submission (easy API for agents)
export {
  submitQueryFeedback,
  reportHelpful,
  reportNotHelpful,
} from './agent_protocol.js';

// Closed-loop recovery (CONTROL_LOOP.md §Closed-Loop Recovery Semantics)
export {
  DEFAULT_RECOVERY_BUDGET,
  canUseRecoveryBudget,
  recordRecoveryUsage,
  getRemainingBudget,
  diagnoseDegradation,
  planRecoveryActions,
  executeRecovery,
  getRecoveryStatus,
  forceResetRecovery,
} from './recovery.js';
export type {
  RecoveryBudget,
  DegradationType,
  DegradationDiagnosis,
  RecoveryAction,
  RecoveryResult,
  RecoveryStatus,
} from './recovery.js';

// Modularization hooks (enforce search-before-create, descriptive naming)
export {
  checkModularization,
  getModularizationGuidance,
  buildModularizationPrompt,
  MODULARIZATION_GUIDANCE_VERSION,
  GENERIC_FILE_NAMES,
  POOR_NAME_PATTERNS,
} from './modularization_hooks.js';
export type {
  ModularizationCheckResult,
  ModularizationGuidance,
  FileCreationContext,
} from './modularization_hooks.js';

// File Watcher Integration with Evidence Ledger (WU-STALE-001)
export {
  FileWatcher,
  createFileWatcher,
} from './file_watcher_integration.js';
export type {
  FileChangeEvent,
  WatcherConfig,
  WatcherStats,
  FileChangeHandler,
  FileWatcherOptions as FileWatcherIntegrationOptions,
} from './file_watcher_integration.js';

// Bootstrap Tests (WU-BOOT-002)
export { createBootstrapTestRunner } from './bootstrap_tests.js';
export type { BootstrapTestResult, BootstrapTestRunner } from './bootstrap_tests.js';
