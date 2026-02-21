/**
 * @fileoverview LiBrainian Measurement Module
 *
 * PHILOSOPHICAL ALIGNMENT:
 * - Measurement replaces binary verification for semantic quality (UNDERSTANDING_LAYER.md)
 * - Calibration testing ensures confidence matches empirical accuracy
 * - Observable state variables enable feedback loops
 * - Freshness tracking enables staleness detection (UNDERSTANDING_LAYER.md §Freshness)
 *
 * Evidence artifacts produced:
 * - CalibrationReport.v1 - Confidence calibration metrics
 * - FreshnessReport.v1 - Knowledge freshness and staleness metrics
 * - RetrievalQualityReport.v1 - Retrieval quality metrics (future)
 * - PerformanceReport.v1 - SLO compliance metrics (future)
 */

// Calibration reporting
export {
  type Scope,
  type CalibrationBucket,
  type CalibrationReport,
  type CalibrationClaim,
  type CalibrationInput,
  type CalibrationValidation,
  DEFAULT_BUCKETS,
  CALIBRATION_TARGETS,
  computeCalibrationReport,
  validateCalibration,
  isCalibrationReport,
} from './calibration.js';

// Freshness and staleness tracking
export {
  type FreshnessDomain,
  type DomainFreshnessConfig,
  type StalenessCheckInput,
  type StalenessCheckResult,
  type FreshnessReport,
  type DomainFreshnessEntry,
  type RefreshQueueEntry,
  type BatchFreshnessInput,
  DOMAIN_FRESHNESS_CONFIG,
  computeFreshness,
  computeDomainFreshness,
  checkStaleness,
  createStalenessDefeater,
  computeRefreshPriority,
  computeFreshnessReport,
  isFreshnessReport,
  formatDuration,
  sectionToDomain,
} from './freshness.js';

// Observable state variables (CONTROL_LOOP.md)
export {
  type CodeGraphHealth,
  type IndexFreshness,
  type ConfidenceState,
  type QueryPerformance,
  type RecoveryState,
  type LiBrainianStateReport,
  type LiBrainianHealth,
  SLO_THRESHOLDS,
  collectCodeGraphHealth,
  collectIndexFreshness,
  collectConfidenceState,
  collectQueryPerformance,
  QueryLatencyTracker,
  getQueryLatencyTracker,
  assessHealth,
  transitionRecoveryState,
  getRecoveryState,
  resetRecoveryState,
  generateStateReport,
  exportPrometheusMetrics,
  isLiBrainianStateReport,
} from './observability.js';

// Calibration-Evidence Ledger integration
export {
  type TrackedPrediction,
  type ObservedOutcome,
  type CalibrationAnalysisOptions,
  CalibrationTracker,
  createCalibrationTracker,
} from './calibration_ledger.js';
