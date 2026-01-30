/**
 * @fileoverview Epistemic Progress Metrics
 *
 * Information-theoretic metrics to measure whether Librarian's knowledge is improving
 * over time. Implements entropy, information gain, KL divergence, and progress tracking.
 *
 * Based on Section 6 (Information Theory) of the mathematical foundations research.
 *
 * Key metrics:
 * - Shannon entropy for uncertainty quantification
 * - Information gain (entropy reduction) from evidence
 * - KL divergence and Jensen-Shannon divergence for belief comparison
 * - Comprehensive progress reports over time periods
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from './confidence.js';
import { getNumericValue } from './confidence.js';
import type { IEvidenceLedger, EvidenceEntry, EvidenceId } from './evidence_ledger.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Small epsilon to avoid log(0) and division by zero.
 */
const EPSILON = 1e-15;

/**
 * Natural logarithm of 2, for converting between nats and bits.
 */
const LN2 = Math.LN2;

// ============================================================================
// ENTROPY METRICS
// ============================================================================

/**
 * Calculate Shannon entropy for a discrete probability distribution.
 *
 * H(X) = -sum{p(x) * log2(p(x))}
 *
 * Higher entropy indicates more uncertainty. Maximum entropy for n outcomes
 * is log2(n), achieved when all outcomes are equally likely.
 *
 * @param probabilities - Array of probabilities (must sum to 1)
 * @returns Entropy in bits (base-2 logarithm)
 *
 * @example
 * ```typescript
 * // Uniform distribution (maximum entropy)
 * shannonEntropy([0.5, 0.5]); // 1.0 bit
 *
 * // Certain outcome (minimum entropy)
 * shannonEntropy([1.0, 0.0]); // 0.0 bits
 *
 * // Skewed distribution
 * shannonEntropy([0.9, 0.1]); // ~0.47 bits
 * ```
 */
export function shannonEntropy(probabilities: number[]): number {
  if (probabilities.length === 0) return 0;

  // Normalize probabilities in case they don't sum exactly to 1
  const sum = probabilities.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  let entropy = 0;
  for (const p of probabilities) {
    const normalizedP = p / sum;
    if (normalizedP > EPSILON) {
      entropy -= normalizedP * Math.log(normalizedP) / LN2;
    }
  }

  return Math.max(0, entropy);
}

/**
 * Calculate entropy of a belief state represented by confidence values.
 *
 * For each confidence value, we interpret it as a probability and compute
 * binary entropy: H(p) = -p*log2(p) - (1-p)*log2(1-p)
 *
 * The total belief entropy is the sum of individual binary entropies,
 * normalized by the number of beliefs.
 *
 * @param confidences - Array of confidence values representing beliefs
 * @returns Average binary entropy across all beliefs (0 to 1 bits)
 *
 * @example
 * ```typescript
 * // High confidence = low entropy
 * beliefEntropy([deterministic(true, 'certain')]); // 0.0
 *
 * // Maximum uncertainty
 * beliefEntropy([bounded(0.5, 0.5, 'theoretical', 'coin flip')]); // 1.0
 *
 * // Mixed confidence levels
 * beliefEntropy([measured(...), derived(...)]); // varies
 * ```
 */
export function beliefEntropy(confidences: ConfidenceValue[]): number {
  if (confidences.length === 0) return 0;

  let totalEntropy = 0;
  let validCount = 0;

  for (const conf of confidences) {
    const p = getNumericValue(conf);
    if (p === null) continue;

    // Clamp to avoid log(0)
    const clampedP = Math.max(EPSILON, Math.min(1 - EPSILON, p));

    // Binary entropy: H(p) = -p*log2(p) - (1-p)*log2(1-p)
    const binaryEntropy = -clampedP * Math.log(clampedP) / LN2
                          - (1 - clampedP) * Math.log(1 - clampedP) / LN2;

    totalEntropy += binaryEntropy;
    validCount++;
  }

  return validCount > 0 ? totalEntropy / validCount : 0;
}

/**
 * Calculate differential entropy for continuous confidence ranges.
 *
 * For bounded confidence intervals [low, high], we use the entropy of a
 * uniform distribution: H = log2(high - low)
 *
 * Wider intervals have higher entropy (more uncertainty).
 *
 * @param bounds - Array of [low, high] confidence intervals
 * @returns Average differential entropy (can be negative for narrow intervals)
 *
 * @example
 * ```typescript
 * // Wide interval = high entropy
 * differentialEntropy([[0.0, 1.0]]); // 0.0 bits (full unit interval)
 *
 * // Narrow interval = low entropy
 * differentialEntropy([[0.8, 0.9]]); // ~-3.32 bits
 *
 * // Point estimate = -Infinity (handled as 0)
 * differentialEntropy([[0.5, 0.5]]); // 0
 * ```
 */
export function differentialEntropy(bounds: Array<[number, number]>): number {
  if (bounds.length === 0) return 0;

  let totalEntropy = 0;
  let validCount = 0;

  for (const [low, high] of bounds) {
    const width = high - low;
    if (width > EPSILON) {
      // Entropy of uniform distribution: log2(width)
      totalEntropy += Math.log(width) / LN2;
      validCount++;
    }
    // Zero-width intervals contribute 0 to average
  }

  return validCount > 0 ? totalEntropy / validCount : 0;
}

// ============================================================================
// INFORMATION GAIN
// ============================================================================

/**
 * Significance level of information gain.
 *
 * - negligible: < 0.1 bits (essentially no change)
 * - minor: 0.1 - 0.5 bits (small refinement)
 * - significant: 0.5 - 1.0 bits (substantial reduction in uncertainty)
 * - major: > 1.0 bits (major insight gained)
 */
export type InformationGainSignificance = 'negligible' | 'minor' | 'significant' | 'major';

/**
 * Result of calculating information gain between two belief states.
 */
export interface InformationGain {
  /** Entropy before the update (in bits) */
  prior: number;
  /** Entropy after the update (in bits) */
  posterior: number;
  /** Information gain: prior - posterior (positive = reduced uncertainty) */
  gain: number;
  /** Qualitative significance of the gain */
  significance: InformationGainSignificance;
}

/**
 * Classify the significance of an information gain value.
 */
function classifyGainSignificance(gain: number): InformationGainSignificance {
  const absGain = Math.abs(gain);
  if (absGain < 0.1) return 'negligible';
  if (absGain < 0.5) return 'minor';
  if (absGain < 1.0) return 'significant';
  return 'major';
}

/**
 * Calculate information gain from updating beliefs with new evidence.
 *
 * Information gain is the reduction in entropy: IG = H(before) - H(after)
 *
 * Positive gain means uncertainty was reduced (we learned something).
 * Negative gain means uncertainty increased (contradictory evidence, etc.).
 *
 * @param before - Confidence values before the update
 * @param after - Confidence values after the update
 * @returns Information gain metrics
 *
 * @example
 * ```typescript
 * const before = [bounded(0.3, 0.7, 'theoretical', 'initial')];
 * const after = [measured({ accuracy: 0.85, ... })];
 *
 * const gain = calculateInformationGain(before, after);
 * // gain.prior ≈ 0.88 bits (uncertain)
 * // gain.posterior ≈ 0.61 bits (more certain)
 * // gain.gain ≈ 0.27 bits (reduced uncertainty)
 * // gain.significance = 'minor'
 * ```
 */
export function calculateInformationGain(
  before: ConfidenceValue[],
  after: ConfidenceValue[]
): InformationGain {
  const prior = beliefEntropy(before);
  const posterior = beliefEntropy(after);
  const gain = prior - posterior;

  return {
    prior,
    posterior,
    gain,
    significance: classifyGainSignificance(gain),
  };
}

// ============================================================================
// KL DIVERGENCE AND RELATED MEASURES
// ============================================================================

/**
 * Calculate Kullback-Leibler divergence between two probability distributions.
 *
 * D_KL(P || Q) = sum{P(x) * log2(P(x) / Q(x))}
 *
 * Properties:
 * - Non-negative: D_KL >= 0
 * - Zero iff P = Q
 * - Not symmetric: D_KL(P||Q) != D_KL(Q||P)
 *
 * Interpretation: Expected number of extra bits needed when using Q to
 * encode samples from P.
 *
 * @param p - True distribution (reference)
 * @param q - Approximate distribution (model)
 * @returns KL divergence in bits (non-negative)
 * @throws Error if distributions have different lengths
 *
 * @example
 * ```typescript
 * // Identical distributions
 * klDivergence([0.5, 0.5], [0.5, 0.5]); // 0.0
 *
 * // Different distributions
 * klDivergence([0.9, 0.1], [0.5, 0.5]); // ~0.53 bits
 * ```
 */
export function klDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length) {
    throw new Error(`KL divergence requires equal-length distributions: ${p.length} vs ${q.length}`);
  }

  if (p.length === 0) return 0;

  // Normalize distributions
  const pSum = p.reduce((a, b) => a + b, 0);
  const qSum = q.reduce((a, b) => a + b, 0);

  if (pSum === 0 || qSum === 0) return 0;

  let kl = 0;
  for (let i = 0; i < p.length; i++) {
    const pNorm = p[i] / pSum;
    const qNorm = Math.max(EPSILON, q[i] / qSum); // Avoid log(0)

    if (pNorm > EPSILON) {
      kl += pNorm * Math.log(pNorm / qNorm) / LN2;
    }
  }

  return Math.max(0, kl);
}

/**
 * Calculate Jensen-Shannon divergence (symmetric KL divergence).
 *
 * JS(P || Q) = 0.5 * D_KL(P || M) + 0.5 * D_KL(Q || M)
 * where M = 0.5 * (P + Q)
 *
 * Properties:
 * - Symmetric: JS(P||Q) = JS(Q||P)
 * - Bounded: 0 <= JS <= 1 (in bits)
 * - sqrt(JS) is a proper metric
 *
 * @param p - First distribution
 * @param q - Second distribution
 * @returns Jensen-Shannon divergence in bits (0 to 1)
 * @throws Error if distributions have different lengths
 *
 * @example
 * ```typescript
 * // Identical distributions
 * jsDivergence([0.5, 0.5], [0.5, 0.5]); // 0.0
 *
 * // Maximally different
 * jsDivergence([1.0, 0.0], [0.0, 1.0]); // 1.0
 *
 * // Partially different
 * jsDivergence([0.7, 0.3], [0.3, 0.7]); // ~0.29
 * ```
 */
export function jsDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length) {
    throw new Error(`JS divergence requires equal-length distributions: ${p.length} vs ${q.length}`);
  }

  if (p.length === 0) return 0;

  // Normalize distributions
  const pSum = p.reduce((a, b) => a + b, 0);
  const qSum = q.reduce((a, b) => a + b, 0);

  if (pSum === 0 && qSum === 0) return 0;
  if (pSum === 0 || qSum === 0) return 1; // Maximum divergence

  // Compute midpoint distribution M = 0.5 * (P + Q)
  const m: number[] = [];
  for (let i = 0; i < p.length; i++) {
    m.push((p[i] / pSum + q[i] / qSum) / 2);
  }

  // JS = 0.5 * KL(P||M) + 0.5 * KL(Q||M)
  const normalizedP = p.map(x => x / pSum);
  const normalizedQ = q.map(x => x / qSum);

  return 0.5 * klDivergence(normalizedP, m) + 0.5 * klDivergence(normalizedQ, m);
}

/**
 * Measure belief update magnitude using KL divergence.
 *
 * Converts confidence values to probability distributions and measures
 * how much the beliefs changed.
 *
 * @param prior - Beliefs before update (map of claim ID to confidence)
 * @param posterior - Beliefs after update (map of claim ID to confidence)
 * @returns KL divergence measuring the magnitude of the update
 */
export function measureBeliefUpdate(
  prior: Map<string, number>,
  posterior: Map<string, number>
): number {
  // Get union of all claim IDs
  const allIds = new Set([...prior.keys(), ...posterior.keys()]);
  if (allIds.size === 0) return 0;

  const priorProbs: number[] = [];
  const posteriorProbs: number[] = [];

  for (const id of allIds) {
    // Default to 0.5 (maximum uncertainty) for missing claims
    priorProbs.push(prior.get(id) ?? 0.5);
    posteriorProbs.push(posterior.get(id) ?? 0.5);
  }

  // Use JS divergence for symmetric measure
  return jsDivergence(posteriorProbs, priorProbs);
}

// ============================================================================
// PROGRESS REPORT
// ============================================================================

/**
 * Overall assessment of epistemic progress.
 *
 * - regressing: Knowledge quality is declining
 * - stagnant: No meaningful change
 * - progressing: Steady improvement
 * - flourishing: Rapid, high-quality improvement
 */
export type ProgressAssessment = 'regressing' | 'stagnant' | 'progressing' | 'flourishing';

/**
 * Comprehensive report on epistemic progress over a time period.
 */
export interface EpistemicProgressReport {
  /** When this report was generated */
  timestamp: string;
  /** Time period covered by this report */
  period: {
    start: string;
    end: string;
  };

  // ---- Entropy metrics ----

  /** Average belief entropy at the start of the period */
  startingEntropy: number;
  /** Average belief entropy at the end of the period */
  endingEntropy: number;
  /** Reduction in entropy (positive = improved) */
  entropyReduction: number;

  // ---- Claim metrics ----

  /** Number of new claims added during the period */
  claimsAdded: number;
  /** Number of claims revised (confidence updated) */
  claimsRevised: number;
  /** Number of claims defeated or retracted */
  claimsDefeated: number;
  /** Net change in knowledge base size */
  netKnowledgeGrowth: number;

  // ---- Confidence metrics ----

  /** Average confidence at the start of the period */
  averageConfidenceBefore: number;
  /** Average confidence at the end of the period */
  averageConfidenceAfter: number;
  /** Improvement in calibration (lower ECE is better) */
  calibrationImprovement: number;

  // ---- Quality metrics ----

  /** Number of contradictions resolved during the period */
  contradictionsResolved: number;
  /** Number of defeaters processed (triggered and applied) */
  defeatersProcessed: number;

  // ---- Overall assessment ----

  /** Overall progress score from -1 (regression) to 1 (flourishing) */
  progressScore: number;
  /** Qualitative assessment of progress */
  assessment: ProgressAssessment;
}

/**
 * Helper to extract confidences from evidence entries.
 */
function extractConfidences(entries: EvidenceEntry[]): ConfidenceValue[] {
  return entries
    .filter(e => e.confidence !== undefined)
    .map(e => e.confidence!);
}

/**
 * Helper to compute average numeric confidence.
 */
function averageConfidence(confidences: ConfidenceValue[]): number {
  if (confidences.length === 0) return 0.5;

  let sum = 0;
  let count = 0;

  for (const conf of confidences) {
    const value = getNumericValue(conf);
    if (value !== null) {
      sum += value;
      count++;
    }
  }

  return count > 0 ? sum / count : 0.5;
}

/**
 * Compute progress score from metrics.
 */
function computeProgressScore(
  entropyReduction: number,
  netKnowledgeGrowth: number,
  confidenceImprovement: number,
  calibrationImprovement: number,
  contradictionsResolved: number
): number {
  // Weight different factors
  // Entropy reduction is most important (direct measure of learning)
  // Knowledge growth matters but can be noisy
  // Confidence improvement indicates refinement
  // Calibration improvement indicates better quality
  // Contradiction resolution indicates problem-solving

  let score = 0;

  // Entropy reduction: normalized to [-1, 1] range
  // A reduction of 0.5 bits is considered significant
  score += Math.tanh(entropyReduction * 2) * 0.3;

  // Knowledge growth: positive is good, but saturates
  // Net growth of 10 claims is considered significant
  score += Math.tanh(netKnowledgeGrowth / 10) * 0.2;

  // Confidence improvement: already in [-1, 1] range roughly
  score += Math.tanh(confidenceImprovement * 5) * 0.2;

  // Calibration improvement: lower ECE is better
  // Improvement of 0.1 is considered significant
  score += Math.tanh(calibrationImprovement * 10) * 0.15;

  // Contradiction resolution: always positive contribution
  score += Math.tanh(contradictionsResolved / 5) * 0.15;

  return Math.max(-1, Math.min(1, score));
}

/**
 * Classify progress assessment from score.
 */
function classifyProgress(score: number): ProgressAssessment {
  if (score < -0.3) return 'regressing';
  if (score < 0.1) return 'stagnant';
  if (score < 0.5) return 'progressing';
  return 'flourishing';
}

/**
 * Generate an epistemic progress report for a time period.
 *
 * Analyzes evidence ledger entries to compute metrics about how
 * knowledge quality changed during the specified period.
 *
 * @param ledger - Evidence ledger to analyze
 * @param startTime - Start of the period (ISO timestamp)
 * @param endTime - End of the period (ISO timestamp)
 * @returns Comprehensive progress report
 *
 * @example
 * ```typescript
 * const ledger = await createEvidenceLedger(':memory:');
 * // ... add entries ...
 *
 * const report = await generateProgressReport(
 *   ledger,
 *   '2024-01-01T00:00:00Z',
 *   '2024-01-31T23:59:59Z'
 * );
 *
 * console.log(`Progress: ${report.assessment} (score: ${report.progressScore})`);
 * console.log(`Entropy reduced by ${report.entropyReduction.toFixed(2)} bits`);
 * ```
 */
export async function generateProgressReport(
  ledger: IEvidenceLedger,
  startTime: string,
  endTime: string
): Promise<EpistemicProgressReport> {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const midDate = new Date((startDate.getTime() + endDate.getTime()) / 2);

  // Query entries from different phases
  const earlyEntries = await ledger.query({
    timeRange: { from: startDate, to: midDate },
    orderBy: 'timestamp',
    orderDirection: 'asc',
  });

  const lateEntries = await ledger.query({
    timeRange: { from: midDate, to: endDate },
    orderBy: 'timestamp',
    orderDirection: 'asc',
  });

  const allEntries = await ledger.query({
    timeRange: { from: startDate, to: endDate },
    orderBy: 'timestamp',
    orderDirection: 'asc',
  });

  // Extract confidences for entropy calculation
  const earlyConfidences = extractConfidences(earlyEntries);
  const lateConfidences = extractConfidences(lateEntries);

  // Compute entropy metrics
  const startingEntropy = beliefEntropy(earlyConfidences);
  const endingEntropy = beliefEntropy(lateConfidences);
  const entropyReduction = startingEntropy - endingEntropy;

  // Count claim-related events
  const claimEntries = allEntries.filter(e => e.kind === 'claim');
  const verificationEntries = allEntries.filter(e => e.kind === 'verification');
  const feedbackEntries = allEntries.filter(e => e.kind === 'feedback');
  const contradictionEntries = allEntries.filter(e => e.kind === 'contradiction');

  // Estimate claim changes (heuristic based on entry types)
  const claimsAdded = claimEntries.length;

  // Count revised claims (claims with verification or feedback)
  const verifiedClaimIds = new Set<string>();
  for (const entry of verificationEntries) {
    if ('claimId' in entry.payload) {
      verifiedClaimIds.add(entry.payload.claimId as string);
    }
  }
  const claimsRevised = verifiedClaimIds.size;

  // Count defeated claims (from feedback with 'incorrect' or verification with 'refuted')
  let claimsDefeated = 0;
  for (const entry of feedbackEntries) {
    if ('feedbackType' in entry.payload && entry.payload.feedbackType === 'incorrect') {
      claimsDefeated++;
    }
  }
  for (const entry of verificationEntries) {
    if ('result' in entry.payload && entry.payload.result === 'refuted') {
      claimsDefeated++;
    }
  }

  const netKnowledgeGrowth = claimsAdded - claimsDefeated;

  // Compute confidence metrics
  const averageConfidenceBefore = averageConfidence(earlyConfidences);
  const averageConfidenceAfter = averageConfidence(lateConfidences);

  // Calibration improvement (from calibration entries)
  const calibrationEntries = allEntries.filter(e => e.kind === 'calibration');
  let calibrationImprovement = 0;
  if (calibrationEntries.length >= 2) {
    const earlyCalibration = calibrationEntries[0];
    const lateCalibration = calibrationEntries[calibrationEntries.length - 1];

    // Lower ECE is better, so improvement is positive when ECE decreases
    if ('ece' in earlyCalibration.payload && 'ece' in lateCalibration.payload) {
      calibrationImprovement = (earlyCalibration.payload.ece as number)
                              - (lateCalibration.payload.ece as number);
    }
  }

  // Count resolved contradictions
  const resolvedContradictions = contradictionEntries.filter(e => {
    // If there's a related entry that resolved it, count it
    // For now, just count total contradictions as a proxy
    return e.relatedEntries.length > 0;
  }).length;

  // Count defeaters processed
  const defeatersProcessed = verificationEntries.filter(e =>
    'result' in e.payload && e.payload.result === 'refuted'
  ).length;

  // Compute overall progress score
  const confidenceImprovement = averageConfidenceAfter - averageConfidenceBefore;
  const progressScore = computeProgressScore(
    entropyReduction,
    netKnowledgeGrowth,
    confidenceImprovement,
    calibrationImprovement,
    resolvedContradictions
  );

  return {
    timestamp: new Date().toISOString(),
    period: {
      start: startTime,
      end: endTime,
    },
    startingEntropy,
    endingEntropy,
    entropyReduction,
    claimsAdded,
    claimsRevised,
    claimsDefeated,
    netKnowledgeGrowth,
    averageConfidenceBefore,
    averageConfidenceAfter,
    calibrationImprovement,
    contradictionsResolved: resolvedContradictions,
    defeatersProcessed,
    progressScore,
    assessment: classifyProgress(progressScore),
  };
}

// ============================================================================
// TREND ANALYSIS
// ============================================================================

/**
 * Trend direction over multiple periods.
 */
export type TrendDirection = 'declining' | 'stable' | 'improving';

/**
 * Result of analyzing progress trend over multiple periods.
 */
export interface ProgressTrend {
  /** Overall trend direction */
  trend: TrendDirection;
  /** Rate of change (positive = improving, negative = declining) */
  rate: number;
  /** Number of periods analyzed */
  periodsAnalyzed: number;
  /** Confidence in the trend assessment (based on sample size and consistency) */
  confidence: number;
}

/**
 * Analyze progress trend over multiple time periods.
 *
 * Uses linear regression on progress scores to determine overall trend.
 *
 * @param reports - Array of progress reports in chronological order
 * @returns Trend analysis result
 *
 * @example
 * ```typescript
 * const reports = await Promise.all([
 *   generateProgressReport(ledger, '2024-01-01', '2024-01-07'),
 *   generateProgressReport(ledger, '2024-01-08', '2024-01-14'),
 *   generateProgressReport(ledger, '2024-01-15', '2024-01-21'),
 *   generateProgressReport(ledger, '2024-01-22', '2024-01-28'),
 * ]);
 *
 * const trend = analyzeProgressTrend(reports);
 * console.log(`Trend: ${trend.trend} at rate ${trend.rate.toFixed(3)}/period`);
 * ```
 */
export function analyzeProgressTrend(reports: EpistemicProgressReport[]): ProgressTrend {
  if (reports.length === 0) {
    return {
      trend: 'stable',
      rate: 0,
      periodsAnalyzed: 0,
      confidence: 0,
    };
  }

  if (reports.length === 1) {
    return {
      trend: reports[0].progressScore > 0 ? 'improving' : 'stable',
      rate: reports[0].progressScore,
      periodsAnalyzed: 1,
      confidence: 0.1, // Low confidence with single data point
    };
  }

  // Extract progress scores
  const scores = reports.map(r => r.progressScore);
  const n = scores.length;

  // Linear regression: y = mx + b
  // m = (n*sum(xy) - sum(x)*sum(y)) / (n*sum(x^2) - sum(x)^2)
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
    sumY2 += scores[i] * scores[i];
  }

  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator !== 0
    ? (n * sumXY - sumX * sumY) / denominator
    : 0;

  // Compute R-squared for confidence
  const meanY = sumY / n;
  let ssTotal = 0;
  let ssResidual = 0;

  for (let i = 0; i < n; i++) {
    const predicted = meanY + slope * (i - (n - 1) / 2);
    ssTotal += (scores[i] - meanY) ** 2;
    ssResidual += (scores[i] - predicted) ** 2;
  }

  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  // Classify trend based on slope
  let trend: TrendDirection;
  if (slope > 0.05) {
    trend = 'improving';
  } else if (slope < -0.05) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  // Confidence based on R-squared and sample size
  // More data points and better fit = higher confidence
  const sampleSizeConfidence = Math.min(1, n / 10);
  const confidence = Math.sqrt(Math.max(0, rSquared)) * sampleSizeConfidence;

  return {
    trend,
    rate: slope,
    periodsAnalyzed: n,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate mutual information between two random variables.
 *
 * I(X;Y) = H(X) + H(Y) - H(X,Y)
 *
 * This measures how much knowing one variable tells us about the other.
 *
 * @param pXY - Joint probability distribution (2D array)
 * @returns Mutual information in bits
 */
export function mutualInformation(pXY: number[][]): number {
  if (pXY.length === 0 || pXY[0].length === 0) return 0;

  const rows = pXY.length;
  const cols = pXY[0].length;

  // Compute marginals
  const pX: number[] = new Array(rows).fill(0);
  const pY: number[] = new Array(cols).fill(0);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      pX[i] += pXY[i][j];
      pY[j] += pXY[i][j];
    }
  }

  // H(X), H(Y), H(X,Y)
  const hX = shannonEntropy(pX);
  const hY = shannonEntropy(pY);

  // Flatten joint distribution for entropy calculation
  const flatJoint: number[] = [];
  for (const row of pXY) {
    flatJoint.push(...row);
  }
  const hXY = shannonEntropy(flatJoint);

  // I(X;Y) = H(X) + H(Y) - H(X,Y)
  return Math.max(0, hX + hY - hXY);
}

/**
 * Estimate evidence redundancy between two sources.
 *
 * Uses normalized mutual information to measure how much the evidence
 * from two sources overlaps (tells us the same thing).
 *
 * @param evidence1Confidences - Confidences from first source
 * @param evidence2Confidences - Confidences from second source
 * @returns Redundancy measure (0 = independent, 1 = fully redundant)
 */
export function measureRedundancy(
  evidence1Confidences: number[],
  evidence2Confidences: number[]
): number {
  const n = Math.min(evidence1Confidences.length, evidence2Confidences.length);
  if (n === 0) return 0;

  // Discretize confidences into bins
  const numBins = Math.min(10, Math.max(2, Math.floor(Math.sqrt(n))));

  // Build joint distribution
  const pXY: number[][] = Array.from({ length: numBins }, () =>
    new Array(numBins).fill(0)
  );

  for (let i = 0; i < n; i++) {
    const binX = Math.min(numBins - 1, Math.floor(evidence1Confidences[i] * numBins));
    const binY = Math.min(numBins - 1, Math.floor(evidence2Confidences[i] * numBins));
    pXY[binX][binY] += 1 / n;
  }

  // Compute mutual information
  const mi = mutualInformation(pXY);

  // Normalize by minimum entropy for redundancy measure
  const pX = pXY.map(row => row.reduce((a, b) => a + b, 0));
  const pY = new Array(numBins).fill(0);
  for (let i = 0; i < numBins; i++) {
    for (let j = 0; j < numBins; j++) {
      pY[j] += pXY[i][j];
    }
  }

  const hX = shannonEntropy(pX);
  const hY = shannonEntropy(pY);
  const minEntropy = Math.min(hX, hY);

  if (minEntropy < EPSILON) return 0;

  // Normalized mutual information (0 to 1)
  return Math.min(1, mi / minEntropy);
}

/**
 * Estimate query information value - how much uncertainty would be reduced
 * by answering a query.
 *
 * @param currentBeliefs - Current belief confidences keyed by claim ID
 * @param affectedClaims - Claim IDs that would be affected by the query
 * @param expectedConfidenceBoost - Expected confidence increase from the query
 * @returns Expected information gain in bits
 */
export function estimateQueryValue(
  currentBeliefs: Map<string, ConfidenceValue>,
  affectedClaims: string[],
  expectedConfidenceBoost: number = 0.2
): number {
  // Get current confidences for affected claims
  const beforeConfidences: ConfidenceValue[] = [];
  const afterConfidences: ConfidenceValue[] = [];

  for (const claimId of affectedClaims) {
    const current = currentBeliefs.get(claimId);
    if (current) {
      beforeConfidences.push(current);

      // Simulate improvement
      const currentValue = getNumericValue(current) ?? 0.5;
      const improvedValue = Math.min(1, currentValue + expectedConfidenceBoost);

      afterConfidences.push({
        type: 'derived',
        value: improvedValue,
        formula: 'query_value_estimate',
        inputs: [],
      });
    }
  }

  if (beforeConfidences.length === 0) return 0;

  const gain = calculateInformationGain(beforeConfidences, afterConfidences);
  return Math.max(0, gain.gain);
}
