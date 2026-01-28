/**
 * @fileoverview Tests for Full Self-Audit Composition (WU-SELF-201)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fullSelfAudit,
  type FullAuditResult,
  type FullAuditOptions,
  type HealthScore,
} from '../full_audit.js';
import type { LibrarianStorage } from '../../../../storage/types.js';

describe('fullSelfAudit', () => {
  let mockStorage: LibrarianStorage;

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'a', toId: 'b', edgeType: 'imports', sourceFile: 'a.ts' },
        { fromId: 'b', toId: 'c', edgeType: 'calls', sourceFile: 'b.ts' },
      ]),
      getFileChecksum: vi.fn().mockResolvedValue(null),
      setFileChecksum: vi.fn().mockResolvedValue(undefined),
      getFunctionByPath: vi.fn().mockResolvedValue(null),
      getModuleByPath: vi.fn().mockResolvedValue(null),
      upsertFunction: vi.fn().mockResolvedValue(undefined),
      upsertModule: vi.fn().mockResolvedValue(undefined),
      upsertContextPack: vi.fn().mockResolvedValue(undefined),
      getContextPack: vi.fn().mockResolvedValue(null),
      deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
      upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
      recordIndexingResult: vi.fn().mockResolvedValue(undefined),
      getFunctions: vi.fn().mockResolvedValue([
        { id: 'fn1', name: 'testFn', filePath: 'test.ts', purpose: 'Test function' },
      ]),
      getModules: vi.fn().mockResolvedValue([
        { id: 'mod1', path: 'test.ts', exports: ['testFn'], dependencies: [], purpose: 'Test module' },
      ]),
      getTestMappings: vi.fn().mockResolvedValue([]),
      invalidateContextPacks: vi.fn().mockResolvedValue(0),
      getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
      getBayesianConfidences: vi.fn().mockResolvedValue([]),
      getConfidenceEvents: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;
  });

  it('requires rootDir parameter', async () => {
    await expect(
      fullSelfAudit({
        rootDir: '',
        storage: mockStorage,
      })
    ).rejects.toThrow('rootDir is required');
  });

  it('requires storage parameter', async () => {
    await expect(
      fullSelfAudit({
        rootDir: '/test',
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('has correct interface shape for FullAuditResult', () => {
    // Type-level test to ensure interface is correct
    const result: FullAuditResult = {
      bootstrapResult: {
        indexedFiles: 10,
        extractedSymbols: 50,
        graphNodes: 45,
        graphEdges: 80,
        duration: 1500,
        errors: [],
        isSelfReferential: false,
        coverage: { functions: 0.85, classes: 0.7, modules: 0.95, relationships: 0.6 },
      },
      architectureAnalysis: {
        modules: [],
        dependencies: [],
        cycles: [],
        layerViolations: [],
        couplingMetrics: {
          averageAfferentCoupling: 2,
          averageEfferentCoupling: 3,
          averageInstability: 0.5,
          highCouplingCount: 0,
          mostCoupled: [],
        },
        duration: 500,
        errors: [],
        suggestions: [],
      },
      consistencyAnalysis: {
        codeTestMismatches: [],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0.9,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 300,
        errors: [],
      },
      calibrationVerification: {
        ece: 0.03,
        mce: 0.05,
        brierScore: 0.02,
        isWellCalibrated: true,
        recommendations: [],
        calibrationStatus: 'well_calibrated',
        reliabilityDiagram: { bins: [], perfectCalibrationLine: [[0, 0], [1, 1]] },
        sampleComplexityAnalysis: {
          currentSampleSize: 100,
          requiredSamplesForEpsilon: 200,
          currentEpsilon: 0.1,
          confidenceInterval: [0.01, 0.05],
          powerAnalysis: { currentPower: 0.8, detectableEffectSize: 0.1, samplesForPower80: 100 },
        },
        confidence: { score: 0.8, tier: 'high', source: 'measured', sampleSize: 100 },
        duration: 200,
        errors: [],
      },
      recommendations: {
        recommendations: [],
        prioritizedActions: [],
        estimatedImpact: {
          qualityImprovement: 0.1,
          debtReduction: 0.2,
          maintainabilityImprovement: 0.15,
          riskReduction: 0.1,
          totalEffortHours: { min: 10, max: 40 },
          confidence: { score: 0.6, tier: 'medium', source: 'estimated' },
        },
        roadmap: { phases: [], totalEstimatedEffort: '5 days', criticalPath: [] },
        dependencies: [],
        duration: 100,
        errors: [],
      },
      overallHealth: {
        overall: 0.85,
        architecture: 0.9,
        consistency: 0.88,
        calibration: 0.75,
        status: 'healthy',
        confidence: { score: 0.7, tier: 'high', source: 'measured', sampleSize: 50 },
      },
      duration: 5000,
      errors: [],
      timestamp: new Date(),
      summary: 'Overall health: 85.0% (healthy)',
    };

    expect(result.overallHealth.overall).toBe(0.85);
    expect(result.overallHealth.status).toBe('healthy');
    expect(result.bootstrapResult.indexedFiles).toBe(10);
    expect(result.recommendations.recommendations).toEqual([]);
  });

  it('has correct interface shape for HealthScore', () => {
    const healthScore: HealthScore = {
      overall: 0.8,
      architecture: 0.85,
      consistency: 0.75,
      calibration: 0.8,
      status: 'needs_attention',
      confidence: { score: 0.6, tier: 'medium', source: 'measured' },
    };

    expect(healthScore.overall).toBe(0.8);
    expect(healthScore.status).toBe('needs_attention');
    expect(healthScore.confidence.tier).toBe('medium');
  });

  it('has correct interface shape for FullAuditOptions', () => {
    const options: FullAuditOptions = {
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      focusAreas: ['architecture', 'consistency'],
      expectedLayers: ['agents', 'storage', 'utils'],
      minBootstrapCoverage: 0.8,
      verbose: true,
      onProgress: (stage, progress) => {
        console.log(`${stage}: ${progress}%`);
      },
    };

    expect(options.rootDir).toBe('/test');
    expect(options.skipBootstrap).toBe(true);
    expect(options.focusAreas).toEqual(['architecture', 'consistency']);
    expect(options.expectedLayers).toEqual(['agents', 'storage', 'utils']);
    expect(options.minBootstrapCoverage).toBe(0.8);
  });

  it('runs with skipBootstrap option', async () => {
    const result = await fullSelfAudit({
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.bootstrapResult).toBeDefined();
    expect(result.bootstrapResult.indexedFiles).toBe(0); // Skipped
    expect(result.duration).toBeGreaterThan(0);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('calculates health score correctly', async () => {
    const result = await fullSelfAudit({
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      verbose: false,
    });

    expect(result.overallHealth).toBeDefined();
    expect(result.overallHealth.overall).toBeGreaterThanOrEqual(0);
    expect(result.overallHealth.overall).toBeLessThanOrEqual(1);
    expect(['healthy', 'needs_attention', 'degraded', 'critical']).toContain(result.overallHealth.status);
  });

  it('generates summary string', async () => {
    const result = await fullSelfAudit({
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      verbose: false,
    });

    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain('Overall health');
  });

  it('reports progress when callback provided', async () => {
    const progressStages: string[] = [];

    await fullSelfAudit({
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      verbose: false,
      onProgress: (stage, progress) => {
        progressStages.push(stage);
      },
    });

    expect(progressStages).toContain('bootstrap');
    expect(progressStages).toContain('analysis');
    expect(progressStages).toContain('recommendations');
  });

  it('handles focusAreas correctly', async () => {
    const result = await fullSelfAudit({
      rootDir: '/test',
      storage: mockStorage,
      skipBootstrap: true,
      focusAreas: ['architecture'],
      verbose: false,
    });

    expect(result).toBeDefined();
    // Architecture should be analyzed
    expect(result.architectureAnalysis).toBeDefined();
    // Consistency and calibration should have default/empty results
    expect(result.consistencyAnalysis.overallScore).toBe(1);
    expect(result.calibrationVerification.isWellCalibrated).toBe(true);
  });

  it('collects errors from failed stages', async () => {
    // Mock a failure in architecture analysis by making getModules throw
    const failingStorage = {
      ...mockStorage,
      getModules: vi.fn().mockImplementation(() => {
        throw new Error('Module fetch failed');
      }),
    } as unknown as LibrarianStorage;

    const result = await fullSelfAudit({
      rootDir: '/test',
      storage: failingStorage,
      skipBootstrap: true,
      verbose: false,
    });

    // The result should complete without throwing, and may have errors in sub-components
    expect(result).toBeDefined();
    // Duration should be non-negative (may be 0 for very fast execution)
    expect(result.duration).toBeGreaterThanOrEqual(0);
    // Errors may be captured in architecture or consistency results
    const allErrors = [
      ...result.errors,
      ...result.architectureAnalysis.errors,
      ...result.consistencyAnalysis.errors,
    ];
    expect(allErrors.length).toBeGreaterThan(0);
  });
});
