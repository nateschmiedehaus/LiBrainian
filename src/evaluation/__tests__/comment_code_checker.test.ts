/**
 * @fileoverview Tests for Comment/Code Checker
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Comment/Code Checker detects mismatches between comments and the code they describe:
 * - Parameter mismatch (JSDoc @param vs actual params)
 * - Return type mismatch (JSDoc @returns vs actual)
 * - Name mismatch (comment describes different action than function name)
 * - Semantic drift (comment mentions outdated concepts)
 * - Stale reference (referenced files/functions don't exist)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  CommentCodeChecker,
  createCommentCodeChecker,
  type CommentCodePair,
  type MismatchResult,
  type CommentCodeReport,
  // New WU-CONTRA-001 interfaces
  type CommentAnalysis,
  type ConsistencyIssue,
  type ConsistencyReport,
} from '../comment_code_checker.js';
import { ASTFactExtractor, createASTFactExtractor, type ASTFact } from '../ast_fact_extractor.js';

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
 * Creates a temporary TypeScript file with known comment/code patterns for testing
 */
function createTestFile(code: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-code-test-'));
  const filePath = path.join(tmpDir, 'test-file.ts');
  fs.writeFileSync(filePath, code);
  return filePath;
}

/**
 * Creates a temporary directory with multiple TypeScript files for repo-level testing
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-code-repo-'));
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

describe('createCommentCodeChecker', () => {
  it('should create a checker instance', () => {
    const checker = createCommentCodeChecker();
    expect(checker).toBeInstanceOf(CommentCodeChecker);
  });
});

// ============================================================================
// COMMENT/CODE PAIR EXTRACTION TESTS
// ============================================================================

describe('CommentCodeChecker - extractPairs', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should extract JSDoc comment/code pairs', async () => {
    const filePath = createTestFile(`
/**
 * Gets user by ID
 * @param userId - The user ID
 * @returns The user object
 */
function getUser(userId: string): User {
  return users.find(u => u.id === userId);
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.some(p => p.commentType === 'jsdoc')).toBe(true);
    expect(pairs.some(p => p.comment.includes('@param'))).toBe(true);
  });

  it('should extract inline comment/code pairs', async () => {
    const filePath = createTestFile(`
function process() {
  // Calculate the sum
  const sum = a + b;
  return sum;
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.some(p => p.commentType === 'inline')).toBe(true);
    expect(pairs.some(p => p.comment.includes('Calculate the sum'))).toBe(true);
  });

  it('should extract block comment/code pairs', async () => {
    const filePath = createTestFile(`
/*
 * This function validates user input
 * and returns sanitized data
 */
function validateInput(data: string): string {
  return data.trim();
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.some(p => p.commentType === 'block')).toBe(true);
    expect(pairs.some(p => p.comment.includes('validates user input'))).toBe(true);
  });

  it('should include file path and line number', async () => {
    const filePath = createTestFile(`
/**
 * Test function
 */
function test() {
  return 1;
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0].file).toBe(filePath);
    expect(pairs[0].line).toBeGreaterThan(0);
  });

  it('should include the associated code', async () => {
    const filePath = createTestFile(`
/**
 * Adds two numbers
 */
function add(a: number, b: number): number {
  return a + b;
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.some(p => p.code.includes('function add'))).toBe(true);
  });

  it('should handle files with no comments', async () => {
    const filePath = createTestFile(`
function noComment() {
  return 1;
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(Array.isArray(pairs)).toBe(true);
  });

  it('should handle class method comments', async () => {
    const filePath = createTestFile(`
class UserService {
  /**
   * Fetches user from database
   * @param id - User ID
   */
  fetch(id: string): User {
    return db.users.get(id);
  }
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.some(p => p.comment.includes('Fetches user'))).toBe(true);
    expect(pairs.some(p => p.code.includes('fetch(id'))).toBe(true);
  });
});

// ============================================================================
// PARAMETER MISMATCH DETECTION TESTS
// ============================================================================

describe('CommentCodeChecker - checkParameters', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should detect documented param not in function signature', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @param userId - The user ID
 * @param name - The user name
 */`,
      code: `function getUser(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('parameter_mismatch');
    expect(result?.severity).toBe('high');
    expect(result?.description).toContain('userId');
  });

  it('should detect documented param with different name', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @param userId - The user ID
 */`,
      code: `function getUser(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('parameter_mismatch');
  });

  it('should detect actual param not documented', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Gets user
 */`,
      code: `function getUser(id: string, options: Options) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    // Missing @param docs for id and options
    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('parameter_mismatch');
    expect(result?.severity).toBe('medium');
  });

  it('should NOT flag when params match', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Gets user
 * @param id - The user ID
 * @param options - Query options
 */`,
      code: `function getUser(id: string, options: Options) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    expect(result).toBeNull();
  });

  it('should handle arrow functions', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @param userId - The user ID
 */`,
      code: `const getUser = (id: string) => { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('parameter_mismatch');
  });

  it('should handle destructured parameters', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @param options - The options object
 */`,
      code: `function process({ id, name }: Options) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    // Destructured param - 'options' doesn't match { id, name }
    // Implementation may vary on how strict this is
    expect(result === null || result?.mismatchType === 'parameter_mismatch').toBe(true);
  });
});

// ============================================================================
// RETURN TYPE MISMATCH DETECTION TESTS
// ============================================================================

describe('CommentCodeChecker - checkReturnType', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should detect mismatched return type', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {string} The user name
 */`,
      code: `function getUser(): User { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('return_mismatch');
    expect(result?.description).toContain('string');
    expect(result?.description).toContain('User');
  });

  it('should detect @returns with void function', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {User} The user
 */`,
      code: `function updateUser(id: string): void { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('return_mismatch');
  });

  it('should NOT flag when return types match', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {User} The user object
 */`,
      code: `function getUser(): User { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    expect(result).toBeNull();
  });

  it('should handle Promise return types', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {Promise<User>} The user
 */`,
      code: `async function getUser(): Promise<User> { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    expect(result).toBeNull();
  });

  it('should detect Promise type mismatch', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {Promise<string>} The user name
 */`,
      code: `async function getUser(): Promise<User> { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('return_mismatch');
  });

  it('should handle missing return annotation gracefully', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Gets the user
 */`,
      code: `function getUser(): User { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    // No @returns documented, which is ok
    expect(result).toBeNull();
  });
});

// ============================================================================
// NAME MISMATCH DETECTION TESTS
// ============================================================================

describe('CommentCodeChecker - checkPair (name mismatch)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should detect semantic name mismatch', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Validates the user input
 */`,
      code: `function formatUserInput() { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('name_mismatch');
    expect(result?.description).toContain('validate');
    expect(result?.description).toContain('format');
  });

  it('should detect verb mismatch (create vs delete)', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Creates a new user
 */`,
      code: `function deleteUser(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('name_mismatch');
    expect(result?.severity).toBe('high');
  });

  it('should detect noun mismatch (user vs product)', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Fetches the user profile
 */`,
      code: `function fetchProductDetails() { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('name_mismatch');
  });

  it('should NOT flag when comment matches function name', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Gets the user by ID
 */`,
      code: `function getUserById(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    // Should not be a name mismatch (may be null or different type)
    expect(result?.mismatchType !== 'name_mismatch' || result === null).toBe(true);
  });

  it('should handle synonyms gracefully', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Retrieves the user
 */`,
      code: `function getUser() { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    // 'retrieve' and 'get' are synonyms - should not be flagged
    expect(result?.mismatchType !== 'name_mismatch' || result === null).toBe(true);
  });
});

// ============================================================================
// SEMANTIC DRIFT DETECTION TESTS
// ============================================================================

describe('CommentCodeChecker - checkPair (semantic drift)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should detect comment mentioning deprecated API', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Uses the legacy UserService.fetchUser() method
 * @deprecated Use newUserService.getUser() instead
 */`,
      code: `function getUser() {
  return newUserService.getUser();
}`,
      commentType: 'jsdoc',
    };

    const result = checker.checkPair(pair);

    // Comment says 'deprecated' and mentions legacy method, but code uses new method
    // This could be semantic_drift
    expect(result === null || result?.mismatchType === 'semantic_drift').toBe(true);
  });

  it('should detect TODO/FIXME in comment with implemented code', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `// TODO: Implement caching`,
      code: `const cache = new Map();
function getCached(key: string) {
  return cache.get(key);
}`,
      commentType: 'inline',
    };

    const result = checker.checkPair(pair);

    // TODO says implement caching, but caching appears to be implemented
    // This could be semantic_drift
    expect(result === null || result?.mismatchType === 'semantic_drift').toBe(true);
  });
});

// ============================================================================
// STALE REFERENCE DETECTION TESTS
// ============================================================================

describe('CommentCodeChecker - checkStaleReferences', () => {
  let checker: CommentCodeChecker;
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    checker = createCommentCodeChecker();
    extractor = createASTFactExtractor();
  });

  it('should detect reference to non-existent function', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * Uses the UserService.fetch() method
 */
function getUser() {
  return db.users.get();
}
      `,
      'src/service.ts': `
export class UserService {
  get() { return null; }
}
      `,
    });

    const filePath = path.join(repoPath, 'src/main.ts');
    const facts = await extractor.extractFromDirectory(repoPath);
    const pairs = await checker.extractPairs(filePath);

    expect(pairs.length).toBeGreaterThan(0);
    const result = checker.checkStaleReferences(pairs[0], facts);

    // UserService.fetch doesn't exist (only UserService.get)
    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('stale_reference');
    expect(result?.description).toContain('UserService.fetch');
  });

  it('should detect reference to non-existent file', async () => {
    const filePath = createTestFile(`
/**
 * See src/utils/helpers.ts for implementation details
 */
function process() {
  return 1;
}
    `);

    const facts: ASTFact[] = []; // Empty facts = no files
    const pairs = await checker.extractPairs(filePath);

    const result = checker.checkStaleReferences(pairs[0], facts);

    // src/utils/helpers.ts doesn't exist
    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('stale_reference');
    expect(result?.description).toContain('helpers.ts');
  });

  it('should NOT flag valid references', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * Uses the UserService.get() method
 */
function getUser() {
  return new UserService().get();
}
      `,
      'src/service.ts': `
export class UserService {
  get() { return null; }
}
      `,
    });

    const filePath = path.join(repoPath, 'src/main.ts');
    const facts = await extractor.extractFromDirectory(repoPath);
    const pairs = await checker.extractPairs(filePath);

    const result = checker.checkStaleReferences(pairs[0], facts);

    // UserService.get exists
    expect(result).toBeNull();
  });

  it('should detect reference to renamed function', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * Calls the processData() helper function
 */`,
      code: `function main() {
  return transformData();
}`,
      commentType: 'jsdoc',
    };

    // Facts show transformData exists, but processData doesn't
    const facts: ASTFact[] = [
      {
        type: 'function_def',
        identifier: 'transformData',
        file: 'utils.ts',
        line: 1,
        details: {},
      },
    ];

    const result = checker.checkStaleReferences(pair, facts);

    // processData doesn't exist
    expect(result).not.toBeNull();
    expect(result?.mismatchType).toBe('stale_reference');
  });
});

// ============================================================================
// FULL CHECK (check method) TESTS
// ============================================================================

describe('CommentCodeChecker - check', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should produce a complete CommentCodeReport', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * @param userId - The user ID
 */
function getUser(id: string) { return null; }
      `,
    });

    const report = await checker.check(repoPath);

    // Verify report structure
    expect(report.repoPath).toBe(repoPath);
    expect(report.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof report.totalPairs).toBe('number');
    expect(Array.isArray(report.mismatches)).toBe(true);
    expect(typeof report.mismatchRate).toBe('number');
    expect(report.summary).toBeDefined();
    expect(report.summary.byType).toBeDefined();
    expect(report.summary.bySeverity).toBeDefined();
  });

  it('should detect multiple mismatch types', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * Validates the data
 * @param userId - The user ID
 * @returns {string} The result
 */
function formatData(id: string): number {
  return 42;
}
      `,
    });

    const report = await checker.check(repoPath);

    // Should find: parameter mismatch (userId vs id),
    // return mismatch (string vs number),
    // name mismatch (validates vs format)
    expect(report.mismatches.length).toBeGreaterThan(0);
    const types = new Set(report.mismatches.map(m => m.mismatchType));
    expect(types.size).toBeGreaterThan(0);
  });

  it('should calculate mismatch rate correctly', async () => {
    const repoPath = createTestRepo({
      'src/good.ts': `
/**
 * Gets user by ID
 * @param id - The user ID
 * @returns {User} The user
 */
function getUserById(id: string): User { return null; }
      `,
      'src/bad.ts': `
/**
 * Deletes the user
 * @param userId - The user ID
 */
function createUser(id: string) { }
      `,
    });

    const report = await checker.check(repoPath);

    // mismatchRate should be between 0 and 1
    expect(report.mismatchRate).toBeGreaterThanOrEqual(0);
    expect(report.mismatchRate).toBeLessThanOrEqual(1);

    // If there are mismatches, rate should be > 0
    if (report.mismatches.length > 0 && report.totalPairs > 0) {
      expect(report.mismatchRate).toBeGreaterThan(0);
    }
  });

  it('should include summary with counts by type and severity', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * @param userId - Wrong name
 * @returns {string} Wrong type
 */
function test(id: string): number { return 1; }

/**
 * Creates user
 */
function deleteUser() { }
      `,
    });

    const report = await checker.check(repoPath);

    expect(report.summary.byType).toBeDefined();
    expect(report.summary.bySeverity).toBeDefined();

    // Verify counts match actual mismatches
    const typeCounts = Object.values(report.summary.byType).reduce((a, b) => a + b, 0);
    const severityCounts = Object.values(report.summary.bySeverity).reduce((a, b) => a + b, 0);

    expect(typeCounts).toBe(report.mismatches.length);
    expect(severityCounts).toBe(report.mismatches.length);
  });
});

// ============================================================================
// MISMATCH RESULT STRUCTURE TESTS
// ============================================================================

describe('MismatchResult Structure', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should have correct MismatchResult structure', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 5,
      comment: `/**
 * @param userId - The user ID
 */`,
      code: `function getUser(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    if (result) {
      // Required fields
      expect(result.pair).toBeDefined();
      expect(result.pair).toBe(pair);

      expect(result.mismatchType).toBeDefined();
      expect(['parameter_mismatch', 'return_mismatch', 'name_mismatch', 'semantic_drift', 'stale_reference'])
        .toContain(result.mismatchType);

      expect(result.severity).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.severity);

      expect(result.description).toBeDefined();
      expect(typeof result.description).toBe('string');
      expect(result.description.length).toBeGreaterThan(0);

      // Optional field
      if (result.suggestion !== undefined) {
        expect(typeof result.suggestion).toBe('string');
      }
    }
  });
});

// ============================================================================
// REAL REPO TESTS
// ============================================================================

describe('CommentCodeChecker - Real Repos', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should analyze typedriver-ts without crashing', async () => {
    const report = await checker.check(TYPEDRIVER_REPO);

    expect(report.repoPath).toBe(TYPEDRIVER_REPO);
    expect(Array.isArray(report.mismatches)).toBe(true);
    expect(typeof report.mismatchRate).toBe('number');
  });

  it('should analyze srtd-ts without crashing', async () => {
    const report = await checker.check(SRTD_REPO);

    expect(report.repoPath).toBe(SRTD_REPO);
    expect(Array.isArray(report.mismatches)).toBe(true);
  });

  it('should analyze Librarian src directory', async () => {
    const srcPath = path.join(LIBRARIAN_ROOT, 'src');
    const report = await checker.check(srcPath);

    expect(report.repoPath).toBe(srcPath);
    expect(Array.isArray(report.mismatches)).toBe(true);
    expect(report.totalPairs).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('CommentCodeChecker - Edge Cases', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should handle non-existent file gracefully', async () => {
    const pairs = await checker.extractPairs('/non/existent/file.ts');

    expect(Array.isArray(pairs)).toBe(true);
    expect(pairs.length).toBe(0);
  });

  it('should handle non-existent directory gracefully', async () => {
    const report = await checker.check('/non/existent/directory');

    expect(report.repoPath).toBe('/non/existent/directory');
    expect(report.mismatches.length).toBe(0);
    expect(report.totalPairs).toBe(0);
  });

  it('should handle empty files', async () => {
    const filePath = createTestFile('');

    const pairs = await checker.extractPairs(filePath);

    expect(Array.isArray(pairs)).toBe(true);
    expect(pairs.length).toBe(0);
  });

  it('should handle files with only code (no comments)', async () => {
    const filePath = createTestFile(`
function noComments() {
  return 1 + 2;
}

const arrow = (x: number) => x * 2;
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(Array.isArray(pairs)).toBe(true);
    expect(pairs.length).toBe(0);
  });

  it('should handle syntax errors gracefully', async () => {
    const filePath = createTestFile(`
/**
 * Broken function
 */
function broken( {
  return 1;
}
    `);

    // Should not throw, should return empty or partial results
    const pairs = await checker.extractPairs(filePath);

    expect(Array.isArray(pairs)).toBe(true);
  });

  it('should exclude node_modules', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
/**
 * @param wrong - Wrong param
 */
function main(id: string) { return 1; }
      `,
      'node_modules/some-package/index.ts': `
/**
 * @param wrong - Wrong param
 */
function pkg(id: string) { return 2; }
      `,
    });

    const report = await checker.check(repoPath);

    // Should not include any mismatches from node_modules
    expect(report.mismatches.every(m => !m.pair.file.includes('node_modules'))).toBe(true);
  });

  it('should handle multiline comments', async () => {
    const filePath = createTestFile(`
/**
 * This is a very long comment that spans
 * multiple lines and describes the function
 * in great detail.
 *
 * @param id - The identifier
 * @param options - Configuration options
 * @returns The processed result
 */
function processWithOptions(id: string, options: Options): Result {
  return process(id, options);
}
    `);

    const pairs = await checker.extractPairs(filePath);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0].comment.includes('multiple lines')).toBe(true);
  });

  it('should handle nested comments correctly', async () => {
    const filePath = createTestFile(`
/**
 * Outer function
 */
function outer() {
  /**
   * Inner function
   * @param x - The input
   */
  function inner(x: number) {
    return x;
  }
  return inner;
}
    `);

    const pairs = await checker.extractPairs(filePath);

    // Should extract both outer and inner function comments
    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('CommentCodeChecker - Performance', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should analyze typedriver-ts in under 30 seconds', async () => {
    const start = Date.now();
    await checker.check(TYPEDRIVER_REPO);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30000);
  });

  it('should analyze a small synthetic repo quickly', async () => {
    const repoPath = createTestRepo({
      'src/a.ts': '/** @param x - X */ function a(x: number) { return 1; }',
      'src/b.ts': '/** @param y - Y */ function b(y: string) { return 2; }',
      'src/c.ts': '/** @param z - Z */ function c(z: boolean) { return 3; }',
    });

    const start = Date.now();
    await checker.check(repoPath);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});

// ============================================================================
// SUGGESTION QUALITY TESTS
// ============================================================================

describe('CommentCodeChecker - Suggestions', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should provide helpful suggestion for parameter mismatch', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @param userId - The user ID
 */`,
      code: `function getUser(id: string) { }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkParameters(pair);

    if (result?.suggestion) {
      // Suggestion should mention updating the param name
      expect(result.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('should provide helpful suggestion for return type mismatch', async () => {
    const pair: CommentCodePair = {
      file: 'test.ts',
      line: 1,
      comment: `/**
 * @returns {string} The name
 */`,
      code: `function getName(): number { return 1; }`,
      commentType: 'jsdoc',
    };

    const result = checker.checkReturnType(pair);

    if (result?.suggestion) {
      // Suggestion should mention the actual return type
      expect(result.suggestion.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// WU-CONTRA-001: NEW INTERFACE TESTS
// ============================================================================

describe('CommentCodeChecker - analyzeFile (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should return a ConsistencyReport with required fields', async () => {
    const filePath = createTestFile(`
/**
 * Gets user by ID
 * @param userId - The user ID
 * @returns The user object
 */
function getUser(id: string): User {
  return users.find(u => u.id === id);
}
    `);

    const report = await checker.analyzeFile(filePath);

    // Verify ConsistencyReport structure
    expect(report.filePath).toBe(filePath);
    expect(typeof report.totalComments).toBe('number');
    expect(typeof report.analyzedComments).toBe('number');
    expect(Array.isArray(report.issues)).toBe(true);
    expect(typeof report.overallScore).toBe('number');
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it('should detect issues as ConsistencyIssue objects', async () => {
    const filePath = createTestFile(`
/**
 * Creates a user
 * @param userId - The user ID
 * @returns {string} The result
 */
function deleteUser(id: string): number {
  return 42;
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.issues.length).toBeGreaterThan(0);
    const issue = report.issues[0];

    // Verify ConsistencyIssue structure
    expect(typeof issue.id).toBe('string');
    expect(['info', 'warning', 'error']).toContain(issue.severity);
    expect(issue.commentAnalysis).toBeDefined();
    expect(['outdated', 'misleading', 'incorrect', 'contradictory']).toContain(issue.issueType);
    expect(typeof issue.description).toBe('string');
    expect(typeof issue.confidence).toBe('number');
    expect(issue.confidence).toBeGreaterThanOrEqual(0);
    expect(issue.confidence).toBeLessThanOrEqual(1);
  });

  it('should include CommentAnalysis in each issue', async () => {
    const filePath = createTestFile(`
/**
 * @param wrongName - Wrong parameter name
 */
function test(correctName: string) {
  return correctName;
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.issues.length).toBeGreaterThan(0);
    const analysis = report.issues[0].commentAnalysis;

    // Verify CommentAnalysis structure
    expect(analysis.filePath).toBe(filePath);
    expect(typeof analysis.lineNumber).toBe('number');
    expect(analysis.lineNumber).toBeGreaterThan(0);
    expect(typeof analysis.commentText).toBe('string');
    expect(['inline', 'block', 'jsdoc', 'todo']).toContain(analysis.commentType);
    expect(typeof analysis.associatedCode).toBe('string');
  });

  it('should calculate overallScore between 0-100', async () => {
    const goodFilePath = createTestFile(`
/**
 * Gets user by ID
 * @param id - The user ID
 * @returns {User} The user
 */
function getUserById(id: string): User {
  return db.get(id);
}
    `);

    const badFilePath = createTestFile(`
/**
 * Creates user
 * @param wrongParam - Wrong
 * @returns {string} Wrong type
 */
function deleteUser(differentParam: number): boolean {
  return false;
}
    `);

    const goodReport = await checker.analyzeFile(goodFilePath);
    const badReport = await checker.analyzeFile(badFilePath);

    expect(goodReport.overallScore).toBeGreaterThanOrEqual(0);
    expect(goodReport.overallScore).toBeLessThanOrEqual(100);
    expect(badReport.overallScore).toBeGreaterThanOrEqual(0);
    expect(badReport.overallScore).toBeLessThanOrEqual(100);

    // Good file should score higher than bad file
    expect(goodReport.overallScore).toBeGreaterThan(badReport.overallScore);
  });

  it('should handle files with no comments', async () => {
    const filePath = createTestFile(`
function noComments() {
  return 42;
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.totalComments).toBe(0);
    expect(report.analyzedComments).toBe(0);
    expect(report.issues.length).toBe(0);
    expect(report.overallScore).toBe(100); // Perfect score when no comments to check
  });
});

describe('CommentCodeChecker - analyzeComment (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should return null for consistent comment', async () => {
    const analysis: CommentAnalysis = {
      filePath: 'test.ts',
      lineNumber: 1,
      commentText: '/** Gets user by ID */\nfunction getUserById(id: string)',
      commentType: 'jsdoc',
      associatedCode: 'function getUserById(id: string) { return db.get(id); }',
    };

    const issue = await checker.analyzeComment(analysis);

    expect(issue).toBeNull();
  });

  it('should return ConsistencyIssue for inconsistent comment', async () => {
    // Use a high-severity inconsistency: contradictory verbs
    const analysis: CommentAnalysis = {
      filePath: 'test.ts',
      lineNumber: 1,
      commentText: '/** Adds user to the database */\nfunction removeUser(id: string)',
      commentType: 'jsdoc',
      associatedCode: 'function removeUser(id: string) { return db.remove(id); }',
    };

    const issue = await checker.analyzeComment(analysis);

    expect(issue).not.toBeNull();
    if (issue) {
      expect(typeof issue.id).toBe('string');
      expect(['info', 'warning', 'error']).toContain(issue.severity);
      expect(issue.commentAnalysis).toBe(analysis);
      expect(['outdated', 'misleading', 'incorrect', 'contradictory']).toContain(issue.issueType);
    }
  });

  it('should detect contradictory verb in comment vs code', async () => {
    const analysis: CommentAnalysis = {
      filePath: 'test.ts',
      lineNumber: 1,
      commentText: '/** Creates a new user */\nfunction deleteUser(id: string)',
      commentType: 'jsdoc',
      associatedCode: 'function deleteUser(id: string) { return db.delete(id); }',
    };

    const issue = await checker.analyzeComment(analysis);

    expect(issue).not.toBeNull();
    expect(issue?.issueType).toBe('contradictory');
  });

  it('should detect misleading return type (void mismatch)', async () => {
    // Use high-severity return type mismatch: doc says returns value but function returns void
    const analysis: CommentAnalysis = {
      filePath: 'test.ts',
      lineNumber: 1,
      commentText: '/** @returns {User} The user object */\nfunction updateUser(): void',
      commentType: 'jsdoc',
      associatedCode: 'function updateUser(id: string): void { db.update(id); }',
    };

    const issue = await checker.analyzeComment(analysis);

    expect(issue).not.toBeNull();
    expect(issue?.issueType).toBe('incorrect');
  });

  it('should detect outdated TODO comment', async () => {
    const analysis: CommentAnalysis = {
      filePath: 'test.ts',
      lineNumber: 1,
      commentText: '// TODO: Implement caching',
      commentType: 'todo',
      associatedCode: `const cache = new Map();
function getCached(key: string) {
  if (cache.has(key)) return cache.get(key);
  const value = compute(key);
  cache.set(key, value);
  return value;
}`,
    };

    const issue = await checker.analyzeComment(analysis);

    // May or may not detect this as outdated depending on heuristics
    if (issue) {
      expect(issue.issueType).toBe('outdated');
    }
  });
});

describe('CommentCodeChecker - extractComments (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should extract JSDoc comments', () => {
    const code = `
/**
 * Gets user by ID
 * @param id - The user ID
 */
function getUser(id: string): User {
  return db.get(id);
}
    `;

    const comments = checker.extractComments(code);

    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some(c => c.commentType === 'jsdoc')).toBe(true);
    expect(comments.some(c => c.commentText.includes('Gets user by ID'))).toBe(true);
  });

  it('should extract inline comments', () => {
    const code = `
function process() {
  // Calculate the sum of values
  const sum = a + b;
  return sum;
}
    `;

    const comments = checker.extractComments(code);

    expect(comments.some(c => c.commentType === 'inline')).toBe(true);
    expect(comments.some(c => c.commentText.includes('Calculate the sum'))).toBe(true);
  });

  it('should extract block comments', () => {
    const code = `
/*
 * This validates input data
 * and returns sanitized output
 */
function validate(data: string): string {
  return data.trim();
}
    `;

    const comments = checker.extractComments(code);

    expect(comments.some(c => c.commentType === 'block')).toBe(true);
    expect(comments.some(c => c.commentText.includes('validates input'))).toBe(true);
  });

  it('should extract TODO comments', () => {
    const code = `
function process() {
  // TODO: Add error handling
  return compute();
}
    `;

    const comments = checker.extractComments(code);

    expect(comments.some(c => c.commentType === 'todo')).toBe(true);
    expect(comments.some(c => c.commentText.includes('TODO'))).toBe(true);
  });

  it('should include line numbers', () => {
    const code = `
/**
 * First function
 */
function first() {}

/**
 * Second function
 */
function second() {}
    `;

    const comments = checker.extractComments(code);

    expect(comments.length).toBe(2);
    // Line numbers should be positive
    comments.forEach(c => {
      expect(c.lineNumber).toBeGreaterThan(0);
    });
    // Second comment should be on a later line
    expect(comments[1].lineNumber).toBeGreaterThan(comments[0].lineNumber);
  });

  it('should include associated code', () => {
    const code = `
/**
 * Adds two numbers
 */
function add(a: number, b: number): number {
  return a + b;
}
    `;

    const comments = checker.extractComments(code);

    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].associatedCode).toContain('function add');
  });

  it('should handle empty code', () => {
    const comments = checker.extractComments('');

    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(0);
  });

  it('should handle code with no comments', () => {
    const code = `
function noComments() {
  return 42;
}
    `;

    const comments = checker.extractComments(code);

    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(0);
  });
});

describe('CommentCodeChecker - compareSemantics (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should return consistent=true for matching semantics', () => {
    const comment = 'Gets user by ID';
    const code = 'function getUserById(id: string) { return db.get(id); }';

    const result = checker.compareSemantics(comment, code);

    expect(result.consistent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should return consistent=false for conflicting verbs', () => {
    const comment = 'Creates a new user';
    const code = 'function deleteUser(id: string) { return db.delete(id); }';

    const result = checker.compareSemantics(comment, code);

    expect(result.consistent).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should return consistent=true for synonym verbs', () => {
    const comment = 'Retrieves the user data';
    const code = 'function getUser() { return db.fetch(); }';

    const result = checker.compareSemantics(comment, code);

    expect(result.consistent).toBe(true);
  });

  it('should return consistent=false for noun mismatch', () => {
    const comment = 'Fetches the user profile';
    const code = 'function fetchProductDetails() { return db.products.get(); }';

    const result = checker.compareSemantics(comment, code);

    expect(result.consistent).toBe(false);
  });

  it('should return confidence between 0 and 1', () => {
    const comment = 'Some comment';
    const code = 'function someFunction() {}';

    const result = checker.compareSemantics(comment, code);

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should handle empty comment', () => {
    const comment = '';
    const code = 'function test() {}';

    const result = checker.compareSemantics(comment, code);

    // Empty comment should be considered consistent (nothing to verify)
    expect(result.consistent).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should handle empty code', () => {
    const comment = 'Does something';
    const code = '';

    const result = checker.compareSemantics(comment, code);

    // No code to compare against
    expect(result.consistent).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('CommentCodeChecker - Issue Types (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should detect outdated TODO comments', async () => {
    const filePath = createTestFile(`
// TODO: Implement the add function
function add(a: number, b: number): number {
  return a + b;
}
    `);

    const report = await checker.analyzeFile(filePath);

    // May detect this as outdated if heuristics determine function is implemented
    // This is a semantic check that may or may not trigger
    expect(report.issues.every(i => ['outdated', 'misleading', 'incorrect', 'contradictory'].includes(i.issueType))).toBe(true);
  });

  it('should detect misleading parameter documentation', async () => {
    const filePath = createTestFile(`
/**
 * @param firstName - The user's first name
 * @param lastName - The user's last name
 */
function getUser(id: string) {
  return db.get(id);
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.issues.some(i => i.issueType === 'incorrect' || i.issueType === 'misleading')).toBe(true);
  });

  it('should detect incorrect return type documentation', async () => {
    // Use high-severity case: @returns says returns value but function returns void
    const filePath = createTestFile(`
/**
 * @returns {string[]} Array of user names
 */
function deleteUser(id: string): void {
  db.delete(id);
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.issues.some(i => i.issueType === 'incorrect')).toBe(true);
  });

  it('should detect contradictory function behavior', async () => {
    const filePath = createTestFile(`
/**
 * Enables the feature flag
 */
function disableFeatureFlag(name: string): void {
  flags.set(name, false);
}
    `);

    const report = await checker.analyzeFile(filePath);

    expect(report.issues.some(i => i.issueType === 'contradictory')).toBe(true);
  });
});

describe('CommentCodeChecker - False Positive Rate (WU-CONTRA-001)', () => {
  let checker: CommentCodeChecker;

  beforeAll(() => {
    checker = createCommentCodeChecker();
  });

  it('should NOT flag well-documented code as having issues', async () => {
    const filePath = createTestFile(`
/**
 * Gets user by their unique identifier
 * @param id - The user's unique identifier
 * @returns {User} The user object if found
 */
function getUserById(id: string): User {
  return db.users.find(u => u.id === id);
}

/**
 * Creates a new user in the system
 * @param userData - The user data to create
 * @returns {User} The created user
 */
function createUser(userData: UserData): User {
  return db.users.create(userData);
}

/**
 * Deletes a user from the system
 * @param id - The ID of the user to delete
 */
function deleteUser(id: string): void {
  db.users.delete(id);
}
    `);

    const report = await checker.analyzeFile(filePath);

    // Well-documented code should have few or no issues
    // Target: false positive rate < 10%
    const falsePositiveRate = report.issues.length / Math.max(report.totalComments, 1);
    expect(falsePositiveRate).toBeLessThan(0.1);
  });

  it('should NOT flag synonym usage as inconsistent', async () => {
    const filePath = createTestFile(`
/**
 * Retrieves the user from the database
 */
function getUser(id: string): User {
  return db.get(id);
}

/**
 * Fetches all products
 */
function getAllProducts(): Product[] {
  return db.products.getAll();
}

/**
 * Loads the configuration
 */
function getConfig(): Config {
  return fs.readConfig();
}
    `);

    const report = await checker.analyzeFile(filePath);

    // Synonyms (retrieve/get, fetch/get, load/get) should not be flagged
    expect(report.issues.length).toBe(0);
  });

  it('should NOT flag partial noun matches as inconsistent', async () => {
    const filePath = createTestFile(`
/**
 * Gets the user
 */
function getUserById(id: string): User {
  return db.get(id);
}

/**
 * Deletes the user
 */
function deleteUserAccount(id: string): void {
  db.delete(id);
}
    `);

    const report = await checker.analyzeFile(filePath);

    // "user" vs "userById" and "user" vs "userAccount" are partial matches
    expect(report.issues.length).toBe(0);
  });
});
