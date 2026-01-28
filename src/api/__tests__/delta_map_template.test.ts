/**
 * @fileoverview Tests for T2 DeltaMap Template
 *
 * WU-TMPL-002: T2 DeltaMap Template
 *
 * Tests cover:
 * - Basic diff parsing
 * - Multi-file changes
 * - Renamed files
 * - Binary files handling
 * - Component mapping
 * - Risk assessment
 * - Temporal navigation
 * - Error handling
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import {
  type DeltaMapInput,
  type DeltaMapOutput,
  type FileDelta,
  type DiffHunk,
  parseDiffOutput,
  parseFileDelta,
  identifyAffectedComponents,
  computeRiskAssessment,
  createDeltaMapTemplate,
  executeGitDiff,
  normalizeGitRef,
  type DeltaMapTemplate,
} from '../delta_map_template.js';

// Mock child_process for git commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

describe('T2 DeltaMap Template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // DIFF PARSING TESTS
  // ============================================================================

  describe('parseDiffOutput', () => {
    it('parses a simple single-file diff', () => {
      const diffOutput = `diff --git a/src/index.ts b/src/index.ts
index 1234567..89abcde 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,3 +10,5 @@ export function main() {
   console.log('Hello');
+  console.log('World');
+  return 42;
 }`;

      const result = parseDiffOutput(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/index.ts');
      expect(result[0].status).toBe('modified');
      expect(result[0].additions).toBeGreaterThan(0);
    });

    it('parses multiple file diffs', () => {
      const diffOutput = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..89abcde 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
+// New comment
 export const foo = 1;
diff --git a/src/bar.ts b/src/bar.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -5,6 +5,7 @@ export function bar() {
   return 'bar';
+  // Additional line
 }`;

      const result = parseDiffOutput(diffOutput);

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('src/foo.ts');
      expect(result[1].path).toBe('src/bar.ts');
    });

    it('handles empty diff output', () => {
      const result = parseDiffOutput('');
      expect(result).toHaveLength(0);
    });

    it('parses hunks with correct line ranges', () => {
      const diffOutput = `diff --git a/src/test.ts b/src/test.ts
index 1234567..89abcde 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -10,7 +10,8 @@ function test() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  const c = 4;
   return a + b;
 }`;

      const result = parseDiffOutput(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0].hunks.length).toBeGreaterThan(0);
      expect(result[0].hunks[0].startLine).toBe(10);
    });
  });

  describe('parseFileDelta', () => {
    it('detects added file status', () => {
      const diffHeader = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,5 @@
+export const new = 1;`;

      const result = parseFileDelta(diffHeader);

      expect(result.status).toBe('added');
      expect(result.path).toBe('src/new.ts');
    });

    it('detects deleted file status', () => {
      const diffHeader = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-export const old = 1;`;

      const result = parseFileDelta(diffHeader);

      expect(result.status).toBe('deleted');
      expect(result.path).toBe('src/old.ts');
    });

    it('detects renamed file status', () => {
      const diffHeader = `diff --git a/src/old_name.ts b/src/new_name.ts
similarity index 95%
rename from src/old_name.ts
rename to src/new_name.ts
index 1234567..89abcde 100644
--- a/src/old_name.ts
+++ b/src/new_name.ts`;

      const result = parseFileDelta(diffHeader);

      expect(result.status).toBe('renamed');
      expect(result.path).toBe('src/new_name.ts');
    });

    it('counts additions and deletions correctly', () => {
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..89abcde 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,6 @@
 const a = 1;
-const b = 2;
-const c = 3;
+const b = 20;
+const c = 30;
+const d = 40;
 export { a, b, c };`;

      const result = parseFileDelta(diff);

      expect(result.additions).toBe(3);
      expect(result.deletions).toBe(2);
    });
  });

  // ============================================================================
  // BINARY FILE HANDLING
  // ============================================================================

  describe('binary file handling', () => {
    it('identifies binary files in diff', () => {
      const diffOutput = `diff --git a/assets/image.png b/assets/image.png
Binary files a/assets/image.png and b/assets/image.png differ`;

      const result = parseDiffOutput(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('assets/image.png');
      expect(result[0].status).toBe('modified');
      expect(result[0].hunks).toHaveLength(0);
    });

    it('handles new binary file', () => {
      const diffOutput = `diff --git a/assets/new.png b/assets/new.png
new file mode 100644
Binary files /dev/null and b/assets/new.png differ`;

      const result = parseDiffOutput(diffOutput);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('added');
    });
  });

  // ============================================================================
  // COMPONENT MAPPING
  // ============================================================================

  describe('identifyAffectedComponents', () => {
    it('maps files to their components', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/api/users.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
        {
          path: 'src/api/auth.ts',
          status: 'modified',
          additions: 10,
          deletions: 0,
          hunks: [],
        },
      ];

      const components = identifyAffectedComponents(deltas);

      expect(components).toContain('src/api');
    });

    it('identifies test directories as separate component', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/__tests__/foo.test.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
      ];

      const components = identifyAffectedComponents(deltas);

      expect(components).toContain('src/__tests__');
    });

    it('handles root-level files', () => {
      const deltas: FileDelta[] = [
        {
          path: 'package.json',
          status: 'modified',
          additions: 1,
          deletions: 1,
          hunks: [],
        },
      ];

      const components = identifyAffectedComponents(deltas);

      expect(components).toContain('.');
    });

    it('deduplicates components', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/api/users.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
        {
          path: 'src/api/users.test.ts',
          status: 'modified',
          additions: 10,
          deletions: 0,
          hunks: [],
        },
        {
          path: 'src/api/auth.ts',
          status: 'modified',
          additions: 3,
          deletions: 1,
          hunks: [],
        },
      ];

      const components = identifyAffectedComponents(deltas);

      // Should not have duplicate 'src/api'
      const apiCount = components.filter((c) => c === 'src/api').length;
      expect(apiCount).toBe(1);
    });
  });

  // ============================================================================
  // RISK ASSESSMENT
  // ============================================================================

  describe('computeRiskAssessment', () => {
    it('returns low risk for small changes', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/utils.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
      ];

      const risk = computeRiskAssessment(deltas, ['src']);

      expect(risk).toBe('low');
    });

    it('returns medium risk for moderate changes', () => {
      const deltas: FileDelta[] = [];
      // Create multiple file changes
      for (let i = 0; i < 5; i++) {
        deltas.push({
          path: `src/file${i}.ts`,
          status: 'modified',
          additions: 20,
          deletions: 10,
          hunks: [],
        });
      }

      const components = ['src', 'src/api', 'src/models'];
      const risk = computeRiskAssessment(deltas, components);

      expect(risk).toBe('medium');
    });

    it('returns high risk for large changes', () => {
      const deltas: FileDelta[] = [];
      // Create many file changes with lots of modifications
      for (let i = 0; i < 20; i++) {
        deltas.push({
          path: `src/component${i}/index.ts`,
          status: 'modified',
          additions: 100,
          deletions: 50,
          hunks: [],
        });
      }

      const components = Array.from({ length: 10 }, (_, i) => `src/component${i}`);
      const risk = computeRiskAssessment(deltas, components);

      expect(risk).toBe('high');
    });

    it('considers file deletions as higher risk', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/core/important.ts',
          status: 'deleted',
          additions: 0,
          deletions: 100,
          hunks: [],
        },
      ];

      const risk = computeRiskAssessment(deltas, ['src/core']);

      // Deletions should increase risk
      expect(['medium', 'high']).toContain(risk);
    });

    it('considers security-sensitive files as higher risk', () => {
      const deltas: FileDelta[] = [
        {
          path: 'src/auth/credentials.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
      ];

      const risk = computeRiskAssessment(deltas, ['src/auth']);

      // Auth-related changes should increase risk
      expect(['medium', 'high']).toContain(risk);
    });
  });

  // ============================================================================
  // GIT REF NORMALIZATION
  // ============================================================================

  describe('normalizeGitRef', () => {
    it('passes through simple branch names', () => {
      expect(normalizeGitRef('main')).toBe('main');
      expect(normalizeGitRef('develop')).toBe('develop');
    });

    it('passes through HEAD references', () => {
      expect(normalizeGitRef('HEAD')).toBe('HEAD');
      expect(normalizeGitRef('HEAD~1')).toBe('HEAD~1');
      expect(normalizeGitRef('HEAD^')).toBe('HEAD^');
    });

    it('validates commit SHAs', () => {
      expect(normalizeGitRef('abc123')).toBe('abc123');
      expect(normalizeGitRef('1234567890abcdef')).toBe('1234567890abcdef');
    });

    it('rejects dangerous patterns', () => {
      expect(() => normalizeGitRef('main; rm -rf /')).toThrow();
      expect(() => normalizeGitRef('$(whoami)')).toThrow();
      expect(() => normalizeGitRef('main`whoami`')).toThrow();
    });
  });

  // ============================================================================
  // GIT COMMAND EXECUTION
  // ============================================================================

  describe('executeGitDiff', () => {
    it('executes git diff with correct arguments', () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'main',
        targetRef: 'HEAD',
      };

      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git diff'),
        expect.objectContaining({ cwd: '/test/repo' })
      );
    });

    it('applies include patterns', () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'main',
        targetRef: 'HEAD',
        includePatterns: ['src/**/*.ts', 'lib/**/*.ts'],
      };

      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-- src/**/*.ts lib/**/*.ts'),
        expect.any(Object)
      );
    });

    it('applies exclude patterns', () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'main',
        targetRef: 'HEAD',
        excludePatterns: ['*.test.ts', '__tests__/**'],
      };

      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("':!*.test.ts' ':!__tests__/**'"),
        expect.any(Object)
      );
    });

    it('handles git errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not a git repository');
      });

      const input: DeltaMapInput = {
        repoPath: '/not/a/repo',
        baseRef: 'main',
        targetRef: 'HEAD',
      };

      expect(() => executeGitDiff(input)).toThrow(/not a git repository/);
    });
  });

  // ============================================================================
  // TEMPLATE INTEGRATION
  // ============================================================================

  describe('createDeltaMapTemplate', () => {
    it('creates a template with correct T2 identifier', () => {
      const template = createDeltaMapTemplate();

      expect(template.id).toBe('T2');
      expect(template.name).toBe('DeltaMap');
    });

    it('declares correct required maps', () => {
      const template = createDeltaMapTemplate();

      expect(template.requiredMaps).toContain('ChangeMap');
      expect(template.requiredMaps).toContain('FreshnessCursor');
    });

    it('declares correct supported UCs', () => {
      const template = createDeltaMapTemplate();

      expect(template.supportedUcs).toContain('UC-041');
      expect(template.supportedUcs).toContain('UC-042');
    });
  });

  describe('DeltaMapTemplate execute', () => {
    it('produces DeltaMapOutput with required fields', async () => {
      mockExecSync.mockReturnValue(`diff --git a/src/test.ts b/src/test.ts
index 1234567..89abcde 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
+// Added line
 export const test = 1;`);

      const template = createDeltaMapTemplate();
      const result = await template.execute({
        intent: 'Show changes since main',
        workspace: '/test/repo',
        depth: 'medium',
      });

      expect(result.success).toBe(true);
      expect(result.packs.length).toBeGreaterThan(0);

      // Find the DeltaPack
      const deltaPack = result.packs.find((p) => p.packType === 'change_impact');
      expect(deltaPack).toBeDefined();
    });

    it('includes confidence value in output', async () => {
      mockExecSync.mockReturnValue(`diff --git a/src/test.ts b/src/test.ts
index 1234567..89abcde 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
+// Added line
 export const test = 1;`);

      const template = createDeltaMapTemplate();
      const result = await template.execute({
        intent: 'Show changes',
        workspace: '/test/repo',
      });

      expect(result.packs[0].confidence).toBeGreaterThan(0);
    });

    it('emits evidence for template selection', async () => {
      mockExecSync.mockReturnValue('');

      const template = createDeltaMapTemplate();
      const result = await template.execute({
        intent: 'Show changes',
        workspace: '/test/repo',
      });

      expect(result.evidence).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].templateId).toBe('T2');
    });

    it('includes disclosures for limitations', async () => {
      mockExecSync.mockReturnValue('');

      const template = createDeltaMapTemplate();
      const result = await template.execute({
        intent: 'Show changes',
        workspace: '/test/repo',
      });

      expect(result.disclosures).toBeDefined();
      // Empty diff should have a disclosure
      expect(result.disclosures.some((d) => d.includes('no_changes'))).toBe(true);
    });
  });

  // ============================================================================
  // TEMPORAL NAVIGATION
  // ============================================================================

  describe('temporal navigation support', () => {
    it('supports relative refs like HEAD~N', async () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'HEAD~5',
        targetRef: 'HEAD',
      };

      // Should not throw
      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('HEAD~5...HEAD'),
        expect.any(Object)
      );
    });

    it('supports tag references', () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'v1.0.0',
        targetRef: 'v2.0.0',
      };

      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('v1.0.0...v2.0.0'),
        expect.any(Object)
      );
    });

    it('supports commit SHA refs', () => {
      mockExecSync.mockReturnValue('');

      const input: DeltaMapInput = {
        repoPath: '/test/repo',
        baseRef: 'abc1234',
        targetRef: 'def5678',
      };

      executeGitDiff(input);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('abc1234...def5678'),
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles unicode filenames', () => {
      const diffOutput = `diff --git "a/src/\xE4\xB8\xAD\xE6\x96\x87.ts" "b/src/\xE4\xB8\xAD\xE6\x96\x87.ts"
index 1234567..89abcde 100644`;

      const result = parseDiffOutput(diffOutput);
      expect(result).toHaveLength(1);
    });

    it('handles paths with spaces', () => {
      const diffOutput = `diff --git "a/src/my file.ts" "b/src/my file.ts"
index 1234567..89abcde 100644
--- "a/src/my file.ts"
+++ "b/src/my file.ts"
@@ -1,3 +1,4 @@
+// Added
 export const x = 1;`;

      const result = parseDiffOutput(diffOutput);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/my file.ts');
    });

    it('handles very large diffs', () => {
      // Create a diff with many hunks
      let diffOutput = `diff --git a/src/big.ts b/src/big.ts
index 1234567..89abcde 100644
--- a/src/big.ts
+++ b/src/big.ts`;

      for (let i = 0; i < 100; i++) {
        diffOutput += `
@@ -${i * 10},5 +${i * 10},6 @@ function chunk${i}() {
   const x = ${i};
+  const y = ${i + 1};
 }`;
      }

      const result = parseDiffOutput(diffOutput);
      expect(result).toHaveLength(1);
      expect(result[0].hunks.length).toBeGreaterThan(0);
    });

    it('handles merge conflict markers in diff', () => {
      const diffOutput = `diff --git a/src/conflict.ts b/src/conflict.ts
index 1234567..89abcde 100644
--- a/src/conflict.ts
+++ b/src/conflict.ts
@@ -1,3 +1,7 @@
+<<<<<<< HEAD
 const value = 'mine';
+=======
+const value = 'theirs';
+>>>>>>> branch`;

      const result = parseDiffOutput(diffOutput);
      expect(result).toHaveLength(1);
      // Should still parse correctly
    });
  });

  // ============================================================================
  // OUTPUT STRUCTURE
  // ============================================================================

  describe('DeltaMapOutput structure', () => {
    it('includes all required fields', async () => {
      mockExecSync.mockReturnValue(`diff --git a/src/test.ts b/src/test.ts
index 1234567..89abcde 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,5 @@
 export const test = 1;
+export const foo = 2;
+export const bar = 3;`);

      const template = createDeltaMapTemplate();
      const result = await template.execute({
        intent: 'analyze changes',
        workspace: '/test/repo',
      });

      // Check pack contains DeltaMapOutput-like data
      const pack = result.packs[0];
      expect(pack.keyFacts).toBeDefined();
      expect(pack.keyFacts.length).toBeGreaterThan(0);
    });
  });
});
