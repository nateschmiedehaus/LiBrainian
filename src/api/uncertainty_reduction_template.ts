/**
 * @fileoverview T12 UncertaintyReduction Template
 *
 * WU-TMPL-012: Implements uncertainty identification and iterative reduction.
 *
 * This template:
 * - Identifies areas of high uncertainty in responses
 * - Plans iterative refinement steps to reduce uncertainty
 * - Tracks uncertainty reduction through iterations
 * - Integrates with the defeater system for uncertainty sources
 *
 * Key Concepts:
 * - Uncertainty sources are categorized by type (missing_context, ambiguous_query, etc.)
 * - Reduction steps are planned based on source type
 * - Iteration continues until target confidence or max iterations
 * - Some uncertainties may be fundamentally irreducible
 *
 * @packageDocumentation
 */

import type { ContextPack } from '../types.js';
import type { AdequacyReport } from './difficulty_detectors.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type {
  ConstructionTemplate,
  OutputEnvelopeSpec,
  TemplateContext,
  TemplateResult,
  TemplateSelectionEvidence,
} from './template_registry.js';
import type { ExtendedDefeater, ExtendedDefeaterType } from '../epistemics/types.js';
import {
  type ConfidenceValue,
  getNumericValue,
  bounded,
  deterministic,
  isAbsentConfidence,
  isBoundedConfidence,
  isDeterministicConfidence,
  isMeasuredConfidence,
} from '../epistemics/confidence.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input for uncertainty reduction process.
 */
export interface UncertaintyReductionInput {
  /** The original query */
  query: string;
  /** Current response with uncertainty */
  currentResponse: string;
  /** Current confidence level */
  currentConfidence: ConfidenceValue;
  /** Maximum iterations to attempt (default: 5) */
  maxIterations?: number;
  /** Target confidence to achieve (default: 0.7) */
  targetConfidence?: number;
}

/**
 * Types of uncertainty sources.
 */
export type UncertaintySourceType =
  | 'missing_context'
  | 'ambiguous_query'
  | 'conflicting_sources'
  | 'stale_data'
  | 'limited_coverage';

/**
 * An identified source of uncertainty in the response.
 */
export interface UncertaintySource {
  /** Unique identifier */
  id: string;
  /** Type of uncertainty */
  type: UncertaintySourceType;
  /** Human-readable description */
  description: string;
  /** Claims affected by this uncertainty */
  affectedClaims: string[];
  /** Whether this uncertainty can be reduced */
  reducible: boolean;
  /** Strategy to reduce this uncertainty (if reducible) */
  reductionStrategy?: string;
}

/**
 * Actions that can be taken to reduce uncertainty.
 */
export type ReductionAction =
  | 'retrieve_more'
  | 'clarify_query'
  | 'verify_claim'
  | 'resolve_conflict'
  | 'refresh_data';

/**
 * A step in the uncertainty reduction process.
 */
export interface ReductionStep {
  /** Step number in sequence */
  stepNumber: number;
  /** Action to take */
  action: ReductionAction;
  /** Target of the action (e.g., claim ID, module name) */
  target: string;
  /** Expected uncertainty reduction (0-1) */
  expectedReduction: number;
  /** Actual reduction achieved (filled after execution) */
  actualReduction?: number;
  /** New confidence after this step (filled after execution) */
  newConfidence?: ConfidenceValue;
}

/**
 * Output from the uncertainty reduction process.
 */
export interface UncertaintyReductionOutput {
  /** Original confidence value (numeric) */
  originalConfidence: number;
  /** Final confidence value (numeric) */
  finalConfidence: number;
  /** All identified uncertainty sources */
  uncertaintySources: UncertaintySource[];
  /** Steps taken to reduce uncertainty */
  reductionSteps: ReductionStep[];
  /** Number of iterations performed */
  iterationsUsed: number;
  /** Refined response (if improved) */
  refinedResponse?: string;
  /** Sources that could not be reduced */
  unreducibleUncertainty: UncertaintySource[];
  /** Final confidence as ConfidenceValue type */
  confidence: ConfidenceValue;
}

/**
 * Extended template interface for T12.
 */
export interface UncertaintyReductionTemplate extends ConstructionTemplate {
  id: 'T12';
  name: 'UncertaintyReduction';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default maximum iterations */
const DEFAULT_MAX_ITERATIONS = 5;

/** Default target confidence */
const DEFAULT_TARGET_CONFIDENCE = 0.7;

/** High confidence threshold (no uncertainty sources if above this) */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

/** Wide confidence range threshold for bounded values */
const WIDE_RANGE_THRESHOLD = 0.4;

/** Patterns indicating ambiguous language in responses */
const AMBIGUOUS_PATTERNS = [
  /\bmight\b/i,
  /\bcould\b/i,
  /\bpossibly\b/i,
  /\bperhaps\b/i,
  /\bmaybe\b/i,
  /\bunclear\b/i,
  /\bnot sure\b/i,
  /\bor\b.*\bor\b/i,
  /\beither\b.*\bor\b/i,
];

/** Patterns indicating conflicting information */
const CONFLICT_PATTERNS = [
  /\bbut\b.*\bshows?\b/i,
  /\bdiscrepancy\b/i,
  /\bcontradicts?\b/i,
  /\bconflict(s|ing)?\b/i,
  /\binconsisten(t|cy)\b/i,
  /\bdocs?\s+(says?|shows?)\b.*\bcode\b/i,
  /\bcode\b.*\bdocs?\s+(says?|shows?)\b/i,
];

/** Patterns indicating stale/outdated data */
const STALE_PATTERNS = [
  /\bcached\b/i,
  /\boutdated\b/i,
  /\bold(er)?\b.*\b(info|data|version)\b/i,
  /\b\d+\s*(days?|weeks?|months?)\s*ago\b/i,
  /\bdeprecated\b/i,
  /\bhistorical\b/i,
];

/** Expected reduction values by action type */
const EXPECTED_REDUCTIONS: Record<ReductionAction, number> = {
  retrieve_more: 0.15,
  clarify_query: 0.2,
  verify_claim: 0.25,
  resolve_conflict: 0.3,
  refresh_data: 0.2,
};

// ============================================================================
// UNCERTAINTY SOURCE IDENTIFICATION
// ============================================================================

/**
 * Identify sources of uncertainty in a response.
 *
 * Analyzes the response text and confidence value to determine
 * what types of uncertainty exist and whether they can be reduced.
 *
 * @param response - The response text to analyze
 * @param confidence - The current confidence value
 * @returns Array of identified uncertainty sources
 */
export function identifyUncertaintySources(
  response: string,
  confidence: ConfidenceValue
): UncertaintySource[] {
  const sources: UncertaintySource[] = [];
  let sourceCounter = 0;

  const numericConfidence = getNumericValue(confidence);

  // High confidence deterministic or measured values have no uncertainty
  if (isDeterministicConfidence(confidence) && confidence.value === 1.0) {
    return [];
  }

  if (isMeasuredConfidence(confidence)) {
    const interval = confidence.measurement.confidenceInterval;
    const range = interval[1] - interval[0];
    // Narrow confidence interval means well-calibrated, low uncertainty
    if (confidence.value >= HIGH_CONFIDENCE_THRESHOLD && range < 0.1) {
      return [];
    }
  }

  // Check for missing context (low confidence overall)
  if (numericConfidence !== null && numericConfidence < 0.6) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'missing_context',
      description: 'Low confidence indicates potentially missing context',
      affectedClaims: extractClaimsFromResponse(response),
      reducible: true,
      reductionStrategy: 'Retrieve additional context from codebase',
    });
  }

  // Check for ambiguous query indicators
  if (AMBIGUOUS_PATTERNS.some((p) => p.test(response))) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'ambiguous_query',
      description: 'Response contains hedging language indicating interpretation uncertainty',
      affectedClaims: extractClaimsFromResponse(response),
      reducible: true,
      reductionStrategy: 'Clarify query intent and scope',
    });
  }

  // Check for conflicting sources
  if (CONFLICT_PATTERNS.some((p) => p.test(response))) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'conflicting_sources',
      description: 'Response mentions conflicting or contradictory information',
      affectedClaims: extractClaimsFromResponse(response),
      reducible: true,
      reductionStrategy: 'Verify claims against source of truth (code)',
    });
  }

  // Check for stale data indicators
  if (STALE_PATTERNS.some((p) => p.test(response))) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'stale_data',
      description: 'Response references potentially outdated information',
      affectedClaims: extractClaimsFromResponse(response),
      reducible: true,
      reductionStrategy: 'Refresh data from current sources',
    });
  }

  // Check for wide confidence range (limited coverage)
  if (isBoundedConfidence(confidence)) {
    const range = confidence.high - confidence.low;
    if (range >= WIDE_RANGE_THRESHOLD) {
      sources.push({
        id: `uncertainty-${++sourceCounter}`,
        type: 'limited_coverage',
        description: `Wide confidence range (${confidence.low.toFixed(2)}-${confidence.high.toFixed(2)}) indicates limited knowledge coverage`,
        affectedClaims: extractClaimsFromResponse(response),
        reducible: range < 0.6, // Very wide ranges may be fundamentally uncertain
        reductionStrategy: range < 0.6 ? 'Gather more evidence to narrow range' : undefined,
      });
    }
  }

  // Absent confidence is inherently uncertain
  if (isAbsentConfidence(confidence)) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'missing_context',
      description: `Confidence is absent (${confidence.reason})`,
      affectedClaims: extractClaimsFromResponse(response),
      reducible: true,
      reductionStrategy: 'Calibrate confidence through verification',
    });
  }

  // Handle empty response
  if (!response.trim()) {
    sources.push({
      id: `uncertainty-${++sourceCounter}`,
      type: 'missing_context',
      description: 'Empty response indicates complete lack of information',
      affectedClaims: [],
      reducible: true,
      reductionStrategy: 'Retrieve relevant context',
    });
  }

  return sources;
}

/**
 * Extract claims/assertions from a response text.
 * Simple heuristic: split on sentence boundaries.
 */
function extractClaimsFromResponse(response: string): string[] {
  if (!response.trim()) return [];

  // Split on sentence-ending punctuation
  const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 10);

  // Return first few sentences as claims
  return sentences.slice(0, 5).map((s) => s.trim());
}

// ============================================================================
// REDUCTION STEP PLANNING
// ============================================================================

/**
 * Plan reduction steps based on identified uncertainty sources.
 *
 * Creates an ordered list of steps to reduce uncertainty, with
 * steps ordered by expected impact (higher expected reduction first).
 *
 * @param sources - Identified uncertainty sources
 * @returns Ordered array of reduction steps
 */
export function planReductionSteps(sources: UncertaintySource[]): ReductionStep[] {
  const steps: ReductionStep[] = [];

  // Only plan steps for reducible sources
  const reducibleSources = sources.filter((s) => s.reducible);

  for (const source of reducibleSources) {
    const action = mapSourceTypeToAction(source.type);
    const step: ReductionStep = {
      stepNumber: 0, // Will be assigned after sorting
      action,
      target: `${source.type}:${source.id}`,
      expectedReduction: EXPECTED_REDUCTIONS[action],
    };
    steps.push(step);
  }

  // Sort by expected reduction (descending)
  steps.sort((a, b) => b.expectedReduction - a.expectedReduction);

  // Assign sequential step numbers
  steps.forEach((step, index) => {
    step.stepNumber = index + 1;
  });

  return steps;
}

/**
 * Map an uncertainty source type to an appropriate reduction action.
 */
function mapSourceTypeToAction(sourceType: UncertaintySourceType): ReductionAction {
  switch (sourceType) {
    case 'missing_context':
      return 'retrieve_more';
    case 'ambiguous_query':
      return 'clarify_query';
    case 'conflicting_sources':
      return 'resolve_conflict';
    case 'stale_data':
      return 'refresh_data';
    case 'limited_coverage':
      return 'retrieve_more';
    default:
      return 'retrieve_more';
  }
}

// ============================================================================
// REDUCTION STEP EXECUTION
// ============================================================================

/**
 * Context for step execution.
 */
interface StepExecutionContext {
  query: string;
  currentResponse: string;
  currentConfidence: ConfidenceValue;
}

/**
 * Execute a single reduction step.
 *
 * This is a simulation of step execution. In a real implementation,
 * each action would connect to actual retrieval, verification, etc.
 *
 * @param step - The step to execute
 * @param context - Current execution context
 * @returns The step with actualReduction and newConfidence filled in
 */
export async function executeReductionStep(
  step: ReductionStep,
  context: StepExecutionContext
): Promise<ReductionStep> {
  const currentNumeric = getNumericValue(context.currentConfidence) ?? 0.5;

  // Simulate step execution with probabilistic success
  // In reality, this would call into iterative_retrieval, defeaters, etc.
  const successProbability = 0.7; // Simulated success rate
  const success = Math.random() < successProbability;

  let actualReduction: number;
  let newNumericConfidence: number;

  if (success) {
    // Successful step achieves some fraction of expected reduction
    const achievementRate = 0.5 + Math.random() * 0.5; // 50-100% of expected
    actualReduction = step.expectedReduction * achievementRate;
    newNumericConfidence = Math.min(1.0, currentNumeric + actualReduction);
  } else {
    // Failed step may still have minor improvement
    actualReduction = step.expectedReduction * 0.1;
    newNumericConfidence = Math.min(1.0, currentNumeric + actualReduction);
  }

  // Create new confidence as bounded (showing improvement from iteration)
  const newConfidence: ConfidenceValue = bounded(
    newNumericConfidence * 0.9,
    Math.min(1.0, newNumericConfidence * 1.1),
    'theoretical',
    `After ${step.action} step`
  );

  return {
    ...step,
    actualReduction,
    newConfidence,
  };
}

// ============================================================================
// ITERATIVE REFINEMENT
// ============================================================================

/**
 * Iterate uncertainty reduction until target confidence or max iterations.
 *
 * This is the main entry point for the uncertainty reduction process.
 * It identifies sources, plans steps, executes them iteratively,
 * and tracks progress until completion.
 *
 * @param input - The reduction input parameters
 * @returns Complete reduction output with all tracking data
 */
export async function iterateUntilTarget(
  input: UncertaintyReductionInput
): Promise<UncertaintyReductionOutput> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const targetConfidence = input.targetConfidence ?? DEFAULT_TARGET_CONFIDENCE;

  const originalNumeric = getNumericValue(input.currentConfidence) ?? 0.5;
  let currentConfidence = input.currentConfidence;
  let currentResponse = input.currentResponse;
  let iterationsUsed = 0;

  const allSources: UncertaintySource[] = [];
  const allSteps: ReductionStep[] = [];
  const unreducible: UncertaintySource[] = [];

  // Handle edge case: zero iterations
  if (maxIterations <= 0) {
    const sources = identifyUncertaintySources(currentResponse, currentConfidence);
    return {
      originalConfidence: originalNumeric,
      finalConfidence: originalNumeric,
      uncertaintySources: sources,
      reductionSteps: [],
      iterationsUsed: 0,
      unreducibleUncertainty: sources.filter((s) => !s.reducible),
      confidence: currentConfidence,
    };
  }

  // Main iteration loop
  while (iterationsUsed < maxIterations) {
    const currentNumeric = getNumericValue(currentConfidence) ?? 0.5;

    // Check if target reached
    if (currentNumeric >= targetConfidence) {
      break;
    }

    // Identify current uncertainty sources
    const sources = identifyUncertaintySources(currentResponse, currentConfidence);

    // Track new sources
    for (const source of sources) {
      if (!allSources.find((s) => s.id === source.id)) {
        allSources.push(source);
        if (!source.reducible) {
          unreducible.push(source);
        }
      }
    }

    // Plan reduction steps
    const steps = planReductionSteps(sources);

    // No more steps to take
    if (steps.length === 0) {
      break;
    }

    // Execute the best step
    const bestStep = steps[0];
    const executedStep = await executeReductionStep(bestStep, {
      query: input.query,
      currentResponse,
      currentConfidence,
    });

    allSteps.push(executedStep);

    // Update confidence for next iteration
    if (executedStep.newConfidence) {
      currentConfidence = executedStep.newConfidence;
    }

    // Simulate response refinement if step was successful
    if (executedStep.actualReduction && executedStep.actualReduction > 0.05) {
      currentResponse = `[Refined] ${currentResponse}`;
    }

    iterationsUsed++;
  }

  const finalNumeric = getNumericValue(currentConfidence) ?? originalNumeric;

  return {
    originalConfidence: originalNumeric,
    finalConfidence: finalNumeric,
    uncertaintySources: allSources,
    reductionSteps: allSteps,
    iterationsUsed,
    refinedResponse: iterationsUsed > 0 ? currentResponse : undefined,
    unreducibleUncertainty: unreducible,
    confidence: currentConfidence,
  };
}

// ============================================================================
// DEFEATER INTEGRATION
// ============================================================================

/**
 * Map a defeater to an uncertainty source.
 *
 * Connects the defeater system with uncertainty reduction by
 * translating defeater types into uncertainty source types.
 *
 * @param defeater - The defeater to map
 * @returns An uncertainty source derived from the defeater
 */
export function mapDefeaterToUncertaintySource(defeater: ExtendedDefeater): UncertaintySource {
  const sourceType = mapDefeaterTypeToSourceType(defeater.type);

  return {
    id: `defeater-${defeater.id}`,
    type: sourceType,
    description: defeater.description,
    affectedClaims: defeater.affectedClaimIds,
    reducible: isDefeaterReducible(defeater),
    reductionStrategy: defeater.resolutionAction
      ? `Apply ${defeater.resolutionAction} resolution`
      : undefined,
  };
}

/**
 * Map defeater type to uncertainty source type.
 */
function mapDefeaterTypeToSourceType(defeaterType: ExtendedDefeaterType): UncertaintySourceType {
  switch (defeaterType) {
    case 'staleness':
      return 'stale_data';
    case 'code_change':
    case 'hash_mismatch':
    case 'new_info':
      return 'missing_context';
    case 'contradiction':
      return 'conflicting_sources';
    case 'test_failure':
      return 'conflicting_sources';
    case 'coverage_gap':
      return 'limited_coverage';
    case 'provider_unavailable':
    case 'tool_failure':
    case 'sandbox_mismatch':
      return 'missing_context';
    case 'untrusted_content':
      return 'conflicting_sources';
    case 'dependency_drift':
      return 'stale_data';
    default:
      return 'missing_context';
  }
}

/**
 * Determine if a defeater's uncertainty is reducible.
 */
function isDefeaterReducible(defeater: ExtendedDefeater): boolean {
  // Full severity defeaters may still be reducible through verification
  if (defeater.severity === 'full') {
    return defeater.autoResolvable || defeater.type === 'contradiction';
  }
  return true;
}

// ============================================================================
// TEMPLATE IMPLEMENTATION
// ============================================================================

/**
 * Create the T12 UncertaintyReduction template.
 *
 * This template integrates with the template registry and provides
 * the standard ConstructionTemplate interface for uncertainty reduction.
 *
 * @returns The T12 template instance
 */
export function createUncertaintyReductionTemplate(): UncertaintyReductionTemplate {
  const template: UncertaintyReductionTemplate = {
    id: 'T12',
    name: 'UncertaintyReduction',
    description: 'Identify next-best questions for uncertainty reduction and gap closure.',
    supportedUcs: ['UC-241', 'UC-251'],
    requiredMaps: [],
    optionalMaps: ['GapModel', 'AdequacyReport'],
    requiredObjects: ['claim', 'pack'],
    requiredArtifacts: ['adequacy_report', 'gap_model', 'defeaters'],
    outputEnvelope: {
      packTypes: ['NextQuestionPack'],
      requiresAdequacy: true,
      requiresVerificationPlan: false,
    },
    execute: executeUncertaintyReductionTemplate,
  };

  return template;
}

/**
 * Execute the uncertainty reduction template.
 */
async function executeUncertaintyReductionTemplate(
  context: TemplateContext
): Promise<TemplateResult> {
  const now = new Date().toISOString();

  // Create initial confidence based on context
  const initialConfidence: ConfidenceValue = bounded(
    0.3,
    0.6,
    'theoretical',
    'Initial query analysis'
  );

  // Perform uncertainty reduction
  const input: UncertaintyReductionInput = {
    query: context.intent,
    currentResponse: `Analysis of: ${context.intent}`,
    currentConfidence: initialConfidence,
    maxIterations: context.depth === 'deep' ? 5 : context.depth === 'shallow' ? 2 : 3,
    targetConfidence: 0.7,
  };

  const result = await iterateUntilTarget(input);

  // Build context pack
  const pack: ContextPack = {
    packId: `pack_t12_${Date.now()}`,
    packType: 'change_impact', // Using available type; would ideally be 'uncertainty_reduction'
    targetId: context.intent,
    summary: buildSummary(result),
    keyFacts: buildKeyFacts(result),
    codeSnippets: [],
    relatedFiles: [],
    confidence: result.finalConfidence,
    rawConfidence: result.originalConfidence,
    calibratedConfidence: result.finalConfidence,
    uncertainty: 1 - result.finalConfidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: '1.0.0',
      features: ['uncertainty_reduction'],
    },
    invalidationTriggers: [],
  };

  // Build disclosures
  const disclosures: string[] = [];

  if (result.uncertaintySources.length === 0) {
    disclosures.push('no_uncertainty_sources: High confidence achieved');
  }

  if (result.unreducibleUncertainty.length > 0) {
    disclosures.push(
      `unreducible_uncertainty(${result.unreducibleUncertainty.length}): Some uncertainties cannot be further reduced`
    );
  }

  if (result.iterationsUsed === 0) {
    disclosures.push('no_iterations: No reduction steps were necessary');
  }

  // Build evidence
  const evidence: TemplateSelectionEvidence[] = [
    {
      templateId: 'T12',
      selectedAt: now,
      reason: `Uncertainty reduction for query: ${context.intent.slice(0, 50)}`,
      intentKeywords: context.intent.split(/\s+/).slice(0, 5),
    },
  ];

  return {
    success: true,
    packs: [pack],
    adequacy: null,
    verificationPlan: null,
    disclosures,
    traceId: `trace_T12_${Date.now()}`,
    evidence,
  };
}

/**
 * Build summary from reduction result.
 */
function buildSummary(result: UncertaintyReductionOutput): string {
  const improvement = result.finalConfidence - result.originalConfidence;
  const improvementPct = (improvement * 100).toFixed(1);

  if (result.iterationsUsed === 0) {
    return `No uncertainty reduction needed. Initial confidence: ${(result.originalConfidence * 100).toFixed(1)}%`;
  }

  return `Uncertainty reduced through ${result.iterationsUsed} iteration(s). ` +
    `Confidence improved from ${(result.originalConfidence * 100).toFixed(1)}% to ${(result.finalConfidence * 100).toFixed(1)}% ` +
    `(+${improvementPct}%). Identified ${result.uncertaintySources.length} uncertainty source(s).`;
}

/**
 * Build key facts from reduction result.
 */
function buildKeyFacts(result: UncertaintyReductionOutput): string[] {
  const facts: string[] = [];

  // Confidence improvement
  facts.push(
    `Original confidence: ${(result.originalConfidence * 100).toFixed(1)}%`
  );
  facts.push(
    `Final confidence: ${(result.finalConfidence * 100).toFixed(1)}%`
  );

  // Uncertainty sources
  if (result.uncertaintySources.length > 0) {
    const sourceTypes = [...new Set(result.uncertaintySources.map((s) => s.type))];
    facts.push(`Uncertainty types: ${sourceTypes.join(', ')}`);
  }

  // Reduction steps
  if (result.reductionSteps.length > 0) {
    const actions = result.reductionSteps.map((s) => s.action);
    facts.push(`Reduction actions: ${actions.join(', ')}`);
  }

  // Unreducible uncertainty
  if (result.unreducibleUncertainty.length > 0) {
    facts.push(
      `Irreducible uncertainties: ${result.unreducibleUncertainty.length}`
    );
  }

  return facts;
}
