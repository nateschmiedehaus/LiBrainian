/**
 * @fileoverview Tests for Defeater Calculus Engine
 *
 * Tests cover:
 * - Defeater detection (staleness, code changes, test failures)
 * - Contradiction detection
 * - Defeater application and confidence reduction
 * - Resolution actions
 * - Graph health assessment
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectDefeaters,
  applyDefeaters,
  getResolutionActions,
  resolveDefeater,
  assessGraphHealth,
  runDefeaterCycle,
  DEFAULT_DEFEATER_CONFIG,
  type DefeaterEngineConfig,
} from '../defeaters.js';
import { createEvidenceGraphStorage, type EvidenceGraphStorage } from '../storage.js';
import {
  createClaim,
  createClaimId,
  createDefeater,
  type Claim,
} from '../types.js';
import { deterministic } from '../confidence.js';

describe('Defeater Calculus Engine', () => {
  let storage: EvidenceGraphStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'librainian-defeater-test-' + Date.now());
  const workspace = '/test/workspace';

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}.db`);
    storage = createEvidenceGraphStorage(dbPath, workspace);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
        unlinkSync(dbPath + '-wal');
        unlinkSync(dbPath + '-shm');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  const createTestClaim = (
    id: string,
    proposition: string,
    options: Partial<{
      file: string;
      createdAt: string;
      sourceType: 'llm' | 'test' | 'static_analysis';
      sourceId: string;
    }> = {}
  ): Claim =>
    createClaim({
      id,
      proposition,
      type: 'semantic',
      subject: {
        type: 'function',
        id: id,
        name: id,
        location: options.file ? { file: options.file, startLine: 1, endLine: 10 } : undefined,
      },
      source: {
        type: options.sourceType ?? 'llm',
        id: options.sourceId ?? 'test-model',
      },
      confidence: deterministic(true, 'test_claim'),
      signalStrength: {
        retrieval: 0.8,
        structural: 0.9,
        semantic: 0.7,
        testExecution: 0.6,
        recency: 0.95,
      },
    });

  describe('Staleness Detection', () => {
    it('should detect stale claims', async () => {
      // Create claim with old timestamp
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 14); // 14 days ago

      const claim = {
        ...createTestClaim('old-claim', 'Old claim'),
        createdAt: oldDate.toISOString(),
      };
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        timestamp: new Date().toISOString(),
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].type).toBe('staleness');
      expect(result.defeaters[0].affectedClaimIds).toContain('old-claim');
    });

    it('should not flag recent claims as stale', async () => {
      const claim = createTestClaim('fresh-claim', 'Fresh claim');
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        timestamp: new Date().toISOString(),
      });

      expect(result.defeaters.length).toBe(0);
    });

    it('should increase severity for very old claims', async () => {
      const veryOldDate = new Date();
      veryOldDate.setDate(veryOldDate.getDate() - 30); // 30 days ago

      const claim = {
        ...createTestClaim('very-old-claim', 'Very old claim'),
        createdAt: veryOldDate.toISOString(),
      };
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        timestamp: new Date().toISOString(),
      });

      expect(result.defeaters[0].severity).toBe('partial');
    });
  });

  describe('Code Change Detection', () => {
    it('should detect claims affected by file changes', async () => {
      const claim = createTestClaim('file-claim', 'Claim about file', {
        file: 'src/module.ts',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        changedFiles: ['src/module.ts'],
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].type).toBe('code_change');
      expect(result.defeaters[0].affectedClaimIds).toContain('file-claim');
    });

    it('should not flag claims about unchanged files', async () => {
      const claim = createTestClaim('other-claim', 'Claim about other file', {
        file: 'src/other.ts',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        changedFiles: ['src/module.ts'],
      });

      expect(result.defeaters.length).toBe(0);
    });

    it('should group multiple affected claims per file', async () => {
      const claim1 = createTestClaim('claim1', 'First claim', { file: 'src/shared.ts' });
      const claim2 = createTestClaim('claim2', 'Second claim', { file: 'src/shared.ts' });
      await storage.upsertClaims([claim1, claim2]);

      const result = await detectDefeaters(storage, {
        changedFiles: ['src/shared.ts'],
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].affectedClaimIds.length).toBe(2);
    });
  });

  describe('Test Failure Detection', () => {
    it('should detect claims affected by test failures', async () => {
      const claim = createTestClaim('test-claim', 'Claim from test', {
        sourceType: 'test',
        sourceId: 'test-suite-1',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        failedTests: ['test-suite-1'],
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].type).toBe('test_failure');
      expect(result.defeaters[0].severity).toBe('full');
    });

    it('should not flag claims from passing tests', async () => {
      const claim = createTestClaim('passing-claim', 'Claim from passing test', {
        sourceType: 'test',
        sourceId: 'passing-suite',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        failedTests: ['failing-suite'],
      });

      expect(result.defeaters.length).toBe(0);
    });
  });

  describe('Contradiction Detection', () => {
    it('should detect direct contradictions', async () => {
      const existingClaim = createTestClaim('existing', 'Function X always returns true');
      await storage.upsertClaim(existingClaim);

      const newClaim = {
        ...createTestClaim('new', 'Function X never returns true'),
        subject: existingClaim.subject, // Same subject
      };

      const result = await detectDefeaters(storage, {
        newClaims: [newClaim],
      });

      expect(result.contradictions.length).toBe(1);
      expect(result.contradictions[0].type).toBe('direct');
      expect(result.contradictions[0].severity).toBe('blocking');
    });

    it('should not flag non-contradicting claims', async () => {
      const existingClaim = createTestClaim('existing', 'Function X returns a number');
      await storage.upsertClaim(existingClaim);

      const newClaim = createTestClaim('new', 'Function Y returns a string');

      const result = await detectDefeaters(storage, {
        newClaims: [newClaim],
      });

      expect(result.contradictions.length).toBe(0);
    });
  });

  describe('Hash Mismatch Detection', () => {
    it('should create defeaters for hash mismatches', async () => {
      const claim = createTestClaim('hashed-claim', 'Claim with hash');
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        hashMismatches: [
          {
            claimId: createClaimId('hashed-claim'),
            expected: 'abc123',
            actual: 'def456',
          },
        ],
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].type).toBe('hash_mismatch');
      expect(result.defeaters[0].severity).toBe('full');
    });
  });

  describe('Provider Unavailability Detection', () => {
    it('should detect claims affected by unavailable providers', async () => {
      const claim = createTestClaim('llm-claim', 'Claim from Claude', {
        sourceType: 'llm',
        sourceId: 'claude-haiku',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        providerStatus: { claude: false },
      });

      expect(result.defeaters.length).toBe(1);
      expect(result.defeaters[0].type).toBe('provider_unavailable');
      expect(result.defeaters[0].severity).toBe('warning');
    });

    it('should not flag claims when provider is available', async () => {
      const claim = createTestClaim('llm-claim', 'Claim from Claude', {
        sourceType: 'llm',
        sourceId: 'claude-haiku',
      });
      await storage.upsertClaim(claim);

      const result = await detectDefeaters(storage, {
        providerStatus: { claude: true },
      });

      expect(result.defeaters.length).toBe(0);
    });
  });

  describe('Defeater Application', () => {
    it('should store and activate defeaters', async () => {
      const claim = createTestClaim('target-claim', 'Target claim', {
        file: 'src/target.ts',
      });
      await storage.upsertClaim(claim);

      const detection = await detectDefeaters(storage, {
        changedFiles: ['src/target.ts'],
      });

      const result = await applyDefeaters(storage, detection);

      expect(result.activatedDefeaters.length).toBe(1);
      expect(result.updatedClaims).toContain('target-claim');

      // Verify defeater was stored
      const storedDefeater = await storage.getDefeater(result.activatedDefeaters[0]);
      expect(storedDefeater).not.toBeNull();
      expect(storedDefeater!.status).toBe('active');
    });

    it('should reduce signal strength based on defeater type', async () => {
      const claim = createTestClaim('confidence-claim', 'Signal strength test', {
        file: 'src/conf.ts',
      });
      await storage.upsertClaim(claim);

      const originalClaim = await storage.getClaim(claim.id);
      const originalSignalStrength = originalClaim!.signalStrength.overall;

      const detection = await detectDefeaters(storage, {
        changedFiles: ['src/conf.ts'],
      });

      await applyDefeaters(storage, detection);

      const updatedClaim = await storage.getClaim(claim.id);
      expect(updatedClaim!.signalStrength.overall).toBeLessThan(originalSignalStrength);
    });

    it('should mark claims as defeated when confidence is too low', async () => {
      const claim = createTestClaim('low-conf-claim', 'Low confidence test', {
        sourceType: 'test',
        sourceId: 'failing-test',
      });
      await storage.upsertClaim(claim);

      const detection = await detectDefeaters(storage, {
        failedTests: ['failing-test'],
      });

      await applyDefeaters(storage, detection);

      const updatedClaim = await storage.getClaim(claim.id);
      expect(updatedClaim!.status).toBe('defeated');
    });

    it('should record contradictions and mark both claims', async () => {
      const existingClaim = createTestClaim('claim-a', 'Function always works');
      await storage.upsertClaim(existingClaim);

      const newClaim = {
        ...createTestClaim('claim-b', 'Function never works'),
        subject: existingClaim.subject,
      };

      const detection = await detectDefeaters(storage, {
        newClaims: [newClaim],
      });

      // Store the new claim first
      await storage.upsertClaim(newClaim);

      const result = await applyDefeaters(storage, detection);

      expect(result.recordedContradictions.length).toBe(1);

      const claimA = await storage.getClaim(existingClaim.id);
      const claimB = await storage.getClaim(newClaim.id);
      expect(claimA!.status).toBe('contradicted');
      expect(claimB!.status).toBe('contradicted');
    });
  });

  describe('Resolution Actions', () => {
    it('should prioritize critical defeaters', async () => {
      const claim1 = createTestClaim('critical-claim', 'Critical', {
        sourceType: 'test',
        sourceId: 'critical-test',
      });
      const claim2 = createTestClaim('warning-claim', 'Warning', {
        file: 'src/warning.ts',
      });
      await storage.upsertClaims([claim1, claim2]);

      // Create test failure (full severity)
      const detection1 = await detectDefeaters(storage, {
        failedTests: ['critical-test'],
      });
      await applyDefeaters(storage, detection1);

      // Create code change (partial severity)
      const detection2 = await detectDefeaters(storage, {
        changedFiles: ['src/warning.ts'],
      });
      await applyDefeaters(storage, detection2);

      const actions = await getResolutionActions(storage);

      expect(actions.length).toBe(2);
      // Critical (test failure) should have higher priority
      expect(actions[0].defeater.type).toBe('test_failure');
    });

    it('should resolve defeaters and restore claims', async () => {
      // Use test failure which has 'full' severity and defeats the claim
      const claim = createTestClaim('resolvable-claim', 'Resolvable', {
        sourceType: 'test',
        sourceId: 'resolvable-test',
      });
      await storage.upsertClaim(claim);

      const detection = await detectDefeaters(storage, {
        failedTests: ['resolvable-test'],
      });
      const application = await applyDefeaters(storage, detection);

      // Verify claim was defeated
      const defeatedClaim = await storage.getClaim(claim.id);
      expect(defeatedClaim!.status).toBe('defeated');

      const defeaterId = application.activatedDefeaters[0];
      await resolveDefeater(storage, defeaterId, 'revalidate');

      const resolvedDefeater = await storage.getDefeater(defeaterId);
      expect(resolvedDefeater!.status).toBe('resolved');

      // Claim should be marked as stale (needs revalidation)
      const updatedClaim = await storage.getClaim(claim.id);
      expect(updatedClaim!.status).toBe('stale');
    });
  });

  describe('Graph Health Assessment', () => {
    it('should report healthy graph with no issues', async () => {
      const claim = createTestClaim('healthy-claim', 'Healthy claim');
      await storage.upsertClaim(claim);

      const health = await assessGraphHealth(storage);

      expect(health.overallHealth).toBeGreaterThan(0.5);
      expect(health.activeClaimCount).toBe(1);
      expect(health.activeDefeaterCount).toBe(0);
      expect(health.unresolvedContradictionCount).toBe(0);
    });

    it('should reduce health score with active defeaters', async () => {
      const claim = createTestClaim('affected-claim', 'Affected', {
        file: 'src/affected.ts',
      });
      await storage.upsertClaim(claim);

      // Baseline health
      const baselineHealth = await assessGraphHealth(storage);

      // Add defeater
      const detection = await detectDefeaters(storage, {
        changedFiles: ['src/affected.ts'],
      });
      await applyDefeaters(storage, detection);

      const health = await assessGraphHealth(storage);

      expect(health.overallHealth).toBeLessThan(baselineHealth.overallHealth);
      expect(health.activeDefeaterCount).toBe(1);
    });

    it('should include recommendations', async () => {
      // Create claims that will be defeated by test failures (full severity)
      for (let i = 0; i < 3; i++) {
        const claim = createTestClaim(`test-claim-${i}`, `Test claim ${i}`, {
          sourceType: 'test',
          sourceId: `failing-test-${i}`,
        });
        await storage.upsertClaim(claim);
      }

      // Detect test failures which have 'full' severity
      const detection = await detectDefeaters(storage, {
        failedTests: ['failing-test-0', 'failing-test-1', 'failing-test-2'],
      });
      await applyDefeaters(storage, detection);

      const health = await assessGraphHealth(storage);

      expect(health.topIssues.length).toBeGreaterThan(0);
      expect(health.recommendations.length).toBeGreaterThan(0);
      expect(health.activeDefeaterCount).toBe(3);
    });
  });

  describe('Full Cycle', () => {
    it('should run complete detection-application-assessment cycle', async () => {
      // Setup claims
      const claims = [
        createTestClaim('claim-1', 'Claim 1', { file: 'src/a.ts' }),
        createTestClaim('claim-2', 'Claim 2', { sourceType: 'test', sourceId: 'test-1' }),
        {
          ...createTestClaim('claim-3', 'Old claim'),
          createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];
      await storage.upsertClaims(claims);

      const result = await runDefeaterCycle(storage, {
        changedFiles: ['src/a.ts'],
        failedTests: ['test-1'],
        timestamp: new Date().toISOString(),
      });

      // Should detect multiple defeater types
      expect(result.detection.defeaters.length).toBeGreaterThan(0);

      // Should apply defeaters
      expect(result.application.activatedDefeaters.length).toBeGreaterThan(0);

      // Should assess health
      expect(result.health).toBeDefined();
      expect(result.health.activeDefeaterCount).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    it('should respect custom staleness threshold', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 3); // 3 days ago

      const claim = {
        ...createTestClaim('custom-stale', 'Custom stale'),
        createdAt: oldDate.toISOString(),
      };
      await storage.upsertClaim(claim);

      // Default config (7 days) should not flag as stale
      const defaultResult = await detectDefeaters(storage, {
        timestamp: new Date().toISOString(),
      });
      expect(defaultResult.defeaters.length).toBe(0);

      // Custom config (1 day) should flag as stale
      const customConfig: DefeaterEngineConfig = {
        ...DEFAULT_DEFEATER_CONFIG,
        stalenessThresholdMs: 1 * 24 * 60 * 60 * 1000, // 1 day
      };
      const customResult = await detectDefeaters(storage, {
        timestamp: new Date().toISOString(),
      }, customConfig);
      expect(customResult.defeaters.length).toBe(1);
    });

    it('should respect batch size limit', async () => {
      // Create many claims affected by file change
      for (let i = 0; i < 150; i++) {
        const claim = createTestClaim(`batch-${i}`, `Claim ${i}`, {
          file: 'src/batch.ts',
        });
        await storage.upsertClaim(claim);
      }

      const detection = await detectDefeaters(storage, {
        changedFiles: ['src/batch.ts'],
      });

      // All affected claims in one defeater
      expect(detection.defeaters[0].affectedClaimIds.length).toBe(150);

      // But application should respect batch size
      const config: DefeaterEngineConfig = {
        ...DEFAULT_DEFEATER_CONFIG,
        maxBatchSize: 50,
      };

      // Create many separate defeaters for testing
      const manyDefeaters = Array.from({ length: 100 }, (_, i) =>
        createDefeater({
          type: 'staleness',
          description: `Defeater ${i}`,
          severity: 'warning',
          affectedClaimIds: [createClaimId(`batch-${i}`)],
          confidenceReduction: 0.1,
          autoResolvable: true,
        })
      );

      const result = await applyDefeaters(storage, {
        defeaters: manyDefeaters,
        contradictions: [],
        affectedClaimIds: [],
      }, config);

      // Should only process maxBatchSize defeaters
      expect(result.activatedDefeaters.length).toBe(50);
    });
  });
});
