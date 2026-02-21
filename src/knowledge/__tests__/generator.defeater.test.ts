/**
 * @fileoverview Tests for defeater activation error handling in generateForFunction
 *
 * Tests cover:
 * 1. Missing defeater_activation.js module (MODULE_NOT_FOUND)
 * 2. Defeater module throws Error during execution
 * 3. Defeater returns invalid data
 * 4. Async defeater never resolves (timeout)
 * 5. Error during import itself vs during execution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UniversalKnowledgeGenerator, type DefeaterActivationModule } from '../generator.js';
import type { FunctionKnowledge } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';

// Mock modules
vi.mock('fs/promises');
vi.mock('../extractors/index.js');
vi.mock('../extractors/quality_extractor.js');
vi.mock('../extractors/security_extractor.js');
vi.mock('../extractors/testing_extractor.js');
vi.mock('../extractors/history_extractor.js');
vi.mock('../extractors/rationale_extractor.js');
vi.mock('../extractors/traceability_extractor.js');
vi.mock('../extractors/evidence_collector.js');
vi.mock('../extractors/relationships_extractor.js');

describe('generateForFunction - Defeater Activation Error Handling', () => {
  let mockStorage: LibrarianStorage;
  let generator: UniversalKnowledgeGenerator;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let defeaterLoaderImpl: () => Promise<DefeaterActivationModule>;

  const createMockFunction = (): FunctionKnowledge => ({
    id: 'test-fn-id',
    name: 'testFunction',
    filePath: '/test/file.ts',
    startLine: 10,
    endLine: 20,
    signature: 'function testFunction(): void',
    purpose: 'Test function',
    confidence: 0.8,
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  });

  beforeEach(async () => {
    // Reset modules before each test
    vi.resetModules();
    
    // Spy on console.warn
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create mock storage
    mockStorage = {
      getUniversalKnowledge: vi.fn().mockRejectedValue(new Error('Not found')),
      upsertUniversalKnowledge: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;

    // Mock fs.readFile
    const fs = await import('fs/promises');
    vi.mocked(fs.readFile).mockResolvedValue('function testFunction() {}');

    // Mock extractors with minimal valid responses (cast as unknown for test mocks)
    const { extractSemanticsWithLLM } = await import('../extractors/index.js');
    vi.mocked(extractSemanticsWithLLM).mockResolvedValue({
      semantics: {
        purpose: { summary: 'Test', explanation: '', problemSolved: '', valueProp: '' },
        domain: { concepts: [], businessRules: [] },
        intent: { primaryUseCase: '', secondaryUseCases: [], antiUseCases: [] },
        mechanism: { explanation: '', approach: '', approachRationale: '', patterns: [], dataStructures: [] },
        complexity: { time: 'O(1)', space: 'O(1)', cognitive: 'simple' },
      },
      confidence: 0.8,
    } as unknown as Awaited<ReturnType<typeof extractSemanticsWithLLM>>);

    const { extractQuality } = await import('../extractors/quality_extractor.js');
    vi.mocked(extractQuality).mockReturnValue({
      quality: {
        complexity: { cyclomatic: 1, cognitive: 'simple', lines: 10, parameters: 0, nesting: 1, statements: 5, returns: 1, halstead: { volume: 0, difficulty: 0, effort: 0 } },
        smells: [],
        maintainability: { index: 85, rating: 'A' },
        documentation: { hasDocstring: false, paramsCovered: 0, returnCovered: false, exampleCount: 0 },
        coverage: { statement: 0, branch: 0, line: 0, function: 0 },
        hygiene: { lintErrors: 0, lintWarnings: 0, unusedCode: [], todoCount: 0 },
      },
      confidence: 0.8,
    } as unknown as ReturnType<typeof extractQuality>);

    const { extractSecurityWithLLM } = await import('../extractors/security_extractor.js');
    vi.mocked(extractSecurityWithLLM).mockResolvedValue({
      security: {
        vulnerabilities: [],
        dataFlow: { inputs: [], outputs: [], transformations: [] },
        trustBoundaries: [],
        riskScore: { overall: 0, category: 'low' },
      },
      confidence: 0.8,
    } as unknown as Awaited<ReturnType<typeof extractSecurityWithLLM>>);

    const { extractTesting } = await import('../extractors/testing_extractor.js');
    vi.mocked(extractTesting).mockReturnValue({
      testing: {
        testFiles: [],
        assertions: [],
        testability: { score: 0.5, barriers: [] },
      },
      confidence: 0.5,
    } as unknown as ReturnType<typeof extractTesting>);

    const { extractHistory, extractOwnership } = await import('../extractors/history_extractor.js');
    vi.mocked(extractHistory).mockResolvedValue({
      history: { commits: [], changeFrequency: 'low', lastModified: '', createdAt: '', authors: [] },
      confidence: 0.5,
    } as unknown as Awaited<ReturnType<typeof extractHistory>>);
    vi.mocked(extractOwnership).mockResolvedValue({
      ownership: { experts: [], reviewers: [], tribalKnowledge: [] },
      confidence: 0.5,
    } as unknown as Awaited<ReturnType<typeof extractOwnership>>);

    const { extractRationaleWithLLM } = await import('../extractors/rationale_extractor.js');
    vi.mocked(extractRationaleWithLLM).mockResolvedValue({
      rationale: { decisions: [], tradeoffs: [], alternatives: [], constraints: [], assumptions: [], risks: [] },
      confidence: 0.5,
    } as unknown as Awaited<ReturnType<typeof extractRationaleWithLLM>>);

    const { extractTraceability } = await import('../extractors/traceability_extractor.js');
    vi.mocked(extractTraceability).mockResolvedValue({
      traceability: { requirements: [], issues: [], documentation: [], userStories: [], incidents: [], deployments: [] },
      confidence: 0.5,
    } as unknown as Awaited<ReturnType<typeof extractTraceability>>);

    const { collectEvidence } = await import('../extractors/evidence_collector.js');
    vi.mocked(collectEvidence).mockReturnValue({
      meta: {
        confidence: { overall: 0.8, bySection: {} },
        evidence: [],
        defeaters: [
          { type: 'stale_knowledge', description: 'Test defeater', severity: 'warning' },
        ],
        generatedAt: new Date().toISOString(),
        generatedBy: 'test',
        version: '1.0',
      },
    } as unknown as ReturnType<typeof collectEvidence>);

    const { extractRelationships } = await import('../extractors/relationships_extractor.js');
    vi.mocked(extractRelationships).mockResolvedValue({
      relationships: {
        calls: [],
        calledBy: [],
        imports: [],
        importedBy: [],
        inherits: [],
        inheritedBy: [],
        implements: [],
        uses: [],
        usedBy: [],
        cochanges: [],
        similar: [],
      },
    } as unknown as Awaited<ReturnType<typeof extractRelationships>>);

    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => ({
        totalDefeaters: 0,
        activeDefeaters: 0,
        results: [],
        knowledgeValid: true,
        confidenceAdjustment: 0,
      }),
      applyDefeaterResults: (meta) => meta,
    });

    // Create generator
    generator = new UniversalKnowledgeGenerator({
      storage: mockStorage,
      workspace: '/test',
      llmProvider: 'claude',
      llmModelId: 'claude-3-5-sonnet-20241022',
      defeaterLoader: () => defeaterLoaderImpl(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy.mockRestore();
  });

  it('should handle missing defeater_activation.js module (MODULE_NOT_FOUND)', async () => {
    defeaterLoaderImpl = async () => {
      const error: NodeJS.ErrnoException = new Error("Cannot find module './defeater_activation.js'");
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    };

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
    
    // Verify knowledge.meta was not modified by defeater (since it failed to load)
    const savedKnowledge = vi.mocked(mockStorage.upsertUniversalKnowledge).mock.calls[0][0];
    expect(savedKnowledge).toBeDefined();
  });

  it('should handle defeater module throwing synchronous Error during execution', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: () => {
        throw new Error('Sync error in checkDefeaters');
      },
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Sync error in checkDefeaters');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle defeater module throwing async Error during execution', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => {
        throw new Error('Async error in checkDefeaters');
      },
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Async error in checkDefeaters');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle defeater returning invalid data (missing required fields)', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => ({
        // Missing required fields like activeDefeaters, knowledgeValid, results
        invalid: true,
      }),
      applyDefeaterResults: () => {
        throw new Error('Cannot read properties of undefined');
      },
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle defeater returning null/undefined', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => null,
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle async defeater that never resolves (timeout scenario)', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => {
        return new Promise(() => {
          // Never resolves
        });
      },
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    
    // Use a generator with timeout configured
    const timedGenerator = new UniversalKnowledgeGenerator({
      storage: mockStorage,
      workspace: '/test',
      llmProvider: 'claude',
      llmModelId: 'claude-3-5-sonnet-20241022',
      timeoutMs: 100, // Short timeout for testing
      defeaterLoader: () => defeaterLoaderImpl(),
    });

    const result = await timedGenerator.generateForFunction(fn);

    // Should handle timeout gracefully - the overall function timeout will trigger
    // but the defeater should fail gracefully before that
    expect(result.success).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('should handle Error during import itself (dynamic import rejection)', async () => {
    defeaterLoaderImpl = async () => {
      throw new Error('Import failed: network error');
    };

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Import failed');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle applyDefeaterResults throwing Error', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => ({
        totalDefeaters: 1,
        activeDefeaters: 1,
        results: [{ activated: true, reason: 'test' }],
        knowledgeValid: false,
        confidenceAdjustment: -0.2,
      }),
      applyDefeaterResults: () => {
        throw new Error('Failed to apply defeater results');
      },
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed with warning logged
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Defeater activation skipped');

    // Verify storage was called (generation continued)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should successfully activate defeaters when module works correctly', async () => {
    // Mock successful defeater activation
    const mockApplyDefeaterResults = vi.fn((meta: unknown) => ({
      ...(meta as Record<string, unknown>),
      defeaterActivated: true,
    }));

    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => ({
        totalDefeaters: 1,
        activeDefeaters: 1,
        results: [{ activated: true, reason: 'content changed' }],
        knowledgeValid: true,
        confidenceAdjustment: -0.1,
      }),
      applyDefeaterResults: mockApplyDefeaterResults,
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed without warnings
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // Verify applyDefeaterResults was called
    expect(mockApplyDefeaterResults).toHaveBeenCalled();

    // Verify storage was called
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should handle defeater invalidating knowledge', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: async () => ({
        totalDefeaters: 2,
        activeDefeaters: 2,
        results: [
          { activated: true, reason: 'content hash mismatch' },
          { activated: true, reason: 'file modified' },
        ],
        knowledgeValid: false,
        confidenceAdjustment: -0.5,
      }),
      applyDefeaterResults: (meta: unknown) => ({
        ...(meta as Record<string, unknown>),
        invalid: true,
      }),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should still succeed but mark as partial with error
    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Knowledge invalidated by 2 defeater(s)');
    expect(result.errors[0].phase).toBe('identity');

    // Verify storage was still called (we persist invalidated knowledge)
    expect(mockStorage.upsertUniversalKnowledge).toHaveBeenCalled();
  });

  it('should not activate defeaters when meta.defeaters is empty', async () => {
    // Mock collectEvidence to return no defeaters
    const { collectEvidence } = await import('../extractors/evidence_collector.js');
    vi.mocked(collectEvidence).mockReturnValue({
      meta: {
        confidence: { overall: 0.8, bySection: {} },
        evidence: [],
        defeaters: [], // No defeaters
        generatedAt: new Date().toISOString(),
        generatedBy: 'test',
        version: '1.0',
      },
    } as unknown as ReturnType<typeof collectEvidence>);

    const mockCheckDefeaters = vi.fn();
    defeaterLoaderImpl = async () => ({
      checkDefeaters: mockCheckDefeaters,
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Should succeed
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);

    // checkDefeaters should not be called since there are no defeaters
    expect(mockCheckDefeaters).not.toHaveBeenCalled();
  });

  it('should preserve knowledge.meta when defeater activation fails', async () => {
    defeaterLoaderImpl = async () => ({
      checkDefeaters: () => {
        throw new Error('Defeater error');
      },
      applyDefeaterResults: vi.fn(),
    });

    const fn = createMockFunction();
    const result = await generator.generateForFunction(fn);

    // Get the saved knowledge
    const savedRecord = vi.mocked(mockStorage.upsertUniversalKnowledge).mock.calls[0][0];
    const savedKnowledge = JSON.parse(savedRecord.knowledge);

    // Verify meta still has defeaters (unchanged from collectEvidence)
    expect(savedKnowledge.meta.defeaters).toBeDefined();
    expect(savedKnowledge.meta.defeaters.length).toBeGreaterThan(0);

    // Verify meta has expected structure
    expect(savedKnowledge.meta.confidence).toBeDefined();
    expect(savedKnowledge.meta.evidence).toBeDefined();
    expect(savedKnowledge.meta.generatedAt).toBeDefined();
    expect(savedKnowledge.meta.generatedBy).toBeDefined();

    // Verify warning was logged
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('passes semantic wisdom to ownership extraction', async () => {
    const { extractSemanticsWithLLM } = await import('../extractors/index.js');
    vi.mocked(extractSemanticsWithLLM).mockResolvedValue({
      semantics: {
        purpose: { summary: 'Test', explanation: '', problemSolved: '', valueProp: '' },
        domain: { concepts: [], businessRules: [] },
        intent: { primaryUseCase: '', secondaryUseCases: [], antiUseCases: [] },
        mechanism: { explanation: '', approach: '', approachRationale: '', patterns: [], dataStructures: [] },
        complexity: { time: 'O(1)', space: 'O(1)', cognitive: 'simple' },
      },
      confidence: 0.8,
      wisdom: {
        gotchas: ['Regenerate index after symbol rename.'],
        tips: ['Run staged query before synthesis.'],
        tribal: ['On-call treats stale context warnings as release blockers.'],
        learningPath: [{ order: 1, description: 'Trace query pipeline stages first.' }],
      },
    } as unknown as Awaited<ReturnType<typeof extractSemanticsWithLLM>>);

    const { extractOwnership } = await import('../extractors/history_extractor.js');

    const fn = createMockFunction();
    await generator.generateForFunction(fn);

    expect(extractOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        wisdom: expect.objectContaining({
          gotchas: ['Regenerate index after symbol rename.'],
          tips: ['Run staged query before synthesis.'],
        }),
      })
    );
  });
});
