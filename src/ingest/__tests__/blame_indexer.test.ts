/**
 * Tests for Git Blame Indexer
 *
 * Tests for:
 * - Blame output parsing
 * - Line grouping into chunks
 * - Blame statistics calculation
 * - Query helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseBlameLineHeader,
  parseBlameOutput,
  groupBlameLines,
  type BlameLineInfo,
  type BlameChunk,
} from '../blame_indexer.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';

describe('Blame Indexer', () => {
  describe('parseBlameLineHeader', () => {
    it('should parse standard blame header', () => {
      const line = 'abc123def456789012345678901234567890abcd 1 1';
      const result = parseBlameLineHeader(line);

      expect(result).not.toBeNull();
      expect(result!.commitHash).toBe('abc123def456789012345678901234567890abcd');
      expect(result!.originalLine).toBe(1);
      expect(result!.finalLine).toBe(1);
      expect(result!.groupLines).toBeUndefined();
    });

    it('should parse header with group lines', () => {
      const line = 'abc123def456789012345678901234567890abcd 10 15 5';
      const result = parseBlameLineHeader(line);

      expect(result).not.toBeNull();
      expect(result!.originalLine).toBe(10);
      expect(result!.finalLine).toBe(15);
      expect(result!.groupLines).toBe(5);
    });

    it('should return null for invalid header', () => {
      expect(parseBlameLineHeader('author John Doe')).toBeNull();
      expect(parseBlameLineHeader('')).toBeNull();
      expect(parseBlameLineHeader('not a valid line')).toBeNull();
    });

    it('should reject short commit hashes', () => {
      const line = 'abc123 1 1'; // Too short
      const result = parseBlameLineHeader(line);
      expect(result).toBeNull();
    });
  });

  describe('parseBlameOutput', () => {
    it('should parse complete blame porcelain output', () => {
      const output = `abc123def456789012345678901234567890abcd 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1609459200
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1609459200
committer-tz +0000
summary Initial commit
filename src/test.ts
\tconst x = 1;`;

      const lines = parseBlameOutput(output);

      expect(lines).toHaveLength(1);
      expect(lines[0].commitHash).toBe('abc123def456789012345678901234567890abcd');
      expect(lines[0].author).toBe('John Doe');
      expect(lines[0].authorEmail).toBe('john@example.com');
      expect(lines[0].authorTime).toBe(1609459200);
      expect(lines[0].summary).toBe('Initial commit');
      expect(lines[0].filename).toBe('src/test.ts');
    });

    it('should parse multiple lines', () => {
      // Note: commit hashes must be exactly 40 hex characters
      const output = `abc123def456789012345678901234567890abcd 1 1
author Alice
author-mail <alice@example.com>
author-time 1609459200
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1609459200
committer-tz +0000
summary First commit
filename test.ts
\tline 1
def456789012345678901234567890abcdef1234 2 2
author Bob
author-mail <bob@example.com>
author-time 1609545600
author-tz +0000
committer Bob
committer-mail <bob@example.com>
committer-time 1609545600
committer-tz +0000
summary Second commit
filename test.ts
\tline 2`;

      const lines = parseBlameOutput(output);

      expect(lines).toHaveLength(2);
      expect(lines[0].author).toBe('Alice');
      expect(lines[1].author).toBe('Bob');
    });

    it('should handle empty output', () => {
      expect(parseBlameOutput('')).toHaveLength(0);
      expect(parseBlameOutput('\n\n')).toHaveLength(0);
    });
  });

  describe('groupBlameLines', () => {
    it('should group consecutive lines by same author and commit', () => {
      const lines: BlameLineInfo[] = [
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 1,
          finalLine: 1,
          author: 'John',
          authorEmail: 'john@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'John',
          committerEmail: 'john@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 2,
          finalLine: 2,
          author: 'John',
          authorEmail: 'john@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'John',
          committerEmail: 'john@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 3,
          finalLine: 3,
          author: 'John',
          authorEmail: 'john@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'John',
          committerEmail: 'john@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
      ];

      const chunks = groupBlameLines(lines, 'test.ts');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].lineStart).toBe(1);
      expect(chunks[0].lineEnd).toBe(3);
      expect(chunks[0].author).toBe('John');
    });

    it('should create separate chunks for different authors', () => {
      const lines: BlameLineInfo[] = [
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 1,
          finalLine: 1,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'Alice',
          committerEmail: 'alice@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
        {
          commitHash: 'def456789012345678901234567890abcdef12',
          originalLine: 2,
          finalLine: 2,
          author: 'Bob',
          authorEmail: 'bob@example.com',
          authorTime: 1609545600,
          authorTz: '+0000',
          committer: 'Bob',
          committerEmail: 'bob@example.com',
          committerTime: 1609545600,
          committerTz: '+0000',
          summary: 'commit 2',
          filename: 'test.ts',
        },
      ];

      const chunks = groupBlameLines(lines, 'test.ts');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].author).toBe('Alice');
      expect(chunks[1].author).toBe('Bob');
    });

    it('should handle non-consecutive lines', () => {
      const lines: BlameLineInfo[] = [
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 1,
          finalLine: 1,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'Alice',
          committerEmail: 'alice@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
        {
          commitHash: 'abc123def456789012345678901234567890abcd',
          originalLine: 5,
          finalLine: 5,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          authorTime: 1609459200,
          authorTz: '+0000',
          committer: 'Alice',
          committerEmail: 'alice@example.com',
          committerTime: 1609459200,
          committerTz: '+0000',
          summary: 'commit',
          filename: 'test.ts',
        },
      ];

      const chunks = groupBlameLines(lines, 'test.ts');

      // Non-consecutive lines should be separate chunks even with same author
      expect(chunks).toHaveLength(2);
    });

    it('should handle empty input', () => {
      expect(groupBlameLines([], 'test.ts')).toHaveLength(0);
    });
  });

  describe('Integration with Storage', () => {
    let storage: LiBrainianStorage;
    let dbPath: string;
    const testDir = join(tmpdir(), 'blame-indexer-test-' + Date.now());

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

    it('should store and retrieve blame entries', async () => {
      const entries = [
        {
          id: 'test-entry-1',
          filePath: 'src/test.ts',
          lineStart: 1,
          lineEnd: 10,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          commitHash: 'abc123def456789012345678901234567890abcd',
          commitDate: '2021-01-01T00:00:00Z',
          originalLine: 1,
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'test-entry-2',
          filePath: 'src/test.ts',
          lineStart: 11,
          lineEnd: 20,
          author: 'Bob',
          authorEmail: 'bob@example.com',
          commitHash: 'def456789012345678901234567890abcdef12',
          commitDate: '2021-01-02T00:00:00Z',
          originalLine: 11,
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertBlameEntries(entries);

      const retrieved = await storage.getBlameEntries({ filePath: 'src/test.ts' });
      expect(retrieved).toHaveLength(2);
    });

    it('should query blame entries by author', async () => {
      const entries = [
        {
          id: 'test-entry-1',
          filePath: 'src/a.ts',
          lineStart: 1,
          lineEnd: 10,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          commitHash: 'abc123def456789012345678901234567890abcd',
          commitDate: '2021-01-01T00:00:00Z',
          originalLine: 1,
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'test-entry-2',
          filePath: 'src/b.ts',
          lineStart: 1,
          lineEnd: 5,
          author: 'Bob',
          authorEmail: 'bob@example.com',
          commitHash: 'def456789012345678901234567890abcdef12',
          commitDate: '2021-01-02T00:00:00Z',
          originalLine: 1,
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertBlameEntries(entries);

      const aliceEntries = await storage.getBlameEntries({ author: 'Alice' });
      expect(aliceEntries).toHaveLength(1);
      expect(aliceEntries[0].filePath).toBe('src/a.ts');
    });

    it('should calculate blame stats for a file', async () => {
      const entries = [
        {
          id: 'test-entry-1',
          filePath: 'src/test.ts',
          lineStart: 1,
          lineEnd: 70,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          commitHash: 'abc123def456789012345678901234567890abcd',
          commitDate: '2021-01-01T00:00:00Z',
          originalLine: 1,
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'test-entry-2',
          filePath: 'src/test.ts',
          lineStart: 71,
          lineEnd: 100,
          author: 'Bob',
          authorEmail: 'bob@example.com',
          commitHash: 'def456789012345678901234567890abcdef12',
          commitDate: '2021-01-02T00:00:00Z',
          originalLine: 71,
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertBlameEntries(entries);

      const stats = await storage.getBlameStats('src/test.ts');
      expect(stats).not.toBeNull();
      expect(stats!.topContributor).toBe('Alice');
      expect(stats!.totalLines).toBe(100);
      expect(stats!.authorsByLines['Alice']).toBe(70);
      expect(stats!.authorsByLines['Bob']).toBe(30);
    });

    it('should delete blame entries for a file', async () => {
      const entries = [
        {
          id: 'test-entry-1',
          filePath: 'src/test.ts',
          lineStart: 1,
          lineEnd: 10,
          author: 'Alice',
          authorEmail: 'alice@example.com',
          commitHash: 'abc123def456789012345678901234567890abcd',
          commitDate: '2021-01-01T00:00:00Z',
          originalLine: 1,
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertBlameEntries(entries);
      await storage.deleteBlameForFile('src/test.ts');

      const retrieved = await storage.getBlameEntries({ filePath: 'src/test.ts' });
      expect(retrieved).toHaveLength(0);
    });
  });
});
