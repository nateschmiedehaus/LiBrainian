/**
 * @fileoverview Tests for Entry Point Detection
 */

import { describe, it, expect } from 'vitest';
import {
  detectEntryPoints,
  isEntryPointQuery,
  scoreEntryPointForQuery,
  ENTRY_POINT_QUERY_PATTERNS,
  type EntryPointDetectionOptions,
} from '../entry_point_detector.js';
import type { ModuleKnowledge, FunctionKnowledge } from '../../types.js';

describe('Entry Point Detector', () => {
  describe('isEntryPointQuery', () => {
    it('should detect "entry point" queries', () => {
      expect(isEntryPointQuery('What are the entry points?')).toBe(true);
      expect(isEntryPointQuery('Show me the entry point')).toBe(true);
      expect(isEntryPointQuery('Where is the main entry point?')).toBe(true);
    });

    it('should detect "main" queries', () => {
      expect(isEntryPointQuery('What is the main file?')).toBe(true);
      expect(isEntryPointQuery('Where is main?')).toBe(true);
      expect(isEntryPointQuery('Show me the main module')).toBe(true);
    });

    it('should detect "start" queries', () => {
      expect(isEntryPointQuery('Where do I start?')).toBe(true);
      expect(isEntryPointQuery('What is the starting point?')).toBe(true);
      expect(isEntryPointQuery('How to start using this?')).toBe(true);
    });

    it('should detect factory function queries', () => {
      expect(isEntryPointQuery('Where is createLiBrainian?')).toBe(true);
      expect(isEntryPointQuery('How to use createApp?')).toBe(true);
      expect(isEntryPointQuery('What does makeStore do?')).toBe(true);
    });

    it('should detect CLI queries', () => {
      expect(isEntryPointQuery('CLI entry point')).toBe(true);
      expect(isEntryPointQuery('What is the cli command?')).toBe(true);
      expect(isEntryPointQuery('binary entry')).toBe(true);
    });

    it('should not match unrelated queries', () => {
      expect(isEntryPointQuery('What does queryLiBrainian do?')).toBe(false);
      expect(isEntryPointQuery('How does the parser work?')).toBe(false);
      expect(isEntryPointQuery('Fix the bug in storage')).toBe(false);
    });
  });

  describe('detectEntryPoints', () => {
    it('should detect factory functions', async () => {
      const modules: ModuleKnowledge[] = [
        {
          id: 'mod1',
          path: '/workspace/src/index.ts',
          purpose: 'Main entry',
          exports: ['createLiBrainian', 'queryLiBrainian'],
          dependencies: [],
          confidence: 0.9,
        },
      ];

      const functions: FunctionKnowledge[] = [
        {
          id: 'fn1',
          filePath: '/workspace/src/index.ts',
          name: 'createLiBrainian',
          signature: 'createLiBrainian(config: Config): LiBrainian',
          purpose: 'Creates a new LiBrainian instance',
          startLine: 10,
          endLine: 50,
          confidence: 0.9,
          accessCount: 0,
          lastAccessed: null,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
        },
        {
          id: 'fn2',
          filePath: '/workspace/src/utils.ts',
          name: 'formatString',
          signature: 'formatString(s: string): string',
          purpose: 'Formats a string',
          startLine: 1,
          endLine: 5,
          confidence: 0.8,
          accessCount: 0,
          lastAccessed: null,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
        },
      ];

      const options: EntryPointDetectionOptions = {
        workspace: '/workspace',
        modules,
        functions,
        includeIndexFiles: true,
        includeCliEntries: true,
      };

      const result = await detectEntryPoints(options);

      // Should detect createLiBrainian as a factory function
      const factoryEntries = result.entryPoints.filter(ep => ep.kind === 'factory_function');
      expect(factoryEntries.length).toBeGreaterThan(0);
      expect(factoryEntries[0].name).toBe('createLiBrainian');

      // Should detect index.ts as an index module
      const indexEntries = result.entryPoints.filter(ep => ep.kind === 'index_module');
      expect(indexEntries.length).toBeGreaterThan(0);
    });

    it('should detect dependency roots', async () => {
      const modules: ModuleKnowledge[] = [
        {
          id: 'mod1',
          path: '/workspace/src/index.ts',
          purpose: 'Main entry',
          exports: ['main'],
          dependencies: ['./utils'],
          confidence: 0.9,
        },
        {
          id: 'mod2',
          path: '/workspace/src/utils.ts',
          purpose: 'Utilities',
          exports: ['formatString'],
          dependencies: [],
          confidence: 0.9,
        },
      ];

      const options: EntryPointDetectionOptions = {
        workspace: '/workspace',
        modules,
        functions: [],
        includeIndexFiles: true,
        includeCliEntries: true,
      };

      const result = await detectEntryPoints(options);

      // index.ts imports utils.ts, so index.ts is a root (nothing imports it)
      const roots = result.entryPoints.filter(ep => ep.kind === 'dependency_root');
      expect(roots.length).toBeGreaterThan(0);
      expect(roots.some(r => r.path.includes('index.ts'))).toBe(true);
    });
  });

  describe('scoreEntryPointForQuery', () => {
    it('should boost entry points that match query terms', () => {
      const entryPoint = {
        id: 'ep1',
        kind: 'factory_function' as const,
        path: '/workspace/src/index.ts',
        relativePath: 'src/index.ts',
        name: 'createLiBrainian',
        description: 'Creates a new LiBrainian instance',
        exports: ['createLiBrainian'],
        confidence: 0.8,
        dependentCount: 0,
        source: 'pattern_detection' as const,
      };

      // Should boost when query mentions the function name
      const score1 = scoreEntryPointForQuery(entryPoint, 'createLiBrainian');
      expect(score1).toBeGreaterThan(entryPoint.confidence);

      // Should boost when query mentions "factory"
      const score2 = scoreEntryPointForQuery(entryPoint, 'factory function');
      expect(score2).toBeGreaterThan(entryPoint.confidence);

      // Lower boost for unrelated query
      const score3 = scoreEntryPointForQuery(entryPoint, 'storage interface');
      expect(score3).toBeLessThanOrEqual(score1);
    });

    it('should boost CLI entries for CLI queries', () => {
      const cliEntry = {
        id: 'ep2',
        kind: 'cli_entry' as const,
        path: '/workspace/bin/cli.ts',
        relativePath: 'bin/cli.ts',
        name: 'librainian',
        description: 'CLI binary',
        exports: [],
        confidence: 0.85,
        dependentCount: 0,
        source: 'pattern_detection' as const,
      };

      const score = scoreEntryPointForQuery(cliEntry, 'CLI command');
      expect(score).toBeGreaterThan(cliEntry.confidence);
    });

    it('should boost main entry for main queries', () => {
      const mainEntry = {
        id: 'ep3',
        kind: 'package_main' as const,
        path: '/workspace/dist/index.js',
        relativePath: 'dist/index.js',
        name: 'index',
        description: 'Package main entry',
        exports: [],
        confidence: 1.0,
        dependentCount: 0,
        source: 'package_json' as const,
      };

      const score = scoreEntryPointForQuery(mainEntry, 'main entry');
      expect(score).toBeGreaterThan(mainEntry.confidence);
    });
  });

  describe('ENTRY_POINT_QUERY_PATTERNS', () => {
    it('should have patterns for common entry point queries', () => {
      const testQueries = [
        'entry point',
        'main file',
        'starting point',
        'bootstrap',
        'initialize',
        'where to start',
        'how to use',
        'CLI entry',
        'factory function',
        'createApp',
        'makeStore',
        'primary export',
        'package.json main',
        'root module',
        'index file',
      ];

      for (const query of testQueries) {
        const matches = ENTRY_POINT_QUERY_PATTERNS.some(p => p.test(query));
        expect(matches).toBe(true);
      }
    });
  });
});
