/**
 * @fileoverview Self-Healing Configuration System
 *
 * Automatically detects and fixes suboptimal configuration settings:
 * - Drift Detection: Identifies when codebase changes make config stale
 * - Staleness Checks: Tracks when knowledge/config becomes outdated
 * - Auto-Optimization: Adjusts config based on usage patterns
 *
 * Integrates with the homeostasis daemon for autonomous healing.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Severity of a configuration issue.
 */
export type ConfigIssueSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Category of configuration issue.
 */
export type ConfigIssueCategory =
  | 'drift'           // Codebase changed enough that config is stale
  | 'staleness'       // Config hasn't been updated in too long
  | 'performance'     // Config settings causing performance issues
  | 'resource'        // Resource limits too high or too low
  | 'compatibility'   // Config incompatible with current environment
  | 'optimization';   // Config can be improved based on usage

/**
 * A detected configuration issue.
 */
export interface ConfigIssue {
  /** Unique identifier for the issue */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description */
  description: string;
  /** Issue severity */
  severity: ConfigIssueSeverity;
  /** Issue category */
  category: ConfigIssueCategory;
  /** The config key affected */
  configKey: string;
  /** Current value */
  currentValue: unknown;
  /** Expected or recommended value */
  expectedValue?: unknown;
  /** Metric that triggered this issue */
  metric?: string;
  /** Current metric value */
  metricValue?: number;
  /** Threshold that was breached */
  threshold?: number;
  /** When the issue was detected */
  detectedAt: Date;
}

/**
 * A recommendation for configuration improvement.
 */
export interface ConfigRecommendation {
  /** Unique identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description */
  description: string;
  /** Priority (1 = highest) */
  priority: number;
  /** Estimated impact on performance/health */
  estimatedImpact: 'low' | 'medium' | 'high';
  /** Related issues this addresses */
  relatedIssues: string[];
  /** Suggested config changes */
  suggestedChanges: ConfigChange[];
  /** Reasoning behind the recommendation */
  reasoning: string;
}

/**
 * A specific configuration change.
 */
export interface ConfigChange {
  /** Config key to change */
  key: string;
  /** Current value */
  from: unknown;
  /** New value */
  to: unknown;
  /** Type of change */
  changeType: 'update' | 'add' | 'remove';
}

/**
 * An automatically fixable configuration issue.
 */
export interface ConfigFix {
  /** Unique identifier */
  id: string;
  /** The issue being fixed */
  issueId: string;
  /** Changes to apply */
  changes: ConfigChange[];
  /** Risk level of the fix */
  riskLevel: 'safe' | 'low' | 'medium' | 'high';
  /** Whether this requires confirmation */
  requiresConfirmation: boolean;
  /** Rollback procedure if fix fails */
  rollbackProcedure?: string;
}

/**
 * Health report for configuration.
 */
export interface ConfigHealthReport {
  /** Whether configuration is optimal */
  isOptimal: boolean;
  /** Health score (0-1) */
  healthScore: number;
  /** Detected issues */
  issues: ConfigIssue[];
  /** Recommendations for improvement */
  recommendations: ConfigRecommendation[];
  /** Auto-fixable issues */
  autoFixable: ConfigFix[];
  /** When the report was generated */
  generatedAt: Date;
  /** Workspace analyzed */
  workspace: string;
  /** Summary statistics */
  summary: {
    totalIssues: number;
    criticalIssues: number;
    autoFixableCount: number;
    driftScore: number;
    stalenessScore: number;
  };
}

/**
 * Result of healing operation.
 */
export interface HealingResult {
  /** Whether healing was successful */
  success: boolean;
  /** Fixes that were applied */
  appliedFixes: ConfigFix[];
  /** Fixes that failed */
  failedFixes: Array<{ fix: ConfigFix; error: string }>;
  /** New health score after healing */
  newHealthScore: number;
  /** Duration of healing in ms */
  durationMs: number;
  /** Timestamp */
  timestamp: Date;
  /** Rollback information if needed */
  rollbackAvailable: boolean;
}

/**
 * Configuration drift analysis.
 */
export interface DriftAnalysis {
  /** Overall drift score (0 = no drift, 1 = complete drift) */
  driftScore: number;
  /** Files changed since last config update */
  filesChanged: number;
  /** New files added */
  filesAdded: number;
  /** Files removed */
  filesRemoved: number;
  /** Significant structural changes */
  structuralChanges: string[];
  /** Recommended config updates */
  recommendedUpdates: ConfigChange[];
}

/**
 * Configuration staleness analysis.
 */
export interface StalenessAnalysis {
  /** Overall staleness score (0 = fresh, 1 = completely stale) */
  stalenessScore: number;
  /** Last config update time */
  lastConfigUpdate: Date | null;
  /** Time since last update in ms */
  timeSinceUpdate: number;
  /** Components that are stale */
  staleComponents: Array<{
    component: string;
    lastUpdated: Date | null;
    recommendedUpdateInterval: number;
    isStale: boolean;
  }>;
}

/**
 * Usage pattern analysis for optimization.
 */
export interface UsagePatternAnalysis {
  /** Most common query patterns */
  queryPatterns: Array<{
    pattern: string;
    frequency: number;
    averageLatency: number;
  }>;
  /** Resource utilization */
  resourceUtilization: {
    embeddingCallsPerHour: number;
    llmCallsPerHour: number;
    cacheHitRate: number;
    peakMemoryUsage: number;
  };
  /** Optimization opportunities */
  optimizationOpportunities: Array<{
    area: string;
    potentialImprovement: string;
    effort: 'low' | 'medium' | 'high';
  }>;
}

/**
 * Configuration effectiveness metrics over time.
 */
export interface ConfigEffectivenessMetrics {
  /** Metric name */
  metric: string;
  /** Time series of values */
  values: Array<{
    timestamp: Date;
    value: number;
  }>;
  /** Trend direction */
  trend: 'improving' | 'stable' | 'degrading';
  /** Average value */
  average: number;
  /** Standard deviation */
  stdDev: number;
}

/**
 * Tracked effectiveness over time.
 */
export interface ConfigEffectivenessHistory {
  /** Workspace */
  workspace: string;
  /** Metrics tracked */
  metrics: ConfigEffectivenessMetrics[];
  /** Config changes with their impact */
  configChanges: Array<{
    timestamp: Date;
    changes: ConfigChange[];
    impactMetrics: Record<string, number>;
  }>;
  /** Overall effectiveness trend */
  overallTrend: 'improving' | 'stable' | 'degrading';
}

// ============================================================================
// CONFIGURATION STATE
// ============================================================================

interface ConfigSnapshot {
  timestamp: Date;
  config: Record<string, unknown>;
  codebaseFingerprint: string;
}

interface EffectivenessRecord {
  timestamp: Date;
  healthScore: number;
  queryLatencyP50: number;
  cacheHitRate: number;
  confidenceMean: number;
}

// In-memory state (persisted to disk)
let lastConfigSnapshot: ConfigSnapshot | null = null;
let effectivenessHistory: EffectivenessRecord[] = [];
const MAX_EFFECTIVENESS_HISTORY = 1000;

// ============================================================================
// CONSTANTS
// ============================================================================

/** Drift detection thresholds */
const DRIFT_THRESHOLDS = {
  /** Files changed to trigger config review */
  fileChangeThreshold: 50,
  /** New files to trigger include pattern review */
  newFilesThreshold: 20,
  /** Structural changes to trigger full review */
  structuralChangeThreshold: 5,
};

/** Staleness thresholds */
const STALENESS_THRESHOLDS = {
  /** Config older than this is considered stale (24 hours) */
  maxConfigAgeMs: 24 * 60 * 60 * 1000,
  /** Knowledge older than this needs refresh (7 days) */
  maxKnowledgeAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Embeddings older than model version need refresh */
  embeddingRefreshInterval: 30 * 24 * 60 * 60 * 1000,
};

/** Performance thresholds for optimization */
const PERFORMANCE_THRESHOLDS = {
  /** Cache hit rate below this triggers optimization */
  minCacheHitRate: 0.7,
  /** Query latency above this triggers optimization */
  maxQueryLatencyP50: 500,
  /** Confidence below this triggers review */
  minConfidence: 0.6,
  /** Memory usage above this triggers config adjustment */
  maxMemoryUsageRatio: 0.8,
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Diagnose configuration health for a workspace.
 *
 * Performs comprehensive analysis including:
 * - Drift detection (codebase vs config alignment)
 * - Staleness checks (config and knowledge freshness)
 * - Performance analysis (resource utilization)
 * - Auto-optimization opportunities
 */
export async function diagnoseConfiguration(
  workspace: string
): Promise<ConfigHealthReport> {
  const startTime = Date.now();
  const issues: ConfigIssue[] = [];
  const recommendations: ConfigRecommendation[] = [];
  const autoFixable: ConfigFix[] = [];

  logInfo('[config-healing] Starting configuration diagnosis', { workspace });

  try {
    // Load current configuration
    const currentConfig = await loadWorkspaceConfig(workspace);

    // 1. Drift Detection
    const driftAnalysis = await analyzeDrift(workspace, currentConfig);
    const driftIssues = createDriftIssues(driftAnalysis);
    issues.push(...driftIssues);

    // 2. Staleness Checks
    const stalenessAnalysis = await analyzeStaleness(workspace, currentConfig);
    const stalenessIssues = createStalenessIssues(stalenessAnalysis);
    issues.push(...stalenessIssues);

    // 3. Performance Analysis
    const performanceIssues = await analyzePerformance(workspace, currentConfig);
    issues.push(...performanceIssues);

    // 4. Resource Analysis
    const resourceIssues = await analyzeResources(workspace, currentConfig);
    issues.push(...resourceIssues);

    // 5. Generate Recommendations
    const recs = generateRecommendations(issues, driftAnalysis, stalenessAnalysis);
    recommendations.push(...recs);

    // 6. Identify Auto-Fixable Issues
    const fixes = identifyAutoFixable(issues, recommendations);
    autoFixable.push(...fixes);

    // Calculate health score
    const healthScore = calculateHealthScore(issues);

    // Create summary
    const summary = {
      totalIssues: issues.length,
      criticalIssues: issues.filter(i => i.severity === 'critical').length,
      autoFixableCount: autoFixable.length,
      driftScore: driftAnalysis.driftScore,
      stalenessScore: stalenessAnalysis.stalenessScore,
    };

    const report: ConfigHealthReport = {
      isOptimal: healthScore >= 0.9 && issues.length === 0,
      healthScore,
      issues,
      recommendations,
      autoFixable,
      generatedAt: new Date(),
      workspace,
      summary,
    };

    logInfo('[config-healing] Configuration diagnosis complete', {
      workspace,
      healthScore,
      issueCount: issues.length,
      durationMs: Date.now() - startTime,
    });

    return report;

  } catch (error) {
    logError('[config-healing] Configuration diagnosis failed', {
      workspace,
      error: getErrorMessage(error),
    });

    // Return minimal report on error
    return {
      isOptimal: false,
      healthScore: 0,
      issues: [{
        id: 'diagnosis_error',
        title: 'Configuration diagnosis failed',
        description: getErrorMessage(error),
        severity: 'critical',
        category: 'compatibility',
        configKey: '*',
        currentValue: null,
        detectedAt: new Date(),
      }],
      recommendations: [],
      autoFixable: [],
      generatedAt: new Date(),
      workspace,
      summary: {
        totalIssues: 1,
        criticalIssues: 1,
        autoFixableCount: 0,
        driftScore: 1,
        stalenessScore: 1,
      },
    };
  }
}

/**
 * Automatically heal configuration issues.
 *
 * Applies safe, auto-fixable changes and tracks effectiveness.
 */
export async function autoHealConfiguration(
  workspace: string,
  options: {
    dryRun?: boolean;
    maxFixes?: number;
    riskTolerance?: 'safe' | 'low' | 'medium';
  } = {}
): Promise<HealingResult> {
  const startTime = Date.now();
  const {
    dryRun = false,
    maxFixes = 10,
    riskTolerance = 'low',
  } = options;

  logInfo('[config-healing] Starting auto-heal', {
    workspace,
    dryRun,
    maxFixes,
    riskTolerance,
  });

  const appliedFixes: ConfigFix[] = [];
  const failedFixes: Array<{ fix: ConfigFix; error: string }> = [];

  try {
    // Diagnose current state
    const report = await diagnoseConfiguration(workspace);
    const initialHealthScore = report.healthScore;

    // Filter fixes by risk tolerance
    const allowedRisks: Array<ConfigFix['riskLevel']> = ['safe'];
    if (riskTolerance === 'low') allowedRisks.push('low');
    if (riskTolerance === 'medium') allowedRisks.push('low', 'medium');

    const eligibleFixes = report.autoFixable
      .filter(fix => allowedRisks.includes(fix.riskLevel))
      .slice(0, maxFixes);

    if (dryRun) {
      logInfo('[config-healing] Dry run - no changes applied', {
        eligibleFixes: eligibleFixes.length,
      });

      return {
        success: true,
        appliedFixes: eligibleFixes,
        failedFixes: [],
        newHealthScore: initialHealthScore,
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
        rollbackAvailable: false,
      };
    }

    // Save snapshot for rollback
    const currentConfig = await loadWorkspaceConfig(workspace);
    await saveConfigSnapshot(workspace, currentConfig);

    // Apply fixes
    for (const fix of eligibleFixes) {
      try {
        await applyConfigFix(workspace, fix);
        appliedFixes.push(fix);

        logInfo('[config-healing] Applied fix', {
          fixId: fix.id,
          issueId: fix.issueId,
          changes: fix.changes.length,
        });
      } catch (error) {
        failedFixes.push({
          fix,
          error: getErrorMessage(error),
        });

        logWarning('[config-healing] Fix failed', {
          fixId: fix.id,
          error: getErrorMessage(error),
        });
      }
    }

    // Re-diagnose to get new health score
    const newReport = await diagnoseConfiguration(workspace);

    // Track effectiveness
    await trackEffectiveness(workspace, {
      timestamp: new Date(),
      healthScore: newReport.healthScore,
      queryLatencyP50: 0, // Would be populated from actual metrics
      cacheHitRate: 0,
      confidenceMean: 0,
    });

    const result: HealingResult = {
      success: failedFixes.length === 0,
      appliedFixes,
      failedFixes,
      newHealthScore: newReport.healthScore,
      durationMs: Date.now() - startTime,
      timestamp: new Date(),
      rollbackAvailable: appliedFixes.length > 0,
    };

    logInfo('[config-healing] Auto-heal complete', {
      workspace,
      appliedFixes: appliedFixes.length,
      failedFixes: failedFixes.length,
      healthScoreBefore: initialHealthScore,
      healthScoreAfter: newReport.healthScore,
    });

    return result;

  } catch (error) {
    logError('[config-healing] Auto-heal failed', {
      workspace,
      error: getErrorMessage(error),
    });

    return {
      success: false,
      appliedFixes,
      failedFixes,
      newHealthScore: 0,
      durationMs: Date.now() - startTime,
      timestamp: new Date(),
      rollbackAvailable: appliedFixes.length > 0,
    };
  }
}

/**
 * Rollback configuration to previous state.
 */
export async function rollbackConfiguration(
  workspace: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!lastConfigSnapshot) {
      return { success: false, error: 'No snapshot available for rollback' };
    }

    const configPath = getConfigPath(workspace);
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(lastConfigSnapshot.config, null, 2)
    );

    logInfo('[config-healing] Configuration rolled back', {
      workspace,
      snapshotTime: lastConfigSnapshot.timestamp.toISOString(),
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Analyze configuration drift.
 */
async function analyzeDrift(
  workspace: string,
  _currentConfig: Record<string, unknown>
): Promise<DriftAnalysis> {
  const recommendedUpdates: ConfigChange[] = [];
  const structuralChanges: string[] = [];

  // Check for codebase fingerprint changes
  const currentFingerprint = await computeCodebaseFingerprint(workspace);
  let filesChanged = 0;
  let filesAdded = 0;
  let filesRemoved = 0;

  if (lastConfigSnapshot) {
    // Compare fingerprints
    if (lastConfigSnapshot.codebaseFingerprint !== currentFingerprint) {
      // Estimate changes based on fingerprint difference
      // In a real implementation, this would do file-by-file comparison
      const timeDiff = Date.now() - lastConfigSnapshot.timestamp.getTime();
      const hoursSinceSnapshot = timeDiff / (1000 * 60 * 60);

      // Rough estimate: assume 5 files changed per hour of development
      filesChanged = Math.min(100, Math.floor(hoursSinceSnapshot * 5));

      if (filesChanged > DRIFT_THRESHOLDS.fileChangeThreshold) {
        structuralChanges.push(`${filesChanged} files modified since last config update`);
      }
    }
  }

  // Check for new directories
  const srcDir = path.join(workspace, 'src');
  if (fs.existsSync(srcDir)) {
    try {
      const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
      const newDirs = entries.filter(e => e.isDirectory()).length;

      // Check if include patterns cover all directories
      // (simplified - real implementation would compare with config)
      if (newDirs > 10) {
        structuralChanges.push(`${newDirs} source directories - verify include patterns`);
        recommendedUpdates.push({
          key: 'include',
          from: [],
          to: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
          changeType: 'update',
        });
      }
    } catch {
      // Directory read failed - not critical
    }
  }

  // Calculate drift score
  const driftScore = Math.min(1, (
    (filesChanged / DRIFT_THRESHOLDS.fileChangeThreshold) * 0.4 +
    (filesAdded / DRIFT_THRESHOLDS.newFilesThreshold) * 0.3 +
    (structuralChanges.length / DRIFT_THRESHOLDS.structuralChangeThreshold) * 0.3
  ));

  return {
    driftScore,
    filesChanged,
    filesAdded,
    filesRemoved,
    structuralChanges,
    recommendedUpdates,
  };
}

/**
 * Analyze configuration staleness.
 */
async function analyzeStaleness(
  workspace: string,
  _currentConfig: Record<string, unknown>
): Promise<StalenessAnalysis> {
  const staleComponents: StalenessAnalysis['staleComponents'] = [];
  let lastConfigUpdate: Date | null = null;

  // Check config file modification time
  const configPath = getConfigPath(workspace);
  try {
    const stats = await fs.promises.stat(configPath);
    lastConfigUpdate = stats.mtime;
  } catch {
    // Config file doesn't exist
  }

  // Check state directory for component timestamps
  const stateDir = path.join(workspace, 'state');
  const components = [
    { name: 'embeddings', file: 'embeddings.json', interval: STALENESS_THRESHOLDS.embeddingRefreshInterval },
    { name: 'knowledge', file: 'knowledge.json', interval: STALENESS_THRESHOLDS.maxKnowledgeAgeMs },
    { name: 'index', file: 'index.json', interval: STALENESS_THRESHOLDS.maxConfigAgeMs },
  ];

  for (const component of components) {
    const componentPath = path.join(stateDir, component.file);
    let componentUpdated: Date | null = null;

    try {
      const stats = await fs.promises.stat(componentPath);
      componentUpdated = stats.mtime;
    } catch {
      // Component doesn't exist
    }

    const timeSinceUpdate = componentUpdated
      ? Date.now() - componentUpdated.getTime()
      : Infinity;

    staleComponents.push({
      component: component.name,
      lastUpdated: componentUpdated,
      recommendedUpdateInterval: component.interval,
      isStale: timeSinceUpdate > component.interval,
    });
  }

  // Calculate staleness score
  const timeSinceUpdate = lastConfigUpdate
    ? Date.now() - lastConfigUpdate.getTime()
    : Infinity;

  const staleCount = staleComponents.filter(c => c.isStale).length;
  const stalenessScore = Math.min(1, (
    (timeSinceUpdate / STALENESS_THRESHOLDS.maxConfigAgeMs) * 0.5 +
    (staleCount / components.length) * 0.5
  ));

  return {
    stalenessScore,
    lastConfigUpdate,
    timeSinceUpdate,
    staleComponents,
  };
}

/**
 * Create issues from drift analysis.
 */
function createDriftIssues(analysis: DriftAnalysis): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (analysis.driftScore > 0.5) {
    issues.push({
      id: 'drift_high',
      title: 'Configuration drift detected',
      description: `Codebase has changed significantly since last config update. Drift score: ${(analysis.driftScore * 100).toFixed(0)}%`,
      severity: analysis.driftScore > 0.8 ? 'error' : 'warning',
      category: 'drift',
      configKey: 'include',
      currentValue: null,
      detectedAt: new Date(),
      metric: 'driftScore',
      metricValue: analysis.driftScore,
      threshold: 0.5,
    });
  }

  for (const change of analysis.structuralChanges) {
    issues.push({
      id: `drift_structural_${issues.length}`,
      title: 'Structural change detected',
      description: change,
      severity: 'info',
      category: 'drift',
      configKey: 'include',
      currentValue: null,
      detectedAt: new Date(),
    });
  }

  return issues;
}

/**
 * Create issues from staleness analysis.
 */
function createStalenessIssues(analysis: StalenessAnalysis): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (analysis.stalenessScore > 0.5) {
    issues.push({
      id: 'staleness_high',
      title: 'Configuration is stale',
      description: `Configuration hasn't been updated in a while. Staleness score: ${(analysis.stalenessScore * 100).toFixed(0)}%`,
      severity: analysis.stalenessScore > 0.8 ? 'warning' : 'info',
      category: 'staleness',
      configKey: '*',
      currentValue: analysis.lastConfigUpdate?.toISOString() ?? null,
      detectedAt: new Date(),
      metric: 'stalenessScore',
      metricValue: analysis.stalenessScore,
      threshold: 0.5,
    });
  }

  for (const component of analysis.staleComponents) {
    if (component.isStale) {
      issues.push({
        id: `staleness_${component.component}`,
        title: `${component.component} component is stale`,
        description: component.lastUpdated
          ? `Last updated: ${component.lastUpdated.toISOString()}`
          : 'Never updated',
        severity: 'info',
        category: 'staleness',
        configKey: component.component,
        currentValue: component.lastUpdated?.toISOString() ?? null,
        detectedAt: new Date(),
      });
    }
  }

  return issues;
}

/**
 * Analyze performance-related configuration issues.
 */
async function analyzePerformance(
  workspace: string,
  config: Record<string, unknown>
): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = [];

  // Check batch sizes
  const embeddingBatchSize = (config as { maxEmbeddingsPerBatch?: number }).maxEmbeddingsPerBatch ?? 20;
  if (embeddingBatchSize < 10) {
    issues.push({
      id: 'perf_batch_size_low',
      title: 'Embedding batch size is too low',
      description: 'Small batch sizes increase API call overhead',
      severity: 'warning',
      category: 'performance',
      configKey: 'maxEmbeddingsPerBatch',
      currentValue: embeddingBatchSize,
      expectedValue: 20,
      detectedAt: new Date(),
    });
  }

  // Check concurrency settings
  const maxWorkers = (config as { maxConcurrentWorkers?: number }).maxConcurrentWorkers ?? 4;
  const cpuCount = (await import('node:os')).cpus().length;

  if (maxWorkers > cpuCount * 2) {
    issues.push({
      id: 'perf_workers_high',
      title: 'Worker count exceeds recommended limit',
      description: `${maxWorkers} workers configured but only ${cpuCount} CPUs available`,
      severity: 'warning',
      category: 'performance',
      configKey: 'maxConcurrentWorkers',
      currentValue: maxWorkers,
      expectedValue: Math.min(cpuCount * 2, 8),
      detectedAt: new Date(),
    });
  }

  // Check timeout settings
  const timeoutMs = (config as { timeoutMs?: number }).timeoutMs;
  if (timeoutMs && timeoutMs < 30000) {
    issues.push({
      id: 'perf_timeout_short',
      title: 'Timeout setting may be too aggressive',
      description: 'Short timeouts can cause failures on large files',
      severity: 'info',
      category: 'performance',
      configKey: 'timeoutMs',
      currentValue: timeoutMs,
      expectedValue: 60000,
      detectedAt: new Date(),
    });
  }

  return issues;
}

/**
 * Analyze resource-related configuration issues.
 */
async function analyzeResources(
  workspace: string,
  config: Record<string, unknown>
): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = [];

  // Check file size limits
  const maxFileSize = (config as { maxFileSizeBytes?: number }).maxFileSizeBytes ?? 5 * 1024 * 1024;

  // Check if there are large files that might be missed
  const srcDir = path.join(workspace, 'src');
  if (fs.existsSync(srcDir)) {
    try {
      const files = await findLargeFiles(srcDir, maxFileSize);
      if (files.length > 0) {
        issues.push({
          id: 'resource_large_files',
          title: `${files.length} files exceed size limit`,
          description: 'Some source files are larger than the configured limit and will be skipped',
          severity: 'warning',
          category: 'resource',
          configKey: 'maxFileSizeBytes',
          currentValue: maxFileSize,
          expectedValue: Math.max(maxFileSize, 10 * 1024 * 1024),
          detectedAt: new Date(),
        });
      }
    } catch {
      // Skip if directory scanning fails
    }
  }

  // Check token budgets
  const maxTokensPerFile = (config as { maxTokensPerFile?: number }).maxTokensPerFile ?? 0;
  if (maxTokensPerFile > 0 && maxTokensPerFile < 1000) {
    issues.push({
      id: 'resource_token_limit',
      title: 'Token limit may be too restrictive',
      description: 'Very low token limits can result in incomplete analysis',
      severity: 'warning',
      category: 'resource',
      configKey: 'maxTokensPerFile',
      currentValue: maxTokensPerFile,
      expectedValue: 0,
      detectedAt: new Date(),
    });
  }

  return issues;
}

// ============================================================================
// RECOMMENDATION & FIX GENERATION
// ============================================================================

/**
 * Generate recommendations from issues and analysis.
 */
function generateRecommendations(
  issues: ConfigIssue[],
  driftAnalysis: DriftAnalysis,
  stalenessAnalysis: StalenessAnalysis
): ConfigRecommendation[] {
  const recommendations: ConfigRecommendation[] = [];

  // Drift-based recommendations
  if (driftAnalysis.driftScore > 0.5) {
    recommendations.push({
      id: 'rec_update_patterns',
      title: 'Update include/exclude patterns',
      description: 'Codebase structure has changed significantly since last config update',
      priority: 1,
      estimatedImpact: 'high',
      relatedIssues: issues.filter(i => i.category === 'drift').map(i => i.id),
      suggestedChanges: driftAnalysis.recommendedUpdates,
      reasoning: `Drift score of ${(driftAnalysis.driftScore * 100).toFixed(0)}% indicates config is out of sync with codebase`,
    });
  }

  // Staleness-based recommendations
  if (stalenessAnalysis.stalenessScore > 0.5) {
    const staleItems = stalenessAnalysis.staleComponents
      .filter(c => c.isStale)
      .map(c => c.component);

    recommendations.push({
      id: 'rec_refresh_stale',
      title: 'Refresh stale components',
      description: `The following components need refresh: ${staleItems.join(', ')}`,
      priority: 2,
      estimatedImpact: 'medium',
      relatedIssues: issues.filter(i => i.category === 'staleness').map(i => i.id),
      suggestedChanges: [],
      reasoning: `Staleness score of ${(stalenessAnalysis.stalenessScore * 100).toFixed(0)}% indicates knowledge may be outdated`,
    });
  }

  // Performance-based recommendations
  const perfIssues = issues.filter(i => i.category === 'performance');
  if (perfIssues.length > 0) {
    recommendations.push({
      id: 'rec_optimize_performance',
      title: 'Optimize performance settings',
      description: 'Several performance-related configuration issues detected',
      priority: 3,
      estimatedImpact: 'medium',
      relatedIssues: perfIssues.map(i => i.id),
      suggestedChanges: perfIssues
        .filter(i => i.expectedValue !== undefined)
        .map(i => ({
          key: i.configKey,
          from: i.currentValue,
          to: i.expectedValue,
          changeType: 'update' as const,
        })),
      reasoning: 'Performance settings can be improved for better efficiency',
    });
  }

  return recommendations;
}

/**
 * Identify which issues can be automatically fixed.
 */
function identifyAutoFixable(
  issues: ConfigIssue[],
  recommendations: ConfigRecommendation[]
): ConfigFix[] {
  const fixes: ConfigFix[] = [];

  // Safe fixes: low severity, clear expected value
  for (const issue of issues) {
    if (issue.severity === 'info' && issue.expectedValue !== undefined) {
      fixes.push({
        id: `fix_${issue.id}`,
        issueId: issue.id,
        changes: [{
          key: issue.configKey,
          from: issue.currentValue,
          to: issue.expectedValue,
          changeType: 'update',
        }],
        riskLevel: 'safe',
        requiresConfirmation: false,
      });
    }
  }

  // Low-risk fixes: warning severity, numeric adjustments
  for (const issue of issues) {
    if (
      issue.severity === 'warning' &&
      issue.expectedValue !== undefined &&
      typeof issue.currentValue === 'number' &&
      typeof issue.expectedValue === 'number'
    ) {
      const changeRatio = Math.abs(
        (issue.expectedValue - issue.currentValue) / issue.currentValue
      );

      // Only auto-fix if change is less than 100%
      if (changeRatio <= 1) {
        fixes.push({
          id: `fix_${issue.id}`,
          issueId: issue.id,
          changes: [{
            key: issue.configKey,
            from: issue.currentValue,
            to: issue.expectedValue,
            changeType: 'update',
          }],
          riskLevel: 'low',
          requiresConfirmation: false,
          rollbackProcedure: `Restore ${issue.configKey} to ${issue.currentValue}`,
        });
      }
    }
  }

  return fixes;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Load workspace configuration.
 */
async function loadWorkspaceConfig(
  workspace: string
): Promise<Record<string, unknown>> {
  const configPath = getConfigPath(workspace);

  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // Return default config if file doesn't exist
    return {};
  }
}

/**
 * Get configuration file path.
 */
function getConfigPath(workspace: string): string {
  return path.join(workspace, '.librainian', 'config.json');
}

/**
 * Compute a fingerprint of the codebase for drift detection.
 */
async function computeCodebaseFingerprint(workspace: string): Promise<string> {
  // Simple fingerprint based on file count and directory structure
  const srcDir = path.join(workspace, 'src');

  if (!fs.existsSync(srcDir)) {
    return 'no-src-dir';
  }

  try {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    const dirCount = entries.filter(e => e.isDirectory()).length;
    const fileCount = entries.filter(e => e.isFile()).length;

    return `dirs:${dirCount}:files:${fileCount}:time:${Date.now()}`;
  } catch {
    return 'error';
  }
}

/**
 * Save configuration snapshot for rollback.
 */
async function saveConfigSnapshot(
  workspace: string,
  config: Record<string, unknown>
): Promise<void> {
  lastConfigSnapshot = {
    timestamp: new Date(),
    config,
    codebaseFingerprint: await computeCodebaseFingerprint(workspace),
  };

  // Also persist to disk
  const snapshotPath = path.join(workspace, '.librainian', 'config-snapshot.json');

  try {
    const dir = path.dirname(snapshotPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(
      snapshotPath,
      JSON.stringify(lastConfigSnapshot, null, 2)
    );
  } catch {
    // Non-fatal - in-memory snapshot is still available
  }
}

/**
 * Apply a configuration fix.
 */
async function applyConfigFix(
  workspace: string,
  fix: ConfigFix
): Promise<void> {
  const config = await loadWorkspaceConfig(workspace);

  for (const change of fix.changes) {
    if (change.changeType === 'remove') {
      delete config[change.key];
    } else {
      config[change.key] = change.to;
    }
  }

  const configPath = getConfigPath(workspace);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Find files larger than a given size.
 */
async function findLargeFiles(
  directory: string,
  maxSize: number
): Promise<string[]> {
  const largeFiles: string[] = [];

  async function scan(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scan(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.promises.stat(fullPath);
          if (stats.size > maxSize) {
            largeFiles.push(fullPath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  await scan(directory);
  return largeFiles;
}

/**
 * Calculate health score from issues.
 */
function calculateHealthScore(issues: ConfigIssue[]): number {
  if (issues.length === 0) return 1;

  let score = 1;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical':
        score -= 0.3;
        break;
      case 'error':
        score -= 0.2;
        break;
      case 'warning':
        score -= 0.1;
        break;
      case 'info':
        score -= 0.02;
        break;
    }
  }

  return Math.max(0, score);
}

/**
 * Track configuration effectiveness over time.
 */
async function trackEffectiveness(
  workspace: string,
  record: EffectivenessRecord
): Promise<void> {
  effectivenessHistory.push(record);

  // Trim history if too large
  if (effectivenessHistory.length > MAX_EFFECTIVENESS_HISTORY) {
    effectivenessHistory = effectivenessHistory.slice(-MAX_EFFECTIVENESS_HISTORY);
  }

  // Persist to disk
  const historyPath = path.join(workspace, '.librainian', 'config-effectiveness.json');

  try {
    const dir = path.dirname(historyPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(
      historyPath,
      JSON.stringify(effectivenessHistory, null, 2)
    );
  } catch {
    // Non-fatal
  }
}

/**
 * Get configuration effectiveness history.
 */
export async function getEffectivenessHistory(
  workspace: string
): Promise<ConfigEffectivenessHistory> {
  // Load from disk if available
  const historyPath = path.join(workspace, '.librainian', 'config-effectiveness.json');

  try {
    const content = await fs.promises.readFile(historyPath, 'utf-8');
    effectivenessHistory = JSON.parse(content);
  } catch {
    // Use in-memory history
  }

  // Build metrics from history
  const metrics: ConfigEffectivenessMetrics[] = [];

  if (effectivenessHistory.length > 0) {
    // Health score metric
    const healthValues = effectivenessHistory.map(r => ({
      timestamp: new Date(r.timestamp),
      value: r.healthScore,
    }));

    const avgHealth = healthValues.reduce((sum, v) => sum + v.value, 0) / healthValues.length;
    const healthTrend = calculateTrend(healthValues.map(v => v.value));

    metrics.push({
      metric: 'healthScore',
      values: healthValues,
      trend: healthTrend,
      average: avgHealth,
      stdDev: calculateStdDev(healthValues.map(v => v.value)),
    });
  }

  // Calculate overall trend
  const overallTrend = metrics.length > 0
    ? metrics[0].trend
    : 'stable';

  return {
    workspace,
    metrics,
    configChanges: [],
    overallTrend,
  };
}

/**
 * Calculate trend from values.
 */
function calculateTrend(
  values: number[]
): 'improving' | 'stable' | 'degrading' {
  if (values.length < 2) return 'stable';

  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const diff = secondAvg - firstAvg;

  if (diff > 0.05) return 'improving';
  if (diff < -0.05) return 'degrading';
  return 'stable';
}

/**
 * Calculate standard deviation.
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;

  return Math.sqrt(avgSquareDiff);
}

// ============================================================================
// INTEGRATION WITH HOMEOSTASIS
// ============================================================================

/**
 * Create a config healing trigger for the homeostasis daemon.
 *
 * This integrates config healing into the MAPE-K loop.
 */
export function createConfigHealingTrigger(
  workspace: string,
  options: {
    checkIntervalMs?: number;
    autoHealThreshold?: number;
    riskTolerance?: 'safe' | 'low' | 'medium';
  } = {}
): {
  start: () => void;
  stop: () => void;
  triggerCheck: () => Promise<ConfigHealthReport>;
} {
  const {
    checkIntervalMs = 60 * 60 * 1000, // 1 hour default
    autoHealThreshold = 0.7,
    riskTolerance = 'low',
  } = options;

  let intervalId: NodeJS.Timeout | null = null;

  const triggerCheck = async (): Promise<ConfigHealthReport> => {
    const report = await diagnoseConfiguration(workspace);

    // Auto-heal if below threshold
    if (report.healthScore < autoHealThreshold && report.autoFixable.length > 0) {
      logInfo('[config-healing] Auto-healing triggered by low health score', {
        healthScore: report.healthScore,
        threshold: autoHealThreshold,
        autoFixableCount: report.autoFixable.length,
      });

      await autoHealConfiguration(workspace, {
        riskTolerance,
      });
    }

    return report;
  };

  return {
    start: () => {
      if (intervalId) return;

      // Initial check
      void triggerCheck();

      // Periodic checks
      intervalId = setInterval(() => {
        void triggerCheck();
      }, checkIntervalMs);

      logInfo('[config-healing] Config healing trigger started', {
        checkIntervalMs,
        autoHealThreshold,
      });
    },

    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;

        logInfo('[config-healing] Config healing trigger stopped');
      }
    },

    triggerCheck,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DRIFT_THRESHOLDS,
  STALENESS_THRESHOLDS,
  PERFORMANCE_THRESHOLDS,
};
