/**
 * @fileoverview LiBrainian Configuration Presets
 *
 * Configuration presets for different use cases:
 * - `full_mode`: Maximum capability, all features enabled
 * - `tier_selector`: Automatic quality tier selection based on project needs
 * - `self_healing`: Auto-detect and fix suboptimal settings
 * - (future) `fast_mode`: Quick iteration, minimal LLM calls
 * - (future) `minimal_mode`: MVP indexing, no LLM enrichment
 */

// Full mode - maximum capability configuration
export {
  FULL_MODE_CONFIG,
  FULL_MODE_BOOTSTRAP_CONFIG,
  FULL_MODE_GOVERNOR_CONFIG,
  FULL_MODE_CONTEXT_LEVEL,
  FULL_MODE_ANALYSIS_CONFIG,
  FULL_MODE_TDD_CONFIG,
  createFullModeConfig,
  type FullModeAnalysisConfig,
  type FullModeTddConfig,
} from './full_mode.js';

// Tier selector - automatic quality tier selection
export {
  selectTier,
  analyzeCodebase,
  assessResources,
  getUpgradeStrategy,
  shouldUseFull,
  getProductionTier,
  getExplorationTier,
  formatTierRecommendation,
  type CodebaseMetrics,
  type ResourceAssessment,
  type TierRecommendation,
  type TierSelectionOptions,
  type TimeConstraint,
  type TierUpgradeStrategy,
} from './tier_selector.js';

// Self-healing configuration
export {
  // Core functions
  diagnoseConfiguration,
  autoHealConfiguration,
  rollbackConfiguration,
  getEffectivenessHistory,
  // Integration
  createConfigHealingTrigger,
  // Types
  type ConfigHealthReport,
  type ConfigIssue,
  type ConfigRecommendation,
  type ConfigFix,
  type ConfigChange,
  type HealingResult,
  type DriftAnalysis,
  type StalenessAnalysis,
  type UsagePatternAnalysis,
  type ConfigEffectivenessMetrics,
  type ConfigEffectivenessHistory,
  type ConfigIssueSeverity,
  type ConfigIssueCategory,
  // Thresholds
  DRIFT_THRESHOLDS,
  STALENESS_THRESHOLDS,
  PERFORMANCE_THRESHOLDS,
} from './self_healing.js';
