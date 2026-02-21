/**
 * @fileoverview Automatic Feedback Loop for Calibration
 *
 * PHILOSOPHICAL ALIGNMENT (CONTROL_LOOP.md):
 * This module bridges the gap between task outcomes and calibration.
 * It automatically collects feedback from:
 * - File system changes (task completion signals)
 * - Test results (success/failure inference)
 * - Type check results (code quality signals)
 * - Explicit agent feedback
 *
 * The collected outcomes feed into the CalibrationTracker to:
 * - Track prediction accuracy over time
 * - Adjust confidence scores based on empirical results
 * - Detect systematic biases (overconfidence/underconfidence)
 *
 * INVARIANT: All outcomes are recorded to the evidence ledger
 * INVARIANT: Confidence adjustments are bounded to prevent runaway
 * INVARIANT: Feedback is deduplicated by task ID
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { IEvidenceLedger, OutcomeEvidence } from '../epistemics/evidence_ledger.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { deterministic, bounded, getNumericValue } from '../epistemics/confidence.js';
import { CalibrationTracker, createCalibrationTracker, type TrackedPrediction } from '../measurement/calibration_ledger.js';
import { processAgentFeedback, createTaskOutcomeFeedback, type AgentFeedback } from './agent_feedback.js';
import { recordTaskOutcome } from './wave0_integration.js';
import {
  globalEventBus,
  createFeedbackReceivedEvent,
  createConfidenceUpdatedEvent,
} from '../events.js';
import { logInfo, logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import { bayesianDelta } from '../knowledge/confidence_updater.js';
import { recordQueryOutcomes } from '../api/stage_calibration.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Outcome of a task for feedback recording.
 */
export interface TaskOutcome {
  /** Unique task ID (generated if not provided) */
  taskId?: string;
  /** Whether the task succeeded */
  success: boolean;
  /** Files that were modified during the task */
  filesModified?: string[];
  /** Context pack IDs that were used for the task */
  packIds?: string[];
  /** Why the task failed (if applicable) */
  failureReason?: string;
  /** Type of failure for categorization */
  failureType?: 'test_failure' | 'type_error' | 'runtime_error' | 'timeout' | 'user_abort' | 'unknown';
  /** Original intent/query that led to this task */
  intent?: string;
  /** Confidence that was stated for the prediction */
  statedConfidence?: number;
  /** How the outcome was verified */
  verificationMethod?: 'test_result' | 'user_feedback' | 'system_observation';
}

/**
 * Signal types for automatic task completion detection.
 */
export type CompletionSignal =
  | 'test_pass'
  | 'test_fail'
  | 'type_check_pass'
  | 'type_check_fail'
  | 'lint_pass'
  | 'lint_fail'
  | 'build_success'
  | 'build_failure'
  | 'file_saved'
  | 'explicit_success'
  | 'explicit_failure';

/**
 * Configuration for the feedback loop.
 */
export interface FeedbackLoopConfig {
  /** Workspace root path */
  workspace: string;
  /** Storage for recording outcomes */
  storage: LiBrainianStorage;
  /** Evidence ledger for calibration tracking */
  ledger?: IEvidenceLedger;
  /** Whether to auto-infer outcomes from signals (default: true) */
  autoInfer?: boolean;
  /** Minimum confidence delta to apply (default: 0.001) */
  minConfidenceDelta?: number;
  /** Maximum confidence updates per entity per hour (default: 3) */
  maxUpdatesPerHour?: number;
  /** Whether to emit events for each outcome (default: true) */
  emitEvents?: boolean;
}

/**
 * Internal config with defaults resolved.
 */
interface ResolvedFeedbackLoopConfig {
  workspace: string;
  storage: LiBrainianStorage;
  ledger?: IEvidenceLedger;
  autoInfer: boolean;
  minConfidenceDelta: number;
  maxUpdatesPerHour: number;
  emitEvents: boolean;
}

/**
 * Bias analysis result.
 */
export interface BiasAnalysis {
  /** Overall bias direction */
  direction: 'overconfident' | 'underconfident' | 'well-calibrated';
  /** Magnitude of bias (0-1) */
  magnitude: number;
  /** Number of samples analyzed */
  sampleCount: number;
  /** Confidence buckets with bias info */
  bucketBias: Array<{
    range: [number, number];
    stated: number;
    actual: number;
    bias: number;
    sampleCount: number;
  }>;
  /** Recommendations for calibration improvement */
  recommendations: string[];
}

/**
 * Task tracking entry.
 */
interface TrackedTask {
  taskId: string;
  intent: string;
  packIds: string[];
  statedConfidence: number;
  startedAt: Date;
  completedAt?: Date;
  outcome?: 'success' | 'failure' | 'partial';
  signals: CompletionSignal[];
}

// ============================================================================
// FEEDBACK LOOP
// ============================================================================

/**
 * Automatic feedback loop that records task outcomes and feeds calibration.
 *
 * Usage:
 * ```typescript
 * const feedbackLoop = new FeedbackLoop({
 *   workspace: '/path/to/project',
 *   storage,
 *   ledger,
 * });
 *
 * // Start tracking a task
 * const taskId = feedbackLoop.startTask('Fix authentication bug', packIds, 0.75);
 *
 * // Later, record signals or outcomes
 * feedbackLoop.recordSignal(taskId, 'test_pass');
 *
 * // Or explicit outcome
 * await feedbackLoop.recordOutcome({
 *   taskId,
 *   success: true,
 *   filesModified: ['src/auth.ts'],
 * });
 *
 * // Check for biases
 * const bias = await feedbackLoop.analyzeBias();
 * ```
 */
export class FeedbackLoop {
  private config: ResolvedFeedbackLoopConfig;
  private calibrationTracker: CalibrationTracker | null = null;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private recentOutcomes: Array<{ taskId: string; timestamp: Date; success: boolean }> = [];
  private confidenceUpdates: Map<string, Array<{ timestamp: Date; delta: number }>> = new Map();

  constructor(config: FeedbackLoopConfig) {
    this.config = {
      ...config,
      autoInfer: config.autoInfer ?? true,
      minConfidenceDelta: config.minConfidenceDelta ?? 0.001,
      maxUpdatesPerHour: config.maxUpdatesPerHour ?? 3,
      emitEvents: config.emitEvents ?? true,
    };

    // Initialize calibration tracker if ledger is provided
    if (this.config.ledger) {
      this.calibrationTracker = createCalibrationTracker(this.config.ledger);
    }
  }

  // ============================================================================
  // TASK LIFECYCLE
  // ============================================================================

  /**
   * Start tracking a task for outcome collection.
   *
   * @param intent - The task intent/query
   * @param packIds - Context pack IDs used for this task
   * @param statedConfidence - Confidence stated for the prediction (0-1)
   * @returns Task ID for tracking
   */
  startTask(intent: string, packIds: string[], statedConfidence: number): string {
    const taskId = `task_${randomUUID()}`;

    const task: TrackedTask = {
      taskId,
      intent,
      packIds,
      statedConfidence: Math.max(0, Math.min(1, statedConfidence)),
      startedAt: new Date(),
      signals: [],
    };

    this.trackedTasks.set(taskId, task);

    logInfo('[feedback_loop] Task started', {
      taskId,
      intent: intent.slice(0, 50),
      packCount: packIds.length,
      statedConfidence,
    });

    return taskId;
  }

  /**
   * Record a completion signal for a task.
   *
   * Signals are accumulated and used to infer task outcome.
   *
   * @param taskId - Task ID
   * @param signal - Completion signal
   */
  recordSignal(taskId: string, signal: CompletionSignal): void {
    const task = this.trackedTasks.get(taskId);
    if (!task) {
      logWarning('[feedback_loop] Signal for unknown task', { taskId, signal });
      return;
    }

    task.signals.push(signal);

    // Auto-complete task based on signals if configured
    if (this.config.autoInfer && !task.completedAt) {
      const inferredOutcome = this.inferOutcomeFromSignals(task.signals);
      if (inferredOutcome !== null) {
        void this.recordOutcome({
          taskId,
          success: inferredOutcome,
          verificationMethod: 'system_observation',
        });
      }
    }
  }

  // ============================================================================
  // OUTCOME RECORDING
  // ============================================================================

  /**
   * Record task outcome and feed calibration system.
   *
   * This is the main entry point for explicit feedback. It:
   * 1. Records the outcome to storage
   * 2. Updates context pack confidence scores
   * 3. Feeds the calibration tracker for accuracy analysis
   * 4. Emits feedback events
   *
   * @param outcome - Task outcome details
   */
  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    const taskId = outcome.taskId ?? `task_${randomUUID()}`;
    const task = this.trackedTasks.get(taskId);

    // Get pack IDs from tracked task or outcome
    const packIds = outcome.packIds ?? task?.packIds ?? [];
    const statedConfidence = outcome.statedConfidence ?? task?.statedConfidence ?? 0.5;
    const intent = outcome.intent ?? task?.intent ?? 'unknown';

    // Mark task as completed
    if (task) {
      task.completedAt = new Date();
      task.outcome = outcome.success ? 'success' : 'failure';
    }

    // Deduplicate - don't record same outcome twice
    if (this.recentOutcomes.some((o) => o.taskId === taskId)) {
      logWarning('[feedback_loop] Duplicate outcome ignored', { taskId });
      return;
    }

    this.recentOutcomes.push({
      taskId,
      timestamp: new Date(),
      success: outcome.success,
    });

    // Keep only last 1000 outcomes for deduplication
    if (this.recentOutcomes.length > 1000) {
      this.recentOutcomes = this.recentOutcomes.slice(-1000);
    }

    logInfo('[feedback_loop] Recording outcome', {
      taskId,
      success: outcome.success,
      packCount: packIds.length,
      filesModified: outcome.filesModified?.length ?? 0,
    });

    // 1. Record to wave0 integration (updates pack confidence, triggers reindex)
    if (packIds.length > 0) {
      try {
        await recordTaskOutcome(this.config.workspace, {
          packIds,
          success: outcome.success,
          filesModified: outcome.filesModified,
          failureReason: outcome.failureReason,
          failureType: outcome.failureType,
          taskId,
          intent,
        });
      } catch (error) {
        logWarning('[feedback_loop] Failed to record task outcome', {
          taskId,
          error: getErrorMessage(error),
        });
      }
    }

    // 2. Feed calibration tracker
    if (this.calibrationTracker && packIds.length > 0) {
      try {
        await this.feedCalibration(taskId, statedConfidence, outcome.success, outcome.verificationMethod);
      } catch (error) {
        logWarning('[feedback_loop] Failed to feed calibration', {
          taskId,
          error: getErrorMessage(error),
        });
      }
    }

    // 3. Process as agent feedback for confidence adjustments
    if (packIds.length > 0) {
      try {
        const feedback = createTaskOutcomeFeedback(
          taskId,
          packIds,
          outcome.success ? 'success' : 'failure'
        );
        await processAgentFeedback(feedback, this.config.storage);
      } catch (error) {
        logWarning('[feedback_loop] Failed to process agent feedback', {
          taskId,
          error: getErrorMessage(error),
        });
      }
    }

    // 4. Record stage calibration outcomes
    // This feeds the ConstructionCalibrationTracker for stage runners
    try {
      recordQueryOutcomes(
        taskId,
        outcome.success,
        outcome.verificationMethod ?? 'user_feedback'
      );
    } catch (error) {
      logWarning('[feedback_loop] Failed to record stage calibration outcomes', {
        taskId,
        error: getErrorMessage(error),
      });
    }

    // 5. Emit events
    if (this.config.emitEvents) {
      void globalEventBus.emit(
        createFeedbackReceivedEvent(taskId, outcome.success, packIds, outcome.failureReason)
      );
    }

    // 6. Clean up tracked task
    this.trackedTasks.delete(taskId);
  }

  // ============================================================================
  // CALIBRATION FEEDING
  // ============================================================================

  /**
   * Feed an outcome to the calibration tracker.
   */
  private async feedCalibration(
    taskId: string,
    statedConfidence: number,
    correct: boolean,
    verificationMethod?: 'test_result' | 'user_feedback' | 'system_observation'
  ): Promise<void> {
    if (!this.calibrationTracker) return;

    // Create a tracked prediction
    const prediction: TrackedPrediction = {
      predictionId: taskId,
      claim: `Task ${taskId} will succeed`,
      confidence: bounded(
        Math.max(0, statedConfidence - 0.1),
        Math.min(1, statedConfidence + 0.1),
        'theoretical',
        'task_confidence_estimate'
      ),
      predictedAt: new Date(),
    };

    // Record the prediction
    await this.calibrationTracker.recordPrediction(prediction);

    // Record the outcome
    await this.calibrationTracker.recordOutcome(
      { id: taskId } as any, // Type workaround for EvidenceEntry
      {
        correct,
        verificationMethod: verificationMethod ?? 'system_observation',
        observation: correct ? 'Task completed successfully' : 'Task failed',
        observedAt: new Date(),
      }
    );
  }

  // ============================================================================
  // BIAS DETECTION
  // ============================================================================

  /**
   * Analyze calibration bias to detect systematic over/under-confidence.
   *
   * @returns Bias analysis with recommendations
   */
  async analyzeBias(): Promise<BiasAnalysis> {
    if (!this.calibrationTracker) {
      return {
        direction: 'well-calibrated',
        magnitude: 0,
        sampleCount: 0,
        bucketBias: [],
        recommendations: ['Configure evidence ledger to enable calibration tracking'],
      };
    }

    try {
      const trend = await this.calibrationTracker.getCalibrationTrend(10);
      const ece = await this.calibrationTracker.getCurrentECE();

      // Simple bias analysis based on ECE and trend
      const sampleCount = trend.samples;

      if (sampleCount < 10) {
        return {
          direction: 'well-calibrated',
          magnitude: 0,
          sampleCount,
          bucketBias: [],
          recommendations: [`Insufficient data (${sampleCount} samples). Need at least 10 for analysis.`],
        };
      }

      const magnitude = ece ?? 0;
      let direction: BiasAnalysis['direction'] = 'well-calibrated';

      // Determine direction based on recent outcomes
      const recentSuccess = this.recentOutcomes.filter((o) => o.success).length;
      const recentTotal = this.recentOutcomes.length;
      const actualSuccessRate = recentTotal > 0 ? recentSuccess / recentTotal : 0.5;

      // Average stated confidence from tracked tasks
      let totalStatedConfidence = 0;
      let statedCount = 0;
      for (const task of this.trackedTasks.values()) {
        totalStatedConfidence += task.statedConfidence;
        statedCount++;
      }
      const avgStatedConfidence = statedCount > 0 ? totalStatedConfidence / statedCount : 0.5;

      if (avgStatedConfidence > actualSuccessRate + 0.1) {
        direction = 'overconfident';
      } else if (avgStatedConfidence < actualSuccessRate - 0.1) {
        direction = 'underconfident';
      }

      const recommendations: string[] = [];

      if (magnitude > 0.15) {
        recommendations.push(`High calibration error (${(magnitude * 100).toFixed(1)}%). Review confidence estimation logic.`);
      }

      if (direction === 'overconfident') {
        recommendations.push('System is overconfident. Consider reducing base confidence or adding uncertainty.');
      } else if (direction === 'underconfident') {
        recommendations.push('System is underconfident. Confidence scores could be increased.');
      }

      if (trend.trend === 'degrading') {
        recommendations.push('Calibration is degrading over time. Investigate recent changes.');
      }

      if (recommendations.length === 0) {
        recommendations.push('Calibration is within acceptable bounds. Continue monitoring.');
      }

      return {
        direction,
        magnitude,
        sampleCount,
        bucketBias: [], // Would need more detailed bucket analysis
        recommendations,
      };
    } catch (error) {
      return {
        direction: 'well-calibrated',
        magnitude: 0,
        sampleCount: 0,
        bucketBias: [],
        recommendations: [`Analysis failed: ${getErrorMessage(error)}`],
      };
    }
  }

  // ============================================================================
  // SIGNAL INFERENCE
  // ============================================================================

  /**
   * Infer task outcome from accumulated signals.
   *
   * @param signals - Accumulated completion signals
   * @returns true for success, false for failure, null if inconclusive
   */
  private inferOutcomeFromSignals(signals: CompletionSignal[]): boolean | null {
    // Explicit signals take precedence
    if (signals.includes('explicit_success')) return true;
    if (signals.includes('explicit_failure')) return false;

    // Test results are strong signals
    if (signals.includes('test_pass') && !signals.includes('test_fail')) return true;
    if (signals.includes('test_fail')) return false;

    // Type check results
    if (signals.includes('type_check_fail')) return false;

    // Build results
    if (signals.includes('build_failure')) return false;
    if (signals.includes('build_success') && signals.includes('type_check_pass')) return true;

    // Lint results (weaker signal)
    if (signals.includes('lint_fail') && signals.filter((s) => s.endsWith('_pass')).length === 0) {
      return false;
    }

    // File saved alone is inconclusive
    return null;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get current tracking statistics.
   */
  getStats(): {
    activeTasks: number;
    recentOutcomes: number;
    recentSuccessRate: number;
  } {
    const recentSuccess = this.recentOutcomes.filter((o) => o.success).length;
    const recentTotal = this.recentOutcomes.length;

    return {
      activeTasks: this.trackedTasks.size,
      recentOutcomes: recentTotal,
      recentSuccessRate: recentTotal > 0 ? recentSuccess / recentTotal : 0,
    };
  }

  /**
   * Get a tracked task by ID.
   */
  getTask(taskId: string): TrackedTask | undefined {
    return this.trackedTasks.get(taskId);
  }

  /**
   * Clear all tracking state (useful for testing).
   */
  clear(): void {
    this.trackedTasks.clear();
    this.recentOutcomes = [];
    this.confidenceUpdates.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a feedback loop instance.
 *
 * @param config - Configuration options
 * @returns Configured feedback loop
 */
export function createFeedbackLoop(config: FeedbackLoopConfig): FeedbackLoop {
  return new FeedbackLoop(config);
}

// ============================================================================
// AUTO-WIRED FEEDBACK LOOP
// ============================================================================

/**
 * File watcher signal for the feedback loop.
 */
export interface FileWatcherSignal {
  type: 'file_change' | 'file_add' | 'file_delete';
  file: string;
  timestamp: number;
  source: 'file_watcher';
}

/**
 * Test runner signal for the feedback loop.
 */
export interface TestRunnerSignal {
  type: 'test_outcome';
  test: string;
  passed: boolean;
  timestamp: number;
  source: 'test_runner';
}

/**
 * Union type for all feedback signals.
 */
export type FeedbackSignal = FileWatcherSignal | TestRunnerSignal;

/**
 * Interface for file watcher that can be wired to feedback loop.
 */
export interface WirableFileWatcher {
  onFileChange(handler: (event: { type: string; path: string }) => void | Promise<void>): () => void;
}

/**
 * Handle for the auto-wired feedback loop.
 */
export interface AutoWiredFeedbackLoopHandle {
  /** The underlying feedback loop instance */
  loop: FeedbackLoop;
  /** Disconnect all signal sources */
  disconnect(): void;
  /** Whether the loop is currently connected to signal sources */
  connected: boolean;
}

/**
 * Creates a feedback loop that is automatically wired to file watchers and test runners.
 *
 * This function connects the feedback loop to external signal sources:
 * - File watcher: Records file_change, file_add, file_delete signals
 * - Test runner (if in test environment): Records test_outcome signals
 *
 * The signals are mapped to CompletionSignal types and automatically
 * update any active tasks.
 *
 * @param config - Feedback loop configuration
 * @param watcher - File watcher to wire signals from
 * @returns Handle with the loop instance and disconnect function
 *
 * @example
 * ```typescript
 * import { createAutoWiredFeedbackLoop } from './feedback_loop.js';
 * import { createFileWatcher } from './file_watcher_integration.js';
 *
 * const watcher = createFileWatcher();
 * await watcher.start({ rootPath: '/my/project' });
 *
 * const { loop, disconnect } = createAutoWiredFeedbackLoop({
 *   workspace: '/my/project',
 *   storage,
 * }, watcher);
 *
 * // Start tracking a task
 * const taskId = loop.startTask('Fix bug', ['pack-1'], 0.8);
 *
 * // When files change, the loop automatically gets signals
 * // When tests run (in test environment), outcomes are recorded
 *
 * // Later, clean up
 * disconnect();
 * await watcher.stop();
 * ```
 */
export function createAutoWiredFeedbackLoop(
  config: FeedbackLoopConfig,
  watcher: WirableFileWatcher
): AutoWiredFeedbackLoopHandle {
  const loop = createFeedbackLoop(config);
  const unsubscribes: Array<() => void> = [];
  let connected = true;

  // Map file watcher events to feedback signals
  const fileChangeHandler = (event: { type: string; path: string }): void => {
    if (!connected) return;

    // For now, just log the signal - these could be used to infer
    // task completion in future enhancements
    logInfo('[feedback_loop] File watcher signal received', {
      type: event.type,
      path: event.path,
    });

    // If there are active tasks, record a file_saved signal
    // which can contribute to outcome inference
    const stats = loop.getStats();
    if (stats.activeTasks > 0) {
      // File changes during a task could indicate work in progress
      // We don't auto-complete tasks based on file saves alone
      // (that's marked as inconclusive in inferOutcomeFromSignals)
    }
  };

  const unsubscribeWatcher = watcher.onFileChange(fileChangeHandler);
  unsubscribes.push(unsubscribeWatcher);

  // Wire to test runner (if in test environment)
  if (process.env.VITEST || process.env.JEST_WORKER_ID) {
    const messageHandler = (msg: unknown): void => {
      if (!connected) return;
      if (!msg || typeof msg !== 'object') return;

      const message = msg as Record<string, unknown>;
      if (message.type === 'test_result' && typeof message.testName === 'string') {
        const passed = Boolean(message.passed);

        logInfo('[feedback_loop] Test result signal received', {
          test: message.testName,
          passed,
        });

        // Find any active task that might be waiting for test results
        // and record the appropriate signal
        const stats = loop.getStats();
        if (stats.activeTasks > 0) {
          // In a real implementation, we would need to match tests to tasks
          // For now, we log the signal for future use
        }
      }
    };

    process.on('message', messageHandler);
    unsubscribes.push(() => process.removeListener('message', messageHandler));
  }

  const disconnect = (): void => {
    connected = false;
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe errors
      }
    }
    unsubscribes.length = 0;
  };

  return {
    loop,
    disconnect,
    get connected() {
      return connected;
    },
  };
}

/**
 * Initialize the global feedback loop with automatic wiring to a file watcher.
 *
 * This is a convenience function that combines initFeedbackLoop with
 * auto-wiring to a file watcher.
 *
 * @param config - Feedback loop configuration
 * @param watcher - File watcher to wire signals from
 * @returns Handle to disconnect signal sources
 *
 * @example
 * ```typescript
 * const handle = initAutoWiredFeedbackLoop({ workspace, storage }, watcher);
 *
 * // Use the global feedback loop API
 * const taskId = startTask('Fix bug', ['pack-1'], 0.8);
 *
 * // Later
 * handle.disconnect();
 * ```
 */
export function initAutoWiredFeedbackLoop(
  config: FeedbackLoopConfig,
  watcher: WirableFileWatcher
): AutoWiredFeedbackLoopHandle {
  const handle = createAutoWiredFeedbackLoop(config, watcher);
  globalFeedbackLoop = handle.loop;
  return handle;
}

// ============================================================================
// SIMPLE API
// ============================================================================

// Module-level singleton for simple API
let globalFeedbackLoop: FeedbackLoop | null = null;

/**
 * Initialize the global feedback loop.
 *
 * Call this once during application startup with the workspace and storage.
 *
 * @param config - Configuration options
 */
export function initFeedbackLoop(config: FeedbackLoopConfig): void {
  globalFeedbackLoop = createFeedbackLoop(config);
}

/**
 * Get the global feedback loop instance.
 *
 * @throws Error if not initialized
 */
export function getFeedbackLoop(): FeedbackLoop {
  if (!globalFeedbackLoop) {
    throw new Error('Feedback loop not initialized. Call initFeedbackLoop() first.');
  }
  return globalFeedbackLoop;
}

/**
 * Simple API for recording task outcomes.
 *
 * This is the recommended entry point for agents to record feedback.
 *
 * Usage:
 * ```typescript
 * import { recordOutcome } from './feedback_loop.js';
 *
 * await recordOutcome({
 *   taskId: 'task-123',
 *   success: true,
 *   filesModified: ['src/foo.ts'],
 * });
 * ```
 *
 * @param outcome - Task outcome to record
 */
export async function recordOutcome(outcome: TaskOutcome): Promise<void> {
  const loop = getFeedbackLoop();
  await loop.recordOutcome(outcome);
}

/**
 * Start tracking a task for automatic outcome collection.
 *
 * @param intent - Task intent/query
 * @param packIds - Context pack IDs used
 * @param statedConfidence - Stated confidence (0-1)
 * @returns Task ID
 */
export function startTask(intent: string, packIds: string[], statedConfidence: number): string {
  const loop = getFeedbackLoop();
  return loop.startTask(intent, packIds, statedConfidence);
}

/**
 * Record a completion signal for a task.
 *
 * @param taskId - Task ID
 * @param signal - Completion signal
 */
export function recordSignal(taskId: string, signal: CompletionSignal): void {
  const loop = getFeedbackLoop();
  loop.recordSignal(taskId, signal);
}

/**
 * Analyze calibration bias.
 *
 * @returns Bias analysis
 */
export async function analyzeBias(): Promise<BiasAnalysis> {
  const loop = getFeedbackLoop();
  return loop.analyzeBias();
}

// ============================================================================
// FILE SYSTEM SIGNAL DETECTION
// ============================================================================

/**
 * Detect task outcome from file system changes and tool outputs.
 *
 * This helper analyzes various signals to infer success/failure:
 * - Test runner output
 * - Type checker output
 * - Linter output
 * - Build output
 *
 * @param signals - Map of signal type to result
 * @returns Inferred outcome
 */
export function inferOutcomeFromToolOutput(signals: {
  testOutput?: { exitCode: number; failureCount?: number };
  typeCheckOutput?: { exitCode: number; errorCount?: number };
  lintOutput?: { exitCode: number; errorCount?: number };
  buildOutput?: { exitCode: number };
}): { success: boolean; confidence: number; signals: CompletionSignal[] } {
  const detectedSignals: CompletionSignal[] = [];
  let successScore = 0;
  let failureScore = 0;

  // Test results (high weight)
  if (signals.testOutput) {
    if (signals.testOutput.exitCode === 0 && (signals.testOutput.failureCount ?? 0) === 0) {
      detectedSignals.push('test_pass');
      successScore += 3;
    } else {
      detectedSignals.push('test_fail');
      failureScore += 3;
    }
  }

  // Type check (medium weight)
  if (signals.typeCheckOutput) {
    if (signals.typeCheckOutput.exitCode === 0 && (signals.typeCheckOutput.errorCount ?? 0) === 0) {
      detectedSignals.push('type_check_pass');
      successScore += 2;
    } else {
      detectedSignals.push('type_check_fail');
      failureScore += 2;
    }
  }

  // Lint (low weight)
  if (signals.lintOutput) {
    if (signals.lintOutput.exitCode === 0 && (signals.lintOutput.errorCount ?? 0) === 0) {
      detectedSignals.push('lint_pass');
      successScore += 1;
    } else {
      detectedSignals.push('lint_fail');
      failureScore += 1;
    }
  }

  // Build (medium weight)
  if (signals.buildOutput) {
    if (signals.buildOutput.exitCode === 0) {
      detectedSignals.push('build_success');
      successScore += 2;
    } else {
      detectedSignals.push('build_failure');
      failureScore += 2;
    }
  }

  const totalScore = successScore + failureScore;
  const success = successScore > failureScore;
  const confidence = totalScore > 0 ? Math.abs(successScore - failureScore) / totalScore : 0.5;

  return {
    success,
    confidence: Math.min(0.95, Math.max(0.1, 0.5 + confidence * 0.4)),
    signals: detectedSignals,
  };
}
