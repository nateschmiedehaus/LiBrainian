/**
 * @fileoverview Tests for G23-G24 gap implementations
 *
 * G23: Expertise Matching - Routes tasks to specialized agents
 * G24: Persistent Query Cache - SQLite cache with TTL
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import * as fsSync from 'node:fs';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { QueryCacheEntry } from '../storage/types.js';
import { cleanupWorkspace } from './helpers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const expertiseMatcherCandidates = [
  path.join(repoRoot, 'src', 'orchestrator', 'expertise_matcher.ts'),
  path.join(repoRoot, 'src', 'orchestrator', 'expertise_matcher.js'),
];
const HAS_ORCHESTRATOR = expertiseMatcherCandidates.some((candidate) => fsSync.existsSync(candidate));
const describeWave0 = HAS_ORCHESTRATOR ? describe : describe.skip;

// Extended storage type with query cache methods
type QueryCacheStorage = LibrarianStorage & {
  getQueryCacheEntry(queryHash: string): Promise<QueryCacheEntry | null>;
  upsertQueryCacheEntry(entry: QueryCacheEntry): Promise<void>;
  recordQueryCacheAccess(queryHash: string): Promise<void>;
  pruneQueryCache(options: { maxEntries: number; maxAgeMs: number }): Promise<number>;
};

// ============================================================================
// G23: Expertise Matching Tests
// ============================================================================

describeWave0('G23: Expertise Matching', () => {
  // Import dynamically to avoid circular dependencies
  let ExpertiseMatcher: typeof import('../orchestrator/expertise_matcher.js').ExpertiseMatcher;

  beforeEach(async () => {
    const module = await import('../orchestrator/expertise_matcher.js');
    ExpertiseMatcher = module.ExpertiseMatcher;
  });

  it('should analyze task and extract domains from intent', () => {
    const matcher = new ExpertiseMatcher();
    const task = {
      id: 'task-1',
      title: 'Fix authentication bug in auth module',
      description: 'The OAuth flow fails on logout',
      status: 'pending' as const,
      type: 'task' as const,
      createdAt: Date.now(),
      metadata: {
        affectedFiles: ['src/auth/oauth.ts', 'src/auth/session.ts'],
      },
    };

    const expertise = matcher.analyzeTask(task);

    expect(expertise.domains).toContain('security');
    expect(expertise.targetFiles).toContain('src/auth/oauth.ts');
    expect(expertise.confidence).toBeGreaterThan(0);
  });

  it('should infer languages from file extensions', () => {
    const matcher = new ExpertiseMatcher();
    const task = {
      id: 'task-2',
      title: 'Add TypeScript types',
      status: 'pending' as const,
      type: 'task' as const,
      createdAt: Date.now(),
      metadata: {
        affectedFiles: ['src/utils/helpers.ts', 'src/api/routes.tsx'],
      },
    };

    const expertise = matcher.analyzeTask(task);

    expect(expertise.languages).toContain('typescript');
  });

  it('should infer frameworks from signals', () => {
    const matcher = new ExpertiseMatcher();
    const task = {
      id: 'task-3',
      title: 'Update React components',
      description: 'Refactor using hooks and add vitest coverage',
      status: 'pending' as const,
      type: 'task' as const,
      createdAt: Date.now(),
      metadata: {},
    };

    const expertise = matcher.analyzeTask(task);

    expect(expertise.frameworks).toContain('react');
    expect(expertise.frameworks).toContain('vitest');
  });

  it('should score agent based on expertise overlap', () => {
    const matcher = new ExpertiseMatcher();
    const task = {
      id: 'task-4',
      title: 'Optimize database queries',
      status: 'pending' as const,
      type: 'task' as const,
      createdAt: Date.now(),
      metadata: {
        affectedFiles: ['src/db/queries.ts'],
      },
    };

    const agent = {
      id: 'agent-1',
      type: 'claude_code' as const,
      tasksCompleted: 10,
      config: {
        provider: 'claude' as const,
        role: 'implementer',
        model: 'claude-3-opus',
        capabilities: ['lang:typescript', 'domain:infrastructure'],
      },
      status: 'idle' as const,
      currentTask: undefined,
      telemetry: {
        totalTasks: 10,
        successfulTasks: 8,
        failedTasks: 2,
        averageDuration: 1000,
        tasksToday: 5,
      },
    };

    const score = matcher.scoreAgent(agent, task);

    expect(score).toBeGreaterThan(0);
    expect(typeof score).toBe('number');
  });

  it('should match task to best agent from pool', () => {
    const matcher = new ExpertiseMatcher();
    const task = {
      id: 'task-5',
      title: 'Add ML model training',
      description: 'Implement embedding generation pipeline',
      status: 'pending' as const,
      type: 'task' as const,
      createdAt: Date.now(),
      metadata: {
        affectedFiles: ['src/ml/training.py'],
      },
    };

    const agents = [
      {
        id: 'agent-ml',
        type: 'claude_code' as const,
        tasksCompleted: 20,
        config: {
          provider: 'claude' as const,
          role: 'implementer',
          model: 'claude-3-opus',
          capabilities: ['lang:python', 'domain:ml'],
        },
        status: 'idle' as const,
        currentTask: undefined,
        telemetry: { totalTasks: 20, successfulTasks: 18, failedTasks: 2, averageDuration: 1000, tasksToday: 5 },
      },
      {
        id: 'agent-web',
        type: 'claude_code' as const,
        tasksCompleted: 15,
        config: {
          provider: 'claude' as const,
          role: 'implementer',
          model: 'claude-3-opus',
          capabilities: ['lang:javascript', 'domain:product'],
        },
        status: 'idle' as const,
        currentTask: undefined,
        telemetry: { totalTasks: 15, successfulTasks: 10, failedTasks: 5, averageDuration: 1200, tasksToday: 3 },
      },
    ];

    const matched = matcher.matchTask(task, agents);

    expect(matched).not.toBeNull();
    expect(matched?.id).toBe('agent-ml');
  });
});

// ============================================================================
// G24: Persistent Query Cache Tests
// ============================================================================

describe('G24: Persistent Query Cache', () => {
  let storage: QueryCacheStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g24-test-'));
    const dbPath = path.join(tempDir, 'librarian.db');
    storage = createSqliteStorage(dbPath, tempDir) as QueryCacheStorage;
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    await cleanupWorkspace(tempDir);
  });

  it('should upsert and retrieve query cache entry', async () => {
    const entry: QueryCacheEntry = {
      queryHash: 'abc123',
      queryParams: JSON.stringify({ intent: 'test query' }),
      response: JSON.stringify({ packs: [], totalConfidence: 0.5 }),
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
    };

    await storage.upsertQueryCacheEntry(entry);
    const retrieved = await storage.getQueryCacheEntry('abc123');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.queryHash).toBe('abc123');
    expect(retrieved?.accessCount).toBe(1);
  });

  it('should record query cache access and update count', async () => {
    const entry: QueryCacheEntry = {
      queryHash: 'def456',
      queryParams: JSON.stringify({ intent: 'another query' }),
      response: JSON.stringify({ packs: [] }),
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
    };

    await storage.upsertQueryCacheEntry(entry);
    await storage.recordQueryCacheAccess('def456');
    const retrieved = await storage.getQueryCacheEntry('def456');

    expect(retrieved?.accessCount).toBe(2);
  });

  it('should prune expired cache entries', async () => {
    const oldEntry: QueryCacheEntry = {
      queryHash: 'old-entry',
      queryParams: JSON.stringify({ intent: 'old query' }),
      response: JSON.stringify({ packs: [] }),
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      lastAccessed: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      accessCount: 1,
    };

    const newEntry: QueryCacheEntry = {
      queryHash: 'new-entry',
      queryParams: JSON.stringify({ intent: 'new query' }),
      response: JSON.stringify({ packs: [] }),
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
    };

    await storage.upsertQueryCacheEntry(oldEntry);
    await storage.upsertQueryCacheEntry(newEntry);

    const pruned = await storage.pruneQueryCache({
      maxEntries: 100,
      maxAgeMs: 30 * 60 * 1000, // 30 minutes
    });

    expect(pruned).toBe(1);
    expect(await storage.getQueryCacheEntry('old-entry')).toBeNull();
    expect(await storage.getQueryCacheEntry('new-entry')).not.toBeNull();
  });

  it('should enforce max entries limit during prune', async () => {
    // Create 5 entries
    for (let i = 0; i < 5; i++) {
      const entry: QueryCacheEntry = {
        queryHash: `entry-${i}`,
        queryParams: JSON.stringify({ intent: `query ${i}` }),
        response: JSON.stringify({ packs: [] }),
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        lastAccessed: new Date(Date.now() - i * 1000).toISOString(),
        accessCount: 1,
      };
      await storage.upsertQueryCacheEntry(entry);
    }

    const pruned = await storage.pruneQueryCache({
      maxEntries: 3,
      maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours (no TTL expiry)
    });

    expect(pruned).toBe(2); // Should remove 2 oldest entries

    // Verify oldest entries are gone, newest remain
    expect(await storage.getQueryCacheEntry('entry-0')).not.toBeNull();
    expect(await storage.getQueryCacheEntry('entry-1')).not.toBeNull();
    expect(await storage.getQueryCacheEntry('entry-2')).not.toBeNull();
    expect(await storage.getQueryCacheEntry('entry-3')).toBeNull();
    expect(await storage.getQueryCacheEntry('entry-4')).toBeNull();
  });
});
