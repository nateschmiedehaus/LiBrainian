/**
 * Tests for Git Reflog Indexer
 *
 * Tests for:
 * - Reflog output parsing
 * - Action type detection
 * - Workflow pattern analysis
 * - Query helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseAction,
  extractPreviousCommit,
  parseReflogOutput,
  parseDetailedReflog,
  analyzeWorkflowPatterns,
  findProblematicPatterns,
} from '../reflog_indexer.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, ReflogEntry } from '../../storage/types.js';

describe('Reflog Indexer', () => {
  describe('parseAction', () => {
    it('should detect commit action', () => {
      expect(parseAction('commit: Added new feature')).toBe('commit');
      expect(parseAction('commit (initial): Initial commit')).toBe('commit');
    });

    it('should detect rebase action', () => {
      expect(parseAction('rebase: checkout main')).toBe('rebase');
      expect(parseAction('rebase (finish): refs/heads/feature')).toBe('rebase');
      expect(parseAction('rebase -i (start): HEAD~3')).toBe('rebase');
    });

    it('should detect reset action', () => {
      expect(parseAction('reset: moving to HEAD~1')).toBe('reset');
      expect(parseAction('reset: moving to abc123')).toBe('reset');
    });

    it('should detect merge action', () => {
      expect(parseAction('merge feature-branch: Fast-forward')).toBe('merge');
      expect(parseAction('merge main: Merge made by recursive')).toBe('merge');
    });

    it('should detect checkout action', () => {
      expect(parseAction('checkout: moving from main to feature')).toBe('checkout');
    });

    it('should detect cherry-pick action', () => {
      expect(parseAction('cherry-pick: Picked commit abc123')).toBe('cherry-pick');
    });

    it('should detect revert action', () => {
      expect(parseAction('revert: Revert "Bad commit"')).toBe('revert');
    });

    it('should detect pull action', () => {
      expect(parseAction('pull: Fast-forward')).toBe('pull');
      expect(parseAction('pull origin main: fast-forward')).toBe('pull');
    });

    it('should return other for unknown actions', () => {
      expect(parseAction('unknown action')).toBe('other');
      expect(parseAction('')).toBe('other');
    });
  });

  describe('extractPreviousCommit', () => {
    it('should extract commit from reset message', () => {
      // Commit hash must be 7-40 characters
      expect(extractPreviousCommit('reset: moving to abc1234')).toBe('abc1234');
      expect(extractPreviousCommit('reset: moving to abc123def456789012345678901234567890abcd')).toBe('abc123def456789012345678901234567890abcd');
    });

    it('should return undefined for non-reset messages', () => {
      expect(extractPreviousCommit('commit: Added feature')).toBeUndefined();
      expect(extractPreviousCommit('checkout: moving from main to feature')).toBeUndefined();
    });

    it('should return undefined if no commit hash found', () => {
      expect(extractPreviousCommit('reset: something else')).toBeUndefined();
    });

    it('should return undefined for short commit hashes', () => {
      // Hash must be at least 7 characters
      expect(extractPreviousCommit('reset: moving to abc12')).toBeUndefined();
    });
  });

  describe('parseReflogOutput', () => {
    it('should parse simple reflog output', () => {
      const output = `abc123def456789012345678901234567890abcd HEAD@{0} commit: Added feature
def456789012345678901234567890abcdef12 HEAD@{1} checkout: moving from main to feature`;

      const entries = parseReflogOutput(output);

      expect(entries).toHaveLength(2);
      expect(entries[0].commitHash).toBe('abc123def456789012345678901234567890abcd');
      expect(entries[0].reflogSelector).toBe('HEAD@{0}');
      expect(entries[0].action).toBe('commit');
      expect(entries[0].message).toBe('commit: Added feature');

      expect(entries[1].action).toBe('checkout');
    });

    it('should handle empty output', () => {
      expect(parseReflogOutput('')).toHaveLength(0);
      expect(parseReflogOutput('\n\n')).toHaveLength(0);
    });

    it('should skip malformed lines', () => {
      const output = `abc123def456789012345678901234567890abcd HEAD@{0} commit: Good
not a valid line
def456789012345678901234567890abcdef12 HEAD@{1} merge: Also good`;

      const entries = parseReflogOutput(output);
      expect(entries).toHaveLength(2);
    });

    it('should detect reset with previous commit', () => {
      const output = `abc123def456789012345678901234567890abcd HEAD@{0} reset: moving to def4567`;

      const entries = parseReflogOutput(output);

      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('reset');
      expect(entries[0].previousCommit).toBe('def4567');
    });
  });

  describe('parseDetailedReflog', () => {
    it('should parse detailed reflog with timestamps', () => {
      const output = `abc123def456789012345678901234567890abcd|HEAD@{0}|commit: Feature|2021-01-01 12:00:00 +0000|John Doe`;

      const entries = parseDetailedReflog(output);

      expect(entries).toHaveLength(1);
      expect(entries[0].commitHash).toBe('abc123def456789012345678901234567890abcd');
      expect(entries[0].timestamp).toBe('2021-01-01 12:00:00 +0000');
      expect(entries[0].author).toBe('John Doe');
    });

    it('should handle missing optional fields', () => {
      const output = `abc123def456789012345678901234567890abcd|HEAD@{0}|commit: Feature`;

      const entries = parseDetailedReflog(output);

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBeUndefined();
      expect(entries[0].author).toBeUndefined();
    });
  });

  describe('Integration with Storage', () => {
    let storage: LiBrainianStorage;
    let dbPath: string;
    const testDir = join(tmpdir(), 'reflog-indexer-test-' + Date.now());

    beforeEach(async () => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
      dbPath = join(testDir, `test-${Date.now()}.db`);
      storage = createSqliteStorage(dbPath, testDir);
      await storage.initialize();
    });

    afterEach(async () => {
      await storage.close();
      if (existsSync(dbPath)) {
        try {
          unlinkSync(dbPath);
          unlinkSync(dbPath + '-wal');
          unlinkSync(dbPath + '-shm');
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should store and retrieve reflog entries', async () => {
      const entries: ReflogEntry[] = [
        {
          id: 'reflog-1',
          refName: 'HEAD',
          commitHash: 'abc123def456789012345678901234567890abcd',
          action: 'commit',
          timestamp: '2021-01-01T12:00:00Z',
          message: 'commit: Added feature',
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'reflog-2',
          refName: 'HEAD',
          commitHash: 'def456789012345678901234567890abcdef12',
          action: 'merge',
          timestamp: '2021-01-02T12:00:00Z',
          message: 'merge: feature-branch',
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertReflogEntries(entries);

      const retrieved = await storage.getReflogEntries({ refName: 'HEAD' });
      expect(retrieved).toHaveLength(2);
    });

    it('should query reflog entries by action', async () => {
      const entries: ReflogEntry[] = [
        {
          id: 'reflog-commit',
          refName: 'HEAD',
          commitHash: 'abc123',
          action: 'commit',
          timestamp: '2021-01-01T12:00:00Z',
          message: 'commit: Feature',
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'reflog-revert',
          refName: 'HEAD',
          commitHash: 'def456',
          action: 'revert',
          timestamp: '2021-01-02T12:00:00Z',
          message: 'revert: Bad commit',
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'reflog-reset',
          refName: 'HEAD',
          commitHash: 'ghi789',
          action: 'reset',
          previousCommit: 'abc123',
          timestamp: '2021-01-03T12:00:00Z',
          message: 'reset: moving to abc123',
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertReflogEntries(entries);

      const reverts = await storage.getReflogEntries({ action: 'revert' });
      expect(reverts).toHaveLength(1);
      expect(reverts[0].message).toContain('revert');

      const resets = await storage.getReflogEntries({ action: 'reset' });
      expect(resets).toHaveLength(1);
      expect(resets[0].previousCommit).toBe('abc123');
    });

    it('should analyze workflow patterns', async () => {
      // Create a mix of entries representing a merge-based workflow
      const entries: ReflogEntry[] = [
        { id: '1', refName: 'HEAD', commitHash: 'a', action: 'commit', timestamp: '2021-01-01T00:00:00Z', message: 'commit: A', indexedAt: new Date().toISOString() },
        { id: '2', refName: 'HEAD', commitHash: 'b', action: 'commit', timestamp: '2021-01-01T01:00:00Z', message: 'commit: B', indexedAt: new Date().toISOString() },
        { id: '3', refName: 'HEAD', commitHash: 'c', action: 'commit', timestamp: '2021-01-01T02:00:00Z', message: 'commit: C', indexedAt: new Date().toISOString() },
        { id: '4', refName: 'HEAD', commitHash: 'd', action: 'merge', timestamp: '2021-01-01T03:00:00Z', message: 'merge: feature', indexedAt: new Date().toISOString() },
        { id: '5', refName: 'HEAD', commitHash: 'e', action: 'merge', timestamp: '2021-01-01T04:00:00Z', message: 'merge: another', indexedAt: new Date().toISOString() },
        { id: '6', refName: 'HEAD', commitHash: 'f', action: 'merge', timestamp: '2021-01-01T05:00:00Z', message: 'merge: third', indexedAt: new Date().toISOString() },
      ];

      await storage.upsertReflogEntries(entries);

      const patterns = await analyzeWorkflowPatterns(storage);

      expect(patterns.commitCount).toBe(3);
      expect(patterns.mergeCount).toBe(3);
      expect(patterns.workflowStyle).toBe('merge-based');
    });

    it('should find problematic patterns', async () => {
      // High revert rate scenario
      const entries: ReflogEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          id: `commit-${i}`,
          refName: 'HEAD',
          commitHash: `commit${i}`,
          action: 'commit',
          timestamp: `2021-01-0${i + 1}T00:00:00Z`,
          message: `commit: Feature ${i}`,
          indexedAt: new Date().toISOString(),
        });
      }
      // Add reverts
      entries.push({
        id: 'revert-1',
        refName: 'HEAD',
        commitHash: 'revert1',
        action: 'revert',
        timestamp: '2021-01-11T00:00:00Z',
        message: 'revert: Bad commit',
        indexedAt: new Date().toISOString(),
      });

      await storage.upsertReflogEntries(entries);

      const patterns = await findProblematicPatterns(storage);

      expect(patterns.revertFrequency).toBe(10); // 1 revert per 10 commits = 10%
      expect(patterns.flags).toHaveLength(1);
      expect(patterns.flags[0]).toContain('revert');
    });

    it('should handle empty repository', async () => {
      const patterns = await analyzeWorkflowPatterns(storage);

      expect(patterns.commitCount).toBe(0);
      expect(patterns.mergeCount).toBe(0);
      expect(patterns.workflowStyle).toBe('mixed');
    });
  });
});
