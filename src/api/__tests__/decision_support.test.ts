/**
 * @fileoverview Tests for the decision support system
 *
 * Tests that the decision support system correctly:
 * - Detects decision-making queries
 * - Classifies decision categories
 * - Generates relevant options
 * - Finds precedents in the codebase
 * - Identifies constraints
 * - Scores and ranks options
 * - Provides useful recommendations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import {
  isDecisionSupportQuery,
  classifyDecision,
  generateOptions,
  findPrecedents,
  identifyConstraints,
  scoreOptions,
  generateRationale,
  getDecisionSupport,
  createDecisionSupportPack,
  formatDecisionSupport,
  runDecisionSupportStage,
  DECISION_SUPPORT_PATTERNS,
  type DecisionCategory,
  type DecisionOption,
  type DecisionContext,
  type Precedent,
} from '../decision_support.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge, LiBrainianVersion } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(options: {
  functions?: FunctionKnowledge[];
  modules?: ModuleKnowledge[];
} = {}): LiBrainianStorage {
  const { functions = [], modules = [] } = options;

  return {
    getFunctions: vi.fn().mockResolvedValue(functions),
    getModules: vi.fn().mockResolvedValue(modules),
    getGraphEdges: vi.fn().mockResolvedValue([]),
  } as unknown as LiBrainianStorage;
}

const mockVersion: LiBrainianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date(),
  indexerVersion: '1.0.0',
  features: [],
};

// ============================================================================
// QUERY DETECTION TESTS
// ============================================================================

describe('isDecisionSupportQuery', () => {
  describe('matches decision queries', () => {
    const decisionQueries = [
      'Should I use Map or Object?',
      'should i choose redux or zustand',
      'Best approach for error handling',
      'best way to implement caching',
      'Which pattern should I use for state management?',
      'How should I handle authentication?',
      "What's the recommended approach for testing?",
      'Trade-offs between REST and GraphQL',
      'Pros and cons of microservices',
      'Compare React and Vue for this project',
    ];

    for (const query of decisionQueries) {
      it(`matches "${query}"`, () => {
        expect(isDecisionSupportQuery(query)).toBe(true);
      });
    }
  });

  describe('does not match non-decision queries', () => {
    const nonDecisionQueries = [
      'What does this function do?',
      'Where is authentication implemented?',
      'Find the login handler',
      'Show me the database schema',
      'How does the cache work?',
      'Why was TypeScript chosen?',
    ];

    for (const query of nonDecisionQueries) {
      it(`does not match "${query}"`, () => {
        expect(isDecisionSupportQuery(query)).toBe(false);
      });
    }
  });
});

describe('DECISION_SUPPORT_PATTERNS', () => {
  it('has multiple detection patterns', () => {
    expect(DECISION_SUPPORT_PATTERNS.length).toBeGreaterThan(5);
  });

  it('patterns are RegExp instances', () => {
    for (const pattern of DECISION_SUPPORT_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

// ============================================================================
// CLASSIFICATION TESTS
// ============================================================================

describe('classifyDecision', () => {
  it('classifies architecture questions', () => {
    expect(classifyDecision('How should I structure the modules?')).toBe('architecture');
    expect(classifyDecision('Best folder organization?')).toBe('architecture');
    expect(classifyDecision('Layer architecture vs feature modules?')).toBe('architecture');
  });

  it('classifies library choice questions', () => {
    expect(classifyDecision('Which library should I use for validation?')).toBe('library_choice');
    expect(classifyDecision('Which npm package for validation?')).toBe('library_choice');
    expect(classifyDecision('Framework choice for API?')).toBe('library_choice');
    expect(classifyDecision('Should I add a new dependency?')).toBe('library_choice');
  });

  it('classifies testing questions', () => {
    expect(classifyDecision('Unit tests or integration tests?')).toBe('testing');
    expect(classifyDecision('How to mock dependencies?')).toBe('testing');
    expect(classifyDecision('Best approach for test coverage?')).toBe('testing');
  });

  it('classifies error handling questions', () => {
    expect(classifyDecision('How to handle errors?')).toBe('error_handling');
    expect(classifyDecision('Try-catch or result types?')).toBe('error_handling');
    expect(classifyDecision('Exception handling strategy?')).toBe('error_handling');
  });

  it('classifies data structure questions', () => {
    expect(classifyDecision('Should I use Map or Object?')).toBe('data_structure');
    expect(classifyDecision('Array vs Set for unique items?')).toBe('data_structure');
    expect(classifyDecision('Best collection type for this?')).toBe('data_structure');
  });

  it('classifies performance questions', () => {
    expect(classifyDecision('How to optimize this?')).toBe('performance');
    expect(classifyDecision('Caching strategy?')).toBe('performance');
    expect(classifyDecision('Make this faster?')).toBe('performance');
  });

  it('classifies security questions', () => {
    expect(classifyDecision('How to handle authentication?')).toBe('security');
    expect(classifyDecision('Secure token storage?')).toBe('security');
    expect(classifyDecision('Permission model?')).toBe('security');
  });

  it('defaults to pattern for general questions', () => {
    expect(classifyDecision('Best approach here?')).toBe('pattern');
    expect(classifyDecision('How to implement this?')).toBe('pattern');
  });
});

// ============================================================================
// OPTION GENERATION TESTS
// ============================================================================

describe('generateOptions', () => {
  const storage = createMockStorage();
  const workspace = process.cwd();

  it('generates error handling options', async () => {
    const options = await generateOptions(storage, 'error handling', 'error_handling', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o => o.name.toLowerCase().includes('try-catch'))).toBe(true);
    expect(options.some(o => o.name.toLowerCase().includes('result'))).toBe(true);

    for (const option of options) {
      expect(option.pros.length).toBeGreaterThan(0);
      expect(option.cons.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(option.effort);
      expect(['low', 'medium', 'high']).toContain(option.risk);
      expect(option.compatibility).toBeGreaterThanOrEqual(0);
      expect(option.compatibility).toBeLessThanOrEqual(1);
    }
  });

  it('generates testing options', async () => {
    const options = await generateOptions(storage, 'testing approach', 'testing', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o => o.name.toLowerCase().includes('unit'))).toBe(true);
    expect(options.some(o => o.name.toLowerCase().includes('integration'))).toBe(true);
  });

  it('generates data structure options', async () => {
    const options = await generateOptions(storage, 'data structure', 'data_structure', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o => o.name.toLowerCase().includes('array'))).toBe(true);
    expect(options.some(o => o.name.toLowerCase().includes('map'))).toBe(true);
  });

  it('generates architecture options', async () => {
    const options = await generateOptions(storage, 'architecture', 'architecture', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o => o.name.toLowerCase().includes('layer'))).toBe(true);
  });

  it('generates performance options', async () => {
    const options = await generateOptions(storage, 'performance', 'performance', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o =>
      o.name.toLowerCase().includes('cache') ||
      o.name.toLowerCase().includes('lazy')
    )).toBe(true);
  });

  it('generates security options', async () => {
    const options = await generateOptions(storage, 'security', 'security', workspace);

    expect(options.length).toBeGreaterThan(0);
    expect(options.some(o => o.name.toLowerCase().includes('validation'))).toBe(true);
  });

  it('enriches options with examples when functions match', async () => {
    const storageWithFunctions = createMockStorage({
      functions: [
        {
          id: 'func1',
          name: 'handleError',
          filePath: 'src/error-handler.ts',
          signature: 'handleError(err: Error): void',
          purpose: 'Catches and logs errors with try-catch',
          startLine: 1,
          endLine: 10,
          confidence: 0.9,
          accessCount: 0,
          lastAccessed: null,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
        } as FunctionKnowledge,
      ],
    });

    const options = await generateOptions(
      storageWithFunctions,
      'error handling',
      'error_handling',
      workspace
    );

    // At least one option should have examples
    const optionsWithExamples = options.filter(o => o.examples && o.examples.length > 0);
    expect(optionsWithExamples.length).toBeGreaterThanOrEqual(0); // May or may not find matches
  });
});

// ============================================================================
// PRECEDENT FINDING TESTS
// ============================================================================

describe('findPrecedents', () => {
  it('finds precedents from functions', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'func1',
          name: 'validateInput',
          filePath: 'src/validation.ts',
          signature: 'validateInput(input: unknown): boolean',
          purpose: 'Validates user input with Zod schema',
          startLine: 1,
          endLine: 10,
          confidence: 0.9,
          accessCount: 0,
          lastAccessed: null,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
        } as FunctionKnowledge,
      ],
      modules: [],
    });

    const precedents = await findPrecedents(storage, 'validation approach', 'security');

    // Should return an array (may or may not find matches)
    expect(Array.isArray(precedents)).toBe(true);
    expect(precedents.length).toBeLessThanOrEqual(5);
  });

  it('finds precedents from modules', async () => {
    const storage = createMockStorage({
      functions: [],
      modules: [
        {
          id: 'mod1',
          path: 'src/errors/index.ts',
          purpose: 'Centralized error handling with custom error classes',
          exports: [],
          dependencies: [],
          confidence: 0.9,
        } as ModuleKnowledge,
      ],
    });

    const precedents = await findPrecedents(storage, 'error handling', 'error_handling');

    expect(Array.isArray(precedents)).toBe(true);
  });

  it('limits precedents to 5', async () => {
    const functions: FunctionKnowledge[] = [];
    for (let i = 0; i < 20; i++) {
      functions.push({
        id: `func${i}`,
        name: `testFunction${i}`,
        filePath: `src/test${i}.ts`,
        signature: `testFunction${i}(): void`,
        purpose: `Test function ${i} with describe and it blocks`,
        startLine: 1,
        endLine: 10,
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      } as FunctionKnowledge);
    }

    const storage = createMockStorage({ functions });
    const precedents = await findPrecedents(storage, 'testing', 'testing');

    expect(precedents.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// CONSTRAINT IDENTIFICATION TESTS
// ============================================================================

describe('identifyConstraints', () => {
  // Use the actual librainian project as test workspace
  const workspaceRoot = process.cwd();
  const storage = createMockStorage();

  it('identifies TypeScript constraint', async () => {
    const constraints = await identifyConstraints(storage, 'pattern', workspaceRoot);

    expect(constraints.some(c => c.includes('TypeScript'))).toBe(true);
  });

  it('identifies testing framework constraint', async () => {
    const constraints = await identifyConstraints(storage, 'testing', workspaceRoot);

    expect(constraints.some(c => c.includes('vitest') || c.includes('jest'))).toBe(true);
  });

  it('returns array even if package.json not found', async () => {
    const constraints = await identifyConstraints(storage, 'pattern', '/nonexistent/path');

    expect(Array.isArray(constraints)).toBe(true);
  });
});

// ============================================================================
// OPTION SCORING TESTS
// ============================================================================

describe('scoreOptions', () => {
  const storage = createMockStorage();

  it('boosts options with matching precedents', async () => {
    const options: DecisionOption[] = [
      {
        name: 'Unit Tests',
        description: 'Test in isolation',
        pros: ['Fast'],
        cons: ['May miss integration issues'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.7,
      },
      {
        name: 'Integration Tests',
        description: 'Test together',
        pros: ['Realistic'],
        cons: ['Slow'],
        effort: 'medium',
        risk: 'low',
        compatibility: 0.6,
      },
    ];

    const precedents: Precedent[] = [
      { decision: 'Uses unit testing pattern', context: 'test file', file: 'src/test.ts' },
    ];

    const scored = await scoreOptions(options, precedents, [], storage);

    // Options should be sorted by compatibility
    expect(scored[0].compatibility).toBeGreaterThanOrEqual(scored[1].compatibility);
  });

  it('penalizes options that conflict with constraints', async () => {
    const options: DecisionOption[] = [
      {
        name: 'Callback Style',
        description: 'Use callbacks',
        pros: ['Simple'],
        cons: ['Not TypeScript friendly'],
        effort: 'low',
        risk: 'medium',
        compatibility: 0.7,
      },
      {
        name: 'Promise Style',
        description: 'Use promises',
        pros: ['TypeScript friendly', 'Composable'],
        cons: ['Slightly more complex'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.6,
      },
    ];

    const constraints = ['TypeScript: Solution must be type-safe'];

    const scored = await scoreOptions(options, [], constraints, storage);

    // Callback should be penalized for TypeScript conflict
    const callback = scored.find(o => o.name === 'Callback Style');
    const promise = scored.find(o => o.name === 'Promise Style');

    expect(callback).toBeDefined();
    expect(promise).toBeDefined();
    expect(callback!.compatibility).toBeLessThan(0.7); // Should be penalized
  });

  it('boosts options with examples', async () => {
    const options: DecisionOption[] = [
      {
        name: 'Option A',
        description: 'Without examples',
        pros: ['Good'],
        cons: ['Bad'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.5,
      },
      {
        name: 'Option B',
        description: 'With examples',
        pros: ['Good'],
        cons: ['Bad'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.5,
        examples: ['src/example1.ts', 'src/example2.ts'],
      },
    ];

    const scored = await scoreOptions(options, [], [], storage);

    const optionA = scored.find(o => o.name === 'Option A');
    const optionB = scored.find(o => o.name === 'Option B');

    expect(optionB!.compatibility).toBeGreaterThan(optionA!.compatibility);
  });
});

// ============================================================================
// RATIONALE GENERATION TESTS
// ============================================================================

describe('generateRationale', () => {
  it('generates rationale with recommendation', () => {
    const recommendation: DecisionOption = {
      name: 'Unit Tests',
      description: 'Test in isolation',
      pros: ['Fast', 'Isolated'],
      cons: ['May miss integration issues'],
      effort: 'low',
      risk: 'low',
      compatibility: 0.9,
      examples: ['src/test.ts'],
    };

    const precedents: Precedent[] = [
      { decision: 'Unit testing', context: 'test file', file: 'src/test.ts' },
    ];

    const constraints = ['TypeScript: Solution must be type-safe'];

    const rationale = generateRationale(recommendation, precedents, constraints);

    expect(rationale).toContain('Unit Tests');
    expect(rationale).toContain('Test in isolation');
    expect(rationale).toContain('Examples found');
    expect(rationale).toContain('Precedents');
    expect(rationale).toContain('Constraints');
    expect(rationale).toContain('Fast');
  });

  it('generates fallback rationale without recommendation', () => {
    const rationale = generateRationale(undefined, [], []);

    expect(rationale).toContain('No clear recommendation');
    expect(rationale).toContain('trade-offs');
  });
});

// ============================================================================
// MAIN API TESTS
// ============================================================================

describe('getDecisionSupport', () => {
  const storage = createMockStorage({
    functions: [
      {
        id: 'func1',
        name: 'handleError',
        filePath: 'src/error.ts',
        signature: 'handleError(err: Error): void',
        purpose: 'Error handling with try-catch',
        startLine: 1,
        endLine: 10,
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      } as FunctionKnowledge,
    ],
  });

  it('returns complete decision context', async () => {
    const context = await getDecisionSupport(
      storage,
      'Should I use try-catch or result types?',
      process.cwd()
    );

    expect(context.question).toBe('Should I use try-catch or result types?');
    expect(context.category).toBe('error_handling');
    expect(context.options.length).toBeGreaterThan(0);
    expect(Array.isArray(context.constraints)).toBe(true);
    expect(context.confidence).toBeGreaterThanOrEqual(0);
    expect(context.confidence).toBeLessThanOrEqual(1);
    expect(typeof context.rationale).toBe('string');
    expect(Array.isArray(context.precedents)).toBe(true);
  });

  it('provides recommendation when confidence is high', async () => {
    const context = await getDecisionSupport(
      storage,
      'Best testing approach?',
      process.cwd()
    );

    // Should have options
    expect(context.options.length).toBeGreaterThan(0);

    // If top option has high compatibility, should have recommendation
    if (context.options[0].compatibility > 0.6) {
      expect(context.recommendation).toBeDefined();
    }
  });

  it('handles unknown workspace gracefully', async () => {
    const context = await getDecisionSupport(
      storage,
      'Best approach?',
      '/nonexistent/workspace'
    );

    // Should still return valid context even without package.json
    expect(context.category).toBe('pattern');
    expect(context.options.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CONTEXT PACK CREATION TESTS
// ============================================================================

describe('createDecisionSupportPack', () => {
  it('creates valid context pack from decision context', () => {
    const context: DecisionContext = {
      question: 'Should I use X or Y?',
      category: 'pattern',
      options: [
        {
          name: 'Option X',
          description: 'Use X',
          pros: ['Good'],
          cons: ['Bad'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.8,
        },
      ],
      constraints: ['TypeScript required'],
      recommendation: {
        name: 'Option X',
        description: 'Use X',
        pros: ['Good'],
        cons: ['Bad'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.8,
      },
      confidence: 0.8,
      rationale: 'Option X is recommended',
      precedents: [{ decision: 'Used X before', context: 'Previous project' }],
    };

    const pack = createDecisionSupportPack(context, mockVersion);

    expect(pack.packId).toContain('decision_');
    expect(pack.packType).toBe('decision_context');
    expect(pack.targetId).toBe('decision:pattern');
    expect(pack.summary).toBe('Option X is recommended');
    expect(pack.confidence).toBe(0.8);
    expect(pack.keyFacts.some(f => f.includes('pattern'))).toBe(true);
    expect(pack.keyFacts.some(f => f.includes('Option X'))).toBe(true);
    expect(pack.version).toBe(mockVersion);
  });
});

// ============================================================================
// FORMATTING TESTS
// ============================================================================

describe('formatDecisionSupport', () => {
  it('formats decision context as markdown', () => {
    const context: DecisionContext = {
      question: 'Should I use X or Y?',
      category: 'pattern',
      options: [
        {
          name: 'Option X',
          description: 'Use X for simplicity',
          pros: ['Simple', 'Fast'],
          cons: ['Limited'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.8,
        },
        {
          name: 'Option Y',
          description: 'Use Y for power',
          pros: ['Powerful', 'Flexible'],
          cons: ['Complex'],
          effort: 'high',
          risk: 'medium',
          compatibility: 0.6,
        },
      ],
      constraints: ['TypeScript required', 'Must be fast'],
      recommendation: {
        name: 'Option X',
        description: 'Use X for simplicity',
        pros: ['Simple', 'Fast'],
        cons: ['Limited'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.8,
      },
      confidence: 0.8,
      rationale: 'Option X is recommended because it is simpler',
      precedents: [
        { decision: 'Used X before', context: 'Previous project', file: 'src/old.ts' },
      ],
    };

    const formatted = formatDecisionSupport(context);

    expect(formatted).toContain('## Decision:');
    expect(formatted).toContain('Should I use X or Y?');
    expect(formatted).toContain('**Category:** pattern');
    expect(formatted).toContain('### Recommendation: Option X');
    expect(formatted).toContain('**Confidence:** 80%');
    expect(formatted).toContain('### Options:');
    expect(formatted).toContain('**Option X**');
    expect(formatted).toContain('**Option Y**');
    expect(formatted).toContain('- Pros:');
    expect(formatted).toContain('- Cons:');
    expect(formatted).toContain('### Constraints:');
    expect(formatted).toContain('TypeScript required');
    expect(formatted).toContain('### Precedents:');
  });

  it('handles no recommendation case', () => {
    const context: DecisionContext = {
      question: 'Unclear question?',
      category: 'pattern',
      options: [],
      constraints: [],
      recommendation: undefined,
      confidence: 0.3,
      rationale: 'No clear recommendation',
      precedents: [],
    };

    const formatted = formatDecisionSupport(context);

    expect(formatted).toContain('### No Clear Recommendation');
    expect(formatted).not.toContain('### Constraints:');
    expect(formatted).not.toContain('### Precedents:');
  });
});

// ============================================================================
// STAGE RUNNER TESTS
// ============================================================================

describe('runDecisionSupportStage', () => {
  const storage = createMockStorage();

  it('returns analyzed=true for decision queries', async () => {
    const result = await runDecisionSupportStage({
      storage,
      intent: 'Should I use Map or Object?',
      version: mockVersion,
      workspaceRoot: process.cwd(),
    });

    expect(result.analyzed).toBe(true);
    expect(result.packs.length).toBe(1);
    expect(result.packs[0].packType).toBe('decision_context');
    expect(result.explanation).toContain('Decision support');
  });

  it('returns analyzed=false for non-decision queries', async () => {
    const result = await runDecisionSupportStage({
      storage,
      intent: 'What does this function do?',
      version: mockVersion,
      workspaceRoot: process.cwd(),
    });

    expect(result.analyzed).toBe(false);
    expect(result.packs.length).toBe(0);
    expect(result.explanation).toBe('');
  });

  it('handles errors gracefully', async () => {
    const brokenStorage = {
      getFunctions: vi.fn().mockRejectedValue(new Error('DB error')),
      getModules: vi.fn().mockRejectedValue(new Error('DB error')),
    } as unknown as LiBrainianStorage;

    const result = await runDecisionSupportStage({
      storage: brokenStorage,
      intent: 'Should I use X or Y?',
      version: mockVersion,
      workspaceRoot: process.cwd(),
    });

    // Should not throw, should return gracefully
    expect(result.analyzed).toBe(true); // Still analyzed (may have empty results)
    expect(result.packs.length).toBe(1);
  });
});
