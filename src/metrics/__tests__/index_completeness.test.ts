/**
 * @fileoverview Tests for Index Completeness Metrics
 *
 * Tests the calculation and reporting of index completeness metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  calculateIndexCompleteness,
  formatCompletenessReport,
  exportPrometheusMetrics,
  type IndexCompletenessReport,
} from '../index_completeness.js';
import type { LiBrainianStorage, FileKnowledge, IndexingResult } from '../../storage/types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(
  files: FileKnowledge[] = [],
  lastIndexResult: IndexingResult | null = null
): LiBrainianStorage {
  return {
    getFiles: vi.fn().mockResolvedValue(files),
    getLastIndexingResult: vi.fn().mockResolvedValue(lastIndexResult),
    // Add minimal required methods
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({ core: {}, optional: {}, versions: {} }),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTempWorkspace(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-completeness-test-'));

  // Create some source files
  const srcDir = path.join(tempDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // TypeScript files
  fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(srcDir, 'utils.ts'), 'export function util() {}');
  fs.writeFileSync(path.join(srcDir, 'types.ts'), 'export type T = string;');

  // JavaScript file
  fs.writeFileSync(path.join(srcDir, 'legacy.js'), 'module.exports = {};');

  // Nested directory
  const libDir = path.join(srcDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, 'helper.ts'), 'export function help() {}');

  // Ignored directory (node_modules)
  const nodeModulesDir = path.join(tempDir, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.writeFileSync(path.join(nodeModulesDir, 'dep.js'), 'ignored');

  return tempDir;
}

function cleanupTempWorkspace(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('calculateIndexCompleteness', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(tempDir);
  });

  it('calculates completeness for empty index', async () => {
    const storage = createMockStorage();
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.totalFiles).toBe(5); // 4 TS + 1 JS files
    expect(report.indexedFiles).toBe(0);
    expect(report.completeness).toBe(0);
    expect(report.missingFiles.length).toBe(5);
  });

  it('calculates completeness for fully indexed workspace', async () => {
    const now = new Date();
    const files: FileKnowledge[] = [
      { id: '1', path: path.join(tempDir, 'src/index.ts'), name: 'index.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
      { id: '2', path: path.join(tempDir, 'src/utils.ts'), name: 'utils.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
      { id: '3', path: path.join(tempDir, 'src/types.ts'), name: 'types.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
      { id: '4', path: path.join(tempDir, 'src/legacy.js'), name: 'legacy.js', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
      { id: '5', path: path.join(tempDir, 'src/lib/helper.ts'), name: 'helper.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
    ];

    const storage = createMockStorage(files);
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.totalFiles).toBe(5);
    expect(report.indexedFiles).toBe(5);
    expect(report.completeness).toBe(1);
    expect(report.missingFiles.length).toBe(0);
  });

  it('detects stale files', async () => {
    // Index the file first
    const oldDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const files: FileKnowledge[] = [
      { id: '1', path: path.join(tempDir, 'src/index.ts'), name: 'index.ts', lastIndexed: oldDate.toISOString(), confidence: 0.9 } as FileKnowledge,
    ];

    // Modify the file to make it stale
    const indexPath = path.join(tempDir, 'src/index.ts');
    fs.writeFileSync(indexPath, 'export const x = 2; // modified');

    const storage = createMockStorage(files);
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.staleFiles.length).toBe(1);
    expect(report.staleFiles[0].path).toContain('index.ts');
    expect(report.staleFiles[0].stalenessMs).toBeGreaterThan(0);
  });

  it('calculates metrics by extension', async () => {
    const now = new Date();
    const files: FileKnowledge[] = [
      { id: '1', path: path.join(tempDir, 'src/index.ts'), name: 'index.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
      { id: '2', path: path.join(tempDir, 'src/utils.ts'), name: 'utils.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
    ];

    const storage = createMockStorage(files);
    const report = await calculateIndexCompleteness(tempDir, storage);

    // 4 TS files total, 2 indexed
    expect(report.byExtension['ts'].total).toBe(4);
    expect(report.byExtension['ts'].indexed).toBe(2);
    expect(report.byExtension['ts'].completeness).toBe(0.5);

    // 1 JS file, 0 indexed
    expect(report.byExtension['js'].total).toBe(1);
    expect(report.byExtension['js'].indexed).toBe(0);
    expect(report.byExtension['js'].completeness).toBe(0);
  });

  it('calculates metrics by directory', async () => {
    const now = new Date();
    const files: FileKnowledge[] = [
      { id: '1', path: path.join(tempDir, 'src/index.ts'), name: 'index.ts', lastIndexed: now.toISOString(), confidence: 0.9 } as FileKnowledge,
    ];

    const storage = createMockStorage(files);
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.byDirectory['src']).toBeDefined();
    expect(report.byDirectory['src'].total).toBeGreaterThan(0);
  });

  it('includes index age from last indexing result', async () => {
    const oneHourAgo = new Date(Date.now() - 1000 * 60 * 60);
    const lastIndexResult: IndexingResult = {
      startedAt: oneHourAgo.toISOString(),
      completedAt: oneHourAgo.toISOString(),
      filesProcessed: 5,
      filesSkipped: 0,
      errors: [],
      duration: 1000,
    };

    const storage = createMockStorage([], lastIndexResult);
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.lastIndexTime).toBeDefined();
    expect(report.indexAge).toBeGreaterThan(0);
    expect(report.indexAge).toBeLessThan(2 * 60 * 60 * 1000); // Less than 2 hours
  });

  it('generates recommendations for low completeness', async () => {
    const storage = createMockStorage();
    const report = await calculateIndexCompleteness(tempDir, storage);

    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.some(r => r.includes('bootstrap'))).toBe(true);
  });

  it('respects custom extensions option', async () => {
    const storage = createMockStorage();
    const report = await calculateIndexCompleteness(tempDir, storage, {
      extensions: ['ts'], // Only TypeScript files
    });

    expect(report.totalFiles).toBe(4); // Only TS files
    expect(report.byExtension['js']).toBeUndefined();
  });
});

describe('formatCompletenessReport', () => {
  it('formats report for text output', () => {
    const report: IndexCompletenessReport = {
      totalFiles: 100,
      indexedFiles: 80,
      completeness: 0.8,
      missingFiles: ['file1.ts', 'file2.ts'],
      staleFiles: [],
      indexAge: 3600000, // 1 hour
      lastIndexTime: new Date(),
      byExtension: {
        ts: { total: 80, indexed: 70, completeness: 0.875 },
        js: { total: 20, indexed: 10, completeness: 0.5 },
      },
      byDirectory: {
        src: { total: 100, indexed: 80, completeness: 0.8 },
      },
      recommendations: ['Run bootstrap to improve coverage'],
      generatedAt: new Date(),
    };

    const output = formatCompletenessReport(report);

    expect(output).toContain('Index Completeness Report');
    expect(output).toContain('80.0% complete');
    expect(output).toContain('80 / 100 indexed');
    expect(output).toContain('Recommendations:');
  });

  it('includes verbose details when requested', () => {
    const report: IndexCompletenessReport = {
      totalFiles: 10,
      indexedFiles: 8,
      completeness: 0.8,
      missingFiles: ['missing.ts'],
      staleFiles: [
        {
          path: 'stale.ts',
          indexedAt: new Date(Date.now() - 3600000),
          modifiedAt: new Date(),
          stalenessMs: 3600000,
        },
      ],
      indexAge: 3600000,
      lastIndexTime: new Date(),
      byExtension: { ts: { total: 10, indexed: 8, completeness: 0.8 } },
      byDirectory: { src: { total: 10, indexed: 8, completeness: 0.8 } },
      recommendations: [],
      generatedAt: new Date(),
    };

    const output = formatCompletenessReport(report, true);

    expect(output).toContain('Coverage by Extension');
    expect(output).toContain('Coverage by Directory');
    expect(output).toContain('Most Stale Files');
    expect(output).toContain('stale.ts');
  });
});

describe('exportPrometheusMetrics', () => {
  it('exports metrics in Prometheus format', () => {
    const report: IndexCompletenessReport = {
      totalFiles: 100,
      indexedFiles: 80,
      completeness: 0.8,
      missingFiles: Array(20).fill('missing.ts'),
      staleFiles: Array(5).fill({
        path: 'stale.ts',
        indexedAt: new Date(),
        modifiedAt: new Date(),
        stalenessMs: 1000,
      }),
      indexAge: 3600000,
      lastIndexTime: new Date(),
      byExtension: {
        ts: { total: 80, indexed: 70, completeness: 0.875 },
      },
      byDirectory: {},
      recommendations: [],
      generatedAt: new Date(),
    };

    const output = exportPrometheusMetrics(report);

    expect(output).toContain('librainian_index_completeness_ratio 0.8000');
    expect(output).toContain('librainian_index_total_files 100');
    expect(output).toContain('librainian_index_indexed_files 80');
    expect(output).toContain('librainian_index_missing_files 20');
    expect(output).toContain('librainian_index_stale_files 5');
    expect(output).toContain('librainian_index_age_seconds 3600');
    expect(output).toContain('librainian_index_extension_completeness{extension="ts"} 0.8750');
  });

  it('supports custom metric prefix', () => {
    const report: IndexCompletenessReport = {
      totalFiles: 10,
      indexedFiles: 10,
      completeness: 1,
      missingFiles: [],
      staleFiles: [],
      indexAge: 0,
      lastIndexTime: new Date(),
      byExtension: {},
      byDirectory: {},
      recommendations: [],
      generatedAt: new Date(),
    };

    const output = exportPrometheusMetrics(report, 'custom_prefix');

    expect(output).toContain('custom_prefix_completeness_ratio');
    expect(output).toContain('custom_prefix_total_files');
  });
});
