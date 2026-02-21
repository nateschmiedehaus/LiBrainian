/**
 * @fileoverview Tests for dependency management support system
 *
 * Tests the dependency analysis capabilities including:
 * - Query pattern detection
 * - Direct/dev dependency analysis
 * - Unused dependency detection
 * - Duplicate dependency detection
 * - Outdated dependency checking
 * - Issue detection
 * - Recommendation generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  isDependencyManagementQuery,
  extractDependencyAction,
  analyzeDependencies,
  summarizeDependencies,
  briefSummary,
  getTopDependencies,
  getLowUsageDependencies,
  DEPENDENCY_MANAGEMENT_PATTERNS,
  type DependencyAnalysis,
  type DependencyInfo,
} from '../dependency_management.js';
import type { LiBrainianStorage, FileKnowledge } from '../../storage/types.js';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

function createMockStorage(files: FileKnowledge[] = []): LiBrainianStorage {
  return {
    getFiles: vi.fn().mockResolvedValue(files),
    // Add other required storage methods as needed
    getFileContent: vi.fn().mockResolvedValue(''),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// QUERY PATTERN TESTS
// ============================================================================

describe('isDependencyManagementQuery', () => {
  describe('positive matches', () => {
    const positiveQueries = [
      'analyze dependencies',
      'analyze deps',
      'dependency analysis',
      'check for unused packages',
      'find unused dependencies',
      'find orphaned packages',
      'show outdated dependencies',
      'list outdated packages',
      'get old dependencies',
      'dependency audit',
      'dependency issues',
      'what packages are unused',
      'what dependencies are outdated',
      'npm audit',
      'yarn outdated',
      'pnpm unused',
      'duplicate packages',
      'duplicate dependencies',
      'security check for packages',
      'vulnerability scan for dependencies',
      'check package security',
      'check dependency vulnerabilities',
    ];

    it.each(positiveQueries)('should match: "%s"', (query) => {
      expect(isDependencyManagementQuery(query)).toBe(true);
    });
  });

  describe('negative matches', () => {
    const negativeQueries = [
      'what does this function do',
      'find all imports',
      'show me the storage module',
      'how do I use the query API',
      'what files import utils',
      'create a new component',
      'refactor this code',
    ];

    it.each(negativeQueries)('should not match: "%s"', (query) => {
      expect(isDependencyManagementQuery(query)).toBe(false);
    });
  });
});

describe('extractDependencyAction', () => {
  it('should extract "unused" action', () => {
    expect(extractDependencyAction('find unused packages')).toBe('unused');
    expect(extractDependencyAction('check for orphaned dependencies')).toBe('unused');
  });

  it('should extract "outdated" action', () => {
    expect(extractDependencyAction('show outdated packages')).toBe('outdated');
    expect(extractDependencyAction('list old dependencies')).toBe('outdated');
    expect(extractDependencyAction('update check')).toBe('outdated');
  });

  it('should extract "duplicates" action', () => {
    expect(extractDependencyAction('find duplicate packages')).toBe('duplicates');
    expect(extractDependencyAction('show duplicate dependencies')).toBe('duplicates');
  });

  it('should extract "issues" action', () => {
    expect(extractDependencyAction('show dependency issues')).toBe('issues');
    expect(extractDependencyAction('find problems with packages')).toBe('issues');
    expect(extractDependencyAction('security vulnerabilities')).toBe('issues');
  });

  it('should extract "all" for general analysis queries', () => {
    expect(extractDependencyAction('analyze dependencies')).toBe('all');
    expect(extractDependencyAction('dependency analysis')).toBe('all');
    expect(extractDependencyAction('audit packages')).toBe('all');
    expect(extractDependencyAction('check dependencies')).toBe('all');
  });
});

// ============================================================================
// DEPENDENCY ANALYSIS TESTS
// ============================================================================

describe('analyzeDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty analysis when package.json does not exist', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const storage = createMockStorage();
    const result = await analyzeDependencies('/test/workspace', storage);

    expect(result.direct).toEqual([]);
    expect(result.dev).toEqual([]);
    expect(result.unused).toEqual([]);
    expect(result.outdated).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it('should analyze direct dependencies', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    // Mock package.json
    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: {
            'lodash': '^4.17.21',
            'express': '^4.18.0',
          },
          devDependencies: {
            'typescript': '^5.0.0',
          },
        });
      }
      if (p.endsWith('package-lock.json')) {
        return JSON.stringify({ packages: {} });
      }
      if (p.endsWith('.ts')) {
        return `import express from 'express';\nimport _ from 'lodash';`;
      }
      throw new Error('ENOENT');
    });

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue('{}');

    const storage = createMockStorage([
      { id: '1', path: '/test/workspace/src/app.ts' } as FileKnowledge,
    ]);

    const result = await analyzeDependencies('/test/workspace', storage);

    expect(result.direct.length).toBe(2);
    expect(result.dev.length).toBe(1);

    const expressInfo = result.direct.find(d => d.name === 'express');
    expect(expressInfo).toBeDefined();
    expect(expressInfo?.type).toBe('runtime');
  });

  it('should detect unused dependencies', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: {
            'lodash': '^4.17.21',
            'unused-package': '^1.0.0',
          },
        });
      }
      if (p.endsWith('package-lock.json')) {
        return JSON.stringify({ packages: {} });
      }
      if (p.endsWith('.ts')) {
        return `import _ from 'lodash';`;
      }
      throw new Error('ENOENT');
    });

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue('{}');

    const storage = createMockStorage([
      { id: '1', path: '/test/workspace/src/app.ts' } as FileKnowledge,
    ]);

    const result = await analyzeDependencies('/test/workspace', storage);

    expect(result.unused).toContain('unused-package');
    expect(result.unused).not.toContain('lodash');
  });

  it('should detect duplicate packages', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    const lockFileContent = JSON.stringify({
      packages: {
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/some-pkg/node_modules/lodash': { version: '4.17.15' },
      },
    });

    mockReadFile.mockImplementation((async (filePath: fs.PathLike, _options?: unknown) => {
      const p = filePath.toString();
      if (p.endsWith('package.json') && !p.includes('lock')) {
        return JSON.stringify({ dependencies: {} });
      }
      if (p.endsWith('package-lock.json')) {
        return lockFileContent;
      }
      throw new Error('ENOENT');
    }) as typeof fs.promises.readFile);

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue('{}');

    const storage = createMockStorage();
    const result = await analyzeDependencies('/test/workspace', storage);

    expect(result.duplicates.length).toBe(1);
    expect(result.duplicates[0].name).toBe('lodash');
    expect(result.duplicates[0].versions).toContain('4.17.21');
    expect(result.duplicates[0].versions).toContain('4.17.15');
  });

  it('should detect outdated packages', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: { 'lodash': '^4.0.0' },
        });
      }
      if (p.endsWith('package-lock.json')) {
        return JSON.stringify({ packages: {} });
      }
      throw new Error('ENOENT');
    });

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue(JSON.stringify({
      lodash: {
        current: '4.0.0',
        wanted: '4.17.21',
        latest: '4.17.21',
      },
    }));

    const storage = createMockStorage();
    const result = await analyzeDependencies('/test/workspace', storage);

    expect(result.outdated.length).toBe(1);
    expect(result.outdated[0].name).toBe('lodash');
    expect(result.outdated[0].current).toBe('4.0.0');
    expect(result.outdated[0].latest).toBe('4.17.21');
    expect(result.outdated[0].updateType).toBe('minor');
  });

  it('should detect known problematic packages', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: {
            'request': '^2.88.0',
            'moment': '^2.29.0',
          },
        });
      }
      if (p.endsWith('package-lock.json')) {
        return JSON.stringify({ packages: {} });
      }
      throw new Error('ENOENT');
    });

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue('{}');

    const storage = createMockStorage();
    const result = await analyzeDependencies('/test/workspace', storage);

    const requestIssue = result.issues.find(i => i.package === 'request');
    const momentIssue = result.issues.find(i => i.package === 'moment');

    expect(requestIssue).toBeDefined();
    expect(requestIssue?.severity).toBe('high');
    expect(momentIssue).toBeDefined();
    expect(momentIssue?.severity).toBe('low');
  });

  it('should generate recommendations', async () => {
    const mockReadFile = vi.mocked(fs.promises.readFile);

    mockReadFile.mockImplementation(async (filePath) => {
      const p = filePath.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: {
            'unused-pkg': '^1.0.0',
            'request': '^2.88.0',
          },
        });
      }
      if (p.endsWith('package-lock.json')) {
        return JSON.stringify({ packages: {} });
      }
      throw new Error('ENOENT');
    });

    const mockExec = vi.mocked(execSync);
    mockExec.mockReturnValue('{}');

    const storage = createMockStorage();
    const result = await analyzeDependencies('/test/workspace', storage);

    // Should recommend removing unused
    const removeRec = result.recommendations.find(r => r.type === 'remove');
    expect(removeRec).toBeDefined();

    // Should recommend fixing issues
    const fixRec = result.recommendations.find(r => r.package === 'request');
    expect(fixRec).toBeDefined();
  });
});

// ============================================================================
// SUMMARY GENERATION TESTS
// ============================================================================

describe('summarizeDependencies', () => {
  it('should generate a comprehensive summary', () => {
    const analysis: DependencyAnalysis = {
      direct: [
        { name: 'express', version: '^4.18.0', type: 'runtime', usedIn: ['app.ts'], importCount: 5 },
        { name: 'lodash', version: '^4.17.21', type: 'runtime', usedIn: ['utils.ts'], importCount: 10 },
      ],
      dev: [
        { name: 'typescript', version: '^5.0.0', type: 'dev', usedIn: [], importCount: 0 },
      ],
      transitive: [],
      unused: ['unused-pkg'],
      duplicates: [
        { name: 'lodash', versions: ['4.17.21', '4.17.15'], locations: [], recommendation: 'dedupe' },
      ],
      outdated: [
        { name: 'express', current: '4.17.0', latest: '4.18.0', latestStable: '4.18.0', updateType: 'minor', breaking: false },
      ],
      issues: [
        { type: 'deprecated', package: 'request', severity: 'high', description: 'Deprecated', fix: 'Use axios' },
      ],
      recommendations: [
        { type: 'remove', package: 'unused-pkg', reason: 'Unused', command: 'npm uninstall unused-pkg' },
      ],
    };

    const summary = summarizeDependencies(analysis);

    expect(summary).toContain('Dependencies:');
    expect(summary).toContain('2 runtime');
    expect(summary).toContain('1 dev');
    expect(summary).toContain('Unused Dependencies');
    expect(summary).toContain('unused-pkg');
    expect(summary).toContain('Outdated Packages');
    expect(summary).toContain('Duplicate Packages');
    expect(summary).toContain('Issues Found');
    expect(summary).toContain('Recommendations');
  });

  it('should handle empty analysis', () => {
    const analysis: DependencyAnalysis = {
      direct: [],
      dev: [],
      transitive: [],
      unused: [],
      duplicates: [],
      outdated: [],
      issues: [],
      recommendations: [],
    };

    const summary = summarizeDependencies(analysis);

    expect(summary).toContain('Dependencies:');
    expect(summary).toContain('0 runtime');
    expect(summary).toContain('0 dev');
    expect(summary).not.toContain('Unused Dependencies');
    expect(summary).not.toContain('Issues Found');
  });
});

describe('briefSummary', () => {
  it('should generate a one-line summary', () => {
    const analysis: DependencyAnalysis = {
      direct: [{ name: 'a', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 1 }],
      dev: [{ name: 'b', version: '1.0.0', type: 'dev', usedIn: [], importCount: 0 }],
      transitive: [],
      unused: ['c', 'd'],
      duplicates: [],
      outdated: [
        { name: 'e', current: '1.0.0', latest: '2.0.0', latestStable: '2.0.0', updateType: 'major', breaking: true },
      ],
      issues: [{ type: 'security', package: 'f', severity: 'critical', description: 'vuln' }],
      recommendations: [],
    };

    const summary = briefSummary(analysis);

    expect(summary).toContain('2 deps');
    expect(summary).toContain('2 unused');
    expect(summary).toContain('1 outdated');
    expect(summary).toContain('1 major');
    expect(summary).toContain('1 issues');
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('getTopDependencies', () => {
  it('should return most used dependencies', () => {
    const analysis: DependencyAnalysis = {
      direct: [
        { name: 'a', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 5 },
        { name: 'b', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 10 },
        { name: 'c', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 2 },
      ],
      dev: [
        { name: 'd', version: '1.0.0', type: 'dev', usedIn: [], importCount: 15 },
      ],
      transitive: [],
      unused: [],
      duplicates: [],
      outdated: [],
      issues: [],
      recommendations: [],
    };

    const top = getTopDependencies(analysis, 2);

    expect(top.length).toBe(2);
    expect(top[0].name).toBe('d');
    expect(top[1].name).toBe('b');
  });
});

describe('getLowUsageDependencies', () => {
  it('should return dependencies with low usage', () => {
    const analysis: DependencyAnalysis = {
      direct: [
        { name: 'a', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 1 },
        { name: 'b', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 10 },
        { name: 'c', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 2 },
        { name: 'd', version: '1.0.0', type: 'runtime', usedIn: [], importCount: 0 },
      ],
      dev: [],
      transitive: [],
      unused: [],
      duplicates: [],
      outdated: [],
      issues: [],
      recommendations: [],
    };

    const lowUsage = getLowUsageDependencies(analysis, 2);

    expect(lowUsage.length).toBe(2);
    expect(lowUsage.map(d => d.name)).toContain('a');
    expect(lowUsage.map(d => d.name)).toContain('c');
    expect(lowUsage.map(d => d.name)).not.toContain('d'); // 0 imports = truly unused
  });
});

// ============================================================================
// PATTERN COVERAGE TESTS
// ============================================================================

describe('DEPENDENCY_MANAGEMENT_PATTERNS', () => {
  it('should have sufficient pattern coverage', () => {
    expect(DEPENDENCY_MANAGEMENT_PATTERNS.length).toBeGreaterThanOrEqual(10);
  });

  it('should all be valid regex patterns', () => {
    for (const pattern of DEPENDENCY_MANAGEMENT_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
      // Should not throw when testing
      expect(() => pattern.test('test string')).not.toThrow();
    }
  });
});
