import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack } from '../types.js';
import type { EmbeddingService } from '../api/embeddings.js';
import { RelevanceEngine } from './relevance_engine.js';
import { ConstraintEngine } from './constraint_engine.js';
import { MetaKnowledgeEngine } from './meta_engine.js';
import { TddEngine } from './tdd_engine.js';
import { LiBrainianAgentImpl, type LiBrainianAgent } from './agent_interface.js';
import { createThresholdAlertEvent, globalEventBus, type LiBrainianEvent, type LiBrainianEventHandler, type LiBrainianEventBus } from '../events.js';
import { recordMultiSignalFeedback } from '../query/scoring.js';
import { logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

export type { LiBrainianAgent } from './agent_interface.js';
export { TddEngine } from './tdd_engine.js';
export * from './tdd_types.js';
export * from './tdd_presets.js';
export * from './tdd_advanced.js';
export * from './domain_expertise.js';
export * from './domain_registry.js';
export type {
  AgentQuestion,
  AgentAction,
  AgentAnswer,
  ActionResult,
  ContextBudget,
  KnowledgeItem,
  BlindSpot,
  RelevanceRequest,
  RelevanceResult,
  PatternMatch,
  ExampleMatch,
  BlastRadius,
  ProposedChange,
  FileChange,
  Constraint,
  ValidationResult,
  Violation,
  Warning,
  BatchValidationResult,
  Explanation,
  ExceptionResult,
  Boundary,
  InferredConstraint,
  DriftReport,
  ConstraintSuggestion,
  QualifiedKnowledge,
  ProceedDecision,
  ConfidenceReport,
  RiskAssessment,
  FailureHistory,
  Expert,
  TaskOutcome,
  TaskFailure,
  Attribution,
  ThresholdAlert,
} from './types.js';

export { RelevanceEngine } from './relevance_engine.js';
export { ConstraintEngine } from './constraint_engine.js';
export { MetaKnowledgeEngine } from './meta_engine.js';

/**
 * Configuration options for creating a LiBrainianEngineToolkit.
 */
export interface LiBrainianEngineToolkitOptions {
  /** The storage backend containing indexed knowledge */
  storage: LiBrainianStorage;
  /** Absolute path to the workspace root directory */
  workspaceRoot: string;
  /** Optional embedding service for semantic search capabilities */
  embeddingService?: EmbeddingService | null;
  /** Optional callback to trigger reindexing of specific file paths */
  reindex?: (scope: string[]) => Promise<void>;
  /** Optional event bus for publishing/subscribing to librainian events */
  eventBus?: LiBrainianEventBus;
  /** Whether to subscribe to events automatically (default: true) */
  subscribeEvents?: boolean;
  /** Whether to enable TDD engine capabilities (default: true) */
  enableTdd?: boolean;
}

/**
 * Unified toolkit providing access to all librainian engine capabilities.
 *
 * The toolkit aggregates four specialized engines:
 * - **RelevanceEngine**: Finds relevant context packs using semantic and structural signals
 * - **ConstraintEngine**: Validates changes against inferred and explicit constraints
 * - **MetaKnowledgeEngine**: Tracks confidence, staleness, and knowledge gaps
 * - **TddEngine**: Provides test-driven development guidance and test generation
 *
 * The toolkit automatically subscribes to the event bus to update internal state
 * when tasks complete, files change, or context packs are invalidated.
 *
 * @example
 * ```typescript
 * const toolkit = createLiBrainianEngineToolkit({
 *   storage,
 *   workspaceRoot: '/path/to/project',
 *   embeddingService,
 * });
 *
 * // Find relevant context for a task
 * const context = await toolkit.relevance.findRelevant({
 *   intent: 'implement user authentication',
 *   maxResults: 10,
 * });
 *
 * // Validate proposed changes
 * const validation = await toolkit.constraint.validate(proposedChanges);
 *
 * // Check knowledge confidence
 * const confidence = await toolkit.meta.getConfidence(packIds);
 *
 * // Clean up when done
 * toolkit.dispose();
 * ```
 */
export class LiBrainianEngineToolkit {
  /** Engine for finding relevant context packs */
  readonly relevance: RelevanceEngine;
  /** Engine for validating changes against constraints */
  readonly constraint: ConstraintEngine;
  /** Engine for tracking confidence and knowledge gaps */
  readonly meta: MetaKnowledgeEngine;
  /** Engine for TDD guidance (null if disabled) */
  readonly tdd: TddEngine | null;
  /** Unified agent interface for high-level operations */
  readonly agent: LiBrainianAgent;
  private readonly storage: LiBrainianStorage;
  private readonly embeddingService: EmbeddingService | null;
  private unsubscribeEvents: (() => void) | null = null;

  /**
   * Creates a new LiBrainianEngineToolkit instance.
   * @param options - Configuration options for the toolkit
   */
  constructor(options: LiBrainianEngineToolkitOptions) {
    this.storage = options.storage;
    this.embeddingService = options.embeddingService ?? null;
    this.relevance = new RelevanceEngine(options.storage, options.embeddingService ?? null, options.workspaceRoot);
    this.constraint = new ConstraintEngine(options.storage, options.workspaceRoot);
    this.meta = new MetaKnowledgeEngine(options.storage, options.workspaceRoot, options.reindex);
    this.tdd = options.enableTdd !== false ? new TddEngine(options.storage, options.workspaceRoot) : null;
    this.agent = new LiBrainianAgentImpl(this.relevance, this.constraint, this.meta, this.tdd ?? undefined);
    if (options.subscribeEvents !== false) {
      this.unsubscribeEvents = attachEngineEventBridge(this, options.eventBus ?? globalEventBus);
    }
  }

  /**
   * Cleans up event subscriptions. Call this when the toolkit is no longer needed.
   */
  dispose(): void {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
  }

  /**
   * Records feedback about task outcomes to improve future relevance scoring.
   * Updates multi-signal weights based on whether the provided context led to success.
   *
   * @param options - Feedback options
   * @param options.intent - The task intent or query that was used
   * @param options.success - Whether the task succeeded
   * @param options.packsUsed - IDs of context packs that were used
   * @param options.reason - Optional reason for success/failure
   */
  async handleFeedback(options: {
    intent?: string;
    success: boolean;
    packsUsed?: string[];
    reason?: string;
  }): Promise<void> {
    const packsUsed = options.packsUsed ?? [];
    if (!packsUsed.length) return;
    const packs: ContextPack[] = [];
    for (const packId of packsUsed) {
      const pack = await this.storage.getContextPack(packId).catch((err) => {
        logWarning('[engines] Failed to retrieve context pack for feedback', { packId, error: getErrorMessage(err) });
        return null;
      });
      if (pack) packs.push(pack);
    }
    if (!packs.length) return;
    const intent = options.intent ?? options.reason ?? '';
    if (!intent) return;
    await recordMultiSignalFeedback({
      storage: this.storage,
      embeddingService: this.embeddingService,
      intent,
      packs,
      success: options.success,
    });
  }
}

/**
 * Factory function to create a LiBrainianEngineToolkit instance.
 *
 * @param options - Configuration options for the toolkit
 * @returns A fully configured LiBrainianEngineToolkit instance
 *
 * @example
 * ```typescript
 * const toolkit = createLiBrainianEngineToolkit({
 *   storage: await createSqliteStorage({ dbPath: './librainian.db' }),
 *   workspaceRoot: process.cwd(),
 *   embeddingService: new EmbeddingService(),
 * });
 * ```
 */
export function createLiBrainianEngineToolkit(options: LiBrainianEngineToolkitOptions): LiBrainianEngineToolkit {
  return new LiBrainianEngineToolkit(options);
}

function attachEngineEventBridge(toolkit: LiBrainianEngineToolkit, bus: LiBrainianEventBus): () => void {
  const handler: LiBrainianEventHandler = async (event: LiBrainianEvent) => {
    switch (event.type) {
      case 'task_completed':
      case 'task_failed': {
        const data = event.data as {
          taskId?: string;
          success?: boolean;
          packsUsed?: string[];
          reason?: string;
          intent?: string;
        };
        const taskId = data.taskId ?? `task:${event.timestamp.getTime()}`;
        const success = data.success ?? event.type === 'task_completed';
        const packsUsed = Array.isArray(data.packsUsed) ? data.packsUsed : [];
        const reason = typeof data.reason === 'string' ? data.reason : undefined;
        const intent = typeof data.intent === 'string' ? data.intent : reason ?? 'task_outcome';
        toolkit.relevance.recordOutcome(taskId, { success, reason }, packsUsed);
        toolkit.meta.recordOutcome({ intent, success, reason, packsUsed, timestamp: event.timestamp.toISOString() });
        await toolkit.handleFeedback({ intent, success, packsUsed, reason });
        const alerts = await toolkit.meta.checkThresholds();
        for (const alert of alerts) {
          void bus.emit(createThresholdAlertEvent(alert));
        }
        break;
      }
      case 'file_modified':
      case 'file_created':
      case 'file_deleted': {
        const data = event.data as { filePath?: string };
        if (data?.filePath) {
          toolkit.meta.markStale([data.filePath]);
        }
        break;
      }
      case 'context_packs_invalidated': {
        const data = event.data as { triggerPath?: string };
        if (data?.triggerPath) {
          toolkit.meta.markStale([data.triggerPath]);
        }
        break;
      }
      default:
        break;
    }
  };

  return bus.on('*', handler);
}
