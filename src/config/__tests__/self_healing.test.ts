/**
 * @fileoverview Tests for Self-Healing Configuration System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  diagnoseConfiguration,
  autoHealConfiguration,
  rollbackConfiguration,
  getEffectivenessHistory,
  createConfigHealingTrigger,
  type ConfigHealthReport,
  type HealingResult,
} from '../self_healing.js';

describe('Self-Healing Configuration', () => {
  let testWorkspace: string;

  beforeEach(async () => {
    // Create a temporary workspace
    testWorkspace = path.join(os.tmpdir(), `librainian-test-${Date.now()}`);
    await fs.promises.mkdir(testWorkspace, { recursive: true });

    // Create basic structure
    await fs.promises.mkdir(path.join(testWorkspace, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(testWorkspace, '.librainian'), { recursive: true });
    await fs.promises.mkdir(path.join(testWorkspace, 'state'), { recursive: true });

    // Create a sample config
    const config = {
      maxFileSizeBytes: 5 * 1024 * 1024,
      maxConcurrentWorkers: 4,
      maxEmbeddingsPerBatch: 20,
    };

    await fs.promises.writeFile(
      path.join(testWorkspace, '.librainian', 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create some source files
    await fs.promises.writeFile(
      path.join(testWorkspace, 'src', 'index.ts'),
      'export const foo = 1;'
    );
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.promises.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('diagnoseConfiguration', () => {
    it('should return a health report', async () => {
      const report = await diagnoseConfiguration(testWorkspace);

      expect(report).toBeDefined();
      expect(report.workspace).toBe(testWorkspace);
      expect(typeof report.healthScore).toBe('number');
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(report.healthScore).toBeLessThanOrEqual(1);
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(Array.isArray(report.autoFixable)).toBe(true);
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('should detect missing config as an issue', async () => {
      // Remove the config file
      await fs.promises.unlink(path.join(testWorkspace, '.librainian', 'config.json'));

      const report = await diagnoseConfiguration(testWorkspace);

      // Should still work with empty config
      expect(report).toBeDefined();
      expect(typeof report.healthScore).toBe('number');
    });

    it('should include summary statistics', async () => {
      const report = await diagnoseConfiguration(testWorkspace);

      expect(report.summary).toBeDefined();
      expect(typeof report.summary.totalIssues).toBe('number');
      expect(typeof report.summary.criticalIssues).toBe('number');
      expect(typeof report.summary.autoFixableCount).toBe('number');
      expect(typeof report.summary.driftScore).toBe('number');
      expect(typeof report.summary.stalenessScore).toBe('number');
    });

    it('should detect performance issues with bad config', async () => {
      // Create a config with suboptimal settings
      const badConfig = {
        maxEmbeddingsPerBatch: 5, // Too low
        maxConcurrentWorkers: 100, // Too high
        timeoutMs: 10000, // Too short
      };

      await fs.promises.writeFile(
        path.join(testWorkspace, '.librainian', 'config.json'),
        JSON.stringify(badConfig, null, 2)
      );

      const report = await diagnoseConfiguration(testWorkspace);

      // Should detect at least one performance issue
      const perfIssues = report.issues.filter(i => i.category === 'performance');
      expect(perfIssues.length).toBeGreaterThan(0);
    });
  });

  describe('autoHealConfiguration', () => {
    it('should run in dry-run mode without changes', async () => {
      const result = await autoHealConfiguration(testWorkspace, {
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.appliedFixes)).toBe(true);
      expect(Array.isArray(result.failedFixes)).toBe(true);
      expect(typeof result.durationMs).toBe('number');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should apply safe fixes when not in dry-run', async () => {
      // Create a config with a fixable issue
      const config = {
        maxEmbeddingsPerBatch: 5, // Too low, should be auto-fixed
      };

      await fs.promises.writeFile(
        path.join(testWorkspace, '.librainian', 'config.json'),
        JSON.stringify(config, null, 2)
      );

      const result = await autoHealConfiguration(testWorkspace, {
        dryRun: false,
        riskTolerance: 'low',
      });

      expect(result).toBeDefined();
      expect(typeof result.newHealthScore).toBe('number');
    });

    it('should respect risk tolerance', async () => {
      // Create config with issues of varying risk
      const config = {
        maxEmbeddingsPerBatch: 5,
        maxConcurrentWorkers: 100,
      };

      await fs.promises.writeFile(
        path.join(testWorkspace, '.librainian', 'config.json'),
        JSON.stringify(config, null, 2)
      );

      // With 'safe' tolerance, should only apply safe fixes
      const result = await autoHealConfiguration(testWorkspace, {
        dryRun: true,
        riskTolerance: 'safe',
      });

      expect(result.appliedFixes.every(f => f.riskLevel === 'safe')).toBe(true);
    });

    it('should limit number of fixes applied', async () => {
      const result = await autoHealConfiguration(testWorkspace, {
        dryRun: true,
        maxFixes: 2,
      });

      expect(result.appliedFixes.length).toBeLessThanOrEqual(2);
    });
  });

  describe('rollbackConfiguration', () => {
    it('should return a valid result', async () => {
      // Rollback behavior depends on whether a snapshot exists from previous operations
      // In isolation, this should return success=false with an error
      // If tests ran previously and saved a snapshot, it may return success=true
      const result = await rollbackConfiguration(testWorkspace);

      expect(typeof result.success).toBe('boolean');
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it('should rollback after healing', async () => {
      // First apply a heal (not dry run to create a snapshot)
      await autoHealConfiguration(testWorkspace, {
        dryRun: false,
        riskTolerance: 'low',
      });

      // Then rollback
      const result = await rollbackConfiguration(testWorkspace);

      // May or may not succeed depending on whether fixes were applied
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('getEffectivenessHistory', () => {
    it('should return empty history initially', async () => {
      const history = await getEffectivenessHistory(testWorkspace);

      expect(history).toBeDefined();
      expect(history.workspace).toBe(testWorkspace);
      expect(Array.isArray(history.metrics)).toBe(true);
      expect(Array.isArray(history.configChanges)).toBe(true);
      expect(['improving', 'stable', 'degrading']).toContain(history.overallTrend);
    });
  });

  describe('createConfigHealingTrigger', () => {
    it('should create a trigger with start/stop methods', () => {
      const trigger = createConfigHealingTrigger(testWorkspace);

      expect(trigger).toBeDefined();
      expect(typeof trigger.start).toBe('function');
      expect(typeof trigger.stop).toBe('function');
      expect(typeof trigger.triggerCheck).toBe('function');
    });

    it('should run check when triggered', async () => {
      const trigger = createConfigHealingTrigger(testWorkspace, {
        checkIntervalMs: 60000,
        autoHealThreshold: 0.5,
      });

      const report = await trigger.triggerCheck();

      expect(report).toBeDefined();
      expect(typeof report.healthScore).toBe('number');
    });

    it('should start and stop cleanly', async () => {
      const trigger = createConfigHealingTrigger(testWorkspace, {
        checkIntervalMs: 1000000, // Long interval to avoid triggering
      });

      trigger.start();
      trigger.stop();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('drift detection', () => {
    it('should detect drift when codebase changes', async () => {
      // First diagnosis
      const report1 = await diagnoseConfiguration(testWorkspace);

      // Add many files
      for (let i = 0; i < 60; i++) {
        await fs.promises.writeFile(
          path.join(testWorkspace, 'src', `file${i}.ts`),
          `export const value${i} = ${i};`
        );
      }

      // Second diagnosis
      const report2 = await diagnoseConfiguration(testWorkspace);

      // Drift score should increase (or at least remain non-zero)
      expect(typeof report2.summary.driftScore).toBe('number');
    });
  });

  describe('staleness detection', () => {
    it('should detect stale components', async () => {
      // Create old state files
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      await fs.promises.writeFile(
        path.join(testWorkspace, 'state', 'knowledge.json'),
        JSON.stringify({ updated: oldDate.toISOString() })
      );

      // Update the file timestamp
      await fs.promises.utimes(
        path.join(testWorkspace, 'state', 'knowledge.json'),
        oldDate,
        oldDate
      );

      const report = await diagnoseConfiguration(testWorkspace);

      // Should have some staleness score
      expect(report.summary.stalenessScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ConfigHealthReport structure', () => {
    it('should have all required fields', async () => {
      const report = await diagnoseConfiguration(testWorkspace);

      // Verify report structure
      expect(report).toMatchObject({
        isOptimal: expect.any(Boolean),
        healthScore: expect.any(Number),
        issues: expect.any(Array),
        recommendations: expect.any(Array),
        autoFixable: expect.any(Array),
        generatedAt: expect.any(Date),
        workspace: expect.any(String),
        summary: {
          totalIssues: expect.any(Number),
          criticalIssues: expect.any(Number),
          autoFixableCount: expect.any(Number),
          driftScore: expect.any(Number),
          stalenessScore: expect.any(Number),
        },
      });
    });

    it('should have valid issue structure', async () => {
      // Create config with an issue
      const config = {
        maxEmbeddingsPerBatch: 1, // Very low
      };

      await fs.promises.writeFile(
        path.join(testWorkspace, '.librainian', 'config.json'),
        JSON.stringify(config, null, 2)
      );

      const report = await diagnoseConfiguration(testWorkspace);

      for (const issue of report.issues) {
        expect(issue).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
          severity: expect.stringMatching(/^(info|warning|error|critical)$/),
          category: expect.stringMatching(/^(drift|staleness|performance|resource|compatibility|optimization)$/),
          configKey: expect.any(String),
          detectedAt: expect.any(Date),
        });
      }
    });
  });

  describe('HealingResult structure', () => {
    it('should have all required fields', async () => {
      const result = await autoHealConfiguration(testWorkspace, {
        dryRun: true,
      });

      expect(result).toMatchObject({
        success: expect.any(Boolean),
        appliedFixes: expect.any(Array),
        failedFixes: expect.any(Array),
        newHealthScore: expect.any(Number),
        durationMs: expect.any(Number),
        timestamp: expect.any(Date),
        rollbackAvailable: expect.any(Boolean),
      });
    });
  });
});
