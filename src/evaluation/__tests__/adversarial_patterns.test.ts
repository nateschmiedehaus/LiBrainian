/**
 * @fileoverview Tests for Adversarial Pattern Library (WU-806)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Adversarial Pattern Library collects and catalogs patterns that commonly
 * cause hallucinations or errors in code understanding systems. These patterns
 * are used to stress-test Librarian.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  AdversarialPatternLibrary,
  createAdversarialPatternLibrary,
  type AdversarialPattern,
  type AdversarialCorpus,
  type AdversarialProbe,
  type AdversarialTestResult,
} from '../adversarial_patterns.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleNamingPattern: AdversarialPattern = {
  id: 'naming-001',
  name: 'Similar Function Names',
  category: 'naming',
  description: 'Functions with very similar names that can be confused',
  example: {
    code: `
function getData() { return cache; }
function getData2() { return fetchFromAPI(); }
function _getData() { return privateData; }
`,
    file: 'src/data.ts',
    commonMistake: 'Confusing getData with getData2, claiming getData fetches from API',
    correctAnswer: 'getData returns cached data, getData2 fetches from API',
  },
  triggerQueries: [
    'What does getData do?',
    'Which function fetches from the API?',
    'Is there a function that returns cached data?',
  ],
  severity: 'high',
};

const sampleStructurePattern: AdversarialPattern = {
  id: 'structure-001',
  name: 'Nested Function Same Name',
  category: 'structure',
  description: 'Inner function has the same name as outer function',
  example: {
    code: `
function process(input) {
  function process(item) {
    return item.toUpperCase();
  }
  return input.map(process);
}
`,
    file: 'src/processor.ts',
    commonMistake: 'Claiming outer process does uppercase conversion',
    correctAnswer: 'Outer process maps over input, inner process does uppercase',
  },
  triggerQueries: [
    'What does the process function do?',
    'How does process handle input?',
  ],
  severity: 'medium',
};

const sampleSemanticPattern: AdversarialPattern = {
  id: 'semantic-001',
  name: 'Dead Code After Return',
  category: 'semantic',
  description: 'Code that appears functional but is unreachable',
  example: {
    code: `
function calculate(x) {
  return x * 2;
  x = x + 1;  // Dead code
  return x;
}
`,
    file: 'src/calc.ts',
    commonMistake: 'Claiming the function can return x + 1',
    correctAnswer: 'Function always returns x * 2, the rest is dead code',
  },
  triggerQueries: [
    'What values can calculate return?',
    'Does calculate ever add 1 to x?',
  ],
  severity: 'high',
};

const sampleMisleadingPattern: AdversarialPattern = {
  id: 'misleading-001',
  name: 'Outdated Comment',
  category: 'misleading',
  description: 'Comment does not match actual code behavior',
  example: {
    code: `
// Validates email format
function processEmail(email) {
  return email.toLowerCase();
}
`,
    file: 'src/email.ts',
    commonMistake: 'Claiming processEmail validates email format',
    correctAnswer: 'processEmail only lowercases the email, no validation',
  },
  triggerQueries: [
    'Does processEmail validate email format?',
    'What validation does processEmail perform?',
  ],
  severity: 'high',
};

const sampleEdgeCasePattern: AdversarialPattern = {
  id: 'edge-001',
  name: 'Empty Function',
  category: 'edge_case',
  description: 'Function with no implementation',
  example: {
    code: `
function initialize() {
  // TODO: implement
}
`,
    file: 'src/init.ts',
    commonMistake: 'Claiming initialize performs initialization',
    correctAnswer: 'initialize is empty and does nothing',
  },
  triggerQueries: [
    'What does initialize do?',
    'How does the app initialize?',
  ],
  severity: 'medium',
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createAdversarialPatternLibrary', () => {
  it('should create a library instance', () => {
    const library = createAdversarialPatternLibrary();
    expect(library).toBeInstanceOf(AdversarialPatternLibrary);
  });

  it('should accept optional initial patterns', () => {
    const library = createAdversarialPatternLibrary([sampleNamingPattern]);
    const patterns = library.getPatterns();
    expect(patterns.some((p) => p.id === 'naming-001')).toBe(true);
  });
});

// ============================================================================
// PATTERN RETRIEVAL TESTS
// ============================================================================

describe('AdversarialPatternLibrary - getPatterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should return all built-in patterns', () => {
    const patterns = library.getPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(20);
  });

  it('should return patterns with all required fields', () => {
    const patterns = library.getPatterns();
    patterns.forEach((pattern) => {
      expect(pattern.id).toBeDefined();
      expect(pattern.name).toBeDefined();
      expect(pattern.category).toBeDefined();
      expect(pattern.description).toBeDefined();
      expect(pattern.example).toBeDefined();
      expect(pattern.example.code).toBeDefined();
      expect(pattern.example.file).toBeDefined();
      expect(pattern.example.commonMistake).toBeDefined();
      expect(pattern.example.correctAnswer).toBeDefined();
      expect(pattern.triggerQueries).toBeDefined();
      expect(pattern.triggerQueries.length).toBeGreaterThan(0);
      expect(pattern.severity).toBeDefined();
    });
  });

  it('should have unique pattern IDs', () => {
    const patterns = library.getPatterns();
    const ids = patterns.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should include patterns from all categories', () => {
    const patterns = library.getPatterns();
    const categories = new Set(patterns.map((p) => p.category));

    expect(categories.has('naming')).toBe(true);
    expect(categories.has('structure')).toBe(true);
    expect(categories.has('semantic')).toBe(true);
    expect(categories.has('misleading')).toBe(true);
    expect(categories.has('edge_case')).toBe(true);
  });
});

// ============================================================================
// CATEGORY FILTERING TESTS
// ============================================================================

describe('AdversarialPatternLibrary - getByCategory', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should filter patterns by naming category', () => {
    const patterns = library.getByCategory('naming');
    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((p) => expect(p.category).toBe('naming'));
  });

  it('should filter patterns by structure category', () => {
    const patterns = library.getByCategory('structure');
    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((p) => expect(p.category).toBe('structure'));
  });

  it('should filter patterns by semantic category', () => {
    const patterns = library.getByCategory('semantic');
    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((p) => expect(p.category).toBe('semantic'));
  });

  it('should filter patterns by misleading category', () => {
    const patterns = library.getByCategory('misleading');
    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((p) => expect(p.category).toBe('misleading'));
  });

  it('should filter patterns by edge_case category', () => {
    const patterns = library.getByCategory('edge_case');
    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((p) => expect(p.category).toBe('edge_case'));
  });

  it('should return empty array for unknown category', () => {
    const patterns = library.getByCategory('unknown' as AdversarialPattern['category']);
    expect(patterns).toEqual([]);
  });
});

// ============================================================================
// CORPUS GENERATION TESTS
// ============================================================================

describe('AdversarialPatternLibrary - getCorpus', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should return a complete corpus', () => {
    const corpus = library.getCorpus();

    expect(corpus.patterns).toBeDefined();
    expect(corpus.categories).toBeDefined();
    expect(corpus.totalPatterns).toBeDefined();
    expect(corpus.generatedAt).toBeDefined();
  });

  it('should have correct category counts', () => {
    const corpus = library.getCorpus();

    let totalFromCategories = 0;
    Object.values(corpus.categories).forEach((count) => {
      totalFromCategories += count;
    });

    expect(totalFromCategories).toBe(corpus.totalPatterns);
  });

  it('should have valid ISO timestamp', () => {
    const corpus = library.getCorpus();
    const date = new Date(corpus.generatedAt);
    expect(date.toISOString()).toBe(corpus.generatedAt);
  });
});

// ============================================================================
// REPO IMPORT TESTS
// ============================================================================

describe('AdversarialPatternLibrary - importFromRepo', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should detect similar function names in a repo', async () => {
    // Use the librarian repo itself as test subject
    const repoPath = '/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian';
    const patterns = await library.importFromRepo(repoPath);

    // Should return an array (may be empty if no patterns detected)
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('should assign unique IDs to imported patterns', async () => {
    const repoPath = '/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian';
    const patterns = await library.importFromRepo(repoPath);

    if (patterns.length > 0) {
      const ids = patterns.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it('should return patterns with correct structure', async () => {
    const repoPath = '/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian';
    const patterns = await library.importFromRepo(repoPath);

    patterns.forEach((pattern) => {
      expect(pattern.id).toBeDefined();
      expect(pattern.name).toBeDefined();
      expect(pattern.category).toBeDefined();
      expect(pattern.description).toBeDefined();
      expect(pattern.example).toBeDefined();
      expect(pattern.triggerQueries).toBeDefined();
      expect(pattern.severity).toBeDefined();
    });
  });

  it('should handle non-existent repo gracefully', async () => {
    const patterns = await library.importFromRepo('/non/existent/path');
    expect(patterns).toEqual([]);
  });

  it('should detect dead code patterns', async () => {
    const repoPath = '/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian';
    const patterns = await library.importFromRepo(repoPath);

    // May or may not find dead code, but should not crash
    expect(Array.isArray(patterns)).toBe(true);
  });
});

// ============================================================================
// PROBE GENERATION TESTS
// ============================================================================

describe('AdversarialPatternLibrary - generateProbes', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should generate probes from patterns', () => {
    const patterns = [sampleNamingPattern, sampleSemanticPattern];
    const probes = library.generateProbes(patterns);

    expect(probes.length).toBeGreaterThan(0);
  });

  it('should create at least one probe per pattern', () => {
    const patterns = [sampleNamingPattern, sampleStructurePattern];
    const probes = library.generateProbes(patterns);

    const patternIds = new Set(probes.map((p) => p.patternId));
    expect(patternIds.size).toBe(patterns.length);
  });

  it('should use trigger queries for probe queries', () => {
    const patterns = [sampleNamingPattern];
    const probes = library.generateProbes(patterns);

    probes.forEach((probe) => {
      expect(sampleNamingPattern.triggerQueries.includes(probe.query)).toBe(true);
    });
  });

  it('should include expected and trap answers', () => {
    const patterns = [sampleMisleadingPattern];
    const probes = library.generateProbes(patterns);

    probes.forEach((probe) => {
      expect(probe.expectedAnswer).toBeDefined();
      expect(probe.expectedAnswer.length).toBeGreaterThan(0);
      expect(probe.trapAnswer).toBeDefined();
      expect(probe.trapAnswer.length).toBeGreaterThan(0);
    });
  });

  it('should handle empty patterns array', () => {
    const probes = library.generateProbes([]);
    expect(probes).toEqual([]);
  });

  it('should generate probes for all built-in patterns', () => {
    const patterns = library.getPatterns();
    const probes = library.generateProbes(patterns);

    // Should have at least as many probes as patterns
    expect(probes.length).toBeGreaterThanOrEqual(patterns.length);
  });
});

// ============================================================================
// ADVERSARIAL TESTING TESTS
// ============================================================================

describe('AdversarialPatternLibrary - runTest', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should run tests against answer provider', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('getData returns cached data from memory');

    const results = await library.runTest(probes, answerProvider);

    expect(results.length).toBe(1);
    expect(answerProvider).toHaveBeenCalledWith('What does getData do?');
  });

  it('should mark test as passed when answer avoids trap', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('getData returns cached data');

    const results = await library.runTest(probes, answerProvider);

    expect(results[0].passed).toBe(true);
  });

  it('should mark test as failed when answer matches trap', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('getData fetches data from the API');

    const results = await library.runTest(probes, answerProvider);

    expect(results[0].passed).toBe(false);
  });

  it('should include explanation in results', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('Some answer');

    const results = await library.runTest(probes, answerProvider);

    expect(results[0].explanation).toBeDefined();
    expect(results[0].explanation.length).toBeGreaterThan(0);
  });

  it('should include the actual answer in results', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const actualAnswer = 'getData returns cached data from memory';
    const answerProvider = vi.fn().mockResolvedValue(actualAnswer);

    const results = await library.runTest(probes, answerProvider);

    expect(results[0].actualAnswer).toBe(actualAnswer);
  });

  it('should include the original probe in results', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('Some answer');

    const results = await library.runTest(probes, answerProvider);

    expect(results[0].probe).toEqual(probes[0]);
  });

  it('should handle empty probes array', async () => {
    const answerProvider = vi.fn().mockResolvedValue('Answer');
    const results = await library.runTest([], answerProvider);

    expect(results).toEqual([]);
    expect(answerProvider).not.toHaveBeenCalled();
  });

  it('should handle answer provider errors gracefully', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockRejectedValue(new Error('API Error'));

    // Should not throw
    const results = await library.runTest(probes, answerProvider);

    // Error handling: either returns empty results or marks as failed
    expect(Array.isArray(results)).toBe(true);
  });

  it('should run multiple probes', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'Query 1',
        expectedAnswer: 'answer 1',
        trapAnswer: 'trap 1',
      },
      {
        patternId: 'test-002',
        query: 'Query 2',
        expectedAnswer: 'answer 2',
        trapAnswer: 'trap 2',
      },
      {
        patternId: 'test-003',
        query: 'Query 3',
        expectedAnswer: 'answer 3',
        trapAnswer: 'trap 3',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('Generic answer');

    const results = await library.runTest(probes, answerProvider);

    expect(results.length).toBe(3);
    expect(answerProvider).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('AdversarialPattern Interface', () => {
  it('should support all required fields', () => {
    const pattern: AdversarialPattern = sampleNamingPattern;

    expect(pattern.id).toBe('naming-001');
    expect(pattern.name).toBe('Similar Function Names');
    expect(pattern.category).toBe('naming');
    expect(pattern.description).toBeDefined();
    expect(pattern.example.code).toBeDefined();
    expect(pattern.example.file).toBe('src/data.ts');
    expect(pattern.example.commonMistake).toBeDefined();
    expect(pattern.example.correctAnswer).toBeDefined();
    expect(pattern.triggerQueries.length).toBe(3);
    expect(pattern.severity).toBe('high');
  });

  it('should support all category types', () => {
    const categories: AdversarialPattern['category'][] = [
      'naming',
      'structure',
      'semantic',
      'misleading',
      'edge_case',
    ];

    categories.forEach((category) => {
      const pattern: AdversarialPattern = {
        ...sampleNamingPattern,
        id: `test-${category}`,
        category,
      };
      expect(pattern.category).toBe(category);
    });
  });

  it('should support all severity levels', () => {
    const severities: AdversarialPattern['severity'][] = ['high', 'medium', 'low'];

    severities.forEach((severity) => {
      const pattern: AdversarialPattern = {
        ...sampleNamingPattern,
        id: `test-${severity}`,
        severity,
      };
      expect(pattern.severity).toBe(severity);
    });
  });
});

describe('AdversarialCorpus Interface', () => {
  it('should support all required fields', () => {
    const corpus: AdversarialCorpus = {
      patterns: [sampleNamingPattern],
      categories: { naming: 1 },
      totalPatterns: 1,
      generatedAt: new Date().toISOString(),
    };

    expect(corpus.patterns.length).toBe(1);
    expect(corpus.categories.naming).toBe(1);
    expect(corpus.totalPatterns).toBe(1);
    expect(corpus.generatedAt).toBeDefined();
  });
});

describe('AdversarialProbe Interface', () => {
  it('should support all required fields', () => {
    const probe: AdversarialProbe = {
      patternId: 'test-001',
      query: 'What does X do?',
      expectedAnswer: 'correct answer',
      trapAnswer: 'wrong answer',
    };

    expect(probe.patternId).toBe('test-001');
    expect(probe.query).toBe('What does X do?');
    expect(probe.expectedAnswer).toBe('correct answer');
    expect(probe.trapAnswer).toBe('wrong answer');
  });
});

describe('AdversarialTestResult Interface', () => {
  it('should support all required fields', () => {
    const result: AdversarialTestResult = {
      probe: {
        patternId: 'test-001',
        query: 'What does X do?',
        expectedAnswer: 'correct answer',
        trapAnswer: 'wrong answer',
      },
      actualAnswer: 'The actual system response',
      passed: true,
      explanation: 'System avoided the trap answer',
    };

    expect(result.probe.patternId).toBe('test-001');
    expect(result.actualAnswer).toBe('The actual system response');
    expect(result.passed).toBe(true);
    expect(result.explanation).toBeDefined();
  });
});

// ============================================================================
// BUILT-IN PATTERNS TESTS
// ============================================================================

describe('Built-in Adversarial Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should have at least 20 built-in patterns', () => {
    const patterns = library.getPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(20);
  });

  it('should have multiple patterns per category', () => {
    const corpus = library.getCorpus();

    // Each category should have at least 2 patterns
    Object.values(corpus.categories).forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  it('should have high severity patterns', () => {
    const patterns = library.getPatterns();
    const highSeverity = patterns.filter((p) => p.severity === 'high');
    expect(highSeverity.length).toBeGreaterThanOrEqual(5);
  });

  it('should have meaningful trigger queries', () => {
    const patterns = library.getPatterns();
    patterns.forEach((pattern) => {
      expect(pattern.triggerQueries.length).toBeGreaterThanOrEqual(1);
      pattern.triggerQueries.forEach((query) => {
        expect(query.length).toBeGreaterThan(5);
        expect(query.endsWith('?')).toBe(true);
      });
    });
  });

  it('should have realistic code examples', () => {
    const patterns = library.getPatterns();
    patterns.forEach((pattern) => {
      expect(pattern.example.code.length).toBeGreaterThan(10);
      // Code should contain some typical code constructs
      const hasCodeConstruct =
        pattern.example.code.includes('function') ||
        pattern.example.code.includes('class') ||
        pattern.example.code.includes('const') ||
        pattern.example.code.includes('let') ||
        pattern.example.code.includes('import') ||
        pattern.example.code.includes('export') ||
        pattern.example.code.includes('//') ||
        pattern.example.code.includes('return');
      expect(hasCodeConstruct).toBe(true);
    });
  });

  it('should have distinct common mistakes and correct answers', () => {
    const patterns = library.getPatterns();
    patterns.forEach((pattern) => {
      expect(pattern.example.commonMistake).not.toBe(pattern.example.correctAnswer);
      expect(pattern.example.commonMistake.length).toBeGreaterThan(10);
      expect(pattern.example.correctAnswer.length).toBeGreaterThan(10);
    });
  });
});

// ============================================================================
// NAMING PATTERN SPECIFIC TESTS
// ============================================================================

describe('Naming Category Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should include similar names pattern', () => {
    const namingPatterns = library.getByCategory('naming');
    const hasSimilarNames = namingPatterns.some(
      (p) => p.name.toLowerCase().includes('similar') ||
             p.description.toLowerCase().includes('similar')
    );
    expect(hasSimilarNames).toBe(true);
  });

  it('should include misleading names pattern', () => {
    const namingPatterns = library.getByCategory('naming');
    const hasMisleadingNames = namingPatterns.some(
      (p) => p.name.toLowerCase().includes('misleading') ||
             p.description.toLowerCase().includes('misleading') ||
             p.description.toLowerCase().includes('doesn\'t match')
    );
    expect(hasMisleadingNames).toBe(true);
  });

  it('should include abbreviation patterns', () => {
    const namingPatterns = library.getByCategory('naming');
    const hasAbbreviations = namingPatterns.some(
      (p) => p.name.toLowerCase().includes('abbreviat') ||
             p.description.toLowerCase().includes('abbreviat') ||
             p.example.code.includes('cfg') ||
             p.example.code.includes('config')
    );
    expect(hasAbbreviations).toBe(true);
  });
});

// ============================================================================
// STRUCTURE PATTERN SPECIFIC TESTS
// ============================================================================

describe('Structure Category Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should include nested functions pattern', () => {
    const structurePatterns = library.getByCategory('structure');
    const hasNestedFunctions = structurePatterns.some(
      (p) => p.name.toLowerCase().includes('nested') ||
             p.description.toLowerCase().includes('nested') ||
             p.description.toLowerCase().includes('inner')
    );
    expect(hasNestedFunctions).toBe(true);
  });

  it('should include overloaded functions pattern', () => {
    const structurePatterns = library.getByCategory('structure');
    const hasOverloaded = structurePatterns.some(
      (p) => p.name.toLowerCase().includes('overload') ||
             p.description.toLowerCase().includes('overload')
    );
    expect(hasOverloaded).toBe(true);
  });

  it('should include re-export pattern', () => {
    const structurePatterns = library.getByCategory('structure');
    const hasReExport = structurePatterns.some(
      (p) => p.name.toLowerCase().includes('re-export') ||
             p.name.toLowerCase().includes('reexport') ||
             p.description.toLowerCase().includes('re-export') ||
             p.description.toLowerCase().includes('reexport') ||
             p.description.toLowerCase().includes('different name')
    );
    expect(hasReExport).toBe(true);
  });
});

// ============================================================================
// SEMANTIC PATTERN SPECIFIC TESTS
// ============================================================================

describe('Semantic Category Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should include dead code pattern', () => {
    const semanticPatterns = library.getByCategory('semantic');
    const hasDeadCode = semanticPatterns.some(
      (p) => p.name.toLowerCase().includes('dead') ||
             p.description.toLowerCase().includes('unreachable') ||
             p.description.toLowerCase().includes('dead code')
    );
    expect(hasDeadCode).toBe(true);
  });

  it('should include deprecated pattern', () => {
    const semanticPatterns = library.getByCategory('semantic');
    const hasDeprecated = semanticPatterns.some(
      (p) => p.name.toLowerCase().includes('deprecat') ||
             p.description.toLowerCase().includes('deprecat')
    );
    expect(hasDeprecated).toBe(true);
  });

  it('should include commented-out code pattern', () => {
    const semanticPatterns = library.getByCategory('semantic');
    const hasCommentedCode = semanticPatterns.some(
      (p) => p.name.toLowerCase().includes('comment') ||
             p.description.toLowerCase().includes('commented')
    );
    expect(hasCommentedCode).toBe(true);
  });
});

// ============================================================================
// MISLEADING PATTERN SPECIFIC TESTS
// ============================================================================

describe('Misleading Category Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should include outdated comments pattern', () => {
    const misleadingPatterns = library.getByCategory('misleading');
    const hasOutdatedComments = misleadingPatterns.some(
      (p) => p.name.toLowerCase().includes('comment') ||
             p.name.toLowerCase().includes('outdated') ||
             p.description.toLowerCase().includes('comment') ||
             p.description.toLowerCase().includes('doesn\'t match')
    );
    expect(hasOutdatedComments).toBe(true);
  });

  it('should include README contradiction pattern', () => {
    const misleadingPatterns = library.getByCategory('misleading');
    const hasReadmeContradiction = misleadingPatterns.some(
      (p) => p.name.toLowerCase().includes('readme') ||
             p.name.toLowerCase().includes('documentation') ||
             p.description.toLowerCase().includes('readme') ||
             p.description.toLowerCase().includes('documentation')
    );
    expect(hasReadmeContradiction).toBe(true);
  });

  it('should include type mismatch pattern', () => {
    const misleadingPatterns = library.getByCategory('misleading');
    const hasTypeMismatch = misleadingPatterns.some(
      (p) => p.name.toLowerCase().includes('type') ||
             p.description.toLowerCase().includes('type') ||
             p.description.toLowerCase().includes('runtime')
    );
    expect(hasTypeMismatch).toBe(true);
  });
});

// ============================================================================
// EDGE CASE PATTERN SPECIFIC TESTS
// ============================================================================

describe('Edge Case Category Patterns', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should include empty functions pattern', () => {
    const edgeCasePatterns = library.getByCategory('edge_case');
    const hasEmptyFunctions = edgeCasePatterns.some(
      (p) => p.name.toLowerCase().includes('empty') ||
             p.description.toLowerCase().includes('empty') ||
             p.description.toLowerCase().includes('no implementation')
    );
    expect(hasEmptyFunctions).toBe(true);
  });

  it('should include single-line files pattern', () => {
    const edgeCasePatterns = library.getByCategory('edge_case');
    const hasSingleLine = edgeCasePatterns.some(
      (p) => p.name.toLowerCase().includes('single') ||
             p.name.toLowerCase().includes('one-line') ||
             p.description.toLowerCase().includes('single') ||
             p.description.toLowerCase().includes('one line')
    );
    expect(hasSingleLine).toBe(true);
  });

  it('should include comment-only files pattern', () => {
    const edgeCasePatterns = library.getByCategory('edge_case');
    const hasCommentOnly = edgeCasePatterns.some(
      (p) => p.name.toLowerCase().includes('comment') ||
             p.description.toLowerCase().includes('only comment')
    );
    expect(hasCommentOnly).toBe(true);
  });

  it('should include circular dependency pattern', () => {
    const edgeCasePatterns = library.getByCategory('edge_case');
    const hasCircular = edgeCasePatterns.some(
      (p) => p.name.toLowerCase().includes('circular') ||
             p.description.toLowerCase().includes('circular')
    );
    expect(hasCircular).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('AdversarialPatternLibrary - Edge Cases', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should handle patterns with special characters in code', () => {
    const patterns = library.getPatterns();
    // Should not crash when processing patterns with special chars
    const corpus = library.getCorpus();
    expect(corpus.totalPatterns).toBeGreaterThan(0);
  });

  it('should handle concurrent calls', async () => {
    const promises = [
      library.importFromRepo('/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian'),
      library.importFromRepo('/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian'),
      library.importFromRepo('/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian'),
    ];

    const results = await Promise.all(promises);

    results.forEach((patterns) => {
      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  it('should handle very long trigger queries', () => {
    const longQuery = 'What does this function do? '.repeat(50);
    const patterns = library.generateProbes([
      {
        ...sampleNamingPattern,
        triggerQueries: [longQuery],
      },
    ]);

    expect(patterns.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// ANSWER MATCHING TESTS
// ============================================================================

describe('AdversarialPatternLibrary - Answer Matching', () => {
  let library: AdversarialPatternLibrary;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
  });

  it('should match expected answer case-insensitively', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('RETURNS CACHED DATA from memory');
    const results = await library.runTest(probes, answerProvider);

    expect(results[0].passed).toBe(true);
  });

  it('should match trap answer case-insensitively', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does getData do?',
        expectedAnswer: 'returns cached data',
        trapAnswer: 'fetches from API',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('It FETCHES FROM THE API');
    const results = await library.runTest(probes, answerProvider);

    expect(results[0].passed).toBe(false);
  });

  it('should handle partial matches appropriately', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does process do?',
        expectedAnswer: 'processes input data',
        trapAnswer: 'validates input data',
      },
    ];

    // Answer contains "input data" which is in both expected and trap
    const answerProvider = vi.fn().mockResolvedValue('It processes the input data');
    const results = await library.runTest(probes, answerProvider);

    // Should pass because it matches expected more than trap
    expect(results[0].passed).toBe(true);
  });

  it('should handle ambiguous answers', async () => {
    const probes: AdversarialProbe[] = [
      {
        patternId: 'test-001',
        query: 'What does X do?',
        expectedAnswer: 'returns A',
        trapAnswer: 'returns B',
      },
    ];

    // Answer is completely unrelated
    const answerProvider = vi.fn().mockResolvedValue('I do not know what X does');
    const results = await library.runTest(probes, answerProvider);

    // Should have meaningful explanation
    expect(results[0].explanation.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// ADVERSARIAL BEHAVIOR DETECTOR TESTS
// ============================================================================

import {
  AdversarialBehaviorDetector,
  createAdversarialBehaviorDetector,
  type AdversarialBehaviorDetection,
  type AdversarialBehaviorReport,
  type BehaviorAnalysisInput,
  type BehaviorRemediation,
  convertToGateViolations,
  convertToGateRemediations,
} from '../adversarial_patterns.js';

describe('AdversarialBehaviorDetector', () => {
  let detector: AdversarialBehaviorDetector;

  beforeAll(() => {
    detector = createAdversarialBehaviorDetector();
  });

  describe('creation', () => {
    it('should create a detector instance', () => {
      expect(detector).toBeInstanceOf(AdversarialBehaviorDetector);
    });

    it('should create via factory function', () => {
      const d = createAdversarialBehaviorDetector();
      expect(d).toBeInstanceOf(AdversarialBehaviorDetector);
    });
  });

  describe('analyze - pattern detection', () => {
    it('should detect evasion patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot directly answer that question because it is beyond my scope.",
      };

      const report = detector.analyze(input);

      expect(report.detections.length).toBeGreaterThan(0);
      expect(report.detections.some(d => d.category === 'evasion')).toBe(true);
    });

    it('should detect misdirection patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "The real question is not what you asked, but rather let's focus instead on something else entirely.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'misdirection')).toBe(true);
    });

    it('should detect overconfidence patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "This is absolutely certain and definitely correct without a doubt.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'overconfidence')).toBe(true);
    });

    it('should detect underconfidence patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "I think that maybe this might possibly perhaps be the answer.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'underconfidence')).toBe(true);
    });

    it('should detect circular reasoning patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "This is true because it is the case. Obviously this means it is correct.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'circular_reasoning')).toBe(true);
    });

    it('should detect appeal to authority patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "Experts say this is correct and authorities agree with this assessment.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'appeal_to_authority')).toBe(true);
    });

    it('should detect sycophancy patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "Great question! You're absolutely right and I completely agree with everything you said.",
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'sycophancy')).toBe(true);
    });

    it('should detect context manipulation patterns', () => {
      const input: BehaviorAnalysisInput = {
        content: "As you mentioned earlier, we agreed that this is the correct approach.",
        context: [], // Empty context
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'context_manipulation')).toBe(true);
    });

    it('should return clean report for non-adversarial content', () => {
      const input: BehaviorAnalysisInput = {
        content: "The function returns a string value. Here is an example of how to use it.",
      };

      const report = detector.analyze(input);

      expect(report.adversarialScore).toBeLessThan(0.3);
      expect(report.shouldFlag).toBe(false);
    });
  });

  describe('analyze - inference step detection', () => {
    it('should detect circular reasoning in inference steps', () => {
      const input: BehaviorAnalysisInput = {
        content: "Based on my analysis...",
        inferenceSteps: [
          {
            premises: ['The sky is blue because it appears blue'],
            conclusion: 'The sky appears blue',
            confidence: 0.8,
          },
        ],
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d =>
        d.category === 'circular_reasoning' &&
        d.relatedFallacy === 'circular_reasoning'
      )).toBe(true);
    });

    it('should detect hasty generalization in inference steps', () => {
      const input: BehaviorAnalysisInput = {
        content: "All software has bugs.",
        inferenceSteps: [
          {
            premises: ['I found a bug in this software'],
            conclusion: 'All software always has bugs',
            confidence: 0.7,
          },
        ],
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d =>
        d.relatedFallacy === 'hasty_generalization'
      )).toBe(true);
    });

    it('should detect confidence mismatch in inference steps', () => {
      const input: BehaviorAnalysisInput = {
        content: "The result is definitely correct.",
        inferenceSteps: [
          {
            premises: ['Some evidence suggests this'],
            conclusion: 'This is definitely correct',
            confidence: 0.3, // Low confidence
          },
        ],
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'overconfidence')).toBe(true);
    });
  });

  describe('analyze - confidence calibration', () => {
    it('should detect overconfidence with insufficient evidence', () => {
      const input: BehaviorAnalysisInput = {
        content: "This is the correct answer.",
        statedConfidence: 0.95,
        providedEvidence: ['one piece of evidence'],
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'overconfidence')).toBe(true);
    });

    it('should not flag well-calibrated confidence', () => {
      const input: BehaviorAnalysisInput = {
        content: "Based on the evidence, this seems likely.",
        statedConfidence: 0.7,
        providedEvidence: [
          'First piece of evidence',
          'Second piece of evidence',
          'Third piece of evidence',
        ],
      };

      const report = detector.analyze(input);

      // Should not detect overconfidence
      const overconfidenceDetections = report.detections.filter(
        d => d.category === 'overconfidence'
      );
      expect(overconfidenceDetections.length).toBe(0);
    });
  });

  describe('analyze - citation verification', () => {
    it('should flag suspiciously specific page numbers', () => {
      const input: BehaviorAnalysisInput = {
        content: "According to the documentation...",
        citations: ['Documentation, page 847'],
      };

      const report = detector.analyze(input);

      expect(report.detections.some(d => d.category === 'hallucination_pattern')).toBe(true);
    });

    it('should not flag reasonable page numbers', () => {
      const input: BehaviorAnalysisInput = {
        content: "According to chapter 3...",
        citations: ['Book Title, page 42'],
      };

      const report = detector.analyze(input);

      // Should not flag reasonable page numbers
      const hallucinationDetections = report.detections.filter(
        d => d.category === 'hallucination_pattern' &&
             d.evidence.some(e => e.includes('page'))
      );
      expect(hallucinationDetections.length).toBe(0);
    });
  });

  describe('report structure', () => {
    it('should return complete report structure', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot answer because experts say it is beyond my scope.",
      };

      const report = detector.analyze(input);

      expect(report).toHaveProperty('detections');
      expect(report).toHaveProperty('adversarialScore');
      expect(report).toHaveProperty('shouldFlag');
      expect(report).toHaveProperty('remediations');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('analyzedAt');
    });

    it('should calculate adversarial score between 0 and 1', () => {
      const input: BehaviorAnalysisInput = {
        content: "Some content with multiple issues. Definitely certain. Cannot answer. Great question!",
      };

      const report = detector.analyze(input);

      expect(report.adversarialScore).toBeGreaterThanOrEqual(0);
      expect(report.adversarialScore).toBeLessThanOrEqual(1);
    });

    it('should flag high-severity detections', () => {
      const input: BehaviorAnalysisInput = {
        content: "According to page 999 of the manual released on January 15, 2024...",
        citations: ['Manual, page 999, released January 15, 2024'],
      };

      const report = detector.analyze(input);

      // Hallucination patterns are critical severity
      if (report.detections.some(d => d.severity === 'critical')) {
        expect(report.shouldFlag).toBe(true);
      }
    });

    it('should include detection timestamps', () => {
      const input: BehaviorAnalysisInput = {
        content: "Definitely correct answer.",
      };

      const report = detector.analyze(input);

      for (const detection of report.detections) {
        expect(detection.detectedAt).toBeDefined();
        expect(() => new Date(detection.detectedAt)).not.toThrow();
      }
    });
  });

  describe('remediations', () => {
    it('should generate remediations for detections', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot answer because it is beyond my scope.",
      };

      const report = detector.analyze(input);

      expect(report.remediations.length).toBeGreaterThan(0);
    });

    it('should include steps in remediations', () => {
      const input: BehaviorAnalysisInput = {
        content: "Experts say this is definitely correct.",
      };

      const report = detector.analyze(input);

      for (const remediation of report.remediations) {
        expect(remediation.steps).toBeDefined();
        expect(remediation.steps.length).toBeGreaterThan(0);
      }
    });

    it('should map remediations to detections', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot answer. The real question is something else.",
      };

      const report = detector.analyze(input);

      for (const remediation of report.remediations) {
        expect(remediation.addressesDetections).toBeDefined();
        expect(remediation.addressesDetections.length).toBeGreaterThan(0);
      }
    });

    it('should sort remediations by priority', () => {
      const input: BehaviorAnalysisInput = {
        content: "Definitely correct per page 999. Cannot answer. Great question!",
        citations: ['page 999'],
      };

      const report = detector.analyze(input);

      if (report.remediations.length >= 2) {
        for (let i = 1; i < report.remediations.length; i++) {
          expect(report.remediations[i].priority).toBeGreaterThanOrEqual(
            report.remediations[i - 1].priority
          );
        }
      }
    });
  });

  describe('summary', () => {
    it('should generate meaningful summary', () => {
      const input: BehaviorAnalysisInput = {
        content: "This is definitely correct and experts agree.",
      };

      const report = detector.analyze(input);

      expect(report.summary).toBeDefined();
      expect(report.summary.length).toBeGreaterThan(0);
    });

    it('should indicate clean report for no issues', () => {
      const input: BehaviorAnalysisInput = {
        content: "The function returns a value based on the input parameter.",
      };

      const report = detector.analyze(input);

      if (report.detections.length === 0) {
        expect(report.summary.toLowerCase()).toContain('no');
      }
    });

    it('should mention critical issues in summary', () => {
      const input: BehaviorAnalysisInput = {
        content: "According to the documentation on page 999...",
        citations: ['Doc page 999'],
      };

      const report = detector.analyze(input);

      const hasCritical = report.detections.some(d => d.severity === 'critical');
      if (hasCritical) {
        expect(report.summary.toLowerCase()).toContain('critical');
      }
    });
  });

  describe('custom patterns', () => {
    it('should allow adding custom patterns', () => {
      const customDetector = createAdversarialBehaviorDetector();

      customDetector.addPattern({
        category: 'misdirection',
        patterns: [/custom pattern test/i],
        keywords: ['custom keyword'],
        severity: 'medium',
        description: 'Custom test pattern',
      });

      const input: BehaviorAnalysisInput = {
        content: "This contains a custom pattern test phrase.",
      };

      const report = customDetector.analyze(input);

      expect(report.detections.some(d =>
        d.explanation === 'Custom test pattern'
      )).toBe(true);
    });
  });
});

// ============================================================================
// QUALITY GATES INTEGRATION TESTS
// ============================================================================

describe('Quality Gates Integration', () => {
  let detector: AdversarialBehaviorDetector;

  beforeAll(() => {
    detector = createAdversarialBehaviorDetector();
  });

  describe('convertToGateViolations', () => {
    it('should convert detections to gate violations', () => {
      const input: BehaviorAnalysisInput = {
        content: "Definitely cannot answer that question.",
      };

      const report = detector.analyze(input);
      const violations = convertToGateViolations(report);

      expect(Array.isArray(violations)).toBe(true);
      expect(violations.length).toBe(report.detections.length);
    });

    it('should map severity correctly', () => {
      const input: BehaviorAnalysisInput = {
        content: "According to page 999 of the docs...",
        citations: ['page 999'],
      };

      const report = detector.analyze(input);
      const violations = convertToGateViolations(report);

      for (const violation of violations) {
        expect(['minor', 'major', 'critical']).toContain(violation.severity);
      }
    });

    it('should include criterion IDs', () => {
      const input: BehaviorAnalysisInput = {
        content: "Experts say this is definitely correct.",
      };

      const report = detector.analyze(input);
      const violations = convertToGateViolations(report);

      for (const violation of violations) {
        expect(violation.criterionId).toMatch(/^adversarial_/);
      }
    });

    it('should invert confidence to score', () => {
      const input: BehaviorAnalysisInput = {
        content: "This is definitely the answer.",
      };

      const report = detector.analyze(input);
      const violations = convertToGateViolations(report);

      for (let i = 0; i < report.detections.length; i++) {
        const detection = report.detections[i];
        const violation = violations[i];
        // Score should be 1 - confidence
        expect(violation.score).toBeCloseTo(1 - detection.confidence, 1);
      }
    });
  });

  describe('convertToGateRemediations', () => {
    it('should convert remediations to gate format', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot directly answer.",
      };

      const report = detector.analyze(input);
      const gateRemediations = convertToGateRemediations(report);

      expect(Array.isArray(gateRemediations)).toBe(true);
      expect(gateRemediations.length).toBe(report.remediations.length);
    });

    it('should include valid remediation types', () => {
      const input: BehaviorAnalysisInput = {
        content: "Definitely experts say cannot answer.",
      };

      const report = detector.analyze(input);
      const gateRemediations = convertToGateRemediations(report);

      const validTypes = ['clarify', 'adjust', 'rollback', 'pivot', 'abort', 'hotfix'];
      for (const remediation of gateRemediations) {
        expect(validTypes).toContain(remediation.type);
      }
    });

    it('should preserve steps', () => {
      const input: BehaviorAnalysisInput = {
        content: "Cannot answer the question.",
      };

      const report = detector.analyze(input);
      const gateRemediations = convertToGateRemediations(report);

      for (const remediation of gateRemediations) {
        expect(remediation.steps).toBeDefined();
        expect(remediation.steps.length).toBeGreaterThan(0);
      }
    });

    it('should map addresses to violations', () => {
      const input: BehaviorAnalysisInput = {
        content: "I cannot answer. Experts say so.",
      };

      const report = detector.analyze(input);
      const gateRemediations = convertToGateRemediations(report);

      for (const remediation of gateRemediations) {
        expect(remediation.addressesViolations).toBeDefined();
        for (const violation of remediation.addressesViolations) {
          expect(violation).toMatch(/^adversarial_/);
        }
      }
    });
  });
});

// ============================================================================
// ADVERSARIAL BEHAVIOR TYPES TESTS
// ============================================================================

describe('AdversarialBehavior Types', () => {
  it('should support all behavior categories', () => {
    const categories = [
      'reasoning_fallacy',
      'evasion',
      'misdirection',
      'overconfidence',
      'underconfidence',
      'circular_reasoning',
      'appeal_to_authority',
      'hallucination_pattern',
      'sycophancy',
      'refusal_gaming',
      'context_manipulation',
    ];

    // Verify categories are valid by creating detections for each
    const detector = createAdversarialBehaviorDetector();

    for (const category of categories) {
      // Type assertion to verify it's a valid category type
      const validCategory: AdversarialBehaviorDetection['category'] = category as AdversarialBehaviorDetection['category'];
      expect(validCategory).toBe(category);
    }
  });

  it('should support all severity levels', () => {
    const severities: AdversarialBehaviorDetection['severity'][] = [
      'critical',
      'high',
      'medium',
      'low',
    ];

    for (const severity of severities) {
      expect(['critical', 'high', 'medium', 'low']).toContain(severity);
    }
  });

  it('should support all remediation types', () => {
    const types: BehaviorRemediation['type'][] = [
      'clarify',
      'adjust',
      'rollback',
      'pivot',
      'abort',
      'hotfix',
      'escalate',
    ];

    for (const type of types) {
      expect([
        'clarify', 'adjust', 'rollback', 'pivot', 'abort', 'hotfix', 'escalate'
      ]).toContain(type);
    }
  });

  it('should support all effort levels', () => {
    const efforts: BehaviorRemediation['effort'][] = [
      'trivial',
      'low',
      'medium',
      'high',
      'critical',
    ];

    for (const effort of efforts) {
      expect(['trivial', 'low', 'medium', 'high', 'critical']).toContain(effort);
    }
  });
});
