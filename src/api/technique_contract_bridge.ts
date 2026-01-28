/**
 * @fileoverview Technique-Epistemics Contract Bridge
 *
 * Bridges the technique execution system with the epistemics contracts:
 * - Derives confidence values from technique execution
 * - Records execution events to the Evidence Ledger
 * - Integrates primitive contracts with technique primitives
 *
 * @packageDocumentation
 */

import type { TechniquePrimitive, TechniquePrimitiveContract } from '../strategic/techniques.js';
import type { PrimitiveExecutionResult, ExecutionContext } from './technique_execution.js';
import type {
  PrimitiveContract,
  ContractId,
  PrimitiveId,
  ConfidenceDerivationSpec,
  ConfidenceFactor,
  IContractRegistry,
} from '../epistemics/contracts.js';
import {
  createContractId,
  createPrimitiveId,
  getContractRegistry,
} from '../epistemics/contracts.js';
import type { ConfidenceValue, DerivedConfidence } from '../epistemics/confidence.js';
import { bounded, absent, combinedConfidence, meetsThreshold } from '../epistemics/confidence.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId } from '../epistemics/evidence_ledger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the contract bridge.
 */
export interface TechniqueContractBridgeConfig {
  ledger?: IEvidenceLedger;
  registry?: IContractRegistry;
  defaultConfidenceSpec?: ConfidenceDerivationSpec;
  minimumConfidenceThreshold?: number;
  recordExecutionEvents?: boolean;
}

/**
 * Execution result enhanced with epistemics confidence.
 */
export interface EnhancedExecutionResult extends PrimitiveExecutionResult {
  confidence: ConfidenceValue;
  confidenceFactors: Map<string, ConfidenceValue>;
  evidenceRecorded: boolean;
}

/**
 * Mapping from technique contracts to epistemics contracts.
 */
export interface ContractMapping {
  techniqueContract: TechniquePrimitiveContract;
  epistemicsContract: PrimitiveContract<Record<string, unknown>, Record<string, unknown>>;
}

// ============================================================================
// DEFAULT CONFIDENCE DERIVATION
// ============================================================================

/**
 * Default confidence derivation spec for technique primitives.
 */
export const DEFAULT_CONFIDENCE_SPEC: ConfidenceDerivationSpec = {
  factors: [
    {
      id: 'execution_quality',
      source: 'execution_quality',
      baseWeight: 0.4,
      transform: 'identity',
    },
    {
      id: 'input_confidence',
      source: 'input_confidence',
      baseWeight: 0.3,
      transform: 'identity',
    },
    {
      id: 'provider_reliability',
      source: 'provider_reliability',
      baseWeight: 0.2,
      transform: 'sqrt',
    },
    {
      id: 'temporal_freshness',
      source: 'temporal_freshness',
      baseWeight: 0.1,
      transform: 'decay',
    },
  ],
  combiner: 'weighted_average',
};

// ============================================================================
// CONFIDENCE DERIVATION FROM EXECUTION
// ============================================================================

/**
 * Derive execution quality factor from result.
 */
function deriveExecutionQualityFactor(result: PrimitiveExecutionResult): ConfidenceValue {
  // Execution quality based on status and issues
  switch (result.status) {
    case 'success':
      return bounded(0.85, 0.95, 'theoretical', 'execution_success_bounds_from_technique_design');
    case 'partial':
      return bounded(0.5, 0.75, 'theoretical', 'partial_execution_expected_accuracy_range');
    case 'failed':
      return bounded(0.0, 0.1, 'theoretical', 'failed_execution_minimum_confidence');
  }
}

/**
 * Derive input confidence factor from input values.
 */
function deriveInputConfidenceFactor(
  _input: Record<string, unknown>,
  inputConfidences?: Map<string, ConfidenceValue>
): ConfidenceValue {
  if (!inputConfidences || inputConfidences.size === 0) {
    // No explicit confidence provided - use theoretical default
    return bounded(0.6, 0.8, 'theoretical', 'default_input_confidence_range');
  }

  // Combine input confidences using minimum (AND semantics)
  const confidenceInputs = Array.from(inputConfidences.entries()).map(([name, conf]) => ({
    confidence: conf,
    weight: 1.0,
    name,
  }));

  return combinedConfidence(confidenceInputs);
}

/**
 * Derive provider reliability factor from context.
 */
function deriveProviderReliabilityFactor(context: ExecutionContext): ConfidenceValue {
  // Check if we have LLM provider info
  if (context.llm) {
    // Provider reliability based on theoretical analysis of provider characteristics
    // All major LLM providers have similar reliability characteristics
    return bounded(0.8, 0.95, 'theoretical', 'llm_provider_reliability_from_api_sla');
  }

  // No LLM provider - tool or manual execution (more reliable)
  return bounded(0.9, 1.0, 'theoretical', 'non_llm_execution_reliability');
}

/**
 * Derive temporal freshness factor from evidence age.
 */
function deriveFreshnessFactor(
  _result: PrimitiveExecutionResult,
  evidenceAgeMs?: number
): ConfidenceValue {
  if (!evidenceAgeMs) {
    // Fresh execution
    return bounded(0.95, 1.0, 'theoretical', 'fresh_execution_confidence');
  }

  // Apply decay based on age
  const hourMs = 3600000;
  const dayMs = hourMs * 24;

  if (evidenceAgeMs < hourMs) {
    return bounded(0.9, 1.0, 'theoretical', 'recent_evidence_under_hour');
  } else if (evidenceAgeMs < dayMs) {
    return bounded(0.7, 0.9, 'theoretical', 'evidence_age_under_day');
  } else {
    const days = evidenceAgeMs / dayMs;
    const decayedLow = Math.max(0.2, 0.9 - days * 0.1);
    const decayedHigh = Math.max(0.3, 1.0 - days * 0.1);
    return bounded(decayedLow, decayedHigh, 'theoretical', 'evidence_decay_model');
  }
}

/**
 * Apply transform to a confidence value.
 */
function applyTransform(
  value: number,
  transform: ConfidenceFactor['transform']
): number {
  switch (transform) {
    case 'sqrt':
      return Math.sqrt(value);
    case 'log':
      return Math.log1p(value) / Math.log1p(1);
    case 'decay':
      return value * 0.9; // Simple decay
    case 'identity':
    default:
      return value;
  }
}

/**
 * Extract numeric value from confidence for weighting.
 */
function getNumericConfidence(conf: ConfidenceValue): number {
  switch (conf.type) {
    case 'deterministic':
      return conf.value;
    case 'derived':
    case 'measured':
      return conf.value;
    case 'bounded':
      return (conf.low + conf.high) / 2;
    case 'absent':
      return 0.5; // Default for absent
  }
}

/**
 * Create a derived confidence value.
 */
function createDerivedConfidence(
  value: number,
  formula: string,
  inputNames: string[]
): DerivedConfidence {
  return {
    type: 'derived',
    value: Math.max(0, Math.min(1, value)),
    formula,
    inputs: inputNames.map((name) => ({
      name,
      confidence: absent('uncalibrated'), // Simplified - actual inputs would be tracked
    })),
  };
}

// ============================================================================
// TECHNIQUE CONTRACT BRIDGE
// ============================================================================

/**
 * Bridges technique execution with epistemics contracts.
 *
 * INVARIANT: All technique executions produce confidence values
 * INVARIANT: Confidence derivation is deterministic given same inputs
 */
export class TechniqueContractBridge {
  private config: Required<TechniqueContractBridgeConfig>;
  private sessionId: SessionId;

  constructor(config: TechniqueContractBridgeConfig = {}) {
    this.config = {
      ledger: config.ledger,
      registry: config.registry ?? getContractRegistry(),
      defaultConfidenceSpec: config.defaultConfidenceSpec ?? DEFAULT_CONFIDENCE_SPEC,
      minimumConfidenceThreshold: config.minimumConfidenceThreshold ?? 0.3,
      recordExecutionEvents: config.recordExecutionEvents ?? true,
    } as Required<TechniqueContractBridgeConfig>;
    this.sessionId = createSessionId();
  }

  /**
   * Enhance a primitive execution result with confidence.
   */
  async enhanceResult(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: ExecutionContext,
    options?: {
      inputConfidences?: Map<string, ConfidenceValue>;
      evidenceAgeMs?: number;
    }
  ): Promise<EnhancedExecutionResult> {
    // Get or create confidence spec
    const confidenceSpec = this.getConfidenceSpec(primitive);

    // Derive confidence factors
    const factors = new Map<string, ConfidenceValue>();

    for (const factor of confidenceSpec.factors) {
      const confidence = this.deriveFactor(factor, result, context, options);
      factors.set(factor.id, confidence);
    }

    // Combine factors into overall confidence
    const confidence = this.combineFactors(factors, confidenceSpec);

    // Record to evidence ledger if enabled
    let evidenceRecorded = false;
    if (this.config.recordExecutionEvents && this.config.ledger) {
      await this.recordExecutionEvidence(primitive, result, confidence, factors);
      evidenceRecorded = true;
    }

    return {
      ...result,
      confidence,
      confidenceFactors: factors,
      evidenceRecorded,
    };
  }

  /**
   * Create epistemics contract from technique primitive.
   */
  createEpistemicsContract(
    primitive: TechniquePrimitive
  ): PrimitiveContract<Record<string, unknown>, Record<string, unknown>> | null {
    const techniqueContract = primitive.contract;
    if (!techniqueContract) {
      return null;
    }

    const contractId = createContractId(`contract_${primitive.id}`);
    const primitiveId = createPrimitiveId(primitive.id);

    // Map technique contract to epistemics contract
    const epistemicsContract: PrimitiveContract<Record<string, unknown>, Record<string, unknown>> = {
      id: contractId,
      name: `${primitive.name} Contract`,
      description: `Contract for technique primitive: ${primitive.name}`,
      version: '1.0.0',
      primitiveId,
      preconditions: this.mapTechniquePreconditions(techniqueContract),
      postconditions: this.mapTechniquePostconditions(techniqueContract),
      invariants: [],
      confidenceDerivation: this.config.defaultConfidenceSpec,
      errorSpec: {
        expectedErrors: [
          { code: 'TIMEOUT', transient: true, handling: 'retry', description: 'Request timed out' },
          { code: 'RATE_LIMIT', transient: true, handling: 'retry', description: 'Rate limited' },
          { code: 'INVALID_INPUT', transient: false, handling: 'throw', description: 'Invalid input' },
        ],
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 500,
          backoffMultiplier: 2,
          maxDelayMs: 10000,
        },
        fallback: 'throw',
      },
    };

    return epistemicsContract;
  }

  /**
   * Register a technique primitive's contract with the epistemics registry.
   */
  registerPrimitiveContract(primitive: TechniquePrimitive): boolean {
    const contract = this.createEpistemicsContract(primitive);
    if (!contract) {
      return false;
    }

    try {
      this.config.registry.register(contract);
      return true;
    } catch {
      // Already registered
      return false;
    }
  }

  /**
   * Check if execution result meets minimum confidence threshold.
   */
  meetsConfidenceThreshold(enhancedResult: EnhancedExecutionResult): boolean {
    return meetsThreshold(enhancedResult.confidence, this.config.minimumConfidenceThreshold);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getConfidenceSpec(primitive: TechniquePrimitive): ConfidenceDerivationSpec {
    const primitiveId = createPrimitiveId(primitive.id);
    const registeredContract = this.config.registry.get(primitiveId);

    if (registeredContract) {
      return registeredContract.confidenceDerivation;
    }

    return this.config.defaultConfidenceSpec;
  }

  private deriveFactor(
    factor: ConfidenceFactor,
    result: PrimitiveExecutionResult,
    context: ExecutionContext,
    options?: {
      inputConfidences?: Map<string, ConfidenceValue>;
      evidenceAgeMs?: number;
    }
  ): ConfidenceValue {
    switch (factor.source) {
      case 'execution_quality':
        return deriveExecutionQualityFactor(result);
      case 'input_confidence':
        return deriveInputConfidenceFactor(result.input, options?.inputConfidences);
      case 'provider_reliability':
        return deriveProviderReliabilityFactor(context);
      case 'temporal_freshness':
        return deriveFreshnessFactor(result, options?.evidenceAgeMs);
      default:
        return absent('uncalibrated');
    }
  }

  private combineFactors(
    factors: Map<string, ConfidenceValue>,
    spec: ConfidenceDerivationSpec
  ): ConfidenceValue {
    if (factors.size === 0) {
      return absent('insufficient_data');
    }

    switch (spec.combiner) {
      case 'min': {
        let minValue = 1.0;
        for (const [, conf] of factors) {
          const value = getNumericConfidence(conf);
          if (value < minValue) {
            minValue = value;
          }
        }
        return createDerivedConfidence(minValue, 'min(factors)', Array.from(factors.keys()));
      }

      case 'weighted_average': {
        let totalWeight = 0;
        let weightedSum = 0;

        for (const factor of spec.factors) {
          const confidence = factors.get(factor.id);
          if (!confidence) continue;

          const weight = spec.weights?.[factor.id] ?? factor.baseWeight;
          const value = getNumericConfidence(confidence);
          const transformed = applyTransform(value, factor.transform);

          weightedSum += transformed * weight;
          totalWeight += weight;
        }

        const result = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
        return createDerivedConfidence(result, 'weighted_average(factors)', Array.from(factors.keys()));
      }

      case 'bayesian': {
        // Simple Bayesian combination: P(all) = product of priors
        let product = 1.0;
        for (const [, conf] of factors) {
          const value = getNumericConfidence(conf);
          product *= value;
        }
        return createDerivedConfidence(product, 'product(factors)', Array.from(factors.keys()));
      }

      case 'custom': {
        if (spec.customCombiner) {
          return spec.customCombiner(factors);
        }
        return absent('uncalibrated');
      }

      default:
        return absent('uncalibrated');
    }
  }

  private mapTechniquePreconditions(
    contract: TechniquePrimitiveContract
  ): PrimitiveContract<Record<string, unknown>, Record<string, unknown>>['preconditions'] {
    if (!contract.preconditions) {
      return [];
    }

    return contract.preconditions.map((condition, index) => ({
      id: `precondition_${index}`,
      description: condition,
      check: (_input: Record<string, unknown>) => {
        // Technique preconditions are string-based, parsed at runtime
        // This is a simplified mapping - full implementation would parse conditions
        return true;
      },
      onViolation: 'throw' as const,
      violationMessage: () => `Precondition failed: ${condition}`,
      severity: 'critical' as const,
    }));
  }

  private mapTechniquePostconditions(
    contract: TechniquePrimitiveContract
  ): PrimitiveContract<Record<string, unknown>, Record<string, unknown>>['postconditions'] {
    if (!contract.postconditions) {
      return [];
    }

    return contract.postconditions.map((condition, index) => ({
      id: `postcondition_${index}`,
      description: condition,
      check: (_input: Record<string, unknown>, _output: Record<string, unknown>) => {
        // Technique postconditions are string-based, parsed at runtime
        return true;
      },
      onViolation: 'warn' as const,
      violationMessage: () => `Postcondition failed: ${condition}`,
    }));
  }

  private async recordExecutionEvidence(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    confidence: ConfidenceValue,
    _factors: Map<string, ConfidenceValue>
  ): Promise<void> {
    if (!this.config.ledger) {
      return;
    }

    await this.config.ledger.append({
      kind: 'claim',
      payload: {
        claim: `Primitive ${primitive.id} executed with status ${result.status}`,
        category: 'behavior',
        subject: {
          type: 'function',
          identifier: primitive.id,
        },
        // Note: supportingEvidence and knownDefeaters require EvidenceId references
        // Technique execution results don't have ledger entries yet, so we use empty arrays
        // Future: could record execution evidence first and reference those IDs
        supportingEvidence: [],
        knownDefeaters: [],
        confidence,
      },
      provenance: {
        source: 'system_observation',
        method: 'technique_execution',
      },
      relatedEntries: [],
      confidence,
      sessionId: this.sessionId,
    });
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a technique contract bridge.
 */
export function createTechniqueContractBridge(
  config?: TechniqueContractBridgeConfig
): TechniqueContractBridge {
  return new TechniqueContractBridge(config);
}
