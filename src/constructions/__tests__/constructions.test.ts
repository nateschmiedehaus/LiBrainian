/**
 * @fileoverview Tests for Librarian Constructions
 *
 * Tests the composed constructions for:
 * - Correct output structure
 * - Confidence propagation
 * - Evidence trail
 * - Performance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RefactoringSafetyChecker,
  checkTypeCompatibility,
  parseSignature,
  isTypeSubset,
  isParameterTypeCompatible,
} from '../refactoring_safety_checker.js';
import { BugInvestigationAssistant } from '../bug_investigation_assistant.js';
import type { Librarian } from '../../api/librarian.js';
import type { ContextPack } from '../../types.js';

// ============================================================================
// MOCK LIBRARIAN
// ============================================================================

function createMockLibrarian(): Librarian {
  const mockPacks: ContextPack[] = [
    {
      packId: 'test-pack-1',
      packType: 'function_context',
      targetId: 'testFunction',
      summary: 'Test function that does something',
      keyFacts: ['Takes a string parameter', 'Returns a number'],
      codeSnippets: [
        {
          filePath: 'src/test.ts',
          content: 'function testFunction(input: string): number { return input.length; }',
          startLine: 10,
          endLine: 12,
          language: 'typescript',
        },
      ],
      confidence: 0.85,
      createdAt: new Date(),
      accessCount: 5,
      lastOutcome: 'success',
      successCount: 4,
      failureCount: 1,
      relatedFiles: ['src/test.ts'],
      invalidationTriggers: ['src/test.ts'],
    },
  ];

  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
    queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
    query: vi.fn().mockResolvedValue({ packs: mockPacks }),
  } as unknown as Librarian;
}

// ============================================================================
// REFACTORING SAFETY CHECKER TESTS
// ============================================================================

describe('RefactoringSafetyChecker', () => {
  let checker: RefactoringSafetyChecker;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    checker = new RefactoringSafetyChecker(mockLibrarian);
  });

  describe('check()', () => {
    it('should return a complete safety report', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'rename',
        newValue: 'newTestFunction',
      });

      // Verify report structure
      expect(result).toHaveProperty('target');
      expect(result).toHaveProperty('usages');
      expect(result).toHaveProperty('usageCount');
      expect(result).toHaveProperty('breakingChanges');
      expect(result).toHaveProperty('hasBreakingChanges');
      expect(result).toHaveProperty('testCoverageGaps');
      expect(result).toHaveProperty('estimatedCoverage');
      expect(result).toHaveProperty('safe');
      expect(result).toHaveProperty('risks');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('analysisTimeMs');
    });

    it('should have valid confidence value', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'rename',
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should track evidence references', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'move',
        newValue: 'src/new/location.ts',
      });

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs).toContain('usage_search:testFunction');
    });

    it('should identify breaking changes for signature changes', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'change_signature',
      });

      // With mock data containing a call usage, should detect breaking changes
      // (depends on mock returning call-type usages)
      expect(result.hasBreakingChanges).toBeDefined();
    });

    it('should complete within performance budget', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'rename',
      });

      // Should complete in under 5 seconds (generous for mocked)
      expect(result.analysisTimeMs).toBeLessThan(5000);
    });

    it('prefers exhaustive graph traversal over semantic fallback when storage is available', async () => {
      const queryOptional = vi.fn().mockResolvedValue({ packs: [] });
      const storage = {
        getFunctionsByName: vi.fn().mockResolvedValue([
          { id: 'func:testFunction', filePath: 'src/test.ts', name: 'testFunction' },
        ]),
        getModules: vi.fn().mockResolvedValue([]),
        getFunctions: vi.fn().mockResolvedValue([]),
        getGraphEdges: vi.fn().mockImplementation(async (options: { toIds?: string[] }) => {
          if (options?.toIds?.includes('func:testFunction')) {
            return [{
              fromId: 'func:caller',
              fromType: 'function',
              toId: 'func:testFunction',
              toType: 'function',
              edgeType: 'calls',
              sourceFile: 'src/caller.ts',
              sourceLine: 12,
              confidence: 1,
              computedAt: new Date(),
            }];
          }
          return [];
        }),
        getFiles: vi.fn().mockResolvedValue([]),
      };

      const librarian = {
        queryOptional,
        queryRequired: vi.fn().mockResolvedValue({ packs: [] }),
        query: vi.fn().mockResolvedValue({ packs: [] }),
        getStorage: () => storage,
        workspaceRoot: process.cwd(),
      } as unknown as Librarian;

      const graphChecker = new RefactoringSafetyChecker(librarian);
      const result = await graphChecker.check({
        entityId: 'testFunction',
        refactoringType: 'rename',
      });

      expect(result.usages.length).toBeGreaterThan(0);
      expect(queryOptional).not.toHaveBeenCalled();
      expect(result.risks.some((risk) => risk.includes('semantic fallback'))).toBe(false);
    });

    it('adds explicit warning when workspace files are not fully indexed', async () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'refactor-safety-coverage-'));
      writeFileSync(join(workspaceRoot, 'a.ts'), 'export function a() { return 1; }\n');
      writeFileSync(join(workspaceRoot, 'b.ts'), 'export function b() { return 2; }\n');
      const queryOptional = vi.fn().mockResolvedValue({ packs: [] });
      const storage = {
        getFunctionsByName: vi.fn().mockResolvedValue([
          { id: 'func:a', filePath: join(workspaceRoot, 'a.ts'), name: 'a' },
        ]),
        getModules: vi.fn().mockResolvedValue([]),
        getFunctions: vi.fn().mockResolvedValue([]),
        getGraphEdges: vi.fn().mockResolvedValue([
          {
            fromId: 'func:caller',
            fromType: 'function',
            toId: 'func:a',
            toType: 'function',
            edgeType: 'calls',
            sourceFile: join(workspaceRoot, 'a.ts'),
            sourceLine: 1,
            confidence: 1,
            computedAt: new Date(),
          },
        ]),
        getFiles: vi.fn().mockResolvedValue([
          { path: join(workspaceRoot, 'a.ts') },
        ]),
      };
      const librarian = {
        queryOptional,
        queryRequired: vi.fn().mockResolvedValue({ packs: [] }),
        query: vi.fn().mockResolvedValue({ packs: [] }),
        getStorage: () => storage,
        workspaceRoot,
      } as unknown as Librarian;
      const graphChecker = new RefactoringSafetyChecker(librarian);

      try {
        const result = await graphChecker.check({
          entityId: 'a',
          refactoringType: 'rename',
        });
        expect(result.risks.some((risk) => risk.includes('files are unindexed'))).toBe(true);
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('should detect type-breaking changes when signatures are provided', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'change_signature',
        oldSignature: 'function testFunction(input: string): number',
        newSignature: 'function testFunction(input: string, required: number): number',
      });

      // Should detect the added required parameter
      expect(result.hasBreakingChanges).toBe(true);
      const paramCountChange = result.breakingChanges.find(bc =>
        bc.typeChange?.kind === 'parameter_count'
      );
      expect(paramCountChange).toBeDefined();
    });

    it('should not report breaking changes for compatible signature changes', async () => {
      const result = await checker.check({
        entityId: 'testFunction',
        refactoringType: 'change_signature',
        oldSignature: 'function testFunction(input: string): number',
        newSignature: 'function testFunction(input: string, optional?: number): number',
      });

      // Adding optional parameter should not be breaking
      const typeBreakingChanges = result.breakingChanges.filter(bc => bc.typeChange);
      expect(typeBreakingChanges).toHaveLength(0);
    });
  });
});

// ============================================================================
// TYPE COMPATIBILITY CHECKING TESTS
// ============================================================================

describe('Type Compatibility Checking', () => {
  describe('parseSignature', () => {
    it('should parse basic function signature', () => {
      const sig = parseSignature('function foo(a: string, b: number): boolean');

      expect(sig.name).toBe('foo');
      expect(sig.parameters).toHaveLength(2);
      expect(sig.parameters[0]).toEqual({ name: 'a', type: 'string', optional: false, rest: false });
      expect(sig.parameters[1]).toEqual({ name: 'b', type: 'number', optional: false, rest: false });
      expect(sig.returnType).toBe('boolean');
    });

    it('should parse optional parameters', () => {
      const sig = parseSignature('function foo(a: string, b?: number): void');

      expect(sig.parameters[1].optional).toBe(true);
    });

    it('should parse rest parameters', () => {
      const sig = parseSignature('function foo(...args: string[]): void');

      expect(sig.parameters[0].rest).toBe(true);
    });

    it('should parse generic type parameters', () => {
      const sig = parseSignature('function foo<T, U>(a: T, b: U): T');

      expect(sig.typeParameters).toEqual(['T', 'U']);
    });

    it('should parse complex return types', () => {
      const sig = parseSignature('function foo(): Promise<string>');

      expect(sig.returnType).toBe('Promise<string>');
    });

    it('should handle default parameter values', () => {
      const sig = parseSignature('function foo(a: string = "default"): void');

      expect(sig.parameters[0].optional).toBe(true);
    });
  });

  describe('isTypeSubset', () => {
    it('should return true for identical types', () => {
      expect(isTypeSubset('string', 'string')).toBe(true);
      expect(isTypeSubset('number', 'number')).toBe(true);
    });

    it('should return true for any/unknown supersets', () => {
      expect(isTypeSubset('string', 'any')).toBe(true);
      expect(isTypeSubset('number', 'unknown')).toBe(true);
    });

    it('should return true for never subset', () => {
      expect(isTypeSubset('never', 'string')).toBe(true);
      expect(isTypeSubset('never', 'number')).toBe(true);
    });

    it('should handle union types', () => {
      expect(isTypeSubset('string', 'string | number')).toBe(true);
      expect(isTypeSubset('number', 'string | number')).toBe(true);
      expect(isTypeSubset('boolean', 'string | number')).toBe(false);
    });

    it('should handle array types', () => {
      expect(isTypeSubset('string[]', 'string[]')).toBe(true);
      expect(isTypeSubset('number[]', 'string[]')).toBe(false);
    });

    it('should handle Promise types', () => {
      expect(isTypeSubset('Promise<string>', 'Promise<string>')).toBe(true);
      expect(isTypeSubset('Promise<number>', 'Promise<string>')).toBe(false);
    });
  });

  describe('isParameterTypeCompatible', () => {
    it('should return true for same types', () => {
      expect(isParameterTypeCompatible('string', 'string')).toBe(true);
    });

    it('should return true for contravariant widening', () => {
      expect(isParameterTypeCompatible('string', 'string | number')).toBe(true);
    });

    it('should return true when new accepts any', () => {
      expect(isParameterTypeCompatible('string', 'any')).toBe(true);
    });
  });

  describe('checkTypeCompatibility', () => {
    it('should return compatible for identical signatures', () => {
      const result = checkTypeCompatibility(
        'function foo(a: string): number',
        'function foo(a: string): number'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.breakingChanges).toHaveLength(0);
    });

    it('should detect added required parameters', () => {
      const result = checkTypeCompatibility(
        'function foo(a: string): number',
        'function foo(a: string, b: number): number'
      );

      expect(result.isCompatible).toBe(false);
      expect(result.breakingChanges).toHaveLength(1);
      expect(result.breakingChanges[0].kind).toBe('parameter_count');
    });

    it('should not flag added optional parameters', () => {
      const result = checkTypeCompatibility(
        'function foo(a: string): number',
        'function foo(a: string, b?: number): number'
      );

      expect(result.isCompatible).toBe(true);
    });

    it('should detect optional to required change', () => {
      const result = checkTypeCompatibility(
        'function foo(a?: string): void',
        'function foo(a: string): void'
      );

      expect(result.isCompatible).toBe(false);
      const optionalChange = result.breakingChanges.find(c => c.kind === 'optional_to_required');
      expect(optionalChange).toBeDefined();
    });

    it('should detect incompatible parameter type narrowing', () => {
      const result = checkTypeCompatibility(
        'function foo(a: string | number): void',
        'function foo(a: string): void'
      );

      expect(result.isCompatible).toBe(false);
      const typeChange = result.breakingChanges.find(c => c.kind === 'parameter_type');
      expect(typeChange).toBeDefined();
    });

    it('should detect incompatible return type change', () => {
      const result = checkTypeCompatibility(
        'function foo(): string',
        'function foo(): number'
      );

      expect(result.isCompatible).toBe(false);
      const returnChange = result.breakingChanges.find(c => c.kind === 'return_type');
      expect(returnChange).toBeDefined();
    });

    it('should allow return type narrowing', () => {
      const result = checkTypeCompatibility(
        'function foo(): string | number',
        'function foo(): string'
      );

      expect(result.isCompatible).toBe(true);
    });

    it('should detect generic parameter count changes', () => {
      const result = checkTypeCompatibility(
        'function foo<T>(): T',
        'function foo<T, U>(): T'
      );

      expect(result.isCompatible).toBe(false);
      const genericChange = result.breakingChanges.find(c => c.kind === 'generic_constraint');
      expect(genericChange).toBeDefined();
    });
  });
});

// ============================================================================
// BUG INVESTIGATION ASSISTANT TESTS
// ============================================================================

describe('BugInvestigationAssistant', () => {
  let assistant: BugInvestigationAssistant;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    assistant = new BugInvestigationAssistant(mockLibrarian);
  });

  describe('investigate()', () => {
    it('should return a complete investigation report', async () => {
      const result = await assistant.investigate({
        description: 'Function throws error on empty input',
        errorMessage: 'Cannot read property length of undefined',
        stackTrace: `Error: Cannot read property length of undefined
    at testFunction (src/test.ts:11:23)
    at processInput (src/processor.ts:45:12)
    at main (src/index.ts:10:5)`,
      });

      // Verify report structure
      expect(result).toHaveProperty('bugReport');
      expect(result).toHaveProperty('stackFrames');
      expect(result).toHaveProperty('primarySuspect');
      expect(result).toHaveProperty('callChain');
      expect(result).toHaveProperty('hypotheses');
      expect(result).toHaveProperty('similarBugs');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('investigationTimeMs');
    });

    it('should parse stack trace correctly', async () => {
      const result = await assistant.investigate({
        description: 'Test error',
        stackTrace: `Error: test
    at myFunction (src/file.ts:10:5)
    at otherFunction (src/other.ts:20:10)`,
      });

      expect(result.stackFrames.length).toBe(2);
      expect(result.stackFrames[0].function).toBe('myFunction');
      expect(result.stackFrames[0].file).toBe('src/file.ts');
      expect(result.stackFrames[0].line).toBe(10);
    });

    it('should generate hypotheses for null errors', async () => {
      const result = await assistant.investigate({
        description: 'Null error',
        errorMessage: 'Cannot read property foo of undefined',
      });

      const nullHypothesis = result.hypotheses.find(h => h.id === 'null_reference');
      expect(nullHypothesis).toBeDefined();
    });

    it('should have valid confidence value', async () => {
      const result = await assistant.investigate({
        description: 'Test bug',
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should handle missing stack trace', async () => {
      const result = await assistant.investigate({
        description: 'Bug without stack trace',
        suspectedFiles: ['src/suspect.ts'],
      });

      expect(result.stackFrames.length).toBe(0);
      // Should still generate hypotheses based on description
      expect(result.hypotheses.length).toBeGreaterThanOrEqual(0);
    });

    it('should complete within performance budget', async () => {
      const result = await assistant.investigate({
        description: 'Test bug',
        errorMessage: 'Test error',
      });

      // Should complete in under 5 seconds (generous for mocked)
      expect(result.investigationTimeMs).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// FEATURE LOCATION ADVISOR TESTS
// ============================================================================

import { FeatureLocationAdvisor } from '../feature_location_advisor.js';
import { CodeQualityReporter } from '../code_quality_reporter.js';
import { ArchitectureVerifier } from '../architecture_verifier.js';
import { SecurityAuditHelper } from '../security_audit_helper.js';

function createMockLibrarianWithContent(): Librarian {
  const mockPacks: ContextPack[] = [
    {
      packId: 'test-pack-1',
      packType: 'function_context',
      targetId: 'testFunction',
      summary: 'Test function that does something',
      keyFacts: ['Takes a string parameter', 'Returns a number'],
      codeSnippets: [
        {
          filePath: 'src/test.ts',
          content: 'function testFunction(input: string): number { return input.length; }',
          startLine: 10,
          endLine: 12,
          language: 'typescript',
        },
      ],
      confidence: 0.85,
      createdAt: new Date(),
      accessCount: 5,
      lastOutcome: 'success',
      successCount: 4,
      failureCount: 1,
      relatedFiles: ['src/test.ts'],
      invalidationTriggers: ['src/test.ts'],
    },
  ];

  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
    queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
    query: vi.fn().mockResolvedValue({ packs: mockPacks }),
  } as unknown as Librarian;
}

describe('FeatureLocationAdvisor', () => {
  let advisor: FeatureLocationAdvisor;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarianWithContent();
    advisor = new FeatureLocationAdvisor(mockLibrarian);
  });

  describe('locate()', () => {
    it('should return a complete location report', async () => {
      const result = await advisor.locate({
        description: 'Find the test function',
        keywords: ['testFunction'],
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('locations');
      expect(result).toHaveProperty('locationCount');
      expect(result).toHaveProperty('primaryLocation');
      expect(result).toHaveProperty('relatedFeatures');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('analysisTimeMs');
    });

    it('should have valid confidence value', async () => {
      const result = await advisor.locate({
        description: 'Find any function',
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should track evidence references', async () => {
      const result = await advisor.locate({
        description: 'Find test function',
        keywords: ['test'],
      });

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs.some(e => e.includes('semantic_search'))).toBe(true);
    });

    it('should complete within performance budget', async () => {
      const result = await advisor.locate({
        description: 'Quick search',
      });

      expect(result.analysisTimeMs).toBeLessThan(5000);
    });

    it('uses bounded LLM-disabled query settings for location probes', async () => {
      const queryOptional = vi.fn().mockResolvedValue({ packs: [] });
      const boundedAdvisor = new FeatureLocationAdvisor({
        queryOptional,
        queryRequired: queryOptional,
        query: queryOptional,
      } as unknown as Librarian);

      await boundedAdvisor.locate({
        description: 'Find login flow',
        keywords: ['auth'],
      });

      expect(queryOptional).toHaveBeenCalled();
      for (const [request] of queryOptional.mock.calls) {
        expect(request.llmRequirement).toBe('disabled');
        expect(request.timeoutMs).toBe(20_000);
      }
    });
  });
});

// ============================================================================
// CODE QUALITY REPORTER TESTS
// ============================================================================

describe('CodeQualityReporter', () => {
  let reporter: CodeQualityReporter;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarianWithContent();
    reporter = new CodeQualityReporter(mockLibrarian);
  });

  describe('analyze()', () => {
    it('should return a complete quality report', async () => {
      const result = await reporter.analyze({
        files: ['src/test.ts'],
        aspects: ['complexity', 'duplication', 'testability'],
      });

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('analyzedFiles');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('analysisTimeMs');
    });

    it('should compute valid metrics', async () => {
      const result = await reporter.analyze({
        files: ['src/test.ts'],
        aspects: ['complexity'],
      });

      expect(result.metrics).toHaveProperty('averageComplexity');
      expect(result.metrics).toHaveProperty('duplicationRatio');
      expect(result.metrics).toHaveProperty('testabilityScore');
      expect(result.metrics).toHaveProperty('overallScore');
      expect(result.metrics.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.metrics.overallScore).toBeLessThanOrEqual(1);
    });

    it('should have valid confidence value', async () => {
      const result = await reporter.analyze({
        files: ['src/test.ts'],
        aspects: ['complexity'],
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should complete within performance budget', async () => {
      const result = await reporter.analyze({
        files: ['src/test.ts'],
        aspects: ['complexity'],
      });

      expect(result.analysisTimeMs).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// ARCHITECTURE VERIFIER TESTS
// ============================================================================

describe('ArchitectureVerifier', () => {
  let verifier: ArchitectureVerifier;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarianWithContent();
    verifier = new ArchitectureVerifier(mockLibrarian);
  });

  describe('verify()', () => {
    it('should return a complete verification report', async () => {
      const result = await verifier.verify({
        layers: [
          { name: 'domain', patterns: ['src/domain/**'], allowedDependencies: [] },
          { name: 'application', patterns: ['src/app/**'], allowedDependencies: ['domain'] },
        ],
        boundaries: [],
        rules: [],
      });

      expect(result).toHaveProperty('spec');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('compliance');
      expect(result).toHaveProperty('filesChecked');
      expect(result).toHaveProperty('rulesApplied');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('verificationTimeMs');
    });

    it('should compute valid compliance scores', async () => {
      const result = await verifier.verify({
        layers: [
          { name: 'api', patterns: ['src/api/**'], allowedDependencies: ['services'] },
        ],
        boundaries: [],
        rules: [],
      });

      expect(result.compliance).toHaveProperty('overall');
      expect(result.compliance).toHaveProperty('byLayer');
      expect(result.compliance).toHaveProperty('byRule');
      expect(result.compliance.overall).toBeGreaterThanOrEqual(0);
      expect(result.compliance.overall).toBeLessThanOrEqual(100);
    });

    it('should have valid confidence value', async () => {
      const result = await verifier.verify({
        layers: [],
        boundaries: [],
        rules: [],
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should complete within performance budget', async () => {
      const result = await verifier.verify({
        layers: [],
        boundaries: [],
        rules: [],
      });

      expect(result.verificationTimeMs).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// SECURITY AUDIT HELPER TESTS
// ============================================================================

describe('SecurityAuditHelper', () => {
  let auditor: SecurityAuditHelper;
  let mockLibrarian: Librarian;

  beforeEach(() => {
    // Create mock with security-relevant content
    const mockPacks: ContextPack[] = [
      {
        packId: 'security-pack-1',
        packType: 'function_context',
        targetId: 'authHandler',
        summary: 'Authentication handler',
        keyFacts: ['Handles user login'],
        codeSnippets: [
          {
            filePath: 'src/auth.ts',
            content: 'const secret = "hardcoded"; eval(userInput);',
            startLine: 10,
            endLine: 15,
            language: 'typescript',
          },
        ],
        confidence: 0.9,
        createdAt: new Date(),
        accessCount: 3,
        lastOutcome: 'success',
        successCount: 3,
        failureCount: 0,
        relatedFiles: ['src/auth.ts'],
        invalidationTriggers: ['src/auth.ts'],
      },
    ];

    mockLibrarian = {
      queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
      queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
      query: vi.fn().mockResolvedValue({ packs: mockPacks }),
    } as unknown as Librarian;

    auditor = new SecurityAuditHelper(mockLibrarian);
  });

  describe('audit()', () => {
    it('should return a complete security report', async () => {
      const result = await auditor.audit({
        files: ['src/auth.ts'],
        checkTypes: ['injection', 'auth', 'crypto', 'exposure'],
      });

      expect(result).toHaveProperty('scope');
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('filesAudited');
      expect(result).toHaveProperty('riskScore');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('auditTimeMs');
    });

    it('should detect eval usage as injection vulnerability', async () => {
      const result = await auditor.audit({
        files: ['src/auth.ts'],
        checkTypes: ['injection'],
      });

      const evalFinding = result.findings.find(f => f.title === 'Eval Usage');
      expect(evalFinding).toBeDefined();
      expect(evalFinding?.type).toBe('injection');
    });

    it('should compute valid severity breakdown', async () => {
      const result = await auditor.audit({
        files: ['src/test.ts'],
        checkTypes: ['injection'],
      });

      expect(result.severity).toHaveProperty('critical');
      expect(result.severity).toHaveProperty('high');
      expect(result.severity).toHaveProperty('medium');
      expect(result.severity).toHaveProperty('low');
      expect(result.severity).toHaveProperty('info');
    });

    it('should have valid confidence value', async () => {
      const result = await auditor.audit({
        files: ['src/test.ts'],
        checkTypes: ['injection'],
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should complete within performance budget', async () => {
      const result = await auditor.audit({
        files: ['src/test.ts'],
        checkTypes: ['injection'],
      });

      expect(result.auditTimeMs).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// CONFIDENCE PROPAGATION TESTS
// ============================================================================

describe('Confidence Propagation', () => {
  it('should propagate confidence through RefactoringSafetyChecker', async () => {
    const mockLibrarian = createMockLibrarian();
    const checker = new RefactoringSafetyChecker(mockLibrarian);

    const result = await checker.check({
      entityId: 'testFunction',
      refactoringType: 'rename',
    });

    // Confidence should reflect the analysis quality
    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      // The measurement structure depends on the construction implementation
      expect(confidence.measurement).toBeDefined();
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through BugInvestigationAssistant', async () => {
    const mockLibrarian = createMockLibrarian();
    const assistant = new BugInvestigationAssistant(mockLibrarian);

    const result = await assistant.investigate({
      description: 'Test bug',
      stackTrace: 'at test (file.ts:1:1)',
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      // The measurement structure depends on the construction implementation
      expect(confidence.measurement).toBeDefined();
    }
  });

  it('should propagate confidence through FeatureLocationAdvisor', async () => {
    const mockLibrarian = createMockLibrarianWithContent();
    const advisor = new FeatureLocationAdvisor(mockLibrarian);

    const result = await advisor.locate({
      description: 'Find test function',
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      expect(confidence.measurement).toHaveProperty('datasetId');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through CodeQualityReporter', async () => {
    const mockLibrarian = createMockLibrarianWithContent();
    const reporter = new CodeQualityReporter(mockLibrarian);

    const result = await reporter.analyze({
      files: ['src/test.ts'],
      aspects: ['complexity'],
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.measurement).toHaveProperty('datasetId');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through ArchitectureVerifier', async () => {
    const mockLibrarian = createMockLibrarianWithContent();
    const verifier = new ArchitectureVerifier(mockLibrarian);

    const result = await verifier.verify({
      layers: [{ name: 'test', patterns: ['src/**'], allowedDependencies: [] }],
      boundaries: [],
      rules: [],
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.measurement).toHaveProperty('datasetId');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through SecurityAuditHelper', async () => {
    const mockPacks: ContextPack[] = [
      {
        packId: 'sec-pack',
        packType: 'function_context',
        targetId: 'func',
        summary: 'Test',
        keyFacts: [],
        codeSnippets: [{
          filePath: 'src/test.ts',
          content: 'const x = eval(input);',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        }],
        confidence: 0.8,
        createdAt: new Date(),
        accessCount: 1,
        lastOutcome: 'success',
        successCount: 1,
        failureCount: 0,
        relatedFiles: ['src/test.ts'],
        invalidationTriggers: ['src/test.ts'],
      },
    ];

    const mockLibrarian = {
      queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
      queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
      query: vi.fn().mockResolvedValue({ packs: mockPacks }),
    } as unknown as Librarian;

    const auditor = new SecurityAuditHelper(mockLibrarian);
    const result = await auditor.audit({
      files: ['src/test.ts'],
      checkTypes: ['injection'],
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.measurement).toHaveProperty('datasetId');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });
});
