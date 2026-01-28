/**
 * @fileoverview Claim Verification Primitive (tp_verify_claim)
 *
 * Verify a specific claim about the codebase.
 * Gathers evidence, assesses Gettier risk, and provides confidence-calibrated verdicts.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { LibrarianStorage, FunctionKnowledge, ModuleKnowledge } from '../../storage/types.js';
import type { ConfidenceValue, Evidence, ClaimType, EpistemicStatus, GettierAnalysis } from './types.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Claim to be verified.
 */
export interface Claim {
  /** Unique identifier */
  id: string;
  /** The claim text */
  text: string;
  /** Type of claim */
  type: ClaimType;
  /** Source of the claim */
  source: string;
  /** Context for verification */
  context: string;
}

/**
 * Verification budget constraints.
 */
export interface VerificationBudget {
  /** Maximum tokens to use */
  maxTokens: number;
  /** Maximum time in milliseconds */
  maxTimeMs: number;
  /** Maximum API calls */
  maxApiCalls?: number;
}

/**
 * Result of claim verification.
 */
export interface ClaimVerificationResult {
  /** The claim that was verified */
  claim: string;
  /** Verdict of verification */
  verdict: 'verified' | 'refuted' | 'uncertain';
  /** Evidence supporting the verdict */
  evidence: Evidence[];
  /** Confidence in the verdict */
  confidence: ConfidenceValue;
  /** Potential defeaters of the claim */
  defeaters: string[];
  /** Epistemic status */
  epistemicStatus: EpistemicStatus;
  /** Gettier case analysis */
  gettierAnalysis: GettierAnalysis;
  /** Duration of verification in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Options for claim verification.
 */
export interface VerifyClaimOptions {
  /** Root directory of the codebase */
  rootDir?: string;
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Maximum evidence items to gather */
  maxEvidence?: number;
  /** Maximum search depth for evidence */
  searchDepth?: number;
  /** Verification budget constraints */
  budget?: VerificationBudget;
  /** Required confidence threshold */
  requiredConfidence?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_EVIDENCE = 10;
const DEFAULT_SEARCH_DEPTH = 3;
const DEFAULT_REQUIRED_CONFIDENCE = 0.9;
const DEFAULT_BUDGET: VerificationBudget = {
  maxTokens: 5000,
  maxTimeMs: 60000,
  maxApiCalls: 50,
};

// ============================================================================
// EVIDENCE GATHERING
// ============================================================================

/**
 * Gather code evidence for a claim.
 */
async function gatherCodeEvidence(
  storage: LibrarianStorage,
  claim: string,
  maxEvidence: number,
  verbose: boolean
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];

  // Extract key terms from the claim
  const terms = extractKeyTerms(claim);

  if (verbose) {
    console.log(`[verifyClaim] Searching for evidence with terms: ${terms.join(', ')}`);
  }

  // Search functions for matching evidence
  try {
    const functions = await storage.getFunctions({ limit: 1000 });

    for (const fn of functions) {
      if (evidence.length >= maxEvidence) break;

      // Check if function relates to claim
      const relevance = calculateRelevance(fn, terms);
      if (relevance > 0.3) {
        evidence.push({
          type: 'code',
          content: `Function "${fn.name}" in ${fn.filePath}: ${fn.purpose ?? 'No description'}`,
          location: `${fn.filePath}:${fn.name}`,
          confidence: {
            score: relevance,
            tier: relevance > 0.7 ? 'high' : relevance > 0.5 ? 'medium' : 'low',
            source: 'measured',
            sampleSize: 1,
          },
        });
      }
    }
  } catch {
    // Continue without function evidence
  }

  return evidence;
}

/**
 * Gather test evidence for a claim.
 */
async function gatherTestEvidence(
  storage: LibrarianStorage,
  claim: string,
  maxEvidence: number,
  verbose: boolean
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  const terms = extractKeyTerms(claim);

  try {
    const testMappings = await storage.getTestMappings({ limit: 500 });

    for (const mapping of testMappings) {
      if (evidence.length >= maxEvidence) break;

      // Check if test relates to claim
      const relevance = terms.some((term) =>
        mapping.testPath.toLowerCase().includes(term.toLowerCase()) ||
        mapping.sourcePath.toLowerCase().includes(term.toLowerCase())
      ) ? mapping.confidence : 0;

      if (relevance > 0.3) {
        evidence.push({
          type: 'test',
          content: `Test "${mapping.testPath}" covers "${mapping.sourcePath}"`,
          location: mapping.testPath,
          confidence: {
            score: relevance,
            tier: relevance > 0.7 ? 'high' : relevance > 0.5 ? 'medium' : 'low',
            source: 'measured',
            sampleSize: 1,
          },
        });
      }
    }
  } catch {
    // Continue without test evidence
  }

  return evidence;
}

/**
 * Gather assertion evidence from graph edges.
 */
async function gatherAssertionEvidence(
  storage: LibrarianStorage,
  claim: string,
  maxEvidence: number,
  verbose: boolean
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  const terms = extractKeyTerms(claim);

  try {
    const edges = await storage.getGraphEdges({ limit: 1000 });

    for (const edge of edges) {
      if (evidence.length >= maxEvidence) break;

      // Check if edge relation supports claim using fromId and toId
      const relevance = terms.some((term) =>
        edge.fromId?.toLowerCase().includes(term.toLowerCase()) ||
        edge.toId?.toLowerCase().includes(term.toLowerCase())
      ) ? 0.6 : 0;

      if (relevance > 0.3 && edge.edgeType === 'calls') {
        evidence.push({
          type: 'assertion',
          content: `${edge.fromId} calls ${edge.toId}`,
          location: edge.sourceFile ?? 'unknown',
          confidence: {
            score: relevance,
            tier: 'medium',
            source: 'estimated',
          },
        });
      }
    }
  } catch {
    // Continue without assertion evidence
  }

  return evidence;
}

/**
 * Extract key terms from a claim for searching.
 */
function extractKeyTerms(claim: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'that',
    'this', 'these', 'those', 'it', 'its', 'of', 'in', 'to', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
  ]);

  const words = claim
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  // Return unique terms
  return [...new Set(words)];
}

/**
 * Calculate relevance of a function to search terms.
 */
function calculateRelevance(fn: FunctionKnowledge, terms: string[]): number {
  let matchCount = 0;
  let totalWeight = 0;

  const searchTargets = [
    { text: fn.name.toLowerCase(), weight: 3 },
    { text: (fn.purpose ?? '').toLowerCase(), weight: 2 },
    { text: (fn.signature ?? '').toLowerCase(), weight: 1 },
    { text: fn.filePath.toLowerCase(), weight: 1 },
  ];

  for (const term of terms) {
    const termLower = term.toLowerCase();
    for (const target of searchTargets) {
      if (target.text.includes(termLower)) {
        matchCount += target.weight;
      }
      totalWeight += target.weight;
    }
  }

  return totalWeight > 0 ? matchCount / totalWeight : 0;
}

// ============================================================================
// DEFEATER ANALYSIS
// ============================================================================

/**
 * Find potential defeaters for a claim.
 */
async function findDefeaters(
  storage: LibrarianStorage,
  claim: string,
  evidence: Evidence[],
  verbose: boolean
): Promise<string[]> {
  const defeaters: string[] = [];

  // Check for contradicting evidence
  const lowConfidenceEvidence = evidence.filter((e) => e.confidence.score < 0.5);
  if (lowConfidenceEvidence.length > evidence.length / 2) {
    defeaters.push('Majority of evidence has low confidence');
  }

  // Check for structural defeaters
  const terms = extractKeyTerms(claim);

  try {
    const modules = await storage.getModules({ limit: 500 });

    // Look for modules that might contradict the claim
    for (const mod of modules) {
      if (mod.purpose) {
        const purposeLower = mod.purpose.toLowerCase();

        // Check for negating terms
        if (purposeLower.includes('deprecated') && terms.some((t) => purposeLower.includes(t))) {
          defeaters.push(`Module "${mod.path}" is deprecated and relates to claim terms`);
        }

        if (purposeLower.includes('todo') && terms.some((t) => purposeLower.includes(t))) {
          defeaters.push(`Module "${mod.path}" has incomplete implementation (TODO found)`);
        }
      }
    }
  } catch {
    // Continue without defeater analysis
  }

  // Add defeater for insufficient evidence
  if (evidence.length < 2) {
    defeaters.push('Insufficient evidence to strongly support claim');
  }

  return defeaters;
}

// ============================================================================
// GETTIER ANALYSIS
// ============================================================================

/**
 * Analyze potential Gettier cases (accidentally true beliefs).
 */
function analyzeGettierRisk(
  evidence: Evidence[],
  defeaters: string[]
): GettierAnalysis {
  // Calculate justification strength
  const avgConfidence = evidence.length > 0
    ? evidence.reduce((sum, e) => sum + e.confidence.score, 0) / evidence.length
    : 0;

  // Calculate Gettier risk
  // High risk if: evidence exists but is coincidental, or justification is weak
  const hasCoincidentalEvidence = evidence.some((e) =>
    e.type === 'assertion' && e.confidence.tier === 'low'
  );

  const gettierRisk = Math.min(1, Math.max(0,
    (1 - avgConfidence) * 0.4 +
    (defeaters.length / 5) * 0.3 +
    (hasCoincidentalEvidence ? 0.3 : 0)
  ));

  // Determine truth basis
  let truthBasis: 'causal' | 'coincidental' | 'unknown' = 'unknown';
  if (avgConfidence > 0.7 && defeaters.length === 0) {
    truthBasis = 'causal';
  } else if (hasCoincidentalEvidence || avgConfidence < 0.4) {
    truthBasis = 'coincidental';
  }

  // Determine if this is a Gettier case
  const isGettierCase = truthBasis === 'coincidental' && avgConfidence > 0.5;

  return {
    isGettierCase,
    gettierRisk,
    justificationStrength: avgConfidence,
    truthBasis,
    mitigationPath: isGettierCase
      ? 'Gather additional causal evidence linking claim to code behavior'
      : undefined,
  };
}

// ============================================================================
// VERDICT DETERMINATION
// ============================================================================

/**
 * Determine the verification verdict based on evidence.
 */
function determineVerdict(
  evidence: Evidence[],
  defeaters: string[],
  requiredConfidence: number
): { verdict: 'verified' | 'refuted' | 'uncertain'; confidence: ConfidenceValue; epistemicStatus: EpistemicStatus } {
  if (evidence.length === 0) {
    return {
      verdict: 'uncertain',
      confidence: {
        score: 0,
        tier: 'uncertain',
        source: 'default',
      },
      epistemicStatus: 'inconclusive',
    };
  }

  // Calculate aggregate confidence
  const avgConfidence = evidence.reduce((sum, e) => sum + e.confidence.score, 0) / evidence.length;
  const maxConfidence = Math.max(...evidence.map((e) => e.confidence.score));

  // Apply defeater penalty
  const defeaterPenalty = Math.min(0.3, defeaters.length * 0.1);
  const adjustedConfidence = Math.max(0, avgConfidence - defeaterPenalty);

  // Determine tier
  let tier: 'high' | 'medium' | 'low' | 'uncertain';
  if (adjustedConfidence >= 0.8) tier = 'high';
  else if (adjustedConfidence >= 0.5) tier = 'medium';
  else if (adjustedConfidence >= 0.2) tier = 'low';
  else tier = 'uncertain';

  // Determine verdict
  let verdict: 'verified' | 'refuted' | 'uncertain';
  let epistemicStatus: EpistemicStatus;

  if (adjustedConfidence >= requiredConfidence) {
    verdict = 'verified';
    epistemicStatus = 'verified_with_evidence';
  } else if (adjustedConfidence < 0.3 && defeaters.length > 2) {
    verdict = 'refuted';
    epistemicStatus = 'refuted_with_evidence';
  } else {
    verdict = 'uncertain';
    epistemicStatus = 'inconclusive';
  }

  return {
    verdict,
    confidence: {
      score: adjustedConfidence,
      tier,
      source: 'measured',
      sampleSize: evidence.length,
    },
    epistemicStatus,
  };
}

// ============================================================================
// MAIN VERIFICATION FUNCTION
// ============================================================================

/**
 * Verify a specific claim about the codebase.
 *
 * This function:
 * 1. Gathers evidence from code, tests, and assertions
 * 2. Identifies potential defeaters
 * 3. Analyzes Gettier risk
 * 4. Determines a confidence-calibrated verdict
 *
 * @param claim - The claim to verify (either a string or Claim object)
 * @param options - Verification options
 * @returns Verification result with evidence and verdict
 *
 * @example
 * ```typescript
 * const result = await verifyClaim(
 *   'The analyzeArchitecture function detects circular dependencies',
 *   { storage: myStorage }
 * );
 * console.log(`Verdict: ${result.verdict} (confidence: ${result.confidence.score})`);
 * ```
 */
export async function verifyClaim(
  claim: string | Claim,
  options: VerifyClaimOptions
): Promise<ClaimVerificationResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    storage,
    maxEvidence = DEFAULT_MAX_EVIDENCE,
    searchDepth = DEFAULT_SEARCH_DEPTH,
    budget = DEFAULT_BUDGET,
    requiredConfidence = DEFAULT_REQUIRED_CONFIDENCE,
    verbose = false,
  } = options;

  // Validate inputs
  if (!storage) {
    throw new Error('storage is required for verifyClaim');
  }

  // Extract claim text
  const claimText = typeof claim === 'string' ? claim : claim.text;

  if (!claimText || claimText.trim().length === 0) {
    throw new Error('claim text is required for verifyClaim');
  }

  if (verbose) {
    console.log(`[verifyClaim] Verifying claim: "${claimText}"`);
  }

  // Gather evidence from multiple sources
  const allEvidence: Evidence[] = [];

  // Code evidence
  try {
    const codeEvidence = await gatherCodeEvidence(storage, claimText, maxEvidence, verbose);
    allEvidence.push(...codeEvidence);
  } catch (error) {
    errors.push(`Code evidence gathering failed: ${getErrorMessage(error)}`);
  }

  // Test evidence
  try {
    const testEvidence = await gatherTestEvidence(storage, claimText, maxEvidence - allEvidence.length, verbose);
    allEvidence.push(...testEvidence);
  } catch (error) {
    errors.push(`Test evidence gathering failed: ${getErrorMessage(error)}`);
  }

  // Assertion evidence
  try {
    const assertionEvidence = await gatherAssertionEvidence(storage, claimText, maxEvidence - allEvidence.length, verbose);
    allEvidence.push(...assertionEvidence);
  } catch (error) {
    errors.push(`Assertion evidence gathering failed: ${getErrorMessage(error)}`);
  }

  // Sort evidence by confidence
  allEvidence.sort((a, b) => b.confidence.score - a.confidence.score);

  // Limit to max evidence
  const evidence = allEvidence.slice(0, maxEvidence);

  if (verbose) {
    console.log(`[verifyClaim] Gathered ${evidence.length} evidence items`);
  }

  // Find defeaters
  let defeaters: string[] = [];
  try {
    defeaters = await findDefeaters(storage, claimText, evidence, verbose);
  } catch (error) {
    errors.push(`Defeater analysis failed: ${getErrorMessage(error)}`);
  }

  // Analyze Gettier risk
  const gettierAnalysis = analyzeGettierRisk(evidence, defeaters);

  // Check for Gettier case
  if (gettierAnalysis.isGettierCase) {
    defeaters.push('Potential Gettier case detected: belief may be accidentally true');
  }

  // Determine verdict
  const { verdict, confidence, epistemicStatus } = determineVerdict(
    evidence,
    defeaters,
    requiredConfidence
  );

  // Adjust epistemic status for Gettier case
  const finalEpistemicStatus: EpistemicStatus = gettierAnalysis.isGettierCase
    ? 'gettier_case'
    : epistemicStatus;

  return {
    claim: claimText,
    verdict,
    evidence,
    confidence,
    defeaters,
    epistemicStatus: finalEpistemicStatus,
    gettierAnalysis,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a claim verification primitive with bound options.
 */
export function createVerifyClaim(
  defaultOptions: Partial<VerifyClaimOptions>
): (claim: string | Claim, options?: Partial<VerifyClaimOptions>) => Promise<ClaimVerificationResult> {
  return async (claim, options = {}) => {
    return verifyClaim(claim, {
      ...defaultOptions,
      ...options,
    } as VerifyClaimOptions);
  };
}
