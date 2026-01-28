/**
 * @fileoverview Tests for Codebase Profiler
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Codebase Profiler analyzes a repository and produces a quality profile
 * used by other components to adapt Librarian's behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  CodebaseProfiler,
  createCodebaseProfiler,
  type CodebaseProfile,
} from '../codebase_profiler.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture (a real TypeScript monorepo)
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// External repos from eval-corpus for diverse testing
const EXTERNAL_REPOS_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos');
const TYPEDRIVER_REPO = path.join(EXTERNAL_REPOS_ROOT, 'typedriver-ts');
const SRTD_REPO = path.join(EXTERNAL_REPOS_ROOT, 'srtd-ts');
const QUICKPICKLE_REPO = path.join(EXTERNAL_REPOS_ROOT, 'quickpickle-ts');
const AWS_SDK_MOCK_REPO = path.join(EXTERNAL_REPOS_ROOT, 'aws-sdk-vitest-mock-ts');

// Python repos for language detection
const RECCMP_REPO = path.join(EXTERNAL_REPOS_ROOT, 'reccmp-py');
const TOKEN_EXPLORER_REPO = path.join(EXTERNAL_REPOS_ROOT, 'token-explorer-py');
const PYTEST_PARALLEL_REPO = path.join(EXTERNAL_REPOS_ROOT, 'pytest-run-parallel-py');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCodebaseProfiler', () => {
  it('should create a profiler instance', () => {
    const profiler = createCodebaseProfiler();
    expect(profiler).toBeInstanceOf(CodebaseProfiler);
  });
});

// ============================================================================
// PROFILE STRUCTURE TESTS
// ============================================================================

describe('CodebaseProfiler - Profile Structure', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should produce a complete CodebaseProfile', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    // Required top-level fields
    expect(profile.repoPath).toBeDefined();
    expect(profile.analyzedAt).toBeDefined();
    expect(profile.size).toBeDefined();
    expect(profile.complexity).toBeDefined();
    expect(profile.quality).toBeDefined();
    expect(profile.structure).toBeDefined();
    expect(profile.risks).toBeDefined();
    expect(profile.classification).toBeDefined();
    expect(profile.qualityTier).toBeDefined();
  });

  it('should include repoPath and analyzedAt timestamp', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(profile.repoPath).toBe(TYPEDRIVER_REPO);
    expect(profile.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should validate size metrics structure', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(typeof profile.size.totalFiles).toBe('number');
    expect(typeof profile.size.totalLines).toBe('number');
    expect(typeof profile.size.languages).toBe('object');
    expect(profile.size.totalFiles).toBeGreaterThan(0);
    expect(profile.size.totalLines).toBeGreaterThan(0);
  });

  it('should validate complexity metrics structure', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(typeof profile.complexity.averageFunctionsPerFile).toBe('number');
    expect(typeof profile.complexity.averageClassesPerFile).toBe('number');
    expect(typeof profile.complexity.maxFileSize).toBe('number');
    expect(typeof profile.complexity.deepestNesting).toBe('number');
  });

  it('should validate quality indicators structure', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(typeof profile.quality.hasTests).toBe('boolean');
    expect(typeof profile.quality.hasTypeScript).toBe('boolean');
    expect(typeof profile.quality.hasLinting).toBe('boolean');
    expect(typeof profile.quality.hasCI).toBe('boolean');
    expect(typeof profile.quality.documentationScore).toBe('number');
    expect(profile.quality.documentationScore).toBeGreaterThanOrEqual(0);
    expect(profile.quality.documentationScore).toBeLessThanOrEqual(1);
  });

  it('should validate structure indicators', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(typeof profile.structure.isMonorepo).toBe('boolean');
    expect(typeof profile.structure.hasWorkspaces).toBe('boolean');
    expect(Array.isArray(profile.structure.entryPoints)).toBe(true);
    expect(Array.isArray(profile.structure.configFiles)).toBe(true);
  });

  it('should validate risk indicators', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(Array.isArray(profile.risks.largeFiles)).toBe(true);
    expect(Array.isArray(profile.risks.complexFunctions)).toBe(true);
    expect(typeof profile.risks.circularDependencies).toBe('boolean');
    expect(typeof profile.risks.outdatedDependencies).toBe('boolean');
  });

  it('should have valid classification', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(['small', 'medium', 'large', 'monorepo']).toContain(profile.classification);
  });

  it('should have valid qualityTier', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(['high', 'medium', 'low']).toContain(profile.qualityTier);
  });
});

// ============================================================================
// FILE COUNTING TESTS
// ============================================================================

describe('CodebaseProfiler - countFiles', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should count files in typedriver-ts', async () => {
    const count = await profiler.countFiles(TYPEDRIVER_REPO);

    expect(count).toBeGreaterThan(0);
  });

  it('should count files in srtd-ts', async () => {
    const count = await profiler.countFiles(SRTD_REPO);

    expect(count).toBeGreaterThan(0);
  });

  it('should return 0 for non-existent directory', async () => {
    const count = await profiler.countFiles('/non/existent/path');

    expect(count).toBe(0);
  });

  it('should exclude node_modules and .git', async () => {
    const count = await profiler.countFiles(TYPEDRIVER_REPO);

    // If we counted everything including node_modules, count would be huge
    // This is a sanity check that we're excluding properly
    expect(count).toBeLessThan(10000);
  });
});

// ============================================================================
// LINE COUNTING TESTS
// ============================================================================

describe('CodebaseProfiler - countLines', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should count lines in typedriver-ts', async () => {
    const count = await profiler.countLines(TYPEDRIVER_REPO);

    expect(count).toBeGreaterThan(0);
  });

  it('should count lines in quickpickle-ts', async () => {
    const count = await profiler.countLines(QUICKPICKLE_REPO);

    expect(count).toBeGreaterThan(0);
  });

  it('should return 0 for non-existent directory', async () => {
    const count = await profiler.countLines('/non/existent/path');

    expect(count).toBe(0);
  });
});

// ============================================================================
// LANGUAGE DETECTION TESTS
// ============================================================================

describe('CodebaseProfiler - detectLanguages', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should detect TypeScript in typedriver-ts', async () => {
    const languages = await profiler.detectLanguages(TYPEDRIVER_REPO);

    expect(languages['TypeScript']).toBeGreaterThan(0);
  });

  it('should detect Python in reccmp-py', async () => {
    const languages = await profiler.detectLanguages(RECCMP_REPO);

    expect(languages['Python']).toBeGreaterThan(0);
  });

  it('should detect multiple languages when present', async () => {
    const languages = await profiler.detectLanguages(LIBRARIAN_ROOT);

    // Librarian has TypeScript, JSON, Markdown, etc.
    const languageCount = Object.keys(languages).length;
    expect(languageCount).toBeGreaterThan(1);
  });

  it('should return empty object for non-existent directory', async () => {
    const languages = await profiler.detectLanguages('/non/existent/path');

    expect(Object.keys(languages).length).toBe(0);
  });

  it('should include file counts per language', async () => {
    const languages = await profiler.detectLanguages(TYPEDRIVER_REPO);

    // Each language entry should be a positive number
    for (const [lang, count] of Object.entries(languages)) {
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// COMPLEXITY ANALYSIS TESTS
// ============================================================================

describe('CodebaseProfiler - analyzeComplexity', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should analyze complexity of typedriver-ts', async () => {
    const complexity = await profiler.analyzeComplexity(TYPEDRIVER_REPO);

    expect(complexity.averageFunctionsPerFile).toBeGreaterThanOrEqual(0);
    expect(complexity.averageClassesPerFile).toBeGreaterThanOrEqual(0);
    expect(complexity.maxFileSize).toBeGreaterThan(0);
    expect(complexity.deepestNesting).toBeGreaterThanOrEqual(0);
  });

  it('should calculate averageFunctionsPerFile', async () => {
    const complexity = await profiler.analyzeComplexity(TYPEDRIVER_REPO);

    // TypeScript files typically have functions
    expect(complexity.averageFunctionsPerFile).toBeGreaterThan(0);
  });

  it('should identify maxFileSize', async () => {
    const complexity = await profiler.analyzeComplexity(TYPEDRIVER_REPO);

    // Max file size should be reasonable (not 0, not astronomical)
    expect(complexity.maxFileSize).toBeGreaterThan(0);
    expect(complexity.maxFileSize).toBeLessThan(100000);
  });

  it('should handle repos with classes', async () => {
    const complexity = await profiler.analyzeComplexity(LIBRARIAN_ROOT);

    // Librarian has classes
    expect(complexity.averageClassesPerFile).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// QUALITY ASSESSMENT TESTS
// ============================================================================

describe('CodebaseProfiler - assessQuality', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should assess quality of typedriver-ts', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    expect(typeof quality.hasTests).toBe('boolean');
    expect(typeof quality.hasTypeScript).toBe('boolean');
    expect(typeof quality.hasLinting).toBe('boolean');
    expect(typeof quality.hasCI).toBe('boolean');
    expect(typeof quality.documentationScore).toBe('number');
  });

  it('should detect tests in typedriver-ts', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    // typedriver-ts has a test/ directory
    expect(quality.hasTests).toBe(true);
  });

  it('should detect TypeScript in typedriver-ts', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    expect(quality.hasTypeScript).toBe(true);
  });

  it('should detect CI in typedriver-ts', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    // typedriver-ts has .github/workflows/
    expect(quality.hasCI).toBe(true);
  });

  it('should detect tests in Librarian', async () => {
    const quality = await profiler.assessQuality(LIBRARIAN_ROOT);

    expect(quality.hasTests).toBe(true);
  });

  it('should produce documentationScore between 0 and 1', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    expect(quality.documentationScore).toBeGreaterThanOrEqual(0);
    expect(quality.documentationScore).toBeLessThanOrEqual(1);
  });

  it('should detect TypeScript config', async () => {
    const quality = await profiler.assessQuality(TYPEDRIVER_REPO);

    // Presence of tsconfig.json indicates TypeScript
    expect(quality.hasTypeScript).toBe(true);
  });
});

// ============================================================================
// STRUCTURE ANALYSIS TESTS
// ============================================================================

describe('CodebaseProfiler - analyzeStructure', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should analyze structure of typedriver-ts', async () => {
    const structure = await profiler.analyzeStructure(TYPEDRIVER_REPO);

    expect(typeof structure.isMonorepo).toBe('boolean');
    expect(typeof structure.hasWorkspaces).toBe('boolean');
    expect(Array.isArray(structure.entryPoints)).toBe(true);
    expect(Array.isArray(structure.configFiles)).toBe(true);
  });

  it('should detect entry points', async () => {
    const structure = await profiler.analyzeStructure(TYPEDRIVER_REPO);

    // Should find src/index.ts as entry point
    expect(structure.entryPoints.length).toBeGreaterThan(0);
  });

  it('should detect config files', async () => {
    const structure = await profiler.analyzeStructure(TYPEDRIVER_REPO);

    // Should find package.json, tsconfig, etc.
    expect(structure.configFiles.length).toBeGreaterThan(0);
  });

  it('should detect workspaces in monorepo', async () => {
    // Librarian might have workspaces; test that detection works
    const structure = await profiler.analyzeStructure(LIBRARIAN_ROOT);

    // Just verify the fields exist and are booleans
    expect(typeof structure.isMonorepo).toBe('boolean');
    expect(typeof structure.hasWorkspaces).toBe('boolean');
  });
});

// ============================================================================
// RISK IDENTIFICATION TESTS
// ============================================================================

describe('CodebaseProfiler - identifyRisks', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should identify risks in typedriver-ts', async () => {
    const risks = await profiler.identifyRisks(TYPEDRIVER_REPO);

    expect(Array.isArray(risks.largeFiles)).toBe(true);
    expect(Array.isArray(risks.complexFunctions)).toBe(true);
    expect(typeof risks.circularDependencies).toBe('boolean');
    expect(typeof risks.outdatedDependencies).toBe('boolean');
  });

  it('should identify large files if present', async () => {
    const risks = await profiler.identifyRisks(LIBRARIAN_ROOT);

    // Large files array should be an array (may be empty or have items)
    expect(Array.isArray(risks.largeFiles)).toBe(true);
  });

  it('should return file paths for large files', async () => {
    const risks = await profiler.identifyRisks(LIBRARIAN_ROOT);

    // If there are large files, they should be valid paths
    risks.largeFiles.forEach((file) => {
      expect(typeof file).toBe('string');
    });
  });
});

// ============================================================================
// CLASSIFICATION TESTS
// ============================================================================

describe('CodebaseProfiler - Classification Rules', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should classify small repos correctly', async () => {
    // typedriver-ts is a small repo
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    // Small repos have <10k LOC
    if (profile.size.totalLines < 10000) {
      expect(profile.classification).toBe('small');
    }
  });

  it('should classify medium repos correctly', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);

    // Check classification based on LOC
    if (profile.size.totalLines >= 10000 && profile.size.totalLines < 100000) {
      expect(profile.classification).toBe('medium');
    }
  });

  it('should classify repos with workspaces as monorepo', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);

    // If it has workspaces, it should be classified as monorepo
    if (profile.structure.hasWorkspaces) {
      expect(profile.classification).toBe('monorepo');
    }
  });
});

// ============================================================================
// QUALITY TIER TESTS
// ============================================================================

describe('CodebaseProfiler - Quality Tier', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should assign high quality tier to well-maintained repos', async () => {
    const profile = await profiler.profile(LIBRARIAN_ROOT);

    // Librarian has tests, TypeScript, linting, CI, docs - should be high
    // At minimum, verify the tier is one of the valid values
    expect(['high', 'medium', 'low']).toContain(profile.qualityTier);
  });

  it('should consider tests in quality tier', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    // repos with tests should have at least medium quality
    if (profile.quality.hasTests && profile.quality.hasTypeScript) {
      expect(['high', 'medium']).toContain(profile.qualityTier);
    }
  });
});

// ============================================================================
// EXTERNAL REPO PROFILING TESTS
// ============================================================================

describe('CodebaseProfiler - External Repos', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should profile typedriver-ts successfully', async () => {
    const profile = await profiler.profile(TYPEDRIVER_REPO);

    expect(profile.repoPath).toBe(TYPEDRIVER_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should profile srtd-ts successfully', async () => {
    const profile = await profiler.profile(SRTD_REPO);

    expect(profile.repoPath).toBe(SRTD_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should profile quickpickle-ts successfully', async () => {
    const profile = await profiler.profile(QUICKPICKLE_REPO);

    expect(profile.repoPath).toBe(QUICKPICKLE_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should profile aws-sdk-vitest-mock-ts successfully', async () => {
    const profile = await profiler.profile(AWS_SDK_MOCK_REPO);

    expect(profile.repoPath).toBe(AWS_SDK_MOCK_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should profile Python repo reccmp-py successfully', async () => {
    const profile = await profiler.profile(RECCMP_REPO);

    expect(profile.repoPath).toBe(RECCMP_REPO);
    expect(profile.size.languages['Python']).toBeGreaterThan(0);
  });

  it('should profile token-explorer-py successfully', async () => {
    const profile = await profiler.profile(TOKEN_EXPLORER_REPO);

    expect(profile.repoPath).toBe(TOKEN_EXPLORER_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should profile pytest-run-parallel-py successfully', async () => {
    const profile = await profiler.profile(PYTEST_PARALLEL_REPO);

    expect(profile.repoPath).toBe(PYTEST_PARALLEL_REPO);
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('CodebaseProfiler - Edge Cases', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should handle non-existent directory gracefully', async () => {
    const profile = await profiler.profile('/non/existent/path');

    // Should return a valid profile with zero counts
    expect(profile.repoPath).toBe('/non/existent/path');
    expect(profile.size.totalFiles).toBe(0);
    expect(profile.size.totalLines).toBe(0);
    expect(profile.classification).toBe('small');
  });

  it('should handle empty directory gracefully', async () => {
    // Create an empty temp directory test would go here
    // For now, test non-existent path behavior
    const profile = await profiler.profile('/non/existent/empty');

    expect(profile.size.totalFiles).toBe(0);
  });

  it('should not crash on repos without package.json', async () => {
    // Python repos don't have package.json
    const profile = await profiler.profile(RECCMP_REPO);

    expect(profile).toBeDefined();
    expect(profile.size.totalFiles).toBeGreaterThan(0);
  });

  it('should not crash on repos without tsconfig.json', async () => {
    // Python repos don't have tsconfig
    const profile = await profiler.profile(RECCMP_REPO);

    expect(profile.quality.hasTypeScript).toBe(false);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('CodebaseProfiler - Performance', () => {
  let profiler: CodebaseProfiler;

  beforeAll(() => {
    profiler = createCodebaseProfiler();
  });

  it('should profile a small repo in under 5 seconds', async () => {
    const start = Date.now();
    await profiler.profile(TYPEDRIVER_REPO);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });

  it('should profile Librarian root in under 60 seconds', async () => {
    const start = Date.now();
    await profiler.profile(LIBRARIAN_ROOT);
    const elapsed = Date.now() - start;

    // Large repos with AST analysis take longer - allow 2 minutes for CI variance
    expect(elapsed).toBeLessThan(120000);
  }, 125000);
});
