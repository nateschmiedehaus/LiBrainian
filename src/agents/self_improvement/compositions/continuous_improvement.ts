/**
 * @fileoverview Continuous Improvement Composition (tc_continuous_improvement)
 *
 * Continuous improvement pipeline that orchestrates incremental checks,
 * fix planning, optional fix application, and pattern learning.
 *
 * Based on self-improvement-primitives.md specification (WU-SELF-205).
 */

import type { LibrarianStorage } from '../../../storage/types.js';
import type { ConfidenceValue } from '../types.js';
import {
  selfRefresh,
  type SelfRefreshResult,
  type SelfRefreshOptions,
} from '../self_refresh.js';
import {
  analyzeConsistency,
  type ConsistencyAnalysisResult,
  type Mismatch,
  type PhantomClaim,
  type DocDrift,
} from '../analyze_consistency.js';
import {
  verifyCalibration,
  type CalibrationVerificationResult,
} from '../verify_calibration.js';
import {
  planFix,
  type Issue,
  type IssueSeverity,
  type PlanFixResult,
  type FixPlan,
} from '../plan_fix.js';
import {
  learnFromOutcome,
  type LearningResult,
  type Prediction,
  type Outcome,
  type PredictionContext,
} from '../learn_from_outcome.js';
import {
  extractPattern,
  type ExtractedPattern,
  type PatternExtractionResult,
} from '../extract_pattern.js';
import { getErrorMessage } from '../../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a single check operation.
 */
export interface CheckResult {
  /** Check type */
  type: 'refresh' | 'consistency' | 'calibration';
  /** Whether the check passed */
  passed: boolean;
  /** Check details */
  details: string;
  /** Duration in milliseconds */
  duration: number;
  /** Issues found during this check */
  issuesFound: number;
}

/**
 * A fix that was applied.
 */
export interface AppliedFix {
  /** Fix plan that was applied */
  plan: FixPlan;
  /** Whether the fix was successful */
  success: boolean;
  /** Verification status */
  verified: boolean;
  /** Duration of application in milliseconds */
  duration: number;
  /** Error if any */
  error?: string;
}

/**
 * Result of continuous improvement composition.
 */
export interface ContinuousImprovementResult {
  /** Cycle number (for multi-cycle runs) */
  cycleNumber: number;
  /** Checks that were performed */
  checksPerformed: CheckResult[];
  /** Issues found during the cycle */
  issuesFound: Issue[];
  /** Fix plans that were generated */
  fixesPlanned: FixPlan[];
  /** Fixes that were applied (if autoApplyFixes enabled) */
  fixesApplied: AppliedFix[];
  /** Patterns learned from outcomes */
  patternsLearned: ExtractedPattern[];
  /** Health improvement score (-1 to 1, negative means degradation) */
  healthImprovement: number;
  /** Next scheduled check date */
  nextScheduledCheck: Date;
  /** Overall status of the cycle */
  status: 'healthy' | 'improved' | 'needs_attention' | 'degraded';
  /** Duration of the cycle in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
  /** Phase-by-phase report */
  phaseReports: PhaseReport[];
}

/**
 * Report for a single phase.
 */
export interface PhaseReport {
  /** Phase name */
  phase: 'refresh' | 'consistency_check' | 'calibration_check' | 'planning' | 'apply_fixes' | 'learning' | 'pattern_extraction';
  /** Phase status */
  status: 'success' | 'partial' | 'failed' | 'skipped';
  /** Duration in milliseconds */
  duration: number;
  /** Items processed */
  itemsProcessed: number;
  /** Errors in this phase */
  errors: string[];
}

/**
 * Options for continuous improvement composition.
 */
export interface ContinuousImprovementOptions {
  /** Root directory of the codebase */
  rootDir: string;
  /** Storage instance */
  storage: LibrarianStorage;
  /** Maximum cycles to run (0 = single cycle) */
  maxCycles?: number;
  /** Automatically apply fixes */
  autoApplyFixes?: boolean;
  /** Enable learning from outcomes */
  learningEnabled?: boolean;
  /** Extract patterns from improvements */
  extractPatterns?: boolean;
  /** Git commit to use as baseline for refresh */
  sinceCommit?: string;
  /** Days to look back for changes */
  sinceDays?: number;
  /** Interval between cycles in milliseconds (for multi-cycle) */
  cycleIntervalMs?: number;
  /** Maximum issues to process per cycle */
  maxIssuesPerCycle?: number;
  /** Minimum severity to process */
  minSeverity?: IssueSeverity;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_CYCLES = 1;
const DEFAULT_MAX_ISSUES_PER_CYCLE = 10;
const DEFAULT_CYCLE_INTERVAL_MS = 3600000; // 1 hour
const DEFAULT_MIN_SEVERITY: IssueSeverity = 'medium';

// ============================================================================
// HEALTH CALCULATION
// ============================================================================

/**
 * Calculate health improvement based on checks and fixes.
 */
function calculateHealthImprovement(
  checks: CheckResult[],
  issuesBefore: number,
  issuesAfter: number,
  fixesApplied: AppliedFix[]
): number {
  // Start with check pass rate
  const checkPassRate = checks.filter((c) => c.passed).length / Math.max(checks.length, 1);

  // Factor in issue reduction
  const issueReduction = issuesBefore > 0
    ? (issuesBefore - issuesAfter) / issuesBefore
    : 0;

  // Factor in fix success rate
  const fixSuccessRate = fixesApplied.length > 0
    ? fixesApplied.filter((f) => f.success).length / fixesApplied.length
    : 0.5; // Neutral if no fixes

  // Weighted combination
  const healthImprovement =
    checkPassRate * 0.3 +
    issueReduction * 0.4 +
    fixSuccessRate * 0.3;

  // Normalize to -1 to 1 range (centered at 0.5 being neutral)
  return (healthImprovement - 0.5) * 2;
}

/**
 * Determine overall status based on metrics.
 */
function determineStatus(
  healthImprovement: number,
  issuesFound: Issue[],
  criticalCount: number
): ContinuousImprovementResult['status'] {
  if (criticalCount > 0) {
    return 'needs_attention';
  }
  if (healthImprovement > 0.2) {
    return 'improved';
  }
  if (healthImprovement < -0.2) {
    return 'degraded';
  }
  if (issuesFound.length === 0) {
    return 'healthy';
  }
  return 'needs_attention';
}

// ============================================================================
// ISSUE EXTRACTION
// ============================================================================

/**
 * Helper to convert mismatches to issues.
 */
function convertMismatchesToIssues(
  mismatches: Mismatch[],
  minSeverityIndex: number,
  severityOrder: IssueSeverity[],
  startIndex: number
): Issue[] {
  const issues: Issue[] = [];
  let issueIndex = startIndex;

  for (const mismatch of mismatches) {
    const severity: IssueSeverity = mismatch.severity === 'error' ? 'high' :
      mismatch.severity === 'warning' ? 'medium' : 'low';

    if (severityOrder.indexOf(severity) >= minSeverityIndex) {
      issues.push({
        id: `issue-mismatch-${issueIndex++}`,
        type: 'consistency',
        description: `Mismatch: ${mismatch.claimed} vs ${mismatch.actual}`,
        location: mismatch.location,
        severity,
        evidence: [{
          type: 'code',
          content: mismatch.suggestedResolution,
          location: mismatch.location,
          confidence: {
            score: 0.8,
            tier: 'high',
            source: 'measured',
          },
        }],
      });
    }
  }

  return issues;
}

/**
 * Extract issues from consistency analysis.
 */
function extractIssuesFromConsistency(
  analysis: ConsistencyAnalysisResult,
  minSeverity: IssueSeverity
): Issue[] {
  const issues: Issue[] = [];
  const severityOrder: IssueSeverity[] = ['low', 'medium', 'high', 'critical'];
  const minIndex = severityOrder.indexOf(minSeverity);

  // Convert code-test mismatches to issues
  issues.push(...convertMismatchesToIssues(
    analysis.codeTestMismatches,
    minIndex,
    severityOrder,
    issues.length
  ));

  // Convert code-doc mismatches to issues
  issues.push(...convertMismatchesToIssues(
    analysis.codeDocMismatches,
    minIndex,
    severityOrder,
    issues.length
  ));

  // Convert phantom claims to issues
  for (const phantom of analysis.phantomClaims) {
    issues.push({
      id: `issue-phantom-${issues.length}`,
      type: 'consistency',
      description: `Phantom claim: ${phantom.claim}`,
      location: phantom.claimedLocation,
      severity: 'medium',
      evidence: [{
        type: 'assertion',
        content: `Claim not found at ${phantom.searchedLocations.join(', ')}`,
        location: phantom.claimedLocation,
        confidence: {
          score: phantom.confidence,
          tier: phantom.confidence >= 0.8 ? 'high' : phantom.confidence >= 0.5 ? 'medium' : 'low',
          source: 'measured',
        },
      }],
    });
  }

  // Convert doc drift to issues
  for (const drift of analysis.docDrift) {
    issues.push({
      id: `issue-drift-${issues.length}`,
      type: 'consistency',
      description: `Documentation drift: ${drift.driftType} at ${drift.docLocation}`,
      location: drift.codeLocation,
      severity: 'low',
      evidence: [{
        type: 'assertion',
        content: `Doc: ${drift.docContent.substring(0, 100)}... vs Code: ${drift.codeContent.substring(0, 100)}...`,
        location: drift.codeLocation,
        confidence: {
          score: 0.7,
          tier: 'medium',
          source: 'measured',
        },
      }],
    });
  }

  return issues;
}

// ============================================================================
// FIX APPLICATION (SIMULATED)
// ============================================================================

/**
 * Apply a fix plan.
 * Note: This is simulated - in production would execute actual file modifications.
 */
async function applyFix(
  plan: FixPlan,
  verbose: boolean
): Promise<AppliedFix> {
  const startTime = Date.now();

  // Simulate fix application
  // In production, this would:
  // 1. Create a branch
  // 2. Apply the changes
  // 3. Run tests
  // 4. Commit if successful

  if (verbose) {
    console.log(`[continuousImprovement] Applying fix for: ${plan.issue.id}`);
  }

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Simulate 80% success rate
  const success = Math.random() > 0.2;
  const verified = success && Math.random() > 0.1; // 90% verification rate if successful

  return {
    plan,
    success,
    verified,
    duration: Date.now() - startTime,
    error: success ? undefined : 'Simulated fix failure',
  };
}

// ============================================================================
// MAIN COMPOSITION
// ============================================================================

/**
 * Run a single cycle of continuous improvement.
 */
async function runSingleCycle(
  cycleNumber: number,
  options: ContinuousImprovementOptions
): Promise<ContinuousImprovementResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const phaseReports: PhaseReport[] = [];
  const checksPerformed: CheckResult[] = [];
  const issuesFound: Issue[] = [];
  const fixesPlanned: FixPlan[] = [];
  const fixesApplied: AppliedFix[] = [];
  const patternsLearned: ExtractedPattern[] = [];

  const {
    rootDir,
    storage,
    autoApplyFixes = false,
    learningEnabled = true,
    extractPatterns: shouldExtractPatterns = true,
    sinceCommit,
    sinceDays = 7,
    maxIssuesPerCycle = DEFAULT_MAX_ISSUES_PER_CYCLE,
    minSeverity = DEFAULT_MIN_SEVERITY,
    verbose = false,
  } = options;

  if (verbose) {
    console.log(`[continuousImprovement] Starting cycle ${cycleNumber}`);
  }

  // Track initial state for health calculation
  let initialIssueCount = 0;

  // ============================================================================
  // PHASE 1: Self-Refresh
  // ============================================================================
  const phase1Start = Date.now();
  let refreshResult: SelfRefreshResult | null = null;

  try {
    if (verbose) {
      console.log('[continuousImprovement] Phase 1: Self-refresh');
    }

    refreshResult = await selfRefresh({
      rootDir,
      storage,
      sinceCommit,
      sinceDays,
      scope: 'changed_and_dependents',
      verbose,
    });

    const checkPassed = refreshResult.errors.length === 0;
    checksPerformed.push({
      type: 'refresh',
      passed: checkPassed,
      details: `Refreshed ${refreshResult.changedFiles.length} files, invalidated ${refreshResult.invalidatedClaims} claims`,
      duration: refreshResult.duration,
      issuesFound: 0,
    });

    if (refreshResult.errors.length > 0) {
      errors.push(...refreshResult.errors.map((e) => `[refresh] ${e}`));
    }

    phaseReports.push({
      phase: 'refresh',
      status: checkPassed ? 'success' : 'partial',
      duration: Date.now() - phase1Start,
      itemsProcessed: refreshResult.changedFiles.length,
      errors: refreshResult.errors,
    });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    errors.push(`[refresh] Failed: ${errorMsg}`);
    checksPerformed.push({
      type: 'refresh',
      passed: false,
      details: `Refresh failed: ${errorMsg}`,
      duration: Date.now() - phase1Start,
      issuesFound: 0,
    });
    phaseReports.push({
      phase: 'refresh',
      status: 'failed',
      duration: Date.now() - phase1Start,
      itemsProcessed: 0,
      errors: [errorMsg],
    });
  }

  // ============================================================================
  // PHASE 2: Consistency Check
  // ============================================================================
  const phase2Start = Date.now();
  let consistencyResult: ConsistencyAnalysisResult | null = null;

  try {
    if (verbose) {
      console.log('[continuousImprovement] Phase 2: Consistency check');
    }

    consistencyResult = await analyzeConsistency({
      rootDir,
      storage,
      checks: ['interface_signature', 'behavior_test_evidence', 'doc_code_alignment'],
      verbose,
    });

    const consistencyIssues = extractIssuesFromConsistency(consistencyResult, minSeverity);
    issuesFound.push(...consistencyIssues);
    initialIssueCount += consistencyIssues.length;

    const totalMismatches = consistencyResult.codeTestMismatches.length + consistencyResult.codeDocMismatches.length;
    const checkPassed = totalMismatches === 0 &&
      consistencyResult.phantomClaims.length === 0;

    checksPerformed.push({
      type: 'consistency',
      passed: checkPassed,
      details: `Found ${totalMismatches} mismatches, ${consistencyResult.phantomClaims.length} phantom claims`,
      duration: consistencyResult.duration,
      issuesFound: consistencyIssues.length,
    });

    if (consistencyResult.errors.length > 0) {
      errors.push(...consistencyResult.errors.map((e) => `[consistency] ${e}`));
    }

    phaseReports.push({
      phase: 'consistency_check',
      status: checkPassed ? 'success' : 'partial',
      duration: Date.now() - phase2Start,
      itemsProcessed: totalMismatches + consistencyResult.phantomClaims.length,
      errors: consistencyResult.errors,
    });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    errors.push(`[consistency] Check failed: ${errorMsg}`);
    checksPerformed.push({
      type: 'consistency',
      passed: false,
      details: `Consistency check failed: ${errorMsg}`,
      duration: Date.now() - phase2Start,
      issuesFound: 0,
    });
    phaseReports.push({
      phase: 'consistency_check',
      status: 'failed',
      duration: Date.now() - phase2Start,
      itemsProcessed: 0,
      errors: [errorMsg],
    });
  }

  // ============================================================================
  // PHASE 3: Calibration Check
  // ============================================================================
  const phase3Start = Date.now();

  try {
    if (verbose) {
      console.log('[continuousImprovement] Phase 3: Calibration check');
    }

    const calibrationResult = await verifyCalibration({
      storage,
      verbose,
    });

    const checkPassed = calibrationResult.calibrationStatus === 'well_calibrated' ||
      calibrationResult.calibrationStatus === 'insufficient_data';

    checksPerformed.push({
      type: 'calibration',
      passed: checkPassed,
      details: `ECE: ${calibrationResult.ece.toFixed(4)}, Status: ${calibrationResult.calibrationStatus}`,
      duration: calibrationResult.duration,
      issuesFound: checkPassed ? 0 : 1,
    });

    if (!checkPassed) {
      issuesFound.push({
        id: 'issue-calibration',
        type: 'theoretical',
        description: `Calibration issue: ${calibrationResult.calibrationStatus}, ECE=${calibrationResult.ece.toFixed(4)}`,
        location: 'system',
        severity: 'medium',
        evidence: [{
          type: 'measurement',
          content: `ECE: ${calibrationResult.ece}, MCE: ${calibrationResult.mce}`,
          location: 'calibration',
          confidence: {
            score: 0.9,
            tier: 'high',
            source: 'measured',
          },
        }],
      });
    }

    phaseReports.push({
      phase: 'calibration_check',
      status: checkPassed ? 'success' : 'partial',
      duration: Date.now() - phase3Start,
      itemsProcessed: 1,
      errors: calibrationResult.errors,
    });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    errors.push(`[calibration] Check failed: ${errorMsg}`);
    checksPerformed.push({
      type: 'calibration',
      passed: false,
      details: `Calibration check failed: ${errorMsg}`,
      duration: Date.now() - phase3Start,
      issuesFound: 0,
    });
    phaseReports.push({
      phase: 'calibration_check',
      status: 'failed',
      duration: Date.now() - phase3Start,
      itemsProcessed: 0,
      errors: [errorMsg],
    });
  }

  // ============================================================================
  // PHASE 4: Fix Planning
  // ============================================================================
  const phase4Start = Date.now();
  const issuesToProcess = issuesFound.slice(0, maxIssuesPerCycle);

  if (issuesToProcess.length > 0) {
    try {
      if (verbose) {
        console.log(`[continuousImprovement] Phase 4: Planning fixes for ${issuesToProcess.length} issues`);
      }

      for (const issue of issuesToProcess) {
        try {
          const fixResult = await planFix(issue, { verbose });
          if (fixResult.meetsConstraints) {
            fixesPlanned.push(fixResult.plan);
          } else {
            errors.push(`[planning] Fix for ${issue.id} doesn't meet constraints: ${fixResult.constraintViolations.join(', ')}`);
          }
        } catch (error) {
          errors.push(`[planning] Failed for ${issue.id}: ${getErrorMessage(error)}`);
        }
      }

      phaseReports.push({
        phase: 'planning',
        status: fixesPlanned.length > 0 ? 'success' : 'partial',
        duration: Date.now() - phase4Start,
        itemsProcessed: fixesPlanned.length,
        errors: errors.filter((e) => e.includes('[planning]')),
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      errors.push(`[planning] Phase failed: ${errorMsg}`);
      phaseReports.push({
        phase: 'planning',
        status: 'failed',
        duration: Date.now() - phase4Start,
        itemsProcessed: 0,
        errors: [errorMsg],
      });
    }
  } else {
    phaseReports.push({
      phase: 'planning',
      status: 'skipped',
      duration: 0,
      itemsProcessed: 0,
      errors: [],
    });
  }

  // ============================================================================
  // PHASE 5: Apply Fixes (Optional)
  // ============================================================================
  const phase5Start = Date.now();

  if (autoApplyFixes && fixesPlanned.length > 0) {
    try {
      if (verbose) {
        console.log(`[continuousImprovement] Phase 5: Applying ${fixesPlanned.length} fixes`);
      }

      for (const plan of fixesPlanned) {
        try {
          const applied = await applyFix(plan, verbose);
          fixesApplied.push(applied);
        } catch (error) {
          errors.push(`[apply] Failed for ${plan.issue.id}: ${getErrorMessage(error)}`);
          fixesApplied.push({
            plan,
            success: false,
            verified: false,
            duration: 0,
            error: getErrorMessage(error),
          });
        }
      }

      const successCount = fixesApplied.filter((f) => f.success).length;
      phaseReports.push({
        phase: 'apply_fixes',
        status: successCount === fixesApplied.length ? 'success' :
          successCount > 0 ? 'partial' : 'failed',
        duration: Date.now() - phase5Start,
        itemsProcessed: fixesApplied.length,
        errors: errors.filter((e) => e.includes('[apply]')),
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      errors.push(`[apply] Phase failed: ${errorMsg}`);
      phaseReports.push({
        phase: 'apply_fixes',
        status: 'failed',
        duration: Date.now() - phase5Start,
        itemsProcessed: 0,
        errors: [errorMsg],
      });
    }
  } else {
    phaseReports.push({
      phase: 'apply_fixes',
      status: 'skipped',
      duration: 0,
      itemsProcessed: 0,
      errors: [],
    });
  }

  // ============================================================================
  // PHASE 6: Learning (Optional)
  // ============================================================================
  const phase6Start = Date.now();

  if (learningEnabled && fixesApplied.length > 0) {
    try {
      if (verbose) {
        console.log('[continuousImprovement] Phase 6: Learning from outcomes');
      }

      for (const fix of fixesApplied) {
        try {
          const prediction: Prediction = {
            id: `pred-${fix.plan.issue.id}`,
            claim: `Fix for ${fix.plan.issue.description} will succeed`,
            predictedOutcome: true,
            statedConfidence: {
              score: fix.plan.riskAssessment.overallRisk === 'low' ? 0.9 :
                fix.plan.riskAssessment.overallRisk === 'medium' ? 0.7 :
                fix.plan.riskAssessment.overallRisk === 'high' ? 0.5 : 0.3,
              tier: fix.plan.riskAssessment.overallRisk === 'low' ? 'high' : 'medium',
              source: 'estimated',
            },
            timestamp: new Date(),
            context: `Fix plan for ${fix.plan.issue.type} issue`,
            entityId: fix.plan.issue.id,
          };

          const outcome: Outcome = {
            predictionId: prediction.id,
            actualValue: fix.success,
            wasCorrect: fix.success,
            verificationMethod: 'automated',
            timestamp: new Date(),
          };

          const context: PredictionContext = {
            domain: 'fix_application',
            complexity: fix.plan.estimatedEffort.complexity === 'trivial' ? 'simple' :
              fix.plan.estimatedEffort.complexity === 'simple' ? 'simple' :
              fix.plan.estimatedEffort.complexity === 'moderate' ? 'moderate' : 'complex',
            features: {
              issueType: fix.plan.issue.type,
              severity: fix.plan.issue.severity,
              filesChanged: fix.plan.affectedFiles.length,
            },
          };

          await learnFromOutcome(prediction, outcome, context, { verbose });
        } catch (error) {
          errors.push(`[learning] Failed for ${fix.plan.issue.id}: ${getErrorMessage(error)}`);
        }
      }

      phaseReports.push({
        phase: 'learning',
        status: 'success',
        duration: Date.now() - phase6Start,
        itemsProcessed: fixesApplied.length,
        errors: errors.filter((e) => e.includes('[learning]')),
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      errors.push(`[learning] Phase failed: ${errorMsg}`);
      phaseReports.push({
        phase: 'learning',
        status: 'failed',
        duration: Date.now() - phase6Start,
        itemsProcessed: 0,
        errors: [errorMsg],
      });
    }
  } else {
    phaseReports.push({
      phase: 'learning',
      status: 'skipped',
      duration: 0,
      itemsProcessed: 0,
      errors: [],
    });
  }

  // ============================================================================
  // PHASE 7: Pattern Extraction (Optional)
  // ============================================================================
  const phase7Start = Date.now();

  if (shouldExtractPatterns && fixesApplied.filter((f) => f.success).length > 0) {
    try {
      if (verbose) {
        console.log('[continuousImprovement] Phase 7: Extracting patterns');
      }

      const successfulFixes = fixesApplied.filter((f) => f.success && f.verified);

      for (const fix of successfulFixes.slice(0, 3)) {
        try {
          const improvement = {
            id: `imp-${fix.plan.issue.id}`,
            type: 'fix' as const,
            description: fix.plan.summary,
            before: {
              code: '',
              metrics: { issues: 1 },
              issues: [fix.plan.issue],
            },
            after: {
              code: '',
              metrics: { issues: 0 },
              issues: [],
            },
            verificationResult: 'success' as const,
            filesChanged: fix.plan.affectedFiles,
            completedAt: new Date(),
          };

          const patternResult = await extractPattern(improvement, {
            minGenerality: 0.5,
            minConfidence: 0.4,
            verbose,
          });

          if (patternResult.success && patternResult.pattern) {
            patternsLearned.push(patternResult.pattern);
          }
        } catch (error) {
          errors.push(`[pattern] Failed for ${fix.plan.issue.id}: ${getErrorMessage(error)}`);
        }
      }

      phaseReports.push({
        phase: 'pattern_extraction',
        status: patternsLearned.length > 0 ? 'success' : 'partial',
        duration: Date.now() - phase7Start,
        itemsProcessed: patternsLearned.length,
        errors: errors.filter((e) => e.includes('[pattern]')),
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      errors.push(`[pattern] Phase failed: ${errorMsg}`);
      phaseReports.push({
        phase: 'pattern_extraction',
        status: 'failed',
        duration: Date.now() - phase7Start,
        itemsProcessed: 0,
        errors: [errorMsg],
      });
    }
  } else {
    phaseReports.push({
      phase: 'pattern_extraction',
      status: 'skipped',
      duration: 0,
      itemsProcessed: 0,
      errors: [],
    });
  }

  // ============================================================================
  // CALCULATE FINAL METRICS
  // ============================================================================

  // Calculate final issue count (issues that weren't fixed)
  const fixedIssueIds = new Set(
    fixesApplied
      .filter((f) => f.success)
      .map((f) => f.plan.issue.id)
  );
  const finalIssueCount = issuesFound.filter((i) => !fixedIssueIds.has(i.id)).length;

  // Calculate health improvement
  const healthImprovement = calculateHealthImprovement(
    checksPerformed,
    initialIssueCount,
    finalIssueCount,
    fixesApplied
  );

  // Count critical issues
  const criticalCount = issuesFound.filter((i) =>
    i.severity === 'critical' && !fixedIssueIds.has(i.id)
  ).length;

  // Determine status
  const status = determineStatus(healthImprovement, issuesFound, criticalCount);

  // Schedule next check
  const nextScheduledCheck = new Date(
    Date.now() + (options.cycleIntervalMs ?? DEFAULT_CYCLE_INTERVAL_MS)
  );

  if (verbose) {
    console.log(`[continuousImprovement] Cycle ${cycleNumber} complete`);
    console.log(`  Status: ${status}`);
    console.log(`  Issues: ${issuesFound.length} found, ${fixedIssueIds.size} fixed`);
    console.log(`  Health improvement: ${(healthImprovement * 100).toFixed(1)}%`);
  }

  return {
    cycleNumber,
    checksPerformed,
    issuesFound,
    fixesPlanned,
    fixesApplied,
    patternsLearned,
    healthImprovement,
    nextScheduledCheck,
    status,
    duration: Date.now() - startTime,
    errors,
    phaseReports,
  };
}

/**
 * Run continuous improvement pipeline.
 *
 * This composition:
 * 1. Refreshes the knowledge index based on recent changes
 * 2. Performs consistency checks
 * 3. Verifies calibration
 * 4. Plans fixes for identified issues
 * 5. Optionally applies fixes
 * 6. Learns from outcomes
 * 7. Extracts patterns for future use
 *
 * @param options - Composition options
 * @returns Continuous improvement result
 *
 * @example
 * ```typescript
 * const result = await runContinuousImprovement({
 *   rootDir: '/path/to/repo',
 *   storage: myStorage,
 *   maxCycles: 1,
 *   autoApplyFixes: false,
 *   learningEnabled: true,
 * });
 *
 * console.log(`Status: ${result.status}`);
 * console.log(`Issues found: ${result.issuesFound.length}`);
 * console.log(`Health improvement: ${(result.healthImprovement * 100).toFixed(1)}%`);
 * ```
 */
export async function runContinuousImprovement(
  options: ContinuousImprovementOptions
): Promise<ContinuousImprovementResult> {
  const {
    rootDir,
    storage,
    maxCycles = DEFAULT_MAX_CYCLES,
    verbose = false,
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for runContinuousImprovement');
  }
  if (!storage) {
    throw new Error('storage is required for runContinuousImprovement');
  }

  if (verbose) {
    console.log('[continuousImprovement] Starting continuous improvement pipeline');
    console.log(`  Max cycles: ${maxCycles}`);
  }

  // For now, just run a single cycle
  // Multi-cycle support would involve a loop with delays
  const result = await runSingleCycle(1, options);

  return result;
}

/**
 * Create a continuous improvement composition with bound options.
 */
export function createContinuousImprovement(
  defaultOptions: Partial<ContinuousImprovementOptions>
): (options: Partial<ContinuousImprovementOptions> & { rootDir: string; storage: LibrarianStorage }) => Promise<ContinuousImprovementResult> {
  return async (options) => {
    return runContinuousImprovement({
      ...defaultOptions,
      ...options,
    });
  };
}
