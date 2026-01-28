/**
 * @fileoverview Evidence Ledger Adapters
 *
 * Provides adapter functions to convert various source system events
 * into EvidenceEntry format for the unified Evidence Ledger.
 *
 * Sources:
 * - MCP Audit Events -> tool_call evidence
 * - Episodes -> episode evidence
 * - Query Stages -> retrieval evidence
 * - Bootstrap Extraction -> extraction evidence
 *
 * @packageDocumentation
 */

import type { AuditEvent } from '../mcp/audit.js';
import type { Episode } from '../strategic/building_blocks.js';
import type { StageReport, StageName } from '../types.js';
import type {
  EvidenceEntry,
  EvidenceId,
  SessionId,
  ToolCallEvidence,
  EpisodeEvidence,
  RetrievalEvidence,
  ExtractionEvidence,
  EvidenceProvenance,
  CodeLocation,
} from './evidence_ledger.js';
import { createEvidenceId, createSessionId } from './evidence_ledger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input type for bootstrap extraction results.
 * Represents the result of extracting entities from source code.
 */
export interface ExtractionResult {
  /** Source file path */
  filePath: string;

  /** Type of extraction performed */
  extractionType: 'function' | 'class' | 'type' | 'import' | 'export' | 'pattern';

  /** The extracted entity */
  entity: {
    name: string;
    kind: string;
    signature?: string;
    startLine?: number;
    endLine?: number;
    column?: number;
  };

  /** Extraction quality indicator */
  quality: 'ast_verified' | 'ast_inferred' | 'llm_synthesized';

  /** Optional AST node data */
  astNode?: unknown;
}

/**
 * Options for creating evidence entries.
 */
export interface EvidenceAdapterOptions {
  /** Session ID to associate with the evidence */
  sessionId?: SessionId | string;

  /** Related evidence entry IDs */
  relatedEntries?: EvidenceId[];
}

// ============================================================================
// WU-LEDG-001: MCP AUDIT -> EVIDENCE LEDGER
// ============================================================================

/**
 * Convert an MCP audit event to a tool_call EvidenceEntry.
 *
 * Maps MCP audit event fields to the ToolCallEvidence payload structure.
 *
 * @param auditEvent - The MCP audit event to convert
 * @param options - Optional settings for the evidence entry
 * @returns An EvidenceEntry suitable for appending to the ledger
 *
 * @example
 * ```typescript
 * const auditEvent = auditLogger.logToolCall({
 *   operation: 'librarian_query',
 *   status: 'success',
 *   durationMs: 150,
 *   input: { intent: 'find all async functions' },
 *   output: { packCount: 5 },
 * });
 *
 * const entry = createToolCallEvidence(auditEvent);
 * await ledger.append(entry);
 * ```
 */
export function createToolCallEvidence(
  auditEvent: AuditEvent,
  options: EvidenceAdapterOptions = {}
): Omit<EvidenceEntry, 'id' | 'timestamp'> {
  const payload: ToolCallEvidence = {
    toolName: auditEvent.operation,
    toolVersion: auditEvent.metadata?.version as string | undefined,
    arguments: auditEvent.input ?? {},
    result: auditEvent.output ?? null,
    success: auditEvent.status === 'success',
    durationMs: auditEvent.durationMs ?? 0,
    errorMessage: auditEvent.error,
  };

  const provenance: EvidenceProvenance = {
    source: 'tool_output',
    method: 'mcp_audit_adapter',
    agent: {
      type: 'tool',
      identifier: auditEvent.clientId ?? 'mcp',
    },
    inputHash: auditEvent.dataHash,
    config: {
      severity: auditEvent.severity,
      status: auditEvent.status,
      workspace: auditEvent.workspace,
    },
  };

  const sessionId = resolveSessionId(options.sessionId ?? auditEvent.sessionId);

  return {
    kind: 'tool_call',
    payload,
    provenance,
    relatedEntries: options.relatedEntries ?? [],
    sessionId,
  };
}

// ============================================================================
// WU-LEDG-002: EPISODES -> EVIDENCE LEDGER
// ============================================================================

/**
 * Convert an Episode to an episode EvidenceEntry.
 *
 * Maps Episode fields from the strategic/building_blocks module to
 * the EpisodeEvidence payload structure.
 *
 * @param episode - The episode to convert
 * @param options - Optional settings for the evidence entry
 * @returns An EvidenceEntry suitable for appending to the ledger
 *
 * @example
 * ```typescript
 * const episode: Episode = {
 *   id: 'ep_123',
 *   timestamp: new Date(),
 *   type: 'task_execution',
 *   context: { environment: 'dev' },
 *   actors: [{ id: 'agent_1', type: 'agent', role: 'executor' }],
 *   events: [{ order: 1, timestamp: new Date(), type: 'query', description: 'Initial query' }],
 *   outcome: { success: true, duration: 500 },
 *   lessons: [],
 *   metadata: {},
 * };
 *
 * const entry = createEpisodeEvidence(episode);
 * await ledger.append(entry);
 * ```
 */
export function createEpisodeEvidence(
  episode: Episode,
  options: EvidenceAdapterOptions = {}
): Omit<EvidenceEntry, 'id' | 'timestamp'> {
  // Extract the original query from metadata or context if available
  const query = (episode.metadata?.query as string) ??
    (episode.context.state?.intent as string) ??
    `Episode: ${episode.type}`;

  // Convert episode events to stage format
  const stages = episode.events.map((event) => ({
    name: event.type,
    durationMs: event.data && typeof event.data === 'object' && 'durationMs' in event.data
      ? (event.data as { durationMs: number }).durationMs
      : 0,
    success: !(event.data && typeof event.data === 'object' && 'error' in event.data),
  }));

  const payload: EpisodeEvidence = {
    query,
    stages,
    totalDurationMs: episode.outcome.duration,
    retrievedEntities: episode.metadata?.retrievedEntities as number ?? 0,
    synthesizedResponse: episode.outcome.success && stages.some((s) => s.name === 'synthesis'),
  };

  const provenance: EvidenceProvenance = {
    source: 'system_observation',
    method: 'episode_adapter',
    agent: episode.actors.length > 0
      ? {
          type: mapActorTypeToAgentType(episode.actors[0].type),
          identifier: episode.actors[0].id,
        }
      : undefined,
    config: {
      episodeType: episode.type,
      environment: episode.context.environment,
      taskId: episode.context.taskId,
      agentId: episode.context.agentId,
    },
  };

  const sessionId = resolveSessionId(options.sessionId ?? episode.context.taskId);

  return {
    kind: 'episode',
    payload,
    provenance,
    relatedEntries: options.relatedEntries ?? [],
    sessionId,
  };
}

// ============================================================================
// WU-LEDG-003: QUERY STAGES -> EVIDENCE LEDGER
// ============================================================================

/**
 * Options specific to query stage evidence creation.
 */
export interface QueryStageEvidenceOptions extends EvidenceAdapterOptions {
  /** The original query string */
  query: string;

  /** The retrieval method used */
  method?: 'vector' | 'keyword' | 'graph' | 'hybrid';

  /** Retrieved entity IDs and scores */
  results?: Array<{
    entityId: string;
    score: number;
    snippet: string;
  }>;

  /** Total candidates considered before filtering */
  candidatesConsidered?: number;
}

/**
 * Convert a query pipeline StageReport to a retrieval EvidenceEntry.
 *
 * Maps query pipeline stage information to the RetrievalEvidence payload.
 *
 * @param stageReport - The stage report from the query pipeline
 * @param options - Options including query and retrieval details
 * @returns An EvidenceEntry suitable for appending to the ledger
 *
 * @example
 * ```typescript
 * const stageReport: StageReport = {
 *   stage: 'semantic_retrieval',
 *   status: 'success',
 *   results: { inputCount: 100, outputCount: 10, filteredCount: 90 },
 *   issues: [],
 *   durationMs: 45,
 * };
 *
 * const entry = createRetrievalEvidence(stageReport, {
 *   query: 'find all async functions',
 *   method: 'vector',
 *   results: [{ entityId: 'fn_123', score: 0.92, snippet: 'async function...' }],
 *   candidatesConsidered: 100,
 * });
 * await ledger.append(entry);
 * ```
 */
export function createRetrievalEvidence(
  stageReport: StageReport,
  options: QueryStageEvidenceOptions
): Omit<EvidenceEntry, 'id' | 'timestamp'> {
  // Infer retrieval method from stage name if not provided
  const method = options.method ?? inferMethodFromStage(stageReport.stage);

  const payload: RetrievalEvidence = {
    query: options.query,
    method,
    results: options.results ?? [],
    candidatesConsidered: options.candidatesConsidered ?? stageReport.results.inputCount,
    latencyMs: stageReport.durationMs,
  };

  const provenance: EvidenceProvenance = {
    source: 'embedding_search',
    method: `query_pipeline.${stageReport.stage}`,
    agent: {
      type: 'embedding',
      identifier: method === 'vector' ? 'vector_index' : method === 'graph' ? 'graph_traversal' : 'hybrid_search',
    },
    config: {
      stageName: stageReport.stage,
      stageStatus: stageReport.status,
      inputCount: stageReport.results.inputCount,
      outputCount: stageReport.results.outputCount,
      filteredCount: stageReport.results.filteredCount,
      issues: stageReport.issues,
    },
  };

  const sessionId = resolveSessionId(options.sessionId);

  return {
    kind: 'retrieval',
    payload,
    provenance,
    relatedEntries: options.relatedEntries ?? [],
    sessionId,
  };
}

/**
 * Infer the retrieval method from the query pipeline stage name.
 */
function inferMethodFromStage(stage: StageName): 'vector' | 'keyword' | 'graph' | 'hybrid' {
  switch (stage) {
    case 'semantic_retrieval':
    case 'multi_vector_scoring':
      return 'vector';
    case 'graph_expansion':
      return 'graph';
    case 'multi_signal_scoring':
    case 'reranking':
      return 'hybrid';
    default:
      return 'keyword';
  }
}

// ============================================================================
// WU-LEDG-004: BOOTSTRAP EXTRACTION -> EVIDENCE LEDGER
// ============================================================================

/**
 * Convert a bootstrap extraction result to an extraction EvidenceEntry.
 *
 * Maps extraction results from the bootstrap process to the ExtractionEvidence payload.
 *
 * @param extractionResult - The extraction result to convert
 * @param options - Optional settings for the evidence entry
 * @returns An EvidenceEntry suitable for appending to the ledger
 *
 * @example
 * ```typescript
 * const result: ExtractionResult = {
 *   filePath: 'src/utils/helpers.ts',
 *   extractionType: 'function',
 *   entity: {
 *     name: 'formatDate',
 *     kind: 'function',
 *     signature: '(date: Date) => string',
 *     startLine: 42,
 *     endLine: 50,
 *   },
 *   quality: 'ast_verified',
 * };
 *
 * const entry = createExtractionEvidence(result);
 * await ledger.append(entry);
 * ```
 */
export function createExtractionEvidence(
  extractionResult: ExtractionResult,
  options: EvidenceAdapterOptions = {}
): Omit<EvidenceEntry, 'id' | 'timestamp'> {
  const location: CodeLocation = {
    file: extractionResult.filePath,
    startLine: extractionResult.entity.startLine,
    endLine: extractionResult.entity.endLine,
    column: extractionResult.entity.column,
  };

  const payload: ExtractionEvidence = {
    filePath: extractionResult.filePath,
    extractionType: extractionResult.extractionType,
    entity: {
      name: extractionResult.entity.name,
      kind: extractionResult.entity.kind,
      signature: extractionResult.entity.signature,
      location,
    },
    quality: extractionResult.quality,
    astNode: extractionResult.astNode,
  };

  const provenance: EvidenceProvenance = {
    source: 'ast_parser',
    method: 'bootstrap_extraction_adapter',
    agent: {
      type: 'ast',
      identifier: extractionResult.quality === 'ast_verified'
        ? 'typescript_parser'
        : extractionResult.quality === 'ast_inferred'
          ? 'heuristic_parser'
          : 'llm_extractor',
    },
    config: {
      extractionType: extractionResult.extractionType,
      quality: extractionResult.quality,
    },
  };

  // Derive confidence from extraction quality
  const confidence = deriveExtractionConfidence(extractionResult.quality);

  const sessionId = resolveSessionId(options.sessionId);

  return {
    kind: 'extraction',
    payload,
    provenance,
    confidence,
    relatedEntries: options.relatedEntries ?? [],
    sessionId,
  };
}

/**
 * Derive confidence value from extraction quality.
 */
function deriveExtractionConfidence(
  quality: 'ast_verified' | 'ast_inferred' | 'llm_synthesized'
): import('./confidence.js').ConfidenceValue {
  switch (quality) {
    case 'ast_verified':
      return {
        type: 'deterministic',
        value: 1.0,
        reason: 'ast_parse_succeeded',
      };
    case 'ast_inferred':
      return {
        type: 'derived',
        value: 0.85,
        formula: 'ast_inference_confidence',
        inputs: [],
      };
    case 'llm_synthesized':
      return {
        type: 'bounded',
        low: 0.5,
        high: 0.8,
        basis: 'literature',
        citation: 'LLM extraction accuracy bounds from empirical testing',
      };
    default:
      return {
        type: 'absent',
        reason: 'insufficient_data',
      };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map Episode actor type to EvidenceProvenance agent type.
 * Episode uses 'user' while EvidenceProvenance expects 'human'.
 */
function mapActorTypeToAgentType(
  actorType: 'agent' | 'user' | 'system' | 'tool'
): 'llm' | 'embedding' | 'ast' | 'human' | 'tool' {
  switch (actorType) {
    case 'agent':
      return 'llm';
    case 'user':
      return 'human';
    case 'system':
      return 'tool';
    case 'tool':
      return 'tool';
    default:
      return 'tool';
  }
}

/**
 * Resolve a session ID from various input types.
 */
function resolveSessionId(input: SessionId | string | undefined | null): SessionId | undefined {
  if (!input) return undefined;
  if (typeof input === 'string' && input.startsWith('sess_')) {
    return input as SessionId;
  }
  return createSessionId(typeof input === 'string' ? input : undefined);
}

/**
 * Batch convert multiple extraction results to evidence entries.
 *
 * @param results - Array of extraction results
 * @param options - Shared options for all entries
 * @returns Array of evidence entries ready for batch append
 */
export function createExtractionEvidenceBatch(
  results: ExtractionResult[],
  options: EvidenceAdapterOptions = {}
): Array<Omit<EvidenceEntry, 'id' | 'timestamp'>> {
  return results.map((result) => createExtractionEvidence(result, options));
}

/**
 * Batch convert multiple stage reports to evidence entries.
 *
 * @param stages - Array of stage reports
 * @param baseOptions - Base options including the query
 * @returns Array of evidence entries ready for batch append
 */
export function createRetrievalEvidenceBatch(
  stages: StageReport[],
  baseOptions: QueryStageEvidenceOptions
): Array<Omit<EvidenceEntry, 'id' | 'timestamp'>> {
  // Only convert retrieval-related stages
  const retrievalStages = stages.filter((stage) =>
    ['semantic_retrieval', 'graph_expansion', 'multi_signal_scoring', 'multi_vector_scoring', 'reranking'].includes(
      stage.stage
    )
  );

  return retrievalStages.map((stage) =>
    createRetrievalEvidence(stage, {
      ...baseOptions,
      method: inferMethodFromStage(stage.stage),
    })
  );
}
