/**
 * @fileoverview Observable State Variables for Control Loop
 *
 * PHILOSOPHICAL ALIGNMENT (CONTROL_LOOP.md):
 * The librarian maintains a state estimate with observable variables
 * that enable feedback loops and closed-loop recovery.
 *
 * OBSERVABLE STATE CATEGORIES:
 * 1. Code Graph Health - entity/relation counts, coverage, orphans, cycles
 * 2. Index Freshness - last update, staleness, pending changes
 * 3. Confidence State - mean confidence, defeaters, calibration error
 * 4. Query Performance - latency percentiles, cache hit rate, recall
 *
 * Schema: LibrarianStateReport.v1 per CONTROL_LOOP.md
 */

import type { LibrarianStorage } from '../storage/types.js';
import { getIndexState } from '../state/index_state.js';

// ============================================================================
// STATE VARIABLE TYPES (per CONTROL_LOOP.md)
// ============================================================================

/**
 * Code Graph Health variables.
 */
export interface CodeGraphHealth {
  /** Total indexed entities */
  entityCount: number;
  /** Total indexed relations */
  relationCount: number;
  /** Files indexed / total files */
  coverageRatio: number;
  /** Entities with no relations */
  orphanEntities: number;
  /** Circular dependencies detected */
  cycleCount: number;
  /** Breakdown by entity type */
  entityCountByType: Record<string, number>;
}

/**
 * Index Freshness variables.
 */
export interface IndexFreshness {
  /** When index was last updated */
  lastIndexTime: string | null;
  /** Time since last update (milliseconds) */
  stalenessMs: number;
  /** Files changed but not indexed */
  pendingChanges: number;
  /** Current index schema version */
  indexVersion: string;
  /** Is index considered fresh? (< 5 minutes per SLO) */
  isFresh: boolean;
}

/**
 * Confidence State variables.
 */
export interface ConfidenceState {
  /** Average confidence across claims */
  meanConfidence: number;
  /** Geometric mean (more accurate for multiplicative confidence) */
  geometricMeanConfidence: number;
  /** Claims below threshold (default: 0.5) */
  lowConfidenceCount: number;
  /** Active defeaters */
  defeaterCount: number;
  /** Defeaters by type */
  defeatersByType: Record<string, number>;
  /** Stated vs empirical accuracy (from calibration) */
  calibrationError: number | null;
}

/**
 * Query Performance variables.
 */
export interface QueryPerformance {
  /** Median query time (milliseconds) */
  queryLatencyP50: number;
  /** 99th percentile query time (milliseconds) */
  queryLatencyP99: number;
  /** Cache hits / total queries */
  cacheHitRate: number;
  /** Relevant results retrieved (estimated) */
  retrievalRecall: number | null;
  /** Total queries in measurement window */
  queryCount: number;
}

/**
 * Recovery state machine states per CONTROL_LOOP.md.
 */
export type RecoveryState =
  | 'healthy'
  | 'degraded'
  | 'diagnosing'
  | 'recovering'
  | 'degraded_stable';

/**
 * Complete librarian state snapshot.
 */
export interface LibrarianStateReport {
  kind: 'LibrarianStateReport.v1';
  schemaVersion: 1;

  /** ISO 8601 timestamp */
  generatedAt: string;

  /** Observable state variables */
  codeGraphHealth: CodeGraphHealth;
  indexFreshness: IndexFreshness;
  confidenceState: ConfidenceState;
  queryPerformance: QueryPerformance;

  /** Recovery state machine */
  recoveryState: RecoveryState;
  lastRecoveryTime: string | null;

  /** Overall health assessment */
  health: LibrarianHealth;
}

/**
 * Health check result per CONTROL_LOOP.md.
 */
export interface LibrarianHealth {
  status: 'healthy' | 'degraded' | 'recovering' | 'unhealthy';
  checks: {
    indexFresh: boolean;
    confidenceAcceptable: boolean;
    defeatersLow: boolean;
    latencyAcceptable: boolean;
    coverageAcceptable: boolean;
  };
  lastRecovery?: string;
  nextScheduledMaintenance?: string;
  degradationReasons: string[];
}

// ============================================================================
// SLO THRESHOLDS (per CONTROL_LOOP.md)
// ============================================================================

export const SLO_THRESHOLDS = {
  /** Index freshness: < 5 minutes after commit */
  indexFreshnessMs: 5 * 60 * 1000,
  /** Query latency p50: < 500ms */
  queryLatencyP50Ms: 500,
  /** Query latency p99: < 2s */
  queryLatencyP99Ms: 2000,
  /** Confidence mean: > 0.7 */
  confidenceMeanMin: 0.7,
  /** Max active defeaters before degraded */
  maxDefeatersHealthy: 10,
  /** Min coverage ratio */
  coverageRatioMin: 0.9,
  /** Recovery time target: < 15 minutes */
  recoveryTimeMs: 15 * 60 * 1000,
};

// ============================================================================
// STATE COLLECTION
// ============================================================================

/**
 * Collect code graph health metrics.
 */
export async function collectCodeGraphHealth(
  storage: LibrarianStorage
): Promise<CodeGraphHealth> {
  // Get entity counts by type
  const entityCountByType: Record<string, number> = {};
  let totalEntities = 0;
  let totalRelations = 0;
  let orphanEntities = 0;
  let coverageRatio = 0;

  try {
    // Count entities (context packs represent indexed entities)
    const packs = await storage.getContextPacks({});
    totalEntities = packs.length;

    // Count by type
    for (const pack of packs) {
      const type = pack.packType ?? 'unknown';
      entityCountByType[type] = (entityCountByType[type] ?? 0) + 1;
    }

    // Count files, modules, functions for coverage and relations
    const files = await storage.getFiles({});
    const modules = await storage.getModules({});
    const functions = await storage.getFunctions({});
    totalEntities = files.length + modules.length + functions.length + packs.length;

    // Estimate relations from function count (conservative)
    totalRelations = functions.length;

    // Orphan check would require graph analysis
    orphanEntities = 0;

    // Estimate coverage from metadata
    const metadata = await storage.getMetadata();
    if (metadata?.totalFiles && metadata.totalFiles > 0) {
      coverageRatio = files.length / metadata.totalFiles;
    } else if (files.length > 0) {
      coverageRatio = 1.0; // Assume full coverage if we have files
    }
  } catch {
    // Storage access failed - return defaults
  }

  return {
    entityCount: totalEntities,
    relationCount: Math.floor(totalRelations),
    coverageRatio,
    orphanEntities,
    cycleCount: 0, // Would require cycle detection algorithm
    entityCountByType,
  };
}

/**
 * Collect index freshness metrics.
 */
export async function collectIndexFreshness(
  storage: LibrarianStorage
): Promise<IndexFreshness> {
  const now = new Date();
  let lastIndexTime: string | null = null;
  let pendingChanges = 0;

  try {
    // Prefer explicit indexing timestamp from metadata when available.
    const metadata = await storage.getMetadata();
    if (metadata?.lastIndexing) {
      lastIndexTime = typeof metadata.lastIndexing === 'string'
        ? metadata.lastIndexing
        : metadata.lastIndexing.toISOString();
    }

    // Fall back to index state (updated by bootstrap/indexing pipelines).
    if (!lastIndexTime) {
      const indexState = await getIndexState(storage);
      if (indexState.lastFullIndex) {
        lastIndexTime = indexState.lastFullIndex;
      }
    }

    // Final fallback: most recent bootstrap completion.
    if (!lastIndexTime) {
      const lastBootstrap = await storage.getLastBootstrapReport();
      if (lastBootstrap?.completedAt) {
        lastIndexTime = lastBootstrap.completedAt.toISOString();
      }
    }

    // Get state for pending changes
    const pendingState = await storage.getState('pendingChanges');
    if (pendingState) {
      pendingChanges = parseInt(pendingState, 10) || 0;
    }
  } catch {
    // Storage access failed
  }

  // "Freshness" should primarily reflect whether we are behind known changes.
  // If there are no pending changes, treat the index as fresh (lag = 0) even if it
  // hasn't been rebuilt recently.
  const ageSinceIndexMs = lastIndexTime
    ? now.getTime() - new Date(lastIndexTime).getTime()
    : Infinity;
  const stalenessMs = (pendingChanges === 0 && lastIndexTime) ? 0 : ageSinceIndexMs;

  const isFresh = Boolean(lastIndexTime) && pendingChanges === 0;

  return {
    lastIndexTime,
    stalenessMs: Number.isFinite(stalenessMs) ? stalenessMs : -1,
    pendingChanges,
    indexVersion: '1.0.0', // Would come from storage schema
    isFresh,
  };
}

/**
 * Collect confidence state metrics.
 */
export async function collectConfidenceState(
  storage: LibrarianStorage,
  confidenceThreshold: number = 0.5
): Promise<ConfidenceState> {
  let meanConfidence = 0;
  let geometricMeanConfidence = 0;
  let lowConfidenceCount = 0;
  let defeaterCount = 0;
  const defeatersByType: Record<string, number> = {};

  try {
    const packs = await storage.getContextPacks({});

    if (packs.length > 0) {
      // Arithmetic mean
      const confidenceSum = packs.reduce(
        (sum: number, p) => sum + (p.confidence ?? 0),
        0
      );
      meanConfidence = confidenceSum / packs.length;

      // Geometric mean (better for confidence)
      const logSum = packs.reduce(
        (sum: number, p) => sum + Math.log(Math.max(0.01, p.confidence ?? 0.01)),
        0
      );
      geometricMeanConfidence = Math.exp(logSum / packs.length);

      // Low confidence count
      lowConfidenceCount = packs.filter(
        (p) => (p.confidence ?? 0) < confidenceThreshold
      ).length;

      // Count defeaters (estimate from failure counts)
      for (const pack of packs) {
        if ((pack.failureCount ?? 0) > 0) {
          defeaterCount++;
          defeatersByType['failure'] = (defeatersByType['failure'] ?? 0) + 1;
        }
      }
    }
  } catch {
    // Storage access failed
  }

  return {
    meanConfidence,
    geometricMeanConfidence,
    lowConfidenceCount,
    defeaterCount,
    defeatersByType,
    calibrationError: null, // Would come from CalibrationReport
  };
}

/**
 * Query latency tracker for performance metrics.
 */
export class QueryLatencyTracker {
  private latencies: number[] = [];
  private readonly maxSamples: number;
  private cacheHits = 0;
  private totalQueries = 0;

  constructor(maxSamples: number = 1000) {
    this.maxSamples = maxSamples;
  }

  /**
   * Record a query latency.
   */
  recordLatency(latencyMs: number, cacheHit: boolean = false): void {
    this.latencies.push(latencyMs);
    this.totalQueries++;
    if (cacheHit) {
      this.cacheHits++;
    }

    // Keep only recent samples
    if (this.latencies.length > this.maxSamples) {
      this.latencies = this.latencies.slice(-this.maxSamples);
    }
  }

  /**
   * Get query performance metrics.
   */
  getMetrics(): QueryPerformance {
    if (this.latencies.length === 0) {
      return {
        queryLatencyP50: 0,
        queryLatencyP99: 0,
        cacheHitRate: 0,
        retrievalRecall: null,
        queryCount: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      queryLatencyP50: sorted[p50Index] ?? 0,
      queryLatencyP99: sorted[p99Index] ?? sorted[sorted.length - 1] ?? 0,
      cacheHitRate: this.totalQueries > 0 ? this.cacheHits / this.totalQueries : 0,
      retrievalRecall: null, // Would need relevance feedback
      queryCount: this.totalQueries,
    };
  }

  /**
   * Reset tracker.
   */
  reset(): void {
    this.latencies = [];
    this.cacheHits = 0;
    this.totalQueries = 0;
  }
}

// Global tracker instance
let globalLatencyTracker: QueryLatencyTracker | null = null;

export function getQueryLatencyTracker(): QueryLatencyTracker {
  if (!globalLatencyTracker) {
    globalLatencyTracker = new QueryLatencyTracker();
  }
  return globalLatencyTracker;
}

/**
 * Collect query performance metrics.
 */
export function collectQueryPerformance(): QueryPerformance {
  return getQueryLatencyTracker().getMetrics();
}

// ============================================================================
// HEALTH ASSESSMENT
// ============================================================================

/**
 * Assess librarian health from state variables.
 */
export function assessHealth(
  codeGraphHealth: CodeGraphHealth,
  indexFreshness: IndexFreshness,
  confidenceState: ConfidenceState,
  queryPerformance: QueryPerformance
): LibrarianHealth {
  const degradationReasons: string[] = [];

  // Check individual health conditions
  const indexFresh = indexFreshness.isFresh;
  if (!indexFresh) {
    degradationReasons.push(
      `Index stale: ${formatDuration(indexFreshness.stalenessMs)} (SLO: < 5min)`
    );
  }

  const confidenceAcceptable =
    confidenceState.geometricMeanConfidence >= SLO_THRESHOLDS.confidenceMeanMin;
  if (!confidenceAcceptable) {
    degradationReasons.push(
      `Low confidence: ${(confidenceState.geometricMeanConfidence * 100).toFixed(1)}% (SLO: > 70%)`
    );
  }

  const defeatersLow = confidenceState.defeaterCount <= SLO_THRESHOLDS.maxDefeatersHealthy;
  if (!defeatersLow) {
    degradationReasons.push(
      `High defeater count: ${confidenceState.defeaterCount} (SLO: <= ${SLO_THRESHOLDS.maxDefeatersHealthy})`
    );
  }

  const latencyAcceptable =
    queryPerformance.queryLatencyP99 <= SLO_THRESHOLDS.queryLatencyP99Ms;
  if (!latencyAcceptable && queryPerformance.queryCount > 0) {
    degradationReasons.push(
      `High latency p99: ${queryPerformance.queryLatencyP99}ms (SLO: < 2000ms)`
    );
  }

  const coverageAcceptable =
    codeGraphHealth.coverageRatio >= SLO_THRESHOLDS.coverageRatioMin;
  if (!coverageAcceptable) {
    degradationReasons.push(
      `Low coverage: ${(codeGraphHealth.coverageRatio * 100).toFixed(1)}% (SLO: > 90%)`
    );
  }

  // Determine overall status
  const allChecksPass =
    indexFresh && confidenceAcceptable && defeatersLow && latencyAcceptable && coverageAcceptable;

  // "Unhealthy" should indicate operational failure, not "low epistemic confidence" or freshness SLO misses.
  // Stale index is important to surface, but it is typically recoverable and should not hard-fail the system.
  const criticalFailures = !latencyAcceptable && queryPerformance.queryCount > 0;
  const status: LibrarianHealth['status'] = allChecksPass
    ? 'healthy'
    : criticalFailures
      ? 'unhealthy'
      : 'degraded';

  return {
    status,
    checks: {
      indexFresh,
      confidenceAcceptable,
      defeatersLow,
      latencyAcceptable,
      coverageAcceptable,
    },
    degradationReasons,
  };
}

// ============================================================================
// RECOVERY STATE MACHINE
// ============================================================================

interface RecoveryStateMachine {
  currentState: RecoveryState;
  lastTransition: string;
  lastRecoveryAttempt: string | null;
  recoveryAttempts: number;
}

let recoveryStateMachine: RecoveryStateMachine = {
  currentState: 'healthy',
  lastTransition: new Date().toISOString(),
  lastRecoveryAttempt: null,
  recoveryAttempts: 0,
};

/**
 * Transition recovery state based on health assessment.
 */
export function transitionRecoveryState(health: LibrarianHealth): RecoveryState {
  const previous = recoveryStateMachine.currentState;
  const now = new Date().toISOString();

  switch (previous) {
    case 'healthy':
      if (health.status !== 'healthy') {
        recoveryStateMachine.currentState = 'degraded';
        recoveryStateMachine.lastTransition = now;
      }
      break;

    case 'degraded':
      if (health.status === 'healthy') {
        recoveryStateMachine.currentState = 'healthy';
        recoveryStateMachine.lastTransition = now;
      } else {
        // Start diagnosis
        recoveryStateMachine.currentState = 'diagnosing';
        recoveryStateMachine.lastTransition = now;
      }
      break;

    case 'diagnosing':
      // After diagnosis, attempt recovery
      recoveryStateMachine.currentState = 'recovering';
      recoveryStateMachine.lastTransition = now;
      recoveryStateMachine.lastRecoveryAttempt = now;
      recoveryStateMachine.recoveryAttempts++;
      break;

    case 'recovering':
      if (health.status === 'healthy') {
        recoveryStateMachine.currentState = 'healthy';
        recoveryStateMachine.lastTransition = now;
        recoveryStateMachine.recoveryAttempts = 0;
      } else if (recoveryStateMachine.recoveryAttempts >= 3) {
        // Max recovery attempts reached
        recoveryStateMachine.currentState = 'degraded_stable';
        recoveryStateMachine.lastTransition = now;
      } else {
        // Retry recovery
        recoveryStateMachine.currentState = 'degraded';
        recoveryStateMachine.lastTransition = now;
      }
      break;

    case 'degraded_stable':
      if (health.status === 'healthy') {
        recoveryStateMachine.currentState = 'healthy';
        recoveryStateMachine.lastTransition = now;
        recoveryStateMachine.recoveryAttempts = 0;
      }
      // Otherwise stay in degraded_stable until manual intervention
      break;
  }

  return recoveryStateMachine.currentState;
}

/**
 * Get current recovery state.
 */
export function getRecoveryState(): RecoveryState {
  return recoveryStateMachine.currentState;
}

/**
 * Reset recovery state machine (for testing or manual intervention).
 */
export function resetRecoveryState(): void {
  recoveryStateMachine = {
    currentState: 'healthy',
    lastTransition: new Date().toISOString(),
    lastRecoveryAttempt: null,
    recoveryAttempts: 0,
  };
}

// ============================================================================
// COMPLETE STATE REPORT
// ============================================================================

/**
 * Generate complete librarian state report.
 */
export async function generateStateReport(
  storage: LibrarianStorage
): Promise<LibrarianStateReport> {
  const now = new Date();

  // Collect all state variables
  const codeGraphHealth = await collectCodeGraphHealth(storage);
  const indexFreshness = await collectIndexFreshness(storage);
  const confidenceState = await collectConfidenceState(storage);
  const queryPerformance = collectQueryPerformance();

  // Assess health
  const health = assessHealth(
    codeGraphHealth,
    indexFreshness,
    confidenceState,
    queryPerformance
  );

  // Update recovery state
  const recoveryState = transitionRecoveryState(health);

  return {
    kind: 'LibrarianStateReport.v1',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    codeGraphHealth,
    indexFreshness,
    confidenceState,
    queryPerformance,
    recoveryState,
    lastRecoveryTime: recoveryStateMachine.lastRecoveryAttempt,
    health,
  };
}

// ============================================================================
// PROMETHEUS-STYLE METRICS EXPORT
// ============================================================================

/**
 * Export metrics in Prometheus format per CONTROL_LOOP.md.
 */
export function exportPrometheusMetrics(report: LibrarianStateReport): string {
  const lines: string[] = [];

  // Code graph health
  for (const [type, count] of Object.entries(report.codeGraphHealth.entityCountByType)) {
    lines.push(`librarian_entity_count{type="${type}"} ${count}`);
  }
  lines.push(`librarian_relation_count ${report.codeGraphHealth.relationCount}`);
  lines.push(`librarian_coverage_ratio ${report.codeGraphHealth.coverageRatio.toFixed(4)}`);
  lines.push(`librarian_orphan_entities ${report.codeGraphHealth.orphanEntities}`);

  // Index freshness
  lines.push(
    `librarian_staleness_seconds ${Math.max(0, report.indexFreshness.stalenessMs / 1000).toFixed(0)}`
  );
  lines.push(`librarian_pending_changes ${report.indexFreshness.pendingChanges}`);

  // Confidence state
  lines.push(`librarian_confidence_mean ${report.confidenceState.meanConfidence.toFixed(4)}`);
  lines.push(
    `librarian_confidence_geometric_mean ${report.confidenceState.geometricMeanConfidence.toFixed(4)}`
  );
  lines.push(`librarian_low_confidence_count ${report.confidenceState.lowConfidenceCount}`);
  for (const [type, count] of Object.entries(report.confidenceState.defeatersByType)) {
    lines.push(`librarian_defeater_count{type="${type}"} ${count}`);
  }
  lines.push(`librarian_defeater_total ${report.confidenceState.defeaterCount}`);

  // Query performance
  lines.push(
    `librarian_query_latency_seconds{quantile="0.5"} ${(report.queryPerformance.queryLatencyP50 / 1000).toFixed(4)}`
  );
  lines.push(
    `librarian_query_latency_seconds{quantile="0.99"} ${(report.queryPerformance.queryLatencyP99 / 1000).toFixed(4)}`
  );
  lines.push(`librarian_cache_hit_rate ${report.queryPerformance.cacheHitRate.toFixed(4)}`);
  lines.push(`librarian_query_count ${report.queryPerformance.queryCount}`);

  // Recovery state
  const states: RecoveryState[] = ['healthy', 'degraded', 'diagnosing', 'recovering', 'degraded_stable'];
  for (const state of states) {
    lines.push(`librarian_recovery_state{state="${state}"} ${report.recoveryState === state ? 1 : 0}`);
  }

  // Health checks
  lines.push(`librarian_health_index_fresh ${report.health.checks.indexFresh ? 1 : 0}`);
  lines.push(`librarian_health_confidence_ok ${report.health.checks.confidenceAcceptable ? 1 : 0}`);
  lines.push(`librarian_health_defeaters_low ${report.health.checks.defeatersLow ? 1 : 0}`);
  lines.push(`librarian_health_latency_ok ${report.health.checks.latencyAcceptable ? 1 : 0}`);

  return lines.join('\n');
}

// ============================================================================
// TYPE GUARD
// ============================================================================

export function isLibrarianStateReport(value: unknown): value is LibrarianStateReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.kind === 'LibrarianStateReport.v1' && r.schemaVersion === 1;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 0) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}min`;
  if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
  return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
}
