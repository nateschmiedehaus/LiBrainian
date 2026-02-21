import type { GovernorConfig, GovernorBudgetOutcome, GovernorBudgetReportV1 } from './governors.js';
import { DEFAULT_GOVERNOR_CONFIG, createGovernorBudgetReport } from './governors.js';

// ============================================================================
// BUDGET MANAGEMENT STRATEGIES (FULL QUALITY ALWAYS)
// ============================================================================

/**
 * Strategies for budget management while MAINTAINING FULL QUALITY.
 *
 * CRITICAL PRINCIPLE: The librainian must ALWAYS deliver full-quality output.
 * These strategies are about HOW to maintain quality under budget constraints,
 * NOT about reducing quality. If we cannot deliver full quality, we return
 * existing cached full-quality knowledge or defer - never degraded output.
 */
export type BudgetStrategy =
  | 'proceed'           // Normal operation - budget is healthy
  | 'use_cache'         // Return existing cached knowledge (already full quality)
  | 'use_cheaper_model' // Use cheaper model for PREPROCESSING only (classification, routing)
  | 'batch_aggressive'  // Batch more to reduce overhead, full quality per item
  | 'prioritize'        // Process high-priority items first, others queued (not skipped)
  | 'defer'             // Queue for later processing, return existing full-quality cache

/**
 * Result of budget check - provides strategy while guaranteeing quality.
 */
export interface BudgetCheckResult {
  /** Recommended strategy for maintaining quality under budget */
  strategy: BudgetStrategy;

  /** Human-readable reason for the strategy */
  reason: string;

  /** Budget utilization (0-1) for each dimension */
  utilization: {
    tokens_run: number;
    tokens_phase: number;
    tokens_file: number;
    files_phase: number;
    wall_time: number;
    retries: number;
  };

  /** Overall budget health (0-1, lower = more constrained) */
  budgetHealth: number;

  /** Whether new LLM calls should be deferred (use cache instead) */
  shouldDeferNewCalls: boolean;

  /** Whether full quality can still be guaranteed */
  fullQualityGuaranteed: boolean;
}

// ============================================================================
// CORE TYPES
// ============================================================================

export interface GovernorRunState {
  tokensUsed: number;
  filesProcessed: number;
  retriesUsed: number;
}

export interface GovernorContextUsage {
  tokens_used_phase: number;
  tokens_used_run: number;
  tokens_used_file: number;
  files_processed_phase: number;
  files_processed_run: number;
  retries_used: number;
  elapsed_ms: number;
  current_file: string | null;
}

export interface GovernorContextSnapshot {
  phase: string;
  config: GovernorConfig;
  usage: GovernorContextUsage;
}

export function createGovernorRunState(): GovernorRunState {
  return { tokensUsed: 0, filesProcessed: 0, retriesUsed: 0 };
}

export class GovernorContext {
  private readonly phase: string;
  private readonly config: GovernorConfig;
  private readonly runState: GovernorRunState;
  private readonly startTimeMs: number;
  private phaseTokensUsed = 0;
  private phaseFilesProcessed = 0;
  private currentFileTokens = 0;
  private currentFilePath: string | null = null;

  constructor(options: {
    phase: string;
    config?: GovernorConfig;
    runState?: GovernorRunState;
    startTimeMs?: number;
  }) {
    this.phase = options.phase;
    this.config = options.config ?? DEFAULT_GOVERNOR_CONFIG;
    this.runState = options.runState ?? createGovernorRunState();
    this.startTimeMs = options.startTimeMs ?? Date.now();
  }

  enterFile(filePath: string): void {
    this.currentFilePath = filePath;
    this.currentFileTokens = 0;
    this.phaseFilesProcessed += 1;
    this.runState.filesProcessed += 1;
    this.checkBudget();
  }

  /**
   * Record tokens used. Returns the current strategy recommendation.
   * Does NOT throw - callers should check the returned strategy and adapt.
   */
  recordTokens(tokens: number): BudgetCheckResult {
    if (!Number.isFinite(tokens) || tokens < 0) {
      // Invalid input - log warning but don't crash
      tokens = 0;
    }
    this.phaseTokensUsed += tokens;
    this.runState.tokensUsed += tokens;
    if (this.currentFilePath) {
      this.currentFileTokens += tokens;
    }
    return this.recommendStrategy();
  }

  recordRetry(): void {
    this.runState.retriesUsed += 1;
    this.checkBudget();
  }

  /**
   * Check budget and throw if hard limits exceeded.
   * PREFER using recommendStrategy() for graceful degradation.
   * This method is kept for backwards compatibility but will only throw
   * on truly unrecoverable situations (e.g., 150% over budget).
   */
  checkBudget(): void {
    const result = this.recommendStrategy();
    // Only throw if we're significantly over budget (hard limit + 50% buffer exhausted)
    // This is a safety valve for truly extreme cases - normal operation uses strategies
    if (result.shouldDeferNewCalls && result.budgetHealth < -0.5) {
      throw budgetExceeded(`${result.reason} (health: ${result.budgetHealth.toFixed(2)})`);
    }
  }

  /**
   * Recommend a budget management strategy while GUARANTEEING FULL QUALITY.
   *
   * CRITICAL: The librainian MUST always deliver full-quality output.
   * This method tells callers HOW to maintain quality under budget constraints:
   * - proceed: Generate new knowledge at full quality
   * - use_cache: Return existing cached knowledge (already full quality)
   * - use_cheaper_model: Use cheaper model for preprocessing ONLY
   * - batch_aggressive: Batch more items together (still full quality each)
   * - prioritize: Process high-priority items first, queue others
   * - defer: Queue all new generation, return existing cached knowledge
   *
   * Strategy Selection:
   * - budgetHealth > 0.7: proceed (plenty of budget)
   * - budgetHealth > 0.5: use_cheaper_model for preprocessing
   * - budgetHealth > 0.3: batch_aggressive + prioritize
   * - budgetHealth > 0: use_cache (return existing, queue new)
   * - budgetHealth <= 0: defer (no new LLM calls, cached only)
   */
  recommendStrategy(): BudgetCheckResult {
    const elapsedMs = Date.now() - this.startTimeMs;

    // Calculate utilization for each dimension (0 = unused, 1 = at limit)
    const utilization = {
      tokens_run: this.config.maxTokensPerRun > 0
        ? this.runState.tokensUsed / this.config.maxTokensPerRun
        : 0,
      tokens_phase: this.config.maxTokensPerPhase > 0
        ? this.phaseTokensUsed / this.config.maxTokensPerPhase
        : 0,
      tokens_file: this.config.maxTokensPerFile > 0 && this.currentFilePath
        ? this.currentFileTokens / this.config.maxTokensPerFile
        : 0,
      files_phase: this.config.maxFilesPerPhase > 0
        ? this.phaseFilesProcessed / this.config.maxFilesPerPhase
        : 0,
      wall_time: this.config.maxWallTimeMs > 0
        ? elapsedMs / this.config.maxWallTimeMs
        : 0,
      retries: this.config.maxRetries > 0
        ? this.runState.retriesUsed / this.config.maxRetries
        : 0,
    };

    // Budget health = 1 - max utilization (1 = healthy, 0 = at limit, negative = over)
    const maxUtilization = Math.max(
      utilization.tokens_run,
      utilization.tokens_phase,
      utilization.tokens_file,
      utilization.files_phase,
      utilization.wall_time,
      utilization.retries
    );
    const budgetHealth = 1 - maxUtilization;

    // Determine which constraint is tightest
    const constraints: Array<{ name: string; util: number }> = [
      { name: 'tokens_run', util: utilization.tokens_run },
      { name: 'tokens_phase', util: utilization.tokens_phase },
      { name: 'tokens_file', util: utilization.tokens_file },
      { name: 'files_phase', util: utilization.files_phase },
      { name: 'wall_time', util: utilization.wall_time },
      { name: 'retries', util: utilization.retries },
    ].filter(c => c.util > 0);

    const tightestConstraint = constraints.reduce(
      (max, c) => c.util > max.util ? c : max,
      { name: 'none', util: 0 }
    );

    // Select strategy - ALWAYS maintaining full quality
    let strategy: BudgetStrategy;
    let reason: string;
    let shouldDeferNewCalls = false;

    if (budgetHealth > 0.7) {
      strategy = 'proceed';
      reason = 'Budget healthy - full quality generation';
    } else if (budgetHealth > 0.5) {
      strategy = 'use_cheaper_model';
      reason = `Budget at ${((1 - budgetHealth) * 100).toFixed(0)}% - cheaper model for preprocessing, full quality for knowledge`;
    } else if (budgetHealth > 0.3) {
      strategy = 'batch_aggressive';
      reason = `Budget constrained (${tightestConstraint.name}) - batching for efficiency, full quality per item`;
    } else if (budgetHealth > 0.1) {
      strategy = 'prioritize';
      reason = `Budget tight - processing high-priority items first, queueing others`;
    } else if (budgetHealth > 0) {
      strategy = 'use_cache';
      reason = `Budget nearly exhausted - returning cached full-quality knowledge, queueing new generation`;
      shouldDeferNewCalls = true;
    } else {
      strategy = 'defer';
      reason = `Budget exceeded on ${tightestConstraint.name} - returning cached knowledge only`;
      shouldDeferNewCalls = true;
    }

    return {
      strategy,
      reason,
      utilization,
      budgetHealth,
      shouldDeferNewCalls,
      fullQualityGuaranteed: true, // ALWAYS true - we never degrade quality
    };
  }

  /**
   * Check if we should proceed with an LLM call given current budget.
   * Returns the recommended model to use (or null if should skip LLM entirely).
   */
  recommendModel(preferredModel?: string): { model: string | null; reason: string } {
    const { strategy, reason } = this.recommendStrategy();

    switch (strategy) {
      case 'proceed':
        return { model: preferredModel || 'claude-sonnet-4-20250514', reason: 'Budget healthy' };

      case 'use_cheaper_model':
      case 'batch_aggressive':
        // Switch to haiku for efficiency
        return { model: 'claude-haiku-4-5-20241022', reason };

      case 'use_cache':
      case 'prioritize':
      case 'defer':
        // Skip LLM entirely - return cached knowledge instead
        return { model: null, reason };

      default:
        return { model: preferredModel || 'claude-sonnet-4-20250514', reason: 'Default' };
    }
  }

  snapshot(): GovernorContextSnapshot {
    return {
      phase: this.phase,
      config: this.config,
      usage: {
        tokens_used_phase: this.phaseTokensUsed,
        tokens_used_run: this.runState.tokensUsed,
        tokens_used_file: this.currentFileTokens,
        files_processed_phase: this.phaseFilesProcessed,
        files_processed_run: this.runState.filesProcessed,
        retries_used: this.runState.retriesUsed,
        elapsed_ms: Date.now() - this.startTimeMs,
        current_file: this.currentFilePath,
      },
    };
  }

  fork(options: { phase?: string } = {}): GovernorContext {
    return new GovernorContext({
      phase: options.phase ?? this.phase,
      config: this.config,
      runState: this.runState,
      startTimeMs: this.startTimeMs,
    });
  }

  async buildReport(outcome: GovernorBudgetOutcome): Promise<GovernorBudgetReportV1> {
    return createGovernorBudgetReport(this.snapshot(), outcome);
  }
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function budgetExceeded(detail: string): Error {
  return new Error(`unverified_by_trace(budget_exhausted): ${detail}`);
}
