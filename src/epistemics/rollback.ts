/**
 * @fileoverview Automated Rollback Mechanism (WU-THIMPL-114)
 *
 * Provides safety infrastructure for self-improvement operations.
 * When a self-improvement cycle degrades system health, the system
 * can restore to a known-good checkpoint state.
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Serialized state that can be restored.
 *
 * Contains all mutable state needed to restore the system to a checkpoint:
 * - Calibration reports
 * - Knowledge graph state
 * - Configuration values
 * - Learned patterns
 */
export interface SerializedState {
  /** Version for migration compatibility */
  version: string;
  /** Serialized calibration reports by category */
  calibration: Record<string, unknown>;
  /** Serialized patterns from tp_learn_extract_pattern */
  patterns: unknown[];
  /** Configuration values that may have been modified */
  config: Record<string, unknown>;
  /** Checksum for integrity verification */
  checksum: string;
}

/**
 * Metadata about a rollback point.
 */
export interface RollbackMetadata {
  /** Why this checkpoint was created */
  reason: string;
  /** What operation triggered the checkpoint (e.g., primitive ID) */
  triggeredBy: string;
  /** Health score at checkpoint time */
  healthScore?: number;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * A point in time to which the system can be rolled back.
 */
export interface RollbackPoint {
  /** Unique identifier for this checkpoint */
  id: string;
  /** When the checkpoint was created */
  timestamp: Date;
  /** Serialized system state */
  state: SerializedState;
  /** Metadata about the checkpoint */
  metadata: RollbackMetadata;
}

/**
 * Configuration for the rollback manager.
 */
export interface RollbackManagerConfig {
  /** Maximum number of checkpoints to retain */
  maxCheckpoints: number;
  /** Maximum age of checkpoints in milliseconds (default: 7 days) */
  maxCheckpointAge: number;
  /** Minimum checkpoints to keep regardless of age */
  minCheckpointsToKeep: number;
  /** Current state version for compatibility checking */
  stateVersion: string;
}

/**
 * State provider interface for extracting current state.
 */
export interface StateProvider {
  /** Get current calibration state */
  getCalibrationState(): Record<string, unknown>;
  /** Get current patterns */
  getPatterns(): unknown[];
  /** Get current configuration */
  getConfig(): Record<string, unknown>;
  /** Restore calibration state */
  restoreCalibrationState(state: Record<string, unknown>): void;
  /** Restore patterns */
  restorePatterns(patterns: unknown[]): void;
  /** Restore configuration */
  restoreConfig(config: Record<string, unknown>): void;
}

/**
 * Manages checkpoints and rollback operations.
 */
export interface RollbackManager {
  /**
   * Create a checkpoint of current system state.
   *
   * @param reason - Human-readable reason for checkpoint
   * @returns The created RollbackPoint
   */
  createCheckpoint(reason: string): Promise<RollbackPoint>;

  /**
   * Restore system to a previous checkpoint.
   *
   * @param checkpointId - ID of the checkpoint to restore
   * @throws If checkpoint not found or restoration fails
   */
  rollback(checkpointId: string): Promise<void>;

  /**
   * List all available checkpoints.
   *
   * @returns Checkpoints ordered by timestamp (most recent first)
   */
  listCheckpoints(): RollbackPoint[];

  /**
   * Remove checkpoints older than maxAge.
   *
   * @param maxAge - Maximum age in milliseconds
   * @returns Number of checkpoints pruned
   */
  pruneOldCheckpoints(maxAge: number): number;

  /**
   * Get the most recent checkpoint.
   *
   * @returns Most recent checkpoint or undefined if none exist
   */
  getLatestCheckpoint(): RollbackPoint | undefined;

  /**
   * Verify checkpoint integrity.
   *
   * @param checkpointId - ID of checkpoint to verify
   * @returns True if checkpoint is valid and restorable
   */
  verifyCheckpoint(checkpointId: string): Promise<boolean>;

  /**
   * Get a checkpoint by ID.
   *
   * @param checkpointId - ID of the checkpoint to retrieve
   * @returns The checkpoint or undefined if not found
   */
  getCheckpoint(checkpointId: string): RollbackPoint | undefined;
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when a checkpoint is not found.
 */
export class CheckpointNotFoundError extends Error {
  constructor(public readonly checkpointId: string) {
    super(`Checkpoint not found: ${checkpointId}`);
    this.name = 'CheckpointNotFoundError';
  }
}

/**
 * Error thrown when checkpoint verification fails.
 */
export class CheckpointVerificationError extends Error {
  constructor(
    public readonly checkpointId: string,
    public readonly reason: string
  ) {
    super(`Checkpoint verification failed for ${checkpointId}: ${reason}`);
    this.name = 'CheckpointVerificationError';
  }
}

/**
 * Error thrown when state version is incompatible.
 */
export class StateVersionMismatchError extends Error {
  constructor(
    public readonly checkpointVersion: string,
    public readonly currentVersion: string
  ) {
    super(
      `State version mismatch: checkpoint has ${checkpointVersion}, current is ${currentVersion}`
    );
    this.name = 'StateVersionMismatchError';
  }
}

/**
 * Error thrown when rollback fails.
 */
export class RollbackFailedError extends Error {
  constructor(
    public readonly checkpointId: string,
    public readonly cause: Error
  ) {
    super(`Rollback to checkpoint ${checkpointId} failed: ${cause.message}`);
    this.name = 'RollbackFailedError';
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default configuration for rollback manager */
export const DEFAULT_ROLLBACK_CONFIG: RollbackManagerConfig = {
  maxCheckpoints: 50,
  maxCheckpointAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  minCheckpointsToKeep: 3,
  stateVersion: '1.0.0',
};

/** Current state version for serialization */
export const STATE_VERSION = '1.0.0';

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Compute checksum for serialized state.
 */
export function computeChecksum(state: Omit<SerializedState, 'checksum'>): string {
  const content = JSON.stringify({
    version: state.version,
    calibration: state.calibration,
    patterns: state.patterns,
    config: state.config,
  });
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Verify checksum for serialized state.
 */
export function verifyChecksum(state: SerializedState): boolean {
  const expected = computeChecksum({
    version: state.version,
    calibration: state.calibration,
    patterns: state.patterns,
    config: state.config,
  });
  return state.checksum === expected;
}

/**
 * Generate a unique checkpoint ID.
 */
function generateCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `ckpt_${timestamp}_${random}`;
}

/**
 * In-memory implementation of RollbackManager.
 *
 * This implementation stores checkpoints in memory and is suitable for
 * testing and single-session use. For production, consider a persistent
 * implementation backed by SQLite or similar.
 */
export class InMemoryRollbackManager implements RollbackManager {
  private checkpoints: Map<string, RollbackPoint> = new Map();
  /** Tracks insertion order for stable sorting when timestamps are equal */
  private insertionOrder: string[] = [];
  private config: RollbackManagerConfig;
  private stateProvider: StateProvider;
  private currentTriggeredBy: string = 'manual';

  constructor(
    stateProvider: StateProvider,
    config: Partial<RollbackManagerConfig> = {}
  ) {
    this.config = { ...DEFAULT_ROLLBACK_CONFIG, ...config };
    this.stateProvider = stateProvider;
  }

  /**
   * Set the triggeredBy field for the next checkpoint.
   */
  setTriggeredBy(triggeredBy: string): void {
    this.currentTriggeredBy = triggeredBy;
  }

  async createCheckpoint(reason: string): Promise<RollbackPoint> {
    // Extract current state
    const calibration = this.stateProvider.getCalibrationState();
    const patterns = this.stateProvider.getPatterns();
    const config = this.stateProvider.getConfig();

    // Create serialized state
    const stateWithoutChecksum = {
      version: this.config.stateVersion,
      calibration,
      patterns,
      config,
    };

    const state: SerializedState = {
      ...stateWithoutChecksum,
      checksum: computeChecksum(stateWithoutChecksum),
    };

    // Create checkpoint
    const checkpoint: RollbackPoint = {
      id: generateCheckpointId(),
      timestamp: new Date(),
      state,
      metadata: {
        reason,
        triggeredBy: this.currentTriggeredBy,
      },
    };

    // Store checkpoint
    this.checkpoints.set(checkpoint.id, checkpoint);
    this.insertionOrder.push(checkpoint.id);

    // Reset triggeredBy
    this.currentTriggeredBy = 'manual';

    // Prune if over limit
    this.enforceCheckpointLimit();

    return checkpoint;
  }

  async rollback(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new CheckpointNotFoundError(checkpointId);
    }

    // Verify integrity
    if (!verifyChecksum(checkpoint.state)) {
      throw new CheckpointVerificationError(checkpointId, 'checksum_mismatch');
    }

    // Check version compatibility
    if (checkpoint.state.version !== this.config.stateVersion) {
      throw new StateVersionMismatchError(
        checkpoint.state.version,
        this.config.stateVersion
      );
    }

    // Restore state
    try {
      this.stateProvider.restoreCalibrationState(checkpoint.state.calibration);
      this.stateProvider.restorePatterns(checkpoint.state.patterns);
      this.stateProvider.restoreConfig(checkpoint.state.config);
    } catch (error) {
      throw new RollbackFailedError(
        checkpointId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  listCheckpoints(): RollbackPoint[] {
    // Sort by timestamp descending, using insertion order as tiebreaker
    return Array.from(this.checkpoints.values()).sort((a, b) => {
      const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
      if (timeDiff !== 0) return timeDiff;
      // When timestamps are equal, use insertion order (most recent first)
      return this.insertionOrder.indexOf(b.id) - this.insertionOrder.indexOf(a.id);
    });
  }

  pruneOldCheckpoints(maxAge: number): number {
    const now = Date.now();
    const toRemove: string[] = [];

    // Get checkpoints sorted by age (oldest first)
    const sorted = this.listCheckpoints().reverse();

    for (const checkpoint of sorted) {
      const age = now - checkpoint.timestamp.getTime();
      if (age > maxAge) {
        // Only remove if we'll still have minCheckpointsToKeep
        if (this.checkpoints.size - toRemove.length > this.config.minCheckpointsToKeep) {
          toRemove.push(checkpoint.id);
        }
      }
    }

    for (const id of toRemove) {
      this.checkpoints.delete(id);
      const idx = this.insertionOrder.indexOf(id);
      if (idx !== -1) {
        this.insertionOrder.splice(idx, 1);
      }
    }

    return toRemove.length;
  }

  getLatestCheckpoint(): RollbackPoint | undefined {
    const checkpoints = this.listCheckpoints();
    return checkpoints.length > 0 ? checkpoints[0] : undefined;
  }

  async verifyCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Verify checksum
    if (!verifyChecksum(checkpoint.state)) {
      return false;
    }

    // Verify version compatibility
    if (checkpoint.state.version !== this.config.stateVersion) {
      return false;
    }

    return true;
  }

  getCheckpoint(checkpointId: string): RollbackPoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Enforce the maximum checkpoint limit.
   */
  private enforceCheckpointLimit(): void {
    while (this.checkpoints.size > this.config.maxCheckpoints) {
      // Remove oldest checkpoint (but keep minimum)
      const oldest = this.listCheckpoints().pop();
      if (oldest && this.checkpoints.size > this.config.minCheckpointsToKeep) {
        this.checkpoints.delete(oldest.id);
        const idx = this.insertionOrder.indexOf(oldest.id);
        if (idx !== -1) {
          this.insertionOrder.splice(idx, 1);
        }
      } else {
        break;
      }
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new rollback manager with in-memory storage.
 */
export function createRollbackManager(
  stateProvider: StateProvider,
  config?: Partial<RollbackManagerConfig>
): RollbackManager {
  return new InMemoryRollbackManager(stateProvider, config);
}

/**
 * Create a no-op state provider for testing.
 */
export function createNoopStateProvider(): StateProvider {
  let calibration: Record<string, unknown> = {};
  let patterns: unknown[] = [];
  let config: Record<string, unknown> = {};

  return {
    getCalibrationState: () => ({ ...calibration }),
    getPatterns: () => [...patterns],
    getConfig: () => ({ ...config }),
    restoreCalibrationState: (state) => {
      calibration = { ...state };
    },
    restorePatterns: (p) => {
      patterns = [...p];
    },
    restoreConfig: (c) => {
      config = { ...c };
    },
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for RollbackPoint.
 */
export function isRollbackPoint(value: unknown): value is RollbackPoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RollbackPoint>;
  return (
    typeof candidate.id === 'string' &&
    candidate.timestamp instanceof Date &&
    isSerializedState(candidate.state) &&
    isRollbackMetadata(candidate.metadata)
  );
}

/**
 * Type guard for SerializedState.
 */
export function isSerializedState(value: unknown): value is SerializedState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SerializedState>;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.calibration === 'object' &&
    Array.isArray(candidate.patterns) &&
    typeof candidate.config === 'object' &&
    typeof candidate.checksum === 'string'
  );
}

/**
 * Type guard for RollbackMetadata.
 */
export function isRollbackMetadata(value: unknown): value is RollbackMetadata {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RollbackMetadata>;
  return (
    typeof candidate.reason === 'string' &&
    typeof candidate.triggeredBy === 'string'
  );
}
