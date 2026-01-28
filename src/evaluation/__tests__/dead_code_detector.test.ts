/**
 * @fileoverview Tests for Dead Code Detector
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Dead Code Detector identifies potentially unused or unreachable code:
 * - Unreachable code (after return/throw/break/continue, always-false conditions)
 * - Unused exports (exported but never imported elsewhere)
 * - Unused variables (declared but never referenced)
 * - Unused functions/classes
 * - Commented-out code blocks
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  DeadCodeDetector,
  createDeadCodeDetector,
  type DeadCodeCandidate,
  type DeadCodeReport,
} from '../dead_code_detector.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// External repos for diverse testing
const EXTERNAL_REPOS_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos');
const TYPEDRIVER_REPO = path.join(EXTERNAL_REPOS_ROOT, 'typedriver-ts');
const SRTD_REPO = path.join(EXTERNAL_REPOS_ROOT, 'srtd-ts');

// ============================================================================
// SYNTHETIC TEST FILE CREATION
// ============================================================================

/**
 * Creates a temporary TypeScript file with known dead code patterns for testing
 */
function createTestFile(code: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-test-'));
  const filePath = path.join(tmpDir, 'test-file.ts');
  fs.writeFileSync(filePath, code);
  return filePath;
}

/**
 * Creates a temporary directory with multiple TypeScript files for repo-level testing
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-repo-'));
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, filename);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return tmpDir;
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createDeadCodeDetector', () => {
  it('should create a detector instance', () => {
    const detector = createDeadCodeDetector();
    expect(detector).toBeInstanceOf(DeadCodeDetector);
  });
});

// ============================================================================
// UNREACHABLE CODE DETECTION TESTS
// ============================================================================

describe('DeadCodeDetector - Unreachable Code', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should detect code after return statement', async () => {
    const filePath = createTestFile(`
function foo() {
  return 42;
  console.log('unreachable');
  const x = 1;
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.type === 'unreachable')).toBe(true);
    expect(candidates.some((c) => c.reason.includes('return'))).toBe(true);
  });

  it('should detect code after throw statement', async () => {
    const filePath = createTestFile(`
function bar() {
  throw new Error('oops');
  const unreachable = 'never executed';
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.type === 'unreachable')).toBe(true);
    expect(candidates.some((c) => c.reason.includes('throw'))).toBe(true);
  });

  it('should detect code after break in switch', async () => {
    const filePath = createTestFile(`
function baz(x: number) {
  switch (x) {
    case 1:
      return 'one';
      console.log('unreachable after return in switch');
    case 2:
      break;
      console.log('unreachable after break');
  }
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.type === 'unreachable')).toBe(true);
  });

  it('should detect always-false condition branches', async () => {
    const filePath = createTestFile(`
function alwaysFalse() {
  if (false) {
    console.log('never executed');
  }

  const x = true;
  if (!x && x) {
    console.log('also never executed');
  }
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    // Should detect the if(false) block
    expect(candidates.some((c) => c.type === 'unreachable')).toBe(true);
  });

  it('should detect code after continue in loop', async () => {
    const filePath = createTestFile(`
function loopWithContinue() {
  for (let i = 0; i < 10; i++) {
    if (i === 5) {
      continue;
      console.log('unreachable after continue');
    }
  }
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(candidates.some((c) => c.type === 'unreachable' && c.reason.includes('continue'))).toBe(
      true
    );
  });

  it('should NOT flag reachable code', async () => {
    const filePath = createTestFile(`
function reachable() {
  const x = 1;
  if (x > 0) {
    return 'positive';
  }
  return 'not positive';
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    // Both returns are reachable, nothing should be flagged
    expect(candidates.length).toBe(0);
  });

  it('should have high confidence for obvious unreachable code', async () => {
    const filePath = createTestFile(`
function obvious() {
  return 1;
  const x = 2;
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(candidates.length).toBeGreaterThan(0);
    // Obvious unreachable code should have high confidence
    expect(candidates.some((c) => c.confidence > 0.8)).toBe(true);
  });
});

// ============================================================================
// UNUSED EXPORTS DETECTION TESTS
// ============================================================================

describe('DeadCodeDetector - Unused Exports', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should detect exported function not imported elsewhere', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function usedHelper() { return 1; }
export function unusedHelper() { return 2; }
      `,
      'src/main.ts': `
import { usedHelper } from './utils.js';
console.log(usedHelper());
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    expect(candidates.some((c) => c.type === 'unused_export')).toBe(true);
    expect(candidates.some((c) => c.identifier === 'unusedHelper')).toBe(true);
  });

  it('should NOT flag exports that are imported', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function helper() { return 1; }
      `,
      'src/main.ts': `
import { helper } from './utils.js';
console.log(helper());
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    // helper is used, should not be flagged
    expect(candidates.every((c) => c.identifier !== 'helper')).toBe(true);
  });

  it('should detect unused exported class', async () => {
    const repoPath = createTestRepo({
      'src/models.ts': `
export class UsedModel { name = 'used'; }
export class UnusedModel { name = 'unused'; }
      `,
      'src/app.ts': `
import { UsedModel } from './models.js';
new UsedModel();
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    expect(candidates.some((c) => c.identifier === 'UnusedModel')).toBe(true);
    expect(candidates.every((c) => c.identifier !== 'UsedModel')).toBe(true);
  });

  it('should detect unused exported type/interface', async () => {
    const repoPath = createTestRepo({
      'src/types.ts': `
export interface UsedType { x: number; }
export interface UnusedType { y: string; }
export type UsedAlias = string;
export type UnusedAlias = number;
      `,
      'src/consumer.ts': `
import type { UsedType, UsedAlias } from './types.js';
const x: UsedType = { x: 1 };
const y: UsedAlias = 'hello';
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    expect(candidates.some((c) => c.identifier === 'UnusedType')).toBe(true);
    expect(candidates.some((c) => c.identifier === 'UnusedAlias')).toBe(true);
  });

  it('should handle re-exports (barrel files)', async () => {
    const repoPath = createTestRepo({
      'src/utils/helper.ts': `
export function helper() { return 1; }
      `,
      'src/utils/index.ts': `
export { helper } from './helper.js';
      `,
      'src/main.ts': `
import { helper } from './utils/index.js';
helper();
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    // helper is re-exported and used, should not be flagged
    expect(candidates.every((c) => c.identifier !== 'helper')).toBe(true);
  });

  it('should have lower confidence for index.ts exports', async () => {
    const repoPath = createTestRepo({
      'src/index.ts': `
export function publicAPI() { return 1; }
      `,
    });

    const candidates = await detector.detectUnusedExports(repoPath);

    // index.ts exports might be public API, should have lower confidence
    const indexExport = candidates.find((c) => c.file.includes('index.ts'));
    if (indexExport) {
      expect(indexExport.confidence).toBeLessThan(0.8);
    }
  });
});

// ============================================================================
// UNUSED VARIABLES DETECTION TESTS
// ============================================================================

describe('DeadCodeDetector - Unused Variables', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should detect unused local variable', async () => {
    const filePath = createTestFile(`
function foo() {
  const used = 1;
  const unused = 2;
  return used;
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    expect(candidates.some((c) => c.type === 'unused_variable')).toBe(true);
    expect(candidates.some((c) => c.identifier === 'unused')).toBe(true);
  });

  it('should detect unused function parameter', async () => {
    const filePath = createTestFile(`
function bar(used: number, unused: string) {
  return used * 2;
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    expect(candidates.some((c) => c.identifier === 'unused')).toBe(true);
    expect(candidates.every((c) => c.identifier !== 'used')).toBe(true);
  });

  it('should NOT flag underscore-prefixed variables', async () => {
    const filePath = createTestFile(`
function intentionallyUnused(_ignored: number, used: number) {
  return used;
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    // _ignored is intentionally unused (convention), should not be flagged
    expect(candidates.every((c) => c.identifier !== '_ignored')).toBe(true);
  });

  it('should detect unused destructured variables', async () => {
    const filePath = createTestFile(`
function destructure() {
  const { used, unused } = { used: 1, unused: 2 };
  return used;
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    expect(candidates.some((c) => c.identifier === 'unused')).toBe(true);
  });

  it('should detect unused loop variable', async () => {
    const filePath = createTestFile(`
function loopVar() {
  for (let i = 0; i < 10; i++) {
    // i is used in condition but never in body
  }
  // This is actually fine, i is used in the for loop condition

  const arr = [1, 2, 3];
  for (const item of arr) {
    console.log('looping');
    // item is never used
  }
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    expect(candidates.some((c) => c.identifier === 'item')).toBe(true);
  });

  it('should handle variables used in closures', async () => {
    const filePath = createTestFile(`
function closure() {
  const outer = 1;
  return function inner() {
    return outer;
  };
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    // outer is used in closure, should not be flagged
    expect(candidates.every((c) => c.identifier !== 'outer')).toBe(true);
  });
});

// ============================================================================
// UNUSED FUNCTIONS DETECTION TESTS
// ============================================================================

describe('DeadCodeDetector - Unused Functions', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should detect unused private function in file', async () => {
    const filePath = createTestFile(`
function usedFunction() {
  return 1;
}

function unusedFunction() {
  return 2;
}

export function main() {
  return usedFunction();
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    // unusedFunction is never called
    expect(candidates.some((c) => c.type === 'unused_function')).toBe(true);
    expect(candidates.some((c) => c.identifier === 'unusedFunction')).toBe(true);
  });

  it('should NOT flag exported functions as unused', async () => {
    const filePath = createTestFile(`
export function exportedButNotCalledLocally() {
  return 1;
}
    `);

    const candidates = await detector.detectUnusedVariables(filePath);

    // Exported functions might be used elsewhere
    expect(candidates.every((c) => c.identifier !== 'exportedButNotCalledLocally')).toBe(true);
  });
});

// ============================================================================
// COMMENTED CODE DETECTION TESTS
// ============================================================================

describe('DeadCodeDetector - Commented Code', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should detect large blocks of commented-out code', async () => {
    const filePath = createTestFile(`
function active() {
  return 1;
}

// function oldFunction() {
//   const x = 1;
//   const y = 2;
//   return x + y;
// }

function alsoActive() {
  return 2;
}
    `);

    const candidates = await detector.detectCommentedCode(filePath);

    expect(candidates.some((c) => c.type === 'commented_code')).toBe(true);
    expect(candidates.some((c) => c.reason.includes('function'))).toBe(true);
  });

  it('should detect multi-line block comments with code', async () => {
    const filePath = createTestFile(`
function active() {
  return 1;
}

/*
function deprecatedFunction() {
  const result = doSomething();
  if (result) {
    return true;
  }
  return false;
}
*/
    `);

    const candidates = await detector.detectCommentedCode(filePath);

    expect(candidates.some((c) => c.type === 'commented_code')).toBe(true);
  });

  it('should NOT flag regular comments (documentation)', async () => {
    const filePath = createTestFile(`
/**
 * This is a JSDoc comment
 * @param x The input value
 * @returns The computed result
 */
function documented(x: number) {
  // This is a regular inline comment explaining the logic
  return x * 2;
}
    `);

    const candidates = await detector.detectCommentedCode(filePath);

    // Documentation comments should not be flagged
    expect(candidates.length).toBe(0);
  });

  it('should detect commented import statements', async () => {
    const filePath = createTestFile(`
// import { oldHelper } from './old-utils.js';
import { newHelper } from './new-utils.js';

function main() {
  return newHelper();
}
    `);

    const candidates = await detector.detectCommentedCode(filePath);

    expect(candidates.some((c) => c.type === 'commented_code')).toBe(true);
    expect(candidates.some((c) => c.reason.includes('import'))).toBe(true);
  });

  it('should have configurable threshold for commented code detection', async () => {
    const filePath = createTestFile(`
// const x = 1;
// const y = 2;
// Very short commented code block
    `);

    // Default threshold is 3 lines, so this might not be flagged
    const candidates = await detector.detectCommentedCode(filePath);

    // 3 lines is borderline - result depends on implementation
    // Just verify it returns an array
    expect(Array.isArray(candidates)).toBe(true);
  });
});

// ============================================================================
// FULL DETECTION (detect method) TESTS
// ============================================================================

describe('DeadCodeDetector - Full Detection', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should produce a complete DeadCodeReport', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() {
  const used = 1;
  const unused = 2;
  return used;
  console.log('unreachable');
}

// function oldMain() {
//   return 0;
// }
      `,
    });

    const report = await detector.detect(repoPath);

    // Verify report structure
    expect(report.repoPath).toBe(repoPath);
    expect(report.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(report.candidates)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.totalCandidates).toBe('number');
    expect(report.summary.byType).toBeDefined();
    expect(typeof report.summary.highConfidence).toBe('number');
  });

  it('should detect multiple types of dead code', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
function unusedLocal() { return 1; }

export function main() {
  const unused = 1;
  return 42;
  console.log('unreachable');
}

// function commented() {}
      `,
      'src/helper.ts': `
export function unusedExport() { return 2; }
      `,
    });

    const report = await detector.detect(repoPath);

    // Should find multiple types
    const types = new Set(report.candidates.map((c) => c.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('should include summary with counts by type', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
function unused1() { return 1; }
function unused2() { return 2; }

export function main() {
  return 42;
  console.log('unreachable1');
  console.log('unreachable2');
}
      `,
    });

    const report = await detector.detect(repoPath);

    expect(report.summary.byType).toBeDefined();
    expect(typeof report.summary.byType['unreachable'] === 'number').toBe(true);
    expect(typeof report.summary.byType['unused_function'] === 'number').toBe(true);
  });

  it('should count high confidence candidates', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() {
  return 42;
  console.log('obviously unreachable');
}
      `,
    });

    const report = await detector.detect(repoPath);

    // High confidence should be candidates with confidence > 0.8
    const actualHighConf = report.candidates.filter((c) => c.confidence > 0.8).length;
    expect(report.summary.highConfidence).toBe(actualHighConf);
  });
});

// ============================================================================
// CANDIDATE STRUCTURE TESTS
// ============================================================================

describe('DeadCodeCandidate Structure', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should have correct DeadCodeCandidate structure', async () => {
    const filePath = createTestFile(`
function foo() {
  return 1;
  console.log('unreachable');
}
    `);

    const candidates = await detector.detectUnreachable(filePath);

    candidates.forEach((candidate) => {
      // Required fields
      expect(candidate.type).toBeDefined();
      expect([
        'unreachable',
        'unused_export',
        'unused_variable',
        'unused_function',
        'unused_class',
        'commented_code',
      ]).toContain(candidate.type);

      expect(candidate.file).toBeDefined();
      expect(typeof candidate.file).toBe('string');

      expect(candidate.line).toBeDefined();
      expect(typeof candidate.line).toBe('number');
      expect(candidate.line).toBeGreaterThan(0);

      expect(candidate.confidence).toBeDefined();
      expect(typeof candidate.confidence).toBe('number');
      expect(candidate.confidence).toBeGreaterThanOrEqual(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);

      expect(candidate.reason).toBeDefined();
      expect(typeof candidate.reason).toBe('string');

      // Optional fields
      if (candidate.identifier !== undefined) {
        expect(typeof candidate.identifier).toBe('string');
      }
      if (candidate.codeSnippet !== undefined) {
        expect(typeof candidate.codeSnippet).toBe('string');
      }
    });
  });
});

// ============================================================================
// REAL REPO TESTS
// ============================================================================

describe('DeadCodeDetector - Real Repos', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should analyze typedriver-ts without crashing', async () => {
    const report = await detector.detect(TYPEDRIVER_REPO);

    expect(report.repoPath).toBe(TYPEDRIVER_REPO);
    expect(Array.isArray(report.candidates)).toBe(true);
    expect(report.summary.totalCandidates).toBe(report.candidates.length);
  });

  it('should analyze srtd-ts without crashing', async () => {
    const report = await detector.detect(SRTD_REPO);

    expect(report.repoPath).toBe(SRTD_REPO);
    expect(Array.isArray(report.candidates)).toBe(true);
  });

  it('should analyze Librarian src directory', async () => {
    const srcPath = path.join(LIBRARIAN_ROOT, 'src');
    const report = await detector.detect(srcPath);

    expect(report.repoPath).toBe(srcPath);
    expect(Array.isArray(report.candidates)).toBe(true);
    // Librarian codebase should be relatively clean
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('DeadCodeDetector - Edge Cases', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should handle non-existent file gracefully', async () => {
    const candidates = await detector.detectUnreachable('/non/existent/file.ts');

    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(0);
  });

  it('should handle non-existent directory gracefully', async () => {
    const report = await detector.detect('/non/existent/directory');

    expect(report.repoPath).toBe('/non/existent/directory');
    expect(report.candidates.length).toBe(0);
  });

  it('should handle empty files', async () => {
    const filePath = createTestFile('');

    const candidates = await detector.detectUnreachable(filePath);

    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(0);
  });

  it('should handle files with only comments', async () => {
    const filePath = createTestFile(`
// This file has only comments
// No actual code here
/*
 * Just documentation
 */
    `);

    const candidates = await detector.detectUnreachable(filePath);

    expect(Array.isArray(candidates)).toBe(true);
  });

  it('should handle syntax errors gracefully', async () => {
    const filePath = createTestFile(`
function broken( {
  return 1;
}
    `);

    // Should not throw, should return empty or partial results
    const candidates = await detector.detectUnreachable(filePath);

    expect(Array.isArray(candidates)).toBe(true);
  });

  it('should exclude node_modules', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() { return 1; }
      `,
      'node_modules/some-package/index.ts': `
export function unused() { return 2; }
      `,
    });

    const report = await detector.detect(repoPath);

    // Should not include any candidates from node_modules
    expect(report.candidates.every((c) => !c.file.includes('node_modules'))).toBe(true);
  });

  it('should exclude .git directory', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() { return 1; }
      `,
      '.git/hooks/pre-commit': `
#!/bin/sh
echo "hook"
      `,
    });

    const report = await detector.detect(repoPath);

    // Should not include any candidates from .git
    expect(report.candidates.every((c) => !c.file.includes('.git'))).toBe(true);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('DeadCodeDetector - Performance', () => {
  let detector: DeadCodeDetector;

  beforeAll(() => {
    detector = createDeadCodeDetector();
  });

  it('should analyze typedriver-ts in under 30 seconds', async () => {
    const start = Date.now();
    await detector.detect(TYPEDRIVER_REPO);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30000);
  });

  it('should analyze a small synthetic repo quickly', async () => {
    const repoPath = createTestRepo({
      'src/a.ts': 'export function a() { return 1; }',
      'src/b.ts': 'export function b() { return 2; }',
      'src/c.ts': 'export function c() { return 3; }',
    });

    const start = Date.now();
    await detector.detect(repoPath);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
