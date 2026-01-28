/**
 * @fileoverview Tests for Evidence Ledger Adapters
 *
 * Tests the adapter functions that convert various source system events
 * to EvidenceEntry format for the unified Evidence Ledger.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '../../mcp/audit.js';
import type { Episode } from '../../strategic/building_blocks.js';
import type { StageReport } from '../../types.js';
import {
  createToolCallEvidence,
  createEpisodeEvidence,
  createRetrievalEvidence,
  createExtractionEvidence,
  createExtractionEvidenceBatch,
  createRetrievalEvidenceBatch,
  type ExtractionResult,
  type QueryStageEvidenceOptions,
} from '../evidence_adapters.js';
import { createSessionId, type SessionId } from '../evidence_ledger.js';

// ============================================================================
// WU-LEDG-001: MCP AUDIT -> EVIDENCE LEDGER TESTS
// ============================================================================

describe('createToolCallEvidence', () => {
  it('converts a successful tool call audit event', () => {
    const auditEvent: AuditEvent = {
      id: 'evt_123',
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      severity: 'info',
      operation: 'librarian_query',
      status: 'success',
      sessionId: 'sess_abc',
      clientId: 'client_1',
      workspace: '/path/to/workspace',
      input: { intent: 'find async functions' },
      output: { packCount: 5 },
      durationMs: 150,
      dataHash: 'abcd1234',
    };

    const entry = createToolCallEvidence(auditEvent);

    expect(entry.kind).toBe('tool_call');
    expect(entry.payload).toEqual({
      toolName: 'librarian_query',
      toolVersion: undefined,
      arguments: { intent: 'find async functions' },
      result: { packCount: 5 },
      success: true,
      durationMs: 150,
      errorMessage: undefined,
    });
    expect(entry.provenance.source).toBe('tool_output');
    expect(entry.provenance.method).toBe('mcp_audit_adapter');
    expect(entry.provenance.agent?.type).toBe('tool');
    expect(entry.provenance.agent?.identifier).toBe('client_1');
    expect(entry.provenance.inputHash).toBe('abcd1234');
    expect(entry.sessionId).toBeDefined();
  });

  it('converts a failed tool call audit event', () => {
    const auditEvent: AuditEvent = {
      id: 'evt_124',
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      severity: 'error',
      operation: 'librarian_bootstrap',
      status: 'failure',
      error: 'Index not ready',
      durationMs: 50,
    };

    const entry = createToolCallEvidence(auditEvent);

    expect(entry.kind).toBe('tool_call');
    expect(entry.payload).toMatchObject({
      toolName: 'librarian_bootstrap',
      success: false,
      durationMs: 50,
      errorMessage: 'Index not ready',
    });
  });

  it('accepts custom session ID in options', () => {
    const auditEvent: AuditEvent = {
      id: 'evt_125',
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      severity: 'info',
      operation: 'test_tool',
      status: 'success',
    };

    const customSessionId = createSessionId('custom_session');
    const entry = createToolCallEvidence(auditEvent, { sessionId: customSessionId });

    expect(entry.sessionId).toBe(customSessionId);
  });

  it('handles audit event with metadata containing version', () => {
    const auditEvent: AuditEvent = {
      id: 'evt_126',
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      severity: 'info',
      operation: 'versioned_tool',
      status: 'success',
      metadata: { version: '1.2.3' },
    };

    const entry = createToolCallEvidence(auditEvent);

    expect((entry.payload as any).toolVersion).toBe('1.2.3');
  });
});

// ============================================================================
// WU-LEDG-002: EPISODES -> EVIDENCE LEDGER TESTS
// ============================================================================

describe('createEpisodeEvidence', () => {
  it('converts a successful episode', () => {
    const episode: Episode = {
      id: 'ep_123',
      timestamp: new Date(),
      type: 'task_execution',
      context: {
        taskId: 'task_1',
        agentId: 'agent_1',
        environment: 'development',
        state: { intent: 'Find all handlers' },
      },
      actors: [
        { id: 'agent_1', type: 'agent', role: 'executor' },
      ],
      events: [
        { order: 1, timestamp: new Date(), type: 'query', description: 'Initial query' },
        { order: 2, timestamp: new Date(), type: 'retrieval', description: 'Vector search', data: { durationMs: 50 } },
        { order: 3, timestamp: new Date(), type: 'synthesis', description: 'Generate answer' },
      ],
      outcome: {
        success: true,
        result: { answer: 'Found 5 handlers' },
        duration: 500,
      },
      lessons: [
        { insight: 'Use specific queries', confidence: 0.8, applicability: ['retrieval'] },
      ],
      metadata: {
        query: 'Find all handlers',
        retrievedEntities: 15,
      },
    };

    const entry = createEpisodeEvidence(episode);

    expect(entry.kind).toBe('episode');
    expect(entry.payload).toMatchObject({
      query: 'Find all handlers',
      totalDurationMs: 500,
      retrievedEntities: 15,
      synthesizedResponse: true,
    });
    expect((entry.payload as any).stages).toHaveLength(3);
    expect((entry.payload as any).stages[1]).toMatchObject({
      name: 'retrieval',
      durationMs: 50,
      success: true,
    });
    expect(entry.provenance.source).toBe('system_observation');
    expect(entry.provenance.method).toBe('episode_adapter');
    expect(entry.provenance.agent?.type).toBe('llm');
    expect(entry.provenance.agent?.identifier).toBe('agent_1');
    expect(entry.sessionId).toBeDefined();
  });

  it('handles episode without explicit query in metadata', () => {
    const episode: Episode = {
      id: 'ep_124',
      timestamp: new Date(),
      type: 'discovery',
      context: {
        environment: 'production',
        state: { intent: 'Explore architecture' },
      },
      actors: [],
      events: [],
      outcome: { success: false, error: 'Timeout', duration: 10000 },
      lessons: [],
      metadata: {},
    };

    const entry = createEpisodeEvidence(episode);

    expect(entry.payload).toMatchObject({
      query: 'Explore architecture', // Falls back to context.state.intent
      totalDurationMs: 10000,
      synthesizedResponse: false,
    });
  });

  it('handles episode with user actor', () => {
    const episode: Episode = {
      id: 'ep_125',
      timestamp: new Date(),
      type: 'user_interaction',
      context: { environment: 'test', state: {} },
      actors: [{ id: 'user_1', type: 'user', role: 'requester' }],
      events: [],
      outcome: { success: true, duration: 100 },
      lessons: [],
      metadata: {},
    };

    const entry = createEpisodeEvidence(episode);

    expect(entry.provenance.agent?.type).toBe('human');
    expect(entry.provenance.agent?.identifier).toBe('user_1');
  });

  it('handles episode with event containing error', () => {
    const episode: Episode = {
      id: 'ep_126',
      timestamp: new Date(),
      type: 'error_recovery',
      context: { environment: 'test', state: {} },
      actors: [],
      events: [
        { order: 1, timestamp: new Date(), type: 'attempt', description: 'Try action', data: { error: 'Failed' } },
      ],
      outcome: { success: false, error: 'Recovery failed', duration: 200 },
      lessons: [],
      metadata: {},
    };

    const entry = createEpisodeEvidence(episode);

    expect((entry.payload as any).stages[0].success).toBe(false);
  });
});

// ============================================================================
// WU-LEDG-003: QUERY STAGES -> EVIDENCE LEDGER TESTS
// ============================================================================

describe('createRetrievalEvidence', () => {
  it('converts a semantic retrieval stage', () => {
    const stageReport: StageReport = {
      stage: 'semantic_retrieval',
      status: 'success',
      results: {
        inputCount: 1000,
        outputCount: 25,
        filteredCount: 975,
      },
      issues: [],
      durationMs: 45,
    };

    const options: QueryStageEvidenceOptions = {
      query: 'find all async functions',
      method: 'vector',
      results: [
        { entityId: 'fn_123', score: 0.92, snippet: 'async function handleRequest()' },
        { entityId: 'fn_456', score: 0.88, snippet: 'async function processData()' },
      ],
      candidatesConsidered: 1000,
    };

    const entry = createRetrievalEvidence(stageReport, options);

    expect(entry.kind).toBe('retrieval');
    expect(entry.payload).toMatchObject({
      query: 'find all async functions',
      method: 'vector',
      candidatesConsidered: 1000,
      latencyMs: 45,
    });
    expect((entry.payload as any).results).toHaveLength(2);
    expect(entry.provenance.source).toBe('embedding_search');
    expect(entry.provenance.method).toBe('query_pipeline.semantic_retrieval');
    expect(entry.provenance.agent?.type).toBe('embedding');
    expect((entry.provenance.config as any).stageName).toBe('semantic_retrieval');
    expect((entry.provenance.config as any).stageStatus).toBe('success');
  });

  it('infers vector method from semantic_retrieval stage', () => {
    const stageReport: StageReport = {
      stage: 'semantic_retrieval',
      status: 'success',
      results: { inputCount: 100, outputCount: 10, filteredCount: 90 },
      issues: [],
      durationMs: 30,
    };

    const entry = createRetrievalEvidence(stageReport, { query: 'test query' });

    expect((entry.payload as any).method).toBe('vector');
  });

  it('infers graph method from graph_expansion stage', () => {
    const stageReport: StageReport = {
      stage: 'graph_expansion',
      status: 'partial',
      results: { inputCount: 10, outputCount: 25, filteredCount: 0 },
      issues: [{ message: 'Some nodes unreachable', severity: 'minor' }],
      durationMs: 80,
    };

    const entry = createRetrievalEvidence(stageReport, { query: 'test query' });

    expect((entry.payload as any).method).toBe('graph');
    expect(entry.provenance.agent?.identifier).toBe('graph_traversal');
  });

  it('infers hybrid method from reranking stage', () => {
    const stageReport: StageReport = {
      stage: 'reranking',
      status: 'success',
      results: { inputCount: 50, outputCount: 10, filteredCount: 40 },
      issues: [],
      durationMs: 120,
    };

    const entry = createRetrievalEvidence(stageReport, { query: 'test query' });

    expect((entry.payload as any).method).toBe('hybrid');
  });

  it('includes stage issues in provenance config', () => {
    const stageReport: StageReport = {
      stage: 'multi_signal_scoring',
      status: 'partial',
      results: { inputCount: 100, outputCount: 50, filteredCount: 50 },
      issues: [
        { message: 'Low confidence matches', severity: 'moderate', remediation: 'Increase threshold' },
      ],
      durationMs: 60,
    };

    const entry = createRetrievalEvidence(stageReport, { query: 'test query' });

    expect((entry.provenance.config as any).issues).toHaveLength(1);
    expect((entry.provenance.config as any).issues[0].message).toBe('Low confidence matches');
  });

  it('uses inputCount as default candidatesConsidered', () => {
    const stageReport: StageReport = {
      stage: 'semantic_retrieval',
      status: 'success',
      results: { inputCount: 500, outputCount: 20, filteredCount: 480 },
      issues: [],
      durationMs: 40,
    };

    const entry = createRetrievalEvidence(stageReport, { query: 'test query' });

    expect((entry.payload as any).candidatesConsidered).toBe(500);
  });
});

describe('createRetrievalEvidenceBatch', () => {
  it('converts multiple retrieval-related stages', () => {
    const stages: StageReport[] = [
      {
        stage: 'adequacy_scan', // Not a retrieval stage
        status: 'success',
        results: { inputCount: 1, outputCount: 1, filteredCount: 0 },
        issues: [],
        durationMs: 10,
      },
      {
        stage: 'semantic_retrieval',
        status: 'success',
        results: { inputCount: 1000, outputCount: 50, filteredCount: 950 },
        issues: [],
        durationMs: 45,
      },
      {
        stage: 'graph_expansion',
        status: 'success',
        results: { inputCount: 50, outputCount: 75, filteredCount: 0 },
        issues: [],
        durationMs: 80,
      },
      {
        stage: 'synthesis', // Not a retrieval stage
        status: 'success',
        results: { inputCount: 75, outputCount: 1, filteredCount: 0 },
        issues: [],
        durationMs: 200,
      },
    ];

    const entries = createRetrievalEvidenceBatch(stages, { query: 'batch test' });

    // Only retrieval-related stages should be included
    expect(entries).toHaveLength(2);
    expect(entries[0].provenance.method).toBe('query_pipeline.semantic_retrieval');
    expect(entries[1].provenance.method).toBe('query_pipeline.graph_expansion');
  });

  it('passes base options to all entries', () => {
    const stages: StageReport[] = [
      {
        stage: 'reranking',
        status: 'success',
        results: { inputCount: 50, outputCount: 10, filteredCount: 40 },
        issues: [],
        durationMs: 100,
      },
    ];

    const sessionId = createSessionId('batch_session');
    const entries = createRetrievalEvidenceBatch(stages, {
      query: 'batch test',
      sessionId,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe(sessionId);
    expect((entries[0].payload as any).query).toBe('batch test');
  });
});

// ============================================================================
// WU-LEDG-004: BOOTSTRAP EXTRACTION -> EVIDENCE LEDGER TESTS
// ============================================================================

describe('createExtractionEvidence', () => {
  it('converts an AST-verified function extraction', () => {
    const result: ExtractionResult = {
      filePath: 'src/utils/helpers.ts',
      extractionType: 'function',
      entity: {
        name: 'formatDate',
        kind: 'function',
        signature: '(date: Date) => string',
        startLine: 42,
        endLine: 50,
        column: 1,
      },
      quality: 'ast_verified',
    };

    const entry = createExtractionEvidence(result);

    expect(entry.kind).toBe('extraction');
    expect(entry.payload).toMatchObject({
      filePath: 'src/utils/helpers.ts',
      extractionType: 'function',
      quality: 'ast_verified',
    });
    expect((entry.payload as any).entity).toMatchObject({
      name: 'formatDate',
      kind: 'function',
      signature: '(date: Date) => string',
    });
    expect((entry.payload as any).entity.location).toMatchObject({
      file: 'src/utils/helpers.ts',
      startLine: 42,
      endLine: 50,
      column: 1,
    });
    expect(entry.provenance.source).toBe('ast_parser');
    expect(entry.provenance.method).toBe('bootstrap_extraction_adapter');
    expect(entry.provenance.agent?.type).toBe('ast');
    expect(entry.provenance.agent?.identifier).toBe('typescript_parser');

    // AST-verified should have deterministic confidence
    expect(entry.confidence).toBeDefined();
    expect(entry.confidence?.type).toBe('deterministic');
    expect((entry.confidence as any).value).toBe(1.0);
    expect((entry.confidence as any).reason).toBe('ast_parse_succeeded');
  });

  it('converts an AST-inferred class extraction', () => {
    const result: ExtractionResult = {
      filePath: 'src/models/User.ts',
      extractionType: 'class',
      entity: {
        name: 'User',
        kind: 'class',
        startLine: 10,
        endLine: 100,
      },
      quality: 'ast_inferred',
    };

    const entry = createExtractionEvidence(result);

    expect((entry.payload as any).extractionType).toBe('class');
    expect(entry.provenance.agent?.identifier).toBe('heuristic_parser');
    expect(entry.confidence?.type).toBe('derived');
    expect((entry.confidence as any).value).toBe(0.85);
  });

  it('converts an LLM-synthesized pattern extraction', () => {
    const result: ExtractionResult = {
      filePath: 'src/patterns/singleton.ts',
      extractionType: 'pattern',
      entity: {
        name: 'Singleton',
        kind: 'design_pattern',
      },
      quality: 'llm_synthesized',
    };

    const entry = createExtractionEvidence(result);

    expect(entry.provenance.agent?.identifier).toBe('llm_extractor');
    expect(entry.confidence?.type).toBe('bounded');
    expect((entry.confidence as any).low).toBe(0.5);
    expect((entry.confidence as any).high).toBe(0.8);
  });

  it('includes AST node when provided', () => {
    const result: ExtractionResult = {
      filePath: 'src/index.ts',
      extractionType: 'export',
      entity: {
        name: 'default',
        kind: 'export',
      },
      quality: 'ast_verified',
      astNode: { type: 'ExportDefaultDeclaration', start: 0, end: 50 },
    };

    const entry = createExtractionEvidence(result);

    expect((entry.payload as any).astNode).toEqual({
      type: 'ExportDefaultDeclaration',
      start: 0,
      end: 50,
    });
  });

  it('accepts custom session ID and related entries', () => {
    const result: ExtractionResult = {
      filePath: 'src/test.ts',
      extractionType: 'import',
      entity: { name: 'lodash', kind: 'import' },
      quality: 'ast_verified',
    };

    const sessionId = createSessionId('extract_session');
    const relatedEntries = ['ev_123' as any, 'ev_456' as any];

    const entry = createExtractionEvidence(result, { sessionId, relatedEntries });

    expect(entry.sessionId).toBe(sessionId);
    expect(entry.relatedEntries).toEqual(relatedEntries);
  });
});

describe('createExtractionEvidenceBatch', () => {
  it('converts multiple extraction results with shared options', () => {
    const results: ExtractionResult[] = [
      {
        filePath: 'src/a.ts',
        extractionType: 'function',
        entity: { name: 'funcA', kind: 'function' },
        quality: 'ast_verified',
      },
      {
        filePath: 'src/b.ts',
        extractionType: 'class',
        entity: { name: 'ClassB', kind: 'class' },
        quality: 'ast_inferred',
      },
      {
        filePath: 'src/c.ts',
        extractionType: 'type',
        entity: { name: 'TypeC', kind: 'type_alias' },
        quality: 'llm_synthesized',
      },
    ];

    const sessionId = createSessionId('batch_extract');
    const entries = createExtractionEvidenceBatch(results, { sessionId });

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.sessionId === sessionId)).toBe(true);
    expect(entries.map((e) => (e.payload as any).entity.name)).toEqual(['funcA', 'ClassB', 'TypeC']);
    expect(entries.map((e) => e.confidence?.type)).toEqual(['deterministic', 'derived', 'bounded']);
  });

  it('returns empty array for empty input', () => {
    const entries = createExtractionEvidenceBatch([]);

    expect(entries).toEqual([]);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Evidence Adapters Integration', () => {
  it('all adapters produce valid entry structure', () => {
    const auditEvent: AuditEvent = {
      id: 'evt_1',
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      severity: 'info',
      operation: 'test',
      status: 'success',
    };

    const episode: Episode = {
      id: 'ep_1',
      timestamp: new Date(),
      type: 'task_execution',
      context: { environment: 'test', state: {} },
      actors: [],
      events: [],
      outcome: { success: true, duration: 100 },
      lessons: [],
      metadata: {},
    };

    const stageReport: StageReport = {
      stage: 'semantic_retrieval',
      status: 'success',
      results: { inputCount: 10, outputCount: 5, filteredCount: 5 },
      issues: [],
      durationMs: 50,
    };

    const extractionResult: ExtractionResult = {
      filePath: 'test.ts',
      extractionType: 'function',
      entity: { name: 'test', kind: 'function' },
      quality: 'ast_verified',
    };

    const entries = [
      createToolCallEvidence(auditEvent),
      createEpisodeEvidence(episode),
      createRetrievalEvidence(stageReport, { query: 'test' }),
      createExtractionEvidence(extractionResult),
    ];

    for (const entry of entries) {
      // All entries should have required fields
      expect(entry.kind).toBeDefined();
      expect(entry.payload).toBeDefined();
      expect(entry.provenance).toBeDefined();
      expect(entry.provenance.source).toBeDefined();
      expect(entry.provenance.method).toBeDefined();
      expect(entry.relatedEntries).toBeDefined();
      expect(Array.isArray(entry.relatedEntries)).toBe(true);
    }
  });

  it('all adapters preserve session context when provided', () => {
    const sessionId = createSessionId('integration_session');

    const auditEntry = createToolCallEvidence(
      { id: 'e1', timestamp: '', type: 'tool_call', severity: 'info', operation: 'test', status: 'success' },
      { sessionId }
    );
    const episodeEntry = createEpisodeEvidence(
      { id: 'ep1', timestamp: new Date(), type: 'task_execution', context: { environment: 'test', state: {} }, actors: [], events: [], outcome: { success: true, duration: 0 }, lessons: [], metadata: {} },
      { sessionId }
    );
    const retrievalEntry = createRetrievalEvidence(
      { stage: 'semantic_retrieval', status: 'success', results: { inputCount: 1, outputCount: 1, filteredCount: 0 }, issues: [], durationMs: 1 },
      { query: 'test', sessionId }
    );
    const extractionEntry = createExtractionEvidence(
      { filePath: 'test.ts', extractionType: 'function', entity: { name: 'f', kind: 'function' }, quality: 'ast_verified' },
      { sessionId }
    );

    expect(auditEntry.sessionId).toBe(sessionId);
    expect(episodeEntry.sessionId).toBe(sessionId);
    expect(retrievalEntry.sessionId).toBe(sessionId);
    expect(extractionEntry.sessionId).toBe(sessionId);
  });
});
