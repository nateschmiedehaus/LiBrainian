/**
 * @fileoverview Defeater Calculus Engine
 *
 * Implements Pollock's defeater theory for knowledge validation:
 * - Rebutting defeaters: Direct contradiction of claims
 * - Undercutting defeaters: Attack the justification, not the claim
 * - Undermining defeaters: Reduce confidence without full defeat
 *
 * Key principles:
 * - All defeaters are typed and computed
 * - Contradictions remain visible - never silently reconcile
 * - Supports automatic detection and resolution where safe
 *
 * @packageDocumentation
 */

import {
  type Claim,
  type ClaimId,
  type ExtendedDefeater,
  type ExtendedDefeaterType,
  type DefeaterSeverity,
  type Contradiction,
  type ContradictionResolution,
  type ContradictionType,
  type ClaimSignalStrength,
  type EvidenceGraph,
  type EvidenceEdge,
  createClaimId,
  createDefeater,
  createContradiction,
  computeOverallSignalStrength,
} from './types.js';
import type { ConstructionCalibrationTracker } from '../constructions/calibration_tracker.js';
import {
  onContradictionResolved,
  type ContradictionCalibrationResolution,
} from './calibration_integration.js';
import type { EvidenceProvenance, ProvenanceSource } from './evidence_ledger.js';
import type { EvidenceGraphStorage } from './storage.js';
import {
  type ConfidenceValue,
  type DerivedConfidence,
  getNumericValue,
  absent,
} from './confidence.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Configuration for the defeater engine */
export interface DefeaterEngineConfig {
  /** How old (in ms) before a claim is considered stale */
  stalenessThresholdMs: number;

  /** Minimum signal strength below which claims are auto-defeated */
  minimumSignalStrengthThreshold: number;

  /** Whether to automatically activate detected defeaters */
  autoActivateDefeaters: boolean;

  /** Whether to automatically resolve resolvable defeaters */
  autoResolveDefeaters: boolean;

  /** Maximum defeaters to process in a single batch */
  maxBatchSize: number;
}

/** Default configuration */
export const DEFAULT_DEFEATER_CONFIG: DefeaterEngineConfig = {
  stalenessThresholdMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  minimumSignalStrengthThreshold: 0.1,
  autoActivateDefeaters: true,
  autoResolveDefeaters: false,
  maxBatchSize: 100,
};

// ============================================================================
// DEFEATER DETECTION
// ============================================================================

/** Result of defeater detection */
export interface DetectionResult {
  defeaters: ExtendedDefeater[];
  contradictions: Contradiction[];
  affectedClaimIds: ClaimId[];
}

/** Context for defeater detection */
export interface DetectionContext {
  /** Changed file paths */
  changedFiles?: string[];

  /** Failed test identifiers */
  failedTests?: string[];

  /** New claims to check for contradictions */
  newClaims?: Claim[];

  /** Current timestamp for staleness checks */
  timestamp?: string;

  /** Hash mismatches detected */
  hashMismatches?: Array<{ claimId: ClaimId; expected: string; actual: string }>;

  /** Provider availability status */
  providerStatus?: Record<string, boolean>;
}

/**
 * Detect defeaters based on context.
 * This is the main entry point for defeater detection.
 */
export async function detectDefeaters(
  storage: EvidenceGraphStorage,
  context: DetectionContext,
  config: DefeaterEngineConfig = DEFAULT_DEFEATER_CONFIG
): Promise<DetectionResult> {
  const defeaters: ExtendedDefeater[] = [];
  const contradictions: Contradiction[] = [];
  const affectedClaimIds = new Set<ClaimId>();

  // Detect staleness defeaters
  if (context.timestamp) {
    const stalenessDefeaters = await detectStalenessDefeaters(
      storage,
      context.timestamp,
      config.stalenessThresholdMs
    );
    for (const d of stalenessDefeaters) {
      defeaters.push(d);
      for (const id of d.affectedClaimIds) {
        affectedClaimIds.add(id);
      }
    }
  }

  // Detect code change defeaters
  if (context.changedFiles?.length) {
    const codeChangeDefeaters = await detectCodeChangeDefeaters(
      storage,
      context.changedFiles
    );
    for (const d of codeChangeDefeaters) {
      defeaters.push(d);
      for (const id of d.affectedClaimIds) {
        affectedClaimIds.add(id);
      }
    }
  }

  // Detect test failure defeaters
  if (context.failedTests?.length) {
    const testFailureDefeaters = await detectTestFailureDefeaters(
      storage,
      context.failedTests
    );
    for (const d of testFailureDefeaters) {
      defeaters.push(d);
      for (const id of d.affectedClaimIds) {
        affectedClaimIds.add(id);
      }
    }
  }

  // Detect contradictions from new claims
  if (context.newClaims?.length) {
    const newContradictions = await detectContradictions(storage, context.newClaims);
    for (const c of newContradictions) {
      contradictions.push(c);
      affectedClaimIds.add(c.claimA);
      affectedClaimIds.add(c.claimB);
    }
  }

  // Detect hash mismatch defeaters
  if (context.hashMismatches?.length) {
    const hashDefeaters = detectHashMismatchDefeaters(context.hashMismatches);
    for (const d of hashDefeaters) {
      defeaters.push(d);
      for (const id of d.affectedClaimIds) {
        affectedClaimIds.add(id);
      }
    }
  }

  // Detect provider unavailability defeaters
  if (context.providerStatus) {
    const providerDefeaters = await detectProviderDefeaters(
      storage,
      context.providerStatus
    );
    for (const d of providerDefeaters) {
      defeaters.push(d);
      for (const id of d.affectedClaimIds) {
        affectedClaimIds.add(id);
      }
    }
  }

  return {
    defeaters,
    contradictions,
    affectedClaimIds: Array.from(affectedClaimIds),
  };
}

/**
 * Detect staleness defeaters for claims that haven't been validated recently.
 */
async function detectStalenessDefeaters(
  storage: EvidenceGraphStorage,
  currentTimestamp: string,
  thresholdMs: number
): Promise<ExtendedDefeater[]> {
  const defeaters: ExtendedDefeater[] = [];
  const claims = await storage.getClaims({ status: 'active' });
  const now = new Date(currentTimestamp).getTime();

  for (const claim of claims) {
    const claimTime = new Date(claim.createdAt).getTime();
    const age = now - claimTime;

    if (age > thresholdMs) {
      defeaters.push(
        createDefeater({
          type: 'staleness',
          description: `Claim "${claim.proposition.slice(0, 50)}..." is ${Math.floor(age / (24 * 60 * 60 * 1000))} days old`,
          severity: age > thresholdMs * 2 ? 'partial' : 'warning',
          affectedClaimIds: [claim.id],
          confidenceReduction: Math.min(0.3, (age / thresholdMs - 1) * 0.1),
          autoResolvable: true,
          resolutionAction: 'revalidate',
          evidence: `Created: ${claim.createdAt}, Age: ${age}ms, Threshold: ${thresholdMs}ms`,
        })
      );
    }
  }

  return defeaters;
}

/**
 * Detect defeaters for claims about code that has changed.
 */
async function detectCodeChangeDefeaters(
  storage: EvidenceGraphStorage,
  changedFiles: string[]
): Promise<ExtendedDefeater[]> {
  const defeaters: ExtendedDefeater[] = [];

  for (const file of changedFiles) {
    // Find claims that reference this file
    const claims = await storage.getClaims({ status: 'active' });
    const affectedClaims = claims.filter(
      (c) => c.subject.location?.file === file || c.subject.id.includes(file)
    );

    if (affectedClaims.length > 0) {
      defeaters.push(
        createDefeater({
          type: 'code_change',
          description: `File "${file}" was modified, affecting ${affectedClaims.length} claim(s)`,
          severity: 'partial',
          affectedClaimIds: affectedClaims.map((c) => c.id),
          confidenceReduction: 0.2,
          autoResolvable: true,
          resolutionAction: 'reindex',
          evidence: `Changed file: ${file}`,
        })
      );
    }
  }

  return defeaters;
}

/**
 * Detect defeaters for claims whose tests have failed.
 */
async function detectTestFailureDefeaters(
  storage: EvidenceGraphStorage,
  failedTests: string[]
): Promise<ExtendedDefeater[]> {
  const defeaters: ExtendedDefeater[] = [];

  for (const testId of failedTests) {
    // Find claims with test execution evidence from this test
    const claims = await storage.getClaims({ status: 'active' });
    const affectedClaims = claims.filter(
      (c) =>
        c.source.type === 'test' && c.source.id === testId ||
        c.subject.id === testId
    );

    if (affectedClaims.length > 0) {
      defeaters.push(
        createDefeater({
          type: 'test_failure',
          description: `Test "${testId}" failed, invalidating ${affectedClaims.length} claim(s)`,
          severity: 'full',
          affectedClaimIds: affectedClaims.map((c) => c.id),
          confidenceReduction: 1.0,
          autoResolvable: false,
          evidence: `Failed test: ${testId}`,
        })
      );
    }
  }

  return defeaters;
}

/**
 * Detect contradictions between new claims and existing claims.
 */
async function detectContradictions(
  storage: EvidenceGraphStorage,
  newClaims: Claim[]
): Promise<Contradiction[]> {
  const contradictions: Contradiction[] = [];
  const existingClaims = await storage.getClaims({ status: 'active' });

  for (const newClaim of newClaims) {
    for (const existingClaim of existingClaims) {
      // Skip if same claim
      if (newClaim.id === existingClaim.id) continue;

      // Check for potential contradiction
      const contradictionType = detectContradictionType(newClaim, existingClaim);
      if (contradictionType) {
        contradictions.push(
          createContradiction(
            newClaim.id,
            existingClaim.id,
            contradictionType.type,
            contradictionType.explanation,
            contradictionType.severity
          )
        );
      }
    }
  }

  return contradictions;
}

/**
 * Detect the type of contradiction between two claims, if any.
 */
function detectContradictionType(
  claimA: Claim,
  claimB: Claim
): { type: ContradictionType; explanation: string; severity: 'blocking' | 'significant' | 'minor' } | null {
  // Same subject, same type - potential direct contradiction
  if (
    claimA.subject.id === claimB.subject.id &&
    claimA.type === claimB.type
  ) {
    // Check for semantic opposition indicators
    const aLower = claimA.proposition.toLowerCase();
    const bLower = claimB.proposition.toLowerCase();

    // Direct negation patterns
    if (
      (aLower.includes('not') && !bLower.includes('not')) ||
      (!aLower.includes('not') && bLower.includes('not')) ||
      (aLower.includes("doesn't") && !bLower.includes("doesn't")) ||
      (aLower.includes('never') && bLower.includes('always')) ||
      (aLower.includes('always') && bLower.includes('never'))
    ) {
      return {
        type: 'direct',
        explanation: `Claims make opposing assertions about "${claimA.subject.name}"`,
        severity: 'blocking',
      };
    }

    // Temporal contradiction - same subject, different time assertions
    if (claimA.type === 'temporal' || claimB.type === 'temporal') {
      return {
        type: 'temporal',
        explanation: `Claims make different temporal assertions about "${claimA.subject.name}"`,
        severity: 'significant',
      };
    }

    // Different propositions about same subject - potential scope conflict
    if (claimA.proposition !== claimB.proposition) {
      return {
        type: 'scope',
        explanation: `Claims make different assertions about "${claimA.subject.name}" - may conflict at different scopes`,
        severity: 'minor',
      };
    }
  }

  return null;
}

/**
 * Detect hash mismatch defeaters.
 */
function detectHashMismatchDefeaters(
  mismatches: Array<{ claimId: ClaimId; expected: string; actual: string }>
): ExtendedDefeater[] {
  return mismatches.map((m) =>
    createDefeater({
      type: 'hash_mismatch',
      description: `Content hash mismatch for claim - expected ${m.expected.slice(0, 8)}, got ${m.actual.slice(0, 8)}`,
      severity: 'full',
      affectedClaimIds: [m.claimId],
      confidenceReduction: 1.0,
      autoResolvable: true,
      resolutionAction: 'reindex',
      evidence: `Expected: ${m.expected}, Actual: ${m.actual}`,
    })
  );
}

/**
 * Detect provider unavailability defeaters.
 */
async function detectProviderDefeaters(
  storage: EvidenceGraphStorage,
  providerStatus: Record<string, boolean>
): Promise<ExtendedDefeater[]> {
  const defeaters: ExtendedDefeater[] = [];

  for (const [provider, available] of Object.entries(providerStatus)) {
    if (!available) {
      // Find claims that depend on this provider
      const claims = await storage.getClaims({ status: 'active' });
      const affectedClaims = claims.filter(
        (c) => c.source.type === 'llm' && c.source.id.includes(provider)
      );

      if (affectedClaims.length > 0) {
        defeaters.push(
          createDefeater({
            type: 'provider_unavailable',
            description: `Provider "${provider}" is unavailable, ${affectedClaims.length} claim(s) cannot be revalidated`,
            severity: 'warning',
            affectedClaimIds: affectedClaims.map((c) => c.id),
            confidenceReduction: 0.1,
            autoResolvable: true,
            resolutionAction: 'retry_provider',
            evidence: `Provider: ${provider}, Status: unavailable`,
          })
        );
      }
    }
  }

  return defeaters;
}

// ============================================================================
// DEFEATER APPLICATION
// ============================================================================

/** Result of applying defeaters */
export interface ApplicationResult {
  /** Claims that were updated */
  updatedClaims: ClaimId[];

  /** Defeaters that were activated */
  activatedDefeaters: string[];

  /** Defeaters that were auto-resolved */
  resolvedDefeaters: string[];

  /** New contradictions that were recorded */
  recordedContradictions: string[];
}

/**
 * Apply detected defeaters to the evidence graph.
 */
export async function applyDefeaters(
  storage: EvidenceGraphStorage,
  detectionResult: DetectionResult,
  config: DefeaterEngineConfig = DEFAULT_DEFEATER_CONFIG
): Promise<ApplicationResult> {
  const result: ApplicationResult = {
    updatedClaims: [],
    activatedDefeaters: [],
    resolvedDefeaters: [],
    recordedContradictions: [],
  };

  // Store and optionally activate defeaters
  for (const defeater of detectionResult.defeaters.slice(0, config.maxBatchSize)) {
    await storage.upsertDefeater(defeater);

    if (config.autoActivateDefeaters) {
      await storage.activateDefeater(defeater.id);
      result.activatedDefeaters.push(defeater.id);

      // Apply signal-strength reduction to affected claims
      for (const claimId of defeater.affectedClaimIds) {
        const claim = await storage.getClaim(claimId);
        if (claim) {
          const newSignalStrength = applySignalStrengthReduction(
            claim.signalStrength,
            defeater.confidenceReduction,
            defeater.type
          );
          await storage.updateClaimSignalStrength(claimId, newSignalStrength);

          // Update status if signal strength falls below threshold
          if (newSignalStrength.overall < config.minimumSignalStrengthThreshold) {
            await storage.updateClaimStatus(claimId, 'defeated');
          } else if (defeater.severity === 'full') {
            await storage.updateClaimStatus(claimId, 'defeated');
          }

          result.updatedClaims.push(claimId);
        }
      }
    }

    // Auto-resolve if configured and defeater supports it
    if (config.autoResolveDefeaters && defeater.autoResolvable) {
      await storage.resolveDefeater(defeater.id);
      result.resolvedDefeaters.push(defeater.id);
    }
  }

  // Store contradictions
  for (const contradiction of detectionResult.contradictions) {
    await storage.upsertContradiction(contradiction);
    result.recordedContradictions.push(contradiction.id);

    // Mark both claims as contradicted
    await storage.updateClaimStatus(contradiction.claimA, 'contradicted');
    await storage.updateClaimStatus(contradiction.claimB, 'contradicted');
    result.updatedClaims.push(contradiction.claimA, contradiction.claimB);
  }

  return result;
}

/**
 * Apply confidence reduction based on defeater type.
 */
function applySignalStrengthReduction(
  signalStrength: ClaimSignalStrength,
  reduction: number,
  defeaterType: ExtendedDefeaterType
): ClaimSignalStrength {
  const newSignalStrength = { ...signalStrength };

  // Apply reduction to relevant signal components based on defeater type
  switch (defeaterType) {
    case 'code_change':
    case 'hash_mismatch':
      // Affects structural and recency signal strength
      newSignalStrength.structural = Math.max(0, signalStrength.structural - reduction);
      newSignalStrength.recency = Math.max(0, signalStrength.recency - reduction);
      break;

    case 'test_failure':
      // Primarily affects test execution signal strength
      newSignalStrength.testExecution = Math.max(0, signalStrength.testExecution - reduction);
      break;

    case 'staleness':
      // Primarily affects recency signal strength
      newSignalStrength.recency = Math.max(0, signalStrength.recency - reduction);
      break;

    case 'contradiction':
    case 'new_info':
      // Affects semantic signal strength
      newSignalStrength.semantic = Math.max(0, signalStrength.semantic - reduction);
      break;

    case 'coverage_gap':
      // Affects retrieval signal strength
      newSignalStrength.retrieval = Math.max(0, signalStrength.retrieval - reduction);
      break;

    case 'tool_failure':
    case 'sandbox_mismatch':
      // Affects structural signal strength
      newSignalStrength.structural = Math.max(0, signalStrength.structural - reduction);
      break;

    case 'provider_unavailable':
      // Minor overall reduction
      newSignalStrength.retrieval = Math.max(0, signalStrength.retrieval - reduction * 0.5);
      newSignalStrength.semantic = Math.max(0, signalStrength.semantic - reduction * 0.5);
      break;

    default:
      // Generic reduction across all components
      newSignalStrength.retrieval = Math.max(0, signalStrength.retrieval - reduction * 0.2);
      newSignalStrength.structural = Math.max(0, signalStrength.structural - reduction * 0.2);
      newSignalStrength.semantic = Math.max(0, signalStrength.semantic - reduction * 0.2);
      newSignalStrength.testExecution = Math.max(0, signalStrength.testExecution - reduction * 0.2);
      newSignalStrength.recency = Math.max(0, signalStrength.recency - reduction * 0.2);
  }

  // Recompute overall signal strength
  newSignalStrength.overall = computeOverallSignalStrength(newSignalStrength);

  return newSignalStrength;
}

// ============================================================================
// DEFEATER RESOLUTION
// ============================================================================

/** Resolution action for a defeater */
export interface ResolutionAction {
  defeater: ExtendedDefeater;
  action: 'revalidate' | 'reindex' | 'retry_provider' | 'manual' | 'ignore';
  priority: number;
}

/**
 * Get recommended resolution actions for active defeaters.
 */
export async function getResolutionActions(
  storage: EvidenceGraphStorage
): Promise<ResolutionAction[]> {
  const activeDefeaters = await storage.getActiveDefeaters();
  const actions: ResolutionAction[] = [];

  for (const defeater of activeDefeaters) {
    let action: ResolutionAction['action'] = 'manual';
    let priority = 1;

    if (defeater.autoResolvable && defeater.resolutionAction) {
      switch (defeater.resolutionAction) {
        case 'revalidate':
          action = 'revalidate';
          priority = 2;
          break;
        case 'reindex':
          action = 'reindex';
          priority = 3;
          break;
        case 'retry_provider':
          action = 'retry_provider';
          priority = 1;
          break;
      }
    }

    // Adjust priority based on severity
    if (defeater.severity === 'full') {
      priority += 10;
    } else if (defeater.severity === 'partial') {
      priority += 5;
    }

    actions.push({ defeater, action, priority });
  }

  // Sort by priority (highest first)
  return actions.sort((a, b) => b.priority - a.priority);
}

/**
 * Resolve a defeater by applying its resolution action.
 */
export async function resolveDefeater(
  storage: EvidenceGraphStorage,
  defeaterId: string,
  action: ResolutionAction['action']
): Promise<void> {
  const defeater = await storage.getDefeater(defeaterId);
  if (!defeater) {
    throw new Error(`Defeater ${defeaterId} not found`);
  }

  // Mark defeater as resolved
  await storage.resolveDefeater(defeaterId);

  // Restore affected claims if action was successful
  if (action !== 'ignore') {
    for (const claimId of defeater.affectedClaimIds) {
      const claim = await storage.getClaim(claimId);
      if (claim && claim.status === 'defeated') {
        // Check if there are other active defeaters for this claim
        const otherDefeaters = await storage.getDefeatersForClaim(claimId);
        const stillDefeated = otherDefeaters.some(
          (d) => d.id !== defeaterId && d.status === 'active'
        );

        if (!stillDefeated) {
          // Restore claim to stale status (needs revalidation)
          await storage.updateClaimStatus(claimId, 'stale');
        }
      }
    }
  }
}

/**
 * Resolve a contradiction and route winner/loser outcomes into calibration tracking.
 */
export async function resolveContradictionWithCalibration(
  storage: EvidenceGraphStorage,
  contradictionId: string,
  resolution: ContradictionResolution,
  tracker: ConstructionCalibrationTracker,
  calibration: ContradictionCalibrationResolution
): Promise<void> {
  await storage.resolveContradiction(contradictionId, resolution);
  onContradictionResolved(resolution, calibration, tracker);
}

// ============================================================================
// GRAPH HEALTH
// ============================================================================

/** Health assessment of the evidence graph */
export interface GraphHealthAssessment {
  /** Overall health score (0-1) */
  overallHealth: number;

  /** Number of active claims */
  activeClaimCount: number;

  /** Number of defeated claims */
  defeatedClaimCount: number;

  /** Number of stale claims */
  staleClaimCount: number;

  /** Number of active defeaters */
  activeDefeaterCount: number;

  /** Number of unresolved contradictions */
  unresolvedContradictionCount: number;

  /** Average signal strength of active claims */
  averageSignalStrength: number;

  /** Top issues affecting health */
  topIssues: Array<{
    type: 'defeater' | 'contradiction' | 'low_signal_strength' | 'staleness';
    description: string;
    severity: 'high' | 'medium' | 'low';
    affectedClaims: number;
  }>;

  /** Recommendations for improving health */
  recommendations: string[];
}

/**
 * Assess the health of the evidence graph.
 */
export async function assessGraphHealth(
  storage: EvidenceGraphStorage,
  config: DefeaterEngineConfig = DEFAULT_DEFEATER_CONFIG
): Promise<GraphHealthAssessment> {
  const stats = await storage.getGraphStats();
  const activeClaims = await storage.getClaims({ status: 'active' });
  const staleClaims = await storage.getClaims({ status: 'stale' });
  const defeatedClaims = await storage.getClaims({ status: 'defeated' });
  const activeDefeaters = await storage.getActiveDefeaters();
  const unresolvedContradictions = await storage.getUnresolvedContradictions();

  const topIssues: GraphHealthAssessment['topIssues'] = [];
  const recommendations: string[] = [];

  // Analyze defeaters
  if (activeDefeaters.length > 0) {
    const fullDefeaters = activeDefeaters.filter((d) => d.severity === 'full');
    if (fullDefeaters.length > 0) {
      topIssues.push({
        type: 'defeater',
        description: `${fullDefeaters.length} critical defeater(s) requiring attention`,
        severity: 'high',
        affectedClaims: fullDefeaters.reduce((sum, d) => sum + d.affectedClaimIds.length, 0),
      });
      recommendations.push(
        `Address ${fullDefeaters.length} critical defeater(s) to restore claim validity`
      );
    }
  }

  // Analyze contradictions
  if (unresolvedContradictions.length > 0) {
    const blocking = unresolvedContradictions.filter((c) => c.severity === 'blocking');
    if (blocking.length > 0) {
      topIssues.push({
        type: 'contradiction',
        description: `${blocking.length} blocking contradiction(s) detected`,
        severity: 'high',
        affectedClaims: blocking.length * 2,
      });
      recommendations.push(
        `Resolve ${blocking.length} blocking contradiction(s) to maintain consistency`
      );
    }
  }

  // Analyze staleness
  if (staleClaims.length > activeClaims.length * 0.2) {
    topIssues.push({
      type: 'staleness',
      description: `${staleClaims.length} stale claim(s) need revalidation`,
      severity: 'medium',
      affectedClaims: staleClaims.length,
    });
    recommendations.push(
      `Revalidate ${staleClaims.length} stale claims to improve knowledge freshness`
    );
  }

  // Analyze low confidence
  const lowSignalClaims = activeClaims.filter(
    (c) => c.signalStrength.overall < 0.5
  );
  if (lowSignalClaims.length > 0) {
    topIssues.push({
      type: 'low_signal_strength',
      description: `${lowSignalClaims.length} claim(s) have low signal strength`,
      severity: 'low',
      affectedClaims: lowSignalClaims.length,
    });
    recommendations.push(
      `Consider gathering additional evidence for ${lowSignalClaims.length} low-signal claims`
    );
  }

  // Calculate overall health
  const totalClaims = activeClaims.length + staleClaims.length + defeatedClaims.length;
  const healthyClaimRatio = totalClaims > 0 ? activeClaims.length / totalClaims : 1;
  const defeaterPenalty = Math.min(0.3, activeDefeaters.length * 0.03);
  const contradictionPenalty = Math.min(0.3, unresolvedContradictions.length * 0.05);
  const overallHealth = Math.max(0, healthyClaimRatio - defeaterPenalty - contradictionPenalty);

  return {
    overallHealth,
    activeClaimCount: activeClaims.length,
    defeatedClaimCount: defeatedClaims.length,
    staleClaimCount: staleClaims.length,
    activeDefeaterCount: activeDefeaters.length,
    unresolvedContradictionCount: unresolvedContradictions.length,
    averageSignalStrength: stats.avgSignalStrength,
    topIssues,
    recommendations,
  };
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Run a complete defeater detection and application cycle.
 */
export async function runDefeaterCycle(
  storage: EvidenceGraphStorage,
  context: DetectionContext,
  config: DefeaterEngineConfig = DEFAULT_DEFEATER_CONFIG
): Promise<{
  detection: DetectionResult;
  application: ApplicationResult;
  health: GraphHealthAssessment;
}> {
  // Detect defeaters
  const detection = await detectDefeaters(storage, context, config);

  // Apply defeaters
  const application = await applyDefeaters(storage, detection, config);

  // Assess health
  const health = await assessGraphHealth(storage, config);

  return { detection, application, health };
}

// ============================================================================
// HIGHER-ORDER DEFEAT (WU-THIMPL-102)
// ============================================================================

/**
 * Check if a defeater is effectively active considering meta-defeat.
 *
 * A defeater is active if:
 * 1. Its status is 'active' AND
 * 2. None of its meta-defeaters (defeatedBy) are themselves active
 *
 * This implements Pollock's reinstatement: if defeater A defeats claim C,
 * but defeater B defeats A, then C is reinstated (A is not effectively active).
 *
 * Handles cycles by tracking visited defeaters during traversal.
 * Cycles are treated conservatively: if we encounter a cycle while checking
 * whether a meta-defeater is active, we assume the meta-defeater is NOT active
 * (thus not defeating the current defeater), preserving the current defeater.
 *
 * WU-THIMPL-102: Higher-order defeat support
 *
 * @param defeater - The defeater to check
 * @param allDefeaters - All known defeaters for looking up meta-defeaters
 * @param visited - Set of already-visited defeater IDs (for cycle detection)
 * @returns true if the defeater is effectively active, false if defeated
 */
export function isDefeaterActive(
  defeater: ExtendedDefeater,
  allDefeaters: ExtendedDefeater[],
  visited: Set<string> = new Set()
): boolean {
  // If the defeater's status is not 'active', it's not active
  if (defeater.status !== 'active') {
    return false;
  }

  // If no meta-defeaters, it's active
  if (!defeater.defeatedBy || defeater.defeatedBy.length === 0) {
    return true;
  }

  // Cycle detection: if we've already visited this defeater, break the cycle
  // by treating this meta-defeater as NOT active (conservative: don't defeat)
  if (visited.has(defeater.id)) {
    // We're in a cycle - treat this branch as not defeating
    // This returns false meaning "this meta-defeater is not active from the
    // perspective of the cycle", so the parent defeater remains active
    return false;
  }

  // Mark this defeater as visited before recursing
  const newVisited = new Set(visited);
  newVisited.add(defeater.id);

  // Check if any meta-defeater is active (would defeat this defeater)
  for (const metaDefeaterId of defeater.defeatedBy) {
    const metaDefeater = allDefeaters.find((d) => d.id === metaDefeaterId);
    if (metaDefeater && isDefeaterActive(metaDefeater, allDefeaters, newVisited)) {
      // This defeater is defeated by an active meta-defeater
      return false;
    }
  }

  // No active meta-defeaters, so this defeater is active
  return true;
}

/**
 * Get all effectively active defeaters from a list, considering meta-defeat chains.
 *
 * WU-THIMPL-102: Higher-order defeat support
 *
 * @param allDefeaters - All known defeaters
 * @returns Array of defeaters that are effectively active
 */
export function getEffectivelyActiveDefeaters(
  allDefeaters: ExtendedDefeater[]
): ExtendedDefeater[] {
  return allDefeaters.filter((d) => isDefeaterActive(d, allDefeaters));
}

/**
 * Add a meta-defeater relationship (defeater A defeats defeater B).
 *
 * WU-THIMPL-102: Higher-order defeat support
 *
 * @param targetDefeater - The defeater to be defeated
 * @param metaDefeaterId - ID of the defeater that defeats the target
 * @returns Updated defeater with the new meta-defeat relationship
 */
export function addMetaDefeater(
  targetDefeater: ExtendedDefeater,
  metaDefeaterId: string
): ExtendedDefeater {
  const existingDefeatedBy = targetDefeater.defeatedBy ?? [];
  if (existingDefeatedBy.includes(metaDefeaterId)) {
    return targetDefeater; // Already present
  }
  return {
    ...targetDefeater,
    defeatedBy: [...existingDefeatedBy, metaDefeaterId],
  };
}

/**
 * Remove a meta-defeater relationship.
 *
 * WU-THIMPL-102: Higher-order defeat support
 *
 * @param targetDefeater - The defeater to update
 * @param metaDefeaterId - ID of the meta-defeater to remove
 * @returns Updated defeater with the meta-defeat relationship removed
 */
export function removeMetaDefeater(
  targetDefeater: ExtendedDefeater,
  metaDefeaterId: string
): ExtendedDefeater {
  if (!targetDefeater.defeatedBy) {
    return targetDefeater;
  }
  const updatedDefeatedBy = targetDefeater.defeatedBy.filter((id) => id !== metaDefeaterId);
  return {
    ...targetDefeater,
    defeatedBy: updatedDefeatedBy.length > 0 ? updatedDefeatedBy : undefined,
  };
}

// ============================================================================
// TRANSITIVE DEFEAT PROPAGATION (WU-THIMPL-103)
// ============================================================================

/**
 * Represents a claim affected by transitive defeat propagation.
 */
export interface AffectedClaim {
  /** The claim ID that is affected */
  claimId: ClaimId;
  /** Why this claim is affected (the chain of reasoning) */
  reason: string;
  /** The path from the defeated claim to this claim */
  dependencyPath: ClaimId[];
  /** The edge type that created the dependency */
  dependencyType: 'depends_on' | 'assumes' | 'supports';
  /** Suggested action for this claim */
  suggestedAction: 'revalidate' | 'mark_stale' | 'investigate';
  /** Depth in the dependency chain (0 = directly dependent on defeated claim) */
  depth: number;
}

/**
 * Propagate defeat through a dependency graph.
 *
 * When a claim is defeated, claims that depend on it may need re-evaluation.
 * This function traverses the dependency graph to find all transitively
 * affected claims.
 *
 * Dependency types considered:
 * - 'depends_on': Direct dependency - claim validity requires the source
 * - 'assumes': Weaker dependency - claim assumes source is true
 * - 'supports': Reverse support - if A supports B and A is defeated, B may be weakened
 *
 * WU-THIMPL-103: Transitive defeat propagation
 *
 * @param storage - The evidence graph storage
 * @param defeatedClaimId - The claim that has been defeated
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Array of affected claims with metadata
 */
export async function propagateDefeat(
  storage: EvidenceGraphStorage,
  defeatedClaimId: ClaimId,
  maxDepth: number = 10
): Promise<AffectedClaim[]> {
  const affectedClaims: AffectedClaim[] = [];
  const visited = new Set<string>();

  // BFS to find all dependent claims
  const queue: Array<{
    claimId: ClaimId;
    path: ClaimId[];
    depth: number;
    lastEdgeType: 'depends_on' | 'assumes' | 'supports';
  }> = [];

  // Initialize with edges pointing TO the defeated claim (claims that depend on it)
  // and edges FROM the defeated claim of type 'supports' (claims it supported)
  const edgesToDefeated = await storage.getEdgesTo(defeatedClaimId);
  const edgesFromDefeated = await storage.getEdgesFrom(defeatedClaimId);

  // Find claims that depend on or assume the defeated claim
  for (const edge of edgesToDefeated) {
    if (edge.type === 'depends_on' || edge.type === 'assumes') {
      queue.push({
        claimId: edge.fromClaimId,
        path: [defeatedClaimId],
        depth: 0,
        lastEdgeType: edge.type as 'depends_on' | 'assumes',
      });
    }
  }

  // Find claims that were supported by the defeated claim
  for (const edge of edgesFromDefeated) {
    if (edge.type === 'supports') {
      queue.push({
        claimId: edge.toClaimId,
        path: [defeatedClaimId],
        depth: 0,
        lastEdgeType: 'supports',
      });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Skip if already visited or at max depth
    if (visited.has(current.claimId) || current.depth >= maxDepth) {
      continue;
    }
    visited.add(current.claimId);

    // Determine suggested action based on dependency type and depth
    let suggestedAction: AffectedClaim['suggestedAction'];
    if (current.lastEdgeType === 'depends_on') {
      suggestedAction = current.depth === 0 ? 'mark_stale' : 'revalidate';
    } else if (current.lastEdgeType === 'assumes') {
      suggestedAction = 'investigate';
    } else {
      suggestedAction = current.depth === 0 ? 'revalidate' : 'investigate';
    }

    // Construct reason based on path
    const pathDescription = [...current.path, current.claimId]
      .map((id) => id.slice(0, 8) + '...')
      .join(' -> ');

    affectedClaims.push({
      claimId: current.claimId,
      reason: `Transitively affected via ${current.lastEdgeType} chain: ${pathDescription}`,
      dependencyPath: [...current.path],
      dependencyType: current.lastEdgeType,
      suggestedAction,
      depth: current.depth,
    });

    // Continue propagation for dependent claims
    const nextEdgesTo = await storage.getEdgesTo(current.claimId);
    const nextEdgesFrom = await storage.getEdgesFrom(current.claimId);

    for (const edge of nextEdgesTo) {
      if (edge.type === 'depends_on' || edge.type === 'assumes') {
        queue.push({
          claimId: edge.fromClaimId,
          path: [...current.path, current.claimId],
          depth: current.depth + 1,
          lastEdgeType: edge.type as 'depends_on' | 'assumes',
        });
      }
    }

    for (const edge of nextEdgesFrom) {
      if (edge.type === 'supports') {
        queue.push({
          claimId: edge.toClaimId,
          path: [...current.path, current.claimId],
          depth: current.depth + 1,
          lastEdgeType: 'supports',
        });
      }
    }
  }

  return affectedClaims;
}

/**
 * Apply transitive defeat to affected claims.
 *
 * This marks affected claims as stale and optionally creates defeaters for them.
 *
 * WU-THIMPL-103: Transitive defeat propagation
 *
 * @param storage - The evidence graph storage
 * @param defeatedClaimId - The originally defeated claim
 * @param affectedClaims - Claims affected by the defeat (from propagateDefeat)
 * @param createDefeaters - Whether to create defeaters for affected claims
 * @returns Number of claims marked as stale
 */
export async function applyTransitiveDefeat(
  storage: EvidenceGraphStorage,
  defeatedClaimId: ClaimId,
  affectedClaims: AffectedClaim[],
  createDefeaters: boolean = true
): Promise<number> {
  let staleCount = 0;

  for (const affected of affectedClaims) {
    const claim = await storage.getClaim(affected.claimId);
    if (!claim) continue;

    // Mark claims that should be stale
    if (affected.suggestedAction === 'mark_stale' || affected.suggestedAction === 'revalidate') {
      if (claim.status === 'active') {
        await storage.updateClaimStatus(affected.claimId, 'stale');
        staleCount++;
      }
    }

    // Optionally create defeaters for affected claims
    if (createDefeaters && affected.dependencyType === 'depends_on') {
      const defeater = createDefeater({
        type: 'new_info',
        description: `Dependency "${defeatedClaimId}" was defeated. ${affected.reason}`,
        severity: affected.depth === 0 ? 'partial' : 'warning',
        affectedClaimIds: [affected.claimId],
        confidenceReduction: affected.depth === 0 ? 0.3 : 0.15,
        autoResolvable: true,
        resolutionAction: 'revalidate',
        evidence: `Transitive defeat from claim ${defeatedClaimId}`,
      });
      await storage.upsertDefeater(defeater);
    }
  }

  return staleCount;
}

/**
 * Get the dependency graph for visualization/analysis.
 *
 * Returns a simplified representation of claim dependencies.
 *
 * WU-THIMPL-103: Transitive defeat propagation
 *
 * @param storage - The evidence graph storage
 * @param rootClaimId - The claim to start from
 * @param direction - 'upstream' (what this claim depends on) or 'downstream' (what depends on this)
 * @param maxDepth - Maximum depth to traverse
 */
export async function getDependencyGraph(
  storage: EvidenceGraphStorage,
  rootClaimId: ClaimId,
  direction: 'upstream' | 'downstream' = 'downstream',
  maxDepth: number = 5
): Promise<{
  nodes: Array<{ id: ClaimId; proposition: string; status: string; depth: number }>;
  edges: Array<{ from: ClaimId; to: ClaimId; type: string }>;
}> {
  const nodes: Array<{ id: ClaimId; proposition: string; status: string; depth: number }> = [];
  const edges: Array<{ from: ClaimId; to: ClaimId; type: string }> = [];
  const visited = new Set<string>();
  const queue: Array<{ claimId: ClaimId; depth: number }> = [{ claimId: rootClaimId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.claimId) || current.depth > maxDepth) continue;
    visited.add(current.claimId);

    const claim = await storage.getClaim(current.claimId);
    if (claim) {
      nodes.push({
        id: claim.id,
        proposition: claim.proposition.slice(0, 100),
        status: claim.status,
        depth: current.depth,
      });
    }

    // Get edges based on direction
    let relevantEdges: EvidenceEdge[];
    if (direction === 'downstream') {
      // What depends on this claim (edges pointing TO this claim)
      relevantEdges = await storage.getEdgesTo(current.claimId);
      for (const edge of relevantEdges) {
        if (edge.type === 'depends_on' || edge.type === 'assumes') {
          edges.push({ from: edge.fromClaimId, to: edge.toClaimId, type: edge.type });
          queue.push({ claimId: edge.fromClaimId, depth: current.depth + 1 });
        }
      }
    } else {
      // What this claim depends on (edges pointing FROM this claim)
      relevantEdges = await storage.getEdgesFrom(current.claimId);
      for (const edge of relevantEdges) {
        if (edge.type === 'depends_on' || edge.type === 'assumes') {
          edges.push({ from: edge.fromClaimId, to: edge.toClaimId, type: edge.type });
          queue.push({ claimId: edge.toClaimId, depth: current.depth + 1 });
        }
      }
    }
  }

  return { nodes, edges };
}

// ============================================================================
// DEFEATER-CONFIDENCEVALUE INTEGRATION (WU-THIMPL-104)
// ============================================================================

/**
 * Result of applying a defeater to a confidence value.
 */
export interface DefeaterApplicationResult {
  /** The new confidence value after applying the defeater */
  confidence: ConfidenceValue;
  /** Whether the confidence was fully defeated (value = 0) */
  fullyDefeated: boolean;
  /** The original confidence value */
  originalConfidence: ConfidenceValue;
  /** The defeater that was applied */
  defeaterId: string;
  /** Description of what happened */
  description: string;
}

/**
 * Apply a defeater to a confidence value.
 *
 * This transforms the input confidence into a DerivedConfidence that
 * includes the defeater in its provenance/formula. This ensures that
 * the epistemic impact of the defeater is tracked in the confidence
 * value itself.
 *
 * Defeater application rules:
 * - 'full' severity: confidence becomes 0.0
 * - 'partial' severity: confidence reduced by confidenceReduction
 * - 'warning' severity: smaller reduction, confidence noted as degraded
 * - 'informational' severity: no reduction, just provenance tracking
 *
 * If the input is already a DerivedConfidence, the defeater is added
 * to the derivation chain (nested derivation).
 *
 * WU-THIMPL-104: Defeater-ConfidenceValue integration
 *
 * @param confidence - The original confidence value
 * @param defeater - The defeater to apply
 * @returns A new DerivedConfidence with the defeater in the formula
 */
export function applyDefeaterToConfidence(
  confidence: ConfidenceValue,
  defeater: ExtendedDefeater
): DefeaterApplicationResult {
  // Handle absent confidence specially
  if (confidence.type === 'absent') {
    return {
      confidence,
      fullyDefeated: false,
      originalConfidence: confidence,
      defeaterId: defeater.id,
      description: 'Confidence was already absent; defeater has no additional effect',
    };
  }

  const originalValue = getNumericValue(confidence);
  if (originalValue === null) {
    return {
      confidence,
      fullyDefeated: false,
      originalConfidence: confidence,
      defeaterId: defeater.id,
      description: 'Confidence value could not be extracted; defeater has no effect',
    };
  }

  // Calculate new value based on defeater severity
  let newValue: number;
  let formula: string;
  let description: string;

  switch (defeater.severity) {
    case 'full':
      // Full defeat: confidence goes to 0
      newValue = 0.0;
      formula = `defeated_by(${defeater.type})`;
      description = `Fully defeated by ${defeater.type}: ${defeater.description}`;
      break;

    case 'partial':
      // Partial defeat: reduce by confidenceReduction
      newValue = Math.max(0, originalValue - defeater.confidenceReduction);
      formula = `partial_defeat(${defeater.type}, -${defeater.confidenceReduction})`;
      description = `Partially defeated by ${defeater.type}: reduced by ${defeater.confidenceReduction}`;
      break;

    case 'warning':
      // Warning: smaller reduction (half of confidenceReduction)
      const warningReduction = defeater.confidenceReduction * 0.5;
      newValue = Math.max(0, originalValue - warningReduction);
      formula = `warning(${defeater.type}, -${warningReduction.toFixed(3)})`;
      description = `Warning from ${defeater.type}: reduced by ${warningReduction.toFixed(3)}`;
      break;

    case 'informational':
      // Informational: no reduction, just note
      newValue = originalValue;
      formula = `noted(${defeater.type})`;
      description = `Information noted from ${defeater.type}: ${defeater.description}`;
      break;

    default:
      // Unknown severity: treat as warning
      newValue = Math.max(0, originalValue - defeater.confidenceReduction * 0.5);
      formula = `unknown_defeat(${defeater.type})`;
      description = `Unknown defeat severity from ${defeater.type}`;
  }

  const fullyDefeated = newValue === 0.0;

  // Create the derived confidence with defeater in provenance
  const derivedConfidence: DerivedConfidence = {
    type: 'derived',
    value: newValue,
    formula,
    inputs: [
      { name: 'original', confidence },
      {
        name: 'defeater',
        confidence: {
          type: 'deterministic',
          value: 1.0,
          reason: `defeater_${defeater.id}`,
        },
      },
    ],
    // Defeaters always degrade calibration since they represent
    // unexpected/invalidating information
    calibrationStatus: 'degraded',
  };

  return {
    confidence: derivedConfidence,
    fullyDefeated,
    originalConfidence: confidence,
    defeaterId: defeater.id,
    description,
  };
}

/**
 * Apply multiple defeaters to a confidence value.
 *
 * Defeaters are applied in order, with each subsequent defeater
 * operating on the result of the previous application.
 *
 * WU-THIMPL-104: Defeater-ConfidenceValue integration
 *
 * @param confidence - The original confidence value
 * @param defeaters - Array of defeaters to apply
 * @returns Final confidence value and summary of all applications
 */
export function applyDefeatersToConfidence(
  confidence: ConfidenceValue,
  defeaters: ExtendedDefeater[]
): {
  confidence: ConfidenceValue;
  fullyDefeated: boolean;
  applications: DefeaterApplicationResult[];
} {
  if (defeaters.length === 0) {
    return {
      confidence,
      fullyDefeated: false,
      applications: [],
    };
  }

  let currentConfidence = confidence;
  const applications: DefeaterApplicationResult[] = [];
  let fullyDefeated = false;

  for (const defeater of defeaters) {
    const result = applyDefeaterToConfidence(currentConfidence, defeater);
    applications.push(result);
    currentConfidence = result.confidence;

    if (result.fullyDefeated) {
      fullyDefeated = true;
      // Once fully defeated, subsequent defeaters have no effect
      // but we still record them
    }
  }

  return {
    confidence: currentConfidence,
    fullyDefeated,
    applications,
  };
}

/**
 * Check if a confidence value has been affected by defeaters.
 *
 * Examines the provenance chain to find any defeater applications.
 *
 * WU-THIMPL-104: Defeater-ConfidenceValue integration
 *
 * @param confidence - The confidence value to check
 * @returns List of defeater IDs found in the provenance chain
 */
export function findDefeatersInConfidence(confidence: ConfidenceValue): string[] {
  const defeaterIds: string[] = [];

  function traverse(conf: ConfidenceValue): void {
    if (conf.type !== 'derived') return;

    // Check if this derivation is from a defeater
    if (conf.formula.startsWith('defeated_by') ||
        conf.formula.startsWith('partial_defeat') ||
        conf.formula.startsWith('warning') ||
        conf.formula.startsWith('noted') ||
        conf.formula.startsWith('unknown_defeat')) {
      // Extract defeater ID from inputs
      for (const input of conf.inputs) {
        if (input.name === 'defeater' && input.confidence.type === 'deterministic') {
          const reason = input.confidence.reason;
          if (reason.startsWith('defeater_')) {
            defeaterIds.push(reason.slice('defeater_'.length));
          }
        }
      }
    }

    // Recursively check inputs
    for (const input of conf.inputs) {
      traverse(input.confidence);
    }
  }

  traverse(confidence);
  return defeaterIds;
}

/**
 * Remove defeater effects from a confidence value.
 *
 * If the confidence was derived through defeater application,
 * returns the original (pre-defeat) confidence value.
 *
 * Note: This only works for direct defeater applications. Nested
 * derivations will still show the original value from the first
 * defeater input.
 *
 * WU-THIMPL-104: Defeater-ConfidenceValue integration
 *
 * @param confidence - The confidence value that may have defeater effects
 * @returns The original confidence value if defeater was found, else input unchanged
 */
export function removeDefeaterFromConfidence(confidence: ConfidenceValue): ConfidenceValue {
  if (confidence.type !== 'derived') {
    return confidence;
  }

  // Check if this is a defeater application
  if (confidence.formula.startsWith('defeated_by') ||
      confidence.formula.startsWith('partial_defeat') ||
      confidence.formula.startsWith('warning') ||
      confidence.formula.startsWith('noted') ||
      confidence.formula.startsWith('unknown_defeat')) {
    // Find the original confidence in inputs
    const originalInput = confidence.inputs.find((i) => i.name === 'original');
    if (originalInput) {
      return originalInput.confidence;
    }
  }

  return confidence;
}

// ============================================================================
// UNTRUSTED CONTENT DETECTION (WU-THIMPL-105)
// ============================================================================

/**
 * Suspicious patterns that may indicate untrusted or injected content.
 */
const SUSPICIOUS_PATTERNS = [
  /ignore\s+(previous|prior|all)\s+(instructions?|prompts?)/i,
  /system\s*:\s*you\s+are/i,
  /\[\s*INST\s*\]/i,
  /<\|?(system|user|assistant)\|?>/i,
  /```\s*system/i,
  /role\s*:\s*(system|admin)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /jailbreak/i,
  /bypass\s+(security|filter|restriction)/i,
  /act\s+as\s+(if|a|an)\s+unrestricted/i,
];

/**
 * Known trusted sources that require less scrutiny.
 */
const TRUSTED_SOURCES: ProvenanceSource[] = [
  'ast_parser',
  'system_observation',
];

/**
 * Sources that require agent attribution.
 */
const ATTRIBUTION_REQUIRED_SOURCES: ProvenanceSource[] = [
  'llm_synthesis',
  'tool_output',
];

/**
 * Result of untrusted content detection.
 */
export interface UntrustedContentResult {
  /** Whether the content is considered untrusted */
  untrusted: boolean;
  /** Reasons why the content is considered untrusted */
  reasons: string[];
  /** Severity of the trust issue */
  severity: DefeaterSeverity;
  /** Recommended confidence reduction */
  confidenceReduction: number;
}

/**
 * Detect if an evidence provenance indicates untrusted content.
 *
 * Checks for:
 * - Unknown or missing source
 * - Missing agent attribution for LLM/tool sources
 * - Suspicious patterns in method descriptions
 * - Missing input hash (reproducibility concern)
 *
 * WU-THIMPL-105: Untrusted content defeater detection
 *
 * @param provenance - The provenance to check
 * @param contentSample - Optional content sample to check for suspicious patterns
 * @returns UntrustedContentResult with detection details
 */
export function detectUntrustedContent(
  provenance: EvidenceProvenance,
  contentSample?: string
): UntrustedContentResult {
  const reasons: string[] = [];
  let maxSeverity: DefeaterSeverity = 'informational';
  let confidenceReduction = 0;

  // Check 1: Missing or unknown source
  if (!provenance.source) {
    reasons.push('Missing provenance source');
    maxSeverity = 'partial';
    confidenceReduction = Math.max(confidenceReduction, 0.4);
  }

  // Check 2: Attribution required for LLM/tool sources
  if (ATTRIBUTION_REQUIRED_SOURCES.includes(provenance.source)) {
    if (!provenance.agent) {
      reasons.push(`Missing agent attribution for ${provenance.source} source`);
      maxSeverity = severityMax(maxSeverity, 'warning');
      confidenceReduction = Math.max(confidenceReduction, 0.2);
    } else if (!provenance.agent.identifier || provenance.agent.identifier.trim() === '') {
      reasons.push('Agent identifier is empty');
      maxSeverity = severityMax(maxSeverity, 'warning');
      confidenceReduction = Math.max(confidenceReduction, 0.15);
    }
  }

  // Check 3: Missing method description
  if (!provenance.method || provenance.method.trim() === '') {
    reasons.push('Missing method description');
    maxSeverity = severityMax(maxSeverity, 'warning');
    confidenceReduction = Math.max(confidenceReduction, 0.1);
  }

  // Check 4: Suspicious patterns in method
  if (provenance.method) {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(provenance.method)) {
        reasons.push(`Suspicious pattern detected in method: ${pattern.source}`);
        maxSeverity = severityMax(maxSeverity, 'full');
        confidenceReduction = Math.max(confidenceReduction, 1.0);
        break;
      }
    }
  }

  // Check 5: Suspicious patterns in content sample
  if (contentSample) {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(contentSample)) {
        reasons.push(`Suspicious pattern detected in content: ${pattern.source}`);
        maxSeverity = severityMax(maxSeverity, 'full');
        confidenceReduction = Math.max(confidenceReduction, 1.0);
        break;
      }
    }
  }

  // Check 6: User input without verification (lower trust)
  if (provenance.source === 'user_input' && !provenance.inputHash) {
    reasons.push('User input without content verification hash');
    maxSeverity = severityMax(maxSeverity, 'informational');
    confidenceReduction = Math.max(confidenceReduction, 0.05);
  }

  // Check 7: Embedding search without model version (reproducibility)
  if (provenance.source === 'embedding_search' && provenance.agent && !provenance.agent.version) {
    reasons.push('Embedding search without model version for reproducibility');
    maxSeverity = severityMax(maxSeverity, 'informational');
    confidenceReduction = Math.max(confidenceReduction, 0.05);
  }

  return {
    untrusted: reasons.length > 0,
    reasons,
    severity: maxSeverity,
    confidenceReduction,
  };
}

/**
 * Create a defeater from untrusted content detection result.
 *
 * WU-THIMPL-105: Untrusted content defeater detection
 *
 * @param result - The detection result
 * @param affectedClaimIds - Claims affected by this untrusted content
 * @returns A defeater if untrusted, null otherwise
 */
export function createUntrustedContentDefeater(
  result: UntrustedContentResult,
  affectedClaimIds: ClaimId[]
): ExtendedDefeater | null {
  if (!result.untrusted || affectedClaimIds.length === 0) {
    return null;
  }

  return createDefeater({
    type: 'untrusted_content',
    description: `Untrusted content detected: ${result.reasons.join('; ')}`,
    severity: result.severity,
    affectedClaimIds,
    confidenceReduction: result.confidenceReduction,
    autoResolvable: result.severity !== 'full',
    resolutionAction: result.severity === 'full' ? undefined : 'revalidate',
    evidence: JSON.stringify({ reasons: result.reasons }),
  });
}

/**
 * Helper to get the maximum severity.
 */
function severityMax(a: DefeaterSeverity, b: DefeaterSeverity): DefeaterSeverity {
  const order: DefeaterSeverity[] = ['informational', 'warning', 'partial', 'full'];
  return order.indexOf(a) > order.indexOf(b) ? a : b;
}

// ============================================================================
// DEPENDENCY DRIFT DETECTION (WU-THIMPL-106)
// ============================================================================

/**
 * Information about a dependency.
 */
export interface DependencyInfo {
  /** Package/module name */
  name: string;
  /** Current version */
  version: string;
  /** Whether the dependency is deprecated */
  deprecated?: boolean;
  /** Deprecation message if deprecated */
  deprecationMessage?: string;
  /** Version at time of claim creation (if known) */
  claimTimeVersion?: string;
  /** Whether API breaking changes occurred */
  hasBreakingChanges?: boolean;
  /** List of breaking change descriptions */
  breakingChanges?: string[];
}

/**
 * Result of dependency drift detection.
 */
export interface DependencyDriftResult {
  /** Whether drift was detected */
  driftDetected: boolean;
  /** Drifted dependencies */
  driftedDeps: Array<{
    name: string;
    reason: string;
    severity: DefeaterSeverity;
  }>;
  /** Overall severity */
  severity: DefeaterSeverity;
  /** Recommended confidence reduction */
  confidenceReduction: number;
}

/**
 * Detect dependency drift that could invalidate a claim.
 *
 * Checks for:
 * - Version changes between claim creation and now
 * - Deprecated dependencies
 * - Breaking API changes
 *
 * WU-THIMPL-106: Dependency drift defeater detection
 *
 * @param claim - The claim to check
 * @param currentDeps - Current dependency information
 * @returns DependencyDriftResult with detection details
 */
export function detectDependencyDrift(
  claim: Claim,
  currentDeps: DependencyInfo[]
): DependencyDriftResult {
  const driftedDeps: DependencyDriftResult['driftedDeps'] = [];
  let maxSeverity: DefeaterSeverity = 'informational';
  let totalReduction = 0;

  for (const dep of currentDeps) {
    // Check 1: Breaking changes
    if (dep.hasBreakingChanges && dep.breakingChanges && dep.breakingChanges.length > 0) {
      driftedDeps.push({
        name: dep.name,
        reason: `Breaking API changes: ${dep.breakingChanges.slice(0, 3).join(', ')}${dep.breakingChanges.length > 3 ? '...' : ''}`,
        severity: 'full',
      });
      maxSeverity = 'full';
      totalReduction += 0.5;
    }

    // Check 2: Deprecated dependency
    if (dep.deprecated) {
      driftedDeps.push({
        name: dep.name,
        reason: dep.deprecationMessage ?? 'Dependency is deprecated',
        severity: 'partial',
      });
      maxSeverity = severityMax(maxSeverity, 'partial');
      totalReduction += 0.3;
    }

    // Check 3: Major version change
    if (dep.claimTimeVersion && dep.version !== dep.claimTimeVersion) {
      const oldMajor = getMajorVersion(dep.claimTimeVersion);
      const newMajor = getMajorVersion(dep.version);

      if (oldMajor !== null && newMajor !== null && oldMajor !== newMajor) {
        driftedDeps.push({
          name: dep.name,
          reason: `Major version change: ${dep.claimTimeVersion} -> ${dep.version}`,
          severity: 'partial',
        });
        maxSeverity = severityMax(maxSeverity, 'partial');
        totalReduction += 0.25;
      } else if (dep.claimTimeVersion !== dep.version) {
        // Minor/patch version change
        driftedDeps.push({
          name: dep.name,
          reason: `Version change: ${dep.claimTimeVersion} -> ${dep.version}`,
          severity: 'warning',
        });
        maxSeverity = severityMax(maxSeverity, 'warning');
        totalReduction += 0.1;
      }
    }
  }

  // Cap total reduction at 1.0
  const confidenceReduction = Math.min(1.0, totalReduction);

  return {
    driftDetected: driftedDeps.length > 0,
    driftedDeps,
    severity: driftedDeps.length > 0 ? maxSeverity : 'informational',
    confidenceReduction,
  };
}

/**
 * Create a defeater from dependency drift detection result.
 *
 * WU-THIMPL-106: Dependency drift defeater detection
 *
 * @param result - The detection result
 * @param claimId - The claim affected by dependency drift
 * @returns A defeater if drift detected, null otherwise
 */
export function createDependencyDriftDefeater(
  result: DependencyDriftResult,
  claimId: ClaimId
): ExtendedDefeater | null {
  if (!result.driftDetected) {
    return null;
  }

  const depSummary = result.driftedDeps
    .map((d) => `${d.name}: ${d.reason}`)
    .join('; ');

  return createDefeater({
    type: 'dependency_drift',
    description: `Dependency drift detected: ${depSummary}`,
    severity: result.severity,
    affectedClaimIds: [claimId],
    confidenceReduction: result.confidenceReduction,
    autoResolvable: result.severity !== 'full',
    resolutionAction: 'revalidate',
    evidence: JSON.stringify({ driftedDeps: result.driftedDeps }),
  });
}

/**
 * Extract major version from a semver string.
 * Returns null if the version cannot be parsed.
 */
function getMajorVersion(version: string): number | null {
  // Handle common version prefixes
  const cleaned = version.replace(/^[v^~]/, '');
  const match = cleaned.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// FIXED-POINT DEFEATER RESOLUTION (GROUNDED SEMANTICS)
// ============================================================================

/**
 * Graph representation of defeater attack relations.
 *
 * Based on Dung's Abstract Argumentation Frameworks (1995), where:
 * - Nodes are arguments (defeaters)
 * - Edges represent attacks (one defeater defeating another)
 *
 * This structure enables computation of various argumentation semantics,
 * particularly the grounded extension which provides the most skeptical
 * (cautious) set of accepted arguments.
 *
 * @see Dung, P.M. (1995) "On the Acceptability of Arguments and its
 *      Fundamental Role in Nonmonotonic Reasoning"
 */
export interface DefeaterGraph {
  /** All defeaters indexed by ID */
  nodes: Map<string, ExtendedDefeater>;
  /** Attack relation: defeaterId -> set of defeated defeater IDs */
  edges: Map<string, Set<string>>;
}

/**
 * Result of computing the grounded extension of a defeater graph.
 *
 * The grounded extension is the minimal complete extension, computed via
 * Kleene iteration starting from the empty set. It represents the
 * "skeptical" conclusion: only defeaters that must be accepted are accepted.
 *
 * For cycles (A defeats B, B defeats C, C defeats A), no member of the
 * cycle will be in the accepted or rejected sets - they remain undecided.
 * This is the principled behavior under grounded semantics.
 *
 * @see Baroni, P. & Giacomin, M. (2009) "Semantics of Abstract Argument Systems"
 */
export interface GroundedExtension {
  /** Defeaters that survive (not defeated by any accepted defeater) */
  accepted: Set<string>;
  /** Defeaters that are defeated by an accepted defeater */
  rejected: Set<string>;
  /** Defeaters in cycles with no stable status */
  undecided: Set<string>;
  /** Number of Kleene iterations performed */
  iterations: number;
  /** Whether the iteration converged to a fixed point */
  converged: boolean;
}

/**
 * Build a defeater graph from a list of defeaters.
 *
 * Constructs the attack relation from the `defeatedBy` field on each defeater.
 * If defeater A has defeater B in its `defeatedBy` list, then B attacks A
 * (i.e., there's an edge from B to A in the graph).
 *
 * @param defeaters - Array of defeaters to include in the graph
 * @returns DefeaterGraph with nodes and edges populated
 *
 * @example
 * ```typescript
 * const defeaters = [
 *   { id: 'A', defeatedBy: ['B'] },  // B attacks A
 *   { id: 'B', defeatedBy: ['C'] },  // C attacks B
 *   { id: 'C', defeatedBy: [] },     // C is unattacked
 * ];
 * const graph = buildDefeaterGraph(defeaters);
 * // graph.edges: { 'B' -> {'A'}, 'C' -> {'B'} }
 * ```
 */
export function buildDefeaterGraph(defeaters: ExtendedDefeater[]): DefeaterGraph {
  const nodes = new Map<string, ExtendedDefeater>();
  const edges = new Map<string, Set<string>>();

  // First pass: populate nodes and initialize empty edge sets
  for (const defeater of defeaters) {
    nodes.set(defeater.id, defeater);
    edges.set(defeater.id, new Set<string>());
  }

  // Second pass: build attack relation from defeatedBy
  // If defeater A is defeated by defeater B, then B attacks A
  for (const defeater of defeaters) {
    if (defeater.defeatedBy && defeater.defeatedBy.length > 0) {
      for (const attackerId of defeater.defeatedBy) {
        // Only add edge if attacker is in the graph
        if (nodes.has(attackerId)) {
          const attackerEdges = edges.get(attackerId);
          if (attackerEdges) {
            attackerEdges.add(defeater.id);
          }
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Compute the grounded extension of a defeater graph using Kleene iteration.
 *
 * The grounded semantics is defined as the least fixed point of the
 * characteristic function F, where:
 *
 *   F(S) = { d | no attacker of d is in S and all attackers of d are attacked by S }
 *
 * For practical computation, we use the equivalent iterative definition:
 * 1. Start with accepted = empty, rejected = empty
 * 2. Add to accepted: defeaters with no unrejected attackers
 * 3. Add to rejected: defeaters attacked by accepted defeaters
 * 4. Repeat until no changes (fixed point)
 *
 * Defeaters not in accepted or rejected after convergence are undecided
 * (typically involved in cycles).
 *
 * This implements Dung's grounded semantics which satisfies:
 * - Conflict-free: No two accepted defeaters attack each other
 * - Admissible: All accepted defeaters defend themselves
 * - Complete: All defended defeaters are accepted
 * - Grounded: Minimal complete extension (most skeptical)
 *
 * @param graph - The defeater graph to analyze
 * @param maxIterations - Maximum iterations before stopping (default: 1000)
 * @returns GroundedExtension with accepted, rejected, and undecided sets
 *
 * @example
 * ```typescript
 * // Linear chain: C attacks B, B attacks A
 * // Result: C accepted, B rejected, A accepted (reinstated)
 *
 * // Cycle: A attacks B, B attacks C, C attacks A
 * // Result: All undecided (no fixed point for any of them)
 * ```
 */
export function computeGroundedExtension(
  graph: DefeaterGraph,
  maxIterations: number = 1000
): GroundedExtension {
  const accepted = new Set<string>();
  const rejected = new Set<string>();
  let iterations = 0;

  // Build reverse attack map: who attacks this defeater?
  const attackedBy = new Map<string, Set<string>>();
  for (const [defeaterId] of graph.nodes) {
    attackedBy.set(defeaterId, new Set<string>());
  }
  for (const [attackerId, targets] of graph.edges) {
    for (const targetId of targets) {
      const attackers = attackedBy.get(targetId);
      if (attackers) {
        attackers.add(attackerId);
      }
    }
  }

  // Kleene iteration
  let changed = true;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Phase 1: Find defeaters that should be accepted
    // A defeater is accepted if all its attackers are rejected
    for (const [defeaterId] of graph.nodes) {
      if (accepted.has(defeaterId) || rejected.has(defeaterId)) {
        continue; // Already classified
      }

      const attackers = attackedBy.get(defeaterId) ?? new Set<string>();

      // Check if all attackers are rejected
      let allAttackersRejected = true;
      for (const attackerId of attackers) {
        if (!rejected.has(attackerId)) {
          allAttackersRejected = false;
          break;
        }
      }

      // A defeater with no attackers, or all attackers rejected, is accepted
      if (attackers.size === 0 || allAttackersRejected) {
        accepted.add(defeaterId);
        changed = true;
      }
    }

    // Phase 2: Find defeaters that should be rejected
    // A defeater is rejected if any of its attackers is accepted
    for (const [defeaterId] of graph.nodes) {
      if (accepted.has(defeaterId) || rejected.has(defeaterId)) {
        continue; // Already classified
      }

      const attackers = attackedBy.get(defeaterId) ?? new Set<string>();

      for (const attackerId of attackers) {
        if (accepted.has(attackerId)) {
          rejected.add(defeaterId);
          changed = true;
          break;
        }
      }
    }
  }

  // Everything not accepted or rejected is undecided (in cycles)
  const undecided = new Set<string>();
  for (const [defeaterId] of graph.nodes) {
    if (!accepted.has(defeaterId) && !rejected.has(defeaterId)) {
      undecided.add(defeaterId);
    }
  }

  return {
    accepted,
    rejected,
    undecided,
    iterations,
    converged: !changed || iterations < maxIterations,
  };
}

/**
 * Resolve defeater cycles by computing the grounded extension.
 *
 * This function provides a high-level interface for applying grounded
 * semantics to a set of defeaters. It:
 * 1. Builds the attack graph from defeaters
 * 2. Computes the grounded extension via Kleene iteration
 * 3. Updates defeater status based on the extension
 *
 * Defeaters are updated as follows:
 * - Accepted: status remains 'active' (or set to 'active' if pending)
 * - Rejected: status set to 'resolved' (defeated by another defeater)
 * - Undecided: status marked with special handling (cycle detected)
 *
 * This implements the formal semantics from Section 7 of the mathematical
 * foundations, providing a principled approach to resolving circular defeat.
 *
 * @param defeaters - Array of defeaters that may have defeat relationships
 * @returns Object containing resolved defeaters and the grounded extension
 *
 * @example
 * ```typescript
 * const defeaters = [
 *   createDefeater({ id: 'stale1', defeatedBy: [] }),
 *   createDefeater({ id: 'counter1', defeatedBy: ['stale1'] }),
 * ];
 * const { resolved, extension } = resolveDefeaterCycles(defeaters);
 * // extension.accepted: {'stale1'}
 * // extension.rejected: {'counter1'}
 * ```
 */
export function resolveDefeaterCycles(
  defeaters: ExtendedDefeater[]
): { resolved: ExtendedDefeater[]; extension: GroundedExtension } {
  // Build the attack graph
  const graph = buildDefeaterGraph(defeaters);

  // Compute the grounded extension
  const extension = computeGroundedExtension(graph);

  // Update defeaters based on extension
  // Note: ExtendedDefeater doesn't have a metadata field, so we only update status.
  // Grounded status information is available via the returned extension.
  const resolved: ExtendedDefeater[] = defeaters.map((defeater) => {
    if (extension.accepted.has(defeater.id)) {
      // Accepted defeaters are effectively active
      // Only change status if it was pending (don't override explicit status)
      return {
        ...defeater,
        status: defeater.status === 'pending' ? 'active' : defeater.status,
      } as ExtendedDefeater;
    } else if (extension.rejected.has(defeater.id)) {
      // Rejected defeaters are defeated by an accepted defeater
      // Mark as resolved since they've been defeated
      return {
        ...defeater,
        status: 'resolved' as const,
      } as ExtendedDefeater;
    } else {
      // Undecided defeaters are in cycles - handle conservatively
      // Keep current status; cycles are a form of epistemic stalemate
      // The extension.undecided set tracks which defeaters are in this state
      return defeater;
    }
  });

  return { resolved, extension };
}

/**
 * Detect cycles in the defeater attack graph.
 *
 * Uses depth-first search to find strongly connected components (SCCs)
 * with more than one node, which represent cycles.
 *
 * @param graph - The defeater graph to analyze
 * @returns Array of cycles, where each cycle is an array of defeater IDs
 */
export function detectDefeaterCycles(graph: DefeaterGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const edges = graph.edges.get(nodeId) ?? new Set<string>();
    for (const targetId of edges) {
      if (!visited.has(targetId)) {
        dfs(targetId);
      } else if (recursionStack.has(targetId)) {
        // Found a cycle - extract it from the path
        const cycleStart = path.indexOf(targetId);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          if (cycle.length > 1) {
            cycles.push([...cycle]);
          }
        }
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const [nodeId] of graph.nodes) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return cycles;
}

/**
 * Check if the grounded extension is complete (all defeaters classified).
 *
 * A complete extension means no defeaters are undecided, which happens
 * when the attack graph is acyclic.
 *
 * @param extension - The grounded extension to check
 * @returns true if all defeaters are either accepted or rejected
 */
export function isExtensionComplete(extension: GroundedExtension): boolean {
  return extension.undecided.size === 0;
}

/**
 * Get the effective status of a defeater given a grounded extension.
 *
 * @param defeaterId - ID of the defeater to check
 * @param extension - The computed grounded extension
 * @returns 'accepted' | 'rejected' | 'undecided'
 */
export function getDefeaterGroundedStatus(
  defeaterId: string,
  extension: GroundedExtension
): 'accepted' | 'rejected' | 'undecided' {
  if (extension.accepted.has(defeaterId)) {
    return 'accepted';
  } else if (extension.rejected.has(defeaterId)) {
    return 'rejected';
  } else {
    return 'undecided';
  }
}

// ============================================================================
// BAYESIAN DEFEAT REDUCTION (WU-THIMPL-202)
// ============================================================================

/**
 * Options for computing defeated strength.
 *
 * WU-THIMPL-202: Bayesian alternative to linear strength reduction.
 */
export interface DefeatReductionOptions {
  /**
   * Method for computing defeated strength:
   * - 'linear': Simple subtraction (originalStrength - reduction)
   * - 'bayesian': Beta-binomial update model
   */
  method: 'linear' | 'bayesian';

  /**
   * Prior strength for Bayesian method.
   * Represents our prior belief about the evidence strength before
   * encountering the defeater. Higher values = more resistant to defeat.
   * Range: (0, 1). Default: 0.5 (neutral prior).
   */
  priorStrength?: number;

  /**
   * Prior sample size for Bayesian method (pseudo-count).
   * Controls how much weight the prior has relative to new evidence.
   * Higher values = prior is more influential.
   * Range: > 0. Default: 2 (weak prior).
   */
  priorSampleSize?: number;
}

/**
 * Default options for defeat reduction.
 */
export const DEFAULT_DEFEAT_REDUCTION_OPTIONS: Required<DefeatReductionOptions> = {
  method: 'linear',
  priorStrength: 0.5,
  priorSampleSize: 2,
};

/**
 * Compute the defeated strength after applying a defeater.
 *
 * WU-THIMPL-202: Provides two methods for computing strength reduction:
 *
 * ## Linear Method (Default)
 *
 * Simple subtraction: `newStrength = max(0, originalStrength - reduction)`.
 * Fast and interpretable, but doesn't account for prior beliefs.
 *
 * **When to use**: Quick assessments, well-calibrated defeaters,
 * when simplicity is preferred.
 *
 * ## Bayesian Method
 *
 * Uses a beta-binomial update model to compute posterior strength.
 * The original strength is treated as evidence for claim validity,
 * and the defeater provides evidence against.
 *
 * Model:
 * - Prior: Beta(α, β) where α = priorStrength * priorSampleSize,
 *   β = (1 - priorStrength) * priorSampleSize
 * - Observation: originalStrength is treated as observing 'success'
 *   with probability proportional to strength
 * - Defeat evidence: confidenceReduction is treated as observing
 *   'failure' evidence
 * - Posterior: Beta(α + success_evidence, β + failure_evidence)
 *
 * **When to use**: When you want defeat to be more gradual with
 * strong prior beliefs, when combining multiple defeaters, when
 * you need uncertainty quantification.
 *
 * @param originalStrength - The original evidence strength (0-1)
 * @param defeater - The defeater to apply
 * @param options - Options controlling the reduction method
 * @returns The new strength after applying the defeater (0-1)
 *
 * @example
 * ```typescript
 * // Linear reduction (fast, simple)
 * const linear = computeDefeatedStrength(0.8, defeater, { method: 'linear' });
 * // Result: max(0, 0.8 - defeater.confidenceReduction)
 *
 * // Bayesian reduction (accounts for prior beliefs)
 * const bayesian = computeDefeatedStrength(0.8, defeater, {
 *   method: 'bayesian',
 *   priorStrength: 0.7,    // Strong prior belief in evidence
 *   priorSampleSize: 10,   // Moderate confidence in prior
 * });
 * // Result: Posterior mean from Beta-Binomial update
 * ```
 */
export function computeDefeatedStrength(
  originalStrength: number,
  defeater: ExtendedDefeater,
  options?: DefeatReductionOptions
): number {
  const opts = {
    ...DEFAULT_DEFEAT_REDUCTION_OPTIONS,
    ...options,
  };

  // Validate inputs
  const strength = Math.max(0, Math.min(1, originalStrength));
  const reduction = defeater.confidenceReduction;

  if (opts.method === 'linear') {
    // Linear method: simple subtraction
    return Math.max(0, strength - reduction);
  }

  // Bayesian method: Beta-Binomial update
  return computeBayesianDefeatedStrength(
    strength,
    reduction,
    opts.priorStrength,
    opts.priorSampleSize
  );
}

/**
 * Compute defeated strength using Beta-Binomial Bayesian update.
 *
 * WU-THIMPL-202: Mathematical details of the Bayesian method.
 *
 * ## Model
 *
 * We model the true evidence strength θ as a random variable with:
 * - Prior: θ ~ Beta(α₀, β₀)
 * - Evidence: originalStrength represents n_success observations
 * - Defeat: confidenceReduction represents n_failure observations
 *
 * The posterior is:
 *   θ | data ~ Beta(α₀ + n_success, β₀ + n_failure)
 *
 * We return the posterior mean:
 *   E[θ | data] = (α₀ + n_success) / (α₀ + β₀ + n_success + n_failure)
 *
 * ## Interpretation
 *
 * - originalStrength is converted to pseudo-observations: if strength is 0.8,
 *   it's like observing 0.8 successes out of 1 trial
 * - confidenceReduction is similarly converted to failure observations
 * - The prior acts as "virtual" observations from before any evidence
 *
 * ## Properties
 *
 * - With weak prior (small priorSampleSize), result is close to linear
 * - With strong prior, result is pulled toward priorStrength
 * - Multiple defeaters accumulate properly (sequential updates)
 * - Never goes below 0 or above 1 by construction
 *
 * @param originalStrength - Evidence strength before defeat (0-1)
 * @param reduction - Confidence reduction from defeater (0-1)
 * @param priorStrength - Prior belief about strength (0-1)
 * @param priorSampleSize - Strength of prior (pseudo-count)
 * @returns Posterior mean strength after Bayesian update
 */
function computeBayesianDefeatedStrength(
  originalStrength: number,
  reduction: number,
  priorStrength: number,
  priorSampleSize: number
): number {
  // Convert prior strength to Beta parameters
  // α = priorStrength * priorSampleSize
  // β = (1 - priorStrength) * priorSampleSize
  const alpha0 = priorStrength * priorSampleSize;
  const beta0 = (1 - priorStrength) * priorSampleSize;

  // Convert original strength to pseudo-observations
  // Treat it as evidence weight: higher strength = more "success" evidence
  const successEvidence = originalStrength;

  // Convert defeat reduction to failure evidence
  // Higher reduction = more "failure" evidence
  const failureEvidence = reduction;

  // Posterior parameters
  const alphaPost = alpha0 + successEvidence;
  const betaPost = beta0 + failureEvidence;

  // Posterior mean
  return alphaPost / (alphaPost + betaPost);
}

/**
 * Apply multiple defeaters to a strength value using specified method.
 *
 * WU-THIMPL-202: Handles sequential defeater application.
 *
 * For linear method, defeaters are applied sequentially with floor at 0.
 * For Bayesian method, defeat evidence accumulates in the posterior.
 *
 * @param originalStrength - Starting strength (0-1)
 * @param defeaters - Array of defeaters to apply
 * @param options - Options controlling the reduction method
 * @returns Final strength after all defeaters applied
 */
export function computeMultipleDefeatedStrength(
  originalStrength: number,
  defeaters: ExtendedDefeater[],
  options?: DefeatReductionOptions
): number {
  const opts = {
    ...DEFAULT_DEFEAT_REDUCTION_OPTIONS,
    ...options,
  };

  if (defeaters.length === 0) {
    return originalStrength;
  }

  if (opts.method === 'linear') {
    // Linear: apply each defeater sequentially
    let strength = originalStrength;
    for (const defeater of defeaters) {
      strength = computeDefeatedStrength(strength, defeater, opts);
    }
    return strength;
  }

  // Bayesian: accumulate all defeat evidence, then compute posterior
  const totalReduction = defeaters.reduce(
    (sum, d) => sum + d.confidenceReduction,
    0
  );

  // Create synthetic defeater with combined reduction
  const combinedDefeater: ExtendedDefeater = {
    ...defeaters[0],
    confidenceReduction: Math.min(1, totalReduction), // Cap at 1
  };

  return computeDefeatedStrength(originalStrength, combinedDefeater, opts);
}
