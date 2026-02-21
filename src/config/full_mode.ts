/**
 * @fileoverview Full Mode Configuration Preset for LiBrainian Library
 *
 * This is the "super high mode" configuration that enables ALL librainian
 * capabilities at maximum fidelity. Use this when you need:
 * - Complete LLM enrichment for all entities
 * - Maximum context depth (L3 - 80k tokens, 20 packs)
 * - Comprehensive analysis including clones, debt, and knowledge graphs
 * - Full git history integration (blame, diff, reflog)
 * - No resource constraints (unlimited processing)
 *
 * TRADEOFFS:
 * - Higher API costs (more LLM calls)
 * - Longer bootstrap time
 * - More storage space required
 *
 * Use `fast` mode for quick iteration; use `full` mode for production indexing.
 */

import type { BootstrapConfig } from '../types.js';
import type { GovernorConfig } from '../api/governors.js';
import type { ContextLevel } from '../api/context_levels.js';
import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from '../universal_patterns.js';

// ============================================================================
// FULL MODE BOOTSTRAP CONFIG
// ============================================================================

/**
 * Full mode bootstrap configuration.
 *
 * Enables all LLM enrichment phases and indexes everything meaningful.
 */
export const FULL_MODE_BOOTSTRAP_CONFIG: Omit<BootstrapConfig, 'workspace'> = {
  // Full mode enables all LLM enrichment phases
  bootstrapMode: 'full',

  // Include everything meaningful
  include: [...INCLUDE_PATTERNS],
  exclude: [...EXCLUDE_PATTERNS],

  // Generous file size limit for documentation and data files
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB (double the default)

  // No timeout - correctness over speed
  timeoutMs: 0,

  // Force AST + LLM analysis for maximum extraction
  useAstIndexer: true,
};

// ============================================================================
// FULL MODE GOVERNOR CONFIG
// ============================================================================

/**
 * Full mode governor configuration.
 *
 * No limits - let the librainian process everything without constraints.
 * Higher concurrency for faster processing on capable machines.
 */
export const FULL_MODE_GOVERNOR_CONFIG: GovernorConfig = {
  // No token limits - process everything
  maxTokensPerFile: 0,        // unlimited
  maxTokensPerPhase: 0,       // unlimited
  maxTokensPerRun: 0,         // unlimited

  // No file limits
  maxFilesPerPhase: 0,        // unlimited

  // No time constraints
  maxWallTimeMs: 0,           // unlimited

  // Unlimited retries for resilience
  maxRetries: 0,              // unlimited

  // Higher concurrency for full mode (auto-detected, but default to 8)
  maxConcurrentWorkers: 8,

  // Larger batch size for embeddings
  maxEmbeddingsPerBatch: 20,
};

// ============================================================================
// FULL MODE CONTEXT LEVEL
// ============================================================================

/**
 * Default context level for full mode queries.
 *
 * L3 = Comprehensive context:
 * - 80,000 token budget
 * - Up to 20 context packs
 * - Includes history + similar tasks
 */
export const FULL_MODE_CONTEXT_LEVEL: ContextLevel = 'L3';

// ============================================================================
// FULL MODE ANALYSIS CONFIG
// ============================================================================

/**
 * Analysis features enabled in full mode.
 */
export interface FullModeAnalysisConfig {
  // Git-based analysis
  enableBlameIndexing: boolean;
  enableDiffAnalysis: boolean;
  enableReflogTracking: boolean;

  // Code analysis
  enableCloneDetection: boolean;
  enableTechnicalDebtAnalysis: boolean;

  // Knowledge graph
  enableKnowledgeGraph: boolean;
  knowledgeGraphEdgeTypes: readonly string[];

  // Bayesian confidence tracking
  enableConfidenceTracking: boolean;

  // Risk and stability analysis
  enableRiskPropagation: boolean;
  enableFeedbackLoopDetection: boolean;
}

/**
 * Full mode analysis configuration - all features enabled.
 */
export const FULL_MODE_ANALYSIS_CONFIG: FullModeAnalysisConfig = {
  // Git integration - full history awareness
  enableBlameIndexing: true,
  enableDiffAnalysis: true,
  enableReflogTracking: true,

  // Clone and debt detection
  enableCloneDetection: true,
  enableTechnicalDebtAnalysis: true,

  // Knowledge graph with all edge types
  enableKnowledgeGraph: true,
  knowledgeGraphEdgeTypes: [
    'imports',
    'calls',
    'extends',
    'implements',
    'clone_of',
    'debt_related',
    'authored_by',
    'evolved_from',
    'co_changed',
    'tests',
    'documents',
  ] as const,

  // Confidence and risk tracking
  enableConfidenceTracking: true,
  enableRiskPropagation: true,
  enableFeedbackLoopDetection: true,
};

// ============================================================================
// FULL MODE TDD CONFIG
// ============================================================================

/**
 * TDD configuration for full mode.
 */
export interface FullModeTddConfig {
  defaultSchool: 'london' | 'chicago' | 'detroit';
  enableAdvancedCapabilities: boolean;
  advancedCapabilities: readonly string[];
}

/**
 * Full mode TDD configuration - all capabilities enabled.
 */
export const FULL_MODE_TDD_CONFIG: FullModeTddConfig = {
  // Default to London school (behavior-focused)
  defaultSchool: 'london',

  // Enable all advanced AI testing capabilities
  enableAdvancedCapabilities: true,
  advancedCapabilities: [
    'llm_unit_test_generation',
    'self_healing_tests',
    'test_intention_guided_generation',
    'mutation_guided_generation',
  ] as const,
};

// ============================================================================
// COMBINED FULL MODE CONFIG
// ============================================================================

/**
 * Complete full mode configuration bundle.
 *
 * Use this to configure the librainian for maximum capability.
 *
 * @example
 * ```typescript
 * import { FULL_MODE_CONFIG } from './config/full_mode.js';
 *
 * const config: BootstrapConfig = {
 *   workspace: '/path/to/repo',
 *   ...FULL_MODE_CONFIG.bootstrap,
 *   llmProvider: 'claude',
 *   embeddingProvider: 'xenova',
 * };
 * ```
 */
export const FULL_MODE_CONFIG = {
  bootstrap: FULL_MODE_BOOTSTRAP_CONFIG,
  governor: FULL_MODE_GOVERNOR_CONFIG,
  contextLevel: FULL_MODE_CONTEXT_LEVEL,
  analysis: FULL_MODE_ANALYSIS_CONFIG,
  tdd: FULL_MODE_TDD_CONFIG,
} as const;

// ============================================================================
// HELPER: Create Full Mode Bootstrap Config
// ============================================================================

/**
 * Create a complete full mode bootstrap config for a workspace.
 *
 * @param workspace - Path to the workspace root
 * @param overrides - Optional overrides for specific settings
 * @returns Complete bootstrap config with full mode defaults
 *
 * @example
 * ```typescript
 * const config = createFullModeConfig('/path/to/repo', {
 *   llmProvider: 'claude',
 *   llmModelId: 'claude-sonnet-4-20250514',
 *   embeddingProvider: 'xenova',
 * });
 * ```
 */
export function createFullModeConfig(
  workspace: string,
  overrides?: Partial<Omit<BootstrapConfig, 'workspace'>>
): BootstrapConfig {
  return {
    workspace,
    ...FULL_MODE_BOOTSTRAP_CONFIG,
    ...overrides,
  };
}

export default FULL_MODE_CONFIG;
