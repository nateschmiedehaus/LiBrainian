/**
 * @fileoverview Tests for File Size Guard primitive
 *
 * This module enforces maximum file size limits to prevent files from becoming
 * too large for AI tools to read. Claude Code has a ~25,000 token limit per file.
 * We enforce conservative limits: 20,000 tokens, 2000 lines, 80,000 chars.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkFile,
  checkDirectory,
  checkFiles,
  assertFileSizes,
  formatReport,
  estimateTokens,
  DEFAULT_FILE_SIZE_CONFIG,
  FileSizeError,
  type FileSizeConfig,
  type FileSizeResult,
  type FileSizeReport,
} from '../file_size_guard.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a file with specific number of lines and characters per line
 */
async function createTestFile(
  dir: string,
  name: string,
  lines: number,
  charsPerLine: number = 80,
): Promise<string> {
  const filePath = join(dir, name);
  const content = Array(lines)
    .fill('x'.repeat(charsPerLine))
    .join('\n');
  await writeFile(filePath, content);
  return filePath;
}

/**
 * Create a file with exact character count
 */
async function createTestFileWithChars(
  dir: string,
  name: string,
  totalChars: number,
): Promise<string> {
  const filePath = join(dir, name);
  const content = 'x'.repeat(totalChars);
  await writeFile(filePath, content);
  return filePath;
}

// ============================================================================
// TESTS
// ============================================================================

describe('File Size Guard', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-size-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // estimateTokens TESTS
  // ============================================================================

  describe('estimateTokens', () => {
    it('should estimate tokens as chars/4', () => {
      expect(estimateTokens(100)).toBe(25);
      expect(estimateTokens(400)).toBe(100);
      expect(estimateTokens(80000)).toBe(20000);
    });

    it('should round down for non-divisible values', () => {
      expect(estimateTokens(101)).toBe(25);
      expect(estimateTokens(103)).toBe(25);
    });

    it('should return 0 for 0 chars', () => {
      expect(estimateTokens(0)).toBe(0);
    });
  });

  // ============================================================================
  // checkFile TESTS
  // ============================================================================

  describe('checkFile', () => {
    it('should pass for a small file within limits', async () => {
      const filePath = await createTestFile(testDir, 'small.ts', 100, 40);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.lines).toBe(100);
      expect(result.file).toBe(filePath);
    });

    it('should fail when file exceeds line limit', async () => {
      const filePath = await createTestFile(testDir, 'too-many-lines.ts', 2500, 40);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(false);
      expect(result.lines).toBe(2500);
      expect(result.violations.some(v => v.type === 'lines')).toBe(true);
    });

    it('should fail when file exceeds character limit', async () => {
      const filePath = await createTestFileWithChars(testDir, 'too-many-chars.ts', 90000);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(false);
      expect(result.chars).toBe(90000);
      expect(result.violations.some(v => v.type === 'chars')).toBe(true);
    });

    it('should fail when file exceeds token limit', async () => {
      // 90000 chars = 22500 tokens, exceeds 20000 token limit
      const filePath = await createTestFileWithChars(testDir, 'too-many-tokens.ts', 90000);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(false);
      expect(result.estimatedTokens).toBe(22500);
      expect(result.violations.some(v => v.type === 'tokens')).toBe(true);
    });

    it('should respect custom config limits', async () => {
      const filePath = await createTestFile(testDir, 'custom-limits.ts', 150, 40);
      const customConfig: FileSizeConfig = {
        maxLines: 100,
        maxChars: 10000,
        maxTokens: 2500,
      };
      const result = await checkFile(filePath, customConfig);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === 'lines' && v.limit === 100)).toBe(true);
    });

    it('should include relative path in result', async () => {
      const subDir = join(testDir, 'src', 'components');
      await mkdir(subDir, { recursive: true });
      const filePath = await createTestFile(subDir, 'Component.tsx', 50);

      const result = await checkFile(filePath, undefined, testDir);

      expect(result.relativePath).toBe('src/components/Component.tsx');
    });

    it('should handle empty files', async () => {
      const filePath = join(testDir, 'empty.ts');
      await writeFile(filePath, '');

      const result = await checkFile(filePath);

      expect(result.passed).toBe(true);
      expect(result.lines).toBe(0);
      expect(result.chars).toBe(0);
      expect(result.estimatedTokens).toBe(0);
    });

    it('should detect multiple violations at once', async () => {
      // File that exceeds all limits
      const filePath = await createTestFile(testDir, 'huge.ts', 3000, 50);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // checkDirectory TESTS
  // ============================================================================

  describe('checkDirectory', () => {
    it('should check all matching files in directory', async () => {
      await createTestFile(testDir, 'file1.ts', 100);
      await createTestFile(testDir, 'file2.ts', 200);
      await createTestFile(testDir, 'file3.ts', 50);

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(3);
      expect(report.passedFiles).toBe(3);
      expect(report.failedFiles).toBe(0);
    });

    it('should report failures for files exceeding limits', async () => {
      await createTestFile(testDir, 'small.ts', 100);
      await createTestFile(testDir, 'huge.ts', 3000);

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(2);
      expect(report.passedFiles).toBe(1);
      expect(report.failedFiles).toBe(1);
      expect(report.results.find(r => r.file.includes('huge.ts'))?.passed).toBe(false);
    });

    it('should only check files with matching extensions', async () => {
      await createTestFile(testDir, 'code.ts', 100);
      await createTestFile(testDir, 'data.json', 3000); // Should be ignored by default
      await createTestFile(testDir, 'image.png', 5000); // Should be ignored

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(1);
    });

    it('should respect custom extensions config', async () => {
      await createTestFile(testDir, 'code.ts', 100);
      await createTestFile(testDir, 'data.json', 100);

      const report = await checkDirectory(testDir, {
        extensions: ['.json'],
      });

      expect(report.totalFiles).toBe(1);
      expect(report.results[0].file).toContain('data.json');
    });

    it('should exclude files matching exclude patterns', async () => {
      const nodeModules = join(testDir, 'node_modules', 'pkg');
      await mkdir(nodeModules, { recursive: true });
      await createTestFile(nodeModules, 'huge.ts', 5000);
      await createTestFile(testDir, 'small.ts', 100);

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(1);
      expect(report.results[0].file).toContain('small.ts');
    });

    it('should recursively scan subdirectories', async () => {
      const subDir = join(testDir, 'src', 'utils');
      await mkdir(subDir, { recursive: true });
      await createTestFile(testDir, 'root.ts', 50);
      await createTestFile(subDir, 'helper.ts', 50);

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(2);
    });

    it('should return empty report for directory with no matching files', async () => {
      await createTestFile(testDir, 'readme.txt', 100);
      await createTestFile(testDir, 'config.yaml', 100);

      const report = await checkDirectory(testDir);

      expect(report.totalFiles).toBe(0);
      expect(report.results).toHaveLength(0);
    });
  });

  // ============================================================================
  // checkFiles TESTS
  // ============================================================================

  describe('checkFiles', () => {
    it('should check only specified files', async () => {
      await createTestFile(testDir, 'staged.ts', 100);
      await createTestFile(testDir, 'not-staged.ts', 3000);

      const report = await checkFiles(['staged.ts'], testDir);

      expect(report.totalFiles).toBe(1);
      expect(report.passedFiles).toBe(1);
    });

    it('should handle absolute paths', async () => {
      const filePath = await createTestFile(testDir, 'absolute.ts', 100);

      const report = await checkFiles([filePath], testDir);

      expect(report.totalFiles).toBe(1);
      expect(report.passedFiles).toBe(1);
    });

    it('should handle relative paths', async () => {
      const subDir = join(testDir, 'src');
      await mkdir(subDir, { recursive: true });
      await createTestFile(subDir, 'relative.ts', 100);

      const report = await checkFiles(['src/relative.ts'], testDir);

      expect(report.totalFiles).toBe(1);
      expect(report.passedFiles).toBe(1);
    });

    it('should skip non-existent files gracefully', async () => {
      await createTestFile(testDir, 'exists.ts', 100);

      const report = await checkFiles(['exists.ts', 'missing.ts'], testDir);

      expect(report.totalFiles).toBe(1);
    });

    it('should filter by configured extensions', async () => {
      await createTestFile(testDir, 'code.ts', 100);
      await createTestFile(testDir, 'data.json', 100);

      const report = await checkFiles(['code.ts', 'data.json'], testDir);

      // Default extensions include .ts but not .json
      expect(report.totalFiles).toBe(1);
    });

    it('should return failures for files exceeding limits', async () => {
      await createTestFile(testDir, 'huge.ts', 3000);

      const report = await checkFiles(['huge.ts'], testDir);

      expect(report.totalFiles).toBe(1);
      expect(report.failedFiles).toBe(1);
    });
  });

  // ============================================================================
  // assertFileSizes TESTS
  // ============================================================================

  describe('assertFileSizes', () => {
    it('should not throw when all files pass', async () => {
      await createTestFile(testDir, 'small.ts', 100);

      await expect(assertFileSizes(testDir)).resolves.not.toThrow();
    });

    it('should throw FileSizeError when files exceed limits', async () => {
      await createTestFile(testDir, 'huge.ts', 3000);

      await expect(assertFileSizes(testDir)).rejects.toThrow(FileSizeError);
    });

    it('should include violation details in error', async () => {
      await createTestFile(testDir, 'huge.ts', 3000);

      try {
        await assertFileSizes(testDir);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(FileSizeError);
        expect((error as FileSizeError).report.failedFiles).toBe(1);
      }
    });

    it('should respect custom config', async () => {
      await createTestFile(testDir, 'medium.ts', 150);

      await expect(
        assertFileSizes(testDir, { maxLines: 100 }),
      ).rejects.toThrow(FileSizeError);
    });
  });

  // ============================================================================
  // formatReport TESTS
  // ============================================================================

  describe('formatReport', () => {
    it('should format passing report clearly', async () => {
      await createTestFile(testDir, 'small.ts', 100);
      const report = await checkDirectory(testDir);
      const formatted = formatReport(report);

      expect(formatted).toContain('1 file');
      expect(formatted).toContain('passed');
      expect(formatted.toLowerCase()).not.toContain('violation');
    });

    it('should format failures with violation details', async () => {
      await createTestFile(testDir, 'huge.ts', 3000);
      const report = await checkDirectory(testDir);
      const formatted = formatReport(report);

      expect(formatted).toContain('huge.ts');
      expect(formatted).toContain('3000');
      expect(formatted).toContain('lines');
    });

    it('should show all violation types', async () => {
      // Create a file that exceeds all limits
      await createTestFile(testDir, 'mega.ts', 3000, 50);
      const report = await checkDirectory(testDir);
      const formatted = formatReport(report);

      expect(formatted).toContain('lines');
      expect(formatted).toContain('chars');
      expect(formatted).toContain('tokens');
    });

    it('should be human-readable', async () => {
      await createTestFile(testDir, 'small.ts', 50);
      await createTestFile(testDir, 'medium.ts', 500);
      const report = await checkDirectory(testDir);
      const formatted = formatReport(report);

      // Should not contain raw JSON or unformatted data
      expect(formatted).not.toContain('{');
      expect(formatted).not.toContain('}');
    });
  });

  // ============================================================================
  // DEFAULT CONFIG TESTS
  // ============================================================================

  describe('DEFAULT_FILE_SIZE_CONFIG', () => {
    it('should have conservative token limit', () => {
      expect(DEFAULT_FILE_SIZE_CONFIG.maxTokens).toBe(20000);
    });

    it('should have conservative line limit', () => {
      expect(DEFAULT_FILE_SIZE_CONFIG.maxLines).toBe(2000);
    });

    it('should have conservative char limit', () => {
      expect(DEFAULT_FILE_SIZE_CONFIG.maxChars).toBe(80000);
    });

    it('should include common code file extensions', () => {
      const exts = DEFAULT_FILE_SIZE_CONFIG.extensions!;
      expect(exts).toContain('.ts');
      expect(exts).toContain('.tsx');
      expect(exts).toContain('.js');
      expect(exts).toContain('.jsx');
      expect(exts).toContain('.py');
      expect(exts).toContain('.go');
      expect(exts).toContain('.rs');
      expect(exts).toContain('.java');
      expect(exts).toContain('.md');
    });

    it('should exclude node_modules and dist by default', () => {
      const patterns = DEFAULT_FILE_SIZE_CONFIG.excludePatterns!;
      expect(patterns.some(p => p.includes('node_modules'))).toBe(true);
      expect(patterns.some(p => p.includes('dist'))).toBe(true);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle files at exact line limit', async () => {
      // Create file with exactly 2000 lines but within char/token limits
      const filePath = await createTestFile(testDir, 'exact.ts', 2000, 30);
      const result = await checkFile(filePath);

      expect(result.lines).toBe(2000);
      expect(result.passed).toBe(true);
    });

    it('should handle files just over limits', async () => {
      const filePath = await createTestFile(testDir, 'over.ts', 2001, 30);
      const result = await checkFile(filePath);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === 'lines')).toBe(true);
    });

    it('should handle unicode content', async () => {
      const filePath = join(testDir, 'unicode.ts');
      // Create 100 lines with unicode (no trailing newline to avoid empty 101st element)
      const lines = Array(100).fill('const emoji = "Hello! How are you?"; // Test unicode content');
      const content = lines.join('\n');
      await writeFile(filePath, content);

      const result = await checkFile(filePath);

      expect(result.passed).toBe(true);
      expect(result.lines).toBe(100);
    });

    it('should handle files with very long lines', async () => {
      const filePath = join(testDir, 'long-lines.ts');
      const content = 'x'.repeat(5000) + '\n' + 'y'.repeat(5000);
      await writeFile(filePath, content);

      const result = await checkFile(filePath);

      expect(result.lines).toBe(2);
      expect(result.chars).toBe(10001); // 5000 + 1 (newline) + 5000
    });

    it('should handle ascii content gracefully', async () => {
      const filePath = join(testDir, 'ascii.ts');
      // Create printable ASCII content instead of random bytes
      const content = 'x'.repeat(1000);
      await writeFile(filePath, content);

      const result = await checkFile(filePath);

      expect(result.chars).toBe(1000);
    });
  });
});
