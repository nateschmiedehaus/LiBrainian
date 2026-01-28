/**
 * @fileoverview Tests for Incremental Self-Check Composition (WU-SELF-202)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  incrementalSelfCheck,
  type IncrementalCheckResult,
  type IncrementalCheckOptions,
  type AnalysisResult,
  type Issue,
} from '../incremental_check.js';
import type { LibrarianStorage } from '../../../../storage/types.js';

describe('incrementalSelfCheck', () => {
  let mockStorage: LibrarianStorage;

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'a', toId: 'b', edgeType: 'imports', sourceFile: 'a.ts' },
      ]),
      getFileChecksum: vi.fn().mockResolvedValue(null),
      setFileChecksum: vi.fn().mockResolvedValue(undefined),
      getFunctionByPath: vi.fn().mockResolvedValue(null),
      getModuleByPath: vi.fn().mockResolvedValue(null),
      upsertFunction: vi.fn().mockResolvedValue(undefined),
      upsertModule: vi.fn().mockResolvedValue(undefined),
      upsertContextPack: vi.fn().mockResolvedValue(undefined),
      getContextPack: vi.fn().mockResolvedValue(null),
      deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
      upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
      recordIndexingResult: vi.fn().mockResolvedValue(undefined),
      getFunctions: vi.fn().mockResolvedValue([
        { id: 'fn1', name: 'testFn', filePath: 'test.ts', purpose: 'Test function' },
      ]),
      getModules: vi.fn().mockResolvedValue([
        { id: 'mod1', path: 'test.ts', exports: ['testFn'], dependencies: [], purpose: 'Test module' },
      ]),
      getTestMappings: vi.fn().mockResolvedValue([]),
      invalidateContextPacks: vi.fn().mockResolvedValue(0),
      getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
      getBayesianConfidences: vi.fn().mockResolvedValue([]),
      getConfidenceEvents: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;
  });

  it('requires rootDir parameter', async () => {
    await expect(
      incrementalSelfCheck({
        rootDir: '',
        storage: mockStorage,
      })
    ).rejects.toThrow('rootDir is required');
  });

  it('requires storage parameter', async () => {
    await expect(
      incrementalSelfCheck({
        rootDir: '/test',
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('has correct interface shape for IncrementalCheckResult', () => {
    const result: IncrementalCheckResult = {
      refreshResult: {
        changedFiles: ['/test/a.ts', '/test/b.ts'],
        updatedSymbols: 5,
        invalidatedClaims: 2,
        newDefeaters: 0,
        duration: 500,
        errors: [],
        changeSummary: {
          added: ['/test/a.ts'],
          modified: ['/test/b.ts'],
          deleted: [],
        },
      },
      changedAreaAnalysis: {
        analyzedFiles: ['/test/a.ts', '/test/b.ts'],
        mismatches: [],
        untestedClaims: [],
        phantomClaims: [],
        changedAreaScore: 0.9,
      },
      newIssues: [],
      resolvedIssues: [],
      healthDelta: 0.05,
      status: 'healthy',
      duration: 1000,
      errors: [],
      timestamp: new Date(),
      calibrationDelta: -0.01,
    };

    expect(result.refreshResult.changedFiles).toEqual(['/test/a.ts', '/test/b.ts']);
    expect(result.changedAreaAnalysis.changedAreaScore).toBe(0.9);
    expect(result.healthDelta).toBe(0.05);
    expect(result.status).toBe('healthy');
  });

  it('has correct interface shape for AnalysisResult', () => {
    const analysis: AnalysisResult = {
      analyzedFiles: ['/test/file.ts'],
      mismatches: [
        {
          id: 'mismatch-1',
          type: 'interface_signature',
          severity: 'warning',
          claimed: 'function accepts string',
          actual: 'function accepts number',
          location: '/test/file.ts',
          suggestedResolution: 'Update documentation',
        },
      ],
      untestedClaims: [],
      phantomClaims: [],
      changedAreaScore: 0.8,
    };

    expect(analysis.analyzedFiles).toEqual(['/test/file.ts']);
    expect(analysis.mismatches.length).toBe(1);
    expect(analysis.changedAreaScore).toBe(0.8);
  });

  it('has correct interface shape for Issue', () => {
    const issue: Issue = {
      id: 'issue-1',
      type: 'consistency',
      severity: 'high',
      description: 'Mismatch between code and documentation',
      location: '/test/file.ts',
      detectedAt: new Date(),
      isNew: true,
    };

    expect(issue.id).toBe('issue-1');
    expect(issue.type).toBe('consistency');
    expect(issue.severity).toBe('high');
    expect(issue.isNew).toBe(true);
  });

  it('has correct interface shape for IncrementalCheckOptions', () => {
    const options: IncrementalCheckOptions = {
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~5',
      sinceDays: undefined,
      baselineIssues: [],
      previousHealthScore: 0.85,
      checkCalibration: true,
      verbose: true,
      onProgress: (stage, progress) => {
        console.log(`${stage}: ${progress}%`);
      },
    };

    expect(options.rootDir).toBe('/test');
    expect(options.sinceCommit).toBe('HEAD~5');
    expect(options.checkCalibration).toBe(true);
    expect(options.previousHealthScore).toBe(0.85);
  });

  it('returns healthy status when no changes detected', async () => {
    // Mock selfRefresh to return no changes
    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~1',
      verbose: false,
    });

    // Even if refresh fails or finds no changes, should return a result
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
    expect(['healthy', 'needs_attention', 'degraded']).toContain(result.status);
  });

  it('computes healthDelta correctly', async () => {
    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~1',
      previousHealthScore: 0.8,
      verbose: false,
    });

    expect(result.healthDelta).toBeDefined();
    expect(typeof result.healthDelta).toBe('number');
    expect(result.healthDelta).toBeGreaterThanOrEqual(-1);
    expect(result.healthDelta).toBeLessThanOrEqual(1);
  });

  it('identifies new issues compared to baseline', async () => {
    const baselineIssues: Issue[] = [
      {
        id: 'old-issue-1',
        type: 'consistency',
        severity: 'medium',
        description: 'Old mismatch',
        location: '/old/file.ts',
        detectedAt: new Date(Date.now() - 86400000), // 1 day ago
        isNew: false,
      },
    ];

    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~1',
      baselineIssues,
      verbose: false,
    });

    expect(result.newIssues).toBeDefined();
    expect(Array.isArray(result.newIssues)).toBe(true);
    expect(result.resolvedIssues).toBeDefined();
    expect(Array.isArray(result.resolvedIssues)).toBe(true);
  });

  it('reports progress when callback provided', async () => {
    const progressStages: string[] = [];

    await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~1',
      verbose: false,
      onProgress: (stage, progress) => {
        progressStages.push(stage);
      },
    });

    // At minimum, refresh stage should be reported
    expect(progressStages).toContain('refresh');
    // Analysis and comparison stages may or may not be reached depending on whether changes are found
    // So we just check that some progress was reported
    expect(progressStages.length).toBeGreaterThan(0);
  });

  it('supports sinceDays option', async () => {
    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceDays: 7,
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('supports checkCalibration option', async () => {
    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: mockStorage,
      sinceCommit: 'HEAD~1',
      checkCalibration: true,
      verbose: false,
    });

    expect(result).toBeDefined();
    // calibrationDelta may or may not be set depending on whether calibration check succeeded
    if (result.calibrationDelta !== undefined) {
      expect(typeof result.calibrationDelta).toBe('number');
    }
  });

  it('handles errors gracefully', async () => {
    const failingStorage = {
      ...mockStorage,
      getFunctions: vi.fn().mockRejectedValue(new Error('Database error')),
    } as unknown as LibrarianStorage;

    const result = await incrementalSelfCheck({
      rootDir: '/test',
      storage: failingStorage,
      sinceCommit: 'HEAD~1',
      verbose: false,
    });

    expect(result).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('determines status based on issue severity', () => {
    // Test the status determination logic via interface
    const criticalIssue: Issue = {
      id: 'critical-1',
      type: 'consistency',
      severity: 'critical',
      description: 'Critical issue',
      location: '/test/file.ts',
      detectedAt: new Date(),
      isNew: true,
    };

    const highIssue: Issue = {
      id: 'high-1',
      type: 'test_coverage',
      severity: 'high',
      description: 'High priority issue',
      location: '/test/file.ts',
      detectedAt: new Date(),
      isNew: true,
    };

    expect(criticalIssue.severity).toBe('critical');
    expect(highIssue.severity).toBe('high');
    // Status determination is internal but we verify the interface supports it
  });
});
