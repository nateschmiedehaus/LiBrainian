/**
 * @fileoverview Gettier Case Resolution Composition (tc_resolve_gettier_case)
 *
 * Systematically resolve Gettier cases (accidentally true beliefs).
 * A Gettier case is when a belief is justified and true, but the
 * justification doesn't properly connect to the truth.
 *
 * Based on self-improvement-primitives.md specification.
 *
 * Flow:
 * verifyClaim -> gather additional evidence -> reassess -> update or retract
 */

import type { LibrarianStorage } from '../../../storage/types.js';
import type { Evidence, GettierAnalysis, EpistemicStatus, ConfidenceValue, Claim as BaseClaim } from '../types.js';
import { verifyClaim, type ClaimVerificationResult, type Claim, type VerificationBudget } from '../verify_claim.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of Gettier case resolution.
 */
export interface GettierResolutionResult {
  /** The original claim being analyzed */
  originalClaim: Claim;
  /** Initial Gettier analysis from verification */
  gettierAnalysis: GettierAnalysis;
  /** Additional evidence gathered to strengthen justification */
  additionalEvidence: Evidence[];
  /** The resolved claim (null if retracted) */
  resolvedClaim: Claim | null;
  /** Resolution outcome */
  resolution: 'confirmed' | 'refuted' | 'upgraded' | 'unresolved';
  /** Detailed resolution report */
  resolutionReport: ResolutionReport;
  /** Duration of resolution in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Detailed report of the resolution process.
 */
export interface ResolutionReport {
  /** Initial Gettier risk score (0-1) */
  initialGettierRisk: number;
  /** Final Gettier risk score after resolution (0-1) */
  finalGettierRisk: number;
  /** Number of iterations required */
  iterationsRequired: number;
  /** Whether justification was strengthened */
  justificationStrengthened: boolean;
  /** New tests or evidence added */
  newEvidenceCount: number;
  /** Explanation of the resolution */
  explanation: string;
  /** Causal chain if established */
  causalChain?: CausalLink[];
  /** Counterevidence found */
  counterevidence: Evidence[];
}

/**
 * A causal link in the justification chain.
 */
export interface CausalLink {
  /** Source of the causal connection */
  from: string;
  /** Target of the causal connection */
  to: string;
  /** Strength of the causal connection (0-1) */
  strength: number;
  /** Type of causal relationship */
  type: 'entails' | 'supports' | 'explains' | 'correlates';
}

/**
 * Options for Gettier case resolution.
 */
export interface GettierResolutionOptions {
  /** Root directory of the codebase */
  rootDir?: string;
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Maximum iterations for resolution loop */
  maxIterations?: number;
  /** Target Gettier risk threshold (below this is "resolved") */
  targetGettierRisk?: number;
  /** Required confidence for resolution */
  requiredConfidence?: number;
  /** Verification budget per iteration */
  verificationBudget?: VerificationBudget;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_TARGET_GETTIER_RISK = 0.3;
const DEFAULT_REQUIRED_CONFIDENCE = 0.8;
const DEFAULT_VERIFICATION_BUDGET: VerificationBudget = {
  maxTokens: 5000,
  maxTimeMs: 60000,
  maxApiCalls: 50,
};

// ============================================================================
// EVIDENCE GATHERING STRATEGIES
// ============================================================================

/**
 * Gather additional evidence to strengthen causal justification.
 */
async function gatherAdditionalEvidence(
  claim: Claim,
  existingEvidence: Evidence[],
  storage: LibrarianStorage,
  verbose: boolean
): Promise<Evidence[]> {
  const additionalEvidence: Evidence[] = [];

  // Strategy 1: Look for test evidence that directly tests the claimed behavior
  try {
    const testMappings = await storage.getTestMappings({ limit: 500 });
    const claimTerms = extractTerms(claim.text);

    for (const mapping of testMappings) {
      const isRelevant = claimTerms.some(
        (term) =>
          mapping.testPath.toLowerCase().includes(term.toLowerCase()) ||
          mapping.sourcePath.toLowerCase().includes(term.toLowerCase())
      );

      if (isRelevant && mapping.confidence > 0.7) {
        // Check if we don't already have this evidence
        const alreadyHave = existingEvidence.some(
          (e) => e.location === mapping.testPath
        );

        if (!alreadyHave) {
          additionalEvidence.push({
            type: 'test',
            content: `Test at ${mapping.testPath} verifies behavior in ${mapping.sourcePath}`,
            location: mapping.testPath,
            confidence: {
              score: mapping.confidence,
              tier: mapping.confidence > 0.8 ? 'high' : 'medium',
              source: 'measured',
              sampleSize: 1,
            },
          });
        }
      }
    }
  } catch {
    // Continue without additional test evidence
  }

  // Strategy 2: Look for call graph evidence showing causal relationships
  try {
    const edges = await storage.getGraphEdges({ limit: 1000, edgeTypes: ['calls', 'imports'] });
    const claimTerms = extractTerms(claim.text);

    for (const edge of edges) {
      const isRelevant =
        claimTerms.some((term) => edge.fromId?.toLowerCase().includes(term.toLowerCase())) ||
        claimTerms.some((term) => edge.toId?.toLowerCase().includes(term.toLowerCase()));

      if (isRelevant && edge.edgeType === 'calls') {
        const alreadyHave = existingEvidence.some(
          (e) => e.content.includes(edge.fromId ?? '') && e.content.includes(edge.toId ?? '')
        );

        if (!alreadyHave) {
          additionalEvidence.push({
            type: 'trace',
            content: `Causal trace: ${edge.fromId} -> ${edge.toId}`,
            location: edge.sourceFile ?? 'unknown',
            confidence: {
              score: 0.7,
              tier: 'medium',
              source: 'measured',
              sampleSize: 1,
            },
          });
        }
      }
    }
  } catch {
    // Continue without call graph evidence
  }

  // Strategy 3: Look for assertion-based evidence in module purposes
  try {
    const modules = await storage.getModules({ limit: 500 });
    const claimTerms = extractTerms(claim.text);

    for (const mod of modules) {
      if (mod.purpose) {
        const isRelevant = claimTerms.some((term) =>
          mod.purpose?.toLowerCase().includes(term.toLowerCase())
        );

        if (isRelevant) {
          const alreadyHave = existingEvidence.some(
            (e) => e.location === mod.path
          );

          if (!alreadyHave) {
            additionalEvidence.push({
              type: 'assertion',
              content: `Module ${mod.path} states: ${mod.purpose}`,
              location: mod.path,
              confidence: {
                score: 0.6,
                tier: 'medium',
                source: 'estimated',
              },
            });
          }
        }
      }
    }
  } catch {
    // Continue without assertion evidence
  }

  if (verbose) {
    console.log(`[resolveGettier] Gathered ${additionalEvidence.length} additional evidence items`);
  }

  return additionalEvidence;
}

/**
 * Extract key terms from claim text.
 */
function extractTerms(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'can', 'could', 'may', 'might', 'must', 'that', 'this', 'it', 'its',
    'of', 'in', 'to', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

// ============================================================================
// GETTIER ANALYSIS
// ============================================================================

/**
 * Build causal chain from evidence.
 */
function buildCausalChain(evidence: Evidence[]): CausalLink[] {
  const chain: CausalLink[] = [];

  // Look for trace evidence to build causal links
  const traceEvidence = evidence.filter((e) => e.type === 'trace');
  for (const trace of traceEvidence) {
    const match = trace.content.match(/Causal trace: (.+) -> (.+)/);
    if (match) {
      chain.push({
        from: match[1],
        to: match[2],
        strength: trace.confidence.score,
        type: 'entails',
      });
    }
  }

  // Look for test evidence to add support links
  const testEvidence = evidence.filter((e) => e.type === 'test');
  for (const test of testEvidence) {
    const match = test.content.match(/Test at (.+) verifies behavior in (.+)/);
    if (match) {
      chain.push({
        from: match[1],
        to: match[2],
        strength: test.confidence.score,
        type: 'supports',
      });
    }
  }

  return chain;
}

/**
 * Reanalyze Gettier risk with additional evidence.
 */
function reanalyzeGettierRisk(
  originalAnalysis: GettierAnalysis,
  additionalEvidence: Evidence[],
  causalChain: CausalLink[]
): GettierAnalysis {
  // Calculate new justification strength
  const allEvidenceConfidence = additionalEvidence.map((e) => e.confidence.score);
  const avgNewEvidence = allEvidenceConfidence.length > 0
    ? allEvidenceConfidence.reduce((a, b) => a + b, 0) / allEvidenceConfidence.length
    : 0;

  // Combine with original justification
  const newJustificationStrength = Math.min(
    1,
    originalAnalysis.justificationStrength * 0.5 + avgNewEvidence * 0.3 + (causalChain.length > 0 ? 0.2 : 0)
  );

  // Determine truth basis based on causal chain
  let truthBasis: 'causal' | 'coincidental' | 'unknown' = 'unknown';
  if (causalChain.length >= 2) {
    const avgChainStrength = causalChain.reduce((sum, c) => sum + c.strength, 0) / causalChain.length;
    if (avgChainStrength > 0.6) {
      truthBasis = 'causal';
    } else if (avgChainStrength < 0.3) {
      // Weak causal chain indicates coincidental relationship
      truthBasis = 'coincidental';
    }
  } else if (additionalEvidence.length > 0 && avgNewEvidence < 0.4) {
    // Have evidence but it's weak - potentially coincidental
    truthBasis = 'coincidental';
  }

  // Calculate new Gettier risk
  const hasStrongCausalChain = causalChain.length >= 2 && truthBasis === 'causal';
  const hasTestEvidence = additionalEvidence.some((e) => e.type === 'test' && e.confidence.score > 0.7);

  let gettierRisk = originalAnalysis.gettierRisk;

  // Reduce risk if we have causal evidence
  if (hasStrongCausalChain) {
    gettierRisk *= 0.5;
  }

  // Reduce risk if we have test evidence
  if (hasTestEvidence) {
    gettierRisk *= 0.7;
  }

  // Increase justification strength effect
  gettierRisk *= (1 - newJustificationStrength * 0.3);

  gettierRisk = Math.max(0, Math.min(1, gettierRisk));

  const isGettierCase = truthBasis === 'coincidental' || (gettierRisk > 0.5 && truthBasis === 'unknown');

  return {
    isGettierCase,
    gettierRisk,
    justificationStrength: newJustificationStrength,
    truthBasis,
    mitigationPath: isGettierCase
      ? 'Gather more causal evidence linking claim to observable behavior'
      : undefined,
  };
}

/**
 * Find counterevidence that might refute the claim.
 */
async function findCounterevidence(
  claim: Claim,
  storage: LibrarianStorage,
  verbose: boolean
): Promise<Evidence[]> {
  const counterevidence: Evidence[] = [];

  try {
    const modules = await storage.getModules({ limit: 500 });
    const claimTerms = extractTerms(claim.text);

    for (const mod of modules) {
      if (mod.purpose) {
        const purposeLower = mod.purpose.toLowerCase();

        // Look for deprecation or TODO markers
        const hasDeprecation = purposeLower.includes('deprecated');
        const hasTodo = purposeLower.includes('todo') || purposeLower.includes('fixme');
        const hasNotImplemented = purposeLower.includes('not implemented') || purposeLower.includes('stub');

        if ((hasDeprecation || hasTodo || hasNotImplemented) &&
            claimTerms.some((term) => purposeLower.includes(term))) {
          counterevidence.push({
            type: 'assertion',
            content: `Counterevidence: ${mod.path} - ${mod.purpose}`,
            location: mod.path,
            confidence: {
              score: hasDeprecation ? 0.8 : 0.6,
              tier: hasDeprecation ? 'high' : 'medium',
              source: 'measured',
            },
          });
        }
      }
    }
  } catch {
    // Continue without counterevidence search
  }

  if (verbose && counterevidence.length > 0) {
    console.log(`[resolveGettier] Found ${counterevidence.length} counterevidence items`);
  }

  return counterevidence;
}

// ============================================================================
// RESOLUTION DETERMINATION
// ============================================================================

/**
 * Determine the resolution outcome.
 */
function determineResolution(
  originalAnalysis: GettierAnalysis,
  finalAnalysis: GettierAnalysis,
  counterevidence: Evidence[],
  targetGettierRisk: number
): 'confirmed' | 'refuted' | 'upgraded' | 'unresolved' {
  // If we have strong counterevidence, refute
  const strongCounterEvidence = counterevidence.filter((e) => e.confidence.score > 0.7);
  if (strongCounterEvidence.length >= 2) {
    return 'refuted';
  }

  // If Gettier risk is now below threshold, confirmed
  if (finalAnalysis.gettierRisk < targetGettierRisk) {
    return 'confirmed';
  }

  // If justification was significantly strengthened, upgraded
  if (finalAnalysis.justificationStrength > originalAnalysis.justificationStrength + 0.2) {
    return 'upgraded';
  }

  // Otherwise unresolved
  return 'unresolved';
}

/**
 * Generate explanation for the resolution.
 */
function generateExplanation(
  resolution: 'confirmed' | 'refuted' | 'upgraded' | 'unresolved',
  originalAnalysis: GettierAnalysis,
  finalAnalysis: GettierAnalysis,
  additionalEvidence: Evidence[],
  counterevidence: Evidence[]
): string {
  const parts: string[] = [];

  parts.push(`Initial Gettier risk: ${(originalAnalysis.gettierRisk * 100).toFixed(1)}%`);
  parts.push(`Final Gettier risk: ${(finalAnalysis.gettierRisk * 100).toFixed(1)}%`);

  if (additionalEvidence.length > 0) {
    parts.push(`Gathered ${additionalEvidence.length} additional evidence items`);
  }

  if (counterevidence.length > 0) {
    parts.push(`Found ${counterevidence.length} counterevidence items`);
  }

  switch (resolution) {
    case 'confirmed':
      parts.push('Claim confirmed with causal justification');
      break;
    case 'refuted':
      parts.push('Claim refuted due to counterevidence');
      break;
    case 'upgraded':
      parts.push('Justification strengthened but claim not fully confirmed');
      break;
    case 'unresolved':
      parts.push('Unable to establish sufficient causal justification');
      break;
  }

  if (finalAnalysis.truthBasis === 'causal') {
    parts.push('Truth basis: Causal connection established');
  } else if (finalAnalysis.truthBasis === 'coincidental') {
    parts.push('Warning: Truth may be coincidental');
  }

  return parts.join('. ') + '.';
}

// ============================================================================
// MAIN RESOLUTION FUNCTION
// ============================================================================

/**
 * Resolve a potential Gettier case (accidentally true belief).
 *
 * This composition:
 * 1. Verifies the claim and analyzes Gettier risk
 * 2. If Gettier risk is high, gathers additional causal evidence
 * 3. Builds a causal chain linking justification to truth
 * 4. Reassesses and determines resolution
 *
 * A Gettier case is resolved when:
 * - The claim is refuted (counterevidence found)
 * - The claim is confirmed with causal justification
 * - The justification is upgraded (but not fully confirmed)
 * - Or remains unresolved after max iterations
 *
 * @param suspectedGettierClaim - The claim suspected to be a Gettier case
 * @param options - Resolution configuration options
 * @returns Resolution result with analysis and outcome
 *
 * @example
 * ```typescript
 * const claim: Claim = {
 *   id: 'claim-1',
 *   text: 'The analyzeArchitecture function detects all circular dependencies',
 *   type: 'behavioral',
 *   source: 'documentation',
 *   context: 'architecture analysis module',
 * };
 *
 * const result = await resolveGettierCase(claim, {
 *   storage: myStorage,
 * });
 *
 * console.log(`Resolution: ${result.resolution}`);
 * console.log(`Final Gettier risk: ${result.gettierAnalysis.gettierRisk}`);
 * ```
 */
export async function resolveGettierCase(
  suspectedGettierClaim: Claim,
  options: GettierResolutionOptions
): Promise<GettierResolutionResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    rootDir,
    storage,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    targetGettierRisk = DEFAULT_TARGET_GETTIER_RISK,
    requiredConfidence = DEFAULT_REQUIRED_CONFIDENCE,
    verificationBudget = DEFAULT_VERIFICATION_BUDGET,
    verbose = false,
  } = options;

  // Validate inputs
  if (!storage) {
    throw new Error('storage is required for resolveGettierCase');
  }
  if (!suspectedGettierClaim.text) {
    throw new Error('claim text is required for resolveGettierCase');
  }

  if (verbose) {
    console.log(`[resolveGettier] Analyzing claim: "${suspectedGettierClaim.text}"`);
  }

  // Stage 1: Initial Verification
  let verificationResult: ClaimVerificationResult;
  try {
    verificationResult = await verifyClaim(suspectedGettierClaim, {
      rootDir,
      storage,
      budget: verificationBudget,
      requiredConfidence,
      verbose,
    });
  } catch (error) {
    errors.push(`Initial verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      originalClaim: suspectedGettierClaim,
      gettierAnalysis: {
        isGettierCase: false,
        gettierRisk: 0.5,
        justificationStrength: 0,
        truthBasis: 'unknown',
      },
      additionalEvidence: [],
      resolvedClaim: null,
      resolution: 'unresolved',
      resolutionReport: {
        initialGettierRisk: 0.5,
        finalGettierRisk: 0.5,
        iterationsRequired: 0,
        justificationStrengthened: false,
        newEvidenceCount: 0,
        explanation: 'Verification failed',
        counterevidence: [],
      },
      duration: Date.now() - startTime,
      errors,
    };
  }

  const initialAnalysis = verificationResult.gettierAnalysis;

  if (verbose) {
    console.log(`[resolveGettier] Initial Gettier risk: ${(initialAnalysis.gettierRisk * 100).toFixed(1)}%`);
  }

  // Early exit if already safe
  if (initialAnalysis.gettierRisk < targetGettierRisk && !initialAnalysis.isGettierCase) {
    if (verbose) {
      console.log('[resolveGettier] Claim already safe, no resolution needed');
    }

    return {
      originalClaim: suspectedGettierClaim,
      gettierAnalysis: initialAnalysis,
      additionalEvidence: [],
      resolvedClaim: suspectedGettierClaim,
      resolution: 'confirmed',
      resolutionReport: {
        initialGettierRisk: initialAnalysis.gettierRisk,
        finalGettierRisk: initialAnalysis.gettierRisk,
        iterationsRequired: 0,
        justificationStrengthened: false,
        newEvidenceCount: 0,
        explanation: 'Claim already has sufficient causal justification',
        counterevidence: [],
      },
      duration: Date.now() - startTime,
      errors,
    };
  }

  // Stage 2: Resolution Loop
  let currentAnalysis = initialAnalysis;
  let allAdditionalEvidence: Evidence[] = [];
  let counterevidence: Evidence[] = [];
  let iterations = 0;

  while (iterations < maxIterations && currentAnalysis.gettierRisk >= targetGettierRisk) {
    iterations++;

    if (verbose) {
      console.log(`[resolveGettier] Iteration ${iterations}/${maxIterations}`);
    }

    // Gather additional evidence
    const newEvidence = await gatherAdditionalEvidence(
      suspectedGettierClaim,
      [...verificationResult.evidence, ...allAdditionalEvidence],
      storage,
      verbose
    );
    allAdditionalEvidence.push(...newEvidence);

    // Find counterevidence
    const newCounterEvidence = await findCounterevidence(suspectedGettierClaim, storage, verbose);
    counterevidence.push(...newCounterEvidence);

    // Build causal chain
    const allEvidence = [...verificationResult.evidence, ...allAdditionalEvidence];
    const causalChain = buildCausalChain(allEvidence);

    // Reanalyze
    currentAnalysis = reanalyzeGettierRisk(initialAnalysis, allAdditionalEvidence, causalChain);

    if (verbose) {
      console.log(`[resolveGettier] Updated Gettier risk: ${(currentAnalysis.gettierRisk * 100).toFixed(1)}%`);
    }

    // Check for strong counterevidence (early exit)
    const strongCounterEvidence = counterevidence.filter((e) => e.confidence.score > 0.7);
    if (strongCounterEvidence.length >= 2) {
      if (verbose) {
        console.log('[resolveGettier] Strong counterevidence found, exiting loop');
      }
      break;
    }
  }

  // Stage 3: Determine Resolution
  const resolution = determineResolution(
    initialAnalysis,
    currentAnalysis,
    counterevidence,
    targetGettierRisk
  );

  // Build causal chain for report
  const allEvidence = [...verificationResult.evidence, ...allAdditionalEvidence];
  const causalChain = buildCausalChain(allEvidence);

  // Generate explanation
  const explanation = generateExplanation(
    resolution,
    initialAnalysis,
    currentAnalysis,
    allAdditionalEvidence,
    counterevidence
  );

  // Determine resolved claim
  let resolvedClaim: Claim | null = null;
  if (resolution === 'confirmed' || resolution === 'upgraded') {
    resolvedClaim = {
      ...suspectedGettierClaim,
      id: `${suspectedGettierClaim.id}-resolved`,
    };
  }

  const duration = Date.now() - startTime;

  if (verbose) {
    console.log(`[resolveGettier] Complete. Resolution: ${resolution}`);
  }

  return {
    originalClaim: suspectedGettierClaim,
    gettierAnalysis: currentAnalysis,
    additionalEvidence: allAdditionalEvidence,
    resolvedClaim,
    resolution,
    resolutionReport: {
      initialGettierRisk: initialAnalysis.gettierRisk,
      finalGettierRisk: currentAnalysis.gettierRisk,
      iterationsRequired: iterations,
      justificationStrengthened: currentAnalysis.justificationStrength > initialAnalysis.justificationStrength,
      newEvidenceCount: allAdditionalEvidence.length,
      explanation,
      causalChain: causalChain.length > 0 ? causalChain : undefined,
      counterevidence,
    },
    duration,
    errors,
  };
}
