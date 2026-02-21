/**
 * @fileoverview Metrics module exports
 *
 * Provides observability and monitoring for the LiBrainian system.
 */

// Staleness Metrics and SLA Tracking
export type {
  StalenessConfig,
  FileType,
  StalenessCategory,
  FileStalenessBucket,
  StalestFileInfo,
  SlaReport,
} from './staleness.js';

export {
  DEFAULT_STALENESS_CONFIG,
  StalenessTracker,
  formatAge,
  categorizeStaleness,
  calculatePercentile,
  formatStatusReport,
  createStalenessMetricsTracker,
} from './staleness.js';

// Index Completeness Metrics
export type {
  ExtensionMetrics,
  DirectoryMetrics,
  StaleFileInfo as CompletenessStaleFileInfo,
  IndexCompletenessReport,
  CompletenessOptions,
} from './index_completeness.js';

export {
  calculateIndexCompleteness,
  formatCompletenessReport,
  exportPrometheusMetrics as exportCompletenessPrometheusMetrics,
} from './index_completeness.js';
