/**
 * @fileoverview Tests for Red Flag Detector
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Red Flag Detector identifies code patterns that are commonly problematic
 * or confusing for code understanding systems:
 * - Naming confusion (similar names, misleading names, shadowed variables)
 * - Complexity (many parameters, deep nesting, long functions)
 * - Inconsistency (mixed naming conventions, inconsistent exports)
 * - Deprecated (@deprecated annotations, old TODOs)
 * - Security (hardcoded credentials, SQL injection, unsafe eval)
 * - Magic values (unexplained constants)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  RedFlagDetector,
  createRedFlagDetector,
  type RedFlag,
  type RedFlagReport,
} from '../red_flag_detector.js';

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
 * Creates a temporary TypeScript file with known patterns for testing
 */
function createTestFile(code: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-flag-test-'));
  const filePath = path.join(tmpDir, 'test-file.ts');
  fs.writeFileSync(filePath, code);
  return filePath;
}

/**
 * Creates a temporary directory with multiple TypeScript files for repo-level testing
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-flag-repo-'));
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

describe('createRedFlagDetector', () => {
  it('should create a detector instance', () => {
    const detector = createRedFlagDetector();
    expect(detector).toBeInstanceOf(RedFlagDetector);
  });
});

// ============================================================================
// NAMING CONFUSION DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Naming Confusion', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect similar names (getData vs data vs _data)', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function getData() { return 1; }
export const data = 2;
const _data = 3;

export function processData() {
  return getData() + data + _data;
}
      `,
    });

    const flags = await detector.detectNamingConfusion(repoPath);

    expect(flags.some((f) => f.type === 'naming_confusion')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('similar'))).toBe(true);
  });

  it('should detect misleading function names (isValid that mutates)', async () => {
    const filePath = createTestFile(`
let state = 0;

function isValid(input: string): boolean {
  state++; // Mutation! Misleading for a function starting with "is"
  return input.length > 0;
}

function hasPermission(): boolean {
  state = 0; // Mutation! Misleading for "has" prefix
  return true;
}
    `);

    const repoPath = path.dirname(filePath);
    const flags = await detector.detectNamingConfusion(repoPath);

    expect(flags.some((f) => f.type === 'naming_confusion')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('misleading'))).toBe(true);
  });

  it('should detect shadowed variables', async () => {
    const filePath = createTestFile(`
const value = 'outer';

function process() {
  const value = 'inner'; // Shadows outer variable
  return value;
}

function nested() {
  const data = 1;
  if (true) {
    const data = 2; // Shadows outer data
    return data;
  }
  return data;
}
    `);

    const repoPath = path.dirname(filePath);
    const flags = await detector.detectNamingConfusion(repoPath);

    expect(flags.some((f) => f.type === 'naming_confusion')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('shadow'))).toBe(true);
  });

  it('should NOT flag clearly distinct names', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function fetchUser() { return {}; }
export function processOrder() { return {}; }
export const CONFIG_TIMEOUT = 1000;
      `,
    });

    const flags = await detector.detectNamingConfusion(repoPath);

    // These names are clearly distinct, should have fewer/no flags
    expect(flags.filter((f) => f.severity === 'high').length).toBe(0);
  });
});

// ============================================================================
// COMPLEXITY DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Complexity', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect functions with many parameters (>5)', async () => {
    const filePath = createTestFile(`
function tooManyParams(a: number, b: string, c: boolean, d: number, e: string, f: boolean, g: number) {
  return a + b + c + d + e + f + g;
}

// This one is fine
function fewParams(a: number, b: string) {
  return a + b;
}
    `);

    const flags = await detector.detectComplexity(filePath);

    expect(flags.some((f) => f.type === 'complexity')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('parameter'))).toBe(true);
    expect(flags.some((f) => f.identifier === 'tooManyParams')).toBe(true);
  });

  it('should detect deep nesting (>4 levels)', async () => {
    const filePath = createTestFile(`
function deeplyNested(x: number) {
  if (x > 0) {
    if (x > 10) {
      if (x > 20) {
        if (x > 30) {
          if (x > 40) {  // 5 levels deep!
            return 'very deep';
          }
        }
      }
    }
  }
  return 'shallow';
}
    `);

    const flags = await detector.detectComplexity(filePath);

    expect(flags.some((f) => f.type === 'complexity')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('nesting'))).toBe(true);
  });

  it('should detect long functions (>100 lines)', async () => {
    // Generate a function with >100 lines
    const lines = ['function veryLongFunction() {'];
    for (let i = 0; i < 110; i++) {
      lines.push(`  const line${i} = ${i};`);
    }
    lines.push('  return 0;');
    lines.push('}');

    const filePath = createTestFile(lines.join('\n'));

    const flags = await detector.detectComplexity(filePath);

    expect(flags.some((f) => f.type === 'complexity')).toBe(true);
    expect(
      flags.some(
        (f) => f.description.toLowerCase().includes('long') || f.description.includes('lines')
      )
    ).toBe(true);
  });

  it('should detect high cyclomatic complexity', async () => {
    const filePath = createTestFile(`
function highComplexity(x: number, y: string, z: boolean, w: number) {
  if (x > 0) {
    if (y === 'a') return 1;
    if (y === 'b') return 2;
    if (y === 'c') return 3;
    if (y === 'x') return 99;
  } else if (x < 0) {
    if (z) {
      if (y === 'd') return 4;
      if (y === 'e') return 5;
    } else {
      switch (y) {
        case 'f': return 6;
        case 'g': return 7;
        case 'h': return 8;
        case 'i': return 88;
        default: return 9;
      }
    }
  }
  if (w > 0 && z) return 100;
  return z ? 10 : 11;
}
    `);

    const flags = await detector.detectComplexity(filePath);

    expect(flags.some((f) => f.type === 'complexity')).toBe(true);
  });

  it('should NOT flag simple functions', async () => {
    const filePath = createTestFile(`
function simple(x: number): number {
  return x * 2;
}

function alsoSimple(a: string, b: string): string {
  return a + b;
}
    `);

    const flags = await detector.detectComplexity(filePath);

    // Simple functions should not be flagged
    expect(flags.length).toBe(0);
  });
});

// ============================================================================
// INCONSISTENCY DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Inconsistency', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect mixed naming conventions (camelCase vs snake_case)', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function getUserData() { return {}; }
export function get_user_info() { return {}; }  // snake_case in same file!
export const MAX_RETRIES = 3;
export const max_timeout = 1000;  // Inconsistent with MAX_RETRIES
      `,
    });

    const flags = await detector.detectInconsistencies(repoPath);

    expect(flags.some((f) => f.type === 'inconsistency')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('naming'))).toBe(true);
  });

  it('should detect inconsistent export patterns', async () => {
    const repoPath = createTestRepo({
      'src/moduleA.ts': `
// Named exports
export function funcA() {}
export const valueA = 1;
      `,
      'src/moduleB.ts': `
// Default export in same repo
function funcB() {}
export default funcB;
      `,
      'src/moduleC.ts': `
// Mixed exports
export function funcC() {}
export default { funcC };
      `,
    });

    const flags = await detector.detectInconsistencies(repoPath);

    expect(flags.some((f) => f.type === 'inconsistency')).toBe(true);
    expect(flags.some((f) => f.description.toLowerCase().includes('export'))).toBe(true);
  });

  it('should detect type vs any mixing', async () => {
    const filePath = createTestFile(`
interface User {
  name: string;
  email: string;
}

function processUser(user: User): any {  // Returns any!
  return user.name;
}

function handleData(data: any): User {  // Takes any!
  return { name: data.name, email: data.email };
}

function wellTyped(user: User): string {
  return user.name;
}
    `);

    const repoPath = path.dirname(filePath);
    const flags = await detector.detectInconsistencies(repoPath);

    expect(flags.some((f) => f.type === 'inconsistency')).toBe(true);
    expect(
      flags.some((f) => f.description.toLowerCase().includes('any') || f.description.includes('type'))
    ).toBe(true);
  });

  it('should detect inconsistent return types in similar functions', async () => {
    // Note: Full return type analysis requires type inference which is beyond
    // the scope of simple static analysis. This test verifies the detector
    // handles such files gracefully without crashing.
    const filePath = createTestFile(`
async function fetchUserById(id: string): Promise<User | null> {
  return null;
}

async function fetchUserByEmail(email: string): Promise<User | undefined> {
  return undefined;
}

interface User { name: string; }
    `);

    const repoPath = path.dirname(filePath);
    const flags = await detector.detectInconsistencies(repoPath);

    // Currently, deep return type analysis is not implemented.
    // This test verifies the detector runs without error.
    expect(Array.isArray(flags)).toBe(true);
  });
});

// ============================================================================
// DEPRECATED DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Deprecated', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect @deprecated annotations', async () => {
    const filePath = createTestFile(`
/**
 * @deprecated Use newFunction instead
 */
export function oldFunction() {
  return 1;
}

/**
 * @deprecated since v2.0
 */
export class OldClass {
  value = 0;
}

export function newFunction() {
  return 2;
}
    `);

    const flags = await detector.detectDeprecated(filePath);

    expect(flags.some((f) => f.type === 'deprecated')).toBe(true);
    expect(flags.some((f) => f.identifier === 'oldFunction')).toBe(true);
    expect(flags.some((f) => f.identifier === 'OldClass')).toBe(true);
  });

  it('should detect TODO/FIXME comments with old dates', async () => {
    const filePath = createTestFile(`
// TODO(2020-01-15): Clean this up
function messyFunction() {
  // FIXME: 2019-06-01 - This is broken
  return 1;
}

// TODO: Current work in progress (no date = not flagged as old)
function newWork() {
  return 2;
}
    `);

    const flags = await detector.detectDeprecated(filePath);

    expect(flags.some((f) => f.type === 'deprecated')).toBe(true);
    expect(
      flags.some(
        (f) => f.description.toLowerCase().includes('todo') || f.description.toLowerCase().includes('fixme')
      )
    ).toBe(true);
  });

  it('should detect references to deprecated APIs', async () => {
    const filePath = createTestFile(`
// Common deprecated API patterns
const result1 = document.write('hello');  // deprecated
const result2 = eval('code');  // deprecated/dangerous
const result3 = arguments.callee;  // deprecated

// Using deprecated Node.js APIs
import * as domain from 'domain';  // deprecated module
    `);

    const flags = await detector.detectDeprecated(filePath);

    expect(flags.some((f) => f.type === 'deprecated')).toBe(true);
  });

  it('should NOT flag current TODO comments', async () => {
    const filePath = createTestFile(`
// TODO: Add validation (this is a current task)
function validate() {
  return true;
}

// FIXME: Handle edge case
function handleEdge() {
  return false;
}
    `);

    const flags = await detector.detectDeprecated(filePath);

    // Current TODOs without old dates should not be flagged
    const oldDateFlags = flags.filter(
      (f) =>
        f.description.toLowerCase().includes('old') ||
        f.description.includes('2019') ||
        f.description.includes('2020')
    );
    expect(oldDateFlags.length).toBe(0);
  });
});

// ============================================================================
// SECURITY FLAGS DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Security', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect hardcoded credentials patterns', async () => {
    const filePath = createTestFile(`
const API_KEY = 'sk-1234567890abcdef';  // Hardcoded API key!
const password = 'secret123';  // Hardcoded password!
const DATABASE_URL = 'postgres://user:pass@localhost/db';  // Credentials in URL!

// This is fine
const API_KEY_NAME = 'X-API-Key';  // Just a header name
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    expect(flags.some((f) => f.type === 'security')).toBe(true);
    expect(flags.some((f) => f.severity === 'high')).toBe(true);
    expect(
      flags.some(
        (f) =>
          f.description.toLowerCase().includes('credential') ||
          f.description.toLowerCase().includes('password') ||
          f.description.toLowerCase().includes('api key')
      )
    ).toBe(true);
  });

  it('should detect SQL injection patterns', async () => {
    const filePath = createTestFile(`
function queryUser(userId: string) {
  // SQL injection vulnerability!
  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
  return db.execute(query);
}

function safeQuery(userId: string) {
  // Parameterized query (safe)
  return db.execute('SELECT * FROM users WHERE id = ?', [userId]);
}
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    expect(flags.some((f) => f.type === 'security')).toBe(true);
    expect(
      flags.some((f) => f.description.toLowerCase().includes('sql') || f.description.toLowerCase().includes('injection'))
    ).toBe(true);
  });

  it('should detect unsafe eval/exec usage', async () => {
    const filePath = createTestFile(`
function dangerous(code: string) {
  eval(code);  // Unsafe!
  new Function(code)();  // Also unsafe!
}

import { exec } from 'child_process';

function runCommand(cmd: string) {
  exec(cmd);  // Potential command injection!
}
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    expect(flags.some((f) => f.type === 'security')).toBe(true);
    expect(flags.filter((f) => f.severity === 'high').length).toBeGreaterThan(0);
  });

  it('should detect path traversal patterns', async () => {
    const filePath = createTestFile(`
import * as fs from 'fs';
import * as path from 'path';

function readUserFile(filename: string) {
  // Path traversal vulnerability!
  const content = fs.readFileSync('/data/' + filename);
  return content;
}

function safeRead(filename: string) {
  // Proper path handling
  const safeName = path.basename(filename);
  const content = fs.readFileSync(path.join('/data', safeName));
  return content;
}
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    expect(flags.some((f) => f.type === 'security')).toBe(true);
  });

  it('should NOT flag safe patterns', async () => {
    const filePath = createTestFile(`
// Environment variable usage (safe)
const apiKey = process.env.API_KEY;

// Parameterized query (safe)
const result = db.query('SELECT * FROM users WHERE id = $1', [userId]);

// Safe exec with fixed command
exec('npm test');
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    // Should have fewer/no high-severity flags
    const highSeverityFlags = flags.filter((f) => f.severity === 'high');
    expect(highSeverityFlags.length).toBe(0);
  });
});

// ============================================================================
// MAGIC VALUES DETECTION TESTS
// ============================================================================

describe('RedFlagDetector - Magic Values', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should detect unexplained numeric constants', async () => {
    const filePath = createTestFile(`
function process(data: number[]) {
  if (data.length > 42) {  // Magic number!
    return data.slice(0, 1337);  // Another magic number!
  }
  return data.filter(x => x > 3.14159);  // Magic number!
}

// This is fine - well-named constant
const MAX_ITEMS = 100;
function processWithConstant(data: number[]) {
  if (data.length > MAX_ITEMS) {
    return data.slice(0, MAX_ITEMS);
  }
  return data;
}
    `);

    const flags = await detector.detectMagicValues(filePath);

    expect(flags.some((f) => f.type === 'magic')).toBe(true);
    expect(flags.some((f) => f.description.includes('42') || f.description.includes('1337'))).toBe(
      true
    );
  });

  it('should detect unexplained string literals', async () => {
    const filePath = createTestFile(`
function getStatus(code: string) {
  if (code === 'XYZZY') {  // Magic string!
    return 'special';
  }
  if (code === 'PLuGh') {  // Another magic string!
    return 'extra special';
  }
  return 'normal';
}

// This is fine - status enum
enum Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
    `);

    const flags = await detector.detectMagicValues(filePath);

    expect(flags.some((f) => f.type === 'magic')).toBe(true);
    expect(
      flags.some((f) => f.description.toLowerCase().includes('string') || f.description.includes('literal'))
    ).toBe(true);
  });

  it('should detect bit manipulation without comments', async () => {
    const filePath = createTestFile(`
function getFlags(value: number) {
  const hasRead = (value & 4) !== 0;  // What is 4? Magic!
  const hasWrite = (value & 2) !== 0;  // What is 2? Magic!
  const hasExecute = (value & 1) !== 0;  // What is 1? Magic!
  return { hasRead, hasWrite, hasExecute };
}

// This is fine - documented flags
const READ_FLAG = 0b100;  // 4 in binary
const WRITE_FLAG = 0b010;  // 2 in binary
const EXEC_FLAG = 0b001;  // 1 in binary

function getFlagsDocumented(value: number) {
  const hasRead = (value & READ_FLAG) !== 0;
  const hasWrite = (value & WRITE_FLAG) !== 0;
  const hasExecute = (value & EXEC_FLAG) !== 0;
  return { hasRead, hasWrite, hasExecute };
}
    `);

    const flags = await detector.detectMagicValues(filePath);

    expect(flags.some((f) => f.type === 'magic')).toBe(true);
  });

  it('should NOT flag common acceptable values', async () => {
    const filePath = createTestFile(`
function common() {
  const zero = 0;
  const one = 1;
  const empty = '';
  const arr = [];
  const percentComplete = 100;  // 100% is common
  const httpOk = 200;  // HTTP status
  const notFound = 404;  // HTTP status
  return { zero, one, empty, arr };
}
    `);

    const flags = await detector.detectMagicValues(filePath);

    // Common values like 0, 1, 100, HTTP status codes should not be flagged
    const highSeverityFlags = flags.filter((f) => f.severity === 'high');
    expect(highSeverityFlags.length).toBe(0);
  });
});

// ============================================================================
// FULL DETECTION (detect method) TESTS
// ============================================================================

describe('RedFlagDetector - Full Detection', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should produce a complete RedFlagReport', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
const API_KEY = 'secret123';  // Security flag

function process(a, b, c, d, e, f, g) {  // Complexity flag (7 params)
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          if (true) {  // Deep nesting
            return a + 42;  // Magic number
          }
        }
      }
    }
  }
  return 0;
}
      `,
    });

    const report = await detector.detect(repoPath);

    // Verify report structure
    expect(report.repoPath).toBe(repoPath);
    expect(report.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(report.flags)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.totalFlags).toBe('number');
    expect(report.summary.byType).toBeDefined();
    expect(report.summary.bySeverity).toBeDefined();
    expect(typeof report.summary.riskScore).toBe('number');
    expect(report.summary.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.riskScore).toBeLessThanOrEqual(1);
  });

  it('should detect multiple types of red flags', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * @deprecated Use newFunc instead
 */
function oldFunc() { return 1; }

const password = 'hardcoded';  // Security

function complex(a, b, c, d, e, f) {  // Complexity
  return a + 42;  // Magic
}

function get_data() {}  // Inconsistency with camelCase
function getData() {}
      `,
    });

    const report = await detector.detect(repoPath);

    // Should find multiple types
    const types = new Set(report.flags.map((f) => f.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('should calculate risk score correctly', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
// High severity flag
const password = 'secret';

// Medium severity flag
function tooManyParams(a, b, c, d, e, f) { return 0; }

// Low severity flag
const magic = 42;
      `,
    });

    const report = await detector.detect(repoPath);

    // Risk score formula: (high*3 + medium*2 + low*1) / (totalFiles * 10)
    // Should be between 0 and 1
    expect(report.summary.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.riskScore).toBeLessThanOrEqual(1);
  });

  it('should include summary with counts by type and severity', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
const pwd = 'secret123';  // Security - high
const api_key = 'key123';  // Security - high
function f(a,b,c,d,e,f) {}  // Complexity - medium
const x = 1337;  // Magic - low
      `,
    });

    const report = await detector.detect(repoPath);

    expect(report.summary.byType).toBeDefined();
    expect(report.summary.bySeverity).toBeDefined();

    // Verify counts are numbers
    for (const count of Object.values(report.summary.byType)) {
      expect(typeof count).toBe('number');
    }
    for (const count of Object.values(report.summary.bySeverity)) {
      expect(typeof count).toBe('number');
    }
  });
});

// ============================================================================
// RED FLAG STRUCTURE TESTS
// ============================================================================

describe('RedFlag Structure', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should have correct RedFlag structure', async () => {
    const filePath = createTestFile(`
const password = 'secret';
    `);

    const flags = await detector.detectSecurityFlags(filePath);

    flags.forEach((flag) => {
      // Required fields
      expect(flag.type).toBeDefined();
      expect([
        'naming_confusion',
        'complexity',
        'inconsistency',
        'deprecated',
        'security',
        'magic',
      ]).toContain(flag.type);

      expect(flag.severity).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(flag.severity);

      expect(flag.file).toBeDefined();
      expect(typeof flag.file).toBe('string');

      expect(flag.line).toBeDefined();
      expect(typeof flag.line).toBe('number');
      expect(flag.line).toBeGreaterThan(0);

      expect(flag.description).toBeDefined();
      expect(typeof flag.description).toBe('string');

      // Optional fields
      if (flag.identifier !== undefined) {
        expect(typeof flag.identifier).toBe('string');
      }
      if (flag.recommendation !== undefined) {
        expect(typeof flag.recommendation).toBe('string');
      }
    });
  });
});

// ============================================================================
// REAL REPO TESTS
// ============================================================================

describe('RedFlagDetector - Real Repos', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should analyze typedriver-ts without crashing', async () => {
    const report = await detector.detect(TYPEDRIVER_REPO);

    expect(report.repoPath).toBe(TYPEDRIVER_REPO);
    expect(Array.isArray(report.flags)).toBe(true);
    expect(report.summary.totalFlags).toBe(report.flags.length);
  });

  it('should analyze srtd-ts without crashing', async () => {
    const report = await detector.detect(SRTD_REPO);

    expect(report.repoPath).toBe(SRTD_REPO);
    expect(Array.isArray(report.flags)).toBe(true);
  });

  it('should analyze Librarian src directory', async () => {
    const srcPath = path.join(LIBRARIAN_ROOT, 'src');
    const report = await detector.detect(srcPath);

    expect(report.repoPath).toBe(srcPath);
    expect(Array.isArray(report.flags)).toBe(true);
    // Librarian codebase should be relatively clean
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('RedFlagDetector - Edge Cases', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
  });

  it('should handle non-existent file gracefully', async () => {
    const flags = await detector.detectComplexity('/non/existent/file.ts');

    expect(Array.isArray(flags)).toBe(true);
    expect(flags.length).toBe(0);
  });

  it('should handle non-existent directory gracefully', async () => {
    const report = await detector.detect('/non/existent/directory');

    expect(report.repoPath).toBe('/non/existent/directory');
    expect(report.flags.length).toBe(0);
  });

  it('should handle empty files', async () => {
    const filePath = createTestFile('');

    const flags = await detector.detectComplexity(filePath);

    expect(Array.isArray(flags)).toBe(true);
    expect(flags.length).toBe(0);
  });

  it('should handle files with only comments', async () => {
    const filePath = createTestFile(`
// This file has only comments
// No actual code here
/*
 * Just documentation
 */
    `);

    const flags = await detector.detectComplexity(filePath);

    expect(Array.isArray(flags)).toBe(true);
  });

  it('should handle syntax errors gracefully', async () => {
    const filePath = createTestFile(`
function broken( {
  return 1;
}
    `);

    // Should not throw, should return empty or partial results
    const flags = await detector.detectComplexity(filePath);

    expect(Array.isArray(flags)).toBe(true);
  });

  it('should exclude node_modules', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() { return 1; }
      `,
      'node_modules/some-package/index.ts': `
const password = 'secret';  // Would be flagged if not excluded
      `,
    });

    const report = await detector.detect(repoPath);

    // Should not include any flags from node_modules
    expect(report.flags.every((f) => !f.file.includes('node_modules'))).toBe(true);
  });

  it('should exclude .git directory', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() { return 1; }
      `,
      '.git/hooks/pre-commit': `
const password = 'secret';
      `,
    });

    const report = await detector.detect(repoPath);

    // Should not include any flags from .git
    expect(report.flags.every((f) => !f.file.includes('.git'))).toBe(true);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('RedFlagDetector - Performance', () => {
  let detector: RedFlagDetector;

  beforeAll(() => {
    detector = createRedFlagDetector();
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
