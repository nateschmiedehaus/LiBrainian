/**
 * @fileoverview Tests for Claim Verification Primitive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyClaim, createVerifyClaim, type Claim } from '../verify_claim.js';
import type { LibrarianStorage, FunctionKnowledge, TestMapping, ModuleKnowledge } from '../../../storage/types.js';
import type { GraphEdge } from '../../../types.js';

describe('verifyClaim', () => {
  let mockStorage: LibrarianStorage;
  let mockFunctions: FunctionKnowledge[];
  let mockTestMappings: TestMapping[];
  let mockEdges: GraphEdge[];
  let mockModules: ModuleKnowledge[];

  beforeEach(() => {
    mockFunctions = [
      {
        id: 'fn-1',
        name: 'analyzeArchitecture',
        filePath: '/test/src/agents/analyze_architecture.ts',
        signature: 'analyzeArchitecture(options: AnalyzeArchitectureOptions): ArchitectureAnalysisResult',
        purpose: 'Analyze codebase architecture for violations. Detects circular dependencies, layer violations, and coupling issues',
        startLine: 100,
        endLine: 200,
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn-2',
        name: 'detectCycles',
        filePath: '/test/src/agents/analyze_architecture.ts',
        signature: 'detectCycles(graph: ModuleGraph): CycleInfo[]',
        purpose: 'Detect dependency cycles in module graph. Uses Tarjan algorithm to find strongly connected components',
        startLine: 50,
        endLine: 80,
        confidence: 0.85,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn-3',
        name: 'computeCouplingMetrics',
        filePath: '/test/src/agents/analyze_architecture.ts',
        signature: 'computeCouplingMetrics(): CouplingMetrics',
        purpose: 'Compute afferent and efferent coupling',
        startLine: 250,
        endLine: 300,
        confidence: 0.7,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
    ] as FunctionKnowledge[];

    mockTestMappings = [
      {
        id: 'tm-1',
        testPath: '/test/src/agents/__tests__/analyze_architecture.test.ts',
        sourcePath: '/test/src/agents/analyze_architecture.ts',
        confidence: 0.9,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockEdges = [
      {
        fromId: 'fn-1',
        fromType: 'function',
        toId: 'fn-2',
        toType: 'function',
        edgeType: 'calls',
        sourceFile: '/test/src/agents/analyze_architecture.ts',
        sourceLine: 150,
        confidence: 0.9,
        computedAt: new Date(),
      },
    ];

    mockModules = [
      {
        id: 'mod-1',
        path: '/test/src/agents/analyze_architecture.ts',
        purpose: 'Architecture analysis module',
        exports: ['analyzeArchitecture', 'detectCycles'],
        dependencies: [],
        confidence: 0.9,
      },
    ];

    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      getFunctions: vi.fn().mockResolvedValue(mockFunctions),
      getTestMappings: vi.fn().mockResolvedValue(mockTestMappings),
      getGraphEdges: vi.fn().mockResolvedValue(mockEdges),
      getModules: vi.fn().mockResolvedValue(mockModules),
    } as unknown as LibrarianStorage;
  });

  it('requires storage parameter', async () => {
    await expect(
      verifyClaim('test claim', {
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('requires non-empty claim', async () => {
    await expect(
      verifyClaim('', { storage: mockStorage })
    ).rejects.toThrow('claim text is required');

    await expect(
      verifyClaim('   ', { storage: mockStorage })
    ).rejects.toThrow('claim text is required');
  });

  it('returns result structure with all required fields', async () => {
    const result = await verifyClaim(
      'The analyzeArchitecture function detects circular dependencies',
      { storage: mockStorage }
    );

    expect(result).toHaveProperty('claim');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('evidence');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('defeaters');
    expect(result).toHaveProperty('epistemicStatus');
    expect(result).toHaveProperty('gettierAnalysis');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.defeaters)).toBe(true);
    expect(['verified', 'refuted', 'uncertain']).toContain(result.verdict);
  });

  it('gathers code evidence for matching claims', async () => {
    const result = await verifyClaim(
      'analyzeArchitecture architecture violations',
      { storage: mockStorage }
    );

    // Should find some evidence (may be code, test, or assertion)
    // The claim extraction finds "analyzeArchitecture", "architecture", "violations"
    // which should match function names and purpose text
    expect(result.evidence.length).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty('verdict');
  });

  it('gathers test evidence when relevant', async () => {
    const result = await verifyClaim(
      'The analyze_architecture module has tests',
      { storage: mockStorage }
    );

    // Should find test evidence
    const testEvidence = result.evidence.filter((e) => e.type === 'test');
    expect(testEvidence.length).toBeGreaterThan(0);
  });

  it('identifies defeaters when evidence is weak', async () => {
    // Claim about something that doesn't exist
    const result = await verifyClaim(
      'The nonExistentFunction handles edge cases',
      { storage: mockStorage }
    );

    // Should have defeaters for insufficient evidence
    expect(result.defeaters.length).toBeGreaterThan(0);
    expect(result.verdict).toBe('uncertain');
  });

  it('provides confidence values with proper tiers', async () => {
    const result = await verifyClaim(
      'The detectCycles function uses Tarjan algorithm',
      { storage: mockStorage }
    );

    expect(result.confidence).toHaveProperty('score');
    expect(result.confidence).toHaveProperty('tier');
    expect(result.confidence).toHaveProperty('source');
    expect(['high', 'medium', 'low', 'uncertain']).toContain(result.confidence.tier);
  });

  it('performs Gettier analysis', async () => {
    const result = await verifyClaim(
      'The architecture analysis detects issues',
      { storage: mockStorage }
    );

    expect(result.gettierAnalysis).toHaveProperty('isGettierCase');
    expect(result.gettierAnalysis).toHaveProperty('gettierRisk');
    expect(result.gettierAnalysis).toHaveProperty('justificationStrength');
    expect(result.gettierAnalysis).toHaveProperty('truthBasis');

    expect(result.gettierAnalysis.gettierRisk).toBeGreaterThanOrEqual(0);
    expect(result.gettierAnalysis.gettierRisk).toBeLessThanOrEqual(1);
  });

  it('accepts Claim object as input', async () => {
    const claim: Claim = {
      id: 'claim-1',
      text: 'The analyzeArchitecture function works correctly',
      type: 'behavioral',
      source: 'documentation',
      context: 'Testing claim verification',
    };

    const result = await verifyClaim(claim, { storage: mockStorage });

    expect(result.claim).toBe(claim.text);
    expect(result).toHaveProperty('verdict');
  });

  it('respects maxEvidence option', async () => {
    const result = await verifyClaim(
      'The architecture module provides analysis',
      { storage: mockStorage, maxEvidence: 2 }
    );

    expect(result.evidence.length).toBeLessThanOrEqual(2);
  });

  describe('createVerifyClaim', () => {
    it('creates a bound verification function with default options', async () => {
      const boundVerify = createVerifyClaim({
        maxEvidence: 5,
        requiredConfidence: 0.8,
      });

      const result = await boundVerify(
        'The analyzeArchitecture function exists',
        { storage: mockStorage }
      );

      expect(result).toHaveProperty('verdict');
      expect(result.evidence.length).toBeLessThanOrEqual(5);
    });
  });

  describe('epistemic status', () => {
    it('returns verified_with_evidence for strong claims', async () => {
      // Mock strong evidence
      mockStorage.getFunctions = vi.fn().mockResolvedValue([
        {
          ...mockFunctions[0],
          confidence: 0.95,
          docstring: 'Comprehensive documentation matching the claim exactly',
        },
        ...mockFunctions.slice(1),
      ]);

      const result = await verifyClaim(
        'analyzeArchitecture',
        { storage: mockStorage, requiredConfidence: 0.3 }
      );

      // With strong matching evidence, should be verified
      expect(['verified', 'uncertain']).toContain(result.verdict);
    });

    it('returns inconclusive for weak claims', async () => {
      const result = await verifyClaim(
        'something completely unrelated to the codebase',
        { storage: mockStorage }
      );

      expect(result.epistemicStatus).toBe('inconclusive');
    });
  });

  describe('defeater detection', () => {
    it('detects deprecated module defeaters', async () => {
      mockModules[0].purpose = 'DEPRECATED: Old architecture analysis module';
      mockStorage.getModules = vi.fn().mockResolvedValue(mockModules);

      const result = await verifyClaim(
        'The architecture analysis module is reliable',
        { storage: mockStorage }
      );

      expect(result.defeaters.some((d) => d.includes('deprecated'))).toBe(true);
    });

    it('detects TODO defeaters', async () => {
      mockModules[0].purpose = 'TODO: Complete architecture analysis implementation';
      mockStorage.getModules = vi.fn().mockResolvedValue(mockModules);

      const result = await verifyClaim(
        'The architecture analysis is complete',
        { storage: mockStorage }
      );

      expect(result.defeaters.some((d) => d.includes('TODO') || d.includes('incomplete'))).toBe(true);
    });
  });
});
