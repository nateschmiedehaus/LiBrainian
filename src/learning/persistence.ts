/**
 * @fileoverview Persistence Layer for Recovery Learner
 *
 * Handles saving and loading the recovery learner state to disk,
 * enabling learning to persist across sessions.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  RecoveryLearner,
  createRecoveryLearner,
  type RecoveryLearnerState,
} from './recovery_learner.js';
import { logInfo, logWarning } from '../telemetry/logger.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default filename for learner state */
const LEARNER_STATE_FILENAME = 'recovery_learner_state.json';

/** State directory relative to workspace */
const STATE_DIR = '.librainian';

// ============================================================================
// TYPES
// ============================================================================

export interface LearnerPersistenceOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Custom state filename (optional) */
  stateFilename?: string;
  /** Auto-save after each outcome (default: true) */
  autoSave?: boolean;
}

// ============================================================================
// PERSISTENCE FUNCTIONS
// ============================================================================

/**
 * Get the path to the learner state file
 */
export function getLearnerStatePath(workspaceRoot: string, filename?: string): string {
  return path.join(workspaceRoot, STATE_DIR, filename ?? LEARNER_STATE_FILENAME);
}

/**
 * Save learner state to disk
 */
export async function saveLearnerState(
  learner: RecoveryLearner,
  workspaceRoot: string,
  filename?: string
): Promise<void> {
  const statePath = getLearnerStatePath(workspaceRoot, filename);
  const stateDir = path.dirname(statePath);

  // Ensure directory exists
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Serialize and save
  const state = learner.serialize();
  const content = JSON.stringify(state, null, 2);

  fs.writeFileSync(statePath, content, 'utf-8');

  logInfo('[learning] Learner state saved', {
    path: statePath,
    strategiesCount: Object.keys(state.stats).length,
  });
}

/**
 * Load learner state from disk
 */
export async function loadLearnerState(
  workspaceRoot: string,
  filename?: string
): Promise<RecoveryLearner> {
  const statePath = getLearnerStatePath(workspaceRoot, filename);
  const learner = createRecoveryLearner();

  if (!fs.existsSync(statePath)) {
    logInfo('[learning] No existing learner state found, starting fresh', {
      path: statePath,
    });
    return learner;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const state: RecoveryLearnerState = JSON.parse(content);
    learner.deserialize(state);

    logInfo('[learning] Learner state loaded', {
      path: statePath,
      strategiesCount: Object.keys(state.stats).length,
      createdAt: state.createdAt,
    });
  } catch (error) {
    logWarning('[learning] Failed to load learner state, starting fresh', {
      path: statePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return learner;
}

/**
 * Create a learner with auto-persistence
 *
 * Returns a wrapped learner that automatically saves state after each outcome.
 */
export async function createPersistentLearner(
  options: LearnerPersistenceOptions
): Promise<{
  learner: RecoveryLearner;
  save: () => Promise<void>;
}> {
  const { workspaceRoot, stateFilename, autoSave = true } = options;

  // Load existing state
  const learner = await loadLearnerState(workspaceRoot, stateFilename);

  // Create save function
  const save = async () => {
    await saveLearnerState(learner, workspaceRoot, stateFilename);
  };

  // If auto-save is enabled, we wrap the learner's recordOutcome
  if (autoSave) {
    const originalRecordOutcome = learner.recordOutcome.bind(learner);
    learner.recordOutcome = (outcome) => {
      originalRecordOutcome(outcome);
      // Save asynchronously (don't await to avoid blocking)
      save().catch((err) => {
        logWarning('[learning] Auto-save failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };
  }

  return { learner, save };
}

/**
 * Check if learner state exists
 */
export function hasLearnerState(workspaceRoot: string, filename?: string): boolean {
  const statePath = getLearnerStatePath(workspaceRoot, filename);
  return fs.existsSync(statePath);
}

/**
 * Delete learner state
 */
export function deleteLearnerState(workspaceRoot: string, filename?: string): boolean {
  const statePath = getLearnerStatePath(workspaceRoot, filename);

  if (!fs.existsSync(statePath)) {
    return false;
  }

  fs.unlinkSync(statePath);
  logInfo('[learning] Learner state deleted', { path: statePath });
  return true;
}

/**
 * Get learner state summary without loading full state
 */
export function getLearnerStateSummary(
  workspaceRoot: string,
  filename?: string
): {
  exists: boolean;
  path: string;
  strategiesCount?: number;
  createdAt?: string;
  updatedAt?: string;
} {
  const statePath = getLearnerStatePath(workspaceRoot, filename);

  if (!fs.existsSync(statePath)) {
    return { exists: false, path: statePath };
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const state: RecoveryLearnerState = JSON.parse(content);

    return {
      exists: true,
      path: statePath,
      strategiesCount: Object.keys(state.stats).length,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  } catch {
    return { exists: true, path: statePath };
  }
}
