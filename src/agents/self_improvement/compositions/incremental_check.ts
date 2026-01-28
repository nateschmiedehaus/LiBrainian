/**
 * @fileoverview Incremental Self-Check Composition (tc_self_check_incremental)
 *
 * Lightweight incremental check for CI/regular use.
 * Quick check after changes for immediate feedback.
 *
 * Based on self-improvement-primitives.md specification.
 *
 * Flow:
 * selfRefresh -> analyzeConsistency (changed only) -> compare with baseline
 */

import type { LibrarianStorage } from '../../../storage/types.js';
import type { ConfidenceValue } from '../types.js';
import { selfRefresh, type SelfRefreshResult } from '../self_refresh.js';
import { analyzeConsistency, type ConsistencyAnalysisResult, type Mismatch, type UntestedClaim, type PhantomClaim } from '../analyze_consistency.js';
import { verifyCalibration, type CalibrationVerificationResult } from '../verify_calibration.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * An issue detected during incremental check.
 */
export interface Issue {
  /** Unique identifier */
  id: string;
  /** Type of issue */
  type: 'consistency' | 'calibration' | 'architecture' | 'test_coverage';
  /** Severity of the issue */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Description of the issue */
  description: string;
  /** Location (file path or module) */
  location: string;
  /** When the issue was detected */
  detectedAt: Date;
  /** Whether this is a new issue (not in baseline) */
  isNew: boolean;
}

/**
 * Analysis result for changed areas.
 */
export interface AnalysisResult {
  /** Files that were analyzed */
  analyzedFiles: string[];
  /** Mismatches found in changed areas */
  mismatches: Mismatch[];
  /** Untested claims in changed areas */
  untestedClaims: UntestedClaim[];
  /** Phantom claims in changed areas */
  phantomClaims: PhantomClaim[];
  /** Overall score for changed areas (0-1) */
  changedAreaScore: number;
}

/**
 * Result of an incremental self-check operation.
 */
export interface IncrementalCheckResult {
  /** Self-refresh operation result */
  refreshResult: SelfRefreshResult;
  /** Analysis of changed areas */
  changedAreaAnalysis: AnalysisResult;
  /** New issues detected (not in previous check) */
  newIssues: Issue[];
  /** Issues that have been resolved since last check */
  resolvedIssues: Issue[];
  /** Change in health score from baseline (-1 to +1) */
  healthDelta: number;
  /** Current health status */
  status: 'healthy' | 'needs_attention' | 'degraded';
  /** Duration of the check in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
  /** Timestamp of the check */
  timestamp: Date;
  /** Calibration delta if checked */
  calibrationDelta?: number;
}

/**
 * Options for the incremental self-check operation.
 */
export interface IncrementalCheckOptions {
  /** Root directory of the codebase */
  rootDir: string;
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Git commit to compare against (e.g., "HEAD~1", "abc123") */
  sinceCommit?: string;
  /** Number of days to look back for changes */
  sinceDays?: number;
  /** Baseline issues to compare against (from previous check) */
  baselineIssues?: Issue[];
  /** Previous health score to compute delta */
  previousHealthScore?: number;
  /** Whether to also check calibration */
  checkCalibration?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Optional progress callback */
  onProgress?: (stage: string, progress: number) => void;
}

// ============================================================================
// ISSUE CONVERSION
// ============================================================================

/**
 * Convert consistency analysis results to issues.
 */
function consistencyToIssues(
  consistency: ConsistencyAnalysisResult,
  changedFiles: string[]
): Issue[] {
  const issues: Issue[] = [];
  const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));

  // Convert mismatches
  for (const mismatch of [...consistency.codeTestMismatches, ...consistency.codeDocMismatches]) {
    const isInChangedArea = changedSet.has(mismatch.location.toLowerCase()) ||
      changedFiles.some((f) => mismatch.location.toLowerCase().includes(f.toLowerCase()));

    issues.push({
      id: `mismatch-${mismatch.id}`,
      type: 'consistency',
      severity: mismatch.severity === 'error' ? 'high' : mismatch.severity === 'warning' ? 'medium' : 'low',
      description: `${mismatch.type}: ${mismatch.claimed} does not match ${mismatch.actual}`,
      location: mismatch.location,
      detectedAt: new Date(),
      isNew: isInChangedArea,
    });
  }

  // Convert untested claims
  for (const claim of consistency.untestedClaims) {
    const isInChangedArea = changedSet.has(claim.entityPath.toLowerCase()) ||
      changedFiles.some((f) => claim.entityPath.toLowerCase().includes(f.toLowerCase()));

    issues.push({
      id: `untested-${claim.entityId}`,
      type: 'test_coverage',
      severity: 'medium',
      description: `Untested claim: ${claim.claim}`,
      location: claim.entityPath,
      detectedAt: new Date(),
      isNew: isInChangedArea,
    });
  }

  // Convert phantom claims
  for (const phantom of consistency.phantomClaims) {
    const isInChangedArea = changedSet.has(phantom.claimedLocation.toLowerCase()) ||
      changedFiles.some((f) => phantom.claimedLocation.toLowerCase().includes(f.toLowerCase()));

    issues.push({
      id: `phantom-${phantom.claimedLocation.replace(/[^a-z0-9]/gi, '-')}`,
      type: 'consistency',
      severity: phantom.confidence > 0.7 ? 'high' : 'medium',
      description: `Phantom claim: ${phantom.claim}`,
      location: phantom.claimedLocation,
      detectedAt: new Date(),
      isNew: isInChangedArea,
    });
  }

  return issues;
}

/**
 * Compare current issues with baseline to find new and resolved issues.
 */
function compareWithBaseline(
  currentIssues: Issue[],
  baselineIssues: Issue[]
): { newIssues: Issue[]; resolvedIssues: Issue[] } {
  const baselineIds = new Set(baselineIssues.map((i) => i.id));
  const currentIds = new Set(currentIssues.map((i) => i.id));

  const newIssues = currentIssues.filter((i) => !baselineIds.has(i.id));
  const resolvedIssues = baselineIssues.filter((i) => !currentIds.has(i.id));

  // Mark new issues
  for (const issue of newIssues) {
    issue.isNew = true;
  }

  return { newIssues, resolvedIssues };
}

/**
 * Calculate health delta based on issues.
 */
function calculateHealthDelta(
  newIssues: Issue[],
  resolvedIssues: Issue[],
  previousHealthScore?: number,
  currentConsistencyScore?: number
): number {
  // If we have a previous score and current score, use direct comparison
  if (previousHealthScore !== undefined && currentConsistencyScore !== undefined) {
    return currentConsistencyScore - previousHealthScore;
  }

  // Otherwise, estimate based on issue counts
  const severityWeights = {
    critical: 0.2,
    high: 0.1,
    medium: 0.05,
    low: 0.02,
  };

  const newIssuesPenalty = newIssues.reduce((sum, i) => sum + severityWeights[i.severity], 0);
  const resolvedIssuesBonus = resolvedIssues.reduce((sum, i) => sum + severityWeights[i.severity], 0);

  return Math.max(-1, Math.min(1, resolvedIssuesBonus - newIssuesPenalty));
}

/**
 * Determine status based on health delta and issues.
 */
function determineStatus(
  healthDelta: number,
  newIssues: Issue[],
  consistencyScore: number
): 'healthy' | 'needs_attention' | 'degraded' {
  // Check for critical issues
  const hasCritical = newIssues.some((i) => i.severity === 'critical');
  const hasMultipleHigh = newIssues.filter((i) => i.severity === 'high').length >= 3;

  if (hasCritical || hasMultipleHigh) {
    return 'degraded';
  }

  if (healthDelta < -0.1 || consistencyScore < 0.6 || newIssues.length > 5) {
    return 'needs_attention';
  }

  return 'healthy';
}

// ============================================================================
// MAIN CHECK FUNCTION
// ============================================================================

/**
 * Perform an incremental self-check on the codebase.
 *
 * This composition orchestrates:
 * 1. selfRefresh - Detect and index changed files
 * 2. analyzeConsistency - Check consistency of changed areas
 * 3. (optional) verifyCalibration - Quick calibration check
 * 4. Compare with baseline - Find new/resolved issues
 *
 * This is designed for CI/CD pipelines or regular development use,
 * providing quick feedback without a full audit.
 *
 * @param options - Check configuration options
 * @returns Incremental check result with issues and health delta
 *
 * @example
 * ```typescript
 * // Check changes since last commit
 * const result = await incrementalSelfCheck({
 *   rootDir: '/path/to/repo',
 *   storage: myStorage,
 *   sinceCommit: 'HEAD~1',
 * });
 *
 * if (result.newIssues.length > 0) {
 *   console.log('New issues detected:', result.newIssues);
 * }
 *
 * // Check changes in last 7 days
 * const result = await incrementalSelfCheck({
 *   rootDir: '/path/to/repo',
 *   storage: myStorage,
 *   sinceDays: 7,
 * });
 * ```
 */
export async function incrementalSelfCheck(
  options: IncrementalCheckOptions
): Promise<IncrementalCheckResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const timestamp = new Date();

  const {
    rootDir,
    storage,
    sinceCommit,
    sinceDays,
    baselineIssues = [],
    previousHealthScore,
    checkCalibration = false,
    verbose = false,
    onProgress,
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for incrementalSelfCheck');
  }
  if (!storage) {
    throw new Error('storage is required for incrementalSelfCheck');
  }

  // Default to checking since HEAD~1 if no reference provided
  const effectiveSinceCommit = sinceCommit ?? (sinceDays ? undefined : 'HEAD~1');
  const effectiveSinceDays = sinceDays ?? (sinceCommit ? undefined : undefined);

  // Stage 1: Self-Refresh
  if (verbose) {
    console.log('[incrementalSelfCheck] Stage 1: Refresh');
  }
  onProgress?.('refresh', 0);

  let refreshResult: SelfRefreshResult;
  try {
    refreshResult = await selfRefresh({
      rootDir,
      storage,
      sinceCommit: effectiveSinceCommit,
      sinceDays: effectiveSinceDays,
      scope: 'changed_and_dependents',
      verbose,
    });
  } catch (error) {
    errors.push(`Self-refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    refreshResult = {
      changedFiles: [],
      updatedSymbols: 0,
      invalidatedClaims: 0,
      newDefeaters: 0,
      duration: 0,
      errors: [String(error)],
      changeSummary: { added: [], modified: [], deleted: [] },
    };
  }
  onProgress?.('refresh', 100);

  // Early return if no changes
  if (refreshResult.changedFiles.length === 0) {
    if (verbose) {
      console.log('[incrementalSelfCheck] No changes detected');
    }

    return {
      refreshResult,
      changedAreaAnalysis: {
        analyzedFiles: [],
        mismatches: [],
        untestedClaims: [],
        phantomClaims: [],
        changedAreaScore: 1,
      },
      newIssues: [],
      resolvedIssues: [],
      healthDelta: 0,
      status: 'healthy',
      duration: Date.now() - startTime,
      errors,
      timestamp,
    };
  }

  // Stage 2: Analyze Consistency
  if (verbose) {
    console.log('[incrementalSelfCheck] Stage 2: Consistency Analysis');
  }
  onProgress?.('analysis', 0);

  let consistencyAnalysis: ConsistencyAnalysisResult;
  try {
    consistencyAnalysis = await analyzeConsistency({
      rootDir,
      storage,
      verbose,
    });
  } catch (error) {
    errors.push(`Consistency analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    consistencyAnalysis = {
      codeTestMismatches: [],
      codeDocMismatches: [],
      unreferencedCode: [],
      staleDocs: [],
      overallScore: 0.5,
      phantomClaims: [],
      untestedClaims: [],
      docDrift: [],
      duration: 0,
      errors: [String(error)],
    };
  }
  onProgress?.('analysis', 50);

  // Stage 3: Optional Calibration Check
  let calibrationDelta: number | undefined;
  if (checkCalibration) {
    if (verbose) {
      console.log('[incrementalSelfCheck] Stage 3: Calibration Check');
    }

    try {
      const calibration = await verifyCalibration({
        storage,
        verbose,
      });
      // Use ECE as calibration metric (lower is better, so invert for delta)
      calibrationDelta = calibration.isWellCalibrated ? 0 : -calibration.ece;
    } catch (error) {
      errors.push(`Calibration check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  onProgress?.('analysis', 100);

  // Stage 4: Build Changed Area Analysis
  if (verbose) {
    console.log('[incrementalSelfCheck] Stage 4: Compare with Baseline');
  }
  onProgress?.('comparison', 0);

  // Filter consistency results to changed areas
  const changedFiles = refreshResult.changedFiles;
  const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));

  const changedAreaMismatches = [
    ...consistencyAnalysis.codeTestMismatches,
    ...consistencyAnalysis.codeDocMismatches,
  ].filter((m) =>
    changedSet.has(m.location.toLowerCase()) ||
    changedFiles.some((f) => m.location.toLowerCase().includes(f.toLowerCase()))
  );

  const changedAreaUntested = consistencyAnalysis.untestedClaims.filter((c) =>
    changedSet.has(c.entityPath.toLowerCase()) ||
    changedFiles.some((f) => c.entityPath.toLowerCase().includes(f.toLowerCase()))
  );

  const changedAreaPhantom = consistencyAnalysis.phantomClaims.filter((p) =>
    changedSet.has(p.claimedLocation.toLowerCase()) ||
    changedFiles.some((f) => p.claimedLocation.toLowerCase().includes(f.toLowerCase()))
  );

  // Calculate changed area score
  const totalIssuesInChanged = changedAreaMismatches.length + changedAreaUntested.length + changedAreaPhantom.length;
  const changedAreaScore = Math.max(0, 1 - (totalIssuesInChanged / Math.max(1, changedFiles.length) * 0.2));

  const changedAreaAnalysis: AnalysisResult = {
    analyzedFiles: changedFiles,
    mismatches: changedAreaMismatches,
    untestedClaims: changedAreaUntested,
    phantomClaims: changedAreaPhantom,
    changedAreaScore,
  };

  // Convert to issues and compare with baseline
  const currentIssues = consistencyToIssues(consistencyAnalysis, changedFiles);
  const { newIssues, resolvedIssues } = compareWithBaseline(currentIssues, baselineIssues);

  // Calculate health delta
  const healthDelta = calculateHealthDelta(
    newIssues,
    resolvedIssues,
    previousHealthScore,
    consistencyAnalysis.overallScore
  );

  // Determine status
  const status = determineStatus(healthDelta, newIssues, consistencyAnalysis.overallScore);

  onProgress?.('comparison', 100);

  const duration = Date.now() - startTime;

  if (verbose) {
    console.log(`[incrementalSelfCheck] Complete. Status: ${status}, New issues: ${newIssues.length}, Resolved: ${resolvedIssues.length}`);
  }

  return {
    refreshResult,
    changedAreaAnalysis,
    newIssues,
    resolvedIssues,
    healthDelta,
    status,
    duration,
    errors,
    timestamp,
    calibrationDelta,
  };
}
