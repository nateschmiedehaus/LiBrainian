/**
 * @fileoverview Tests for Deterministic Replay Mode (WU-THIMPL-205)
 *
 * Tests cover:
 * - Basic replay functionality
 * - Hash verification (match and mismatch)
 * - Stop on mismatch option
 * - Record new evidence option
 * - Progress reporting
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  SqliteEvidenceLedger,
  createSessionId,
  ReplaySession,
  replaySession,
  DEFAULT_REPLAY_OPTIONS,
  type EvidenceEntry,
  type ExtractionEvidence,
  type ReplayOptions,
  type ReplayProgress,
} from '../evidence_ledger.js';
import { deterministic } from '../confidence.js';

describe('Deterministic Replay Mode (WU-THIMPL-205)', () => {
  let ledger: SqliteEvidenceLedger;
  let dbPath: string;
  const testSessionId = createSessionId('sess_replay_test');

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-replay-${Date.now()}.db`);
    ledger = new SqliteEvidenceLedger(dbPath);
    await ledger.initialize();
  });

  afterEach(async () => {
    await ledger.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Helper to create test entries with hashes
  async function createTestSession(
    entryCount: number = 3
  ): Promise<{ sessionId: typeof testSessionId; entries: EvidenceEntry[] }> {
    const entries: EvidenceEntry[] = [];

    for (let i = 0; i < entryCount; i++) {
      const payload: ExtractionEvidence = {
        filePath: `/test${i}.ts`,
        extractionType: 'function',
        entity: {
          name: `fn${i}`,
          kind: 'function',
          location: { file: `/test${i}.ts`, startLine: i + 1 },
        },
        quality: 'ast_verified',
      };

      // Compute hash of expected output for verification
      const outputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ extracted: `fn${i}` }))
        .digest('hex');

      const entry = await ledger.append({
        kind: 'extraction',
        payload,
        provenance: {
          source: 'ast_parser',
          method: 'typescript_parser',
          inputHash: outputHash, // Store expected output hash
        },
        relatedEntries: [],
        sessionId: testSessionId,
        confidence: deterministic(true, 'test'),
      });

      entries.push(entry);
    }

    return { sessionId: testSessionId, entries };
  }

  describe('replaySession - Basic Functionality', () => {
    it('should replay all entries in a session', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          // Return expected output that matches the hash
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.entriesProcessed).toBe(3);
      expect(result.success).toBe(true);
    });

    it('should have sensible default options', () => {
      expect(DEFAULT_REPLAY_OPTIONS.verifyHashes).toBe(true);
      expect(DEFAULT_REPLAY_OPTIONS.stopOnMismatch).toBe(false);
      expect(DEFAULT_REPLAY_OPTIONS.recordNewEvidence).toBe(false);
    });
  });

  describe('replaySession - Hash Verification', () => {
    it('should verify hashes and report matches', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.hashMatches).toBe(3);
      expect(result.hashMismatches).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should detect hash mismatches', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          // Return different output that won't match hash
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name + '_modified' };
        },
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.hashMatches).toBe(0);
      expect(result.hashMismatches).toBe(3);
      expect(result.success).toBe(false);
      expect(result.mismatchSummary).toHaveLength(3);
    });

    it('should skip verification for entries without hashes', async () => {
      // Create entry without hash
      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'noHash', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: {
          source: 'ast_parser',
          method: 'test',
          // No inputHash
        },
        relatedEntries: [],
        sessionId: testSessionId,
      });

      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async () => ({ result: 'anything' }),
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.entriesWithoutHash).toBe(1);
      expect(result.hashMatches).toBe(0);
      expect(result.hashMismatches).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe('replaySession - Stop on Mismatch', () => {
    it('should stop on first mismatch when option is set', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async () => ({ wrong: 'output' }),
        { verifyHashes: true, stopOnMismatch: true, recordNewEvidence: false }
      );

      expect(result.entriesProcessed).toBe(1); // Stopped after first
      expect(result.success).toBe(false);
      expect(result.hashMismatches).toBe(1);
    });

    it('should continue on mismatch when option is false', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async () => ({ wrong: 'output' }),
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.entriesProcessed).toBe(3);
      expect(result.hashMismatches).toBe(3);
    });
  });

  describe('replaySession - Record New Evidence', () => {
    it('should record new evidence when option is set', async () => {
      await createTestSession(2);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const replaySessionId = createSessionId('sess_replay_new');
      const result = await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        {
          verifyHashes: true,
          stopOnMismatch: false,
          recordNewEvidence: true,
          replaySessionId,
        },
        ledger
      );

      expect(result.replaySessionId).toBe(replaySessionId);

      // Check new entries were created
      const newSession = await ReplaySession.fromSessionId(ledger, replaySessionId);
      expect(newSession.entries).toHaveLength(2);
    });

    it('should throw if ledger not provided when recording', async () => {
      await createTestSession(1);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      await expect(
        replaySession(
          session,
          async () => ({}),
          { verifyHashes: false, stopOnMismatch: false, recordNewEvidence: true }
          // No ledger provided
        )
      ).rejects.toThrow('ledger is required');
    });

    it('should generate session ID if not provided', async () => {
      await createTestSession(1);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        {
          verifyHashes: true,
          stopOnMismatch: false,
          recordNewEvidence: true,
          // No replaySessionId provided - should be auto-generated
        },
        ledger
      );

      expect(result.replaySessionId).toBeDefined();
      expect(result.replaySessionId).toContain('replay_');
    });
  });

  describe('replaySession - Progress Reporting', () => {
    it('should call progress callback for each entry', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const progressUpdates: ReplayProgress[] = [];

      await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        {
          verifyHashes: true,
          stopOnMismatch: false,
          recordNewEvidence: false,
          onProgress: (progress) => progressUpdates.push({ ...progress }),
        }
      );

      expect(progressUpdates).toHaveLength(3);
      expect(progressUpdates[0].currentIndex).toBe(0);
      expect(progressUpdates[0].totalEntries).toBe(3);
      expect(progressUpdates[2].currentIndex).toBe(2);
    });

    it('should report match status in progress', async () => {
      await createTestSession(2);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const progressUpdates: ReplayProgress[] = [];
      let callCount = 0;

      await replaySession(
        session,
        async (entry) => {
          callCount++;
          // First call matches, second doesn't
          if (callCount === 1) {
            const payload = entry.payload as ExtractionEvidence;
            return { extracted: payload.entity.name };
          }
          return { wrong: 'output' };
        },
        {
          verifyHashes: true,
          stopOnMismatch: false,
          recordNewEvidence: false,
          onProgress: (progress) => progressUpdates.push({ ...progress }),
        }
      );

      expect(progressUpdates[0].matched).toBe(true);
      expect(progressUpdates[1].matched).toBe(false);
    });
  });

  describe('replaySession - Error Handling', () => {
    it('should handle executor errors', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      let callCount = 0;
      const result = await replaySession(
        session,
        async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Executor failed');
          }
          return { ok: true };
        },
        { verifyHashes: false, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.executorErrors).toBe(1);
      expect(result.entriesProcessed).toBe(3);
      expect(result.success).toBe(false);

      const errorEntry = result.entryResults.find((r) => r.error);
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.error?.message).toBe('Executor failed');
    });

    it('should stop on executor error when stopOnMismatch is true', async () => {
      await createTestSession(3);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async () => {
          throw new Error('Fail');
        },
        { verifyHashes: false, stopOnMismatch: true, recordNewEvidence: false }
      );

      expect(result.entriesProcessed).toBe(1);
      expect(result.executorErrors).toBe(1);
      expect(result.success).toBe(false);
    });
  });

  describe('replaySession - Duration Tracking', () => {
    it('should track replay duration', async () => {
      await createTestSession(2);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('replaySession - Entry Results', () => {
    it('should provide detailed results for each entry', async () => {
      await createTestSession(2);
      const session = await ReplaySession.fromSessionId(ledger, testSessionId);

      const result = await replaySession(
        session,
        async (entry) => {
          const payload = entry.payload as ExtractionEvidence;
          return { extracted: payload.entity.name };
        },
        { verifyHashes: true, stopOnMismatch: false, recordNewEvidence: false }
      );

      expect(result.entryResults).toHaveLength(2);

      const firstResult = result.entryResults[0];
      expect(firstResult.originalEntry).toBeDefined();
      expect(firstResult.executorResult).toEqual({ extracted: 'fn0' });
      expect(firstResult.hashMatched).toBe(true);
      expect(firstResult.expectedHash).toBeDefined();
      expect(firstResult.actualHash).toBeDefined();
    });
  });
});
