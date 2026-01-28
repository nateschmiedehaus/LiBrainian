/**
 * @fileoverview Tests for Dynamic Coverage Integration
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Dynamic Coverage Integrator validates dead code claims by integrating
 * runtime coverage data from Istanbul/NYC/c8:
 * - Loads and parses coverage data from JSON reports
 * - Cross-references static dead code analysis with runtime coverage
 * - Calculates confidence based on both static and dynamic evidence
 * - Handles partial coverage scenarios
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  createDynamicCoverageIntegrator,
  type CoverageData,
  type DeadCodeEvidence,
  type DynamicCoverageIntegrator,
} from '../dynamic_coverage.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as context
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

/**
 * Creates a temporary coverage JSON file
 */
function createCoverageFile(coverage: object): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
  const filePath = path.join(tmpDir, 'coverage-final.json');
  fs.writeFileSync(filePath, JSON.stringify(coverage, null, 2));
  return filePath;
}

/**
 * Creates an Istanbul/NYC style coverage report
 */
function createIstanbulCoverage(files: Record<string, IstanbulFileCoverage>): object {
  return files;
}

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  fnMap: Record<string, { name: string; decl: { start: { line: number } } }>;
  branchMap: Record<string, { type: string; locations: Array<{ start: { line: number } }> }>;
  s: Record<string, number>; // statement hit counts
  f: Record<string, number>; // function hit counts
  b: Record<string, number[]>; // branch hit counts
}

/**
 * Creates a simple Istanbul coverage entry for a file
 */
function createFileCoverage(
  filePath: string,
  options: {
    coveredLines?: number[];
    uncoveredLines?: number[];
    coveredFunctions?: string[];
    uncoveredFunctions?: string[];
    coveredBranches?: string[];
    uncoveredBranches?: string[];
  } = {}
): IstanbulFileCoverage {
  const statementMap: Record<string, { start: { line: number }; end: { line: number } }> = {};
  const s: Record<string, number> = {};
  const fnMap: Record<string, { name: string; decl: { start: { line: number } } }> = {};
  const f: Record<string, number> = {};
  const branchMap: Record<
    string,
    { type: string; locations: Array<{ start: { line: number } }> }
  > = {};
  const b: Record<string, number[]> = {};

  // Add covered statements
  let stmtIdx = 0;
  for (const line of options.coveredLines || []) {
    statementMap[String(stmtIdx)] = { start: { line }, end: { line } };
    s[String(stmtIdx)] = 1;
    stmtIdx++;
  }

  // Add uncovered statements
  for (const line of options.uncoveredLines || []) {
    statementMap[String(stmtIdx)] = { start: { line }, end: { line } };
    s[String(stmtIdx)] = 0;
    stmtIdx++;
  }

  // Add covered functions
  let fnIdx = 0;
  for (const name of options.coveredFunctions || []) {
    fnMap[String(fnIdx)] = { name, decl: { start: { line: fnIdx + 1 } } };
    f[String(fnIdx)] = 1;
    fnIdx++;
  }

  // Add uncovered functions
  for (const name of options.uncoveredFunctions || []) {
    fnMap[String(fnIdx)] = { name, decl: { start: { line: fnIdx + 1 } } };
    f[String(fnIdx)] = 0;
    fnIdx++;
  }

  // Add covered branches
  let branchIdx = 0;
  for (const id of options.coveredBranches || []) {
    branchMap[String(branchIdx)] = { type: 'if', locations: [{ start: { line: branchIdx + 1 } }] };
    b[String(branchIdx)] = [1];
    branchIdx++;
  }

  // Add uncovered branches
  for (const id of options.uncoveredBranches || []) {
    branchMap[String(branchIdx)] = { type: 'if', locations: [{ start: { line: branchIdx + 1 } }] };
    b[String(branchIdx)] = [0];
    branchIdx++;
  }

  return {
    path: filePath,
    statementMap,
    fnMap,
    branchMap,
    s,
    f,
    b,
  };
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createDynamicCoverageIntegrator', () => {
  it('should create an integrator instance', () => {
    const integrator = createDynamicCoverageIntegrator();
    expect(integrator).toBeDefined();
    expect(typeof integrator.loadCoverageData).toBe('function');
    expect(typeof integrator.parseCoverageReport).toBe('function');
    expect(typeof integrator.crossReferenceWithStatic).toBe('function');
    expect(typeof integrator.getDeadCodeReport).toBe('function');
  });
});

// ============================================================================
// COVERAGE DATA LOADING TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - loadCoverageData', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should load Istanbul/NYC coverage JSON file', async () => {
    const coverage = createIstanbulCoverage({
      '/project/src/main.ts': createFileCoverage('/project/src/main.ts', {
        coveredLines: [1, 2, 3, 5, 6],
        uncoveredLines: [10, 11, 12],
        coveredFunctions: ['main', 'helper'],
        uncoveredFunctions: ['unusedFunc'],
      }),
    });

    const coveragePath = createCoverageFile(coverage);
    const result = await integrator.loadCoverageData(coveragePath);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return CoverageData with correct structure', async () => {
    const coverage = createIstanbulCoverage({
      '/project/src/utils.ts': createFileCoverage('/project/src/utils.ts', {
        coveredLines: [1, 2, 3],
        uncoveredLines: [10, 11],
        coveredFunctions: ['helper'],
        uncoveredFunctions: ['unused'],
      }),
    });

    const coveragePath = createCoverageFile(coverage);
    const result = await integrator.loadCoverageData(coveragePath);

    const fileData = result[0];
    expect(fileData.filePath).toBe('/project/src/utils.ts');
    expect(Array.isArray(fileData.coveredLines)).toBe(true);
    expect(Array.isArray(fileData.uncoveredLines)).toBe(true);
    expect(fileData.functions).toBeInstanceOf(Map);
    expect(fileData.branches).toBeInstanceOf(Map);
  });

  it('should handle multiple files in coverage report', async () => {
    const coverage = createIstanbulCoverage({
      '/project/src/a.ts': createFileCoverage('/project/src/a.ts', {
        coveredLines: [1, 2],
      }),
      '/project/src/b.ts': createFileCoverage('/project/src/b.ts', {
        coveredLines: [1, 2, 3],
      }),
      '/project/src/c.ts': createFileCoverage('/project/src/c.ts', {
        uncoveredLines: [1, 2, 3, 4],
      }),
    });

    const coveragePath = createCoverageFile(coverage);
    const result = await integrator.loadCoverageData(coveragePath);

    expect(result.length).toBe(3);
    expect(result.map((d) => d.filePath)).toContain('/project/src/a.ts');
    expect(result.map((d) => d.filePath)).toContain('/project/src/b.ts');
    expect(result.map((d) => d.filePath)).toContain('/project/src/c.ts');
  });

  it('should handle non-existent coverage file gracefully', async () => {
    const result = await integrator.loadCoverageData('/non/existent/coverage.json');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should handle malformed JSON gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
    const filePath = path.join(tmpDir, 'bad-coverage.json');
    fs.writeFileSync(filePath, '{ invalid json }}}');

    const result = await integrator.loadCoverageData(filePath);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// COVERAGE REPORT PARSING TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - parseCoverageReport', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should parse Istanbul coverage JSON string', () => {
    const coverage = createIstanbulCoverage({
      '/project/src/main.ts': createFileCoverage('/project/src/main.ts', {
        coveredLines: [1, 2, 3],
        uncoveredLines: [10],
      }),
    });

    const result = integrator.parseCoverageReport(JSON.stringify(coverage));

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].filePath).toBe('/project/src/main.ts');
  });

  it('should extract covered and uncovered lines', () => {
    const coverage = createIstanbulCoverage({
      '/project/src/file.ts': createFileCoverage('/project/src/file.ts', {
        coveredLines: [1, 2, 3, 5, 6],
        uncoveredLines: [10, 11, 12, 20],
      }),
    });

    const result = integrator.parseCoverageReport(JSON.stringify(coverage));

    const fileData = result[0];
    expect(fileData.coveredLines).toEqual(expect.arrayContaining([1, 2, 3, 5, 6]));
    expect(fileData.uncoveredLines).toEqual(expect.arrayContaining([10, 11, 12, 20]));
  });

  it('should extract function coverage', () => {
    const coverage = createIstanbulCoverage({
      '/project/src/funcs.ts': createFileCoverage('/project/src/funcs.ts', {
        coveredFunctions: ['usedFunc', 'anotherUsed'],
        uncoveredFunctions: ['neverCalled', 'deadFunc'],
      }),
    });

    const result = integrator.parseCoverageReport(JSON.stringify(coverage));

    const fileData = result[0];
    expect(fileData.functions.get('usedFunc')?.covered).toBe(true);
    expect(fileData.functions.get('anotherUsed')?.covered).toBe(true);
    expect(fileData.functions.get('neverCalled')?.covered).toBe(false);
    expect(fileData.functions.get('deadFunc')?.covered).toBe(false);
  });

  it('should extract branch coverage', () => {
    const coverage = createIstanbulCoverage({
      '/project/src/branches.ts': createFileCoverage('/project/src/branches.ts', {
        coveredBranches: ['if-1', 'if-2'],
        uncoveredBranches: ['if-3'],
      }),
    });

    const result = integrator.parseCoverageReport(JSON.stringify(coverage));

    const fileData = result[0];
    expect(fileData.branches.size).toBeGreaterThan(0);
  });

  it('should return empty array for invalid JSON', () => {
    const result = integrator.parseCoverageReport('not valid json');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should handle empty coverage report', () => {
    const result = integrator.parseCoverageReport('{}');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should track hit counts for functions', () => {
    // Create coverage with specific hit counts
    const fileCoverage: IstanbulFileCoverage = {
      path: '/project/src/hits.ts',
      statementMap: {},
      fnMap: {
        '0': { name: 'hotFunction', decl: { start: { line: 1 } } },
        '1': { name: 'coldFunction', decl: { start: { line: 10 } } },
      },
      branchMap: {},
      s: {},
      f: { '0': 100, '1': 1 }, // hotFunction called 100 times, coldFunction once
      b: {},
    };

    const coverage = createIstanbulCoverage({
      '/project/src/hits.ts': fileCoverage,
    });

    const result = integrator.parseCoverageReport(JSON.stringify(coverage));

    const fileData = result[0];
    expect(fileData.functions.get('hotFunction')?.hitCount).toBe(100);
    expect(fileData.functions.get('coldFunction')?.hitCount).toBe(1);
  });
});

// ============================================================================
// CROSS-REFERENCE WITH STATIC ANALYSIS TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - crossReferenceWithStatic', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should confirm dead code when both static and dynamic agree', () => {
    const staticDeadCode = ['/project/src/main.ts:10', '/project/src/main.ts:11'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [1, 2, 3, 5, 6],
        uncoveredLines: [10, 11, 12],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    expect(evidence.length).toBeGreaterThan(0);
    const line10Evidence = evidence.find(
      (e) => e.filePath === '/project/src/main.ts' && e.lineNumber === 10
    );
    expect(line10Evidence).toBeDefined();
    expect(line10Evidence?.staticAnalysis).toBe(true);
    expect(line10Evidence?.dynamicEvidence).toBe(true);
    expect(line10Evidence?.confidence).toBeGreaterThan(0.8);
  });

  it('should identify false positives when static says dead but dynamic shows covered', () => {
    const staticDeadCode = ['/project/src/main.ts:5']; // Static thinks line 5 is dead

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [1, 2, 3, 5, 6], // But line 5 is actually covered
        uncoveredLines: [10, 11],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    const line5Evidence = evidence.find(
      (e) => e.filePath === '/project/src/main.ts' && e.lineNumber === 5
    );
    expect(line5Evidence).toBeDefined();
    expect(line5Evidence?.staticAnalysis).toBe(true);
    expect(line5Evidence?.dynamicEvidence).toBe(false); // Covered at runtime
    expect(line5Evidence?.confidence).toBeLessThan(0.5); // Low confidence - likely false positive
  });

  it('should handle static dead code without coverage data', () => {
    const staticDeadCode = ['/project/src/uncovered-file.ts:10'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/different-file.ts',
        coveredLines: [1, 2, 3],
        uncoveredLines: [],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    const fileEvidence = evidence.find((e) => e.filePath === '/project/src/uncovered-file.ts');
    expect(fileEvidence).toBeDefined();
    expect(fileEvidence?.staticAnalysis).toBe(true);
    // No coverage data means we can't confirm or deny dynamically
    expect(fileEvidence?.confidence).toBeLessThan(0.8);
  });

  it('should parse file:line format from static dead code', () => {
    const staticDeadCode = [
      '/project/src/a.ts:10',
      '/project/src/b.ts:20:funcName', // With optional symbol name
    ];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/a.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
      {
        filePath: '/project/src/b.ts',
        coveredLines: [],
        uncoveredLines: [20],
        functions: new Map([['funcName', { covered: false, hitCount: 0 }]]),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    expect(evidence.length).toBe(2);
    expect(evidence.some((e) => e.filePath === '/project/src/a.ts' && e.lineNumber === 10)).toBe(
      true
    );
    expect(evidence.some((e) => e.filePath === '/project/src/b.ts' && e.lineNumber === 20)).toBe(
      true
    );

    const bEvidence = evidence.find((e) => e.filePath === '/project/src/b.ts');
    expect(bEvidence?.symbolName).toBe('funcName');
  });

  it('should handle function-level dead code detection', () => {
    const staticDeadCode = ['/project/src/funcs.ts:10:deadFunction'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/funcs.ts',
        coveredLines: [1, 2, 3],
        uncoveredLines: [10, 11, 12],
        functions: new Map([
          ['liveFunction', { covered: true, hitCount: 5 }],
          ['deadFunction', { covered: false, hitCount: 0 }],
        ]),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    const funcEvidence = evidence.find((e) => e.symbolName === 'deadFunction');
    expect(funcEvidence).toBeDefined();
    expect(funcEvidence?.staticAnalysis).toBe(true);
    expect(funcEvidence?.dynamicEvidence).toBe(true);
    // Confidence depends on overall file coverage - 0.85 is good for function-level
    expect(funcEvidence?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('should calculate confidence based on evidence strength', () => {
    const staticDeadCode = [
      '/project/src/a.ts:10', // Both static + dynamic agree
      '/project/src/b.ts:20', // Only static
      '/project/src/c.ts:30', // Static says dead, dynamic says covered
    ];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/a.ts',
        coveredLines: [1, 2],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
      {
        filePath: '/project/src/b.ts',
        coveredLines: [], // No coverage data for this file
        uncoveredLines: [],
        functions: new Map(),
        branches: new Map(),
      },
      {
        filePath: '/project/src/c.ts',
        coveredLines: [30], // Line 30 IS covered
        uncoveredLines: [],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    const aEvidence = evidence.find((e) => e.filePath === '/project/src/a.ts');
    const bEvidence = evidence.find((e) => e.filePath === '/project/src/b.ts');
    const cEvidence = evidence.find((e) => e.filePath === '/project/src/c.ts');

    // A should have highest confidence (both agree)
    // B should have medium confidence (only static)
    // C should have lowest confidence (disagreement - likely false positive)
    expect(aEvidence?.confidence).toBeGreaterThan(bEvidence?.confidence || 0);
    expect(bEvidence?.confidence).toBeGreaterThan(cEvidence?.confidence || 0);
  });

  it('should return DeadCodeEvidence with correct structure', () => {
    const staticDeadCode = ['/project/src/main.ts:10:someFunc'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map([['someFunc', { covered: false, hitCount: 0 }]]),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    expect(evidence.length).toBe(1);
    const e = evidence[0];

    expect(typeof e.filePath).toBe('string');
    expect(typeof e.lineNumber).toBe('number');
    expect(e.symbolName === undefined || typeof e.symbolName === 'string').toBe(true);
    expect(typeof e.staticAnalysis).toBe('boolean');
    expect(typeof e.dynamicEvidence).toBe('boolean');
    expect(typeof e.confidence).toBe('number');
    expect(e.confidence).toBeGreaterThanOrEqual(0);
    expect(e.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// DEAD CODE REPORT TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - getDeadCodeReport', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should return empty report before any cross-referencing', () => {
    const report = integrator.getDeadCodeReport();

    expect(report.total).toBe(0);
    expect(report.confirmedDead).toBe(0);
    expect(report.falsePositives).toBe(0);
  });

  it('should track total dead code candidates', () => {
    const staticDeadCode = [
      '/project/src/a.ts:10',
      '/project/src/a.ts:11',
      '/project/src/b.ts:20',
    ];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/a.ts',
        coveredLines: [],
        uncoveredLines: [10, 11],
        functions: new Map(),
        branches: new Map(),
      },
      {
        filePath: '/project/src/b.ts',
        coveredLines: [],
        uncoveredLines: [20],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    integrator.crossReferenceWithStatic(staticDeadCode, coverage);
    const report = integrator.getDeadCodeReport();

    expect(report.total).toBe(3);
  });

  it('should count confirmed dead code', () => {
    const staticDeadCode = ['/project/src/main.ts:10', '/project/src/main.ts:11'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [],
        uncoveredLines: [10, 11], // Both are uncovered - confirmed dead
        functions: new Map(),
        branches: new Map(),
      },
    ];

    integrator.crossReferenceWithStatic(staticDeadCode, coverage);
    const report = integrator.getDeadCodeReport();

    expect(report.confirmedDead).toBe(2);
  });

  it('should count false positives', () => {
    const staticDeadCode = [
      '/project/src/main.ts:5', // Static thinks dead
      '/project/src/main.ts:10', // Static thinks dead
    ];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [5], // Line 5 is actually covered - false positive
        uncoveredLines: [10], // Line 10 is truly uncovered
        functions: new Map(),
        branches: new Map(),
      },
    ];

    integrator.crossReferenceWithStatic(staticDeadCode, coverage);
    const report = integrator.getDeadCodeReport();

    expect(report.falsePositives).toBe(1);
    expect(report.confirmedDead).toBe(1);
  });

  it('should accumulate results across multiple cross-reference calls', () => {
    const staticDeadCode1 = ['/project/src/a.ts:10'];
    const staticDeadCode2 = ['/project/src/b.ts:20'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/a.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
      {
        filePath: '/project/src/b.ts',
        coveredLines: [],
        uncoveredLines: [20],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    integrator.crossReferenceWithStatic(staticDeadCode1, coverage);
    integrator.crossReferenceWithStatic(staticDeadCode2, coverage);
    const report = integrator.getDeadCodeReport();

    expect(report.total).toBe(2);
  });
});

// ============================================================================
// C8 COVERAGE FORMAT TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - c8 format support', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should parse c8 coverage format (V8 style)', () => {
    // c8 produces similar format to Istanbul but may have slight differences
    const c8Coverage = {
      '/project/src/main.ts': {
        path: '/project/src/main.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
          '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 15 } },
        },
        fnMap: {
          '0': {
            name: 'main',
            decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
          },
        },
        branchMap: {},
        s: { '0': 1, '1': 0 },
        f: { '0': 1 },
        b: {},
      },
    };

    const result = integrator.parseCoverageReport(JSON.stringify(c8Coverage));

    expect(result.length).toBe(1);
    expect(result[0].filePath).toBe('/project/src/main.ts');
    expect(result[0].coveredLines).toContain(1);
    expect(result[0].uncoveredLines).toContain(2);
  });
});

// ============================================================================
// PARTIAL COVERAGE TESTS
// ============================================================================

describe('DynamicCoverageIntegrator - partial coverage handling', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should handle files with partial test coverage', () => {
    // Some tests ran but not all code paths were covered
    const staticDeadCode = ['/project/src/main.ts:10', '/project/src/main.ts:20'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [1, 2, 3, 5, 6, 7, 8, 9], // Good coverage
        uncoveredLines: [10, 20], // But these lines never ran
        functions: new Map([
          ['mainPath', { covered: true, hitCount: 10 }],
          ['edgeCasePath', { covered: false, hitCount: 0 }],
        ]),
        branches: new Map([
          ['if-1', { covered: true, hitCount: 5 }],
          ['if-2', { covered: false, hitCount: 0 }],
        ]),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    // Both lines are confirmed dead with good confidence
    expect(evidence.every((e) => e.dynamicEvidence === true)).toBe(true);
    expect(evidence.every((e) => e.confidence >= 0.8)).toBe(true);
  });

  it('should reduce confidence when file has very low overall coverage', () => {
    // If a file has very low coverage, uncovered lines might just be untested, not dead
    const staticDeadCode = ['/project/src/low-coverage.ts:50'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/low-coverage.ts',
        coveredLines: [1, 2], // Only 2 lines covered out of many
        uncoveredLines: Array.from({ length: 100 }, (_, i) => i + 3), // 100 uncovered lines
        functions: new Map([
          ['tested', { covered: true, hitCount: 1 }],
          ...Array.from({ length: 10 }, (_, i) => [`untested${i}`, { covered: false, hitCount: 0 }]),
        ]) as Map<string, { covered: boolean; hitCount: number }>,
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    // With such low coverage, we should have reduced confidence
    const fileEvidence = evidence.find((e) => e.filePath === '/project/src/low-coverage.ts');
    expect(fileEvidence).toBeDefined();
    // Confidence should be moderate - we can't be sure if it's dead or just untested
    expect(fileEvidence?.confidence).toBeLessThan(0.95);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('DynamicCoverageIntegrator - Edge Cases', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should handle empty static dead code list', () => {
    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [1, 2, 3],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic([], coverage);

    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.length).toBe(0);
  });

  it('should handle empty coverage data', () => {
    const staticDeadCode = ['/project/src/main.ts:10'];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, []);

    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.length).toBe(1);
    // Should still create evidence but with reduced confidence
    expect(evidence[0].staticAnalysis).toBe(true);
    expect(evidence[0].dynamicEvidence).toBe(false); // No coverage data
  });

  it('should handle Windows-style paths', () => {
    const staticDeadCode = ['C:\\project\\src\\main.ts:10'];

    const coverage: CoverageData[] = [
      {
        filePath: 'C:\\project\\src\\main.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    expect(evidence.length).toBe(1);
    expect(evidence[0].filePath).toBe('C:\\project\\src\\main.ts');
  });

  it('should handle relative paths in static dead code', () => {
    const staticDeadCode = ['src/main.ts:10'];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    // Should attempt to match by filename
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle duplicate entries gracefully', () => {
    const staticDeadCode = [
      '/project/src/main.ts:10',
      '/project/src/main.ts:10', // Duplicate
    ];

    const coverage: CoverageData[] = [
      {
        filePath: '/project/src/main.ts',
        coveredLines: [],
        uncoveredLines: [10],
        functions: new Map(),
        branches: new Map(),
      },
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverage);

    // Should deduplicate
    const line10Evidence = evidence.filter(
      (e) => e.filePath === '/project/src/main.ts' && e.lineNumber === 10
    );
    expect(line10Evidence.length).toBe(1);
  });
});

// ============================================================================
// INTEGRATION TEST WITH REAL COVERAGE
// ============================================================================

describe('DynamicCoverageIntegrator - Integration', () => {
  let integrator: DynamicCoverageIntegrator;

  beforeEach(() => {
    integrator = createDynamicCoverageIntegrator();
  });

  it('should work with realistic Istanbul coverage output', async () => {
    // Simulate realistic Istanbul coverage output
    const realisticCoverage = {
      '/Users/dev/project/src/utils/helpers.ts': {
        path: '/Users/dev/project/src/utils/helpers.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 35 } },
          '1': { start: { line: 2, column: 2 }, end: { line: 2, column: 15 } },
          '2': { start: { line: 5, column: 0 }, end: { line: 5, column: 40 } },
          '3': { start: { line: 6, column: 2 }, end: { line: 6, column: 20 } },
          '4': { start: { line: 10, column: 0 }, end: { line: 10, column: 30 } },
          '5': { start: { line: 11, column: 2 }, end: { line: 11, column: 25 } },
        },
        fnMap: {
          '0': {
            name: 'formatDate',
            decl: { start: { line: 1, column: 16 }, end: { line: 1, column: 26 } },
            loc: { start: { line: 1, column: 35 }, end: { line: 3, column: 1 } },
          },
          '1': {
            name: 'parseJSON',
            decl: { start: { line: 5, column: 16 }, end: { line: 5, column: 25 } },
            loc: { start: { line: 5, column: 40 }, end: { line: 7, column: 1 } },
          },
          '2': {
            name: 'deprecated',
            decl: { start: { line: 10, column: 9 }, end: { line: 10, column: 19 } },
            loc: { start: { line: 10, column: 30 }, end: { line: 12, column: 1 } },
          },
        },
        branchMap: {
          '0': {
            type: 'if',
            locations: [
              { start: { line: 2, column: 2 }, end: { line: 2, column: 15 } },
              { start: { line: 2, column: 2 }, end: { line: 2, column: 15 } },
            ],
          },
        },
        s: { '0': 10, '1': 8, '2': 5, '3': 5, '4': 0, '5': 0 },
        f: { '0': 10, '1': 5, '2': 0 },
        b: { '0': [8, 2] },
      },
    };

    const coveragePath = createCoverageFile(realisticCoverage);
    const coverageData = await integrator.loadCoverageData(coveragePath);

    expect(coverageData.length).toBe(1);

    const fileData = coverageData[0];
    expect(fileData.filePath).toBe('/Users/dev/project/src/utils/helpers.ts');
    expect(fileData.functions.get('formatDate')?.covered).toBe(true);
    expect(fileData.functions.get('formatDate')?.hitCount).toBe(10);
    expect(fileData.functions.get('deprecated')?.covered).toBe(false);
    expect(fileData.functions.get('deprecated')?.hitCount).toBe(0);

    // Now cross-reference with static analysis
    const staticDeadCode = [
      '/Users/dev/project/src/utils/helpers.ts:10:deprecated',
      '/Users/dev/project/src/utils/helpers.ts:11',
    ];

    const evidence = integrator.crossReferenceWithStatic(staticDeadCode, coverageData);

    expect(evidence.length).toBe(2);
    expect(evidence.every((e) => e.staticAnalysis === true)).toBe(true);
    expect(evidence.every((e) => e.dynamicEvidence === true)).toBe(true);
    expect(evidence.every((e) => e.confidence >= 0.8)).toBe(true);

    const report = integrator.getDeadCodeReport();
    expect(report.total).toBe(2);
    expect(report.confirmedDead).toBe(2);
    expect(report.falsePositives).toBe(0);
  });
});
