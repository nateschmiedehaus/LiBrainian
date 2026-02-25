/** MVP Index LiBrainian Agent: index files, embeddings, context packs. */

import { randomUUID, createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getErrorMessage } from '../utils/errors.js';
import { logWarning } from '../telemetry/logger.js';
import { withTimeout, getResultError } from '../core/result.js';
import { removeControlChars } from '../security/sanitization.js';
import type { LiBrainianStorage, MultiVectorRecord, StrategicContractRecord } from '../storage/types.js';
import { withinTransaction } from '../storage/transactions.js';
import { computeFileChecksum } from '../utils/checksums.js';
import { getLanguageFromPath } from '../utils/language.js';
import type {
  IndexingAgent,
  FileIndexResult,
  IndexingStats,
  AgentCapability,
} from './types.js';
import type {
  IndexingTask,
  IndexingResult,
  FunctionKnowledge,
  ModuleKnowledge,
  GraphEdge,
  ContextPack,
  CodeSnippet,
  LiBrainianVersion,
} from '../types.js';
import { LIBRARIAN_VERSION } from '../index.js';
import {
  EmbeddingService,
  getEmbeddingConfig,
  type EmbeddingRequest,
  type EmbeddingProvider,
} from '../api/embeddings.js';
import { GovernorContext, estimateTokenCount } from '../api/governor_context.js';
import { writeGovernorBudgetReport, type GovernorBudgetOutcome } from '../api/governors.js';
import { minimizeSnippet } from '../api/redaction.js';
import { generateMultiVector, serializeMultiVector } from '../api/embedding_providers/multi_vector_representations.js';
import { AstIndexer, type LlmProvider, type ResolvedCallEdge } from './ast_indexer.js';
import { computeCallEdgeConfidence, computeImportEdgeConfidence } from './edge_confidence.js';
import { computeGraphMetrics, writeGraphMetricsReport, type GraphMetricsEntry } from '../graphs/metrics.js';
import { isExcluded, shouldGenerateEmbeddings, UNIVERSAL_FILE_PATTERNS } from '../universal_patterns.js';
import {
  globalEventBus,
  createEntityCreatedEvent,
  createEntityUpdatedEvent,
  createEntityDeletedEvent,
  createContextPacksInvalidatedEvent,
  createUnderstandingInvalidatedEvent,
  createFileDeletedEvent,
  createIndexFileEvent,
  createIndexFunctionEvent,
  createIndexCompleteEvent,
  createIndexingStartedEvent,
  createIndexingCompleteEvent,
} from '../events.js';

// CONFIGURATION

export interface IndexLiBrainianConfig {
  /** Maximum file size to process (bytes) */
  maxFileSizeBytes: number;

  /** File extensions to process */
  extensions: string[];

  /** Patterns to exclude */
  excludePatterns: RegExp[];

  /** Use AST + LLM analysis instead of regex extraction */
  useAstIndexer?: boolean;

  /** LLM provider for AST analysis */
  llmProvider?: LlmProvider;

  /** LLM model id for AST analysis */
  llmModelId?: string;

  /** Whether to generate embeddings (requires model) */
  generateEmbeddings: boolean;

  /** Whether to run per-file LLM analysis (purpose extraction) during AST indexing. */
  enableLlmAnalysis?: boolean;

  /** Embedding dimension */
  embeddingDimension: number;

  /** Embedding batch size */
  embeddingBatchSize: number;

  /** Optional embedding provider override */
  embeddingProvider?: EmbeddingProvider;

  /** Optional embedding model id for provenance */
  embeddingModelId?: string;

  /** Optional embedding service override (test plumbing only) */
  embeddingService?: EmbeddingService;

  /** Optional governor context for budget enforcement */
  governorContext?: GovernorContext;

  /** Optional workspace root for governor budget reports */
  governorReportWorkspace?: string;

  /** Workspace root for graph metric reports */
  workspaceRoot?: string;

  /** Optional progress callback for file indexing */
  progressCallback?: (progress: { total: number; completed: number; currentFile?: string }) => void;

  /** Timeout per file in ms (0 disables). */
  fileTimeoutMs?: number;

  /** Max retries for file timeouts. */
  fileTimeoutRetries?: number;

  /** Timeout policy after retries are exhausted ('retry' retries then fails). */
  fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';

  /** Optional callback for skipped files. */
  onFileSkipped?: (filePath: string, reason: string) => void;

  /** Whether to create context packs */
  createContextPacks: boolean;

  /** Maximum functions per file to index */
  maxFunctionsPerFile: number;

  /** Compute graph metrics after indexing */
  computeGraphMetrics?: boolean;

  /** Force reindexing regardless of checksum */
  forceReindex?: boolean;

  /** Resolve cross-file external call edges at end of task. */
  resolveExternalCallEdges?: boolean;
}

export const DEFAULT_CONFIG: IndexLiBrainianConfig = {
  maxFileSizeBytes: 1024 * 1024, // 1MB
  extensions: [],
  excludePatterns: [],
  generateEmbeddings: true,
  embeddingDimension: 384, // Must match DEFAULT_EMBEDDING_DIMENSION in embeddings.ts
  embeddingBatchSize: 10,
  createContextPacks: true,
  maxFunctionsPerFile: 100,
  computeGraphMetrics: true,
  forceReindex: false,
  fileTimeoutMs: 0,
  fileTimeoutRetries: 0,
  fileTimeoutPolicy: 'skip',
  resolveExternalCallEdges: true,
};

const DEFAULT_EMBEDDING_INPUT_LIMIT = 256;
const MAX_FILE_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_FILE_TIMEOUT_RETRIES = 10;
const RESOLVE_EXTENSIONS = resolveCodeExtensions();
const isTestMode = (): boolean => process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true';

type GraphAccumulator = {
  functionGraph: Map<string, Set<string>>;
  moduleIdByPath: Map<string, string>;
  modulePathById: Map<string, string>;
  moduleDepsById: Map<string, string[]>;
};

// INDEX LIBRARIAN IMPLEMENTATION

export class IndexLiBrainian implements IndexingAgent {
  readonly agentType = 'index_librarian';
  readonly name = 'Index LiBrainian';
  readonly capabilities: readonly AgentCapability[] = ['indexing'];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LiBrainianStorage | null = null;
  private config: IndexLiBrainianConfig;
  private embeddingService: EmbeddingService | null = null;
  private readonly embeddingTextLimit: number;
  private astIndexer: AstIndexer | null = null;
  private useAstIndexer: boolean;
  private governor: GovernorContext | null = null;
  private graphAccumulator: GraphAccumulator | null = null;
  private moduleIdCache: Map<string, string> | null = null;
  private stats: IndexingStats = {
    totalFilesIndexed: 0,
    totalFunctionsIndexed: 0,
    totalModulesIndexed: 0,
    totalContextPacksCreated: 0,
    averageFileProcessingMs: 0,
    lastIndexingTime: null,
  };
  private totalProcessingTime = 0;

  constructor(config: Partial<IndexLiBrainianConfig> = {}) {
    const resolvedConfig: IndexLiBrainianConfig = { ...DEFAULT_CONFIG, ...config };
    if (resolvedConfig.embeddingService) {
      const serviceDimension = resolvedConfig.embeddingService.getEmbeddingDimension();
      if (Number.isFinite(serviceDimension) && serviceDimension > 0) {
        resolvedConfig.embeddingDimension = serviceDimension;
      }
    }
    this.config = resolvedConfig;
    this.embeddingTextLimit = resolveEmbeddingInputLimit(this.config.embeddingModelId);
    if (isTestMode() && config.computeGraphMetrics === undefined) {
      this.config.computeGraphMetrics = false;
    }
    // AST indexing is required for LiBrainian. LLM usage is optional.
    const useAstIndexer = this.config.useAstIndexer ?? true;
    if (!useAstIndexer) {
      throw new Error('unverified_by_trace(indexer_mode_invalid): AST indexing is required for librarian');
    }
    this.useAstIndexer = useAstIndexer;
    this.embeddingService = this.config.generateEmbeddings
      ? this.config.embeddingService ?? new EmbeddingService({
          provider: this.config.embeddingProvider,
          modelId: this.config.embeddingModelId,
          embeddingDimension: this.config.embeddingDimension,
          maxBatchSize: this.config.embeddingBatchSize,
        })
      : null;
    this.governor = this.config.governorContext ?? null;
  }

  async initialize(storage: LiBrainianStorage): Promise<void> {
    this.storage = storage;
    if (!storage.isInitialized()) {
      await storage.initialize();
    }
    if (this.useAstIndexer && !this.astIndexer) {
      const llmProvider = this.config.llmProvider;
      const llmModelId = this.config.llmModelId;
      const llmConfigured = Boolean(llmProvider && llmModelId);
      this.astIndexer = new AstIndexer({
        llmProvider: llmConfigured ? llmProvider : undefined,
        llmModelId: llmConfigured ? llmModelId : undefined,
        enableAnalysis: llmConfigured && (this.config.enableLlmAnalysis ?? false),
        enableEmbeddings: false,
        storage,
        workspaceRoot: this.config.workspaceRoot ?? this.config.governorReportWorkspace,
        computeGraphMetrics: false,
        governorContext: this.governor ?? undefined,
        resolveFunctionIds: async (filePath, functions) => {
          const map = new Map<string, string>();
          for (const fn of functions) {
            const existing = await storage.getFunctionByPath(filePath, fn.name);
            if (existing) map.set(fn.name, existing.id);
          }
          return map;
        },
        resolveModuleId: async (filePath) => {
          if (!this.moduleIdCache) return null;
          return this.moduleIdCache.get(normalizeGraphPath(filePath)) ?? null;
        },
      });
    }
  }

  isReady(): boolean {
    return this.storage !== null && this.storage.isInitialized();
  }

  setGovernorContext(governor: GovernorContext | null): void {
    this.governor = governor;
    this.astIndexer?.setGovernorContext(governor);
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for MVP
    this.storage = null;
    this.astIndexer = null;
    this.graphAccumulator = null;
    this.moduleIdCache = null;
  }

  // Main Indexing Methods

  async processTask(task: IndexingTask): Promise<IndexingResult> {
    this.ensureReady();

    const taskId = randomUUID();
    const startedAt = new Date();
    const errors: IndexingResult['errors'] = [];
    let budgetError: Error | null = null;
    let filesProcessed = 0;
    let filesSkipped = 0;
    let functionsIndexed = 0;
    let modulesIndexed = 0;
    let contextPacksCreated = 0;
    const totalFiles = task.paths.length;
    let lastFile: string | undefined;
    const fileTimeoutMs = normalizeFileTimeoutMs(this.config.fileTimeoutMs);
    const fileTimeoutRetries = normalizeFileTimeoutRetries(this.config.fileTimeoutRetries);
    const fileTimeoutPolicy = normalizeFileTimeoutPolicy(this.config.fileTimeoutPolicy);
    const maxTimeoutAttempts = fileTimeoutMs > 0 ? Math.max(1, fileTimeoutRetries + 1) : 1;

    // Emit indexing:started event
    void globalEventBus.emit(createIndexingStartedEvent(taskId, task.type, totalFiles));

    if (this.config.progressCallback) {
      this.config.progressCallback({ total: totalFiles, completed: 0 });
    }
    const useAstIndexer = this.useAstIndexer && this.astIndexer !== null;
    let ownsAccumulator = false;
    if (useAstIndexer) {
      this.moduleIdCache = await this.buildModuleIdCache();
      if (this.config.computeGraphMetrics && !this.graphAccumulator) {
        this.graphAccumulator = createGraphAccumulator();
        ownsAccumulator = true;
      }
    }

    for (const filePath of task.paths) {
      const fileStartedAt = Date.now();
      let completed = false;

      for (let attempt = 1; attempt <= maxTimeoutAttempts && !completed; attempt += 1) {
        try {
          this.governor?.checkBudget();
          const result = fileTimeoutMs > 0
            ? await withTimeout(
                this.indexFile(filePath),
                fileTimeoutMs,
                createFileTimeoutError(filePath, fileTimeoutMs)
              )
            : { ok: true as const, value: await this.indexFile(filePath) };
          if (!result.ok) {
            const error = getResultError(result);
            throw error ?? new Error('unverified_by_trace(index_file_failed): unknown error');
          }
          const fileResult = result.value;
          filesProcessed++;
          functionsIndexed += fileResult.functionsIndexed;
          if (fileResult.moduleIndexed) modulesIndexed++;
          contextPacksCreated += fileResult.contextPacksCreated;

          // Emit index:file event for each file processed
          void globalEventBus.emit(createIndexFileEvent(filePath, fileResult.functionsFound, fileResult.durationMs));

          if (this.config.progressCallback) {
            lastFile = filePath;
            this.config.progressCallback({
              total: totalFiles,
              completed: filesProcessed,
              currentFile: filePath,
            });
          }

          for (const error of fileResult.errors) {
            errors.push({ path: filePath, error, recoverable: true });
          }
          completed = true;
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          if (isFileTimeoutError(error)) {
            const isFinalAttempt = attempt >= maxTimeoutAttempts;
            if (!isFinalAttempt) {
              continue;
            }
            if (fileTimeoutPolicy === 'skip') {
              const durationMs = Date.now() - fileStartedAt;
              filesProcessed++;
              filesSkipped++;
              errors.push({ path: filePath, error: message, recoverable: true });
              this.config.onFileSkipped?.(filePath, message);
              void globalEventBus.emit(createIndexFileEvent(filePath, 0, durationMs));
              if (this.config.progressCallback) {
                lastFile = filePath;
                this.config.progressCallback({
                  total: totalFiles,
                  completed: filesProcessed,
                  currentFile: filePath,
                });
              }
              completed = true;
              break;
            }
            throw error;
          }
          if (
            message.includes('unverified_by_trace(budget_exhausted)') ||
            message.includes('unverified_by_trace(provider_unavailable)') ||
            message.includes('unverified_by_trace(provider_invalid_output)')
          ) {
            if (message.includes('unverified_by_trace(budget_exhausted)')) {
              budgetError = error instanceof Error ? error : new Error(message);
              errors.push({ path: filePath, error: message, recoverable: false });
              completed = true;
              break;
            }
            throw error;
          }
          errors.push({
            path: filePath,
            error: message,
            recoverable: false,
          });
          completed = true;
        }
      }
      if (budgetError) break;
    }

    const completedAt = new Date();
    if (this.graphAccumulator && useAstIndexer && ownsAccumulator) {
      try {
        await this.persistGraphMetrics(this.graphAccumulator);
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        errors.push({ path: 'graph_metrics', error: message, recoverable: true });
      }
    }

    if (this.config.resolveExternalCallEdges !== false) {
      // Resolve external call edges to actual function IDs now that all files are indexed.
      // This enables accurate cross-file call graph queries.
      try {
        const resolveResult = await this.resolveExternalCallEdges();
        if (resolveResult.resolved > 0) {
          // Log resolution stats for debugging
          const { resolved, total } = resolveResult;
          const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
          // Non-blocking: just track for debugging
          void globalEventBus.emit({
            type: 'index:external_edges_resolved',
            timestamp: new Date(),
            data: { resolved, total, percentage: pct },
          });
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        errors.push({ path: 'external_edge_resolution', error: message, recoverable: true });
      }
    }

    try {
      await this.materializeStrategicContracts();
    } catch (error: unknown) {
      errors.push({ path: 'strategic_contracts', error: getErrorMessage(error), recoverable: true });
    }

    if (ownsAccumulator) {
      this.graphAccumulator = null;
    }
    this.moduleIdCache = null;
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Emit index:complete and indexing:complete events
    void globalEventBus.emit(createIndexCompleteEvent(filesProcessed, functionsIndexed, durationMs));
    void globalEventBus.emit(createIndexingCompleteEvent(taskId, filesProcessed, functionsIndexed, durationMs));

    const result: IndexingResult = {
      taskId,
      type: task.type,
      startedAt,
      completedAt,
      filesProcessed,
      filesSkipped,
      functionsIndexed,
      modulesIndexed,
      contextPacksCreated,
      errors,
      version: this.getCurrentVersion(),
    };

    if (budgetError) {
      try {
        await this.emitGovernorReport({
          status: 'unverified_by_trace',
          reason: 'budget_exhausted',
          message: budgetError.message,
        });
      } catch (reportError: unknown) {
        const reportMessage = getErrorMessage(reportError);
        errors.push({ path: 'governor_report', error: reportMessage, recoverable: true });
      }
    }

    await this.storage!.recordIndexingResult(result);
    if (this.config.progressCallback) {
      this.config.progressCallback({
        total: totalFiles,
        completed: filesProcessed,
        currentFile: lastFile,
      });
    }

    if (budgetError) {
      throw budgetError;
    }
    return result;
  }

  async indexFile(filePath: string): Promise<FileIndexResult> {
    this.ensureReady();
    if (!this.useAstIndexer) {
      this.governor?.enterFile(filePath);
    }
    const startTime = Date.now();
    const errors: string[] = [];

    // Check if file should be processed
    if (!this.shouldProcessFile(filePath)) {
      return {
        filePath,
        functionsFound: 0,
        functionsIndexed: 0,
        moduleIndexed: false,
        contextPacksCreated: 0,
        durationMs: Date.now() - startTime,
        errors: ['File excluded by configuration'],
      };
    }

    // Read file content
    let content: string;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > this.config.maxFileSizeBytes) {
        return {
          filePath,
          functionsFound: 0,
          functionsIndexed: 0,
          moduleIndexed: false,
          contextPacksCreated: 0,
          durationMs: Date.now() - startTime,
          errors: [`File too large: ${stat.size} bytes`],
        };
      }
      const raw = await fs.readFile(filePath);
      if (this.isProbablyBinary(raw)) {
        return {
          filePath,
          functionsFound: 0,
          functionsIndexed: 0,
          moduleIndexed: false,
          contextPacksCreated: 0,
          durationMs: Date.now() - startTime,
          errors: ['Binary or non-text file skipped'],
        };
      }
      content = raw.toString('utf8');
    } catch (error: unknown) {
      return {
        filePath,
        functionsFound: 0,
        functionsIndexed: 0,
        moduleIndexed: false,
        contextPacksCreated: 0,
        durationMs: Date.now() - startTime,
        errors: [`Failed to read file: ${getErrorMessage(error)}`],
      };
    }

    const checksum = computeFileChecksum(content);
    const forceReindex = this.config.forceReindex ?? false;
    const previousChecksum = await this.storage!.getFileChecksum(filePath);
    if (!forceReindex && previousChecksum && previousChecksum === checksum) {
      const needsReindex = await this.shouldReindexArtifacts(filePath);
      if (!needsReindex) {
        await this.touchFileAccess(filePath);
        return {
          filePath,
          functionsFound: 0,
          functionsIndexed: 0,
          moduleIndexed: false,
          contextPacksCreated: 0,
          durationMs: Date.now() - startTime,
          errors: [],
        };
      }
    }

    const useAstIndexer = this.useAstIndexer && this.astIndexer !== null;
    if (useAstIndexer && !this.moduleIdCache) {
      this.moduleIdCache = await this.buildModuleIdCache();
    }

    let functions: FunctionKnowledge[] = [];
    let module: ModuleKnowledge | null = null;
    let callEdges: ResolvedCallEdge[] = [];
    let partiallyIndexed = false;
    let parserName = 'fallback'; // Default parser for non-AST indexing

    if (useAstIndexer) {
      try {
        const astResult = await this.astIndexer!.indexFile(filePath, content);
        functions = astResult.functions;
        module = astResult.module;
        callEdges = astResult.callEdges;
        partiallyIndexed = astResult.partiallyIndexed;
        parserName = astResult.parser; // Track the parser used for confidence computation
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        if (message.includes('unverified_by_trace(')) {
          throw error instanceof Error ? error : new Error(message);
        }
        errors.push(`Failed AST analysis: ${message}`);
        return {
          filePath,
          functionsFound: 0,
          functionsIndexed: 0,
          moduleIndexed: false,
          contextPacksCreated: 0,
          durationMs: Date.now() - startTime,
          errors,
        };
      }
    } else {
      functions = this.extractFunctions(filePath, content);
      module = this.extractModule(filePath, content, functions);
    }
    if (partiallyIndexed) {
      errors.push('File partially indexed (optional enrichment skipped).');
    }

    const functionsToIndex = this
      .dedupeFunctionsByName(functions)
      .slice(0, this.config.maxFunctionsPerFile);

    // Prepare writes
    let functionsIndexed = 0;
    let moduleIndexed = false;
    let contextPacksCreated = 0;
    const functionWrites: Array<{ fn: FunctionKnowledge; existed: boolean }> = [];
    const functionIndexEvents: Array<{ id: string; name: string; filePath: string }> = [];
    const entityEvents: Array<{
      entityType: 'function' | 'module' | 'context_pack';
      entityId: string;
      filePath?: string;
      existed: boolean;
    }> = [];
    const embeddingTargets: { fn: FunctionKnowledge; request: EmbeddingRequest }[] = [];
    const allowEmbeddings =
      this.config.generateEmbeddings &&
      this.embeddingService &&
      shouldGenerateEmbeddings(filePath);

    for (const fn of functionsToIndex) {
      try {
        const existing = await this.storage!.getFunctionByPath(filePath, fn.name);
        if (existing) {
          fn.id = existing.id;
        }
        const existed = Boolean(existing);
        functionWrites.push({ fn, existed });
        entityEvents.push({
          entityType: 'function',
          entityId: fn.id,
          filePath: fn.filePath,
          existed,
        });
        functionIndexEvents.push({ id: fn.id, name: fn.name, filePath: fn.filePath });

        if (allowEmbeddings) {
          const needsEmbedding = await this.shouldGenerateEmbedding(existing, fn);
          if (needsEmbedding) {
            const embeddingText = buildEmbeddingInput(fn, content, this.embeddingTextLimit);
            this.governor?.recordTokens(estimateTokenCount(embeddingText));
            embeddingTargets.push({
              fn,
              request: {
                kind: 'code',
                text: embeddingText,
                hint: `${fn.name} (${path.basename(fn.filePath)})`,
              },
            });
          }
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        if (message.includes('unverified_by_trace(budget_exhausted)')) {
          throw error;
        }
        errors.push(`Failed to index function ${fn.name}: ${message}`);
      }
    }

    const functionEmbeddings: Array<{
      entityId: string;
      embedding: Float32Array;
      metadata: {
        modelId: string;
        generatedAt?: string;
        tokenCount?: number;
        entityType: 'function';
      };
    }> = [];
	    if (embeddingTargets.length > 0 && this.embeddingService) {
	      try {
        const requests = embeddingTargets.map((target) => target.request);
        const embeddings = await this.embeddingService.generateEmbeddings(requests, {
          governorContext: this.governor ?? undefined,
        });
        if (embeddings.length !== embeddingTargets.length) {
          throw new Error(
            `unverified_by_trace(provider_invalid_output): expected ${embeddingTargets.length} embeddings, received ${embeddings.length}`
          );
        }

        for (let i = 0; i < embeddingTargets.length; i++) {
          const target = embeddingTargets[i];
          const result = embeddings[i];
          const modelId = requireEmbeddingModelId(result.modelId, `function:${target.fn.id}`);
          validateEmbedding(result.embedding, this.config.embeddingDimension);
          functionEmbeddings.push({
            entityId: target.fn.id,
            embedding: result.embedding,
            metadata: {
              modelId,
              generatedAt: result.generatedAt,
              tokenCount: result.tokenCount,
              entityType: 'function',
            },
          });
        }
	      } catch (error: unknown) {
	        const message = getErrorMessage(error);
	        if (message.includes('unverified_by_trace(budget_exhausted)')) {
	          throw error;
	        }
	        errors.push(`Embedding generation failed; continuing without embeddings: ${message}`);
	        this.disableEmbeddingsForRun(message);
	      }
	    }

    let moduleWrite: { module: ModuleKnowledge; existed: boolean } | null = null;
    let moduleEmbedding: {
      entityId: string;
      embedding: Float32Array;
      metadata: {
        modelId: string;
        generatedAt?: string;
        tokenCount?: number;
        entityType: 'module';
      };
    } | null = null;
    let multiVectorRecord: MultiVectorRecord | null = null;
    if (module) {
      let existingModule: ModuleKnowledge | null = null;
      try {
        existingModule = await this.storage!.getModuleByPath(module.path);
        if (existingModule) {
          module.id = existingModule.id;
        }
        const existed = Boolean(existingModule);
        moduleWrite = { module, existed };
        entityEvents.push({
          entityType: 'module',
          entityId: module.id,
          filePath: module.path,
          existed,
        });
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        errors.push(`Failed to index module metadata: ${message}`);
      }

	      if (moduleWrite && allowEmbeddings && this.embeddingService) {
	        try {
          const needsEmbedding = await this.shouldGenerateModuleEmbedding(existingModule, module);
          if (needsEmbedding) {
            const embeddingText = buildModuleEmbeddingInput(module, functionsToIndex, content, this.embeddingTextLimit);
            this.governor?.recordTokens(estimateTokenCount(embeddingText));
            const result = await this.embeddingService.generateEmbedding({
              kind: 'code',
              text: embeddingText,
              hint: `${path.basename(module.path)}`,
            }, { governorContext: this.governor ?? undefined });
            const modelId = requireEmbeddingModelId(result.modelId, `module:${module.id}`);
            validateEmbedding(result.embedding, this.config.embeddingDimension);
            moduleEmbedding = {
              entityId: module.id,
              embedding: result.embedding,
              metadata: {
                modelId,
                generatedAt: result.generatedAt,
                tokenCount: result.tokenCount,
                entityType: 'module',
              },
            };
          }
	          multiVectorRecord = await this.buildMultiVectorRecord(module, content, needsEmbedding);
	        } catch (error: unknown) {
	          const message = getErrorMessage(error);
	          if (message.includes('unverified_by_trace(budget_exhausted)')) {
	            throw error;
	          }
	          errors.push(`Module embedding generation failed; continuing without embeddings: ${message}`);
	          if (message.includes('unverified_by_trace(provider_unavailable)') || message.includes('unverified_by_trace(provider_invalid_output)')) {
	            this.disableEmbeddingsForRun(message);
	          }
	        }
	      }
	    }

    const indexedFunctionIds = new Set(functionWrites.map(({ fn }) => fn.id));
    const graphEdges = this.buildGraphEdges(
      filePath,
      moduleWrite?.module ?? null,
      callEdges,
      indexedFunctionIds,
      parserName
    );

    const contextPackWrites: Array<{ pack: ContextPack; existed: boolean }> = [];
    if (this.config.createContextPacks) {
      for (const { fn } of functionWrites) {
        try {
          const pack = this.createContextPack(fn, content);
          const existingPack = await this.storage!.getContextPack(pack.packId);
          const existed = Boolean(existingPack);
          contextPackWrites.push({ pack, existed });
          entityEvents.push({
            entityType: 'context_pack',
            entityId: pack.packId,
            filePath: pack.relatedFiles[0] ?? fn.filePath,
            existed,
          });
        } catch (error: unknown) {
          errors.push(`Failed to create context pack for ${fn.name}: ${getErrorMessage(error)}`);
        }
      }
    }

    let committed = false;
    try {
      await withinTransaction(this.storage!, async (tx) => {
        for (const { fn } of functionWrites) {
          await tx.upsertFunction(fn);
        }
        for (const embedding of functionEmbeddings) {
          await tx.setEmbedding(embedding.entityId, embedding.embedding, embedding.metadata);
        }
        if (moduleWrite) {
          await tx.upsertModule(moduleWrite.module);
        }
        if (moduleEmbedding) {
          await tx.setEmbedding(moduleEmbedding.entityId, moduleEmbedding.embedding, moduleEmbedding.metadata);
        }
        if (multiVectorRecord) {
          await tx.upsertMultiVector(multiVectorRecord);
        }
        await tx.deleteGraphEdgesForSource(filePath);
        if (graphEdges.length) {
          await tx.upsertGraphEdges(graphEdges);
        }
        for (const { pack } of contextPackWrites) {
          await tx.upsertContextPack(pack);
        }
        await tx.setFileChecksum(filePath, checksum);
      });
      committed = true;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message.includes('unverified_by_trace')) {
        throw new Error(`${message} (indexing transaction for ${filePath})`);
      }
      errors.push(`Failed to persist index data: ${message}`);
    }

    if (committed) {
      functionsIndexed = functionWrites.length;
      moduleIndexed = Boolean(moduleWrite);
      contextPacksCreated = contextPackWrites.length;

      if (moduleWrite && this.moduleIdCache) {
        this.moduleIdCache.set(normalizeGraphPath(moduleWrite.module.path), moduleWrite.module.id);
      }
      for (const event of entityEvents) {
        this.emitEntityChange(event.entityType, event.entityId, event.filePath, event.existed);
      }
      for (const event of functionIndexEvents) {
        void globalEventBus.emit(createIndexFunctionEvent(event.id, event.name, event.filePath));
      }
    }

    // Update stats
    const durationMs = Date.now() - startTime;
    if (committed) {
      if (this.graphAccumulator) {
        const persistedFunctions = functionWrites.map(({ fn }) => fn);
        this.recordGraphData(persistedFunctions, moduleWrite?.module ?? null, callEdges);
      }
      this.updateStats(1, functionsIndexed, moduleIndexed ? 1 : 0, contextPacksCreated, durationMs);
    }

    return {
      filePath,
      functionsFound: functions.length,
      functionsIndexed,
      moduleIndexed,
      contextPacksCreated,
      durationMs,
      errors,
    };
  }

  async removeFile(filePath: string): Promise<void> {
    this.ensureReady();
    const storage = this.storage!;
    const fileRecord = await storage.getFileByPath(filePath);
    const functions = await storage.getFunctionsByPath(filePath);
    const module = await storage.getModuleByPath(filePath);
    const knowledgeRecords = await storage.getUniversalKnowledgeByFile(filePath);

    let invalidated = 0;
    await withinTransaction(storage, async (tx) => {
      await tx.deleteFileByPath(filePath);
      await tx.deleteUniversalKnowledgeByFile(filePath);
      await tx.deleteFunctionsByPath(filePath);
      if (module) {
        await tx.deleteModule(module.id);
      }
      invalidated = await tx.invalidateContextPacks(filePath);
      await tx.deleteGraphEdgesForSource(filePath);
    });

    if (fileRecord) {
      this.emitEntityDeleted('file', fileRecord.id, filePath);
    }
    for (const fn of functions) {
      this.emitEntityDeleted('function', fn.id, fn.filePath);
    }
    if (module) {
      this.emitEntityDeleted('module', module.id, module.path);
    }
    for (const record of knowledgeRecords) {
      void globalEventBus.emit(createUnderstandingInvalidatedEvent(record.id, record.kind, 'file_removed'));
    }
    if (invalidated > 0) {
      void globalEventBus.emit(createContextPacksInvalidatedEvent(filePath, invalidated));
    }
    void globalEventBus.emit(createFileDeletedEvent(filePath));
  }

  getStats(): IndexingStats {
    return { ...this.stats };
  }

  attachGraphAccumulator(accumulator: GraphAccumulator | null): void {
    this.graphAccumulator = accumulator;
  }

  private emitEntityChange(entityType: string, entityId: string, filePath: string | undefined, existed: boolean): void {
    const event = existed
      ? createEntityUpdatedEvent(entityType, entityId, filePath)
      : createEntityCreatedEvent(entityType, entityId, filePath);
    void globalEventBus.emit(event);
  }

  private emitEntityDeleted(entityType: string, entityId: string, filePath?: string): void {
    void globalEventBus.emit(createEntityDeletedEvent(entityType, entityId, filePath));
  }

  private dedupeFunctionsByName(functions: FunctionKnowledge[]): FunctionKnowledge[] {
    if (functions.length <= 1) return functions;
    const seen = new Set<string>();
    const deduped: FunctionKnowledge[] = [];
    for (let i = functions.length - 1; i >= 0; i -= 1) {
      const fn = functions[i]!;
      if (seen.has(fn.name)) continue;
      seen.add(fn.name);
      deduped.push(fn);
    }
    deduped.reverse();
    return deduped;
  }

  // Extraction Methods (Extension Points)

  /**
   * Extract functions from file content.
   * Legacy fallback (tests/deterministic mode only).
   * Production indexing uses AstIndexer (AST + LLM analysis).
   */
  protected extractFunctions(filePath: string, content: string): FunctionKnowledge[] {
    const functions: FunctionKnowledge[] = [];
    const lines = content.split('\n');

    // Regex patterns for function detection
    const patterns = [
      // Named function declarations
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      // Arrow functions assigned to const/let
      /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/,
      // Class methods
      /^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/,
      // Arrow functions in class properties
      /^\s*(?:readonly\s+)?(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
    ];

    let currentFunction: Partial<FunctionKnowledge> | null = null;
    let braceDepth = 0;
    let functionStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Track brace depth for function boundaries
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      if (currentFunction) {
        braceDepth += openBraces - closeBraces;

        if (braceDepth <= 0) {
          // Function ended
          currentFunction.endLine = lineNumber;
          functions.push(currentFunction as FunctionKnowledge);
          currentFunction = null;
          braceDepth = 0;
        }
        continue;
      }

      // Try to match function start
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const name = match[1];
          const params = match[2] || '';

          // Skip if it's a common non-function pattern
          if (['if', 'for', 'while', 'switch', 'catch'].includes(name)) {
            continue;
          }

          currentFunction = {
            id: randomUUID(),
            filePath,
            name,
            signature: this.buildSignature(name, params, line),
            purpose: this.extractPurpose(lines, i),
            startLine: lineNumber,
            endLine: lineNumber, // Will be updated when function ends
            confidence: 0.5,
            accessCount: 0,
            lastAccessed: null,
            validationCount: 0,
            outcomeHistory: { successes: 0, failures: 0 },
          };

          functionStartLine = lineNumber;
          braceDepth = openBraces - closeBraces;

          // Handle single-line functions
          if (braceDepth <= 0 && line.includes('=>') && !line.includes('{')) {
            currentFunction.endLine = lineNumber;
            functions.push(currentFunction as FunctionKnowledge);
            currentFunction = null;
          }

          break;
        }
      }
    }

    // Handle unclosed function (shouldn't happen in valid code)
    if (currentFunction) {
      currentFunction.endLine = lines.length;
      functions.push(currentFunction as FunctionKnowledge);
    }

    return functions;
  }

  /**
   * Extract module metadata from file.
   */
  protected extractModule(
    filePath: string,
    content: string,
    functions: FunctionKnowledge[]
  ): ModuleKnowledge {
    const exports: string[] = [];
    const dependencies: string[] = [];

    // Find exports
    const exportMatches = content.matchAll(/export\s+(?:const|let|function|class|interface|type)\s+(\w+)/g);
    for (const match of exportMatches) {
      exports.push(match[1]);
    }

    // Find default export
    if (content.includes('export default')) {
      exports.push('default');
    }

    // Find imports
    const importMatches = content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      dependencies.push(match[1]);
    }

    // Generate purpose from file structure
    const purpose = this.generateModulePurpose(filePath, functions, exports);

    return {
      id: randomUUID(),
      path: filePath,
      purpose,
      exports,
      dependencies,
      confidence: 0.5,
    };
  }

  /**
   * Create a context pack for a function.
   */
  protected createContextPack(
    fn: FunctionKnowledge,
    fileContent: string
  ): ContextPack {
    const lines = fileContent.split('\n');
    const startIdx = Math.max(0, fn.startLine - 1);
    const endIdx = Math.min(lines.length, fn.endLine);
    const functionCode = lines.slice(startIdx, endIdx).join('\n');
    const minimized = minimizeSnippet(functionCode);

    const snippet: CodeSnippet = {
      filePath: fn.filePath,
      startLine: fn.startLine,
      endLine: fn.endLine,
      content: minimized.text,
      language: this.getLanguage(fn.filePath),
    };

    return {
      packId: randomUUID(),
      packType: 'function_context',
      targetId: fn.id,
      summary: fn.purpose || `Function ${fn.name} in ${path.basename(fn.filePath)}`,
      keyFacts: [
        `Signature: ${fn.signature}`,
        `Lines: ${fn.startLine}-${fn.endLine}`,
        `File: ${fn.filePath}`,
      ],
      codeSnippets: [snippet],
      relatedFiles: [fn.filePath],
      confidence: fn.confidence,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: this.getCurrentVersion(),
      invalidationTriggers: [fn.filePath],
    };
  }

  // Helper Methods

  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error('IndexLiBrainian not initialized. Call initialize() first.');
    }
  }

  private async emitGovernorReport(outcome: GovernorBudgetOutcome): Promise<void> {
    if (!this.governor || !this.config.governorReportWorkspace) return;
    const report = await this.governor.buildReport(outcome);
    await writeGovernorBudgetReport(this.config.governorReportWorkspace, report);
  }

  private async buildModuleIdCache(): Promise<Map<string, string>> {
    if (!this.storage) return new Map();
    const modules = await this.storage.getModules();
    const map = new Map<string, string>();
    for (const module of modules) {
      map.set(normalizeGraphPath(module.path), module.id);
    }
    return map;
  }

  private async shouldReindexArtifacts(filePath: string): Promise<boolean> {
    if (!this.storage) return true;
    const statsStore = this.storage as LiBrainianStorage & {
      getFileIndexStats?: (path: string) => Promise<{ functions: number; modules: number; embeddings: number; moduleEmbeddings: number; contextPacks: number }>;
    };
    if (!statsStore.getFileIndexStats) return true;
    const stats = await statsStore.getFileIndexStats(filePath);
    const hasArtifacts = stats.functions + stats.modules + stats.contextPacks > 0;
    if (!hasArtifacts) return true;
    if (this.config.generateEmbeddings && stats.functions > 0 && stats.embeddings < stats.functions) return true;
    if (this.config.generateEmbeddings && stats.modules > 0 && stats.moduleEmbeddings < stats.modules) return true;
    if (this.config.createContextPacks && stats.functions > 0 && stats.contextPacks < stats.functions) return true;
    return false;
  }

  private async touchFileAccess(filePath: string): Promise<void> {
    if (!this.storage) return;
    const accessStore = this.storage as LiBrainianStorage & { touchFileAccess?: (path: string) => Promise<void> };
    if (accessStore.touchFileAccess) {
      await accessStore.touchFileAccess(filePath);
    }
  }

  private recordGraphData(
    functions: FunctionKnowledge[],
    module: ModuleKnowledge | null,
    callEdges: ResolvedCallEdge[]
  ): void {
    const accumulator = this.graphAccumulator;
    if (!accumulator) return;
    for (const fn of functions) {
      if (!accumulator.functionGraph.has(fn.id)) {
        accumulator.functionGraph.set(fn.id, new Set());
      }
    }
    for (const edge of callEdges) {
      const neighbors = accumulator.functionGraph.get(edge.fromId);
      if (neighbors) {
        neighbors.add(edge.toId);
      }
    }
    if (module) {
      const normalized = normalizeGraphPath(module.path);
      accumulator.moduleIdByPath.set(normalized, module.id);
      accumulator.modulePathById.set(module.id, normalized);
      accumulator.moduleDepsById.set(module.id, module.dependencies);
    }
  }

  private async persistGraphMetrics(accumulator: GraphAccumulator): Promise<void> {
    if (!this.storage) return;
    const moduleGraph = new Map<string, Set<string>>();
    for (const moduleId of accumulator.modulePathById.keys()) {
      moduleGraph.set(moduleId, new Set());
    }
    for (const [moduleId, deps] of accumulator.moduleDepsById) {
      const fromPath = accumulator.modulePathById.get(moduleId);
      if (!fromPath) continue;
      const edges = moduleGraph.get(moduleId) ?? new Set<string>();
      for (const dep of deps) {
        const target = resolveModuleDependency(dep, fromPath, accumulator.moduleIdByPath);
        if (target) edges.add(target);
      }
      moduleGraph.set(moduleId, edges);
    }
    const { metrics, report } = computeGraphMetrics({
      function: accumulator.functionGraph,
      module: moduleGraph,
    });
    const metricsStore = this.storage as { setGraphMetrics?: (entries: GraphMetricsEntry[]) => Promise<void> };
    if (metricsStore.setGraphMetrics) {
      await metricsStore.setGraphMetrics(metrics);
    }
    if (this.config.workspaceRoot) {
      await writeGraphMetricsReport(this.config.workspaceRoot, report);
    }
  }

  private async materializeStrategicContracts(): Promise<number> {
    if (!this.storage) return 0;

    const strategicStore = this.storage as LiBrainianStorage & {
      upsertStrategicContracts?: (contracts: StrategicContractRecord[]) => Promise<void>;
    };
    if (typeof strategicStore.upsertStrategicContracts !== 'function') {
      return 0;
    }

    const modules = await this.storage.getModules();
    if (modules.length === 0) return 0;

    const moduleIdByPath = new Map<string, string>();
    const consumersByProvider = new Map<string, Set<string>>();
    for (const module of modules) {
      moduleIdByPath.set(normalizeGraphPath(module.path), module.id);
      consumersByProvider.set(module.id, new Set<string>());
    }

    for (const module of modules) {
      const fromPath = normalizeGraphPath(module.path);
      for (const dependency of module.dependencies) {
        const providerId = resolveModuleDependency(dependency, fromPath, moduleIdByPath);
        if (!providerId || providerId === module.id) continue;
        const consumers = consumersByProvider.get(providerId);
        if (consumers) {
          consumers.add(module.id);
        }
      }
    }

    const nowIso = new Date().toISOString();
    const candidates = modules.filter((module) => module.exports.length > 0);
    const selected = candidates.length > 0 ? candidates : modules.slice(0, 1);
    const contracts: StrategicContractRecord[] = selected.map((module) => {
      const consumers = Array.from(consumersByProvider.get(module.id) ?? []).sort((a, b) => a.localeCompare(b));
      return {
        id: `strategic-contract:${module.id}:public-api`,
        contractType: 'api',
        name: `${path.basename(module.path)} public API`,
        version: '1.0.0',
        location: module.path,
        breaking: false,
        consumers,
        producers: [module.id],
        evidence: [
          `module:${module.path}`,
          `exports:${module.exports.length}`,
          `dependencies:${module.dependencies.length}`,
        ],
        updatedAt: nowIso,
      };
    });

    if (contracts.length === 0) return 0;
    await strategicStore.upsertStrategicContracts(contracts);
    return contracts.length;
  }

  private buildGraphEdges(
    filePath: string,
    module: ModuleKnowledge | null,
    callEdges: ResolvedCallEdge[],
    indexedFunctionIds: Set<string>,
    parserName: string = 'ts-morph'
  ): GraphEdge[] {
    const now = new Date();
    const edges: GraphEdge[] = [];
    const callsByCaller = new Map<string, Set<string>>();

    // Process call edges with quality-based confidence using ambiguity metadata
    for (const edge of callEdges) {
      const fromResolved = indexedFunctionIds.has(edge.fromId);

      // Skip edges where source is not indexed
      if (!fromResolved) continue;

      // Compute confidence based on extraction quality using metadata
      // The edge already carries targetResolved, isAmbiguous, overloadCount
      const hasSourceLine = edge.sourceLine != null;
      const confidence = computeCallEdgeConfidence(
        hasSourceLine,
        edge.targetResolved,
        parserName,
        edge.overloadCount // Use tracked overload count from resolution
      );

      edges.push({
        fromId: edge.fromId,
        fromType: 'function',
        toId: edge.toId,
        toType: 'function',
        edgeType: 'calls',
        sourceFile: filePath,
        sourceLine: edge.sourceLine ?? null,
        confidence,
        computedAt: now,
      });

      const callees = callsByCaller.get(edge.fromId) ?? new Set<string>();
      callees.add(edge.toId);
      callsByCaller.set(edge.fromId, callees);
    }

    // Semantic entanglement fallback (co-call approximation):
    // if two functions are frequently invoked by the same caller, treat them as behaviorally coupled.
    const entanglementCounts = new Map<string, number>();
    for (const callees of callsByCaller.values()) {
      const ids = Array.from(callees).sort();
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const pairKey = `${ids[i]}::${ids[j]}`;
          entanglementCounts.set(pairKey, (entanglementCounts.get(pairKey) ?? 0) + 1);
        }
      }
    }
    for (const [pairKey, count] of entanglementCounts) {
      const [left, right] = pairKey.split('::');
      if (!left || !right) continue;
      const confidence = Math.min(0.95, 0.55 + (count * 0.15));
      edges.push({
        fromId: left,
        fromType: 'function',
        toId: right,
        toType: 'function',
        edgeType: 'entangled',
        sourceFile: filePath,
        sourceLine: null,
        confidence,
        computedAt: now,
      });
      edges.push({
        fromId: right,
        fromType: 'function',
        toId: left,
        toType: 'function',
        edgeType: 'entangled',
        sourceFile: filePath,
        sourceLine: null,
        confidence,
        computedAt: now,
      });
    }

    // Process import edges with quality-based confidence
    if (module && this.moduleIdCache) {
      const fromPath = normalizeGraphPath(module.path);
      const moduleIdByPath = this.moduleIdCache;
      for (const dep of module.dependencies) {
        const target = resolveModuleDependency(dep, fromPath, moduleIdByPath);
        const targetResolved = target != null;

        // Compute confidence for import edge
        const confidence = computeImportEdgeConfidence(
          targetResolved,
          parserName
        );

        // For unresolved imports, still create edge but with lower confidence
        // This captures external dependencies
        edges.push({
          fromId: module.id,
          fromType: 'module',
          toId: target ?? `external:${dep}`,
          toType: 'module',
          edgeType: 'imports',
          sourceFile: filePath,
          sourceLine: null,
          confidence,
          computedAt: now,
        });
      }
    }
    return edges;
  }

  private shouldProcessFile(filePath: string): boolean {
    const normalizedAbsolute = filePath.replace(/\\/g, '/');
    let normalizedRelative: string | null = null;
    if (this.config.workspaceRoot) {
      const relativePath = path.relative(this.config.workspaceRoot, filePath).replace(/\\/g, '/');
      if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        normalizedRelative = relativePath;
      }
    }
    const candidatePaths = normalizedRelative ? [normalizedRelative, normalizedAbsolute] : [normalizedAbsolute];

    for (const pattern of this.config.excludePatterns) {
      if (candidatePaths.some((value) => pattern.test(value))) {
        return false;
      }
    }

    if (normalizedRelative && isExcluded(normalizedRelative)) {
      return false;
    }

    if (this.config.extensions.length > 0) {
      const ext = path.extname(normalizedAbsolute).toLowerCase();
      if (!this.config.extensions.includes(ext)) {
        return false;
      }
    }

    return true;
  }

  private disableEmbeddingsForRun(reason: string): void {
    if (!this.config.generateEmbeddings) return;
    this.config.generateEmbeddings = false;
    this.embeddingService = null;
    logWarning('[index_librarian] Embeddings disabled for remainder of run', { reason });
  }

  private isBinarySuspiciousByte(byte: number): boolean {
    return byte === 0 || (byte < 9) || (byte > 13 && byte < 32);
  }

  private isProbablyBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8000);
    if (sampleSize === 0) return false;
    let suspicious = 0;
    for (let i = 0; i < sampleSize; i += 1) {
      if (this.isBinarySuspiciousByte(buffer[i])) suspicious += 1;
    }
    return suspicious / sampleSize > 0.3;
  }

  private buildSignature(name: string, params: string, line: string): string {
    // Try to extract return type
    const returnMatch = line.match(/\)\s*:\s*([^{=]+)/);
    const returnType = returnMatch ? returnMatch[1].trim() : 'unknown';

    return `${name}(${params}): ${returnType}`;
  }

  private extractPurpose(lines: string[], functionLineIndex: number): string {
    // Look for JSDoc comment above function
    const searchStart = Math.max(0, functionLineIndex - 10);
    let docComment = '';

    for (let i = functionLineIndex - 1; i >= searchStart; i--) {
      const line = lines[i].trim();

      if (line.startsWith('*/')) {
        // Found end of JSDoc, collect it
        for (let j = i; j >= searchStart; j--) {
          const docLine = lines[j].trim();
          docComment = docLine + '\n' + docComment;
          if (docLine.startsWith('/**')) {
            break;
          }
        }
        break;
      }

      // Skip empty lines
      if (line === '') continue;

      // If we hit code, stop looking
      if (!line.startsWith('*') && !line.startsWith('//')) {
        break;
      }
    }

    // Extract @description or first line of JSDoc
    if (docComment) {
      const descMatch = docComment.match(/@description\s+(.+)/);
      if (descMatch) {
        return descMatch[1].trim();
      }

      // Get first meaningful line
      const lines = docComment.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[\s/*]+/, '').trim();
        if (cleaned && !cleaned.startsWith('@')) {
          return cleaned;
        }
      }
    }

    return '';
  }

  private generateModulePurpose(
    filePath: string,
    functions: FunctionKnowledge[],
    exports: string[]
  ): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    const functionNames = functions.map((f) => f.name).slice(0, 5);

    if (exports.length > 0) {
      return `Module ${fileName} exporting ${exports.slice(0, 3).join(', ')}${exports.length > 3 ? '...' : ''}`;
    }

    if (functionNames.length > 0) {
      return `Module ${fileName} containing ${functionNames.join(', ')}${functions.length > 5 ? '...' : ''}`;
    }

    return `Module ${fileName}`;
  }

  private getLanguage(filePath: string): string {
    return getLanguageFromPath(filePath, 'plaintext');
  }

  private async shouldGenerateEmbedding(
    existing: FunctionKnowledge | null,
    current: FunctionKnowledge
  ): Promise<boolean> {
    if (!existing) return true;
    if (this.hasFunctionChanged(existing, current)) return true;
    const existingEmbedding = await this.storage!.getEmbedding(existing.id);
    if (!existingEmbedding) return true;
    return existingEmbedding.length !== this.config.embeddingDimension;
  }

  private async shouldGenerateModuleEmbedding(
    existing: ModuleKnowledge | null,
    current: ModuleKnowledge
  ): Promise<boolean> {
    if (!existing) return true;
    if (existing.purpose !== current.purpose) return true;
    if (existing.exports.join(',') !== current.exports.join(',')) return true;
    if (existing.dependencies.join(',') !== current.dependencies.join(',')) return true;
    const existingEmbedding = await this.storage!.getEmbedding(existing.id);
    if (!existingEmbedding) return true;
    return existingEmbedding.length !== this.config.embeddingDimension;
  }

  private async buildMultiVectorRecord(
    module: ModuleKnowledge,
    content: string,
    needsModuleEmbedding: boolean
  ): Promise<MultiVectorRecord | null> {
    if (!this.storage) return null;
    const existing = await this.storage.getMultiVector(module.id, 'module').catch((err) => {
      logWarning('[index_librarian] Failed to fetch existing multi-vector record', { moduleId: module.id, error: getErrorMessage(err) });
      return null;
    });
    if (existing && !needsModuleEmbedding) return null;
    // SECURITY: Validate embedding model BEFORE any operations.
    // Trust boundary: config is populated by internal IndexLiBrainian constructor,
    // not directly from user input. External config files are validated at load time.
    const ALLOWED_EMBEDDING_MODELS = ['all-MiniLM-L6-v2', 'jina-embeddings-v2-base-en', 'bge-small-en-v1.5'] as const;
    type AllowedEmbeddingModel = (typeof ALLOWED_EMBEDDING_MODELS)[number];
    const isAllowedModel = (m: string): m is AllowedEmbeddingModel =>
      (ALLOWED_EMBEDDING_MODELS as readonly string[]).includes(m);
    const rawModelId = this.config.embeddingModelId ?? 'all-MiniLM-L6-v2';
    if (!isAllowedModel(rawModelId)) {
      // Sanitize before logging to prevent injection attacks
      const sanitized = String(rawModelId).slice(0, 100).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
      throw new Error(`Invalid embedding model: ${sanitized}. Allowed: ${ALLOWED_EMBEDDING_MODELS.join(', ')}`);
    }
    // rawModelId is now type-narrowed to AllowedEmbeddingModel by the type guard
    const modelId = rawModelId;
    try {
      const multiVector = await generateMultiVector(module.path, content, {
        modelId,
        llmPurpose: module.purpose || undefined,
      });
      const payload = serializeMultiVector(multiVector);
      const tokenCount = estimateTokenCount(
        [
          payload.semanticInput,
          payload.structuralInput,
          payload.dependencyInput,
          payload.usageInput,
        ].filter(Boolean).join('\n')
      );
      this.governor?.recordTokens(tokenCount);
      return {
        entityId: module.id,
        entityType: 'module',
        payload,
        modelId: payload.modelId ?? modelId,
        generatedAt: new Date().toISOString(),
        tokenCount,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message.includes('unverified_by_trace')) {
        throw new Error(`${message} (multi-vector embedding for ${module.path})`);
      }
      throw error;
    }
  }

  private async storeMultiVectorEmbedding(
    module: ModuleKnowledge,
    content: string,
    needsModuleEmbedding: boolean
  ): Promise<void> {
    if (!this.storage) return;
    const record = await this.buildMultiVectorRecord(module, content, needsModuleEmbedding);
    if (!record) return;
    await this.storage.upsertMultiVector(record);
  }

  private hasFunctionChanged(existing: FunctionKnowledge, current: FunctionKnowledge): boolean {
    return (
      existing.signature !== current.signature ||
      existing.purpose !== current.purpose ||
      existing.startLine !== current.startLine ||
      existing.endLine !== current.endLine
    );
  }

  private getCurrentVersion(): LiBrainianVersion {
    return {
      major: LIBRARIAN_VERSION.major,
      minor: LIBRARIAN_VERSION.minor,
      patch: LIBRARIAN_VERSION.patch,
      string: LIBRARIAN_VERSION.string,
      qualityTier: this.qualityTier,
      indexedAt: new Date(),
      indexerVersion: `${this.agentType}@${this.version}`,
      features: [...LIBRARIAN_VERSION.features],
    };
  }

  private updateStats(
    files: number,
    functions: number,
    modules: number,
    packs: number,
    durationMs: number
  ): void {
    this.stats.totalFilesIndexed += files;
    this.stats.totalFunctionsIndexed += functions;
    this.stats.totalModulesIndexed += modules;
    this.stats.totalContextPacksCreated += packs;
    this.totalProcessingTime += durationMs;
    this.stats.averageFileProcessingMs =
      this.totalProcessingTime / this.stats.totalFilesIndexed;
    this.stats.lastIndexingTime = new Date();
  }

  /**
   * Resolve external call edges to actual function IDs.
   *
   * During file-by-file indexing, cross-file function calls are stored with
   * "external:functionName" as the toId because the target function may not
   * have been indexed yet. This method resolves those external references
   * to actual function IDs after all files have been processed.
   *
   * This enables accurate call graph queries like "what functions call X?"
   */
  async resolveExternalCallEdges(): Promise<{ resolved: number; total: number }> {
    if (!this.storage) return { resolved: 0, total: 0 };

    // Get all edges with external: prefix in toId
    const externalEdges = await this.storage.getGraphEdges({
      edgeTypes: ['calls'],
    });

    const unresolvedEdges = externalEdges.filter(
      (edge) => edge.toId.startsWith('external:')
    );

    if (unresolvedEdges.length === 0) {
      return { resolved: 0, total: 0 };
    }

    // Build a map of function name -> function ID(s)
    // We need to get all functions to build this map
    const allFunctions = await this.storage.getFunctions({ limit: 100000 });
    const functionsByName = new Map<string, FunctionKnowledge[]>();
    for (const fn of allFunctions) {
      const list = functionsByName.get(fn.name) ?? [];
      list.push(fn);
      functionsByName.set(fn.name, list);
    }

    // Resolve each external edge
    const resolvedEdges: GraphEdge[] = [];
    const now = new Date();

    for (const edge of unresolvedEdges) {
      const targetName = edge.toId.slice('external:'.length);
      const candidates = functionsByName.get(targetName);

      if (!candidates || candidates.length === 0) {
        // Still external - keep as is
        continue;
      }

      // If there's exactly one match, we can confidently resolve it
      // If there are multiple matches, pick the first one but mark with lower confidence
      const target = candidates[0];
      const isAmbiguous = candidates.length > 1;

      // Recompute confidence for resolved edge
      const hasSourceLine = edge.sourceLine != null;
      const confidence = computeCallEdgeConfidence(
        hasSourceLine,
        true, // targetResolved
        'ts-morph', // Default parser assumption
        candidates.length
      );

      resolvedEdges.push({
        fromId: edge.fromId,
        fromType: edge.fromType,
        toId: target.id,
        toType: 'function',
        edgeType: 'calls',
        sourceFile: edge.sourceFile,
        sourceLine: edge.sourceLine,
        confidence: isAmbiguous ? Math.min(confidence, 0.75) : confidence,
        computedAt: now,
      });
    }

    // Upsert resolved edges (this will update the existing external: edges)
    if (resolvedEdges.length > 0) {
      await this.storage.upsertGraphEdges(resolvedEdges);
    }

    return { resolved: resolvedEdges.length, total: unresolvedEdges.length };
  }
}

export function buildEmbeddingInput(
  fn: FunctionKnowledge,
  fileContent: string,
  maxChars: number = DEFAULT_EMBEDDING_INPUT_LIMIT,
): string {
  const lines = fileContent.split('\n');
  const startIdx = Math.max(0, fn.startLine - 1);
  const endIdx = Math.min(lines.length, fn.endLine);
  const snippet = lines.slice(startIdx, endIdx).join('\n');

  const parts = [
    `Function: ${fn.name}`,
    `Signature: ${fn.signature}`,
    fn.purpose ? `Purpose: ${fn.purpose}` : '',
    `File: ${fn.filePath}`,
    'Code:',
    snippet,
  ].filter(Boolean);

  return truncateEmbeddingInput(parts.join('\n'), maxChars);
}

export function buildModuleEmbeddingInput(
  mod: ModuleKnowledge,
  functions: FunctionKnowledge[],
  fileContent: string,
  maxChars: number = DEFAULT_EMBEDDING_INPUT_LIMIT,
): string {
  const topFunctions = functions.map((fn) => fn.name).slice(0, 8).join(', ');
  const exports = mod.exports.slice(0, 8).join(', ') || 'none';
  const dependencies = mod.dependencies.slice(0, 8).join(', ') || 'none';
  const snippet = fileContent.split('\n').slice(0, 80).join('\n');

  const parts = [
    `Module: ${path.basename(mod.path)}`,
    `Purpose: ${mod.purpose || 'n/a'}`,
    `Exports: ${exports}`,
    `Dependencies: ${dependencies}`,
    topFunctions ? `Functions: ${topFunctions}` : '',
    `File: ${mod.path}`,
    'Code:',
    snippet,
  ].filter(Boolean);

  return truncateEmbeddingInput(parts.join('\n'), maxChars);
}

function truncateEmbeddingInput(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

export function resolveEmbeddingInputLimit(embeddingModelId?: string): number {
  try {
    return Math.max(DEFAULT_EMBEDDING_INPUT_LIMIT, getEmbeddingConfig(embeddingModelId).contextWindow);
  } catch {
    return DEFAULT_EMBEDDING_INPUT_LIMIT;
  }
}

function validateEmbedding(embedding: Float32Array, dimension: number): void {
  if (!(embedding instanceof Float32Array)) {
    throw new Error('unverified_by_trace(provider_invalid_output): embedding is not Float32Array');
  }
  if (embedding.length !== dimension) {
    throw new Error(
      `unverified_by_trace(provider_invalid_output): embedding dimension mismatch (${embedding.length} != ${dimension})`
    );
  }
  let norm = 0;
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('unverified_by_trace(provider_invalid_output): embedding contains non-finite values');
    }
    norm += value * value;
  }
  const magnitude = Math.sqrt(norm);
  // Allow ~1% drift from floating-point normalization.
  if (!Number.isFinite(magnitude) || magnitude < 0.99 || magnitude > 1.01) {
    throw new Error(
      `unverified_by_trace(provider_invalid_output): embedding is not normalized (norm=${magnitude})`
    );
  }
}

export function requireEmbeddingModelId(value: string | undefined, context: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`unverified_by_trace(embedding_missing_model_id): ${context}`);
  }
  return trimmed;
}

function createGraphAccumulator(): GraphAccumulator {
  return {
    functionGraph: new Map(),
    moduleIdByPath: new Map(),
    modulePathById: new Map(),
    moduleDepsById: new Map(),
  };
}

function resolveModuleDependency(
  dependency: string,
  fromPath: string,
  moduleIdByPath: Map<string, string>
): string | null {
  if (!dependency.startsWith('.') && !dependency.startsWith('/')) return null;
  const direct = moduleIdByPath.get(normalizeGraphPath(dependency));
  if (direct) return direct;
  const base = dependency.startsWith('/')
    ? normalizeGraphPath(dependency)
    : normalizeGraphPath(path.resolve(path.dirname(fromPath), dependency));
  const candidates = new Set<string>([base]);
  const ext = path.extname(base);
  const addCandidates = (root: string, includeIndex: boolean): void => {
    for (const nextExt of RESOLVE_EXTENSIONS) {
      candidates.add(`${root}${nextExt}`);
      if (includeIndex) {
        candidates.add(path.join(root, `index${nextExt}`));
      }
    }
  };
  if (!ext) {
    addCandidates(base, true);
  } else if (RESOLVE_EXTENSIONS.includes(ext)) {
    const withoutExt = base.slice(0, -ext.length);
    if (withoutExt && withoutExt !== base) {
      addCandidates(withoutExt, false);
    }
  }
  for (const candidate of candidates) {
    const resolved = moduleIdByPath.get(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function normalizeGraphPath(value: string): string {
  return path.normalize(path.resolve(value));
}

type FileTimeoutPolicy = NonNullable<IndexLiBrainianConfig['fileTimeoutPolicy']>;

function normalizeFileTimeoutMs(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_FILE_TIMEOUT_MS);
}

function normalizeFileTimeoutRetries(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_FILE_TIMEOUT_RETRIES);
}

function normalizeFileTimeoutPolicy(value?: IndexLiBrainianConfig['fileTimeoutPolicy']): FileTimeoutPolicy {
  if (value === 'skip' || value === 'retry' || value === 'fail') return value;
  return 'skip';
}

function sanitizePathForLog(value: string): string {
  const cleaned = removeControlChars(value);
  if (cleaned.length > 300) {
    return `${cleaned.slice(0, 297)}...`;
  }
  return cleaned;
}

function createFileTimeoutError(filePath: string, timeoutMs: number): Error {
  const safePath = sanitizePathForLog(filePath);
  const error = new Error(`unverified_by_trace(file_timeout): ${safePath} (${timeoutMs}ms)`);
  (error as { code?: string }).code = 'file_timeout';
  return error;
}

function isFileTimeoutError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === 'file_timeout') return true;
  }
  return error instanceof Error && error.message.includes('unverified_by_trace(file_timeout)');
}

function resolveCodeExtensions(): string[] {
  const extensions = new Set<string>();
  for (const pattern of UNIVERSAL_FILE_PATTERNS.code.patterns) {
    const match = pattern.match(/\*\*\/\*\.([a-zA-Z0-9]+)$/);
    if (match?.[1]) {
      extensions.add(`.${match[1].toLowerCase()}`);
    }
  }
  return Array.from(extensions.values());
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createIndexLiBrainian(
  config?: Partial<IndexLiBrainianConfig>
): IndexLiBrainian {
  return new IndexLiBrainian(config);
}

export type IndexLibrarianConfig = IndexLiBrainianConfig;

// Backward-compatible alias for legacy imports that still reference IndexLibrarian.
export { IndexLiBrainian as IndexLibrarian };
export function createIndexLibrarian(
  config?: Partial<IndexLiBrainianConfig>
): IndexLiBrainian {
  return createIndexLiBrainian(config);
}
