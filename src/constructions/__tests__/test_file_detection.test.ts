/**
 * @fileoverview Tests for test file detection functionality
 *
 * Tests the findCorrespondingTestFile function and related utilities
 * that find test files corresponding to source files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  findCorrespondingTestFile,
  findFileRecursive,
  deriveWorkspaceFromPath,
} from '../refactoring_safety_checker.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a temporary directory structure for testing.
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-test-'));
}

/**
 * Clean up a temporary directory.
 */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Create a file in the given directory, creating parent directories as needed.
 */
function createFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// ============================================================================
// findCorrespondingTestFile TESTS
// ============================================================================

describe('findCorrespondingTestFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Create a package.json to mark this as a workspace root
    createFile(path.join(tempDir, 'package.json'), '{}');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('same directory patterns', () => {
    it('should find .test.ts in same directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'src', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find .spec.ts in same directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'src', 'utils.spec.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find .test.tsx for React components', () => {
      const sourceFile = path.join(tempDir, 'src', 'Button.tsx');
      const testFile = path.join(tempDir, 'src', 'Button.test.tsx');

      createFile(sourceFile, 'export function Button() {}');
      createFile(testFile, 'test("Button", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find .spec.tsx for React components', () => {
      const sourceFile = path.join(tempDir, 'src', 'Button.tsx');
      const testFile = path.join(tempDir, 'src', 'Button.spec.tsx');

      createFile(sourceFile, 'export function Button() {}');
      createFile(testFile, 'test("Button", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });

  describe('__tests__ subdirectory patterns', () => {
    it('should find test in __tests__ subdirectory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'src', '__tests__', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find .spec.ts in __tests__ subdirectory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'src', '__tests__', 'utils.spec.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });

  describe('parallel test directory structure', () => {
    it('should find test in parallel test/ directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'test', 'src', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find test in parallel tests/ directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, 'tests', 'src', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find test in parallel __tests__/ directory at root', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const testFile = path.join(tempDir, '__tests__', 'src', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(testFile, 'test("foo", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });

  describe('src -> test mirror pattern', () => {
    it('should find test when src/ is mirrored to test/', () => {
      const sourceFile = path.join(tempDir, 'src', 'api', 'handler.ts');
      const testFile = path.join(tempDir, 'test', 'api', 'handler.test.ts');

      createFile(sourceFile, 'export function handle() {}');
      createFile(testFile, 'test("handle", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find nested test in src -> test mirror', () => {
      const sourceFile = path.join(tempDir, 'src', 'deep', 'nested', 'module.ts');
      const testFile = path.join(tempDir, 'test', 'deep', 'nested', 'module.test.ts');

      createFile(sourceFile, 'export const x = 1;');
      createFile(testFile, 'test("x", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });

  describe('fallback recursive search', () => {
    it('should find test file by recursive search in __tests__ directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'api', 'handler.ts');
      // Test file in a non-standard location within __tests__
      const testFile = path.join(tempDir, '__tests__', 'integration', 'handler.test.ts');

      createFile(sourceFile, 'export function handle() {}');
      createFile(testFile, 'test("handle", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });

    it('should find test file by recursive search in test directory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils', 'parser.ts');
      // Test file in a non-standard location within test
      const testFile = path.join(tempDir, 'test', 'unit', 'parser.spec.ts');

      createFile(sourceFile, 'export function parse() {}');
      createFile(testFile, 'test("parse", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });

  describe('edge cases', () => {
    it('should return null when no test file exists', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      createFile(sourceFile, 'export function foo() {}');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBeNull();
    });

    it('should handle files without .ts extension', () => {
      const sourceFile = path.join(tempDir, 'src', 'config.json');
      createFile(sourceFile, '{}');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBeNull();
    });

    it('should prioritize same-directory test over __tests__ subdirectory', () => {
      const sourceFile = path.join(tempDir, 'src', 'utils.ts');
      const sameDirectoryTest = path.join(tempDir, 'src', 'utils.test.ts');
      const subdirTest = path.join(tempDir, 'src', '__tests__', 'utils.test.ts');

      createFile(sourceFile, 'export function foo() {}');
      createFile(sameDirectoryTest, 'test in same dir');
      createFile(subdirTest, 'test in __tests__');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(sameDirectoryTest);
    });

    it('should handle deeply nested source files', () => {
      const sourceFile = path.join(tempDir, 'src', 'a', 'b', 'c', 'd', 'module.ts');
      const testFile = path.join(tempDir, 'src', 'a', 'b', 'c', 'd', 'module.test.ts');

      createFile(sourceFile, 'export const x = 1;');
      createFile(testFile, 'test("x", () => {})');

      const result = findCorrespondingTestFile(sourceFile, tempDir);
      expect(result).toBe(testFile);
    });
  });
});

// ============================================================================
// findFileRecursive TESTS
// ============================================================================

describe('findFileRecursive', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should find test file at root level', () => {
    const testFile = path.join(tempDir, 'utils.test.ts');
    createFile(testFile, 'test content');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBe(testFile);
  });

  it('should find test file in nested directory', () => {
    const testFile = path.join(tempDir, 'nested', 'deep', 'utils.test.ts');
    createFile(testFile, 'test content');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBe(testFile);
  });

  it('should find .spec.ts files', () => {
    const testFile = path.join(tempDir, 'utils.spec.ts');
    createFile(testFile, 'spec content');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBe(testFile);
  });

  it('should find .test.tsx files', () => {
    const testFile = path.join(tempDir, 'Button.test.tsx');
    createFile(testFile, 'test content');

    const result = findFileRecursive(tempDir, 'Button');
    expect(result).toBe(testFile);
  });

  it('should find .spec.jsx files', () => {
    const testFile = path.join(tempDir, 'Component.spec.jsx');
    createFile(testFile, 'spec content');

    const result = findFileRecursive(tempDir, 'Component');
    expect(result).toBe(testFile);
  });

  it('should return null when no matching file exists', () => {
    createFile(path.join(tempDir, 'other.ts'), 'content');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBeNull();
  });

  it('should return null for non-existent directory', () => {
    const result = findFileRecursive(path.join(tempDir, 'nonexistent'), 'utils');
    expect(result).toBeNull();
  });

  it('should not match non-test files', () => {
    createFile(path.join(tempDir, 'utils.ts'), 'source content');
    createFile(path.join(tempDir, 'utils.d.ts'), 'types');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBeNull();
  });

  it('should find file when base name is a substring', () => {
    const testFile = path.join(tempDir, 'my-utils.test.ts');
    createFile(testFile, 'test content');

    const result = findFileRecursive(tempDir, 'utils');
    expect(result).toBe(testFile);
  });
});

// ============================================================================
// deriveWorkspaceFromPath TESTS
// ============================================================================

describe('deriveWorkspaceFromPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should find workspace with package.json marker', () => {
    createFile(path.join(tempDir, 'package.json'), '{}');
    const sourceFile = path.join(tempDir, 'src', 'deep', 'nested', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    expect(result).toBe(tempDir);
  });

  it('should find workspace with tsconfig.json marker', () => {
    createFile(path.join(tempDir, 'tsconfig.json'), '{}');
    const sourceFile = path.join(tempDir, 'src', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    expect(result).toBe(tempDir);
  });

  it('should find workspace with .git marker', () => {
    fs.mkdirSync(path.join(tempDir, '.git'));
    const sourceFile = path.join(tempDir, 'src', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    expect(result).toBe(tempDir);
  });

  it('should find workspace with node_modules marker', () => {
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    const sourceFile = path.join(tempDir, 'src', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    expect(result).toBe(tempDir);
  });

  it('should return file directory when no markers found', () => {
    const sourceFile = path.join(tempDir, 'src', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    // Should return the deepest directory since no markers are found
    expect(result).toBe(path.join(tempDir, 'src'));
  });

  it('should prefer closest marker when multiple exist', () => {
    // Create nested workspace structure
    createFile(path.join(tempDir, 'package.json'), '{}');
    createFile(path.join(tempDir, 'packages', 'sub-pkg', 'package.json'), '{}');
    const sourceFile = path.join(tempDir, 'packages', 'sub-pkg', 'src', 'file.ts');
    createFile(sourceFile, 'content');

    const result = deriveWorkspaceFromPath(sourceFile);
    expect(result).toBe(path.join(tempDir, 'packages', 'sub-pkg'));
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Test File Detection Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    createFile(path.join(tempDir, 'package.json'), '{}');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should work with a realistic project structure', () => {
    // Create a realistic project structure
    createFile(path.join(tempDir, 'src', 'api', 'handler.ts'), 'export function handle() {}');
    createFile(path.join(tempDir, 'src', 'utils', 'helpers.ts'), 'export function help() {}');
    createFile(path.join(tempDir, 'src', 'components', 'Button.tsx'), 'export function Button() {}');

    // Create test files in various locations
    createFile(path.join(tempDir, 'src', 'api', '__tests__', 'handler.test.ts'), 'test handler');
    createFile(path.join(tempDir, 'src', 'utils', 'helpers.test.ts'), 'test helpers');
    createFile(path.join(tempDir, 'src', 'components', 'Button.test.tsx'), 'test Button');

    // Test finding each
    expect(findCorrespondingTestFile(
      path.join(tempDir, 'src', 'api', 'handler.ts'),
      tempDir
    )).toBe(path.join(tempDir, 'src', 'api', '__tests__', 'handler.test.ts'));

    expect(findCorrespondingTestFile(
      path.join(tempDir, 'src', 'utils', 'helpers.ts'),
      tempDir
    )).toBe(path.join(tempDir, 'src', 'utils', 'helpers.test.ts'));

    expect(findCorrespondingTestFile(
      path.join(tempDir, 'src', 'components', 'Button.tsx'),
      tempDir
    )).toBe(path.join(tempDir, 'src', 'components', 'Button.test.tsx'));
  });

  it('should work when workspace is derived from path', () => {
    createFile(path.join(tempDir, 'src', 'module.ts'), 'export const x = 1;');
    createFile(path.join(tempDir, 'src', 'module.test.ts'), 'test x');

    const sourceFile = path.join(tempDir, 'src', 'module.ts');
    const workspace = deriveWorkspaceFromPath(sourceFile);
    const testFile = findCorrespondingTestFile(sourceFile, workspace);

    expect(testFile).toBe(path.join(tempDir, 'src', 'module.test.ts'));
  });
});
