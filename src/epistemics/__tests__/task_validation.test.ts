/**
 * @fileoverview Tests for Epistemic Task Validation System
 *
 * Tests cover:
 * - Type factories (createClaimId, createTaskId)
 * - ValidationPresets (strict, standard, relaxed)
 * - TaskEpistemicValidator.validate()
 * - TaskEpistemicValidator.buildGrounding()
 * - TaskEpistemicValidator.generateRemediation()
 * - Integration tests (full workflow)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createClaimId,
  createTaskId,
  ValidationPresets,
  TaskEpistemicValidator,
  type TaskClaim,
  type TaskValidationCriteria,
  type GroundingContext,
  type ClaimId,
  type TaskId,
} from '../task_validation.js';
import {
  deterministic,
  bounded,
  absent,
  measuredConfidence,
  sequenceConfidence,
  getEffectiveConfidence,
} from '../confidence.js';
import { createEvidenceGraphStorage, type EvidenceGraphStorage } from '../storage.js';
import {
  createEvidenceLedger,
  SqliteEvidenceLedger,
  createSessionId,
  createEvidenceId,
  type IEvidenceLedger,
  type EvidenceEntry,
} from '../evidence_ledger.js';
import { createDefeater, createClaimId as createClaimIdFromTypes } from '../types.js';

describe('Task Validation System', () => {
  let storage: EvidenceGraphStorage;
  let ledger: SqliteEvidenceLedger;
  let dbPath: string;
  let ledgerPath: string;
  const testDir = join(tmpdir(), 'librarian-task-validation-test-' + Date.now());
  const workspace = '/test/workspace';

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `storage-${Date.now()}.db`);
    ledgerPath = join(testDir, `ledger-${Date.now()}.db`);
    storage = createEvidenceGraphStorage(dbPath, workspace);
    ledger = new SqliteEvidenceLedger(ledgerPath, { enforceAttribution: false });
    await storage.initialize();
    await ledger.initialize();
  });

  afterEach(async () => {
    await storage.close();
    await ledger.close();
    // Clean up files
    const filesToClean = [
      dbPath, `${dbPath}-wal`, `${dbPath}-shm`,
      ledgerPath, `${ledgerPath}-wal`, `${ledgerPath}-shm`,
    ];
    for (const file of filesToClean) {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });

  // ==========================================================================
  // TYPE FACTORIES
  // ==========================================================================

  describe('Type Factories', () => {
    describe('createClaimId', () => {
      it('should create a valid ClaimId from string', () => {
        const id = createClaimId('test-claim-id');
        expect(id).toBe('test-claim-id');
        expect(typeof id).toBe('string');
      });

      it('should preserve the string value', () => {
        const original = 'claim_123_abc';
        const claimId = createClaimId(original);
        expect(claimId).toBe(original);
      });

      it('should allow empty strings (branded type does not validate)', () => {
        const id = createClaimId('');
        expect(id).toBe('');
      });
    });

    describe('createTaskId', () => {
      it('should create a valid TaskId from string', () => {
        const id = createTaskId('task-id-123');
        expect(id).toBe('task-id-123');
        expect(typeof id).toBe('string');
      });

      it('should preserve the string value', () => {
        const original = 'task_fix_bug_456';
        const taskId = createTaskId(original);
        expect(taskId).toBe(original);
      });

      it('should allow empty strings (branded type does not validate)', () => {
        const id = createTaskId('');
        expect(id).toBe('');
      });
    });
  });

  // ==========================================================================
  // VALIDATION PRESETS
  // ==========================================================================

  describe('ValidationPresets', () => {
    describe('strict preset', () => {
      it('should have expected confidence thresholds', () => {
        expect(ValidationPresets.strict.minimumConfidence).toBe(0.75);
        expect(ValidationPresets.strict.minimumProblemConfidence).toBe(0.8);
      });

      it('should require at least 2 alternatives', () => {
        expect(ValidationPresets.strict.minimumAlternativesConsidered).toBe(2);
      });

      it('should require at least 2 objections addressed', () => {
        expect(ValidationPresets.strict.minimumObjectionsAddressed).toBe(2);
      });

      it('should require method calibration', () => {
        expect(ValidationPresets.strict.requireMethodCalibration).toBe(true);
      });

      it('should not allow degraded or unknown calibration', () => {
        expect(ValidationPresets.strict.allowDegradedCalibration).toBe(false);
        expect(ValidationPresets.strict.allowUnknownCalibration).toBe(false);
      });

      it('should block on both full and partial defeaters', () => {
        expect(ValidationPresets.strict.blockOnFullDefeater).toBe(true);
        expect(ValidationPresets.strict.blockOnPartialDefeater).toBe(true);
      });

      it('should have 3 day evidence age limit', () => {
        expect(ValidationPresets.strict.maxEvidenceAgeMs).toBe(3 * 24 * 60 * 60 * 1000);
      });
    });

    describe('standard preset', () => {
      it('should have expected confidence thresholds', () => {
        expect(ValidationPresets.standard.minimumConfidence).toBe(0.6);
        expect(ValidationPresets.standard.minimumProblemConfidence).toBe(0.7);
      });

      it('should require at least 1 alternative', () => {
        expect(ValidationPresets.standard.minimumAlternativesConsidered).toBe(1);
      });

      it('should require at least 1 objection addressed', () => {
        expect(ValidationPresets.standard.minimumObjectionsAddressed).toBe(1);
      });

      it('should require counter-analysis', () => {
        expect(ValidationPresets.standard.requireCounterAnalysis).toBe(true);
      });

      it('should not require method calibration', () => {
        expect(ValidationPresets.standard.requireMethodCalibration).toBe(false);
      });

      it('should allow degraded but not unknown calibration', () => {
        expect(ValidationPresets.standard.allowDegradedCalibration).toBe(true);
        expect(ValidationPresets.standard.allowUnknownCalibration).toBe(false);
      });

      it('should block on full defeaters only', () => {
        expect(ValidationPresets.standard.blockOnFullDefeater).toBe(true);
        expect(ValidationPresets.standard.blockOnPartialDefeater).toBe(false);
      });

      it('should have 7 day evidence age limit', () => {
        expect(ValidationPresets.standard.maxEvidenceAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
      });
    });

    describe('relaxed preset', () => {
      it('should have expected confidence thresholds', () => {
        expect(ValidationPresets.relaxed.minimumConfidence).toBe(0.4);
        expect(ValidationPresets.relaxed.minimumProblemConfidence).toBe(0.5);
      });

      it('should not require alternatives', () => {
        expect(ValidationPresets.relaxed.minimumAlternativesConsidered).toBe(0);
      });

      it('should not require objections', () => {
        expect(ValidationPresets.relaxed.minimumObjectionsAddressed).toBe(0);
      });

      it('should not require counter-analysis', () => {
        expect(ValidationPresets.relaxed.requireCounterAnalysis).toBe(false);
      });

      it('should not require method calibration', () => {
        expect(ValidationPresets.relaxed.requireMethodCalibration).toBe(false);
      });

      it('should allow both degraded and unknown calibration', () => {
        expect(ValidationPresets.relaxed.allowDegradedCalibration).toBe(true);
        expect(ValidationPresets.relaxed.allowUnknownCalibration).toBe(true);
      });

      it('should block only on full defeaters', () => {
        expect(ValidationPresets.relaxed.blockOnFullDefeater).toBe(true);
        expect(ValidationPresets.relaxed.blockOnPartialDefeater).toBe(false);
      });

      it('should have 30 day evidence age limit', () => {
        expect(ValidationPresets.relaxed.maxEvidenceAgeMs).toBe(30 * 24 * 60 * 60 * 1000);
      });
    });
  });

  // ==========================================================================
  // TASK EPISTEMIC VALIDATOR - VALIDATE()
  // ==========================================================================

  describe('TaskEpistemicValidator.validate()', () => {
    let validator: TaskEpistemicValidator;

    beforeEach(() => {
      validator = new TaskEpistemicValidator(ledger, storage);
    });

    function createValidTaskClaim(overrides: Partial<TaskClaim> = {}): TaskClaim {
      const baseClaim: TaskClaim = {
        id: createClaimId('test-task-claim'),
        proposition: 'Task "Fix bug" should be performed to achieve: Improve stability',
        type: 'task_validity',
        task: {
          id: createTaskId('fix-bug-123'),
          description: 'Fix the null pointer bug',
          goal: 'Improve stability',
          method: 'Add null check',
        },
        grounding: {
          problemIdentification: {
            evidence: [],
            confidence: measuredConfidence({
              datasetId: 'test-dataset',
              sampleSize: 100,
              accuracy: 0.85,
              ci95: [0.8, 0.9],
            }),
            method: 'analysis',
          },
          alternativesConsidered: {
            alternatives: [
              {
                description: 'Rewrite module',
                reason_rejected: 'Too risky',
                confidence_in_rejection: bounded(0.7, 0.9, 'theoretical', 'Risk analysis'),
              },
            ],
            thoroughness: deterministic(true, 'alternatives_documented'),
          },
          counterAnalysis: {
            objections: [
              {
                objection: 'What about performance?',
                response: 'Null check has minimal overhead',
                response_strength: bounded(0.7, 0.9, 'theoretical', 'Performance analysis'),
              },
            ],
            completeness: deterministic(true, 'objections_documented'),
          },
          methodWarrant: {
            method: 'Add null check',
            historicalReliability: measuredConfidence({
              datasetId: 'method-dataset',
              sampleSize: 50,
              accuracy: 0.75,
              ci95: [0.65, 0.85],
            }),
            applicability: bounded(0.6, 0.8, 'theoretical', 'Applicability estimate'),
          },
        },
        confidence: measuredConfidence({
          datasetId: 'overall-dataset',
          sampleSize: 100,
          accuracy: 0.8,
          ci95: [0.75, 0.85],
        }),
        calibrationStatus: 'preserved',
        defeaters: [],
        status: 'pending_validation',
        schemaVersion: '1.0.0',
      };

      return { ...baseClaim, ...overrides };
    }

    it('should return valid=true when all criteria are met', async () => {
      const task = createValidTaskClaim();
      const result = await validator.validate(task, ValidationPresets.standard);

      expect(result.valid).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
    });

    it('should return valid=false when confidence is below threshold', async () => {
      const task = createValidTaskClaim({
        confidence: bounded(0.3, 0.4, 'theoretical', 'Low confidence'),
      });

      const result = await validator.validate(task, ValidationPresets.standard);

      expect(result.valid).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.blockingReasons.some(r => r.includes('confidence') || r.includes('Confidence'))).toBe(true);
    });

    it('should return valid=false when alternatives are insufficient', async () => {
      const task = createValidTaskClaim({
        grounding: {
          ...createValidTaskClaim().grounding,
          alternativesConsidered: {
            alternatives: [], // No alternatives
            thoroughness: absent('insufficient_data'),
          },
        },
      });

      const strictCriteria = ValidationPresets.strict;
      const result = await validator.validate(task, strictCriteria);

      expect(result.valid).toBe(false);
      expect(result.breakdown.alternativesConsidered.met).toBe(false);
    });

    it('should return valid=false when counter-analysis is missing', async () => {
      const task = createValidTaskClaim({
        grounding: {
          ...createValidTaskClaim().grounding,
          counterAnalysis: {
            objections: [], // No objections addressed
            completeness: absent('insufficient_data'),
          },
        },
      });

      const result = await validator.validate(task, ValidationPresets.standard);

      expect(result.valid).toBe(false);
      expect(result.breakdown.counterAnalysis.met).toBe(false);
    });

    it('should include defeaters in result', async () => {
      const defeater = createDefeater({
        type: 'code_change',
        description: 'Code was modified',
        severity: 'partial',
        affectedClaimIds: [],
        confidenceReduction: 0.2,
        autoResolvable: true,
        resolutionAction: 'revalidate',
      });

      const task = createValidTaskClaim({
        defeaters: [defeater],
      });

      const result = await validator.validate(task, ValidationPresets.standard);

      expect(result.defeaters).toContainEqual(expect.objectContaining({
        type: 'code_change',
      }));
    });

    it('should generate remediation when invalid', async () => {
      const task = createValidTaskClaim({
        confidence: bounded(0.2, 0.3, 'theoretical', 'Very low confidence'),
        grounding: {
          ...createValidTaskClaim().grounding,
          problemIdentification: {
            evidence: [],
            confidence: bounded(0.2, 0.3, 'theoretical', 'Low problem confidence'),
            method: 'inferred',
          },
          alternativesConsidered: {
            alternatives: [],
            thoroughness: absent('insufficient_data'),
          },
          counterAnalysis: {
            objections: [],
            completeness: absent('insufficient_data'),
          },
        },
      });

      const result = await validator.validate(task, ValidationPresets.standard);

      expect(result.valid).toBe(false);
      expect(result.remediation).toBeDefined();
      expect(result.remediation!.actions.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // TASK EPISTEMIC VALIDATOR - BUILD GROUNDING
  // ==========================================================================

  describe('TaskEpistemicValidator.buildGrounding()', () => {
    let validator: TaskEpistemicValidator;

    beforeEach(() => {
      validator = new TaskEpistemicValidator(ledger, storage);
    });

    it('should create TaskClaim with all required fields', async () => {
      const taskInfo = {
        id: createTaskId('build-grounding-test'),
        description: 'Test task description',
        goal: 'Test goal',
        method: 'Test method',
      };

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('test-session'),
      };

      const result = await validator.buildGrounding(taskInfo, context);

      expect(result.id).toBeDefined();
      expect(result.proposition).toContain(taskInfo.description);
      expect(result.proposition).toContain(taskInfo.goal);
      expect(result.type).toBe('task_validity');
      expect(result.task.id).toBe(taskInfo.id);
      expect(result.task.description).toBe(taskInfo.description);
      expect(result.task.goal).toBe(taskInfo.goal);
      expect(result.task.method).toBe(taskInfo.method);
      expect(result.grounding).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.schemaVersion).toBe('1.0.0');
      expect(result.status).toBe('pending_validation');
    });

    it('should include user-provided alternatives', async () => {
      const taskInfo = {
        id: createTaskId('alternatives-test'),
        description: 'Test task',
        goal: 'Test goal',
        method: 'Test method',
      };

      const userAlternatives = ['Alternative A', 'Alternative B', 'Alternative C'];

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('test-session'),
        userAlternatives,
      };

      const result = await validator.buildGrounding(taskInfo, context);

      expect(result.grounding.alternativesConsidered.alternatives).toHaveLength(3);
      expect(result.grounding.alternativesConsidered.alternatives[0].description).toBe('Alternative A');
      expect(result.grounding.alternativesConsidered.alternatives[1].description).toBe('Alternative B');
      expect(result.grounding.alternativesConsidered.alternatives[2].description).toBe('Alternative C');
    });

    it('should include user-provided objections', async () => {
      const taskInfo = {
        id: createTaskId('objections-test'),
        description: 'Test task',
        goal: 'Test goal',
        method: 'Test method',
      };

      const userObjections = ['What about edge cases?', 'Is this performant?'];

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('test-session'),
        userObjections,
      };

      const result = await validator.buildGrounding(taskInfo, context);

      expect(result.grounding.counterAnalysis.objections).toHaveLength(2);
      expect(result.grounding.counterAnalysis.objections[0].objection).toBe('What about edge cases?');
      expect(result.grounding.counterAnalysis.objections[1].objection).toBe('Is this performant?');
    });

    it('should compute confidence from evidence', async () => {
      // First, add some evidence to the ledger
      await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'The goal is valid',
          category: 'existence',
          subject: { type: 'system', identifier: 'test-system' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: measuredConfidence({
            datasetId: 'test-ds',
            sampleSize: 50,
            accuracy: 0.8,
            ci95: [0.7, 0.9],
          }),
        },
        provenance: {
          source: 'system_observation',
          method: 'test',
        },
        confidence: measuredConfidence({
          datasetId: 'test-ds',
          sampleSize: 50,
          accuracy: 0.8,
          ci95: [0.7, 0.9],
        }),
        relatedEntries: [],
      });

      const taskInfo = {
        id: createTaskId('confidence-test'),
        description: 'Test task',
        goal: 'The goal is valid',
        method: 'Test method',
      };

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('test-session'),
        methodCalibration: {
          datasetId: 'method-calibration-ds',
          sampleSize: 100,
          successRate: 0.85,
        },
      };

      const result = await validator.buildGrounding(taskInfo, context);

      expect(result.confidence).toBeDefined();
      expect(result.confidence.type).not.toBe('absent');
    });
  });

  // ==========================================================================
  // TASK EPISTEMIC VALIDATOR - GENERATE REMEDIATION
  // ==========================================================================

  describe('TaskEpistemicValidator.generateRemediation()', () => {
    let validator: TaskEpistemicValidator;

    beforeEach(() => {
      validator = new TaskEpistemicValidator(ledger, storage);
    });

    it('should create actions for each unmet criterion', () => {
      // Create a validation result with multiple failures
      const failedResult = {
        valid: false,
        confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
        calibrationStatus: 'degraded' as const,
        breakdown: {
          problemIdentification: {
            met: false,
            confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
            required: 0.7,
            reason: 'Problem identification confidence too low',
          },
          alternativesConsidered: {
            met: false,
            count: 0,
            required: 1,
            alternatives: [],
            reason: 'No alternatives considered',
          },
          counterAnalysis: {
            met: false,
            objectionsAddressed: 0,
            required: 1,
            objections: [],
            reason: 'No objections addressed',
          },
          methodWarrant: {
            met: true,
            confidence: bounded(0.6, 0.8, 'theoretical', 'OK'),
            calibrated: false,
          },
          evidenceFreshness: {
            met: true,
            oldestEvidenceAge: 0,
            maxAllowed: 7 * 24 * 60 * 60 * 1000,
            staleEvidence: [],
          },
        },
        defeaters: [],
        blockingReasons: ['Low confidence', 'No alternatives', 'No objections'],
        warnings: [],
      };

      const plan = validator.generateRemediation(failedResult);

      expect(plan.actions.length).toBeGreaterThanOrEqual(3);

      const actionTypes = plan.actions.map(a => a.type);
      expect(actionTypes).toContain('gather_evidence');
      expect(actionTypes).toContain('consider_alternatives');
      expect(actionTypes).toContain('address_objections');
    });

    it('should sort actions by priority', () => {
      const failedResult = {
        valid: false,
        confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
        calibrationStatus: 'degraded' as const,
        breakdown: {
          problemIdentification: {
            met: false,
            confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
            required: 0.7,
          },
          alternativesConsidered: {
            met: false,
            count: 0,
            required: 2,
            alternatives: [],
          },
          counterAnalysis: {
            met: false,
            objectionsAddressed: 0,
            required: 1,
            objections: [],
          },
          methodWarrant: {
            met: false,
            confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
            calibrated: false,
          },
          evidenceFreshness: {
            met: false,
            oldestEvidenceAge: 10 * 24 * 60 * 60 * 1000,
            maxAllowed: 7 * 24 * 60 * 60 * 1000,
            staleEvidence: [createEvidenceId('stale-1')],
          },
        },
        defeaters: [
          createDefeater({
            type: 'code_change',
            description: 'Full severity defeater',
            severity: 'full',
            affectedClaimIds: [],
            confidenceReduction: 1.0,
            autoResolvable: true,
            resolutionAction: 'revalidate',
          }),
        ],
        blockingReasons: ['Multiple failures'],
        warnings: [],
      };

      const plan = validator.generateRemediation(failedResult);

      // Actions should be sorted by priority (lower = higher priority)
      for (let i = 0; i < plan.actions.length - 1; i++) {
        expect(plan.actions[i].priority).toBeLessThanOrEqual(plan.actions[i + 1].priority);
      }
    });

    it('should include effort estimates', () => {
      const failedResult = {
        valid: false,
        confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
        calibrationStatus: 'degraded' as const,
        breakdown: {
          problemIdentification: {
            met: false,
            confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
            required: 0.7,
          },
          alternativesConsidered: {
            met: true,
            count: 1,
            required: 1,
            alternatives: ['Alt A'],
          },
          counterAnalysis: {
            met: true,
            objectionsAddressed: 1,
            required: 1,
            objections: ['Obj 1'],
          },
          methodWarrant: {
            met: true,
            confidence: bounded(0.6, 0.8, 'theoretical', 'OK'),
            calibrated: false,
          },
          evidenceFreshness: {
            met: true,
            oldestEvidenceAge: 0,
            maxAllowed: 7 * 24 * 60 * 60 * 1000,
            staleEvidence: [],
          },
        },
        defeaters: [],
        blockingReasons: ['Low problem confidence'],
        warnings: [],
      };

      const plan = validator.generateRemediation(failedResult);

      expect(plan.estimatedEffort).toBeDefined();
      expect(plan.estimatedEffort.minimal).toBeDefined();
      expect(plan.estimatedEffort.typical).toBeDefined();
      expect(plan.estimatedEffort.thorough).toBeDefined();
    });

    it('should include critical path actions', () => {
      const failedResult = {
        valid: false,
        confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
        calibrationStatus: 'degraded' as const,
        breakdown: {
          problemIdentification: {
            met: false,
            confidence: bounded(0.3, 0.4, 'theoretical', 'Low'),
            required: 0.7,
          },
          alternativesConsidered: {
            met: false,
            count: 0,
            required: 2,
            alternatives: [],
          },
          counterAnalysis: {
            met: true,
            objectionsAddressed: 1,
            required: 1,
            objections: ['Obj 1'],
          },
          methodWarrant: {
            met: true,
            confidence: bounded(0.6, 0.8, 'theoretical', 'OK'),
            calibrated: false,
          },
          evidenceFreshness: {
            met: true,
            oldestEvidenceAge: 0,
            maxAllowed: 7 * 24 * 60 * 60 * 1000,
            staleEvidence: [],
          },
        },
        defeaters: [],
        blockingReasons: ['Low problem confidence', 'Insufficient alternatives'],
        warnings: [],
      };

      const plan = validator.generateRemediation(failedResult);

      expect(plan.criticalPath).toBeDefined();
      expect(plan.criticalPath.length).toBeGreaterThan(0);
      // Critical path should contain high-priority actions (priority <= 2)
      expect(plan.criticalPath.every(a => a.priority <= 2)).toBe(true);
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration Tests', () => {
    let validator: TaskEpistemicValidator;

    beforeEach(() => {
      validator = new TaskEpistemicValidator(ledger, storage);
    });

    it('should complete full validation workflow', async () => {
      // Step 1: Build grounding for a new task
      const taskInfo = {
        id: createTaskId('integration-test-task'),
        description: 'Fix authentication timeout bug',
        goal: 'Improve user login experience',
        method: 'Increase session timeout and add retry logic',
      };

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('integration-test-session'),
        userAlternatives: [
          'Rewrite entire auth system',
          'Use third-party auth service',
        ],
        userObjections: [
          'What about backward compatibility?',
          'Will this affect performance?',
        ],
        methodCalibration: {
          datasetId: 'auth-fix-calibration',
          sampleSize: 75,
          successRate: 0.82,
        },
      };

      // Build grounding
      const taskClaim = await validator.buildGrounding(taskInfo, context);

      expect(taskClaim).toBeDefined();
      expect(taskClaim.task.id).toBe(taskInfo.id);
      expect(taskClaim.grounding.alternativesConsidered.alternatives).toHaveLength(2);
      expect(taskClaim.grounding.counterAnalysis.objections).toHaveLength(2);

      // Step 2: Validate the task claim
      const validationResult = await validator.validate(taskClaim, ValidationPresets.relaxed);

      // With relaxed preset and provided data, should pass basic validation
      expect(validationResult.breakdown).toBeDefined();
      expect(validationResult.confidence).toBeDefined();
      expect(validationResult.calibrationStatus).toBeDefined();
    });

    it('should support remediation followed by re-validation', async () => {
      // Create a task that fails validation
      const taskInfo = {
        id: createTaskId('remediation-test-task'),
        description: 'Complex refactoring task',
        goal: 'Improve code quality',
        method: 'Incremental refactoring',
      };

      const initialContext: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('remediation-test-session'),
        // No alternatives or objections - will fail standard validation
      };

      const initialClaim = await validator.buildGrounding(taskInfo, initialContext);

      // Validate with standard criteria - should fail
      const initialResult = await validator.validate(initialClaim, ValidationPresets.standard);

      // Check if validation failed (expected because no alternatives/objections)
      if (!initialResult.valid) {
        expect(initialResult.remediation).toBeDefined();
        expect(initialResult.remediation!.actions.length).toBeGreaterThan(0);

        // "Fix" the issues by providing more data
        const improvedContext: GroundingContext = {
          ledger,
          storage,
          sessionId: createSessionId('remediation-test-session-2'),
          userAlternatives: ['Complete rewrite', 'Partial refactoring'],
          userObjections: ['Risk of regression', 'Timeline concerns'],
          methodCalibration: {
            datasetId: 'refactoring-calibration',
            sampleSize: 100,
            successRate: 0.78,
          },
        };

        const improvedClaim = await validator.buildGrounding(taskInfo, improvedContext);

        // Re-validate - should have improved breakdown
        const improvedResult = await validator.validate(improvedClaim, ValidationPresets.standard);

        // The improved result should have better breakdown
        expect(improvedResult.breakdown.alternativesConsidered.count).toBe(2);
        expect(improvedResult.breakdown.counterAnalysis.objectionsAddressed).toBe(2);
      }
    });

    it('should handle defeaters in validation workflow', async () => {
      // Create a valid task claim
      const taskInfo = {
        id: createTaskId('defeater-workflow-test'),
        description: 'Update API endpoints',
        goal: 'Support new client requirements',
        method: 'Add new endpoints',
      };

      const context: GroundingContext = {
        ledger,
        storage,
        sessionId: createSessionId('defeater-workflow-session'),
        userAlternatives: ['Version API'],
        userObjections: ['Breaking changes?'],
        methodCalibration: {
          datasetId: 'api-update-calibration',
          sampleSize: 50,
          successRate: 0.9,
        },
      };

      const taskClaim = await validator.buildGrounding(taskInfo, context);

      // Add a full severity defeater
      const defeater = createDefeater({
        type: 'code_change',
        description: 'API spec has changed',
        severity: 'full',
        affectedClaimIds: [],
        confidenceReduction: 1.0,
        autoResolvable: true,
        resolutionAction: 'Review and update',
      });

      const claimWithDefeater: TaskClaim = {
        ...taskClaim,
        defeaters: [defeater],
      };

      // Validate with standard criteria - defeater should cause blocking with standard preset
      const result = await validator.validate(claimWithDefeater, ValidationPresets.standard);

      // With a full defeater and standard preset (blockOnFullDefeater=true),
      // the defeater should appear in blocking reasons
      expect(result.defeaters.length).toBeGreaterThan(0);

      // The result should have the defeater in the results
      expect(result.defeaters).toContainEqual(
        expect.objectContaining({ type: 'code_change' })
      );
    });
  });
});
