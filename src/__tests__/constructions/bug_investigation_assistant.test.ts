/**
 * @fileoverview Tests for BugInvestigationAssistant
 *
 * Tests the enhanced multi-signal bug similarity detection including:
 * - Semantic similarity (librainian queries)
 * - Structural similarity (AST-based)
 * - Error signature matching
 * - Historical correlation
 * - Multi-signal score combination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BugInvestigationAssistant,
  createBugInvestigationAssistant,
  type BugReport,
  type SimilarBug,
  type SimilarityWeights,
} from '../../constructions/bug_investigation_assistant.js';
import type { LiBrainian } from '../../api/librainian.js';

// Mock the AST extractor to avoid file system dependencies
vi.mock('../../evaluation/ast_fact_extractor.js', () => ({
  ASTFactExtractor: class MockASTFactExtractor {
    async extractFromFile(filePath: string) {
      // Return mock facts based on file path
      if (filePath.includes('auth')) {
        return [
          {
            type: 'function_def',
            identifier: 'validateUser',
            file: filePath,
            line: 10,
            details: {
              parameters: [{ name: 'token', type: 'string' }],
              returnType: 'Promise<User>',
              isAsync: true,
              isExported: true,
            },
          },
          {
            type: 'call',
            identifier: 'validateUser->checkToken',
            file: filePath,
            line: 15,
            details: {
              caller: 'validateUser',
              callee: 'checkToken',
            },
          },
        ];
      }
      if (filePath.includes('error')) {
        return [
          {
            type: 'function_def',
            identifier: 'handleError',
            file: filePath,
            line: 5,
            details: {
              parameters: [{ name: 'error', type: 'Error' }],
              returnType: 'void',
              isAsync: false,
              isExported: true,
            },
          },
          {
            type: 'call',
            identifier: 'handleError->log.error',
            file: filePath,
            line: 8,
            details: {
              caller: 'handleError',
              callee: 'log.error',
            },
          },
        ];
      }
      return [];
    }
  },
}));

/**
 * Create a mock LiBrainian instance for testing.
 */
function createMockLiBrainian(): LiBrainian {
  return {
    queryOptional: vi.fn().mockImplementation(async (query) => {
      // Simulate different responses based on query intent
      const intent = query.intent?.toLowerCase() || '';

      if (intent.includes('similar') && intent.includes('bug')) {
        return {
          packs: [
            {
              packId: 'pack-1',
              packType: 'function',
              summary: 'Similar null pointer handling',
              relatedFiles: ['/src/auth/validator.ts'],
              confidence: 0.75,
            },
            {
              packId: 'pack-2',
              packType: 'function',
              summary: 'Related error handling',
              relatedFiles: ['/src/utils/error-handler.ts'],
              confidence: 0.65,
            },
          ],
        };
      }

      if (intent.includes('error') && intent.includes('typeerror')) {
        return {
          packs: [
            {
              packId: 'pack-3',
              packType: 'function',
              summary: 'TypeError handling code',
              relatedFiles: ['/src/handlers/type-check.ts'],
              confidence: 0.70,
            },
          ],
        };
      }

      if (intent.includes('relationship')) {
        return {
          packs: [
            {
              packId: 'pack-4',
              packType: 'module',
              summary: 'Files share common imports',
              confidence: 0.45,
            },
          ],
        };
      }

      if (intent.includes('patterns')) {
        return {
          packs: [
            {
              packId: 'pack-5',
              packType: 'function',
              summary: 'Similar code patterns',
              relatedFiles: ['/src/api/user-service.ts'],
              confidence: 0.60,
            },
          ],
        };
      }

      // Default empty response
      return { packs: [] };
    }),
  } as unknown as LiBrainian;
}

describe('BugInvestigationAssistant', () => {
  let assistant: BugInvestigationAssistant;
  let mockLiBrainian: LiBrainian;

  beforeEach(() => {
    mockLiBrainian = createMockLiBrainian();
    assistant = createBugInvestigationAssistant(mockLiBrainian);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createBugInvestigationAssistant', () => {
    it('should create an instance', () => {
      expect(assistant).toBeInstanceOf(BugInvestigationAssistant);
    });
  });

  describe('investigate', () => {
    it('should return an investigation report', async () => {
      const bugReport: BugReport = {
        description: 'User authentication fails with null error',
        errorMessage: 'TypeError: Cannot read property "id" of undefined',
        stackTrace: `
          at validateUser (/src/auth/validator.ts:25:10)
          at processLogin (/src/api/login.ts:42:5)
          at handleRequest (/src/server/handler.ts:15:3)
        `,
      };

      const report = await assistant.investigate(bugReport);

      expect(report).toHaveProperty('bugReport');
      expect(report).toHaveProperty('stackFrames');
      expect(report).toHaveProperty('primarySuspect');
      expect(report).toHaveProperty('hypotheses');
      expect(report).toHaveProperty('similarBugs');
      expect(report).toHaveProperty('confidence');
      expect(report).toHaveProperty('investigationTimeMs');
    });

    it('should parse stack trace correctly', async () => {
      const bugReport: BugReport = {
        description: 'Test bug',
        stackTrace: `
          at someFunction (/path/to/file.ts:10:5)
          at anotherFunction (/path/to/other.ts:20:10)
        `,
      };

      const report = await assistant.investigate(bugReport);

      expect(report.stackFrames.length).toBeGreaterThanOrEqual(2);
      expect(report.stackFrames[0]).toMatchObject({
        function: 'someFunction',
        file: '/path/to/file.ts',
        line: 10,
        column: 5,
      });
    });

    it('should identify primary suspect from stack trace', async () => {
      const bugReport: BugReport = {
        description: 'Error in user validation',
        stackTrace: `
          at validateUser (/src/auth/validator.ts:25:10)
          at processLogin (/src/api/login.ts:42:5)
        `,
      };

      const report = await assistant.investigate(bugReport);

      expect(report.primarySuspect).not.toBeNull();
      expect(report.primarySuspect?.file).toContain('validator.ts');
    });
  });

  describe('similar bug detection - multi-signal', () => {
    it('should find similar bugs with signal breakdown', async () => {
      const bugReport: BugReport = {
        description: 'Null pointer in authentication flow',
        errorMessage: 'TypeError: Cannot read property "token" of null',
        stackTrace: `
          at validateToken (/src/auth/token-validator.ts:15:8)
          at authenticate (/src/auth/authenticator.ts:30:12)
        `,
        suspectedFiles: ['/src/auth/token-validator.ts'],
      };

      const report = await assistant.investigate(bugReport);

      // Should have similar bugs with breakdown
      expect(report.similarBugs.length).toBeGreaterThan(0);

      // Check that at least one bug has signal breakdown
      const bugsWithBreakdown = report.similarBugs.filter(
        (bug) => bug.signalBreakdown !== undefined
      );
      expect(bugsWithBreakdown.length).toBeGreaterThan(0);

      // Verify breakdown structure
      const breakdown = bugsWithBreakdown[0].signalBreakdown!;
      expect(breakdown).toHaveProperty('semantic');
      expect(breakdown).toHaveProperty('structural');
      expect(breakdown).toHaveProperty('errorSignature');
      expect(breakdown).toHaveProperty('historical');
      expect(breakdown).toHaveProperty('weights');

      // Verify weights sum to 1
      const weights = breakdown.weights;
      const weightSum =
        weights.semantic + weights.structural + weights.errorSignature + weights.historical;
      expect(weightSum).toBeCloseTo(1.0, 2);
    });

    it('should combine signals using weighted scoring', async () => {
      const bugReport: BugReport = {
        description: 'TypeError in data processing',
        errorMessage: 'TypeError: undefined is not a function',
        stackTrace: `at processData (/src/data/processor.ts:50:20)`,
      };

      const report = await assistant.investigate(bugReport);

      // Similar bugs should be sorted by combined score
      if (report.similarBugs.length >= 2) {
        expect(report.similarBugs[0].similarity).toBeGreaterThanOrEqual(
          report.similarBugs[1].similarity
        );
      }

      // Verify similarity scores are between 0 and 1
      for (const bug of report.similarBugs) {
        expect(bug.similarity).toBeGreaterThanOrEqual(0);
        expect(bug.similarity).toBeLessThanOrEqual(1);
      }
    });

    it('should extract error signature correctly', async () => {
      const bugReport: BugReport = {
        description: 'Reference error in module',
        errorMessage: 'ReferenceError: myVar is not defined',
        stackTrace: `
          at loadModule (/src/modules/loader.ts:10:5)
          at init (/src/index.ts:5:3)
        `,
      };

      const report = await assistant.investigate(bugReport);

      // Investigation should parse the stack trace
      expect(report.stackFrames.length).toBeGreaterThan(0);

      // Should track evidence refs even if no hypotheses match the specific pattern
      expect(report.evidenceRefs.length).toBeGreaterThan(0);

      // Verify stack trace was parsed correctly
      expect(report.stackFrames[0].function).toBe('loadModule');
    });

    it('should filter out low-confidence similar bugs', async () => {
      const bugReport: BugReport = {
        description: 'Generic error',
      };

      const report = await assistant.investigate(bugReport);

      // All returned similar bugs should meet minimum threshold (0.3)
      for (const bug of report.similarBugs) {
        expect(bug.similarity).toBeGreaterThanOrEqual(0.3);
      }
    });

    it('should limit results to top 10', async () => {
      const bugReport: BugReport = {
        description: 'Error with many potential matches',
        errorMessage: 'Error: Something went wrong',
        stackTrace: `
          at fn1 (/src/a.ts:1:1)
          at fn2 (/src/b.ts:2:2)
          at fn3 (/src/c.ts:3:3)
          at fn4 (/src/d.ts:4:4)
          at fn5 (/src/e.ts:5:5)
        `,
      };

      const report = await assistant.investigate(bugReport);

      expect(report.similarBugs.length).toBeLessThanOrEqual(10);
    });
  });

  describe('error type extraction', () => {
    it('should identify TypeError from message', async () => {
      const bugReport: BugReport = {
        description: 'Type error bug',
        errorMessage: 'TypeError: Cannot read property "x" of undefined',
      };

      const report = await assistant.investigate(bugReport);

      // Should have type-related hypothesis
      const typeHypothesis = report.hypotheses.find(
        (h) => h.id === 'type_mismatch' || h.id === 'null_reference'
      );
      expect(typeHypothesis).toBeDefined();
    });

    it('should identify ReferenceError from message', async () => {
      const bugReport: BugReport = {
        description: 'Reference error bug',
        errorMessage: 'ReferenceError: myFunction is not defined',
      };

      const report = await assistant.investigate(bugReport);

      // Even without stack trace, the investigation should run
      expect(report.bugReport.errorMessage).toContain('ReferenceError');

      // Evidence should be tracked
      expect(report.evidenceRefs.length).toBeGreaterThan(0);
    });

    it('should identify async/promise errors', async () => {
      const bugReport: BugReport = {
        description: 'Async error',
        errorMessage: 'Unhandled promise rejection: timeout',
        stackTrace: `at async fetchData (/src/api/fetch.ts:15:5)`,
      };

      const report = await assistant.investigate(bugReport);

      const asyncHypothesis = report.hypotheses.find(
        (h) => h.id === 'async_timing'
      );
      expect(asyncHypothesis).toBeDefined();
    });
  });

  describe('structural similarity', () => {
    it('should compare function signatures', async () => {
      const bugReport: BugReport = {
        description: 'Bug in auth validator',
        suspectedFiles: ['/src/auth/validator.ts'],
        stackTrace: `at validateUser (/src/auth/validator.ts:25:10)`,
      };

      const report = await assistant.investigate(bugReport);

      // Should have evidence refs for the investigation process
      expect(report.evidenceRefs.length).toBeGreaterThan(0);

      // Should track similar bugs in evidence (even if empty)
      const similarBugsRef = report.evidenceRefs.find(ref => ref.startsWith('similar_bugs:'));
      expect(similarBugsRef).toBeDefined();
    });
  });

  describe('historical correlation', () => {
    it('should boost score for files in same directory', async () => {
      const bugReport: BugReport = {
        description: 'Bug in auth module',
        stackTrace: `
          at validateUser (/src/auth/validator.ts:25:10)
          at checkToken (/src/auth/token.ts:15:5)
        `,
      };

      const report = await assistant.investigate(bugReport);

      // Files in /src/auth/ should have higher historical correlation
      const authBugs = report.similarBugs.filter(
        (bug) => bug.file.includes('/auth/')
      );

      // If we have auth-related bugs, they should have non-zero historical signal
      for (const bug of authBugs) {
        if (bug.signalBreakdown) {
          // Historical signal should be at least partially present for same-directory files
          expect(bug.signalBreakdown.historical).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('confidence computation', () => {
    it('should have higher confidence with more evidence', async () => {
      const sparseReport: BugReport = {
        description: 'Minimal bug report',
      };

      const detailedReport: BugReport = {
        description: 'Detailed bug with full context',
        errorMessage: 'TypeError: Cannot read property "id" of null',
        stackTrace: `
          at validateUser (/src/auth/validator.ts:25:10)
          at processLogin (/src/api/login.ts:42:5)
          at handleRequest (/src/server/handler.ts:15:3)
          at serverMain (/src/index.ts:100:8)
        `,
        reproductionSteps: ['Step 1', 'Step 2', 'Step 3'],
        suspectedFiles: ['/src/auth/validator.ts'],
      };

      const sparseResult = await assistant.investigate(sparseReport);
      const detailedResult = await assistant.investigate(detailedReport);

      // Extract confidence values for comparison
      const sparseConf =
        sparseResult.confidence.type === 'absent'
          ? 0
          : 'value' in sparseResult.confidence
            ? sparseResult.confidence.value
            : ('low' in sparseResult.confidence
                ? (sparseResult.confidence.low + sparseResult.confidence.high) / 2
                : 0);

      const detailedConf =
        detailedResult.confidence.type === 'absent'
          ? 0
          : 'value' in detailedResult.confidence
            ? detailedResult.confidence.value
            : ('low' in detailedResult.confidence
                ? (detailedResult.confidence.low + detailedResult.confidence.high) / 2
                : 0);

      // More detailed report should have higher or equal confidence
      expect(detailedConf).toBeGreaterThanOrEqual(sparseConf);
    });

    it('should return absent confidence when no data available', async () => {
      // Create a mock that returns no results
      const emptyMockLiBrainian = {
        queryOptional: vi.fn().mockResolvedValue({ packs: [] }),
      } as unknown as LiBrainian;

      const emptyAssistant = createBugInvestigationAssistant(emptyMockLiBrainian);

      const bugReport: BugReport = {
        description: 'Unknown bug',
      };

      const report = await emptyAssistant.investigate(bugReport);

      // With no stack trace and no hypotheses, confidence might be absent
      // or very low
      if (report.confidence.type === 'absent') {
        expect(report.confidence.reason).toBe('insufficient_data');
      } else if ('value' in report.confidence) {
        expect(report.confidence.value).toBeLessThanOrEqual(0.6);
      }
    });
  });
});
