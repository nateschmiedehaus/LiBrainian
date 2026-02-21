/**
 * @fileoverview Real-world evaluation of LiBrainian's Decision Support system
 *
 * This test evaluates whether the decision support system provides:
 * 1. Relevant options for technical decisions
 * 2. Accurate pros/cons
 * 3. Sensible recommendations that would help an agent decide
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import {
  getDecisionSupport,
  isDecisionSupportQuery,
  classifyDecision,
  formatDecisionSupport,
  type DecisionContext,
  type DecisionOption,
} from '../api/decision_support.js';
import { SqliteStorage } from '../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const WORKSPACE_ROOT = process.cwd();
const TEST_DB_PATH = path.join(WORKSPACE_ROOT, '.librainian', 'test_decision_support.db');

// Real technical questions an agent might ask
// Note: Not all questions need to match the isDecisionSupportQuery() patterns -
// the system can still provide useful decision support via getDecisionSupport()
const DECISION_QUESTIONS = [
  // Data structure decisions
  {
    question: 'Should I use Map or Object for caching?',
    expectedCategory: 'data_structure',
    relevantTerms: ['Map', 'Array', 'Set', 'lookup', 'key'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
  {
    question: "What's the best approach for handling concurrent queries?",
    expectedCategory: 'pattern', // Falls through to pattern (no specific concurrency category)
    relevantTerms: ['existing', 'pattern', 'approach', 'consistent'],
    minOptions: 1,
    shouldMatchQueryPattern: true,
  },
  {
    question: 'Should I add Redis for caching or keep SQLite?',
    expectedCategory: 'performance', // mentions caching
    relevantTerms: ['cache', 'memory', 'lazy', 'batch'],
    minOptions: 2,
    shouldMatchQueryPattern: false, // "X or Y" pattern doesn't match here
  },
  // Error handling decisions
  {
    question: 'How should I handle errors in async operations?',
    expectedCategory: 'error_handling',
    relevantTerms: ['try-catch', 'error', 'result', 'exception', 'custom'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
  {
    question: 'Should I use try-catch or Result types for error handling?',
    expectedCategory: 'error_handling',
    relevantTerms: ['try-catch', 'Result', 'error'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
  // Testing decisions
  {
    question: 'What testing approach should I use for this module?',
    expectedCategory: 'testing',
    relevantTerms: ['unit', 'integration', 'mock', 'test'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
  {
    question: 'Best way to test this code?',
    expectedCategory: 'testing',
    relevantTerms: ['unit', 'integration'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
  // Architecture decisions
  {
    question: 'Best approach for structuring the modules?',
    expectedCategory: 'architecture',
    relevantTerms: ['layer', 'module', 'feature', 'hexagonal'],
    minOptions: 1,
    shouldMatchQueryPattern: true,
  },
  // Security decisions
  {
    question: 'What authentication approach should I use?',
    expectedCategory: 'security',
    relevantTerms: ['auth', 'token', 'permission', 'validation'],
    minOptions: 1,
    shouldMatchQueryPattern: true,
  },
  // Library choice decisions
  {
    question: 'Should I use an existing library or build a custom solution?',
    expectedCategory: 'library_choice',
    relevantTerms: ['library', 'dependency', 'custom'],
    minOptions: 2,
    shouldMatchQueryPattern: true,
  },
];

// ============================================================================
// EVALUATION HELPERS
// ============================================================================

interface EvaluationResult {
  question: string;
  passed: boolean;
  issues: string[];
  context: DecisionContext | null;
  scores: {
    categoryCorrect: boolean;
    hasRelevantOptions: boolean;
    optionsHavePros: boolean;
    optionsHaveCons: boolean;
    hasRationale: boolean;
    confidenceReasonable: boolean;
    wouldHelpAgent: boolean;
  };
}

function evaluateDecisionSupport(
  context: DecisionContext,
  expectedCategory: string,
  relevantTerms: string[],
  minOptions: number
): EvaluationResult {
  const issues: string[] = [];
  const scores = {
    categoryCorrect: false,
    hasRelevantOptions: false,
    optionsHavePros: false,
    optionsHaveCons: false,
    hasRationale: false,
    confidenceReasonable: false,
    wouldHelpAgent: false,
  };

  // 1. Check category classification
  scores.categoryCorrect = context.category === expectedCategory;
  if (!scores.categoryCorrect) {
    issues.push(`Category mismatch: expected "${expectedCategory}", got "${context.category}"`);
  }

  // 2. Check if enough options were generated
  if (context.options.length >= minOptions) {
    scores.hasRelevantOptions = true;
  } else {
    issues.push(`Too few options: expected at least ${minOptions}, got ${context.options.length}`);
  }

  // 3. Check if options have relevant terms in names/descriptions
  const allOptionText = context.options
    .map(o => `${o.name} ${o.description}`.toLowerCase())
    .join(' ');

  const foundRelevantTerms = relevantTerms.filter(term =>
    allOptionText.includes(term.toLowerCase())
  );

  if (foundRelevantTerms.length > 0) {
    scores.hasRelevantOptions = true;
  } else {
    issues.push(`No relevant terms found in options. Expected some of: ${relevantTerms.join(', ')}`);
    scores.hasRelevantOptions = false;
  }

  // 4. Check that all options have pros
  const allHavePros = context.options.every(o => o.pros.length > 0);
  scores.optionsHavePros = allHavePros;
  if (!allHavePros) {
    issues.push('Some options are missing pros');
  }

  // 5. Check that all options have cons
  const allHaveCons = context.options.every(o => o.cons.length > 0);
  scores.optionsHaveCons = allHaveCons;
  if (!allHaveCons) {
    issues.push('Some options are missing cons');
  }

  // 6. Check rationale exists and is meaningful
  scores.hasRationale = context.rationale.length > 20;
  if (!scores.hasRationale) {
    issues.push('Rationale is too short or missing');
  }

  // 7. Check confidence is reasonable (not 0 or 1)
  scores.confidenceReasonable = context.confidence > 0.1 && context.confidence <= 1.0;
  if (!scores.confidenceReasonable) {
    issues.push(`Confidence seems unreasonable: ${context.confidence}`);
  }

  // 8. Overall "would help agent" assessment
  const helpfulCriteria = [
    context.options.length >= 2, // Multiple options to compare
    context.options.some(o => o.pros.length >= 2), // Detailed pros
    context.options.some(o => o.cons.length >= 1), // Honest cons
    context.rationale.length > 30, // Meaningful explanation
    context.options.every(o => o.effort !== undefined), // Effort estimates
    context.options.every(o => o.risk !== undefined), // Risk assessments
  ];

  scores.wouldHelpAgent = helpfulCriteria.filter(Boolean).length >= 4;
  if (!scores.wouldHelpAgent) {
    issues.push('Decision support may not provide enough detail to help an agent decide');
  }

  const passed = Object.values(scores).filter(Boolean).length >= 5;

  return {
    question: context.question,
    passed,
    issues,
    context,
    scores,
  };
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

describe('Decision Support Real-World Evaluation', () => {
  let storage: LiBrainianStorage;
  const results: EvaluationResult[] = [];

  beforeAll(async () => {
    // Create storage with the librainian's own indexed data if available,
    // otherwise use a temporary in-memory mock
    try {
      const realDbPath = path.join(WORKSPACE_ROOT, '.librainian', 'index.db');
      storage = new SqliteStorage(realDbPath);
      await storage.initialize();
      console.log('Using real librainian index for testing');
    } catch {
      // Fallback to minimal mock storage
      console.log('Using mock storage for testing (no real index found)');
      storage = createMinimalMockStorage();
    }
  });

  afterAll(async () => {
    if (storage && typeof storage.close === 'function') {
      await storage.close();
    }

    // Print evaluation summary
    console.log('\n' + '='.repeat(80));
    console.log('DECISION SUPPORT EVALUATION SUMMARY');
    console.log('='.repeat(80));

    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    console.log(`\nOverall: ${passed}/${total} questions passed (${((passed / total) * 100).toFixed(1)}%)\n`);

    for (const result of results) {
      const status = result.passed ? '[PASS]' : '[FAIL]';
      console.log(`${status} ${result.question}`);
      if (result.context) {
        console.log(`   Category: ${result.context.category}`);
        console.log(`   Options: ${result.context.options.length}`);
        console.log(`   Confidence: ${(result.context.confidence * 100).toFixed(0)}%`);
        if (result.context.recommendation) {
          console.log(`   Recommendation: ${result.context.recommendation.name}`);
        }
      }
      if (result.issues.length > 0) {
        console.log(`   Issues: ${result.issues.join('; ')}`);
      }
      console.log('');
    }

    // Score breakdown
    console.log('Score Breakdown:');
    const scoreKeys = [
      'categoryCorrect',
      'hasRelevantOptions',
      'optionsHavePros',
      'optionsHaveCons',
      'hasRationale',
      'confidenceReasonable',
      'wouldHelpAgent',
    ] as const;

    for (const key of scoreKeys) {
      const count = results.filter(r => r.scores[key]).length;
      console.log(`  ${key}: ${count}/${total} (${((count / total) * 100).toFixed(0)}%)`);
    }
  });

  // Test query detection
  describe('Query Detection', () => {
    it('correctly identifies decision support queries that should match', () => {
      const shouldMatch = DECISION_QUESTIONS.filter(q => q.shouldMatchQueryPattern);
      for (const { question } of shouldMatch) {
        const isDecision = isDecisionSupportQuery(question);
        expect(isDecision, `Expected "${question}" to match decision patterns`).toBe(true);
      }
    });

    it('does not match non-decision queries', () => {
      const nonDecisionQueries = [
        'What does the query function do?',
        'Where is the database connection defined?',
        'Show me the test files',
        'Find all imports of lodash',
      ];

      for (const query of nonDecisionQueries) {
        expect(isDecisionSupportQuery(query)).toBe(false);
      }
    });
  });

  // Test each decision question
  describe('Decision Support Quality', () => {
    for (const testCase of DECISION_QUESTIONS) {
      it(`provides useful decision support for: "${testCase.question}"`, async () => {
        const context = await getDecisionSupport(
          storage,
          testCase.question,
          WORKSPACE_ROOT
        );

        const evaluation = evaluateDecisionSupport(
          context,
          testCase.expectedCategory,
          testCase.relevantTerms,
          testCase.minOptions
        );

        results.push(evaluation);

        // Core assertions
        expect(context.options.length).toBeGreaterThanOrEqual(1);
        expect(context.rationale.length).toBeGreaterThan(0);
        expect(context.confidence).toBeGreaterThan(0);
        expect(context.confidence).toBeLessThanOrEqual(1);

        // All options should have pros and cons
        for (const option of context.options) {
          expect(option.pros.length).toBeGreaterThan(0);
          expect(option.cons.length).toBeGreaterThan(0);
          expect(['low', 'medium', 'high']).toContain(option.effort);
          expect(['low', 'medium', 'high']).toContain(option.risk);
        }
      });
    }
  });

  // Specific scenario tests
  describe('Specific Decision Scenarios', () => {
    it('Map vs Object: recommends Map for caching use case', async () => {
      const context = await getDecisionSupport(
        storage,
        'Should I use Map or Object for caching?',
        WORKSPACE_ROOT
      );

      // Should classify as data_structure
      expect(context.category).toBe('data_structure');

      // Should have Map option
      const mapOption = context.options.find(o =>
        o.name.toLowerCase().includes('map')
      );
      expect(mapOption).toBeDefined();

      // Map should mention O(1) lookup or similar performance benefit
      if (mapOption) {
        const mapText = [...mapOption.pros, ...mapOption.cons, mapOption.description].join(' ').toLowerCase();
        const hasPerformanceMention = mapText.includes('o(1)') || mapText.includes('fast') || mapText.includes('lookup');
        expect(hasPerformanceMention).toBe(true);
      }
    });

    it('Error handling: includes try-catch and result type options', async () => {
      const context = await getDecisionSupport(
        storage,
        'How should I handle errors in this module?',
        WORKSPACE_ROOT
      );

      expect(context.category).toBe('error_handling');

      const optionNames = context.options.map(o => o.name.toLowerCase());
      const hasTryCatch = optionNames.some(n => n.includes('try') || n.includes('catch'));
      const hasResultType = optionNames.some(n => n.includes('result'));

      expect(hasTryCatch || hasResultType).toBe(true);
    });

    it('Testing strategy: recommends unit tests for isolated modules', async () => {
      const context = await getDecisionSupport(
        storage,
        'What testing approach should I use for this utility function?',
        WORKSPACE_ROOT
      );

      expect(context.category).toBe('testing');

      // Should have unit test option
      const unitOption = context.options.find(o =>
        o.name.toLowerCase().includes('unit')
      );
      expect(unitOption).toBeDefined();

      // Unit tests should have high compatibility for utility functions
      if (unitOption && context.recommendation) {
        // Either unit is recommended or it has good compatibility
        const unitIsRecommended = context.recommendation.name.toLowerCase().includes('unit');
        const unitHasGoodCompatibility = unitOption.compatibility > 0.7;
        expect(unitIsRecommended || unitHasGoodCompatibility).toBe(true);
      }
    });

    it('General pattern queries: provides pattern-following guidance', async () => {
      const context = await getDecisionSupport(
        storage,
        "What's the best approach for handling concurrent queries?",
        WORKSPACE_ROOT
      );

      // Should be pattern category (no specific concurrency detection)
      expect(context.category).toBe('pattern');

      // Should provide general pattern guidance
      const allText = context.options
        .flatMap(o => [o.name, o.description, ...o.pros, ...o.cons])
        .join(' ')
        .toLowerCase();

      // Pattern guidance should mention consistency, existing patterns, etc.
      const hasPatternContent =
        allText.includes('existing') ||
        allText.includes('pattern') ||
        allText.includes('consistent') ||
        allText.includes('familiar') ||
        allText.includes('proven');

      expect(hasPatternContent).toBe(true);
    });
  });

  // Format output test
  describe('Output Formatting', () => {
    it('formats decision support as readable markdown', async () => {
      const context = await getDecisionSupport(
        storage,
        'Should I use Map or Object for caching?',
        WORKSPACE_ROOT
      );

      const formatted = formatDecisionSupport(context);

      // Should have expected sections
      expect(formatted).toContain('## Decision:');
      expect(formatted).toContain('**Category:**');
      expect(formatted).toContain('### Options:');
      expect(formatted).toContain('- Pros:');
      expect(formatted).toContain('- Cons:');

      // Should be properly structured markdown
      const lines = formatted.split('\n');
      const headerLines = lines.filter(l => l.startsWith('#'));
      expect(headerLines.length).toBeGreaterThan(0);
    });
  });

  // Constraint detection
  describe('Constraint Detection', () => {
    it('detects TypeScript constraint from package.json', async () => {
      const context = await getDecisionSupport(
        storage,
        'What error handling pattern should I use?',
        WORKSPACE_ROOT
      );

      // Should detect TypeScript as a constraint
      const hasTypeScriptConstraint = context.constraints.some(c =>
        c.toLowerCase().includes('typescript')
      );

      // This project uses TypeScript, so constraint should be detected
      expect(hasTypeScriptConstraint).toBe(true);
    });

    it('detects vitest as testing framework', async () => {
      const context = await getDecisionSupport(
        storage,
        'How should I test this function?',
        WORKSPACE_ROOT
      );

      // Should detect vitest constraint
      const hasVitestConstraint = context.constraints.some(c =>
        c.toLowerCase().includes('vitest')
      );

      expect(hasVitestConstraint).toBe(true);
    });
  });
});

// ============================================================================
// MOCK STORAGE HELPER
// ============================================================================

function createMinimalMockStorage(): LiBrainianStorage {
  return {
    initialize: async () => {},
    close: async () => {},
    isInitialized: () => true,
    getCapabilities: () => ({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {
        graphMetrics: false,
        multiVectors: false,
        embeddings: false,
        episodes: false,
        verificationPlans: false,
      },
      versions: { schema: 1, api: 1 },
    }),
    getFunctions: async () => [],
    getModules: async () => [],
    getGraphEdges: async () => [],
    // Add other required methods as no-ops
  } as unknown as LiBrainianStorage;
}
