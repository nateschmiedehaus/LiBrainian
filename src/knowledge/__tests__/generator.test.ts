/**
 * @fileoverview Tests for UniversalKnowledgeGenerator
 *
 * Tests cover:
 * - Defeater activation graceful degradation when module is unavailable
 * - Defeater activation success paths
 * - Function generation with defeater checks
 * - Module generation with defeater checks
 * - Error handling and logging
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UniversalKnowledgeGenerator } from '../generator.js';
import type { LiBrainianStorage, UniversalKnowledgeRecord } from '../../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge } from '../../types.js';
import type { KnowledgeMeta } from '../universal_types.js';

describe('UniversalKnowledgeGenerator Defeater Activation', () => {
  let storage: LiBrainianStorage;
  let workspace: string;
  const testDir = join(tmpdir(), 'librainian-generator-test-' + Date.now());

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    workspace = testDir;
    storage = new MockStorage() as unknown as LiBrainianStorage;
    
    // Suppress console.warn during tests to reduce noise
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (existsSync(testDir)) {
      try {
        unlinkSync(join(testDir, 'test-file.ts'));
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Defeater Activation Try-Catch (lines 932-962)', () => {
    it('should log warning when defeater_activation module is unavailable', async () => {
      // Create a test file
      const testFile = join(workspace, 'test-file.ts');
      writeFileSync(testFile, 'export function testFunc() { return 42; }');

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => {
          throw new Error('Cannot find module defeater_activation.js');
        },
      });

      const fn: FunctionKnowledge = {
        id: 'test-func-id',
        name: 'testFunc',
        filePath: testFile,
        startLine: 1,
        endLine: 1,
        signature: 'function testFunc(): number',
        purpose: 'Test function',
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      };

      // Mock storage to return knowledge with defeaters
      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const consoleSpy = vi.spyOn(console, 'warn');

      // Generate knowledge - should gracefully degrade
      const result = await generator.generateForFunction(fn);

      // Verify: (1) Warning was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Defeater activation skipped:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot find module defeater_activation.js')
      );

      // Verify: (2) Generation continues without failing
      expect(result.success).toBe(true);

      // Verify: (3) Knowledge was generated and stored
      expect((storage as unknown as MockStorage).upsertedRecords.length).toBeGreaterThan(0);
      const storedRecord = (storage as unknown as MockStorage).upsertedRecords[0];
      expect(storedRecord.id).toBe('test-func-id');

      // Verify: (4) Knowledge does not contain defeater metadata (no activation occurred)
      const knowledge = JSON.parse(storedRecord.knowledge);
      // The defeaters array should still exist (from evidence collection)
      // but should not have `detected` timestamps since activation was skipped
      if (knowledge.meta.defeaters && knowledge.meta.defeaters.length > 0) {
        const activatedDefeaters = knowledge.meta.defeaters.filter(
          (d: any) => d.detected !== undefined
        );
        expect(activatedDefeaters.length).toBe(0);
      }

    });

    it('should continue generation when defeater check throws error', async () => {
      const testFile = join(workspace, 'test-file.ts');
      writeFileSync(testFile, 'export function testFunc() { return 42; }');

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => ({
          checkDefeaters: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
          applyDefeaterResults: vi.fn(),
        }),
      });

      const fn: FunctionKnowledge = {
        id: 'test-func-id-2',
        name: 'testFunc2',
        filePath: testFile,
        startLine: 1,
        endLine: 1,
        signature: 'function testFunc2(): number',
        purpose: 'Test function 2',
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      };

      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const consoleSpy = vi.spyOn(console, 'warn');

      const result = await generator.generateForFunction(fn);

      // Verify warning logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Defeater activation skipped:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Storage unavailable')
      );

      // Verify generation succeeded despite defeater error
      expect(result.success).toBe(true);
      expect((storage as unknown as MockStorage).upsertedRecords.length).toBeGreaterThan(0);

    });

    it('should successfully activate defeaters when module is available', async () => {
      const testFile = join(workspace, 'test-file.ts');
      writeFileSync(testFile, 'export function testFunc() { return 42; }');

      const fn: FunctionKnowledge = {
        id: 'test-func-id-3',
        name: 'testFunc3',
        filePath: testFile,
        startLine: 1,
        endLine: 1,
        signature: 'function testFunc3(): number',
        purpose: 'Test function 3',
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      };

      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const mockCheckDefeaters = vi.fn().mockResolvedValue({
        totalDefeaters: 2,
        activeDefeaters: 0,
        results: [
          { defeater: { type: 'code_change', description: 'Code changed' }, activated: false, severity: 'warning' },
          { defeater: { type: 'test_failure', description: 'Tests failed' }, activated: false, severity: 'warning' },
        ],
        knowledgeValid: true,
        confidenceAdjustment: 0,
      });
      const mockApplyDefeaterResults = vi.fn((meta: KnowledgeMeta, summary: any) => meta);

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => ({
          checkDefeaters: mockCheckDefeaters,
          applyDefeaterResults: mockApplyDefeaterResults,
        }),
      });

      const result = await generator.generateForFunction(fn);

      // Verify defeater activation was called
      expect(mockCheckDefeaters).toHaveBeenCalledWith(
        expect.objectContaining({
          defeaters: expect.any(Array),
        }),
        expect.objectContaining({
          entityId: 'test-func-id-3',
          filePath: testFile,
          storage,
          workspaceRoot: workspace,
        })
      );

      // Verify applyDefeaterResults was called
      expect(mockApplyDefeaterResults).toHaveBeenCalled();

      // Verify generation succeeded
      expect(result.success).toBe(true);

    });

    it('should invalidate knowledge when active defeaters are detected', async () => {
      const testFile = join(workspace, 'test-file.ts');
      writeFileSync(testFile, 'export function testFunc() { return 42; }');

      const fn: FunctionKnowledge = {
        id: 'test-func-id-4',
        name: 'testFunc4',
        filePath: testFile,
        startLine: 1,
        endLine: 1,
        signature: 'function testFunc4(): number',
        purpose: 'Test function 4',
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      };

      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const mockCheckDefeaters = vi.fn().mockResolvedValue({
        totalDefeaters: 2,
        activeDefeaters: 2,
        results: [
          {
            defeater: { type: 'code_change', description: 'Code changed', detected: new Date().toISOString() },
            activated: true,
            reason: 'Content hash mismatch',
            severity: 'full',
          },
          {
            defeater: { type: 'test_failure', description: 'Tests failed', detected: new Date().toISOString() },
            activated: true,
            reason: '5 tests failed',
            severity: 'partial',
          },
        ],
        knowledgeValid: false,
        confidenceAdjustment: -0.7,
      });
      const mockApplyDefeaterResults = vi.fn((meta: KnowledgeMeta) => ({
        ...meta,
        confidence: {
          ...meta.confidence,
          overall: Math.max(0.1, meta.confidence.overall - 0.7),
        },
      }));

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => ({
          checkDefeaters: mockCheckDefeaters,
          applyDefeaterResults: mockApplyDefeaterResults,
        }),
      });

      const result = await generator.generateForFunction(fn);

      // Verify generation still completes (partial success)
      expect(result.success).toBe(true);
      expect(result.partial).toBe(true);

      // Verify error was recorded about knowledge invalidation
      expect(result.errors.length).toBeGreaterThan(0);
      const invalidationError = result.errors.find(
        (e) => e.error.includes('Knowledge invalidated by')
      );
      expect(invalidationError).toBeDefined();
      expect(invalidationError?.error).toContain('2 defeater(s)');

    });

    it('should skip defeater activation when no defeaters present', async () => {
      const testFile = join(workspace, 'test-file.ts');
      writeFileSync(testFile, 'export function testFunc() { return 42; }');

      const fn: FunctionKnowledge = {
        id: 'test-func-id-5',
        name: 'testFunc5',
        filePath: testFile,
        startLine: 1,
        endLine: 1,
        signature: 'function testFunc5(): number',
        purpose: 'Test function 5',
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      };

      const mockCheckDefeaters = vi.fn();
      const evidenceModule = await import('../extractors/evidence_collector.js');
      vi.spyOn(evidenceModule, 'collectEvidence').mockReturnValue({
        meta: {
          confidence: { overall: 0.8, bySection: {} },
          evidence: [],
          defeaters: [],
          generatedAt: new Date().toISOString(),
          generatedBy: 'test',
          version: '1.0',
        },
        evidenceBySection: new Map(),
        defeatersBySection: new Map(),
      });

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => ({
          checkDefeaters: mockCheckDefeaters,
          applyDefeaterResults: vi.fn(),
        }),
      });

      const result = await generator.generateForFunction(fn);

      // Verify checkDefeaters was NOT called (no defeaters to check)
      expect(mockCheckDefeaters).not.toHaveBeenCalled();

      // Verify generation succeeded
      expect(result.success).toBe(true);

    });
  });

  describe('Module Defeater Activation', () => {
    it('should gracefully degrade for modules when defeater module unavailable', async () => {
      const testFile = join(workspace, 'test-module.ts');
      writeFileSync(testFile, 'export const foo = 42;');

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => {
          throw new Error('Module not found');
        },
      });

      const mod: ModuleKnowledge = {
        id: 'test-module-id',
        path: testFile,
        purpose: 'Test module',
        exports: ['foo'],
        dependencies: [],
        confidence: 0.8,
      };

      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const consoleSpy = vi.spyOn(console, 'warn');

      const result = await generator.generateForModule(mod);

      // Verify warning logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Defeater activation skipped:')
      );

      // Verify generation succeeded
      expect(result.success).toBe(true);

    });

    it('should activate defeaters for modules when available', async () => {
      const testFile = join(workspace, 'test-module.ts');
      writeFileSync(testFile, 'export const foo = 42;');

      const mod: ModuleKnowledge = {
        id: 'test-module-id-2',
        path: testFile,
        purpose: 'Test module 2',
        exports: ['foo'],
        dependencies: [],
        confidence: 0.8,
      };

      (storage as unknown as MockStorage).mockKnowledgeWithDefeaters = true;

      const mockCheckDefeaters = vi.fn().mockResolvedValue({
        totalDefeaters: 1,
        activeDefeaters: 1,
        results: [
          {
            defeater: { type: 'code_change', description: 'Code changed', detected: new Date().toISOString() },
            activated: true,
            reason: 'Hash mismatch',
            severity: 'full',
          },
        ],
        knowledgeValid: false,
        confidenceAdjustment: -0.5,
      });
      const mockApplyDefeaterResults = vi.fn((meta: KnowledgeMeta) => meta);

      const generator = new UniversalKnowledgeGenerator({
        storage,
        workspace,
        llmProvider: 'claude',
        llmModelId: 'claude-3-5-sonnet-20241022',
        defeaterLoader: async () => ({
          checkDefeaters: mockCheckDefeaters,
          applyDefeaterResults: mockApplyDefeaterResults,
        }),
      });

      const result = await generator.generateForModule(mod);

      // Verify defeater activation called
      expect(mockCheckDefeaters).toHaveBeenCalled();

      // Verify error recorded for invalidation
      expect(result.errors.some(e => e.error.includes('Knowledge invalidated'))).toBe(true);

    });
  });
});

// ============================================================================
// MOCK STORAGE
// ============================================================================

class MockStorage {
  public upsertedRecords: UniversalKnowledgeRecord[] = [];
  public mockKnowledgeWithDefeaters = false;

  async getFunctions(): Promise<FunctionKnowledge[]> {
    return [];
  }

  async getModules(): Promise<ModuleKnowledge[]> {
    return [];
  }

  async getUniversalKnowledge(id: string): Promise<UniversalKnowledgeRecord | undefined> {
    return undefined;
  }

  async upsertUniversalKnowledge(record: UniversalKnowledgeRecord): Promise<void> {
    this.upsertedRecords.push(record);
  }

  async deleteUniversalKnowledgeByFile(filePath: string): Promise<void> {
    this.upsertedRecords = this.upsertedRecords.filter((r) => r.file !== filePath);
  }

  async getGraphEdges(query: any): Promise<any[]> {
    return [];
  }
}
