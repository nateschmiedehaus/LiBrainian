/**
 * @fileoverview Homeostasis Triggers
 *
 * Event-driven triggers for autonomous health checks.
 * Implements the trigger wiring that detects when healing may be needed.
 *
 * Triggers:
 * - File change: Debounced file modifications (5s default)
 * - Query failure: 3 consecutive failures trigger health check
 * - Scheduled: Periodic health checks (60s default)
 * - Degradation: threshold_alert events trigger immediate response
 *
 * @packageDocumentation
 */

import type { LiBrainianEventBus, LiBrainianEvent } from '../events.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Trigger source type.
 */
export type TriggerSource =
  | 'file_change'
  | 'query_failure'
  | 'scheduled'
  | 'degradation'
  | 'manual';

/**
 * Urgency level for triggered health checks.
 */
export type TriggerUrgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * Information about a triggered health check.
 */
export interface TriggeredHealthCheck {
  /** Unique trigger ID */
  id: string;
  /** What triggered this health check */
  source: TriggerSource;
  /** Urgency level */
  urgency: TriggerUrgency;
  /** When triggered */
  timestamp: Date;
  /** Affected files (for file_change triggers) */
  affectedFiles: string[];
  /** Failed queries (for query_failure triggers) */
  failedQueries: string[];
  /** Metric that triggered (for degradation triggers) */
  metric?: string;
  /** Current value that triggered */
  currentValue?: number;
  /** Threshold that was breached */
  threshold?: number;
}

/**
 * Configuration for trigger behavior.
 */
export interface TriggerConfig {
  /** Debounce time for file changes in ms (default: 5000) */
  fileChangeDebounceMs: number;
  /** Number of query failures before triggering (default: 3) */
  queryFailureThreshold: number;
  /** Scheduled check interval in ms (default: 60000) */
  scheduledIntervalMs: number;
  /** Paths to exclude from file change triggers */
  excludePaths: string[];
}

/**
 * Callback when a health check is triggered.
 */
export type TriggerCallback = (trigger: TriggeredHealthCheck) => void | Promise<void>;

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  fileChangeDebounceMs: 5000,
  queryFailureThreshold: 3,
  scheduledIntervalMs: 60000,
  excludePaths: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.librainian',
    '.next',
    'coverage',
  ],
};

// ============================================================================
// TRIGGER WIRING
// ============================================================================

/**
 * Manages trigger wiring for homeostasis.
 * Connects event bus events to health check triggers.
 */
export class TriggerWiring {
  private readonly config: TriggerConfig;
  private readonly callbacks: Set<TriggerCallback> = new Set();
  private readonly unsubscribers: Array<() => void> = [];

  // File change state
  private fileChangeBuffer: Set<string> = new Set();
  private fileChangeTimeout: NodeJS.Timeout | null = null;

  // Query failure state
  private consecutiveQueryFailures = 0;
  private failedQueries: string[] = [];

  // Scheduled state
  private scheduledInterval: NodeJS.Timeout | null = null;

  // Heal in progress flag
  private healInProgress = false;

  constructor(config: Partial<TriggerConfig> = {}) {
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config };
  }

  /**
   * Register a callback for triggered health checks.
   */
  onTrigger(callback: TriggerCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Wire up all triggers to an event bus.
   */
  wire(eventBus: LiBrainianEventBus): void {
    // File modification trigger
    this.unsubscribers.push(
      eventBus.on('file_modified', (event) => {
        this.onFileModified(event);
      })
    );

    // File creation trigger
    this.unsubscribers.push(
      eventBus.on('file_created', (event) => {
        this.onFileModified(event);
      })
    );

    // File deletion trigger
    this.unsubscribers.push(
      eventBus.on('file_deleted', (event) => {
        this.onFileDeleted(event);
      })
    );

    // Query failure trigger
    this.unsubscribers.push(
      eventBus.on('query_error', (event) => {
        this.onQueryError(event);
      })
    );

    // Query success resets failure counter
    this.unsubscribers.push(
      eventBus.on('query_result', () => {
        this.onQuerySuccess();
      })
    );

    // Degradation threshold trigger
    this.unsubscribers.push(
      eventBus.on('threshold_alert', (event) => {
        this.onThresholdAlert(event);
      })
    );

    // Start scheduled checks
    this.startScheduledChecks();
  }

  /**
   * Stop all trigger wiring.
   */
  unwire(): void {
    // Unsubscribe from events
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;

    // Clear file change debounce
    if (this.fileChangeTimeout) {
      clearTimeout(this.fileChangeTimeout);
      this.fileChangeTimeout = null;
    }
    this.fileChangeBuffer.clear();

    // Clear scheduled checks
    if (this.scheduledInterval) {
      clearInterval(this.scheduledInterval);
      this.scheduledInterval = null;
    }

    // Reset state
    this.consecutiveQueryFailures = 0;
    this.failedQueries = [];
    this.healInProgress = false;
  }

  /**
   * Set whether healing is currently in progress.
   * Scheduled checks are skipped when healing.
   */
  setHealInProgress(inProgress: boolean): void {
    this.healInProgress = inProgress;
  }

  // ============================================================================
  // FILE CHANGE HANDLING
  // ============================================================================

  private onFileModified(event: LiBrainianEvent): void {
    const filePath = event.data.filePath as string | undefined;
    if (!filePath) return;

    // Skip excluded paths
    if (this.isExcludedPath(filePath)) return;

    // Buffer the file change
    this.fileChangeBuffer.add(filePath);

    // Debounce the trigger
    if (this.fileChangeTimeout) {
      clearTimeout(this.fileChangeTimeout);
    }

    this.fileChangeTimeout = setTimeout(() => {
      this.fireFileChangeTrigger();
    }, this.config.fileChangeDebounceMs);
  }

  private onFileDeleted(event: LiBrainianEvent): void {
    const filePath = event.data.filePath as string | undefined;
    if (!filePath) return;

    // Skip excluded paths
    if (this.isExcludedPath(filePath)) return;

    // Buffer the file change
    this.fileChangeBuffer.add(filePath);

    // Debounce the trigger
    if (this.fileChangeTimeout) {
      clearTimeout(this.fileChangeTimeout);
    }

    this.fileChangeTimeout = setTimeout(() => {
      this.fireFileChangeTrigger();
    }, this.config.fileChangeDebounceMs);
  }

  private fireFileChangeTrigger(): void {
    if (this.fileChangeBuffer.size === 0) return;

    const affectedFiles = Array.from(this.fileChangeBuffer);
    this.fileChangeBuffer.clear();
    this.fileChangeTimeout = null;

    const trigger: TriggeredHealthCheck = {
      id: generateTriggerId(),
      source: 'file_change',
      urgency: 'low',
      timestamp: new Date(),
      affectedFiles,
      failedQueries: [],
    };

    this.notifyCallbacks(trigger);
  }

  private isExcludedPath(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.config.excludePaths.some(
      (exclude) =>
        normalizedPath.includes(`/${exclude}/`) ||
        normalizedPath.startsWith(`${exclude}/`) ||
        normalizedPath === exclude
    );
  }

  // ============================================================================
  // QUERY FAILURE HANDLING
  // ============================================================================

  private onQueryError(event: LiBrainianEvent): void {
    const queryId = event.data.queryId as string | undefined;
    const error = event.data.error as string | undefined;

    this.consecutiveQueryFailures++;
    if (queryId) {
      this.failedQueries.push(queryId);
    }

    // Trigger after threshold consecutive failures
    if (this.consecutiveQueryFailures >= this.config.queryFailureThreshold) {
      const trigger: TriggeredHealthCheck = {
        id: generateTriggerId(),
        source: 'query_failure',
        urgency: 'medium',
        timestamp: new Date(),
        affectedFiles: [],
        failedQueries: [...this.failedQueries],
        metric: 'consecutive_query_failures',
        currentValue: this.consecutiveQueryFailures,
        threshold: this.config.queryFailureThreshold,
      };

      // Reset state
      this.consecutiveQueryFailures = 0;
      this.failedQueries = [];

      this.notifyCallbacks(trigger);
    }
  }

  private onQuerySuccess(): void {
    // Reset failure counter on success
    this.consecutiveQueryFailures = 0;
    this.failedQueries = [];
  }

  // ============================================================================
  // THRESHOLD ALERT HANDLING
  // ============================================================================

  private onThresholdAlert(event: LiBrainianEvent): void {
    const metric = event.data.metric as string | undefined;
    const current = event.data.current as number | undefined;
    const threshold = event.data.threshold as number | undefined;

    // Determine urgency based on how far below threshold
    let urgency: TriggerUrgency = 'medium';
    if (typeof current === 'number' && typeof threshold === 'number') {
      const ratio = current / threshold;
      if (ratio < 0.3) {
        urgency = 'critical';
      } else if (ratio < 0.5) {
        urgency = 'high';
      }
    }

    const trigger: TriggeredHealthCheck = {
      id: generateTriggerId(),
      source: 'degradation',
      urgency,
      timestamp: new Date(),
      affectedFiles: [],
      failedQueries: [],
      metric,
      currentValue: current,
      threshold,
    };

    this.notifyCallbacks(trigger);
  }

  // ============================================================================
  // SCHEDULED CHECKS
  // ============================================================================

  private startScheduledChecks(): void {
    if (this.scheduledInterval) return;

    this.scheduledInterval = setInterval(() => {
      // Skip if healing is in progress
      if (this.healInProgress) return;

      const trigger: TriggeredHealthCheck = {
        id: generateTriggerId(),
        source: 'scheduled',
        urgency: 'low',
        timestamp: new Date(),
        affectedFiles: [],
        failedQueries: [],
      };

      this.notifyCallbacks(trigger);
    }, this.config.scheduledIntervalMs);
  }

  // ============================================================================
  // CALLBACK NOTIFICATION
  // ============================================================================

  private notifyCallbacks(trigger: TriggeredHealthCheck): void {
    for (const callback of this.callbacks) {
      try {
        const result = callback(trigger);
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('[homeostasis] Trigger callback error:', error);
          });
        }
      } catch (error) {
        console.error('[homeostasis] Trigger callback error:', error);
      }
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

let triggerCounter = 0;

function generateTriggerId(): string {
  return `trigger_${Date.now()}_${++triggerCounter}`;
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create and wire up trigger system.
 */
export function createTriggerWiring(
  eventBus: LiBrainianEventBus,
  config?: Partial<TriggerConfig>
): TriggerWiring {
  const wiring = new TriggerWiring(config);
  wiring.wire(eventBus);
  return wiring;
}
