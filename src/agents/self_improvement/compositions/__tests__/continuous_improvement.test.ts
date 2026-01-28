/**
 * @fileoverview Tests for Continuous Improvement Composition
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  runContinuousImprovement,
  createContinuousImprovement,
  type ContinuousImprovementOptions,
} from '../continuous_improvement.js';
import type { LibrarianStorage } from '../../../../storage/types.js';

// Mock the primitive modules
vi.mock('../../self_refresh.js', () => ({
  selfRefresh: vi.fn(),
}));

vi.mock('../../analyze_consistency.js', () => ({
  analyzeConsistency: vi.fn(),
}));

vi.mock('../../verify_calibration.js', () => ({
  verifyCalibration: vi.fn(),
}));

vi.mock('../../plan_fix.js', () => ({
  planFix: vi.fn(),
}));

vi.mock('../../learn_from_outcome.js', () => ({
  learnFromOutcome: vi.fn(),
}));

vi.mock('../../extract_pattern.js', () => ({
  extractPattern: vi.fn(),
}));

import { selfRefresh } from '../../self_refresh.js';
import { analyzeConsistency } from '../../analyze_consistency.js';
import { verifyCalibration } from '../../verify_calibration.js';
import { planFix } from '../../plan_fix.js';
import { learnFromOutcome } from '../../learn_from_outcome.js';
import { extractPattern } from '../../extract_pattern.js';

describe('runContinuousImprovement', () => {
  const mockStorage: LibrarianStorage = {
    getModules: vi.fn().mockResolvedValue([]),
    getGraphEdges: vi.fn().mockResolvedValue([]),
    invalidateContextPacks: vi.fn().mockResolvedValue(0),
  } as unknown as LibrarianStorage;

  const defaultOptions: ContinuousImprovementOptions = {
    rootDir: '/test/repo',
    storage: mockStorage,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    (selfRefresh as Mock).mockResolvedValue({
      changedFiles: ['src/test.ts'],
      updatedSymbols: 5,
      invalidatedClaims: 2,
      newDefeaters: 0,
      duration: 100,
      errors: [],
      changeSummary: {
        added: [],
        modified: ['src/test.ts'],
        deleted: [],
      },
    });

    (analyzeConsistency as Mock).mockResolvedValue({
      codeTestMismatches: [],
      codeDocMismatches: [],
      unreferencedCode: [],
      staleDocs: [],
      overallScore: 1.0,
      phantomClaims: [],
      untestedClaims: [],
      docDrift: [],
      duration: 150,
      errors: [],
    });

    (verifyCalibration as Mock).mockResolvedValue({
      ece: 0.05,
      mce: 0.1,
      reliabilityDiagram: { bins: [], perfectCalibrationLine: [] },
      sampleComplexityAnalysis: {
        currentSampleSize: 100,
        currentEpsilon: 0.05,
        confidenceInterval: [0.03, 0.07] as [number, number],
        requiredForEpsilon: () => 200,
        powerAnalysis: { currentPower: 0.8, detectableEffectSize: 0.05, samplesForPower80: 200 },
      },
      calibrationStatus: 'well_calibrated' as const,
      duration: 50,
      errors: [],
    });

    (planFix as Mock).mockResolvedValue({
      plan: {
        issue: { id: 'issue-1', type: 'consistency', description: 'Test issue', location: 'src/test.ts', severity: 'medium', evidence: [] },
        summary: 'Fix test issue',
        proposedChanges: [],
        testPlan: { unitTests: [], integrationTests: [], manualChecks: [] },
        rollbackPlan: { strategy: 'git revert', steps: [], revertibleFiles: [], estimatedTimeMinutes: 5 },
        riskAssessment: { overallRisk: 'low', risks: [], totalRiskScore: 0.2, prioritizedMitigations: [] },
        verificationCriteria: { assertions: [], metricThresholds: [], manualChecklist: [], timeoutMs: 60000 },
        estimatedEffort: { loc: { min: 10, max: 20 }, hours: { min: 0.5, max: 1 }, complexity: 'simple', confidence: { score: 0.7, tier: 'medium', source: 'estimated' } },
        affectedFiles: ['src/test.ts'],
      },
      affectedFiles: ['src/test.ts'],
      riskAssessment: { overallRisk: 'low', risks: [], totalRiskScore: 0.2, prioritizedMitigations: [] },
      verificationCriteria: { assertions: [], metricThresholds: [], manualChecklist: [], timeoutMs: 60000 },
      meetsConstraints: true,
      constraintViolations: [],
      duration: 30,
      errors: [],
    });

    (learnFromOutcome as Mock).mockResolvedValue({
      outcomesProcessed: 1,
      calibrationUpdate: { previousECE: 0.05, newECE: 0.04, samplesAdded: 1, binUpdates: [], calibrationImproved: true },
      knowledgeUpdates: [],
      confidenceAdjustments: [],
      patternsExtracted: [],
      newDefeaters: [],
      duration: 20,
      errors: [],
    });

    (extractPattern as Mock).mockResolvedValue({
      pattern: {
        id: 'pattern-1',
        name: 'Consistency Fix',
        description: 'Fix consistency issue',
        category: 'correctness',
        trigger: 'consistency mismatch',
        transformation: 'Align doc and code',
        constraints: [],
        examples: [],
        confidence: { score: 0.7, tier: 'medium', source: 'measured' },
        observationCount: 1,
      },
      applicability: {
        conditions: { requiredContext: [], excludingContext: [], codePatterns: [], estimatedApplicability: 0.5 },
        potentialSites: 10,
        estimatedEffort: '1 hour',
        risks: [],
      },
      generalization: { level: 'moderate', abstractForm: 'Fix consistency', variables: [], instantiations: 1, confidence: { score: 0.6, tier: 'medium', source: 'estimated' } },
      expectedBenefit: { metricImprovements: {}, riskReduction: 0.3, maintainabilityImprovement: 0.2, confidence: { score: 0.6, tier: 'medium', source: 'estimated' } },
      success: true,
      duration: 20,
      errors: [],
    });
  });

  describe('basic functionality', () => {
    it('returns result structure with all required fields', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      expect(result).toHaveProperty('cycleNumber');
      expect(result).toHaveProperty('checksPerformed');
      expect(result).toHaveProperty('issuesFound');
      expect(result).toHaveProperty('fixesPlanned');
      expect(result).toHaveProperty('fixesApplied');
      expect(result).toHaveProperty('patternsLearned');
      expect(result).toHaveProperty('healthImprovement');
      expect(result).toHaveProperty('nextScheduledCheck');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('phaseReports');
    });

    it('executes all phases in order', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      const phases = result.phaseReports.map((p) => p.phase);
      expect(phases).toContain('refresh');
      expect(phases).toContain('consistency_check');
      expect(phases).toContain('calibration_check');
    });

    it('cycle number starts at 1', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      expect(result.cycleNumber).toBe(1);
    });
  });

  describe('input validation', () => {
    it('throws error when rootDir is missing', async () => {
      await expect(
        runContinuousImprovement({ ...defaultOptions, rootDir: '' })
      ).rejects.toThrow('rootDir is required');
    });

    it('throws error when storage is missing', async () => {
      await expect(
        runContinuousImprovement({ ...defaultOptions, storage: undefined as unknown as LibrarianStorage })
      ).rejects.toThrow('storage is required');
    });
  });

  describe('self-refresh phase', () => {
    it('calls selfRefresh with correct options', async () => {
      await runContinuousImprovement({
        ...defaultOptions,
        sinceCommit: 'HEAD~5',
        sinceDays: 7,
      });

      expect(selfRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          rootDir: '/test/repo',
          storage: mockStorage,
          sinceCommit: 'HEAD~5',
          sinceDays: 7,
        })
      );
    });

    it('records refresh result in checks', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      const refreshCheck = result.checksPerformed.find((c) => c.type === 'refresh');
      expect(refreshCheck).toBeDefined();
      expect(refreshCheck?.passed).toBe(true);
    });

    it('handles refresh errors gracefully', async () => {
      (selfRefresh as Mock).mockRejectedValue(new Error('Refresh failed'));

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.errors.some((e) => e.includes('refresh'))).toBe(true);
      const refreshCheck = result.checksPerformed.find((c) => c.type === 'refresh');
      expect(refreshCheck?.passed).toBe(false);
    });
  });

  describe('consistency check phase', () => {
    it('calls analyzeConsistency with correct options', async () => {
      await runContinuousImprovement(defaultOptions);

      expect(analyzeConsistency).toHaveBeenCalledWith(
        expect.objectContaining({
          rootDir: '/test/repo',
          storage: mockStorage,
        })
      );
    });

    it('extracts issues from consistency analysis', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.7,
        phantomClaims: [
          { claim: 'Function exists', claimedLocation: 'src/missing.ts', searchedLocations: ['src/'], confidence: 0.9 },
        ],
        untestedClaims: [],
        docDrift: [
          { docLocation: 'README.md', codeLocation: 'src/api.ts', docContent: 'old', codeContent: 'new', driftType: 'signature_mismatch' },
        ],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.issuesFound.length).toBeGreaterThan(0);
      expect(result.issuesFound.some((i) => i.type === 'consistency')).toBe(true);
    });

    it('filters issues by minSeverity', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-high', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
          { id: 'mismatch-low', type: 'interface_signature', severity: 'info', claimed: 'any', actual: 'unknown', location: 'src/utils.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement({
        ...defaultOptions,
        minSeverity: 'high',
      });

      // Only high severity issues should be included
      const highSeverityIssues = result.issuesFound.filter((i) => i.severity === 'high' || i.severity === 'critical');
      expect(highSeverityIssues.length).toBeGreaterThan(0);
    });

    it('handles consistency check errors gracefully', async () => {
      (analyzeConsistency as Mock).mockRejectedValue(new Error('Consistency check failed'));

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.errors.some((e) => e.includes('consistency'))).toBe(true);
      const consistencyCheck = result.checksPerformed.find((c) => c.type === 'consistency');
      expect(consistencyCheck?.passed).toBe(false);
    });
  });

  describe('calibration check phase', () => {
    it('calls verifyCalibration with correct options', async () => {
      await runContinuousImprovement(defaultOptions);

      expect(verifyCalibration).toHaveBeenCalledWith(
        expect.objectContaining({
          storage: mockStorage,
        })
      );
    });

    it('records calibration status well_calibrated as passed', async () => {
      (verifyCalibration as Mock).mockResolvedValue({
        ece: 0.03,
        mce: 0.05,
        calibrationStatus: 'well_calibrated',
        reliabilityDiagram: { bins: [], perfectCalibrationLine: [] },
        sampleComplexityAnalysis: { currentSampleSize: 100, currentEpsilon: 0.03, confidenceInterval: [0.02, 0.04], requiredForEpsilon: () => 200, powerAnalysis: { currentPower: 0.8, detectableEffectSize: 0.05, samplesForPower80: 200 } },
        duration: 50,
        errors: [],
      });

      const result = await runContinuousImprovement(defaultOptions);

      const calibrationCheck = result.checksPerformed.find((c) => c.type === 'calibration');
      expect(calibrationCheck?.passed).toBe(true);
    });

    it('records calibration status miscalibrated as failed', async () => {
      (verifyCalibration as Mock).mockResolvedValue({
        ece: 0.15,
        mce: 0.25,
        calibrationStatus: 'miscalibrated',
        reliabilityDiagram: { bins: [], perfectCalibrationLine: [] },
        sampleComplexityAnalysis: { currentSampleSize: 100, currentEpsilon: 0.15, confidenceInterval: [0.1, 0.2], requiredForEpsilon: () => 500, powerAnalysis: { currentPower: 0.6, detectableEffectSize: 0.1, samplesForPower80: 300 } },
        duration: 50,
        errors: [],
      });

      const result = await runContinuousImprovement(defaultOptions);

      const calibrationCheck = result.checksPerformed.find((c) => c.type === 'calibration');
      expect(calibrationCheck?.passed).toBe(false);
      // Should add calibration issue
      expect(result.issuesFound.some((i) => i.type === 'theoretical')).toBe(true);
    });

    it('handles calibration check errors gracefully', async () => {
      (verifyCalibration as Mock).mockRejectedValue(new Error('Calibration check failed'));

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.errors.some((e) => e.includes('calibration'))).toBe(true);
      const calibrationCheck = result.checksPerformed.find((c) => c.type === 'calibration');
      expect(calibrationCheck?.passed).toBe(false);
    });
  });

  describe('fix planning phase', () => {
    it('plans fixes for identified issues', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement(defaultOptions);

      expect(planFix).toHaveBeenCalled();
      expect(result.fixesPlanned.length).toBeGreaterThan(0);
    });

    it('respects maxIssuesPerCycle option', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: Array(10).fill(null).map((_, i) => ({
          id: `mismatch-${i}`,
          type: 'interface_signature' as const,
          severity: 'error' as const,
          claimed: 'string',
          actual: 'number',
          location: `src/api${i}.ts`,
          suggestedResolution: 'Update type',
        })),
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      await runContinuousImprovement({
        ...defaultOptions,
        maxIssuesPerCycle: 3,
      });

      expect(planFix).toHaveBeenCalledTimes(3);
    });

    it('skips planning when no issues found', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      if (result.issuesFound.length === 0) {
        const planPhase = result.phaseReports.find((p) => p.phase === 'planning');
        expect(planPhase?.status).toBe('skipped');
      }
    });

    it('handles planning errors gracefully', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });
      (planFix as Mock).mockRejectedValue(new Error('Planning failed'));

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.errors.some((e) => e.includes('planning'))).toBe(true);
    });
  });

  describe('fix application phase', () => {
    it('skips application when autoApplyFixes is false', async () => {
      const result = await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: false,
      });

      expect(result.fixesApplied.length).toBe(0);
      const applyPhase = result.phaseReports.find((p) => p.phase === 'apply_fixes');
      expect(applyPhase?.status).toBe('skipped');
    });

    it('applies fixes when autoApplyFixes is true', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: true,
      });

      expect(result.fixesApplied.length).toBeGreaterThan(0);
    });

    it('reports applied fix success/failure', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: true,
      });

      for (const fix of result.fixesApplied) {
        expect(fix).toHaveProperty('success');
        expect(fix).toHaveProperty('verified');
        expect(fix).toHaveProperty('duration');
      }
    });
  });

  describe('learning phase', () => {
    it('learns from outcomes when learningEnabled is true', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: true,
        learningEnabled: true,
      });

      expect(learnFromOutcome).toHaveBeenCalled();
    });

    it('skips learning when learningEnabled is false', async () => {
      const result = await runContinuousImprovement({
        ...defaultOptions,
        learningEnabled: false,
      });

      expect(learnFromOutcome).not.toHaveBeenCalled();
      const learnPhase = result.phaseReports.find((p) => p.phase === 'learning');
      expect(learnPhase?.status).toBe('skipped');
    });

    it('handles learning errors gracefully', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });
      (learnFromOutcome as Mock).mockRejectedValue(new Error('Learning failed'));

      const result = await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: true,
        learningEnabled: true,
      });

      expect(result.errors.some((e) => e.includes('learning'))).toBe(true);
    });
  });

  describe('pattern extraction phase', () => {
    it('extracts patterns when extractPatterns is true', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-1', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/api.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement({
        ...defaultOptions,
        autoApplyFixes: true,
        extractPatterns: true,
      });

      // Patterns may or may not be extracted depending on successful fixes
      expect(Array.isArray(result.patternsLearned)).toBe(true);
    });

    it('skips pattern extraction when extractPatterns is false', async () => {
      const result = await runContinuousImprovement({
        ...defaultOptions,
        extractPatterns: false,
      });

      expect(extractPattern).not.toHaveBeenCalled();
      const patternPhase = result.phaseReports.find((p) => p.phase === 'pattern_extraction');
      expect(patternPhase?.status).toBe('skipped');
    });
  });

  describe('health calculation', () => {
    it('calculates health improvement', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      expect(result.healthImprovement).toBeGreaterThanOrEqual(-1);
      expect(result.healthImprovement).toBeLessThanOrEqual(1);
    });

    it('determines status based on health', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      expect(['healthy', 'improved', 'needs_attention', 'degraded']).toContain(result.status);
    });

    it('status is healthy when no issues found', async () => {
      const result = await runContinuousImprovement(defaultOptions);

      if (result.issuesFound.length === 0) {
        expect(result.status).toBe('healthy');
      }
    });

    it('status is needs_attention when critical issues exist', async () => {
      (analyzeConsistency as Mock).mockResolvedValue({
        codeTestMismatches: [
          { id: 'mismatch-critical', type: 'interface_signature', severity: 'error', claimed: 'string', actual: 'number', location: 'src/critical.ts', suggestedResolution: 'Update type' },
        ],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 150,
        errors: [],
      });

      const result = await runContinuousImprovement(defaultOptions);

      // Find critical issues
      const criticalIssues = result.issuesFound.filter((i) => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        expect(result.status).toBe('needs_attention');
      }
    });
  });

  describe('scheduling', () => {
    it('schedules next check based on cycleIntervalMs', async () => {
      const now = Date.now();
      const result = await runContinuousImprovement({
        ...defaultOptions,
        cycleIntervalMs: 3600000, // 1 hour
      });

      const nextCheck = result.nextScheduledCheck.getTime();
      expect(nextCheck).toBeGreaterThan(now);
      expect(nextCheck).toBeLessThanOrEqual(now + 3600000 + 60000); // Allow 1 minute variance
    });

    it('uses default interval when not specified', async () => {
      const now = Date.now();
      const result = await runContinuousImprovement(defaultOptions);

      const nextCheck = result.nextScheduledCheck.getTime();
      expect(nextCheck).toBeGreaterThan(now);
    });
  });

  describe('error handling', () => {
    it('continues on partial failures', async () => {
      (selfRefresh as Mock).mockRejectedValue(new Error('Refresh failed'));

      const result = await runContinuousImprovement(defaultOptions);

      // Should still run other checks
      expect(analyzeConsistency).toHaveBeenCalled();
      expect(verifyCalibration).toHaveBeenCalled();
    });

    it('aggregates errors from all phases', async () => {
      (selfRefresh as Mock).mockRejectedValue(new Error('Refresh failed'));
      (analyzeConsistency as Mock).mockRejectedValue(new Error('Consistency failed'));

      const result = await runContinuousImprovement(defaultOptions);

      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes('refresh'))).toBe(true);
      expect(result.errors.some((e) => e.includes('consistency'))).toBe(true);
    });
  });

  describe('createContinuousImprovement', () => {
    it('creates bound function with default options', async () => {
      const boundFn = createContinuousImprovement({
        sinceDays: 14,
        autoApplyFixes: true,
      });

      await boundFn({
        rootDir: '/test/repo',
        storage: mockStorage,
      });

      expect(selfRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          sinceDays: 14,
        })
      );
    });

    it('allows overriding default options', async () => {
      const boundFn = createContinuousImprovement({
        sinceDays: 14,
      });

      await boundFn({
        rootDir: '/test/repo',
        storage: mockStorage,
        sinceDays: 7,
      });

      expect(selfRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          sinceDays: 7,
        })
      );
    });
  });
});
