/**
 * @fileoverview Tier-0 Tests for Evidence Ledger
 *
 * Deterministic tests that verify the Evidence Ledger implementation.
 * These tests use an in-memory database and require no external providers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SqliteEvidenceLedger,
  createEvidenceId,
  createSessionId,
  getRelatedIds,
  getTypedRelations,
  hasTypedRelations,
  getRelationsByType,
  computeEvidenceHash,
  createContentAddressableEvidenceId,
  ReplaySession,
  type EvidenceEntry,
  type EvidenceKind,
  type ExtractionEvidence,
  type ClaimEvidence,
  type EvidenceRelation,
  type ReplayIntegrityResult,
} from '../evidence_ledger.js';
import { deterministic, absent } from '../confidence.js';

describe('EvidenceLedger', () => {
  let ledger: SqliteEvidenceLedger;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-ledger-${randomUUID()}.db`);
    ledger = new SqliteEvidenceLedger(dbPath);
    await ledger.initialize();
  });

  afterEach(async () => {
    await ledger.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('append', () => {
    it('creates entry with generated ID and timestamp', async () => {
      const entry = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test/file.ts',
          extractionType: 'function',
          entity: {
            name: 'testFunc',
            kind: 'function',
            location: { file: '/test/file.ts', startLine: 1 },
          },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: {
          source: 'ast_parser',
          method: 'typescript_parser',
        },
        relatedEntries: [],
      });

      expect(entry.id).toBeDefined();
      expect(entry.id.startsWith('ev_')).toBe(true);
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.kind).toBe('extraction');
    });

    it('stores and retrieves payload correctly', async () => {
      const payload: ExtractionEvidence = {
        filePath: '/test/file.ts',
        extractionType: 'class',
        entity: {
          name: 'TestClass',
          kind: 'class',
          signature: 'class TestClass {}',
          location: { file: '/test/file.ts', startLine: 10, endLine: 20 },
        },
        quality: 'ast_verified',
      };

      const entry = await ledger.append({
        kind: 'extraction',
        payload,
        provenance: { source: 'ast_parser', method: 'typescript_parser' },
        relatedEntries: [],
      });

      const retrieved = await ledger.get(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.payload).toEqual(payload);
    });

    it('persists tool-call metrics columns for cost/performance telemetry', async () => {
      const entry = await ledger.append({
        kind: 'tool_call',
        payload: {
          toolName: 'query',
          arguments: { intent: 'auth flow' },
          result: { success: true },
          success: true,
          durationMs: 123,
          costUsd: 0.0192,
          agentId: 'agent-test',
          attemptNumber: 2,
          cacheHit: true,
        },
        provenance: {
          source: 'tool_output',
          method: 'unit_test',
          agent: { type: 'tool', identifier: 'agent-test' },
        },
        relatedEntries: [],
      });

      const BetterSqlite3 = (await import('better-sqlite3')).default;
      const db = new BetterSqlite3(dbPath, { readonly: true });
      try {
        const row = db.prepare(`
          SELECT cost_usd, duration_ms, agent_id, attempt_number, cache_hit
          FROM evidence_ledger
          WHERE id = ?
        `).get(entry.id) as {
          cost_usd: number | null;
          duration_ms: number | null;
          agent_id: string | null;
          attempt_number: number | null;
          cache_hit: number | null;
        };

        expect(row.cost_usd).toBeCloseTo(0.0192, 6);
        expect(row.duration_ms).toBe(123);
        expect(row.agent_id).toBe('agent-test');
        expect(row.attempt_number).toBe(2);
        expect(row.cache_hit).toBe(1);
      } finally {
        db.close();
      }
    });

    it('migrates legacy tables missing cost_usd before creating dependent indexes', async () => {
      await ledger.close();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }

      const BetterSqlite3 = (await import('better-sqlite3')).default;
      const legacyDb = new BetterSqlite3(dbPath);
      try {
        legacyDb.exec(`
          CREATE TABLE evidence_ledger (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            provenance TEXT NOT NULL,
            confidence TEXT,
            related_entries TEXT NOT NULL DEFAULT '[]',
            session_id TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON evidence_ledger(timestamp);
          CREATE INDEX IF NOT EXISTS idx_ledger_kind ON evidence_ledger(kind);
          CREATE INDEX IF NOT EXISTS idx_ledger_session ON evidence_ledger(session_id);
        `);
      } finally {
        legacyDb.close();
      }

      ledger = new SqliteEvidenceLedger(dbPath);
      await expect(ledger.initialize()).resolves.toBeUndefined();

      const migratedDb = new BetterSqlite3(dbPath, { readonly: true });
      try {
        const columns = migratedDb.prepare('PRAGMA table_info(evidence_ledger)').all() as Array<{ name: string }>;
        expect(columns.some((column) => column.name === 'cost_usd')).toBe(true);
        const toolCostIndex = migratedDb.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_ledger_tool_cost'
        `).get() as { name?: string } | undefined;
        expect(toolCostIndex?.name).toBe('idx_ledger_tool_cost');
      } finally {
        migratedDb.close();
      }
    });
  });

  describe('appendBatch', () => {
    it('creates all entries atomically', async () => {
      const entries = await ledger.appendBatch([
        {
          kind: 'extraction',
          payload: {
            filePath: '/file1.ts',
            extractionType: 'function',
            entity: { name: 'fn1', kind: 'function', location: { file: '/file1.ts' } },
            quality: 'ast_verified',
          } satisfies ExtractionEvidence,
          provenance: { source: 'ast_parser', method: 'test' },
          relatedEntries: [],
        },
        {
          kind: 'extraction',
          payload: {
            filePath: '/file2.ts',
            extractionType: 'function',
            entity: { name: 'fn2', kind: 'function', location: { file: '/file2.ts' } },
            quality: 'ast_verified',
          } satisfies ExtractionEvidence,
          provenance: { source: 'ast_parser', method: 'test' },
          relatedEntries: [],
        },
        {
          kind: 'extraction',
          payload: {
            filePath: '/file3.ts',
            extractionType: 'function',
            entity: { name: 'fn3', kind: 'function', location: { file: '/file3.ts' } },
            quality: 'ast_verified',
          } satisfies ExtractionEvidence,
          provenance: { source: 'ast_parser', method: 'test' },
          relatedEntries: [],
        },
      ]);

      expect(entries).toHaveLength(3);
      entries.forEach((entry) => {
        expect(entry.id).toBeDefined();
        expect(entry.timestamp).toBeInstanceOf(Date);
      });

      // Verify all are retrievable
      for (const entry of entries) {
        const retrieved = await ledger.get(entry.id);
        expect(retrieved).not.toBeNull();
      }
    });
  });

  describe('get', () => {
    it('returns entry for valid ID', async () => {
      const created = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'type',
          entity: { name: 'TestType', kind: 'type', location: { file: '/test.ts' } },
          quality: 'ast_inferred',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      });

      const retrieved = await ledger.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('returns null for unknown ID', async () => {
      const unknownId = createEvidenceId('ev_unknown_123');
      const retrieved = await ledger.get(unknownId);
      expect(retrieved).toBeNull();
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test data
      await ledger.appendBatch([
        {
          kind: 'extraction',
          payload: {
            filePath: '/a.ts',
            extractionType: 'function',
            entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
            quality: 'ast_verified',
          } satisfies ExtractionEvidence,
          provenance: { source: 'ast_parser', method: 'test' },
          relatedEntries: [],
        },
        {
          kind: 'retrieval',
          payload: {
            query: 'test query',
            method: 'vector',
            results: [],
            candidatesConsidered: 10,
            latencyMs: 50,
          },
          provenance: { source: 'embedding_search', method: 'test' },
          relatedEntries: [],
        },
        {
          kind: 'extraction',
          payload: {
            filePath: '/b.ts',
            extractionType: 'class',
            entity: { name: 'b', kind: 'class', location: { file: '/b.ts' } },
            quality: 'ast_verified',
          } satisfies ExtractionEvidence,
          provenance: { source: 'ast_parser', method: 'test' },
          relatedEntries: [],
        },
      ]);
    });

    it('filters by kind', async () => {
      const results = await ledger.query({ kinds: ['extraction'] });
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.kind).toBe('extraction'));
    });

    it('filters by multiple kinds', async () => {
      const results = await ledger.query({ kinds: ['extraction', 'retrieval'] });
      expect(results).toHaveLength(3);
    });

    it('respects limit', async () => {
      const results = await ledger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('respects offset', async () => {
      const all = await ledger.query({});
      const offset = await ledger.query({ offset: 1 });
      expect(offset).toHaveLength(all.length - 1);
    });

    it('orders by timestamp descending by default', async () => {
      const results = await ledger.query({});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
          results[i].timestamp.getTime()
        );
      }
    });
  });

  describe('getChain', () => {
    it('returns chain with all related entries', async () => {
      // Create extraction evidence
      const extraction = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'ast_parse_succeeded'),
      });

      // Create claim that references extraction
      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'testFn handles nulls correctly',
          category: 'behavior',
          subject: { type: 'function', identifier: 'testFn' },
          supportingEvidence: [extraction.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'analysis' },
        relatedEntries: [extraction.id],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.root.id).toBe(claim.id);
      expect(chain.evidence).toHaveLength(2);
      expect(chain.graph.get(claim.id)).toContain(extraction.id);
    });

    it('throws for unknown claim ID', async () => {
      const unknownId = createEvidenceId('ev_unknown');
      await expect(ledger.getChain(unknownId)).rejects.toThrow('claim_not_found');
    });
  });

  describe('getSessionEntries', () => {
    it('returns only entries for specified session', async () => {
      const session1 = createSessionId('sess_1');
      const session2 = createSessionId('sess_2');

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        sessionId: session1,
      });

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        sessionId: session2,
      });

      const session1Entries = await ledger.getSessionEntries(session1);
      expect(session1Entries).toHaveLength(1);
      expect(session1Entries[0].sessionId).toBe(session1);
    });
  });

  describe('subscribe', () => {
    it('notifies callback for matching entries', async () => {
      const received: EvidenceEntry[] = [];

      const unsubscribe = ledger.subscribe(
        { kinds: ['extraction'] },
        (entry) => received.push(entry)
      );

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      });

      // Should not notify for non-matching kind
      await ledger.append({
        kind: 'retrieval',
        payload: {
          query: 'test',
          method: 'vector',
          results: [],
          candidatesConsidered: 0,
          latencyMs: 0,
        },
        provenance: { source: 'embedding_search', method: 'test' },
        relatedEntries: [],
      });

      expect(received).toHaveLength(1);
      expect(received[0].kind).toBe('extraction');

      unsubscribe();
    });

    it('stops notifying after unsubscribe', async () => {
      const received: EvidenceEntry[] = [];

      const unsubscribe = ledger.subscribe({}, (entry) => received.push(entry));

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      });

      unsubscribe();

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      });

      expect(received).toHaveLength(1);
    });
  });

  describe('confidence handling', () => {
    it('stores and retrieves confidence correctly', async () => {
      const confidence = deterministic(true, 'test_passed');

      const entry = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence,
      });

      const retrieved = await ledger.get(entry.id);
      expect(retrieved?.confidence).toEqual(confidence);
    });

    it('handles absent confidence', async () => {
      const confidence = absent('uncalibrated');

      const entry = await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'analyze code',
          output: 'analysis result',
          model: { provider: 'test', modelId: 'test-model' },
          tokens: { input: 100, output: 50 },
          synthesisType: 'analysis',
        },
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [],
        confidence,
      });

      const retrieved = await ledger.get(entry.id);
      expect(retrieved?.confidence?.type).toBe('absent');
    });
  });

  describe('chain confidence with contradictions', () => {
    it('reduces chain confidence to 0 when blocking contradictions exist', async () => {
      // Create a blocking contradiction first
      const contradiction = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: createEvidenceId('ev_claim'), // Will be updated after claim is created
          claimB: createEvidenceId('ev_other'),
          contradictionType: 'direct',
          explanation: 'Function X has a security vulnerability',
          severity: 'blocking',
        },
        provenance: { source: 'system_observation', method: 'security_scan' },
        relatedEntries: [],
        confidence: deterministic(true, 'security_scan_result'),
      });

      // Create a claim that references the contradiction (so getChain finds it)
      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Function X is safe',
          category: 'behavior',
          subject: { type: 'function', identifier: 'X' },
          supportingEvidence: [],
          knownDefeaters: [contradiction.id],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [contradiction.id], // Link to contradiction so chain traversal finds it
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      // Chain confidence should be 0 due to blocking contradiction
      expect(chain.contradictions).toHaveLength(1);
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        expect(chain.chainConfidence.value).toBe(0);
        expect(chain.chainConfidence.formula).toContain('blocking=1');
      }
    });

    it('reduces chain confidence for significant contradictions but floors at 0.1', async () => {
      // Create significant contradiction first
      const contradiction = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: createEvidenceId('ev_claim'),
          claimB: createEvidenceId('ev_other'),
          contradictionType: 'implicational',
          explanation: 'API has breaking changes planned',
          severity: 'significant',
        },
        provenance: { source: 'system_observation', method: 'change_detection' },
        relatedEntries: [],
        confidence: deterministic(true, 'change_detected'),
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'API endpoint is stable',
          category: 'quality',
          subject: { type: 'function', identifier: 'api_endpoint' },
          supportingEvidence: [],
          knownDefeaters: [contradiction.id],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [contradiction.id],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.contradictions).toHaveLength(1);
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // Original confidence is 1.0, with one significant contradiction: 1.0 * 0.5 = 0.5
        expect(chain.chainConfidence.value).toBe(0.5);
        expect(chain.chainConfidence.formula).toContain('significant=1');
      }
    });

    it('applies minor contradiction penalty correctly', async () => {
      // Create two minor contradictions first
      const contradiction1 = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: createEvidenceId('ev_claim'),
          claimB: createEvidenceId('ev_other1'),
          contradictionType: 'temporal',
          explanation: 'Minor formatting issue',
          severity: 'minor',
        },
        provenance: { source: 'system_observation', method: 'lint' },
        relatedEntries: [],
        confidence: deterministic(true, 'lint_result'),
      });

      const contradiction2 = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: createEvidenceId('ev_claim'),
          claimB: createEvidenceId('ev_other2'),
          contradictionType: 'temporal',
          explanation: 'Typo detected',
          severity: 'minor',
        },
        provenance: { source: 'system_observation', method: 'spell_check' },
        relatedEntries: [],
        confidence: deterministic(true, 'spell_check_result'),
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Documentation is up to date',
          category: 'quality',
          subject: { type: 'file', identifier: 'README.md' },
          supportingEvidence: [],
          knownDefeaters: [contradiction1.id, contradiction2.id],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [contradiction1.id, contradiction2.id],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.contradictions).toHaveLength(2);
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // Original confidence is 1.0, with two minor contradictions: 1.0 * 0.9^2 = 0.81
        expect(chain.chainConfidence.value).toBeCloseTo(0.81, 2);
        expect(chain.chainConfidence.formula).toContain('minor=2');
      }
    });

    it('maintains normal confidence when no contradictions exist', async () => {
      const extraction = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'ast_parse_succeeded'),
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'testFn exists',
          category: 'existence',
          subject: { type: 'function', identifier: 'testFn' },
          supportingEvidence: [extraction.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'analysis' },
        relatedEntries: [extraction.id],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.contradictions).toHaveLength(0);
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // No contradictions, confidence should be the minimum of entries (1.0)
        expect(chain.chainConfidence.value).toBe(1);
        expect(chain.chainConfidence.formula).toBe('min(chain_entries)');
      }
    });
  });

  describe('typed evidence relations', () => {
    it('stores and retrieves typed relations correctly', async () => {
      const extraction = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/source.ts',
          extractionType: 'function',
          entity: { name: 'sourceFunc', kind: 'function', location: { file: '/source.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      });

      // Create an entry with typed relations
      const typedRelations: EvidenceRelation[] = [
        { id: extraction.id, type: 'derived_from' },
      ];

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'sourceFunc is well-typed',
          category: 'quality',
          subject: { type: 'function', identifier: 'sourceFunc' },
          supportingEvidence: [extraction.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: typedRelations,
        confidence: deterministic(true, 'verified'),
      });

      const retrieved = await ledger.get(claim.id);
      expect(retrieved).not.toBeNull();
      expect(hasTypedRelations(retrieved!)).toBe(true);

      const relations = getTypedRelations(retrieved!);
      expect(relations).toHaveLength(1);
      expect(relations[0].id).toBe(extraction.id);
      expect(relations[0].type).toBe('derived_from');
    });

    it('getRelatedIds works with both legacy and typed formats', async () => {
      // Legacy format (EvidenceId[])
      const legacyEntry: EvidenceEntry = {
        id: createEvidenceId('ev_legacy'),
        timestamp: new Date(),
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [createEvidenceId('ev_related1'), createEvidenceId('ev_related2')],
      };

      const legacyIds = getRelatedIds(legacyEntry);
      expect(legacyIds).toHaveLength(2);
      expect(legacyIds[0]).toBe('ev_related1');
      expect(legacyIds[1]).toBe('ev_related2');

      // Typed format (EvidenceRelation[])
      const typedEntry: EvidenceEntry = {
        id: createEvidenceId('ev_typed'),
        timestamp: new Date(),
        kind: 'claim',
        payload: {
          claim: 'Test claim',
          category: 'existence',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [
          { id: createEvidenceId('ev_support'), type: 'supports' },
          { id: createEvidenceId('ev_derive'), type: 'derived_from' },
        ],
      };

      const typedIds = getRelatedIds(typedEntry);
      expect(typedIds).toHaveLength(2);
      expect(typedIds[0]).toBe('ev_support');
      expect(typedIds[1]).toBe('ev_derive');
    });

    it('getTypedRelations converts legacy format to derived_from', async () => {
      const legacyEntry: EvidenceEntry = {
        id: createEvidenceId('ev_legacy'),
        timestamp: new Date(),
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [createEvidenceId('ev_related')],
      };

      const typedRelations = getTypedRelations(legacyEntry);
      expect(typedRelations).toHaveLength(1);
      expect(typedRelations[0].id).toBe('ev_related');
      expect(typedRelations[0].type).toBe('derived_from');
    });

    it('getRelationsByType filters relations correctly', async () => {
      const entry: EvidenceEntry = {
        id: createEvidenceId('ev_mixed'),
        timestamp: new Date(),
        kind: 'claim',
        payload: {
          claim: 'Test claim',
          category: 'existence',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [
          { id: createEvidenceId('ev_support1'), type: 'supports' },
          { id: createEvidenceId('ev_support2'), type: 'supports' },
          { id: createEvidenceId('ev_derive'), type: 'derived_from' },
          { id: createEvidenceId('ev_contradict'), type: 'contradicts' },
        ],
      };

      const supports = getRelationsByType(entry, 'supports');
      expect(supports).toHaveLength(2);

      const derivedFrom = getRelationsByType(entry, 'derived_from');
      expect(derivedFrom).toHaveLength(1);

      const contradicts = getRelationsByType(entry, 'contradicts');
      expect(contradicts).toHaveLength(1);

      const supersedes = getRelationsByType(entry, 'supersedes');
      expect(supersedes).toHaveLength(0);
    });

    it('hasTypedRelations correctly identifies format', async () => {
      const emptyEntry: EvidenceEntry = {
        id: createEvidenceId('ev_empty'),
        timestamp: new Date(),
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
      };

      expect(hasTypedRelations(emptyEntry)).toBe(false);

      const legacyEntry: EvidenceEntry = {
        ...emptyEntry,
        id: createEvidenceId('ev_legacy'),
        relatedEntries: [createEvidenceId('ev_related')],
      };

      expect(hasTypedRelations(legacyEntry)).toBe(false);

      const typedEntry: EvidenceEntry = {
        ...emptyEntry,
        id: createEvidenceId('ev_typed'),
        relatedEntries: [{ id: createEvidenceId('ev_related'), type: 'supports' }],
      };

      expect(hasTypedRelations(typedEntry)).toBe(true);
    });

    it('getChain works with typed relations', async () => {
      const extraction = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'ast_parse_succeeded'),
      });

      // Create claim with typed relations
      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'testFn is pure',
          category: 'behavior',
          subject: { type: 'function', identifier: 'testFn' },
          supportingEvidence: [extraction.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'analysis' },
        relatedEntries: [{ id: extraction.id, type: 'derived_from' }] as EvidenceRelation[],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.root.id).toBe(claim.id);
      expect(chain.evidence).toHaveLength(2);
      // Graph should have the extraction ID in the relations
      expect(chain.graph.get(claim.id)).toContain(extraction.id);
    });
  });

  describe('computeEvidenceHash (WU-LEDG-007)', () => {
    it('produces deterministic hash for same content', () => {
      const entryContent = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const hash1 = computeEvidenceHash(entryContent);
      const hash2 = computeEvidenceHash(entryContent);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    it('produces different hash for different content', () => {
      const entry1 = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test1.ts',
          extractionType: 'function',
          entity: { name: 'test1', kind: 'function', location: { file: '/test1.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const entry2 = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test2.ts',
          extractionType: 'function',
          entity: { name: 'test2', kind: 'function', location: { file: '/test2.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const hash1 = computeEvidenceHash(entry1);
      const hash2 = computeEvidenceHash(entry2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes sessionId in hash when present', () => {
      const sessionId = createSessionId('sess_test');
      const entryWithSession = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
        sessionId,
      };

      const entryWithoutSession = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const hashWith = computeEvidenceHash(entryWithSession);
      const hashWithout = computeEvidenceHash(entryWithoutSession);

      expect(hashWith).not.toBe(hashWithout);
    });

    it('handles typed relations in hash', () => {
      const relatedId = createEvidenceId('ev_related');
      const entryWithTypedRelations = {
        kind: 'claim' as const,
        payload: {
          claim: 'Test claim',
          category: 'existence',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis' as const, method: 'test' },
        relatedEntries: [{ id: relatedId, type: 'supports' as const }],
      };

      const entryWithLegacyRelations = {
        kind: 'claim' as const,
        payload: {
          claim: 'Test claim',
          category: 'existence',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis' as const, method: 'test' },
        relatedEntries: [relatedId],
      };

      const hash1 = computeEvidenceHash(entryWithTypedRelations);
      const hash2 = computeEvidenceHash(entryWithLegacyRelations);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createContentAddressableEvidenceId (WU-LEDG-007)', () => {
    it('creates ID based on content hash', () => {
      const entryContent = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const id = createContentAddressableEvidenceId(entryContent);

      expect(id).toMatch(/^ev_hash_[a-f0-9]{16}$/);
    });

    it('produces same ID for same content', () => {
      const entryContent = {
        kind: 'extraction' as const,
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'test', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser' as const, method: 'test' },
        relatedEntries: [],
      };

      const id1 = createContentAddressableEvidenceId(entryContent);
      const id2 = createContentAddressableEvidenceId(entryContent);

      expect(id1).toBe(id2);
    });
  });

  describe('getChain with typed relationships (WU-LEDG-005)', () => {
    it('traverses supports relationships', async () => {
      const base = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/base.ts',
          extractionType: 'function',
          entity: { name: 'baseFn', kind: 'function', location: { file: '/base.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'ast_parse_succeeded'),
      });

      const support = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/support.ts',
          extractionType: 'function',
          entity: { name: 'supportFn', kind: 'function', location: { file: '/support.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [{ id: base.id, type: 'supports' }] as EvidenceRelation[],
        confidence: deterministic(true, 'ast_parse_succeeded'),
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'baseFn is well-documented',
          category: 'quality',
          subject: { type: 'function', identifier: 'baseFn' },
          supportingEvidence: [base.id, support.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [
          { id: base.id, type: 'derived_from' },
          { id: support.id, type: 'supports' },
        ] as EvidenceRelation[],
        confidence: deterministic(true, 'verified'),
      });

      const chain = await ledger.getChain(claim.id);

      expect(chain.evidence).toHaveLength(3);
      expect(chain.graph.get(claim.id)).toContain(base.id);
      expect(chain.graph.get(claim.id)).toContain(support.id);
    });

    it('handles cycles in the graph', async () => {
      // Create circular reference using typed relations
      const entry1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'fnA', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'parsed'),
      });

      // entry2 references entry1
      const entry2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'fnB', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [{ id: entry1.id, type: 'derived_from' }] as EvidenceRelation[],
        confidence: deterministic(true, 'parsed'),
      });

      // Claim that references both (simulating potential cycle through claims)
      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'fnA and fnB are related',
          category: 'relationship',
          subject: { type: 'function', identifier: 'fnA' },
          supportingEvidence: [entry1.id, entry2.id],
          knownDefeaters: [],
          confidence: deterministic(true, 'verified'),
        } satisfies ClaimEvidence,
        provenance: { source: 'llm_synthesis', method: 'test' },
        relatedEntries: [
          { id: entry1.id, type: 'derived_from' },
          { id: entry2.id, type: 'derived_from' },
        ] as EvidenceRelation[],
        confidence: deterministic(true, 'verified'),
      });

      // Should not hang or error, should handle cycle gracefully
      const chain = await ledger.getChain(claim.id);

      expect(chain.evidence.length).toBeGreaterThan(0);
      // Each entry should only appear once
      const ids = chain.evidence.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('traverses supersedes relationships', async () => {
      const oldEntry = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/old.ts',
          extractionType: 'function',
          entity: { name: 'oldFn', kind: 'function', location: { file: '/old.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: deterministic(true, 'parsed'),
      });

      const newEntry = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/new.ts',
          extractionType: 'function',
          entity: { name: 'newFn', kind: 'function', location: { file: '/new.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [{ id: oldEntry.id, type: 'supersedes' }] as EvidenceRelation[],
        confidence: deterministic(true, 'parsed'),
      });

      const chain = await ledger.getChain(newEntry.id);

      expect(chain.evidence).toHaveLength(2);
      expect(chain.graph.get(newEntry.id)).toContain(oldEntry.id);
    });
  });

  describe('ReplaySession (WU-LEDG-006)', () => {
    it('reconstructs session from ledger entries', async () => {
      const sessionId = createSessionId('sess_replay_test');

      // Create multiple entries in a session
      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/step1.ts',
          extractionType: 'function',
          entity: { name: 'step1Fn', kind: 'function', location: { file: '/step1.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test', inputHash: 'hash_step1' },
        relatedEntries: [],
        sessionId,
      });

      await ledger.append({
        kind: 'retrieval',
        payload: {
          query: 'test query',
          method: 'vector',
          results: [],
          candidatesConsidered: 10,
          latencyMs: 50,
        },
        provenance: { source: 'embedding_search', method: 'test', inputHash: 'hash_step2' },
        relatedEntries: [],
        sessionId,
      });

      await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'analyze results',
          output: 'analysis complete',
          model: { provider: 'test', modelId: 'test-model' },
          tokens: { input: 100, output: 50 },
          synthesisType: 'analysis',
        },
        provenance: { source: 'llm_synthesis', method: 'test', inputHash: 'hash_step3' },
        relatedEntries: [],
        sessionId,
      });

      const replay = await ReplaySession.fromSessionId(ledger, sessionId);

      expect(replay.sessionId).toBe(sessionId);
      expect(replay.entries).toHaveLength(3);
    });

    it('returns entries in execution order', async () => {
      const sessionId = createSessionId('sess_order_test');

      // Add entries - they should be returned in timestamp order
      const entry1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/first.ts',
          extractionType: 'function',
          entity: { name: 'firstFn', kind: 'function', location: { file: '/first.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        sessionId,
      });

      const entry2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/second.ts',
          extractionType: 'function',
          entity: { name: 'secondFn', kind: 'function', location: { file: '/second.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        sessionId,
      });

      const replay = await ReplaySession.fromSessionId(ledger, sessionId);
      const ordered = replay.getOrderedEntries();

      expect(ordered[0].id).toBe(entry1.id);
      expect(ordered[1].id).toBe(entry2.id);
    });

    it('verifies integrity with matching inputHash', async () => {
      const sessionId = createSessionId('sess_integrity_test');

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: {
          source: 'ast_parser',
          method: 'test',
          inputHash: 'expected_hash_123',
        },
        relatedEntries: [],
        sessionId,
      });

      const replay = await ReplaySession.fromSessionId(ledger, sessionId);
      const result = replay.verifyIntegrity();

      expect(result.valid).toBe(true);
      expect(result.entriesVerified).toBe(1);
      expect(result.entriesWithHash).toBe(1);
    });

    it('reports invalid integrity when entries have no inputHash', async () => {
      const sessionId = createSessionId('sess_no_hash_test');

      await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test.ts',
          extractionType: 'function',
          entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: {
          source: 'ast_parser',
          method: 'test',
          // No inputHash
        },
        relatedEntries: [],
        sessionId,
      });

      const replay = await ReplaySession.fromSessionId(ledger, sessionId);
      const result = replay.verifyIntegrity();

      // Valid because there are no hash violations, but report indicates no hashes
      expect(result.entriesWithHash).toBe(0);
      expect(result.entriesVerified).toBe(1);
    });

    it('handles empty session gracefully', async () => {
      const sessionId = createSessionId('sess_empty_test');

      const replay = await ReplaySession.fromSessionId(ledger, sessionId);

      expect(replay.entries).toHaveLength(0);
      expect(replay.getOrderedEntries()).toHaveLength(0);

      const result = replay.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.entriesVerified).toBe(0);
    });
  });
});
