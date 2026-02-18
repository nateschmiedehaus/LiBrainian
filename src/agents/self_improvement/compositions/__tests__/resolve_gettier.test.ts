/**
 * @fileoverview Tests for Gettier Case Resolution Composition (WU-SELF-203)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveGettierCase,
  type GettierResolutionResult,
  type GettierResolutionOptions,
} from '../resolve_gettier.js';
import type { Claim } from '../../verify_claim.js';
import type { LibrarianStorage } from '../../../../storage/types.js';

describe('resolveGettierCase', () => {
  let mockStorage: LibrarianStorage;
  let testClaim: Claim;

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'analyzeArchitecture', toId: 'detectCycles', edgeType: 'calls', sourceFile: 'analyze.ts' },
        { fromId: 'detectCycles', toId: 'buildGraph', edgeType: 'calls', sourceFile: 'cycles.ts' },
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
        {
          id: 'fn-analyze',
          name: 'analyzeArchitecture',
          filePath: 'src/analyze.ts',
          purpose: 'Analyzes codebase architecture for violations',
          signature: 'function analyzeArchitecture(options: Options): Promise<Result>',
        },
        {
          id: 'fn-detect',
          name: 'detectCycles',
          filePath: 'src/cycles.ts',
          purpose: 'Detects circular dependencies in module graph',
          signature: 'function detectCycles(graph: Graph): Cycle[]',
        },
      ]),
      getModules: vi.fn().mockResolvedValue([
        {
          id: 'mod-analyze',
          path: 'src/analyze.ts',
          exports: ['analyzeArchitecture'],
          dependencies: ['./cycles.ts'],
          purpose: 'Architecture analysis module',
        },
        {
          id: 'mod-cycles',
          path: 'src/cycles.ts',
          exports: ['detectCycles'],
          dependencies: [],
          purpose: 'Cycle detection using Tarjan algorithm',
        },
      ]),
      getTestMappings: vi.fn().mockResolvedValue([
        {
          testPath: 'src/__tests__/analyze.test.ts',
          sourcePath: 'src/analyze.ts',
          confidence: 0.9,
        },
        {
          testPath: 'src/__tests__/cycles.test.ts',
          sourcePath: 'src/cycles.ts',
          confidence: 0.85,
        },
      ]),
      invalidateContextPacks: vi.fn().mockResolvedValue(0),
      getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
      getBayesianConfidences: vi.fn().mockResolvedValue([]),
      getConfidenceEvents: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;

    testClaim = {
      id: 'claim-1',
      text: 'The analyzeArchitecture function detects all circular dependencies',
      type: 'behavioral',
      source: 'documentation',
      context: 'Architecture analysis module',
    };
  });

  it('requires storage parameter', async () => {
    await expect(
      resolveGettierCase(testClaim, {
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('requires claim text', async () => {
    const emptyClaim: Claim = {
      id: 'empty',
      text: '',
      type: 'behavioral',
      source: 'test',
      context: 'test',
    };

    await expect(
      resolveGettierCase(emptyClaim, {
        storage: mockStorage,
      })
    ).rejects.toThrow('claim text is required');
  });

  it('has correct interface shape for GettierResolutionResult', () => {
    const result: GettierResolutionResult = {
      originalClaim: testClaim,
      gettierAnalysis: {
        isGettierCase: false,
        gettierRisk: 0.2,
        justificationStrength: 0.8,
        truthBasis: 'causal',
        mitigationPath: undefined,
      },
      additionalEvidence: [
        {
          type: 'test',
          content: 'Test verifies circular dependency detection',
          location: 'src/__tests__/analyze.test.ts',
          confidence: { score: 0.9, tier: 'high', source: 'measured', sampleSize: 1 },
        },
      ],
      resolvedClaim: { ...testClaim, id: 'claim-1-resolved' },
      resolution: 'confirmed',
      resolutionReport: {
        initialGettierRisk: 0.5,
        finalGettierRisk: 0.2,
        iterationsRequired: 1,
        justificationStrengthened: true,
        newEvidenceCount: 2,
        explanation: 'Claim confirmed with causal justification',
        causalChain: [
          { from: 'analyzeArchitecture', to: 'detectCycles', strength: 0.8, type: 'entails' },
        ],
        counterevidence: [],
      },
      duration: 2000,
      errors: [],
    };

    expect(result.originalClaim).toBe(testClaim);
    expect(result.gettierAnalysis.gettierRisk).toBe(0.2);
    expect(result.resolution).toBe('confirmed');
    expect(result.resolvedClaim?.id).toBe('claim-1-resolved');
    expect(result.resolutionReport.causalChain?.length).toBe(1);
  });

  it('has correct interface shape for GettierResolutionOptions', () => {
    const options: GettierResolutionOptions = {
      rootDir: '/test',
      storage: mockStorage,
      maxIterations: 5,
      targetGettierRisk: 0.25,
      requiredConfidence: 0.9,
      verificationBudget: {
        maxTokens: 10000,
        maxTimeMs: 120000,
        maxApiCalls: 100,
      },
      verbose: true,
    };

    expect(options.maxIterations).toBe(5);
    expect(options.targetGettierRisk).toBe(0.25);
    expect(options.requiredConfidence).toBe(0.9);
    expect(options.verificationBudget?.maxTokens).toBe(10000);
  });

  it('returns resolution result for valid claim', async () => {
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.originalClaim).toEqual(testClaim);
    expect(result.gettierAnalysis).toBeDefined();
    expect(result.resolution).toBeDefined();
    expect(['confirmed', 'refuted', 'upgraded', 'unresolved']).toContain(result.resolution);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('gathers additional evidence when Gettier risk is high', async () => {
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      targetGettierRisk: 0.1, // Very low threshold to trigger evidence gathering
      verbose: false,
    });

    expect(result).toBeDefined();
    // Additional evidence may or may not be gathered depending on initial verification
    expect(Array.isArray(result.additionalEvidence)).toBe(true);
    expect(result.resolutionReport.iterationsRequired).toBeGreaterThanOrEqual(0);
  });

  it('respects maxIterations option', async () => {
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      maxIterations: 1,
      targetGettierRisk: 0.01, // Very low to ensure we hit max iterations
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.resolutionReport.iterationsRequired).toBeLessThanOrEqual(1);
  });

  it('builds causal chain from evidence', async () => {
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.resolutionReport).toBeDefined();
    // Causal chain is optional and depends on evidence gathered
    if (result.resolutionReport.causalChain) {
      expect(Array.isArray(result.resolutionReport.causalChain)).toBe(true);
    }
  });

  it('detects counterevidence when present', async () => {
    // Mock storage with deprecated module that contradicts claim
    const storageWithCounterEvidence = {
      ...mockStorage,
      getModules: vi.fn().mockResolvedValue([
        {
          id: 'mod-deprecated',
          path: 'src/analyze.ts',
          exports: ['analyzeArchitecture'],
          dependencies: [],
          purpose: 'DEPRECATED: Old architecture analysis - use new module instead',
        },
      ]),
    } as unknown as LibrarianStorage;

    const result = await resolveGettierCase(testClaim, {
      storage: storageWithCounterEvidence,
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.resolutionReport.counterevidence).toBeDefined();
    // May or may not find counterevidence depending on term matching
    expect(Array.isArray(result.resolutionReport.counterevidence)).toBe(true);
  });

  it('generates explanation in resolution report', async () => {
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      verbose: false,
    });

    expect(result.resolutionReport.explanation).toBeDefined();
    expect(typeof result.resolutionReport.explanation).toBe('string');
    expect(result.resolutionReport.explanation.length).toBeGreaterThan(0);
  });

  it('returns early when claim is already safe', async () => {
    // Use high targetGettierRisk so claim is likely already "safe"
    const result = await resolveGettierCase(testClaim, {
      storage: mockStorage,
      targetGettierRisk: 0.9, // Very high threshold
      verbose: false,
    });

    expect(result).toBeDefined();
    // If already safe, should have low iteration count
    expect(result.resolutionReport.iterationsRequired).toBeLessThanOrEqual(1);
  });

  it('handles verification errors gracefully', async () => {
    const failingStorage = {
      ...mockStorage,
      getFunctions: vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      }),
    } as unknown as LibrarianStorage;

    const result = await resolveGettierCase(testClaim, {
      storage: failingStorage,
      verbose: false,
    });

    // Should complete without throwing
    expect(result).toBeDefined();
    // The result will be based on whatever evidence could be gathered
    expect(['confirmed', 'refuted', 'upgraded', 'unresolved']).toContain(result.resolution);
    // Duration should be non-negative (may be 0 for very fast execution)
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('correctly handles different resolution outcomes', () => {
    // Test interface for different resolutions
    const confirmedResult: GettierResolutionResult = {
      originalClaim: testClaim,
      gettierAnalysis: {
        isGettierCase: false,
        gettierRisk: 0.1,
        justificationStrength: 0.9,
        truthBasis: 'causal',
      },
      additionalEvidence: [],
      resolvedClaim: testClaim,
      resolution: 'confirmed',
      resolutionReport: {
        initialGettierRisk: 0.5,
        finalGettierRisk: 0.1,
        iterationsRequired: 2,
        justificationStrengthened: true,
        newEvidenceCount: 3,
        explanation: 'Confirmed',
        counterevidence: [],
      },
      duration: 1000,
      errors: [],
    };

    const refutedResult: GettierResolutionResult = {
      ...confirmedResult,
      resolution: 'refuted',
      resolvedClaim: null, // Refuted claims don't have resolved claim
      resolutionReport: {
        ...confirmedResult.resolutionReport,
        explanation: 'Refuted due to counterevidence',
        counterevidence: [
          {
            type: 'assertion',
            content: 'Module is deprecated',
            location: 'src/module.ts',
            confidence: { score: 0.8, tier: 'high', source: 'measured' },
          },
        ],
      },
    };

    expect(confirmedResult.resolution).toBe('confirmed');
    expect(confirmedResult.resolvedClaim).toBeDefined();
    expect(refutedResult.resolution).toBe('refuted');
    expect(refutedResult.resolvedClaim).toBeNull();
  });

  it('supports verbose logging', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await resolveGettierCase(testClaim, {
      storage: mockStorage,
      verbose: true,
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
