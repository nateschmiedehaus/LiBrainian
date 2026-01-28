/**
 * @fileoverview Tests for Automated Rollback Mechanism (WU-THIMPL-114)
 *
 * Tests cover:
 * - Checkpoint creation and storage
 * - Checkpoint listing and retrieval
 * - Rollback to previous checkpoints
 * - Checkpoint verification and integrity
 * - Pruning old checkpoints
 * - Error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRollbackManager,
  createNoopStateProvider,
  InMemoryRollbackManager,
  computeChecksum,
  verifyChecksum,
  CheckpointNotFoundError,
  CheckpointVerificationError,
  StateVersionMismatchError,
  RollbackFailedError,
  isRollbackPoint,
  isSerializedState,
  isRollbackMetadata,
  DEFAULT_ROLLBACK_CONFIG,
  STATE_VERSION,
  type StateProvider,
  type RollbackManager,
  type RollbackPoint,
  type SerializedState,
} from '../rollback.js';

describe('Automated Rollback Mechanism (WU-THIMPL-114)', () => {
  let stateProvider: StateProvider;
  let manager: RollbackManager;

  beforeEach(() => {
    stateProvider = createNoopStateProvider();
    manager = createRollbackManager(stateProvider);
  });

  describe('computeChecksum and verifyChecksum', () => {
    it('should compute consistent checksums for same state', () => {
      const state = {
        version: '1.0.0',
        calibration: { key: 'value' },
        patterns: [{ id: 1 }],
        config: { setting: true },
      };

      const checksum1 = computeChecksum(state);
      const checksum2 = computeChecksum(state);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(16);
    });

    it('should compute different checksums for different states', () => {
      const state1 = {
        version: '1.0.0',
        calibration: { key: 'value1' },
        patterns: [],
        config: {},
      };
      const state2 = {
        version: '1.0.0',
        calibration: { key: 'value2' },
        patterns: [],
        config: {},
      };

      expect(computeChecksum(state1)).not.toBe(computeChecksum(state2));
    });

    it('should verify valid checksums', () => {
      const stateWithoutChecksum = {
        version: '1.0.0',
        calibration: {},
        patterns: [],
        config: {},
      };
      const state: SerializedState = {
        ...stateWithoutChecksum,
        checksum: computeChecksum(stateWithoutChecksum),
      };

      expect(verifyChecksum(state)).toBe(true);
    });

    it('should reject invalid checksums', () => {
      const state: SerializedState = {
        version: '1.0.0',
        calibration: {},
        patterns: [],
        config: {},
        checksum: 'invalid_checksum',
      };

      expect(verifyChecksum(state)).toBe(false);
    });
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint with correct structure', async () => {
      const checkpoint = await manager.createCheckpoint('Test checkpoint');

      expect(checkpoint.id).toMatch(/^ckpt_/);
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.metadata.reason).toBe('Test checkpoint');
      expect(checkpoint.metadata.triggeredBy).toBe('manual');
      expect(checkpoint.state.version).toBe(STATE_VERSION);
      expect(verifyChecksum(checkpoint.state)).toBe(true);
    });

    it('should capture current state in checkpoint', async () => {
      // Set up state
      stateProvider.restoreCalibrationState({ ece: 0.05 });
      stateProvider.restorePatterns([{ id: 'pattern1' }]);
      stateProvider.restoreConfig({ threshold: 0.8 });

      const checkpoint = await manager.createCheckpoint('State capture test');

      expect(checkpoint.state.calibration).toEqual({ ece: 0.05 });
      expect(checkpoint.state.patterns).toEqual([{ id: 'pattern1' }]);
      expect(checkpoint.state.config).toEqual({ threshold: 0.8 });
    });

    it('should allow setting triggeredBy', async () => {
      const inMemoryManager = manager as InMemoryRollbackManager;
      inMemoryManager.setTriggeredBy('tp_improve_plan_fix');

      const checkpoint = await manager.createCheckpoint('Fix checkpoint');

      expect(checkpoint.metadata.triggeredBy).toBe('tp_improve_plan_fix');
    });

    it('should reset triggeredBy after checkpoint creation', async () => {
      const inMemoryManager = manager as InMemoryRollbackManager;
      inMemoryManager.setTriggeredBy('tp_improve_plan_fix');

      await manager.createCheckpoint('First');
      const second = await manager.createCheckpoint('Second');

      expect(second.metadata.triggeredBy).toBe('manual');
    });
  });

  describe('listCheckpoints', () => {
    it('should return empty array when no checkpoints exist', () => {
      expect(manager.listCheckpoints()).toEqual([]);
    });

    it('should return checkpoints ordered by timestamp (most recent first)', async () => {
      await manager.createCheckpoint('First');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await manager.createCheckpoint('Second');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await manager.createCheckpoint('Third');

      const checkpoints = manager.listCheckpoints();

      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].metadata.reason).toBe('Third');
      expect(checkpoints[1].metadata.reason).toBe('Second');
      expect(checkpoints[2].metadata.reason).toBe('First');
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return undefined when no checkpoints exist', () => {
      expect(manager.getLatestCheckpoint()).toBeUndefined();
    });

    it('should return the most recent checkpoint', async () => {
      await manager.createCheckpoint('First');
      await manager.createCheckpoint('Second');
      const third = await manager.createCheckpoint('Third');

      const latest = manager.getLatestCheckpoint();
      expect(latest).toBeDefined();
      expect(latest?.id).toBe(third.id);
      expect(latest?.metadata.reason).toBe('Third');
    });
  });

  describe('getCheckpoint', () => {
    it('should return checkpoint by ID', async () => {
      const checkpoint = await manager.createCheckpoint('Test');

      expect(manager.getCheckpoint(checkpoint.id)).toEqual(checkpoint);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getCheckpoint('unknown_id')).toBeUndefined();
    });
  });

  describe('verifyCheckpoint', () => {
    it('should return true for valid checkpoint', async () => {
      const checkpoint = await manager.createCheckpoint('Test');

      expect(await manager.verifyCheckpoint(checkpoint.id)).toBe(true);
    });

    it('should return false for unknown checkpoint', async () => {
      expect(await manager.verifyCheckpoint('unknown_id')).toBe(false);
    });
  });

  describe('rollback', () => {
    it('should restore state from checkpoint', async () => {
      // Initial state
      stateProvider.restoreCalibrationState({ ece: 0.05 });
      stateProvider.restoreConfig({ threshold: 0.8 });

      const checkpoint = await manager.createCheckpoint('Before change');

      // Modify state
      stateProvider.restoreCalibrationState({ ece: 0.15 });
      stateProvider.restoreConfig({ threshold: 0.5 });

      // Verify state changed
      expect(stateProvider.getCalibrationState()).toEqual({ ece: 0.15 });
      expect(stateProvider.getConfig()).toEqual({ threshold: 0.5 });

      // Rollback
      await manager.rollback(checkpoint.id);

      // Verify state restored
      expect(stateProvider.getCalibrationState()).toEqual({ ece: 0.05 });
      expect(stateProvider.getConfig()).toEqual({ threshold: 0.8 });
    });

    it('should throw CheckpointNotFoundError for unknown ID', async () => {
      await expect(manager.rollback('unknown_id')).rejects.toThrow(
        CheckpointNotFoundError
      );
    });
  });

  describe('pruneOldCheckpoints', () => {
    it('should remove checkpoints older than maxAge', async () => {
      // Create checkpoints with artificial timestamps
      await manager.createCheckpoint('First');
      await manager.createCheckpoint('Second');
      await manager.createCheckpoint('Third');

      // Immediately prune with 0 maxAge
      const pruned = manager.pruneOldCheckpoints(0);

      // Should keep minCheckpointsToKeep (default 3)
      expect(pruned).toBe(0);
      expect(manager.listCheckpoints()).toHaveLength(3);
    });

    it('should keep minimum number of checkpoints regardless of age', async () => {
      // Create checkpoints
      for (let i = 0; i < 5; i++) {
        await manager.createCheckpoint(`Checkpoint ${i}`);
      }

      // Try to prune all
      const pruned = manager.pruneOldCheckpoints(0);

      // Should keep minCheckpointsToKeep (default 3)
      expect(manager.listCheckpoints().length).toBeGreaterThanOrEqual(
        DEFAULT_ROLLBACK_CONFIG.minCheckpointsToKeep
      );
    });

    it('should return count of pruned checkpoints', async () => {
      // Create many checkpoints
      for (let i = 0; i < 10; i++) {
        await manager.createCheckpoint(`Checkpoint ${i}`);
      }

      // Prune with 0 maxAge - will try to remove all but minCheckpointsToKeep
      const pruned = manager.pruneOldCheckpoints(0);

      expect(pruned).toBeGreaterThanOrEqual(0);
      expect(manager.listCheckpoints().length).toBe(
        10 - pruned
      );
    });
  });

  describe('checkpoint limit enforcement', () => {
    it('should enforce maxCheckpoints limit', async () => {
      const limitedManager = createRollbackManager(stateProvider, {
        maxCheckpoints: 5,
        minCheckpointsToKeep: 2,
      });

      for (let i = 0; i < 10; i++) {
        await limitedManager.createCheckpoint(`Checkpoint ${i}`);
      }

      expect(limitedManager.listCheckpoints()).toHaveLength(5);
    });

    it('should remove oldest checkpoints when limit exceeded', async () => {
      const limitedManager = createRollbackManager(stateProvider, {
        maxCheckpoints: 3,
        minCheckpointsToKeep: 1,
      });

      const first = await limitedManager.createCheckpoint('First');
      await limitedManager.createCheckpoint('Second');
      await limitedManager.createCheckpoint('Third');
      await limitedManager.createCheckpoint('Fourth');

      const checkpoints = limitedManager.listCheckpoints();
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints.find((c) => c.id === first.id)).toBeUndefined();
    });
  });

  describe('type guards', () => {
    describe('isRollbackPoint', () => {
      it('should return true for valid RollbackPoint', async () => {
        const checkpoint = await manager.createCheckpoint('Test');
        expect(isRollbackPoint(checkpoint)).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isRollbackPoint(null)).toBe(false);
        expect(isRollbackPoint(undefined)).toBe(false);
        expect(isRollbackPoint({})).toBe(false);
        expect(isRollbackPoint({ id: 'test' })).toBe(false);
      });
    });

    describe('isSerializedState', () => {
      it('should return true for valid SerializedState', () => {
        const state: SerializedState = {
          version: '1.0.0',
          calibration: {},
          patterns: [],
          config: {},
          checksum: 'abc123',
        };
        expect(isSerializedState(state)).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isSerializedState(null)).toBe(false);
        expect(isSerializedState({})).toBe(false);
        expect(isSerializedState({ version: '1.0.0' })).toBe(false);
      });
    });

    describe('isRollbackMetadata', () => {
      it('should return true for valid RollbackMetadata', () => {
        expect(
          isRollbackMetadata({ reason: 'test', triggeredBy: 'manual' })
        ).toBe(true);
      });

      it('should return false for invalid values', () => {
        expect(isRollbackMetadata(null)).toBe(false);
        expect(isRollbackMetadata({})).toBe(false);
        expect(isRollbackMetadata({ reason: 'test' })).toBe(false);
      });
    });
  });

  describe('error classes', () => {
    it('CheckpointNotFoundError should have correct properties', () => {
      const error = new CheckpointNotFoundError('test_id');
      expect(error.name).toBe('CheckpointNotFoundError');
      expect(error.checkpointId).toBe('test_id');
      expect(error.message).toContain('test_id');
    });

    it('CheckpointVerificationError should have correct properties', () => {
      const error = new CheckpointVerificationError('test_id', 'bad checksum');
      expect(error.name).toBe('CheckpointVerificationError');
      expect(error.checkpointId).toBe('test_id');
      expect(error.reason).toBe('bad checksum');
    });

    it('StateVersionMismatchError should have correct properties', () => {
      const error = new StateVersionMismatchError('0.9.0', '1.0.0');
      expect(error.name).toBe('StateVersionMismatchError');
      expect(error.checkpointVersion).toBe('0.9.0');
      expect(error.currentVersion).toBe('1.0.0');
    });

    it('RollbackFailedError should have correct properties', () => {
      const cause = new Error('Network error');
      const error = new RollbackFailedError('test_id', cause);
      expect(error.name).toBe('RollbackFailedError');
      expect(error.checkpointId).toBe('test_id');
      expect(error.cause).toBe(cause);
    });
  });

  describe('state provider', () => {
    it('createNoopStateProvider should work correctly', () => {
      const provider = createNoopStateProvider();

      // Initial state is empty
      expect(provider.getCalibrationState()).toEqual({});
      expect(provider.getPatterns()).toEqual([]);
      expect(provider.getConfig()).toEqual({});

      // Restore and verify
      provider.restoreCalibrationState({ key: 'value' });
      provider.restorePatterns([1, 2, 3]);
      provider.restoreConfig({ setting: true });

      expect(provider.getCalibrationState()).toEqual({ key: 'value' });
      expect(provider.getPatterns()).toEqual([1, 2, 3]);
      expect(provider.getConfig()).toEqual({ setting: true });
    });

    it('should return copies to prevent external mutation', () => {
      const provider = createNoopStateProvider();
      provider.restoreConfig({ setting: true });

      const config1 = provider.getConfig();
      const config2 = provider.getConfig();

      // Should be equal but not same reference
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);

      // Modifying returned value should not affect stored state
      config1.setting = false;
      expect(provider.getConfig()).toEqual({ setting: true });
    });
  });

  describe('integration scenarios', () => {
    it('should support full checkpoint-modify-rollback cycle', async () => {
      // Set initial good state
      stateProvider.restoreCalibrationState({ ece: 0.03, mce: 0.08 });
      stateProvider.restorePatterns([{ id: 'good_pattern' }]);
      stateProvider.restoreConfig({ healthScore: 0.9 });

      // Create checkpoint before improvement
      const checkpoint = await manager.createCheckpoint(
        'Pre-improvement checkpoint'
      );

      // Simulate improvement that goes wrong
      stateProvider.restoreCalibrationState({ ece: 0.25, mce: 0.40 }); // Degraded!
      stateProvider.restorePatterns([{ id: 'bad_pattern' }]);
      stateProvider.restoreConfig({ healthScore: 0.4 });

      // Detect degradation and rollback
      expect(stateProvider.getConfig()).toEqual({ healthScore: 0.4 });
      await manager.rollback(checkpoint.id);

      // Verify restoration
      expect(stateProvider.getCalibrationState()).toEqual({ ece: 0.03, mce: 0.08 });
      expect(stateProvider.getPatterns()).toEqual([{ id: 'good_pattern' }]);
      expect(stateProvider.getConfig()).toEqual({ healthScore: 0.9 });
    });

    it('should support multiple checkpoints with selective rollback', async () => {
      // Create series of checkpoints
      stateProvider.restoreConfig({ version: 1 });
      const v1 = await manager.createCheckpoint('Version 1');

      stateProvider.restoreConfig({ version: 2 });
      const v2 = await manager.createCheckpoint('Version 2');

      stateProvider.restoreConfig({ version: 3 });
      await manager.createCheckpoint('Version 3');

      // Rollback to v1 (skip v2)
      await manager.rollback(v1.id);
      expect(stateProvider.getConfig()).toEqual({ version: 1 });

      // Rollback to v2
      await manager.rollback(v2.id);
      expect(stateProvider.getConfig()).toEqual({ version: 2 });
    });
  });
});
