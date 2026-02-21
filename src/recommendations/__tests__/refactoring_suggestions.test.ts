import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  findRefactoringOpportunities,
  summarizeRefactoringSuggestions,
  _internal,
  type RefactoringSuggestion,
  type RefactoringType,
} from '../refactoring_suggestions.js';
import type { LiBrainianStorage } from '../../storage/types.js';

// ============================================================================
// INTERNAL FUNCTION TESTS
// ============================================================================

describe('findDuplicateCode', () => {
  const { findDuplicateCode } = _internal;

  it('detects exact duplicate code blocks', () => {
    const content = `
function processA() {
  const x = getValue();
  const y = transform(x);
  const z = validate(y);
  saveResult(z);
  return z;
}

function processB() {
  const x = getValue();
  const y = transform(x);
  const z = validate(y);
  saveResult(z);
  return z;
}
`;
    const suggestions = findDuplicateCode(content, 'test.ts', 5);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe('consolidate_duplicate');
    expect(suggestions[0].risk).toBe('medium');
    expect(suggestions[0].steps.length).toBeGreaterThan(0);
  });

  it('ignores trivial duplicate blocks', () => {
    const content = `
function a() {
  return 1;
}

function b() {
  return 1;
}
`;
    const suggestions = findDuplicateCode(content, 'test.ts', 5);

    // Short blocks should not be flagged
    expect(suggestions.length).toBe(0);
  });

  it('ignores empty content', () => {
    const suggestions = findDuplicateCode('', 'test.ts', 5);
    expect(suggestions.length).toBe(0);
  });
});

describe('findLongFunctions', () => {
  const { findLongFunctions } = _internal;

  it('detects long regular functions', () => {
    const longBody = Array(50).fill('  console.log("line");').join('\n');
    const content = `function longFunction() {\n${longBody}\n}`;

    const suggestions = findLongFunctions(content, 'test.ts', 40);

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].type).toBe('extract_function');
    expect(suggestions[0].description).toContain('longFunction');
    // The function will be 50+ lines (content + braces)
    expect(suggestions[0].description).toMatch(/\d+ lines/);
  });

  it('detects long arrow functions', () => {
    const longBody = Array(50).fill('  console.log("line");').join('\n');
    const content = `const longArrow = () => {\n${longBody}\n}`;

    const suggestions = findLongFunctions(content, 'test.ts', 40);

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].type).toBe('extract_function');
    expect(suggestions[0].description).toContain('longArrow');
  });

  it('detects long async functions', () => {
    const longBody = Array(50).fill('  await doSomething();').join('\n');
    const content = `async function longAsync() {\n${longBody}\n}`;

    const suggestions = findLongFunctions(content, 'test.ts', 40);

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].description).toContain('longAsync');
  });

  it('ignores functions under threshold', () => {
    const shortBody = Array(20).fill('  console.log("line");').join('\n');
    const content = `function shortFunction() {\n${shortBody}\n}`;

    const suggestions = findLongFunctions(content, 'test.ts', 40);

    expect(suggestions.length).toBe(0);
  });

  it('uses significant effort for very long functions', () => {
    const veryLongBody = Array(150).fill('  console.log("line");').join('\n');
    const content = `function veryLongFunction() {\n${veryLongBody}\n}`;

    const suggestions = findLongFunctions(content, 'test.ts', 40);

    expect(suggestions[0].effort).toBe('significant');
  });
});

describe('findComplexConditionals', () => {
  const { findComplexConditionals } = _internal;

  it('detects complex boolean expressions', () => {
    const content = `
if (a && b && c || d && e) {
  doSomething();
}
`;
    const suggestions = findComplexConditionals(content, 'test.ts');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe('decompose_conditional');
    expect(suggestions[0].description).toContain('4');
  });

  it('detects nested ternaries', () => {
    const content = `
const result = condition1 ? (condition2 ? valueA : valueB) : valueC;
`;
    const suggestions = findComplexConditionals(content, 'test.ts');

    const ternaryWarning = suggestions.find((s) => s.type === 'simplify_boolean');
    expect(ternaryWarning).toBeDefined();
    expect(ternaryWarning?.description).toContain('ternary');
  });

  it('ignores simple conditionals', () => {
    const content = `
if (a && b) {
  doSomething();
}
`;
    const suggestions = findComplexConditionals(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('provides before/after examples', () => {
    const content = `if (a && b && c || d) { doSomething(); }`;
    const suggestions = findComplexConditionals(content, 'test.ts');

    expect(suggestions[0].beforeAfter).toBeDefined();
    expect(suggestions[0].beforeAfter?.before).toContain('if');
    expect(suggestions[0].beforeAfter?.after).toContain('const');
  });
});

describe('findMagicNumbers', () => {
  const { findMagicNumbers } = _internal;

  it('detects magic numbers in conditionals', () => {
    const content = `
function check(items) {
  if (items.length > 42) {
    throw new Error('Too many items');
  }
}
`;
    const suggestions = findMagicNumbers(content, 'test.ts');

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].type).toBe('replace_magic_number');
    expect(suggestions[0].description).toContain('42');
  });

  it('ignores common acceptable numbers', () => {
    const content = `
function setup() {
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push(i);
  }
  return items.slice(0, 10);
}
`;
    const suggestions = findMagicNumbers(content, 'test.ts');

    // 100 and 10 are in the acceptable set
    expect(suggestions.length).toBe(0);
  });

  it('ignores constant declarations', () => {
    const content = `
const MAX_ITEMS = 42;
`;
    const suggestions = findMagicNumbers(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('ignores comments', () => {
    const content = `
// This limit is 42 items
// The value 9999 is not used
`;
    const suggestions = findMagicNumbers(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('provides actionable steps', () => {
    const content = `if (count > 999) {}`;
    const suggestions = findMagicNumbers(content, 'test.ts');

    expect(suggestions[0].steps.length).toBeGreaterThan(0);
    expect(suggestions[0].automatable).toBe(true);
  });
});

describe('findDeadCode', () => {
  const { findDeadCode } = _internal;

  it('detects unreachable code after return', () => {
    const content = `
function process() {
  return 42;
  console.log('This will never run');
}
`;
    const suggestions = findDeadCode(content, 'test.ts');

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].type).toBe('remove_dead_code');
    expect(suggestions[0].description).toContain('Unreachable');
  });

  it('ignores closing braces after return', () => {
    const content = `
function process() {
  if (condition) {
    return 42;
  }
}
`;
    const suggestions = findDeadCode(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('ignores switch case statements after return', () => {
    const content = `
function process(value) {
  switch (value) {
    case 1:
      return 'one';
    case 2:
      return 'two';
    default:
      return 'other';
  }
}
`;
    const suggestions = findDeadCode(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('detects commented-out code', () => {
    const content = `
function process() {
  const result = compute();
  // const oldResult = legacyCompute();
  return result;
}
`;
    const suggestions = findDeadCode(content, 'test.ts');

    const commentedCode = suggestions.find(
      (s) => s.description.includes('Commented')
    );
    expect(commentedCode).toBeDefined();
    expect(commentedCode?.risk).toBe('low');
  });
});

describe('findParameterListSmells', () => {
  const { findParameterListSmells } = _internal;

  it('detects functions with too many parameters', () => {
    const content = `
function createUser(name, email, age, address, phone, role) {
  // implementation
}
`;
    const suggestions = findParameterListSmells(content, 'test.ts');

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].type).toBe('introduce_parameter_object');
    expect(suggestions[0].description).toContain('6');
  });

  it('ignores functions with few parameters', () => {
    const content = `
function createUser(name, email) {
  // implementation
}
`;
    const suggestions = findParameterListSmells(content, 'test.ts');

    expect(suggestions.length).toBe(0);
  });

  it('provides TypeScript-style before/after', () => {
    const content = `function process(a, b, c, d) {}`;
    const suggestions = findParameterListSmells(content, 'test.ts');

    expect(suggestions[0].beforeAfter).toBeDefined();
    expect(suggestions[0].beforeAfter?.after).toContain('interface');
    expect(suggestions[0].beforeAfter?.after).toContain('options');
  });
});

describe('riskOrder and effortOrder', () => {
  const { riskOrder, effortOrder } = _internal;

  it('orders risk levels correctly', () => {
    expect(riskOrder('low')).toBeLessThan(riskOrder('medium'));
    expect(riskOrder('medium')).toBeLessThan(riskOrder('high'));
    expect(riskOrder('unknown')).toBeGreaterThan(riskOrder('high'));
  });

  it('orders effort levels correctly', () => {
    expect(effortOrder('trivial')).toBeLessThan(effortOrder('easy'));
    expect(effortOrder('easy')).toBeLessThan(effortOrder('moderate'));
    expect(effortOrder('moderate')).toBeLessThan(effortOrder('significant'));
    expect(effortOrder('unknown')).toBeGreaterThan(effortOrder('significant'));
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('findRefactoringOpportunities', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'refactoring-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestFiles = async (files: Array<{ name: string; content: string }>) => {
    const filePaths: string[] = [];
    for (const file of files) {
      const filePath = path.join(tempDir, file.name);
      await fs.writeFile(filePath, file.content);
      filePaths.push(filePath);
    }
    const mockStorage: Partial<LiBrainianStorage> = {
      getFiles: vi.fn().mockResolvedValue(filePaths.map(p => ({ path: p }))),
    };
    return { storage: mockStorage as LiBrainianStorage, filePaths };
  };

  it('analyzes multiple files', async () => {
    const { storage, filePaths } = await createTestFiles([
      {
        name: 'file1.ts',
        content: `function longFunction1() {\n${Array(50).fill('  console.log("line");').join('\n')}\n}`,
      },
      {
        name: 'file2.ts',
        content: `function process(a, b, c, d, e) { return a + b + c + d + e; }`,
      },
    ]);

    const suggestions = await findRefactoringOpportunities(storage);

    expect(suggestions.length).toBeGreaterThan(0);
    const files = new Set(suggestions.map((s) => s.target.file));
    expect(files.size).toBe(2);
  });

  it('respects maxFiles option', async () => {
    const files = Array(10).fill(null).map((_, i) => ({
      name: `file${i}.ts`,
      content: `const x = 42;`, // Magic number
    }));

    const { storage } = await createTestFiles(files);

    const suggestions = await findRefactoringOpportunities(storage, undefined, { maxFiles: 2 });

    const analyzedFiles = new Set(suggestions.map((s) => s.target.file));
    expect(analyzedFiles.size).toBeLessThanOrEqual(2);
  });

  it('analyzes specific file when provided', async () => {
    const { filePaths } = await createTestFiles([
      { name: 'target.ts', content: `if (a && b && c && d) {}` },
    ]);
    const mockStorage: Partial<LiBrainianStorage> = { getFiles: vi.fn() };

    const suggestions = await findRefactoringOpportunities(mockStorage as LiBrainianStorage, filePaths[0]);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.target.file === filePaths[0])).toBe(true);
  });

  it('respects longFunctionThreshold option', async () => {
    const { storage } = await createTestFiles([
      { name: 'test.ts', content: `function medium() {\n${Array(30).fill('  x;').join('\n')}\n}` },
    ]);

    // Should not find with default threshold (40)
    const defaultResult = await findRefactoringOpportunities(storage);
    const longFuncs = defaultResult.filter((s) => s.type === 'extract_function');
    expect(longFuncs.length).toBe(0);

    // Should find with lower threshold
    const lowThreshold = await findRefactoringOpportunities(storage, undefined, { longFunctionThreshold: 25 });
    const foundLongFuncs = lowThreshold.filter((s) => s.type === 'extract_function');
    expect(foundLongFuncs.length).toBe(1);
  });

  it('sorts results by risk then effort', async () => {
    const { storage } = await createTestFiles([
      {
        name: 'test.ts',
        content: `// Magic number\nif (x > 999) {}\n\n// Complex conditional\nif (a && b && c || d && e) {}\n\nfunction longFunc() {\n${Array(50).fill('  x;').join('\n')}\n}`,
      },
    ]);

    const suggestions = await findRefactoringOpportunities(storage, undefined, { includeLowPriority: true });

    // Verify sorting: low risk should come first, then by effort
    for (let i = 1; i < suggestions.length; i++) {
      const prev = suggestions[i - 1];
      const curr = suggestions[i];

      if (prev.risk === curr.risk) {
        expect(_internal.effortOrder(prev.effort)).toBeLessThanOrEqual(_internal.effortOrder(curr.effort));
      } else {
        expect(_internal.riskOrder(prev.risk)).toBeLessThanOrEqual(_internal.riskOrder(curr.risk));
      }
    }
  });
});

describe('summarizeRefactoringSuggestions', () => {
  it('correctly summarizes an empty list', () => {
    const summary = summarizeRefactoringSuggestions([]);

    expect(summary.total).toBe(0);
    expect(summary.automatableCount).toBe(0);
    expect(summary.topOpportunities).toHaveLength(0);
  });

  it('correctly summarizes suggestions by type', () => {
    const suggestions: RefactoringSuggestion[] = [
      {
        type: 'extract_function',
        target: { file: 'a.ts', startLine: 1, endLine: 50 },
        description: 'Long function',
        benefit: 'Better readability',
        risk: 'low',
        effort: 'moderate',
        automatable: false,
        steps: ['Step 1'],
      },
      {
        type: 'extract_function',
        target: { file: 'b.ts', startLine: 1, endLine: 60 },
        description: 'Another long function',
        benefit: 'Better readability',
        risk: 'low',
        effort: 'moderate',
        automatable: false,
        steps: ['Step 1'],
      },
      {
        type: 'replace_magic_number',
        target: { file: 'c.ts', startLine: 10, endLine: 10 },
        description: 'Magic number 42',
        benefit: 'Clarity',
        risk: 'low',
        effort: 'trivial',
        automatable: true,
        steps: ['Extract constant'],
      },
    ];

    const summary = summarizeRefactoringSuggestions(suggestions);

    expect(summary.total).toBe(3);
    expect(summary.byType.extract_function).toBe(2);
    expect(summary.byType.replace_magic_number).toBe(1);
    expect(summary.automatableCount).toBe(1);
  });

  it('correctly summarizes by risk and effort', () => {
    const suggestions: RefactoringSuggestion[] = [
      {
        type: 'extract_function',
        target: { file: 'a.ts', startLine: 1, endLine: 50 },
        description: 'Test',
        benefit: 'Test',
        risk: 'low',
        effort: 'moderate',
        automatable: false,
        steps: [],
      },
      {
        type: 'consolidate_duplicate',
        target: { file: 'b.ts', startLine: 1, endLine: 10 },
        description: 'Test',
        benefit: 'Test',
        risk: 'medium',
        effort: 'moderate',
        automatable: false,
        steps: [],
      },
      {
        type: 'replace_magic_number',
        target: { file: 'c.ts', startLine: 1, endLine: 1 },
        description: 'Test',
        benefit: 'Test',
        risk: 'low',
        effort: 'trivial',
        automatable: true,
        steps: [],
      },
    ];

    const summary = summarizeRefactoringSuggestions(suggestions);

    expect(summary.byRisk.low).toBe(2);
    expect(summary.byRisk.medium).toBe(1);
    expect(summary.byRisk.high).toBe(0);
    expect(summary.byEffort.trivial).toBe(1);
    expect(summary.byEffort.moderate).toBe(2);
  });

  it('includes top opportunities', () => {
    const suggestions: RefactoringSuggestion[] = Array(10)
      .fill(null)
      .map((_, i) => ({
        type: 'extract_function' as RefactoringType,
        target: { file: `file${i}.ts`, startLine: 1, endLine: 50 },
        description: `Function ${i}`,
        benefit: 'Better readability',
        risk: 'low' as const,
        effort: 'moderate' as const,
        automatable: false,
        steps: ['Step 1'],
      }));

    const summary = summarizeRefactoringSuggestions(suggestions);

    expect(summary.topOpportunities).toHaveLength(5);
    expect(summary.topOpportunities[0].file).toBe('file0.ts');
    expect(summary.topOpportunities[0].description).toBe('Function 0');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'refactoring-edge-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles files with no refactoring opportunities', async () => {
    const cleanFile = path.join(tempDir, 'clean.ts');
    await fs.writeFile(cleanFile, `function simpleFunc(a: number): number {\n  return a * 2;\n}`);

    const storage: Partial<LiBrainianStorage> = {
      getFiles: vi.fn().mockResolvedValue([{ path: cleanFile }]),
    };

    const suggestions = await findRefactoringOpportunities(
      storage as LiBrainianStorage,
      undefined,
      { includeLowPriority: true }
    );

    expect(suggestions.length).toBe(0);
  });

  it('handles empty storage', async () => {
    const storage: Partial<LiBrainianStorage> = {
      getFiles: vi.fn().mockResolvedValue([]),
    };

    const suggestions = await findRefactoringOpportunities(
      storage as LiBrainianStorage
    );

    expect(suggestions).toEqual([]);
  });

  it('handles files that exist and have issues', async () => {
    const issueFile = path.join(tempDir, 'issue.ts');
    await fs.writeFile(issueFile, `if (a && b && c && d) { x; }`);

    const storage: Partial<LiBrainianStorage> = {
      getFiles: vi.fn().mockResolvedValue([{ path: issueFile }]),
    };

    const suggestions = await findRefactoringOpportunities(
      storage as LiBrainianStorage
    );

    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('handles non-existent files gracefully', async () => {
    const storage: Partial<LiBrainianStorage> = {
      getFiles: vi.fn().mockResolvedValue([{ path: '/nonexistent/file.ts' }]),
    };

    const suggestions = await findRefactoringOpportunities(
      storage as LiBrainianStorage
    );

    // Should not throw, should just return empty
    expect(suggestions).toEqual([]);
  });
});
