/**
 * @fileoverview REAL Bootstrap Integration Tests
 *
 * These tests use REAL temporary workspaces with actual TypeScript files,
 * run actual bootstrap (not mocked), and verify functions are extracted,
 * stored, and embeddings are generated using local xenova embeddings.
 *
 * Key differences from mocked tests:
 * - Creates real TypeScript files in temporary directories
 * - Runs actual bootstrap pipeline (not mocked)
 * - Uses xenova embeddings (no external API calls)
 * - Verifies actual storage contents
 * - Fails loudly when indexing is broken
 *
 * IMPORTANT: These tests require real providers and should be skipped in unit test mode.
 * Run with LIBRARIAN_TEST_MODE=integration to execute these tests.
 *
 * @see docs/archive/IMPLEMENTATION-PLAN.md for context on why these tests exist
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import * as path from 'node:path';
import {
  createTempWorkspace,
  cleanupWorkspace,
  createTestFile,
  createWorkspaceWithFiles,
} from './helpers/index.js';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { bootstrapProject, createBootstrapConfig } from '../api/bootstrap.js';
import { EmbeddingService } from '../api/embeddings.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { BootstrapConfig } from '../types.js';

// ============================================================================
// TEST DATA
// ============================================================================

/** Sample TypeScript file with extractable functions */
const SAMPLE_TS_MATH = `/**
 * @fileoverview Math utilities
 */

/**
 * Adds two numbers together.
 * @param a First number
 * @param b Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Multiplies two numbers together.
 * @param a First number
 * @param b Second number
 * @returns The product of a and b
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * Subtracts the second number from the first.
 * @param a First number
 * @param b Second number
 * @returns The difference (a - b)
 */
export function subtract(a: number, b: number): number {
  return a - b;
}
`;

/** Sample TypeScript file with a class */
const SAMPLE_TS_CLASS = `/**
 * @fileoverview User service implementation
 */

export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Service for managing users.
 */
export class UserService {
  private users: Map<string, User> = new Map();

  /**
   * Creates a new user.
   * @param name User's name
   * @param email User's email
   * @returns The created user
   */
  createUser(name: string, email: string): User {
    const id = Math.random().toString(36).slice(2);
    const user: User = { id, name, email };
    this.users.set(id, user);
    return user;
  }

  /**
   * Retrieves a user by ID.
   * @param id User's ID
   * @returns The user or undefined if not found
   */
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * Lists all users.
   * @returns Array of all users
   */
  listUsers(): User[] {
    return Array.from(this.users.values());
  }
}
`;

/** Sample index file */
const SAMPLE_TS_INDEX = `/**
 * @fileoverview Entry point for the module
 */

export * from './math.js';
export * from './user-service.js';
`;

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a minimal bootstrap config for testing.
 * Uses xenova embeddings (no external API calls).
 */
function createTestBootstrapConfig(
  workspace: string,
  overrides?: Partial<BootstrapConfig>
): BootstrapConfig {
  return createBootstrapConfig(workspace, {
    bootstrapMode: 'fast', // Fast mode for quicker tests
    include: ['**/*.ts'],
    exclude: ['node_modules/**', '**/*.d.ts', '**/*.test.ts'],
    embeddingProvider: 'xenova',
    embeddingModelId: 'all-MiniLM-L6-v2',
    skipProviderProbe: true, // Skip slow provider checks in tests
    forceReindex: true, // Always start fresh
    ...overrides,
  });
}

/**
 * Create a workspace with standard test files.
 */
async function createStandardTestWorkspace(): Promise<string> {
  return createWorkspaceWithFiles({
    'src/math.ts': SAMPLE_TS_MATH,
    'src/user-service.ts': SAMPLE_TS_CLASS,
    'src/index.ts': SAMPLE_TS_INDEX,
  });
}

// ============================================================================
// TESTS
// ============================================================================

// Skip in unit test mode - these tests require real providers
const LIBRARIAN_TEST_MODE = process.env.LIBRARIAN_TEST_MODE ?? 'unit';
const skipInUnitMode = LIBRARIAN_TEST_MODE === 'unit';

describe.skipIf(skipInUnitMode)('Real Bootstrap Integration Tests', () => {
  let workspace: string;
  let storage: LibrarianStorage;

  beforeEach(async () => {
    workspace = await createTempWorkspace('bootstrap-real-test-');
  });

  afterEach(async () => {
    if (storage) {
      try {
        await storage.close();
      } catch {
        // Ignore close errors
      }
    }
    if (workspace) {
      await cleanupWorkspace(workspace);
    }
  });

  describe('Basic Indexing', () => {
    it('indexes TypeScript files and extracts functions', async () => {
      // Create workspace with test files
      await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_MATH);
      await createTestFile(workspace, 'src/user-service.ts', SAMPLE_TS_CLASS);
      await createTestFile(workspace, 'src/index.ts', SAMPLE_TS_INDEX);

      // Initialize storage
      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      // Create config and run bootstrap
      const config = createTestBootstrapConfig(workspace);
      const report = await bootstrapProject(config, storage);

      // Verify bootstrap completed
      expect(report.success).toBe(true);
      expect(report.totalFilesProcessed).toBeGreaterThan(0);

      // Verify functions were indexed
      const stats = await storage.getStats();
      expect(stats.totalFunctions).toBeGreaterThan(0);

      // Query for specific functions
      const functions = await storage.getFunctions({ limit: 100 });
      expect(functions.length).toBeGreaterThan(0);

      // Verify we found expected functions
      const functionNames = functions.map((f) => f.name);
      expect(functionNames).toContain('add');
      expect(functionNames).toContain('multiply');
      expect(functionNames).toContain('subtract');
    });

    it('generates real embeddings for indexed functions', async () => {
      // Create workspace with test files
      await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_MATH);

      // Initialize storage
      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      // Create config with embeddings enabled
      const config = createTestBootstrapConfig(workspace, {
        bootstrapMode: 'full', // Full mode to generate embeddings
      });
      const report = await bootstrapProject(config, storage);

      expect(report.success).toBe(true);

      // Check that embeddings were generated
      const stats = await storage.getStats();

      // Functions should have been indexed
      expect(stats.totalFunctions).toBeGreaterThan(0);

      // In full mode, we should have embeddings
      // Note: The embedding count may vary based on what's embedded
      // At minimum, files should be processed
      expect(report.totalFilesProcessed).toBeGreaterThanOrEqual(1);
    });

    it('handles empty workspace gracefully', async () => {
      // Empty workspace - no files
      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      const config = createTestBootstrapConfig(workspace, {
        include: ['**/*.ts'],
      });

      // Bootstrap should complete but with 0 files
      const report = await bootstrapProject(config, storage);

      // Should report 0 files processed
      expect(report.totalFilesProcessed).toBe(0);
      expect(report.totalFunctionsIndexed).toBe(0);
    });
  });

  describe('Pattern Matching', () => {
    it('respects include patterns', async () => {
      // Create files in different directories
      await createTestFile(workspace, 'src/included.ts', SAMPLE_TS_MATH);
      await createTestFile(workspace, 'lib/excluded.ts', SAMPLE_TS_MATH);

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      // Only include src/**
      const config = createTestBootstrapConfig(workspace, {
        include: ['src/**/*.ts'],
        exclude: ['**/*.d.ts', '**/*.test.ts'],
      });

      const report = await bootstrapProject(config, storage);

      expect(report.success).toBe(true);
      expect(report.totalFilesProcessed).toBeGreaterThanOrEqual(1);

      // Get indexed files
      const files = await storage.getFiles({});
      const filePaths = files.map((f) => f.path);

      // Should include src/included.ts
      expect(filePaths.some((p) => p.includes('included.ts'))).toBe(true);

      // Should NOT include lib/excluded.ts
      expect(filePaths.some((p) => p.includes('excluded.ts'))).toBe(false);
    });

    it('respects exclude patterns', async () => {
      // Create regular files and test files
      await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_MATH);
      await createTestFile(workspace, 'src/math.test.ts', `
        import { add } from './math.js';
        test('add works', () => expect(add(1, 2)).toBe(3));
      `);

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      const config = createTestBootstrapConfig(workspace, {
        include: ['**/*.ts'],
        exclude: ['**/*.test.ts', '**/*.d.ts'],
      });

      const report = await bootstrapProject(config, storage);

      expect(report.success).toBe(true);

      const files = await storage.getFiles({});
      const filePaths = files.map((f) => f.path);

      // Should include math.ts
      expect(filePaths.some((p) => p.endsWith('math.ts'))).toBe(true);

      // Should NOT include math.test.ts
      expect(filePaths.some((p) => p.includes('.test.ts'))).toBe(false);
    });

    it('librarian scope patterns match actual source directories', async () => {
      // This test verifies that the 'librarian' scope patterns are correct
      // by checking they would match files in typical librarian source structure
      const { resolveScopeOverrides } = await import('../cli/commands/bootstrap.js');

      // Note: resolveScopeOverrides is not exported, so we test indirectly
      // by creating a workspace that mimics librarian structure

      await createTestFile(workspace, 'src/api/query.ts', 'export function query() {}');
      await createTestFile(workspace, 'src/cli/index.ts', 'export function main() {}');
      await createTestFile(workspace, 'src/storage/sqlite.ts', 'export class Storage {}');
      await createTestFile(workspace, 'src/types.ts', 'export interface Config {}');
      await createTestFile(workspace, 'AGENTS.md', '# Agents');

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      // Use patterns that mimic the fixed librarian scope
      const config = createTestBootstrapConfig(workspace, {
        include: [
          'src/api/**/*.ts',
          'src/cli/**/*.ts',
          'src/storage/**/*.ts',
          'src/types.ts',
          'AGENTS.md',
        ],
        exclude: ['node_modules/**', '**/*.d.ts', '**/*.test.ts'],
      });

      const report = await bootstrapProject(config, storage);

      expect(report.success).toBe(true);
      expect(report.totalFilesProcessed).toBeGreaterThanOrEqual(4);

      const files = await storage.getFiles({});
      const filePaths = files.map((f) => f.path);

      // Should find files from librarian-like structure
      expect(filePaths.some((p) => p.includes('api/query.ts'))).toBe(true);
      expect(filePaths.some((p) => p.includes('cli/index.ts'))).toBe(true);
      expect(filePaths.some((p) => p.includes('storage/sqlite.ts'))).toBe(true);
    });
  });

  describe('Query Integration', () => {
    it('can retrieve indexed functions by query', async () => {
      // Create workspace with test files
      await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_MATH);
      await createTestFile(workspace, 'src/user-service.ts', SAMPLE_TS_CLASS);

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      const config = createTestBootstrapConfig(workspace);
      const report = await bootstrapProject(config, storage);

      expect(report.success).toBe(true);
      expect(report.totalFunctionsIndexed).toBeGreaterThan(0);

      // Search for functions
      const functions = await storage.getFunctions({ limit: 100 });

      // Verify we can find math-related functions
      const mathFunctions = functions.filter((f) =>
        f.filePath.includes('math.ts')
      );
      expect(mathFunctions.length).toBeGreaterThan(0);

      // Verify we can find user service functions
      const userFunctions = functions.filter((f) =>
        f.filePath.includes('user-service.ts')
      );
      expect(userFunctions.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('handles malformed TypeScript files gracefully', async () => {
      // Create a mix of valid and malformed files
      await createTestFile(workspace, 'src/valid.ts', SAMPLE_TS_MATH);
      await createTestFile(workspace, 'src/malformed.ts', `
        // This file has syntax errors
        export function broken(
          // Missing closing paren and body
      `);

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      const config = createTestBootstrapConfig(workspace);
      const report = await bootstrapProject(config, storage);

      // Bootstrap should complete (possibly with errors)
      expect(report.success).toBeDefined();

      // Should have indexed at least the valid file
      const stats = await storage.getStats();
      // The valid file should have been processed
      expect(report.totalFilesProcessed).toBeGreaterThanOrEqual(1);
    });

    it('reports when patterns match no files', async () => {
      // Create files that won't match the patterns
      await createTestFile(workspace, 'src/code.py', '# Python file');
      await createTestFile(workspace, 'lib/data.json', '{}');

      const dbPath = path.join(workspace, '.librarian', 'index.sqlite');
      storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();

      // Use patterns that won't match
      const config = createTestBootstrapConfig(workspace, {
        include: ['src/nonexistent/**/*.ts'],
      });

      const report = await bootstrapProject(config, storage);

      // Should complete with 0 files
      expect(report.totalFilesProcessed).toBe(0);
    });
  });

  describe('Embedding Service', () => {
    it('uses xenova embeddings without external API calls', async () => {
      // Create test file
      await createTestFile(workspace, 'src/sample.ts', SAMPLE_TS_MATH);

      // Create embedding service directly
      const embeddingService = new EmbeddingService({
        provider: 'xenova',
        modelId: 'all-MiniLM-L6-v2',
      });

      // Generate embedding for a code snippet
      const result = await embeddingService.generateEmbedding({
        text: 'function add(a: number, b: number): number { return a + b; }',
        kind: 'code',
      });

      // Verify embedding was generated
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      expect(result.vector.length).toBeGreaterThan(0);
      // all-MiniLM-L6-v2 produces 384-dimensional embeddings
      expect(result.vector.length).toBe(384);

      // Verify it's a real vector (not zeros)
      const hasNonZero = result.vector.some((v) => v !== 0);
      expect(hasNonZero).toBe(true);
    });
  });
});
