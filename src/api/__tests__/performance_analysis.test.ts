import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  analyzePerformance,
  analyzePerformanceBatch,
  summarizePerformanceAnalysis,
  findNPlusOne,
  findBlockingIO,
  findMemoryLeakRisks,
  findInefficientLoops,
  findExpensiveOperations,
  findSyncInAsync,
  findLargeBundleImports,
  isPerformanceQuery,
  extractPerformanceTarget,
  PERFORMANCE_QUERY_PATTERNS,
  type PerformanceAnalysis,
  type PerformanceIssue,
} from '../performance_analysis.js';
import type { LiBrainianStorage, FunctionKnowledge } from '../../storage/types.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testDir: string;
let testFiles: string[] = [];

async function createTestFile(name: string, content: string): Promise<string> {
  const filePath = path.join(testDir, name);
  await fs.writeFile(filePath, content, 'utf-8');
  testFiles.push(filePath);
  return filePath;
}

function createMockStorage(functions?: FunctionKnowledge[]): LiBrainianStorage {
  return {
    getFunctionsByPath: vi.fn(async (path: string) => functions?.filter(f => f.filePath === path) ?? []),
    // Minimal implementation for other methods
    getFileByPath: vi.fn(async () => null),
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn(() => true),
    getCapabilities: vi.fn(() => ({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: { graphMetrics: false, multiVectors: false, embeddings: false, episodes: false, verificationPlans: false },
      versions: { schema: 1, api: 1 },
    })),
  } as unknown as LiBrainianStorage;
}

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-test-'));
  testFiles = [];
});

afterEach(async () => {
  // Cleanup test files
  for (const file of testFiles) {
    try {
      await fs.unlink(file);
    } catch {}
  }
  try {
    await fs.rmdir(testDir);
  } catch {}
});

// ============================================================================
// N+1 PATTERN DETECTION
// ============================================================================

describe('findNPlusOne', () => {
  it('detects await inside for loop', () => {
    const code = `
async function processItems(items) {
  for (const item of items) {
    await processItem(item);
  }
}
`;
    const issues = findNPlusOne(code, 'test.ts');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('n_plus_one');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].description).toContain('Sequential await in loop');
  });

  it('detects async forEach', () => {
    const code = `
items.forEach(async (item) => {
  await process(item);
});
`;
    const issues = findNPlusOne(code, 'test.ts');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('n_plus_one');
  });

  it('detects async map', () => {
    const code = `
const results = items.map(async item => {
  const data = await fetchData(item.id);
  return data;
});
`;
    const issues = findNPlusOne(code, 'test.ts');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('n_plus_one');
  });

  it('does not flag Promise.all usage', () => {
    const code = `
async function processAll(items) {
  await Promise.all(items.map(item => processItem(item)));
}
`;
    const issues = findNPlusOne(code, 'test.ts');
    // Should not detect issues when using Promise.all correctly
    expect(issues.length).toBe(0);
  });
});

// ============================================================================
// BLOCKING I/O DETECTION
// ============================================================================

describe('findBlockingIO', () => {
  it('detects readFileSync', () => {
    const code = `
const data = fs.readFileSync('config.json', 'utf8');
`;
    const issues = findBlockingIO(code, 'test.ts');
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('blocking_io');
    expect(issues[0].description).toContain('readFileSync');
  });

  it('detects writeFileSync', () => {
    const code = `
fs.writeFileSync('output.txt', content);
`;
    const issues = findBlockingIO(code, 'test.ts');
    expect(issues.length).toBe(1);
    expect(issues[0].description).toContain('writeFileSync');
  });

  it('detects execSync', () => {
    const code = `
const result = execSync('git status');
`;
    const issues = findBlockingIO(code, 'test.ts');
    expect(issues.length).toBe(1);
    expect(issues[0].description).toContain('execSync');
  });

  it('detects multiple sync operations', () => {
    const code = `
const exists = fs.existsSync(path);
const data = fs.readFileSync(path);
fs.writeFileSync(outputPath, data);
`;
    const issues = findBlockingIO(code, 'test.ts');
    expect(issues.length).toBe(3);
  });

  it('suggests async alternatives in fix', () => {
    const code = `fs.readFileSync('file.txt')`;
    const issues = findBlockingIO(code, 'test.ts');
    expect(issues[0].fix).toContain('readFile');
    expect(issues[0].fix).toContain('await');
  });
});

// ============================================================================
// MEMORY LEAK DETECTION
// ============================================================================

describe('findMemoryLeakRisks', () => {
  it('detects unbounded array growth', () => {
    const code = `
const items = [];
function addItem(item) {
  items.push(item);
}
`;
    const issues = findMemoryLeakRisks(code, 'test.ts');
    expect(issues.some(i => i.type === 'unbounded_growth')).toBe(true);
  });

  it('does not flag bounded arrays', () => {
    const code = `
const items = [];
function addItem(item) {
  items.push(item);
  if (items.length > 100) {
    items.shift();
  }
}
`;
    const issues = findMemoryLeakRisks(code, 'test.ts');
    expect(issues.filter(i => i.type === 'unbounded_growth').length).toBe(0);
  });

  it('detects event listener without cleanup', () => {
    const code = `
element.addEventListener('click', handler);
`;
    const issues = findMemoryLeakRisks(code, 'src/app.ts');
    expect(issues.some(i => i.type === 'memory_leak_risk')).toBe(true);
  });

  it('does not flag event listeners with cleanup', () => {
    const code = `
element.addEventListener('click', handler);
// later
element.removeEventListener('click', handler);
`;
    const issues = findMemoryLeakRisks(code, 'src/app.ts');
    expect(issues.filter(i => i.type === 'memory_leak_risk' && i.description.includes('Event listener')).length).toBe(0);
  });

  it('detects setInterval without clearInterval', () => {
    const code = `
setInterval(() => {
  doSomething();
}, 1000);
`;
    const issues = findMemoryLeakRisks(code, 'test.ts');
    expect(issues.some(i => i.description.includes('setInterval'))).toBe(true);
  });

  it('does not flag setInterval with clearInterval', () => {
    const code = `
const id = setInterval(() => {
  doSomething();
}, 1000);
clearInterval(id);
`;
    const issues = findMemoryLeakRisks(code, 'test.ts');
    expect(issues.filter(i => i.description.includes('setInterval')).length).toBe(0);
  });
});

// ============================================================================
// INEFFICIENT LOOP DETECTION
// ============================================================================

describe('findInefficientLoops', () => {
  it('detects includes() inside for loop', () => {
    const code = `
for (const item of items) {
  if (seen.includes(item.id)) {
    continue;
  }
}
`;
    const issues = findInefficientLoops(code, 'test.ts');
    expect(issues.some(i => i.type === 'inefficient_loop')).toBe(true);
    expect(issues[0].fix).toContain('Set');
  });

  it('detects indexOf() inside forEach', () => {
    const code = `
items.forEach(item => {
  const idx = arr.indexOf(item);
  if (idx >= 0) { /* ... */ }
});
`;
    const issues = findInefficientLoops(code, 'test.ts');
    expect(issues.some(i => i.type === 'inefficient_loop')).toBe(true);
  });

  it('detects chained array methods', () => {
    const code = `
const result = items.filter(x => x.active).map(x => x.name);
`;
    const issues = findInefficientLoops(code, 'test.ts');
    expect(issues.some(i => i.description.includes('Chained array methods'))).toBe(true);
  });
});

// ============================================================================
// EXPENSIVE OPERATIONS DETECTION
// ============================================================================

describe('findExpensiveOperations', () => {
  it('detects regex inside loop', () => {
    const code = `
for (const line of lines) {
  const match = new RegExp(pattern).exec(line);
}
`;
    const issues = findExpensiveOperations(code, 'test.ts');
    expect(issues.some(i => i.type === 'expensive_regex')).toBe(true);
  });

  it('detects JSON.stringify in loop', () => {
    const code = `
for (const item of items) {
  const str = JSON.stringify(item);
  results.push(str);
}
`;
    const issues = findExpensiveOperations(code, 'test.ts');
    expect(issues.some(i => i.description.includes('JSON'))).toBe(true);
  });

  it('detects JSON.parse in map', () => {
    const code = `
items.map(item => {
  return JSON.parse(item.data);
});
`;
    const issues = findExpensiveOperations(code, 'test.ts');
    expect(issues.some(i => i.description.includes('JSON'))).toBe(true);
  });
});

// ============================================================================
// SYNC IN ASYNC DETECTION
// ============================================================================

describe('findSyncInAsync', () => {
  it('detects sync file read followed by JSON parse in async function', () => {
    const code = `
async function loadConfig() {
  const data = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  return data;
}
`;
    const issues = findSyncInAsync(code, 'test.ts');
    expect(issues.some(i => i.type === 'sync_in_async')).toBe(true);
  });
});

// ============================================================================
// LARGE BUNDLE IMPORT DETECTION
// ============================================================================

describe('findLargeBundleImports', () => {
  it('detects lodash namespace import', () => {
    const code = `import * as _ from 'lodash';`;
    const issues = findLargeBundleImports(code, 'test.ts');
    expect(issues.some(i => i.type === 'large_bundle_import')).toBe(true);
    expect(issues[0].description).toContain('lodash');
  });

  it('detects moment import', () => {
    const code = `import * as moment from 'moment';`;
    const issues = findLargeBundleImports(code, 'test.ts');
    expect(issues.some(i => i.description.includes('moment'))).toBe(true);
  });

  it('detects generic namespace import', () => {
    const code = `import * as bigLib from 'some-big-library';`;
    const issues = findLargeBundleImports(code, 'test.ts');
    expect(issues.some(i => i.type === 'large_bundle_import')).toBe(true);
  });

  it('does not flag local namespace imports', () => {
    const code = `import * as utils from './utils';`;
    const issues = findLargeBundleImports(code, 'test.ts');
    expect(issues.length).toBe(0);
  });

  it('does not flag node: namespace imports', () => {
    const code = `import * as fs from 'node:fs';`;
    const issues = findLargeBundleImports(code, 'test.ts');
    expect(issues.length).toBe(0);
  });
});

// ============================================================================
// QUERY PATTERN MATCHING
// ============================================================================

describe('isPerformanceQuery', () => {
  it('matches "analyze performance of X"', () => {
    expect(isPerformanceQuery('analyze performance of query.ts')).toBe(true);
  });

  it('matches "find performance issues"', () => {
    expect(isPerformanceQuery('find performance issues in the storage module')).toBe(true);
  });

  it('matches "performance bottlenecks"', () => {
    expect(isPerformanceQuery('what are the performance bottlenecks')).toBe(true);
  });

  it('matches "memory leak"', () => {
    expect(isPerformanceQuery('check for memory leak in the cache')).toBe(true);
  });

  it('matches "n+1 query"', () => {
    expect(isPerformanceQuery('find n+1 query patterns')).toBe(true);
  });

  it('matches "optimization opportunities"', () => {
    expect(isPerformanceQuery('show optimization opportunities')).toBe(true);
  });

  it('matches "slow code"', () => {
    expect(isPerformanceQuery('find slow code in the API')).toBe(true);
  });

  it('matches "time complexity"', () => {
    expect(isPerformanceQuery('analyze time complexity of this function')).toBe(true);
  });

  it('does not match unrelated queries', () => {
    expect(isPerformanceQuery('what does this function do')).toBe(false);
    expect(isPerformanceQuery('add authentication')).toBe(false);
    expect(isPerformanceQuery('refactor the module')).toBe(false);
  });
});

describe('extractPerformanceTarget', () => {
  it('extracts file from "analyze performance of X"', () => {
    expect(extractPerformanceTarget('analyze performance of query.ts')).toBe('query.ts');
  });

  it('extracts file from "performance issues in X"', () => {
    expect(extractPerformanceTarget('performance issues in src/api/storage.ts')).toBe('src/api/storage.ts');
  });

  it('extracts file from quoted paths', () => {
    expect(extractPerformanceTarget('analyze performance of "src/query.ts"')).toBe('src/query.ts');
  });

  it('returns undefined for queries without target', () => {
    expect(extractPerformanceTarget('find performance issues')).toBeUndefined();
  });
});

// ============================================================================
// FULL ANALYSIS WITH REAL FILES
// ============================================================================

describe('analyzePerformance', () => {
  it('returns complete analysis for a file with issues', async () => {
    const code = `
async function fetchAll(ids) {
  for (const id of ids) {
    const data = await fetch(\`/api/\${id}\`);
    results.push(data);
  }
  return results;
}

function process() {
  const config = fs.readFileSync('config.json');
  return JSON.parse(config);
}
`;
    const filePath = await createTestFile('test-issues.ts', code);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    expect(analysis.file).toBe(filePath);
    expect(analysis.issues.length).toBeGreaterThan(0);
    expect(analysis.issues.some(i => i.type === 'n_plus_one')).toBe(true);
    expect(analysis.issues.some(i => i.type === 'blocking_io')).toBe(true);
    expect(analysis.overallRisk).toBeDefined();
    expect(['low', 'medium', 'high']).toContain(analysis.overallRisk);
    expect(analysis.metadata.analyzedAt).toBeDefined();
    expect(analysis.metadata.linesAnalyzed).toBeGreaterThan(0);
  });

  it('returns low risk for clean code', async () => {
    const code = `
async function fetchAll(ids) {
  return Promise.all(ids.map(id => fetch(\`/api/\${id}\`)));
}

async function loadConfig() {
  const config = await fs.promises.readFile('config.json', 'utf8');
  return JSON.parse(config);
}
`;
    const filePath = await createTestFile('clean.ts', code);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    expect(analysis.overallRisk).toBe('low');
  });

  it('generates optimizations based on issues', async () => {
    const code = `
for (const item of items) {
  await process(item);
  if (seen.includes(item.id)) continue;
}
`;
    const filePath = await createTestFile('needs-opt.ts', code);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    expect(analysis.optimizations.length).toBeGreaterThan(0);
    expect(analysis.optimizations.some(o => o.type === 'batch_async' || o.type === 'use_set')).toBe(true);
  });

  it('throws error for non-existent file', async () => {
    const storage = createMockStorage();

    await expect(analyzePerformance(storage, '/nonexistent/path.ts')).rejects.toThrow('Cannot read file');
  });
});

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

describe('analyzePerformanceBatch', () => {
  it('analyzes multiple files', async () => {
    const file1 = await createTestFile('file1.ts', 'fs.readFileSync("a");');
    const file2 = await createTestFile('file2.ts', 'for (const x of xs) { await f(x); }');
    const storage = createMockStorage();

    const results = await analyzePerformanceBatch(storage, [file1, file2]);

    expect(results.size).toBe(2);
    expect(results.has(file1)).toBe(true);
    expect(results.has(file2)).toBe(true);
  });

  it('skips files that cannot be read', async () => {
    const goodFile = await createTestFile('good.ts', 'const x = 1;');
    const storage = createMockStorage();

    const results = await analyzePerformanceBatch(storage, [goodFile, '/nonexistent/missing.ts']);

    expect(results.size).toBe(1);
    expect(results.has(goodFile)).toBe(true);
  });
});

describe('summarizePerformanceAnalysis', () => {
  it('aggregates results from multiple analyses', async () => {
    const highRiskFile = await createTestFile('high-risk.ts', `
      fs.readFileSync("a");
      fs.writeFileSync("b", c);
      for (x of xs) { await f(x); }
      for (y of ys) { await g(y); }
    `);
    const mediumRiskFile = await createTestFile('medium-risk.ts', 'for (x of xs) { await f(x); }');
    const lowRiskFile = await createTestFile('low-risk.ts', 'const x = 1;');
    const storage = createMockStorage();

    const files = [highRiskFile, mediumRiskFile, lowRiskFile];
    const results = await analyzePerformanceBatch(storage, files);
    const summary = summarizePerformanceAnalysis(results);

    expect(summary.totalFiles).toBe(3);
    expect(summary.totalIssues).toBeGreaterThan(0);
    expect(Object.keys(summary.issuesByType).length).toBeGreaterThan(0);
    expect(Object.keys(summary.issuesBySeverity).length).toBeGreaterThan(0);
    expect(summary.topOptimizations.length).toBeGreaterThan(0);
  });

  it('deduplicates optimizations', async () => {
    const file1 = await createTestFile('dup1.ts', 'for (x of xs) { await f(x); }');
    const file2 = await createTestFile('dup2.ts', 'for (y of ys) { await g(y); }');
    const storage = createMockStorage();

    const results = await analyzePerformanceBatch(storage, [file1, file2]);
    const summary = summarizePerformanceAnalysis(results);

    // Should have deduplicated batch_async optimization
    const batchAsyncCount = summary.topOptimizations.filter(o => o.type === 'batch_async').length;
    expect(batchAsyncCount).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  it('handles empty file', async () => {
    const filePath = await createTestFile('empty.ts', '');
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    expect(analysis.issues.length).toBe(0);
    expect(analysis.overallRisk).toBe('low');
  });

  it('handles file with only comments', async () => {
    const filePath = await createTestFile('comments.ts', `
// This is a comment
/* Block comment */
/**
 * JSDoc
 */
`);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    expect(analysis.issues.length).toBe(0);
  });

  it('handles very long lines', async () => {
    const longLine = 'const x = ' + '"a"'.repeat(1000) + ';';
    const filePath = await createTestFile('long.ts', longLine);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    // Should not throw
    expect(analysis).toBeDefined();
  });

  it('handles nested async patterns correctly', async () => {
    const code = `
async function outer() {
  for (const a of as) {
    await Promise.all(bs.map(b => inner(a, b)));
  }
}
`;
    const filePath = await createTestFile('nested.ts', code);
    const storage = createMockStorage();

    const analysis = await analyzePerformance(storage, filePath);

    // The outer loop still has sequential awaits, but inner is parallelized
    // This is a legitimate N+1 at the outer level
    expect(analysis.issues.some(i => i.type === 'n_plus_one')).toBe(true);
  });
});

// ============================================================================
// PATTERN EXHAUSTIVENESS
// ============================================================================

describe('PERFORMANCE_QUERY_PATTERNS exhaustiveness', () => {
  const testCases = [
    'analyze performance',
    'performance issues',
    'find performance problems',
    'performance bottlenecks',
    'optimization opportunities',
    'slow functions',
    'n+1 problem',
    'memory leak detection',
    'blocking io',
    'performance hotspots',
    'cpu intensive code',
    'time complexity analysis',
    'inefficient algorithm',
  ];

  for (const query of testCases) {
    it(`matches query: "${query}"`, () => {
      expect(PERFORMANCE_QUERY_PATTERNS.some(p => p.test(query))).toBe(true);
    });
  }
});
