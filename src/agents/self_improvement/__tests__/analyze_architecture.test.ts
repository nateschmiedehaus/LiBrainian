/**
 * @fileoverview Tests for Architecture Analysis Primitive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeArchitecture, createAnalyzeArchitecture } from '../analyze_architecture.js';
import type { LibrarianStorage, ModuleKnowledge } from '../../../storage/types.js';

describe('analyzeArchitecture', () => {
  let mockStorage: LibrarianStorage;
  let mockModules: ModuleKnowledge[];

  beforeEach(() => {
    // Create mock modules with dependencies
    mockModules = [
      {
        id: 'mod-1',
        path: '/test/src/api/handler.ts',
        purpose: 'API handler',
        exports: ['handleRequest', 'handleResponse'],
        dependencies: ['../core/processor', '../utils/helpers'],
        confidence: 0.9,
      },
      {
        id: 'mod-2',
        path: '/test/src/core/processor.ts',
        purpose: 'Core processor',
        exports: ['process', 'validate', 'transform', 'normalize', 'enrich'],
        dependencies: ['../storage/db', '../utils/helpers'],
        confidence: 0.9,
      },
      {
        id: 'mod-3',
        path: '/test/src/storage/db.ts',
        purpose: 'Database access',
        exports: ['query', 'insert', 'update', 'delete'],
        dependencies: [],
        confidence: 0.9,
      },
      {
        id: 'mod-4',
        path: '/test/src/utils/helpers.ts',
        purpose: 'Utility helpers',
        exports: ['formatDate', 'parseJson', 'slugify'],
        dependencies: [],
        confidence: 0.9,
      },
      // Module with too many exports (large interface)
      {
        id: 'mod-5',
        path: '/test/src/core/god_module.ts',
        purpose: 'Everything module',
        exports: Array.from({ length: 25 }, (_, i) => `export${i}`),
        dependencies: ['../storage/db', '../utils/helpers', '../api/handler'],
        confidence: 0.9,
      },
      // Cyclic dependency: storage depends on api (layer violation)
      {
        id: 'mod-6',
        path: '/test/src/storage/circular.ts',
        purpose: 'Creates a cycle',
        exports: ['getData'],
        dependencies: ['../api/handler'],
        confidence: 0.9,
      },
    ];

    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      getModules: vi.fn().mockResolvedValue(mockModules),
      getGraphEdges: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;
  });

  it('requires rootDir parameter', async () => {
    await expect(
      analyzeArchitecture({
        rootDir: '',
        storage: mockStorage,
      })
    ).rejects.toThrow('rootDir is required');
  });

  it('requires storage parameter', async () => {
    await expect(
      analyzeArchitecture({
        rootDir: '/test',
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('returns result structure with all required fields', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
    });

    expect(result).toHaveProperty('modules');
    expect(result).toHaveProperty('dependencies');
    expect(result).toHaveProperty('cycles');
    expect(result).toHaveProperty('layerViolations');
    expect(result).toHaveProperty('couplingMetrics');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('suggestions');

    expect(Array.isArray(result.modules)).toBe(true);
    expect(Array.isArray(result.dependencies)).toBe(true);
    expect(Array.isArray(result.cycles)).toBe(true);
    expect(Array.isArray(result.layerViolations)).toBe(true);
    expect(typeof result.couplingMetrics).toBe('object');
  });

  it('returns module info with expected fields', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
    });

    expect(result.modules.length).toBe(mockModules.length);

    const firstModule = result.modules[0];
    expect(firstModule).toHaveProperty('path');
    expect(firstModule).toHaveProperty('name');
    expect(firstModule).toHaveProperty('exportCount');
    expect(firstModule).toHaveProperty('dependencyCount');
    expect(firstModule).toHaveProperty('dependentCount');
    expect(firstModule).toHaveProperty('complexity');
  });

  it('detects large interfaces', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      checks: ['large_interfaces'],
      thresholds: { maxInterfaceMethods: 20, maxModuleSize: 500, maxCyclomaticComplexity: 15, maxAfferentCoupling: 10, maxEfferentCoupling: 15 },
    });

    // Should find god_module with 25 exports
    const largeInterfaceViolations = result.suggestions.filter(
      (s) => s.category === 'refactoring' && s.title.includes('god_module')
    );
    expect(largeInterfaceViolations.length).toBeGreaterThan(0);
  });

  it('infers layers from path', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      expectedLayers: ['api', 'core', 'storage', 'utils'],
    });

    const apiModule = result.modules.find((m) => m.path.includes('/api/'));
    const storageModule = result.modules.find((m) => m.path.includes('/storage/'));
    const coreModule = result.modules.find((m) => m.path.includes('/core/'));
    const utilsModule = result.modules.find((m) => m.path.includes('/utils/'));

    expect(apiModule?.layer).toBe('api');
    expect(storageModule?.layer).toBe('storage');
    expect(coreModule?.layer).toBe('core');
    expect(utilsModule?.layer).toBe('utils');
  });

  it('detects layer violations', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      expectedLayers: ['api', 'core', 'storage', 'utils'],
      checks: ['layer_violations'],
    });

    // Storage depending on API is a layer violation (storage is lower than api)
    expect(result.layerViolations.length).toBeGreaterThan(0);
    const storageViolation = result.layerViolations.find(
      (v) => v.location.includes('storage')
    );
    expect(storageViolation).toBeDefined();
  });

  it('computes coupling metrics', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      checks: ['coupling_analysis'],
    });

    expect(result.couplingMetrics).toHaveProperty('averageAfferentCoupling');
    expect(result.couplingMetrics).toHaveProperty('averageEfferentCoupling');
    expect(result.couplingMetrics).toHaveProperty('averageInstability');
    expect(result.couplingMetrics).toHaveProperty('highCouplingCount');
    expect(result.couplingMetrics).toHaveProperty('mostCoupled');

    expect(typeof result.couplingMetrics.averageAfferentCoupling).toBe('number');
    expect(typeof result.couplingMetrics.averageEfferentCoupling).toBe('number');
    expect(Array.isArray(result.couplingMetrics.mostCoupled)).toBe(true);
  });

  it('generates prioritized suggestions', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      expectedLayers: ['api', 'core', 'storage', 'utils'],
    });

    expect(result.suggestions.length).toBeGreaterThan(0);

    // Suggestions should be sorted by priority (descending)
    for (let i = 1; i < result.suggestions.length; i++) {
      expect(result.suggestions[i - 1].priority).toBeGreaterThanOrEqual(
        result.suggestions[i].priority
      );
    }

    // Each suggestion should have required fields
    const firstSuggestion = result.suggestions[0];
    expect(firstSuggestion).toHaveProperty('priority');
    expect(firstSuggestion).toHaveProperty('category');
    expect(firstSuggestion).toHaveProperty('title');
    expect(firstSuggestion).toHaveProperty('description');
    expect(firstSuggestion).toHaveProperty('affectedFiles');
    expect(firstSuggestion).toHaveProperty('effort');
  });

  it('supports custom thresholds', async () => {
    const result = await analyzeArchitecture({
      rootDir: '/test',
      storage: mockStorage,
      checks: ['large_interfaces'],
      thresholds: {
        maxInterfaceMethods: 5, // Very low threshold
        maxModuleSize: 500,
        maxCyclomaticComplexity: 15,
        maxAfferentCoupling: 10,
        maxEfferentCoupling: 15,
      },
    });

    // Should find more large interface violations with lower threshold
    // god_module has 25, core/processor has 5
    const violations = result.suggestions.filter((s) => s.category === 'refactoring');
    expect(violations.length).toBeGreaterThan(0);
  });

  describe('createAnalyzeArchitecture', () => {
    it('creates a bound analysis function with default options', async () => {
      const boundAnalyze = createAnalyzeArchitecture({
        expectedLayers: ['api', 'core', 'storage', 'utils'],
      });

      const result = await boundAnalyze({
        rootDir: '/test',
        storage: mockStorage,
      });

      expect(result).toHaveProperty('modules');
      expect(result).toHaveProperty('cycles');
      expect(result).toHaveProperty('layerViolations');
    });
  });

  describe('dependency analysis', () => {
    it('builds dependency graph', async () => {
      const result = await analyzeArchitecture({
        rootDir: '/test',
        storage: mockStorage,
      });

      expect(result.dependencies.length).toBeGreaterThan(0);

      const firstDep = result.dependencies[0];
      expect(firstDep).toHaveProperty('from');
      expect(firstDep).toHaveProperty('to');
      expect(firstDep).toHaveProperty('type');
      expect(firstDep).toHaveProperty('confidence');
    });
  });
});
