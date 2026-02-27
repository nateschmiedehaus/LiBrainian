/**
 * @fileoverview DeterminismProvenance.v1 types for reproducible indexing
 *
 * ARCHITECTURAL ALIGNMENT (Determinism Requirements):
 * - Full provenance tracking for reproducible indexing
 * - Every operation records input fingerprints, output fingerprints
 * - Non-deterministic components (LLM calls) are explicitly recorded
 *
 * RECORD-AND-REPLAY:
 * - Provenance enables verification that replay produces identical outputs
 * - Input hashes + config hashes = deterministic input specification
 * - Output hashes = verification target for replay
 *
 * Schema reference: docs/archive/SCHEMAS.md (DeterminismProvenance.v1)
 */

import { createContentHash, createContentHashSync } from './contracts.js';

// ============================================================================
// DETERMINISM PROVENANCE TYPES (per SCHEMAS.md)
// ============================================================================

export type OperationType = 'index' | 'embed' | 'extract' | 'synthesize';

/**
 * DeterminismProvenance.v1 - Records everything needed to reproduce an operation.
 */
export interface DeterminismProvenance {
  readonly kind: 'DeterminismProvenance.v1';
  readonly schemaVersion: 1;

  /** Identity - what entity and operation this provenance covers */
  readonly entityId: string;
  readonly operationType: OperationType;

  /** Input Fingerprints - deterministic specification of inputs */
  readonly inputs: {
    /** SHA-256 of source file(s) */
    readonly sourceContentHash: string;
    /** SHA-256 of chunking/extraction config */
    readonly configHash: string;
    /** Embedding or LLM model ID */
    readonly modelId: string;
    /** Random seed if applicable */
    readonly seed?: number;
  };

  /** Output Fingerprints - verification targets for replay */
  readonly outputs: {
    /** SHA-256 of extracted entity */
    readonly entityHash: string;
    /** SHA-256 of embedding vector */
    readonly embeddingHash?: string;
    /** SHA-256 of extracted relations */
    readonly relationsHash?: string;
  };

  /** Non-Deterministic Components (must be recorded for replay) */
  readonly nonDeterministic?: {
    /** Full prompt sent to LLM */
    readonly llmPrompt: string;
    /** Full response received from LLM */
    readonly llmResponse: string;
    /** Exact model ID used */
    readonly llmModelId: string;
    /** ISO 8601 timestamp */
    readonly timestamp: string;
  };

  /** Verification status */
  readonly replayable: boolean;
  readonly replayInstructions?: string;
}

// ============================================================================
// PROVENANCE BUILDER
// ============================================================================

export interface ProvenanceConfig {
  entityId: string;
  operationType: OperationType;
  sourceContent: string;
  config: Record<string, unknown>;
  modelId: string;
  seed?: number;
}

export interface ProvenanceOutputs {
  entityContent: string;
  embeddingVector?: number[] | Float32Array;
  relations?: unknown[];
}

export interface LLMCall {
  prompt: string;
  response: string;
  modelId: string;
}

/**
 * Builder for creating DeterminismProvenance records.
 *
 * Usage:
 * ```typescript
 * const builder = new ProvenanceBuilder({
 *   entityId: 'file:src/foo.ts',
 *   operationType: 'extract',
 *   sourceContent: fileContent,
 *   config: extractionConfig,
 *   modelId: 'all-MiniLM-L6-v2',
 * });
 *
 * // Record LLM calls if any
 * builder.recordLLMCall({ prompt, response, modelId: 'claude-3' });
 *
 * // Build provenance with outputs
 * const provenance = await builder.build({
 *   entityContent: JSON.stringify(extractedEntity),
 *   embeddingVector: embedding,
 * });
 * ```
 */
export class ProvenanceBuilder {
  private readonly config: ProvenanceConfig;
  private llmCall?: LLMCall;

  constructor(config: ProvenanceConfig) {
    this.config = config;
  }

  /**
   * Record an LLM call for non-determinism tracking.
   */
  recordLLMCall(call: LLMCall): this {
    this.llmCall = call;
    return this;
  }

  /**
   * Build the provenance record with output hashes.
   */
  async build(outputs: ProvenanceOutputs): Promise<DeterminismProvenance> {
    const sourceContentHash = await createContentHash(this.config.sourceContent);
    const configHash = await createContentHash(JSON.stringify(this.config.config));
    const entityHash = await createContentHash(outputs.entityContent);

    let embeddingHash: string | undefined;
    if (outputs.embeddingVector) {
      const embeddingStr = Array.from(outputs.embeddingVector).join(',');
      embeddingHash = await createContentHash(embeddingStr);
    }

    let relationsHash: string | undefined;
    if (outputs.relations && outputs.relations.length > 0) {
      relationsHash = await createContentHash(JSON.stringify(outputs.relations));
    }

    const provenance: DeterminismProvenance = {
      kind: 'DeterminismProvenance.v1',
      schemaVersion: 1,
      entityId: this.config.entityId,
      operationType: this.config.operationType,
      inputs: {
        sourceContentHash,
        configHash,
        modelId: this.config.modelId,
        seed: this.config.seed,
      },
      outputs: {
        entityHash,
        embeddingHash,
        relationsHash,
      },
      nonDeterministic: this.llmCall
        ? {
            llmPrompt: this.llmCall.prompt,
            llmResponse: this.llmCall.response,
            llmModelId: this.llmCall.modelId,
            timestamp: new Date().toISOString(),
          }
        : undefined,
      replayable: !this.llmCall, // Replayable only if no LLM calls
      replayInstructions: this.llmCall
        ? 'Replay requires recorded LLM response from nonDeterministic.llmResponse'
        : undefined,
    };

    return provenance;
  }

  /**
   * Build synchronously (uses simpler hash for performance).
   * Use async build() when provenance will be persisted.
   */
  buildSync(outputs: ProvenanceOutputs): DeterminismProvenance {
    const sourceContentHash = createContentHashSync(this.config.sourceContent);
    const configHash = createContentHashSync(JSON.stringify(this.config.config));
    const entityHash = createContentHashSync(outputs.entityContent);

    let embeddingHash: string | undefined;
    if (outputs.embeddingVector) {
      const embeddingStr = Array.from(outputs.embeddingVector).join(',');
      embeddingHash = createContentHashSync(embeddingStr);
    }

    let relationsHash: string | undefined;
    if (outputs.relations && outputs.relations.length > 0) {
      relationsHash = createContentHashSync(JSON.stringify(outputs.relations));
    }

    return {
      kind: 'DeterminismProvenance.v1',
      schemaVersion: 1,
      entityId: this.config.entityId,
      operationType: this.config.operationType,
      inputs: {
        sourceContentHash,
        configHash,
        modelId: this.config.modelId,
        seed: this.config.seed,
      },
      outputs: {
        entityHash,
        embeddingHash,
        relationsHash,
      },
      nonDeterministic: this.llmCall
        ? {
            llmPrompt: this.llmCall.prompt,
            llmResponse: this.llmCall.response,
            llmModelId: this.llmCall.modelId,
            timestamp: new Date().toISOString(),
          }
        : undefined,
      replayable: !this.llmCall,
      replayInstructions: this.llmCall
        ? 'Replay requires recorded LLM response from nonDeterministic.llmResponse'
        : undefined,
    };
  }
}

// ============================================================================
// PROVENANCE VERIFICATION
// ============================================================================

export interface VerificationResult {
  readonly matches: boolean;
  readonly mismatches: Array<{
    field: string;
    expected: string;
    actual: string;
  }>;
}

/**
 * Verify that a replay produced identical outputs.
 */
export async function verifyProvenance(
  original: DeterminismProvenance,
  replayOutputs: ProvenanceOutputs
): Promise<VerificationResult> {
  const mismatches: VerificationResult['mismatches'] = [];

  const entityHash = await createContentHash(replayOutputs.entityContent);
  if (entityHash !== original.outputs.entityHash) {
    mismatches.push({
      field: 'outputs.entityHash',
      expected: original.outputs.entityHash,
      actual: entityHash,
    });
  }

  if (original.outputs.embeddingHash && replayOutputs.embeddingVector) {
    const embeddingStr = Array.from(replayOutputs.embeddingVector).join(',');
    const embeddingHash = await createContentHash(embeddingStr);
    if (embeddingHash !== original.outputs.embeddingHash) {
      mismatches.push({
        field: 'outputs.embeddingHash',
        expected: original.outputs.embeddingHash,
        actual: embeddingHash,
      });
    }
  }

  if (original.outputs.relationsHash && replayOutputs.relations) {
    const relationsHash = await createContentHash(JSON.stringify(replayOutputs.relations));
    if (relationsHash !== original.outputs.relationsHash) {
      mismatches.push({
        field: 'outputs.relationsHash',
        expected: original.outputs.relationsHash,
        actual: relationsHash,
      });
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isDeterminismProvenance(value: unknown): value is DeterminismProvenance {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return p.kind === 'DeterminismProvenance.v1' && p.schemaVersion === 1;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a provenance builder for an operation.
 */
export function createProvenanceBuilder(config: ProvenanceConfig): ProvenanceBuilder {
  return new ProvenanceBuilder(config);
}
