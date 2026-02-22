/**
 * @fileoverview Homeostasis Daemon
 *
 * Main homeostatic controller for autonomous system maintenance.
 * Implements the MAPE-K (Monitor-Analyze-Plan-Execute-Knowledge) loop
 * for self-maintaining system health.
 *
 * Key Responsibilities:
 * - Monitor: Track health metrics via triggers
 * - Analyze: Diagnose issues and determine severity
 * - Plan: Select appropriate recovery actions
 * - Execute: Run recovery actions via RecoveryActions
 * - Knowledge: Record outcomes for learning
 *
 * @packageDocumentation
 */

import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianEventBus } from '../events.js';
import type { LibrarianEvent } from '../types.js';
import {
  TriggerWiring,
  createTriggerWiring,
  type TriggeredHealthCheck,
  type TriggerConfig,
  type TriggerSource,
} from './triggers.js';
import {
  diagnoseDegradation,
  planRecoveryActions,
  type DegradationDiagnosis,
  type RecoveryAction,
} from '../integration/recovery.js';
import { generateStateReport } from '../measurement/observability.js';
import { executeAction, type RecoveryOutcome } from '../integration/recovery_actions.js';
import {
  RecoveryLearner,
  createRecoveryLearner,
  type RecoveryOutcome as LearnerOutcome,
} from '../learning/recovery_learner.js';
import {
  createLTLMonitorEvaluator,
  type LTLMonitorEvaluator,
} from './ltl_monitor_evaluator.js';
import { validateSeededPacks } from './seeded_pack_validation.js';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the homeostasis daemon.
 */
export interface HomeostasisDaemonConfig {
  /** Storage for accessing entities */
  storage: LibrarianStorage;
  /** Event bus for trigger wiring */
  eventBus: LibrarianEventBus;
  /** Trigger configuration overrides */
  triggerConfig?: Partial<TriggerConfig>;
  /** Maximum concurrent recovery actions */
  maxConcurrentActions?: number;
  /** Budget limit for recovery (tokens) */
  recoveryBudgetTokens?: number;
  /** Whether to start immediately */
  autoStart?: boolean;
  /** Callback when health check is triggered */
  onHealthCheckTriggered?: (trigger: TriggeredHealthCheck) => void;
  /** Callback when recovery completes */
  onRecoveryComplete?: (record: HealingRecord) => void;
  /** Recovery learner instance (optional, will create if not provided) */
  recoveryLearner?: RecoveryLearner;
  /** Enable config self-healing (requires workspace path) */
  enableConfigHealing?: boolean;
  /** Workspace path for config healing */
  workspacePath?: string;
  /** Config healing check interval in ms (default: 1 hour) */
  configHealingIntervalMs?: number;
  /** Config health threshold to trigger healing (default: 0.7) */
  configHealingThreshold?: number;
}

/**
 * Record of a healing cycle.
 */
export interface HealingRecord {
  /** Unique ID */
  id: string;
  /** What triggered the healing */
  trigger: TriggerSource;
  /** When healing started */
  startedAt: Date;
  /** When healing completed */
  completedAt: Date;
  /** Fitness before healing */
  fitnessBefore: number;
  /** Fitness after healing */
  fitnessAfter: number;
  /** Actions executed */
  actionsExecuted: ActionRecord[];
  /** Overall success */
  success: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Record of a single action execution.
 */
export interface ActionRecord {
  /** Action type */
  action: string;
  /** Success status */
  success: boolean;
  /** Entities affected */
  entitiesAffected: number;
  /** Duration in ms */
  durationMs: number;
  /** Error if failed */
  error?: string;
}

/**
 * Result of diagnosis.
 */
interface DiagnosisResult {
  currentFitness: number;
  actions: RecoveryAction[];
  diagnoses: DegradationDiagnosis[];
}

/**
 * Daemon status.
 */
export interface DaemonStatus {
  /** Is daemon running */
  running: boolean;
  /** Is healing currently in progress */
  healingInProgress: boolean;
  /** Number of health checks triggered */
  healthChecksTriggered: number;
  /** Number of healings completed */
  healingsCompleted: number;
  /** Last healing record */
  lastHealing?: HealingRecord;
  /** Started at */
  startedAt?: Date;
  /** Config healing status */
  configHealing?: {
    enabled: boolean;
    lastCheck?: Date;
    lastHealthScore?: number;
    healingsApplied: number;
  };
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG = {
  triggerConfig: {} as Partial<TriggerConfig>,
  maxConcurrentActions: 3,
  recoveryBudgetTokens: 10000,
  autoStart: false,
  onHealthCheckTriggered: undefined as ((trigger: TriggeredHealthCheck) => void) | undefined,
  onRecoveryComplete: undefined as ((record: HealingRecord) => void) | undefined,
  enableConfigHealing: false,
  workspacePath: undefined as string | undefined,
  configHealingIntervalMs: 60 * 60 * 1000, // 1 hour
  configHealingThreshold: 0.7,
};

// ============================================================================
// HOMEOSTASIS DAEMON
// ============================================================================

/**
 * Autonomous homeostasis daemon.
 * Monitors system health and triggers recovery when needed.
 */
export class HomeostasisDaemon {
  private readonly storage: LibrarianStorage;
  private readonly eventBus: LibrarianEventBus;
  private readonly config: typeof DEFAULT_CONFIG;
  private readonly learner: RecoveryLearner;
  private triggerWiring: TriggerWiring | null = null;
  private readonly ltlMonitorEvaluator: LTLMonitorEvaluator;
  private readonly eventUnsubscribers: Array<() => void> = [];
  private running = false;
  private healingInProgress = false;
  private healthChecksTriggered = 0;
  private healingsCompleted = 0;
  private startedAt?: Date;
  private healingHistory: HealingRecord[] = [];
  private healingQueue: TriggeredHealthCheck[] = [];
  private processingQueue = false;

  // Config healing state
  private configHealingTrigger: ReturnType<typeof import('../config/self_healing.js').createConfigHealingTrigger> | null = null;
  private configHealingStats = {
    enabled: false,
    lastCheck: undefined as Date | undefined,
    lastHealthScore: undefined as number | undefined,
    healingsApplied: 0,
  };

  constructor(config: HomeostasisDaemonConfig) {
    this.storage = config.storage;
    this.eventBus = config.eventBus;
    this.learner = config.recoveryLearner ?? createRecoveryLearner();
    this.ltlMonitorEvaluator = createLTLMonitorEvaluator({
      storage: this.storage,
      eventBus: this.eventBus,
    });
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    if (this.config.autoStart) {
      void this.start();
    }
  }

  /**
   * Get the recovery learner for external access.
   */
  getRecoveryLearner(): RecoveryLearner {
    return this.learner;
  }

  /**
   * Start the daemon.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.startedAt = new Date();

    // Create and wire triggers
    this.triggerWiring = createTriggerWiring(this.eventBus, this.config.triggerConfig);
    this.triggerWiring.onTrigger((trigger) => {
      void this.onTrigger(trigger);
    });

    this.eventUnsubscribers.push(
      this.eventBus.on('indexing_complete', (event) => {
        void this.onIndexingComplete(event);
      })
    );
    this.eventUnsubscribers.push(
      this.eventBus.on('safety_violation', (event) => {
        this.onSafetyViolation(event);
      })
    );

    // Start config healing if enabled
    if (this.config.enableConfigHealing && this.config.workspacePath) {
      await this.startConfigHealing();
    }

    logInfo('[homeostasis] Daemon started', {
      startedAt: this.startedAt.toISOString(),
      configHealingEnabled: this.configHealingStats.enabled,
    });
  }

  /**
   * Start config self-healing subsystem.
   */
  private async startConfigHealing(): Promise<void> {
    if (!this.config.workspacePath) return;

    try {
      // Dynamic import to avoid circular dependencies
      const { createConfigHealingTrigger } = await import('../config/self_healing.js');

      this.configHealingTrigger = createConfigHealingTrigger(this.config.workspacePath, {
        checkIntervalMs: this.config.configHealingIntervalMs,
        autoHealThreshold: this.config.configHealingThreshold,
        riskTolerance: 'low',
      });

      this.configHealingTrigger.start();
      this.configHealingStats.enabled = true;

      logInfo('[homeostasis] Config healing started', {
        workspace: this.config.workspacePath,
        intervalMs: this.config.configHealingIntervalMs,
        threshold: this.config.configHealingThreshold,
      });
    } catch (error) {
      logWarning('[homeostasis] Failed to start config healing', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Trigger a config health check manually.
   */
  async triggerConfigHealthCheck(): Promise<void> {
    if (!this.configHealingTrigger) {
      logWarning('[homeostasis] Config healing not enabled');
      return;
    }

    try {
      const report = await this.configHealingTrigger.triggerCheck();
      this.configHealingStats.lastCheck = new Date();
      this.configHealingStats.lastHealthScore = report.healthScore;

      if (report.autoFixable.length > 0 && report.healthScore < (this.config.configHealingThreshold ?? 0.7)) {
        this.configHealingStats.healingsApplied++;
      }
    } catch (error) {
      logError('[homeostasis] Config health check failed', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Stop the daemon.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop config healing
    if (this.configHealingTrigger) {
      this.configHealingTrigger.stop();
      this.configHealingTrigger = null;
      this.configHealingStats.enabled = false;
    }

    // Unwire triggers
    if (this.triggerWiring) {
      this.triggerWiring.unwire();
      this.triggerWiring = null;
    }

    while (this.eventUnsubscribers.length > 0) {
      const unsubscribe = this.eventUnsubscribers.pop();
      unsubscribe?.();
    }

    // Clear queue
    this.healingQueue = [];

    logInfo('[homeostasis] Daemon stopped');
  }

  /**
   * Get current daemon status.
   */
  getStatus(): DaemonStatus {
    return {
      running: this.running,
      healingInProgress: this.healingInProgress,
      healthChecksTriggered: this.healthChecksTriggered,
      healingsCompleted: this.healingsCompleted,
      lastHealing: this.healingHistory[this.healingHistory.length - 1],
      startedAt: this.startedAt,
      configHealing: this.configHealingStats.enabled ? {
        enabled: this.configHealingStats.enabled,
        lastCheck: this.configHealingStats.lastCheck,
        lastHealthScore: this.configHealingStats.lastHealthScore,
        healingsApplied: this.configHealingStats.healingsApplied,
      } : undefined,
    };
  }

  /**
   * Get healing history.
   */
  getHealingHistory(limit?: number): HealingRecord[] {
    const history = [...this.healingHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Manually trigger a health check.
   */
  async triggerHealthCheck(reason: string): Promise<HealingRecord | null> {
    const trigger: TriggeredHealthCheck = {
      id: `manual_${Date.now()}`,
      source: 'manual',
      urgency: 'medium',
      timestamp: new Date(),
      affectedFiles: [],
      failedQueries: [],
    };

    return this.executeHealthCheck(trigger);
  }

  /**
   * Simulate heal in progress for testing.
   */
  simulateHealInProgress(inProgress: boolean): void {
    this.healingInProgress = inProgress;
    if (this.triggerWiring) {
      this.triggerWiring.setHealInProgress(inProgress);
    }
  }

  // ============================================================================
  // TRIGGER HANDLING
  // ============================================================================

  private async onIndexingComplete(event: LibrarianEvent): Promise<void> {
    try {
      const violations = await this.ltlMonitorEvaluator.evaluateOnIndexingComplete(event);
      if (violations.length > 0) {
        logWarning('[homeostasis] LTL monitor detected safety violations', {
          count: violations.length,
        });
      }
    } catch (error) {
      logError('[homeostasis] LTL monitor evaluation failed', {
        error: getErrorMessage(error),
      });
    }
  }

  private onSafetyViolation(event: LibrarianEvent): void {
    const violatedProperty = typeof event.data.violatedProperty === 'string'
      ? event.data.violatedProperty
      : 'unknown_property';
    const severity = typeof event.data.severity === 'string'
      ? event.data.severity
      : 'warn';
    const evidence = event.data.evidence && typeof event.data.evidence === 'object'
      ? event.data.evidence
      : {};

    logWarning('[homeostasis] safety_violation event received', {
      violatedProperty,
      severity,
      evidence,
    });
  }

  private async onTrigger(trigger: TriggeredHealthCheck): Promise<void> {
    this.healthChecksTriggered++;

    // Notify callback
    if (this.config.onHealthCheckTriggered) {
      this.config.onHealthCheckTriggered(trigger);
    }

    // Add to queue
    this.healingQueue.push(trigger);

    // Process queue
    if (!this.processingQueue) {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.healingInProgress) return;

    this.processingQueue = true;

    try {
      while (this.healingQueue.length > 0 && this.running) {
        const trigger = this.healingQueue.shift()!;

        // Dedupe: skip if another trigger of same type is queued
        const hasSameTypePending = this.healingQueue.some(
          (t) => t.source === trigger.source
        );
        if (hasSameTypePending && trigger.urgency !== 'critical') {
          continue;
        }

        await this.executeHealthCheck(trigger);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  // ============================================================================
  // HEALTH CHECK EXECUTION
  // ============================================================================

  private async executeHealthCheck(
    trigger: TriggeredHealthCheck
  ): Promise<HealingRecord | null> {
    if (this.healingInProgress) {
      logInfo('[homeostasis] Health check skipped - healing in progress', {
        triggerId: trigger.id,
      });
      return null;
    }

    this.healingInProgress = true;
    if (this.triggerWiring) {
      this.triggerWiring.setHealInProgress(true);
    }

    const startedAt = new Date();
    const actionsExecuted: ActionRecord[] = [];
    let success = true;
    let error: string | undefined;
    let fitnessBefore = 0;
    let fitnessAfter = 0;

    try {
      logInfo('[homeostasis] Health check started', {
        triggerId: trigger.id,
        source: trigger.source,
        urgency: trigger.urgency,
      });

      try {
        await validateSeededPacks(this.storage);
      } catch (validationError) {
        logWarning('[homeostasis] Seeded-pack validation failed', {
          error: getErrorMessage(validationError),
        });
      }

      // 1. Diagnose issues
      const plan = await this.diagnose(trigger);
      fitnessBefore = plan.currentFitness;

      if (plan.actions.length === 0) {
        logInfo('[homeostasis] No recovery actions needed', {
          triggerId: trigger.id,
          fitness: fitnessBefore,
        });
        fitnessAfter = fitnessBefore;
      } else {
        // 2. Execute recovery actions with learning
        for (const action of plan.actions.slice(0, this.config.maxConcurrentActions)) {
          // Get degradation type for this action
          const degradationType = action.type;

          // Measure fitness before action
          const fitnessBeforeAction = await this.computeCurrentFitness();

          const actionRecord = await this.executeRecoveryAction(action);
          actionsExecuted.push(actionRecord);

          // Measure fitness after action
          const fitnessAfterAction = await this.computeCurrentFitness();
          const fitnessDelta = fitnessAfterAction - fitnessBeforeAction;

          // Record outcome for learning
          this.learner.recordOutcome({
            strategy: action.action,
            degradationType,
            success: actionRecord.success,
            fitnessDelta,
            timestamp: new Date(),
          });

          if (!actionRecord.success) {
            success = false;
            if (trigger.urgency === 'critical') {
              // Stop on first failure for critical issues
              break;
            }
          }
        }

        // 3. Compute new fitness
        fitnessAfter = await this.computeCurrentFitness();
      }

      logInfo('[homeostasis] Health check completed', {
        triggerId: trigger.id,
        fitnessBefore,
        fitnessAfter,
        delta: fitnessAfter - fitnessBefore,
        actionsExecuted: actionsExecuted.length,
      });
    } catch (err) {
      success = false;
      error = getErrorMessage(err);
      logError('[homeostasis] Health check failed', {
        triggerId: trigger.id,
        error,
      });
    } finally {
      this.healingInProgress = false;
      if (this.triggerWiring) {
        this.triggerWiring.setHealInProgress(false);
      }
    }

    const record: HealingRecord = {
      id: trigger.id,
      trigger: trigger.source,
      startedAt,
      completedAt: new Date(),
      fitnessBefore,
      fitnessAfter,
      actionsExecuted,
      success,
      error,
    };

    // Store in history
    this.healingHistory.push(record);
    this.healingsCompleted++;

    // Notify callback
    if (this.config.onRecoveryComplete) {
      this.config.onRecoveryComplete(record);
    }

    return record;
  }

  // ============================================================================
  // DIAGNOSIS
  // ============================================================================

  private async diagnose(_trigger: TriggeredHealthCheck): Promise<DiagnosisResult> {
    // Generate state report
    const stateReport = await generateStateReport(this.storage);

    // Compute current fitness
    const currentFitness = await this.computeCurrentFitness();

    // Diagnose degradation from state report
    const diagnoses = diagnoseDegradation(stateReport);

    // Plan recovery actions
    const actions = planRecoveryActions(diagnoses);

    // Prioritize actions using the learner
    const prioritizedActions = this.prioritizeActionsWithLearner(actions);

    return {
      currentFitness,
      actions: prioritizedActions,
      diagnoses,
    };
  }

  /**
   * Prioritize recovery actions using learned success probabilities.
   * Actions with higher historical success rates are prioritized.
   */
  private prioritizeActionsWithLearner(actions: RecoveryAction[]): RecoveryAction[] {
    if (actions.length <= 1) return actions;

    // Get anti-patterns to avoid
    const antiPatterns = this.learner.getAntiPatterns();
    const antiPatternSet = new Set(
      antiPatterns
        .filter((ap) => ap.recommendation === 'avoid')
        .map((ap) => `${ap.strategy}::${ap.degradationType}`)
    );

    // Score each action based on learned success probability
    const scoredActions = actions.map((action) => {
      const key = `${action.action}::${action.type}`;

      // Deprioritize anti-patterns
      if (antiPatternSet.has(key)) {
        return { action, score: -1 };
      }

      // Get success probability from learner
      const successProb = this.learner.getSuccessProbability(
        action.action,
        action.type
      );

      // Combine with action priority (higher priority = lower number, so invert)
      const priorityScore = 1 / (action.priority + 1);

      // Combined score: success probability * priority score
      return {
        action,
        score: successProb * 0.7 + priorityScore * 0.3,
      };
    });

    // Sort by score descending (best first)
    return scoredActions
      .sort((a, b) => b.score - a.score)
      .map(({ action }) => action);
  }

  // ============================================================================
  // ACTION EXECUTION
  // ============================================================================

  private async executeRecoveryAction(action: RecoveryAction): Promise<ActionRecord> {
    const startTime = Date.now();

    try {
      const outcome = await executeAction(this.storage, action.action, {
        maxEntities: action.estimatedEmbeddings,
        maxFiles: action.estimatedFiles,
        reason: action.type,
      });

      return {
        action: action.action,
        success: outcome.success,
        entitiesAffected: outcome.entitiesAffected,
        durationMs: Date.now() - startTime,
        error: outcome.errors.length > 0 ? outcome.errors.join('; ') : undefined,
      };
    } catch (error) {
      return {
        action: action.action,
        success: false,
        entitiesAffected: 0,
        durationMs: Date.now() - startTime,
        error: getErrorMessage(error),
      };
    }
  }

  // ============================================================================
  // FITNESS COMPUTATION
  // ============================================================================

  private async computeCurrentFitness(): Promise<number> {
    try {
      // Get stats from storage
      const stats = await this.storage.getStats();

      // Simple fitness approximation based on available metrics
      // This would be replaced with the full fitness computation in production
      const confidenceFactor = stats.averageConfidence;
      const cacheFactor = stats.cacheHitRate;
      const sizeFactor = Math.min(1.0, stats.totalFunctions / 100);

      // Weighted average
      return (
        confidenceFactor * 0.5 +
        cacheFactor * 0.3 +
        sizeFactor * 0.2
      );
    } catch {
      return 0.5; // Default if stats unavailable
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a homeostasis daemon.
 */
export function createHomeostasisDaemon(
  config: HomeostasisDaemonConfig
): HomeostasisDaemon {
  return new HomeostasisDaemon(config);
}
