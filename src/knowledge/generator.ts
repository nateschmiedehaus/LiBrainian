/**
 * @fileoverview Universal Knowledge Generator
 *
 * Orchestrates the generation of UniversalKnowledge records for code entities.
 * Combines multiple extraction strategies:
 * - AST analysis for structural information
 * - LLM analysis for semantic understanding
 * - Static analysis for quality metrics
 * - Git history for ownership and evolution
 * - Test coverage for verification data
 *
 * Each section is generated independently with its own confidence score,
 * allowing partial knowledge when some extractors fail.
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import type { LibrarianStorage, UniversalKnowledgeRecord } from '../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge, GraphEdge } from '../types.js';
import {
  type UniversalKnowledge,
  type KnowledgeMeta,
  type EntityKind,
  type CallReference,
  createEmptyKnowledge,
} from './universal_types.js';
import { LibrarianEvent, LibrarianEventType } from '../types.js';
import { extractQuality } from './extractors/quality_extractor.js';
import {
  extractSemanticsWithLLM,
  type SemanticsExtraction,
  type SemanticsInput,
} from './extractors/index.js';
// New extractors for comprehensive knowledge
import { extractSecurityWithLLM, type SecurityExtraction, type SecurityInput } from './extractors/security_extractor.js';
import { extractTesting, type TestingInput } from './extractors/testing_extractor.js';
import { extractHistory, extractOwnership, type HistoryInput, type OwnershipInput } from './extractors/history_extractor.js';
import { extractRationaleWithLLM, type RationaleExtraction, type RationaleInput } from './extractors/rationale_extractor.js';
import { extractTraceability, type TraceabilityInput } from './extractors/traceability_extractor.js';
import { collectEvidence, type EvidenceCollectionInput } from './extractors/evidence_collector.js';
import { extractRelationships, type RelationshipsInput } from './extractors/relationships_extractor.js';
import { ProviderUnavailableError } from '../api/provider_check.js';
import type { ActivationSummary, DefeaterCheckContext } from './defeater_activation.js';
import { withTimeout } from '../utils/async.js';

// ============================================================================
// GENERATOR TYPES
// ============================================================================

export interface KnowledgeGeneratorConfig {
  /** Storage instance for persisting knowledge */
  storage: LibrarianStorage;

  /** Workspace root path */
  workspace: string;

  /** LLM provider for semantic extraction */
  llmProvider?: 'claude' | 'codex';

  /** Model ID for LLM calls */
  llmModelId?: string;

  /** Maximum concurrent extractions */
  concurrency?: number;

  /** Timeout per entity in milliseconds */
  timeoutMs?: number;

  /** Event callback for progress reporting */
  onEvent?: (event: LibrarianEvent) => void;

  /** Skip expensive LLM calls (for testing) */
  skipLlm?: boolean;

  /** Governor context for token tracking and budget enforcement */
  governor?: import('../api/governor_context.js').GovernorContext;

  /** Override defeater activation module loading (for testing/mocking) */
  defeaterLoader?: DefeaterActivationLoader;

  /** Progress callback for reporting generation progress */
  onProgress?: (current: number, total: number, currentItem?: string) => void;
}

export interface GenerationResult {
  totalEntities: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  errors: GenerationError[];
  durationMs: number;
}

export interface GenerationError {
  entityId: string;
  entityKind: string;
  file: string;
  error: string;
  phase: 'identity' | 'semantics' | 'contract' | 'relationships' | 'quality' | 'security' | 'runtime' | 'testing' | 'history' | 'ownership' | 'rationale' | 'context' | 'traceability';
}

export interface DefeaterActivationModule {
  checkDefeaters: (meta: KnowledgeMeta, context: DefeaterCheckContext) => Promise<ActivationSummary>;
  applyDefeaterResults: (meta: KnowledgeMeta, summary: ActivationSummary) => KnowledgeMeta;
}

export type DefeaterActivationLoader = () => Promise<DefeaterActivationModule>;

const defaultDefeaterLoader: DefeaterActivationLoader = () => import('./defeater_activation.js');
const DEFAULT_DEFEATER_TIMEOUT_MS = 2000;

function isActivationSummary(value: unknown): value is ActivationSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as ActivationSummary;
  return (
    typeof summary.totalDefeaters === 'number' &&
    typeof summary.activeDefeaters === 'number' &&
    Array.isArray(summary.results) &&
    typeof summary.knowledgeValid === 'boolean' &&
    typeof summary.confidenceAdjustment === 'number'
  );
}

/** Context passed to extraction helper methods */
interface FunctionExtractionContext {
  fn: FunctionKnowledge;
  knowledge: UniversalKnowledge;
  llmProvider: 'claude' | 'codex';
  llmModelId: string | undefined;
}

/** Aggregated results from extraction phases */
interface ExtractionResults {
  semantics?: SemanticsExtraction;
  quality?: ReturnType<typeof extractQuality>;
  security?: SecurityExtraction;
  testing?: ReturnType<typeof extractTesting>;
  history?: Awaited<ReturnType<typeof extractHistory>>;
  ownership?: Awaited<ReturnType<typeof extractOwnership>>;
  rationale?: RationaleExtraction;
  traceability?: Awaited<ReturnType<typeof extractTraceability>>;
}

// ============================================================================
// KNOWLEDGE GENERATOR
// ============================================================================

export class UniversalKnowledgeGenerator {
  private readonly config: Required<Omit<KnowledgeGeneratorConfig, 'llmProvider' | 'llmModelId' | 'onEvent' | 'governor' | 'onProgress'>> & Pick<KnowledgeGeneratorConfig, 'llmProvider' | 'llmModelId' | 'onEvent' | 'governor' | 'onProgress'>;

  constructor(config: KnowledgeGeneratorConfig) {
    this.config = {
      ...config,
      concurrency: config.concurrency ?? 4,
      timeoutMs: config.timeoutMs ?? 0,
      skipLlm: config.skipLlm ?? false,
      defeaterLoader: config.defeaterLoader ?? defaultDefeaterLoader,
    };
  }

  /**
   * Generate knowledge for all indexed entities (functions and modules).
   * Handles failures gracefully - individual entity failures don't stop the batch.
   */
  async generateAll(): Promise<GenerationResult> {
    const startTime = Date.now();
    const errors: GenerationError[] = [];
    let successCount = 0;
    let failureCount = 0;
    let partialCount = 0;

    this.ensureLlmConfigured();
    // After ensureLlmConfigured(), provider is guaranteed to exist. Capture in local vars for TypeScript.
    const llmProvider = this.config.llmProvider as 'claude' | 'codex';
    const llmModelId = this.config.llmModelId;

    // Get all indexed entities with error handling
    let functions: FunctionKnowledge[] = [];
    let modules: ModuleKnowledge[] = [];

    try {
      functions = await this.config.storage.getFunctions();
    } catch (error) {
      errors.push({
        entityId: 'storage',
        entityKind: 'system',
        file: '',
        error: `Failed to load functions: ${error instanceof Error ? error.message : String(error)}`,
        phase: 'identity',
      });
    }

    try {
      modules = await this.config.storage.getModules();
    } catch (error) {
      errors.push({
        entityId: 'storage',
        entityKind: 'system',
        file: '',
        error: `Failed to load modules: ${error instanceof Error ? error.message : String(error)}`,
        phase: 'identity',
      });
    }

    // Early exit if no entities
    if (functions.length === 0 && modules.length === 0) {
      this.emit('understanding_generation_complete', {
        successCount: 0,
        failureCount: 0,
        partialCount: 0,
        errorCount: errors.length,
        durationMs: Date.now() - startTime,
        reason: 'no_entities',
      });
      return {
        totalEntities: 0,
        successCount: 0,
        failureCount: 0,
        partialCount: 0,
        errors,
        durationMs: Date.now() - startTime,
      };
    }

    this.emit('understanding_generation_started', {
      functionCount: functions.length,
      moduleCount: modules.length,
    });

    const totalEntities = functions.length + modules.length;
    const overallDeadline = this.config.timeoutMs > 0 ? startTime + (this.config.timeoutMs * totalEntities) : Number.POSITIVE_INFINITY;
    let timedOut = false;
    let processedEntities = 0;
    const checkTimeout = (): boolean => {
      if (timedOut) return true;
      if (Date.now() <= overallDeadline) return false;
      timedOut = true;
      errors.push({
        entityId: 'timeout',
        entityKind: 'system',
        file: '',
        error: 'Overall generation timeout exceeded',
        phase: 'identity',
      });
      return true;
    };

    const runConcurrent = async <T>(items: T[], handler: (item: T) => Promise<void>, getItemName?: (item: T) => string): Promise<void> => {
      if (!items.length || checkTimeout()) return;
      const concurrency = Math.max(1, Math.min(this.config.concurrency, items.length));
      let index = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (true) {
          const current = index++;
          if (current >= items.length || checkTimeout()) break;
          const item = items[current];
          // Report progress
          this.config.onProgress?.(processedEntities, totalEntities, getItemName?.(item));
          await handler(item);
          processedEntities++;
        }
      }));
    };

    await runConcurrent(functions, async (fn) => {
      try {
        const result = await withTimeout(
          this.generateForFunction(fn),
          this.config.timeoutMs,
          { context: `Function ${fn.name} in ${fn.filePath}` }
        );
        if (result.success) {
          if (result.partial) {
            partialCount++;
          } else {
            successCount++;
          }
        } else {
          failureCount++;
          errors.push(...result.errors);
        }
      } catch (error) {
        failureCount++;
        errors.push({
          entityId: fn.id || 'unknown',
          entityKind: 'function',
          file: fn.filePath || 'unknown',
          error: this.formatError(error),
          phase: this.classifyErrorPhase(error),
        });
      }
    }, (fn) => fn.filePath || fn.name || 'unknown');

    await runConcurrent(modules, async (mod) => {
      try {
        const result = await withTimeout(
          this.generateForModule(mod),
          this.config.timeoutMs,
          { context: `Module ${mod.path}` }
        );
        if (result.success) {
          if (result.partial) {
            partialCount++;
          } else {
            successCount++;
          }
        } else {
          failureCount++;
          errors.push(...result.errors);
        }
      } catch (error) {
        failureCount++;
        errors.push({
          entityId: mod.id || 'unknown',
          entityKind: 'module',
          file: mod.path || 'unknown',
          error: this.formatError(error),
          phase: this.classifyErrorPhase(error),
        });
      }
    }, (mod) => mod.path || 'unknown');

    const durationMs = Date.now() - startTime;

    this.emit('understanding_generation_complete', {
      successCount,
      failureCount,
      partialCount,
      errorCount: errors.length,
      durationMs,
    });

    return {
      totalEntities: functions.length + modules.length,
      successCount,
      failureCount,
      partialCount,
      errors,
      durationMs,
    };
  }

  /**
   * Format error message, handling various error types.
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      // Include stack trace for debugging in non-production
      if (process.env.NODE_ENV !== 'production' && error.stack) {
        return `${error.message}\n${error.stack.split('\n').slice(1, 4).join('\n')}`;
      }
      return error.message;
    }
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return 'Unknown error';
  }

  /**
   * Classify error to determine which phase failed.
   */
  private classifyErrorPhase(error: unknown): GenerationError['phase'] {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes('parse') || message.includes('syntax')) return 'identity';
    if (message.includes('semantic') || message.includes('purpose')) return 'semantics';
    if (message.includes('signature') || message.includes('param')) return 'contract';
    if (message.includes('import') || message.includes('depend')) return 'relationships';
    if (message.includes('complexity') || message.includes('smell')) return 'quality';
    if (message.includes('security') || message.includes('vuln')) return 'security';
    if (message.includes('runtime') || message.includes('performance')) return 'runtime';
    if (message.includes('test') || message.includes('coverage')) return 'testing';
    if (message.includes('history') || message.includes('commit')) return 'history';
    if (message.includes('owner') || message.includes('author')) return 'ownership';
    if (message.includes('rationale') || message.includes('adr') || message.includes('decision')) return 'rationale';
    if (message.includes('trace') || message.includes('require') || message.includes('issue')) return 'traceability';
    if (message.includes('context') || message.includes('env') || message.includes('config')) return 'context';

    return 'identity'; // Default phase
  }

  /**
   * Generate knowledge for a single function.
   *
   * This method orchestrates the extraction of comprehensive knowledge about a function,
   * including semantics, quality metrics, security analysis, testing info, history,
   * ownership, rationale, traceability, and relationships.
   *
   * The method is decomposed into helper methods for each extraction phase,
   * allowing partial success when individual phases fail.
   *
   * @param fn - The function knowledge from AST indexing
   * @returns Generation result with success status, partial flag, and any errors
   */
  async generateForFunction(
    fn: FunctionKnowledge
  ): Promise<{ success: boolean; partial: boolean; errors: GenerationError[] }> {
    this.ensureLlmConfigured();
    const llmProvider = this.config.llmProvider as 'claude' | 'codex';
    const llmModelId = this.config.llmModelId;
    const errors: GenerationError[] = [];

    // Phase 1: Validate input
    if (!fn) {
      return {
        success: false,
        partial: false,
        errors: [{
          entityId: 'unknown',
          entityKind: 'function',
          file: 'unknown',
          error: 'Function object is null or undefined',
          phase: 'identity',
        }],
      };
    }

    // Phase 2: Normalize input and create base knowledge
    const id = fn.id || this.computeHash(`${fn.filePath}:${fn.name}:${fn.startLine}`);
    const name = fn.name || 'anonymous';
    const filePath = fn.filePath || 'unknown';
    const startLine = Math.max(1, fn.startLine || 1);
    const endLine = Math.max(startLine, fn.endLine || startLine);

    try {
      const knowledge = createEmptyKnowledge(id, name, 'function', filePath, startLine);
      knowledge.qualifiedName = `${filePath}:${name}`;
      knowledge.location.endLine = endLine;
      knowledge.hash = this.computeHash((fn.signature || '') + (fn.purpose || name));

      // Phase 3: Check for existing unchanged record (incremental optimization)
      try {
        const existing = await this.config.storage.getUniversalKnowledge(id);
        if (existing && existing.hash === knowledge.hash) {
          this.emit('understanding_generated', {
            entityId: id,
            entityKind: 'function',
            file: filePath,
            confidence: existing.confidence,
            partial: false,
            skipped: true,
          });
          return { success: true, partial: false, errors: [] };
        }
      } catch {
        // Storage lookup failure should not block generation
      }

      // Create extraction context for helper methods
      const ctx: FunctionExtractionContext = { fn, knowledge, llmProvider, llmModelId };

      // Phase 4: Read file content for extractors that need it
      let fileContent: string | undefined;
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch {
        // File read failed - continue with limited extraction
      }

      // Phase 5: Run all extraction phases using helper methods
      const extractionResults: ExtractionResults = {};

      // 5a: Semantics (LLM)
      const semanticsResult = await this.extractSemanticsSection(ctx);
      if (semanticsResult.error) errors.push(semanticsResult.error);
      if (semanticsResult.result) extractionResults.semantics = semanticsResult.result;

      // 5b: Contract/signature parsing
      if (fn.signature && typeof fn.signature === 'string') {
        knowledge.contract.signature.raw = fn.signature;
        try {
          this.parseSignature(fn.signature, knowledge);
        } catch (parseError) {
          errors.push({
            entityId: id,
            entityKind: 'function',
            file: filePath,
            error: `Failed to parse signature: ${this.formatError(parseError)}`,
            phase: 'contract',
          });
        }
      }

      // 5c: Quality metrics
      const qualityResult = this.extractQualitySection(ctx, fileContent);
      if (qualityResult.error) errors.push(qualityResult.error);
      if (qualityResult.result) extractionResults.quality = qualityResult.result;

      // 5d: Security (LLM)
      const securityResult = await this.extractSecuritySection(ctx, fileContent);
      if (securityResult.error) errors.push(securityResult.error);
      if (securityResult.result) extractionResults.security = securityResult.result;

      // 5e: Testing
      const testingResult = this.extractTestingSection(ctx, fileContent);
      if (testingResult.error) errors.push(testingResult.error);
      if (testingResult.result) extractionResults.testing = testingResult.result;

      // 5f: History and ownership
      const historyOwnershipResult = await this.extractHistoryAndOwnershipSections(ctx, fileContent);
      errors.push(...historyOwnershipResult.errors);
      if (historyOwnershipResult.historyResult) extractionResults.history = historyOwnershipResult.historyResult;
      if (historyOwnershipResult.ownershipResult) extractionResults.ownership = historyOwnershipResult.ownershipResult;

      // 5g: Rationale (LLM)
      const rationaleResult = await this.extractRationaleSection(ctx, fileContent);
      if (rationaleResult.error) errors.push(rationaleResult.error);
      if (rationaleResult.result) extractionResults.rationale = rationaleResult.result;

      // 5h: Traceability
      const traceabilityResult = await this.extractTraceabilitySection(ctx, fileContent);
      if (traceabilityResult.error) errors.push(traceabilityResult.error);
      if (traceabilityResult.result) extractionResults.traceability = traceabilityResult.result;

      // 5i: Relationships (cochange, similarity)
      const relationshipsResult = await this.extractRelationshipsSection(ctx);
      if (relationshipsResult.error) errors.push(relationshipsResult.error);

      // Phase 6: Collect evidence and activate defeaters
      const evidenceResult = await this.collectEvidenceAndActivateDefeaters(ctx, extractionResults);
      if (evidenceResult.error) errors.push(evidenceResult.error);

      // Phase 7: Integrate graph edges
      const graphResult = await this.integrateGraphEdges(ctx);
      if (graphResult.error) errors.push(graphResult.error);

      // Phase 8: Copy embedding if available
      if (fn.embedding && fn.embedding instanceof Float32Array && fn.embedding.length > 0) {
        knowledge.embedding = fn.embedding;
      }

      // Phase 9: Finalize meta and confidence
      knowledge.meta.confidence.overall = Math.max(0, Math.min(1, fn.confidence || 0.5));
      knowledge.meta.generatedAt = new Date().toISOString();
      knowledge.meta.generatedBy = 'librarian-generator';

      if (errors.length > 0) {
        knowledge.meta.confidence.bySection = {
          identity: errors.some((e) => e.phase === 'identity') ? 0.3 : 0.9,
          semantics: errors.some((e) => e.phase === 'semantics') ? 0.3 : 0.7,
          contract: errors.some((e) => e.phase === 'contract') ? 0.3 : 0.8,
        };
      }

      // Phase 10: Persist to storage
      try {
        const record = this.knowledgeToRecord(knowledge);
        await this.config.storage.upsertUniversalKnowledge(record);
      } catch (storageError) {
        return {
          success: false,
          partial: false,
          errors: [{
            entityId: id,
            entityKind: 'function',
            file: filePath,
            error: `Storage failure: ${this.formatError(storageError)}`,
            phase: 'identity',
          }, ...errors],
        };
      }

      // Phase 11: Emit completion event
      this.emit('understanding_generated', {
        entityId: id,
        entityKind: 'function',
        file: filePath,
        confidence: knowledge.meta.confidence.overall,
        partial: errors.length > 0,
      });

      return {
        success: true,
        partial: errors.length > 0,
        errors,
      };
    } catch (error) {
      return {
        success: false,
        partial: false,
        errors: [{
          entityId: id,
          entityKind: 'function',
          file: filePath,
          error: `Unexpected error: ${this.formatError(error)}`,
          phase: 'identity',
        }],
      };
    }
  }

  // ==========================================================================
  // EXTRACTION HELPER METHODS (decomposed from generateForFunction)
  // ==========================================================================

  /**
   * Extracts semantics section using LLM.
   */
  private async extractSemanticsSection(
    ctx: FunctionExtractionContext
  ): Promise<{ result?: SemanticsExtraction; error?: GenerationError }> {
    const { fn, knowledge, llmProvider, llmModelId } = ctx;
    try {
      const semanticsInput: SemanticsInput = {
        name: knowledge.name,
        signature: fn.signature,
        content: undefined,
        docstring: undefined,
        existingPurpose: fn.purpose,
        filePath: knowledge.location.file,
      };

      const result = await extractSemanticsWithLLM(semanticsInput, {
        llmProvider,
        llmModelId,
        governor: this.config.governor,
      });
      knowledge.semantics = result.semantics;
      knowledge.meta.confidence.bySection = {
        ...knowledge.meta.confidence.bySection,
        semantics: result.confidence,
      };
      return { result };
    } catch (error) {
      knowledge.meta.confidence.bySection = {
        ...knowledge.meta.confidence.bySection,
        semantics: 0,
      };
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Semantics extraction failed: ${this.formatError(error)}`,
          phase: 'semantics',
        },
      };
    }
  }

  /**
   * Extracts quality metrics section.
   */
  private extractQualitySection(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): { result?: ReturnType<typeof extractQuality>; error?: GenerationError } {
    const { knowledge } = ctx;
    const { line: startLine, endLine } = knowledge.location;
    try {
      const result = extractQuality({
        name: knowledge.name,
        signature: ctx.fn.signature,
        startLine,
        endLine,
        content: fileContent,
      });
      knowledge.quality.complexity = result.quality.complexity;
      knowledge.quality.smells = result.quality.smells;
      knowledge.quality.maintainability = result.quality.maintainability;
      knowledge.quality.documentation = result.quality.documentation;
      knowledge.quality.hygiene = result.quality.hygiene;
      return { result };
    } catch (error) {
      const lines = Math.max(1, endLine - startLine);
      knowledge.quality.complexity.lines = lines;
      knowledge.quality.complexity.cyclomatic = Math.max(1, Math.ceil(lines / 10));
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Quality extraction failed: ${this.formatError(error)}`,
          phase: 'quality',
        },
      };
    }
  }

  /**
   * Extracts security analysis section using LLM.
   */
  private async extractSecuritySection(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): Promise<{ result?: SecurityExtraction; error?: GenerationError }> {
    const { knowledge, llmProvider, llmModelId } = ctx;
    try {
      const securityInput: SecurityInput = {
        name: knowledge.name,
        filePath: knowledge.location.file,
        content: fileContent,
      };
      const result = await extractSecurityWithLLM(securityInput, {
        llmProvider,
        llmModelId,
        governor: this.config.governor,
      });
      knowledge.security = result.security;
      return { result };
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Security extraction failed: ${this.formatError(error)}`,
          phase: 'security',
        },
      };
    }
  }

  /**
   * Extracts testing knowledge section.
   */
  private extractTestingSection(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): { result?: ReturnType<typeof extractTesting>; error?: GenerationError } {
    const { knowledge } = ctx;
    try {
      const testingInput: TestingInput = {
        name: knowledge.name,
        filePath: knowledge.location.file,
        content: fileContent,
      };
      const result = extractTesting(testingInput);
      knowledge.testing = result.testing;
      return { result };
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Testing extraction failed: ${this.formatError(error)}`,
          phase: 'testing',
        },
      };
    }
  }

  /**
   * Extracts history and ownership sections.
   */
  private async extractHistoryAndOwnershipSections(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): Promise<{
    historyResult?: Awaited<ReturnType<typeof extractHistory>>;
    ownershipResult?: Awaited<ReturnType<typeof extractOwnership>>;
    errors: GenerationError[];
  }> {
    const { knowledge } = ctx;
    const { file: filePath, line: startLine, endLine } = knowledge.location;
    const errors: GenerationError[] = [];
    let historyResult;
    let ownershipResult;

    try {
      const historyInput: HistoryInput = {
        filePath,
        workspaceRoot: this.config.workspace,
        content: fileContent,
        startLine,
        endLine,
      };
      historyResult = await extractHistory(historyInput);
      knowledge.history = historyResult.history;
    } catch (error) {
      errors.push({
        entityId: knowledge.id,
        entityKind: 'function',
        file: filePath,
        error: `History extraction failed: ${this.formatError(error)}`,
        phase: 'history',
      });
    }

    try {
      const ownershipInput: OwnershipInput = {
        filePath,
        workspaceRoot: this.config.workspace,
        content: fileContent,
      };
      ownershipResult = await extractOwnership(ownershipInput);
      knowledge.ownership = ownershipResult.ownership;
    } catch (error) {
      errors.push({
        entityId: knowledge.id,
        entityKind: 'function',
        file: filePath,
        error: `Ownership extraction failed: ${this.formatError(error)}`,
        phase: 'ownership',
      });
    }

    return { historyResult, ownershipResult, errors };
  }

  /**
   * Extracts rationale section using LLM.
   */
  private async extractRationaleSection(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): Promise<{ result?: RationaleExtraction; error?: GenerationError }> {
    const { knowledge, llmProvider, llmModelId } = ctx;
    try {
      const rationaleInput: RationaleInput = {
        filePath: knowledge.location.file,
        workspaceRoot: this.config.workspace,
        content: fileContent,
        entityName: knowledge.name,
      };
      const result = await extractRationaleWithLLM(rationaleInput, {
        provider: llmProvider,
        modelId: llmModelId,
        governor: this.config.governor,
      });
      knowledge.rationale = result.rationale;
      return { result };
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Rationale extraction failed: ${this.formatError(error)}`,
          phase: 'rationale',
        },
      };
    }
  }

  /**
   * Extracts traceability section.
   */
  private async extractTraceabilitySection(
    ctx: FunctionExtractionContext,
    fileContent?: string
  ): Promise<{ result?: Awaited<ReturnType<typeof extractTraceability>>; error?: GenerationError }> {
    const { knowledge } = ctx;
    const filePath = knowledge.location.file;
    try {
      const relativePath = filePath.replace(this.config.workspace + '/', '');
      const traceabilityInput: TraceabilityInput = {
        filePath,
        relativePath,
        workspaceRoot: this.config.workspace,
        content: fileContent,
        entityName: knowledge.name,
      };
      const result = await extractTraceability(traceabilityInput);
      knowledge.traceability = result.traceability;
      return { result };
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: filePath,
          error: `Traceability extraction failed: ${this.formatError(error)}`,
          phase: 'traceability',
        },
      };
    }
  }

  /**
   * Extracts relationships (cochange and similarity).
   */
  private async extractRelationshipsSection(
    ctx: FunctionExtractionContext
  ): Promise<{ error?: GenerationError }> {
    const { fn, knowledge } = ctx;
    try {
      const relationshipsInput: RelationshipsInput = {
        filePath: knowledge.location.file,
        entityId: knowledge.id,
        entityName: knowledge.name,
        embedding: fn.embedding,
        storage: this.config.storage,
      };
      const result = await extractRelationships(relationshipsInput);
      knowledge.relationships.cochanges = result.cochanges;
      knowledge.relationships.similar = result.similar;
      return {};
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Relationships extraction failed: ${this.formatError(error)}`,
          phase: 'relationships',
        },
      };
    }
  }

  /**
   * Collects evidence and activates defeaters.
   */
  private async collectEvidenceAndActivateDefeaters(
    ctx: FunctionExtractionContext,
    extractionResults: ExtractionResults
  ): Promise<{ error?: GenerationError }> {
    const { knowledge } = ctx;
    try {
      const evidenceInput: EvidenceCollectionInput = {
        entityId: knowledge.id,
        entityName: knowledge.name,
        filePath: knowledge.location.file,
        contentHash: knowledge.hash,
        semantics: extractionResults.semantics ?? {
          semantics: knowledge.semantics,
          confidence: knowledge.meta.confidence.bySection.semantics ?? 0,
        },
        quality: extractionResults.quality,
        security: extractionResults.security,
        testing: extractionResults.testing,
        history: extractionResults.history,
        ownership: extractionResults.ownership,
        rationale: extractionResults.rationale,
        traceability: extractionResults.traceability,
        generatedBy: 'librarian-generator-v2',
      };
      const evidenceResult = collectEvidence(evidenceInput);
      knowledge.meta = evidenceResult.meta;

      // Activate defeaters during generation (VISION requirement)
      if (knowledge.meta.defeaters.length > 0 && this.config.storage) {
        try {
          const { checkDefeaters, applyDefeaterResults } = await this.config.defeaterLoader();
          const defeaterContext = {
            entityId: knowledge.id,
            filePath: knowledge.location.file,
            currentContentHash: knowledge.hash,
            storage: this.config.storage,
            workspaceRoot: this.config.workspace,
          };
          const defeaterTimeoutMs =
            this.config.timeoutMs > 0 ? this.config.timeoutMs : DEFAULT_DEFEATER_TIMEOUT_MS;
          const defeaterSummary = await withTimeout(
            checkDefeaters(knowledge.meta, defeaterContext),
            defeaterTimeoutMs,
            { context: `Defeater activation for ${knowledge.id}` }
          );
          if (!isActivationSummary(defeaterSummary)) {
            throw new Error('unverified_by_trace(defeater_summary_invalid)');
          }
          const updatedMeta = applyDefeaterResults(knowledge.meta, defeaterSummary);
          if (!updatedMeta || typeof updatedMeta !== 'object') {
            throw new Error('unverified_by_trace(defeater_meta_invalid)');
          }
          knowledge.meta = updatedMeta;
          if (!defeaterSummary.knowledgeValid) {
            return {
              error: {
                entityId: knowledge.id,
                entityKind: 'function',
                file: knowledge.location.file,
                error: `Knowledge invalidated by ${defeaterSummary.activeDefeaters} defeater(s): ${
                  defeaterSummary.results.filter(r => r.activated).map(r => r.reason).join('; ')
                }`,
                phase: 'identity',
              },
            };
          }
        } catch (defeaterError) {
          // Graceful degradation: defeater activation is non-critical
          // Log but don't fail generation if defeater module unavailable
          console.warn(`Defeater activation skipped: ${this.formatError(defeaterError)}`);
        }
      }
      return {};
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Evidence collection failed: ${this.formatError(error)}`,
          phase: 'identity',
        },
      };
    }
  }

  /**
   * Integrates graph edges into knowledge relationships.
   */
  private async integrateGraphEdges(
    ctx: FunctionExtractionContext
  ): Promise<{ error?: GenerationError }> {
    const { knowledge } = ctx;
    try {
      const callEdges = await this.queryGraphEdges(knowledge.id, knowledge.location.file);
      knowledge.relationships.calls = callEdges.outgoing;
      knowledge.relationships.calledBy = callEdges.incoming;
      knowledge.relationships.coupling = {
        afferent: callEdges.incoming.length,
        efferent: callEdges.outgoing.length,
        instability: callEdges.outgoing.length > 0 || callEdges.incoming.length > 0
          ? callEdges.outgoing.length / (callEdges.outgoing.length + callEdges.incoming.length)
          : 0,
      };
      return {};
    } catch (error) {
      return {
        error: {
          entityId: knowledge.id,
          entityKind: 'function',
          file: knowledge.location.file,
          error: `Graph edge query failed: ${this.formatError(error)}`,
          phase: 'relationships',
        },
      };
    }
  }

  /**
   * Infer purpose from function name using common naming conventions.
   */
  private inferPurposeFromName(name: string): string {
    if (!name || name === 'anonymous') return 'Anonymous function';

    // Convert camelCase to readable text
    const readable = name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();

    // Detect common prefixes
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith('get')) return `Retrieves ${readable.slice(4).trim()}`;
    if (lowerName.startsWith('set')) return `Sets ${readable.slice(4).trim()}`;
    if (lowerName.startsWith('is') || lowerName.startsWith('has') || lowerName.startsWith('can')) {
      return `Checks whether ${readable.slice(3).trim()}`;
    }
    if (lowerName.startsWith('create')) return `Creates ${readable.slice(7).trim()}`;
    if (lowerName.startsWith('delete') || lowerName.startsWith('remove')) {
      return `Removes ${readable.slice(7).trim()}`;
    }
    if (lowerName.startsWith('update')) return `Updates ${readable.slice(7).trim()}`;
    if (lowerName.startsWith('handle')) return `Handles ${readable.slice(7).trim()}`;
    if (lowerName.startsWith('on')) return `Event handler for ${readable.slice(3).trim()}`;

    return readable;
  }

  /**
   * Generate knowledge for a single module.
   * Handles edge cases:
   * - Missing or empty fields
   * - Invalid paths
   * - Empty exports/dependencies
   * - Storage failures
   */
  async generateForModule(
    mod: ModuleKnowledge
  ): Promise<{ success: boolean; partial: boolean; errors: GenerationError[] }> {
    this.ensureLlmConfigured();
    const llmProvider = this.config.llmProvider as 'claude' | 'codex';
    const llmModelId = this.config.llmModelId;
    const errors: GenerationError[] = [];

    // Validate input
    if (!mod) {
      return {
        success: false,
        partial: false,
        errors: [{
          entityId: 'unknown',
          entityKind: 'module',
          file: 'unknown',
          error: 'Module object is null or undefined',
          phase: 'identity',
        }],
      };
    }

    // Ensure required fields have fallbacks
    const id = mod.id || this.computeHash(mod.path || 'unknown');
    const modulePath = mod.path || 'unknown';
    const name = modulePath.split('/').pop() || modulePath;

    try {
      // Create base knowledge
      const knowledge = createEmptyKnowledge(
        id,
        name,
        'module',
        modulePath,
        1
      );

      // Set identity with validation
      knowledge.qualifiedName = modulePath;

      // Safely access arrays
      const exports = Array.isArray(mod.exports) ? mod.exports : [];
      const dependencies = Array.isArray(mod.dependencies) ? mod.dependencies : [];

      knowledge.hash = this.computeHash((mod.purpose || '') + exports.join(','));

      // Incremental shortcut: if we already have a record with the same hash,
      // skip regeneration to keep bootstrap resumable and avoid repeated quota burn.
      try {
        const existing = await this.config.storage.getUniversalKnowledge(id);
        if (existing && existing.hash === knowledge.hash) {
          this.emit('understanding_generated', {
            entityId: id,
            entityKind: 'module',
            file: modulePath,
            confidence: existing.confidence,
            partial: false,
            skipped: true,
          });
          return { success: true, partial: false, errors: [] };
        }
      } catch {
        // Storage lookup should not block generation.
      }

      // Read file content for semantic extraction
      let fileContent: string | undefined;
      try {
        fileContent = await fs.readFile(modulePath, 'utf-8');
      } catch {
        // Continue with limited extraction
      }

      let semanticsResult: SemanticsExtraction | undefined;
      try {
        const semanticsInput: SemanticsInput = {
          name,
          signature: undefined,
          content: fileContent,
          docstring: undefined,
          existingPurpose: mod.purpose,
          filePath: modulePath,
        };
        semanticsResult = await extractSemanticsWithLLM(
          semanticsInput,
          {
            llmProvider,
            llmModelId,
            governor: this.config.governor,
          }
        );
        knowledge.semantics = semanticsResult.semantics;
        knowledge.meta.confidence.bySection = {
          ...knowledge.meta.confidence.bySection,
          semantics: semanticsResult.confidence,
        };
      } catch (semanticsError) {
        knowledge.meta.confidence.bySection = {
          ...knowledge.meta.confidence.bySection,
          semantics: 0,
        };
        errors.push({
          entityId: id,
          entityKind: 'module',
          file: modulePath,
          error: `Semantics extraction failed: ${this.formatError(semanticsError)}`,
          phase: 'semantics',
        });
      }

      // Set relationships from exports and dependencies with validation
      knowledge.relationships.exports = exports
        .filter((exp): exp is string => typeof exp === 'string' && exp.length > 0)
        .map((exp) => ({
          id: `${id}:${exp}`,
          name: exp,
          file: modulePath,
          line: 1,
        }));

      knowledge.relationships.imports = dependencies
        .filter((dep): dep is string => typeof dep === 'string' && dep.length > 0)
        .map((dep) => ({
          id: dep,
          name: dep.split('/').pop() || dep,
          file: dep,
          line: 1,
        }));

      // Set coupling metrics with safe calculation
      const efferent = knowledge.relationships.imports.length;
      knowledge.relationships.coupling = {
        afferent: 0, // Would need to query who imports this
        efferent,
        instability: efferent > 0 ? 1 : 0,
      };

      let securityResult: SecurityExtraction | undefined;
      try {
        const securityInput: SecurityInput = {
          name,
          filePath: modulePath,
          content: fileContent,
        };
        securityResult = await extractSecurityWithLLM(securityInput, {
          llmProvider,
          llmModelId,
          governor: this.config.governor,
        });
        knowledge.security = securityResult.security;
      } catch (securityError) {
        errors.push({
          entityId: id,
          entityKind: 'module',
          file: modulePath,
          error: `Security extraction failed: ${this.formatError(securityError)}`,
          phase: 'security',
        });
      }

      let rationaleResult: RationaleExtraction | undefined;
      try {
        const rationaleInput: RationaleInput = {
          filePath: modulePath,
          workspaceRoot: this.config.workspace,
          content: fileContent,
          entityName: name,
        };
        rationaleResult = await extractRationaleWithLLM(rationaleInput, {
          provider: llmProvider,
          modelId: llmModelId,
          governor: this.config.governor,
        });
        knowledge.rationale = rationaleResult.rationale;
      } catch (rationaleError) {
        errors.push({
          entityId: id,
          entityKind: 'module',
          file: modulePath,
          error: `Rationale extraction failed: ${this.formatError(rationaleError)}`,
          phase: 'rationale',
        });
      }

      // Collect evidence and build comprehensive meta (modules)
      try {
        const evidenceInput: EvidenceCollectionInput = {
          entityId: id,
          entityName: name,
          filePath: modulePath,
          contentHash: knowledge.hash,
          semantics: semanticsResult ?? {
            semantics: knowledge.semantics,
            confidence: knowledge.meta.confidence.bySection.semantics ?? 0,
          },
          security: securityResult ?? {
            security: knowledge.security,
            confidence: knowledge.meta.confidence.bySection.security ?? 0,
          },
          rationale: rationaleResult ?? {
            rationale: knowledge.rationale,
            confidence: knowledge.meta.confidence.bySection.rationale ?? 0,
          },
          generatedBy: 'librarian-generator-v2',
        };
        const evidenceResult = collectEvidence(evidenceInput);
        knowledge.meta = evidenceResult.meta;

        // Clamp overall confidence to the module indexer confidence (upper bound).
        const moduleConfidence = Math.max(0, Math.min(1, mod.confidence || 0.5));
        knowledge.meta.confidence.overall = Math.min(knowledge.meta.confidence.overall, moduleConfidence);
      } catch (evidenceError) {
        errors.push({
          entityId: id,
          entityKind: 'module',
          file: modulePath,
          error: `Evidence collection failed: ${this.formatError(evidenceError)}`,
          phase: 'identity',
        });
      }

      // Track errors in confidence
      if (errors.length > 0) {
        knowledge.meta.confidence.bySection = {
          identity: knowledge.meta.confidence.bySection.identity ?? 0.9,
          semantics: errors.some((e) => e.phase === 'semantics')
            ? Math.min(knowledge.meta.confidence.bySection.semantics ?? 0.3, 0.3)
            : (knowledge.meta.confidence.bySection.semantics ?? 0.7),
          relationships: knowledge.meta.confidence.bySection.relationships ?? 0.8,
          security: errors.some((e) => e.phase === 'security')
            ? 0.2
            : (knowledge.meta.confidence.bySection.security ?? 0.6),
          rationale: errors.some((e) => e.phase === 'rationale')
            ? 0.2
            : (knowledge.meta.confidence.bySection.rationale ?? 0.6),
        };
      }

      // VISION REQUIREMENT: Activate defeaters DURING generation for modules too
      // Only run if storage is available and we have defeaters
      if (knowledge.meta.defeaters && knowledge.meta.defeaters.length > 0 && this.config.storage) {
        try {
          const { checkDefeaters, applyDefeaterResults } = await this.config.defeaterLoader();
          const defeaterContext = {
            entityId: id,
            filePath: modulePath,
            currentContentHash: knowledge.hash,
            storage: this.config.storage,
            workspaceRoot: this.config.workspace,
          };
          const defeaterTimeoutMs =
            this.config.timeoutMs > 0 ? this.config.timeoutMs : DEFAULT_DEFEATER_TIMEOUT_MS;
          const defeaterSummary = await withTimeout(
            checkDefeaters(knowledge.meta, defeaterContext),
            defeaterTimeoutMs,
            { context: `Defeater activation for ${id}` }
          );
          if (!isActivationSummary(defeaterSummary)) {
            throw new Error('unverified_by_trace(defeater_summary_invalid)');
          }
          const updatedMeta = applyDefeaterResults(knowledge.meta, defeaterSummary);
          if (!updatedMeta || typeof updatedMeta !== 'object') {
            throw new Error('unverified_by_trace(defeater_meta_invalid)');
          }
          knowledge.meta = updatedMeta;
          if (!defeaterSummary.knowledgeValid) {
            errors.push({
              entityId: id,
              entityKind: 'module',
              file: modulePath,
              error: `Knowledge invalidated by ${defeaterSummary.activeDefeaters} defeater(s)`,
              phase: 'identity', // validation errors use identity phase
            });
          }
        } catch (defeaterError) {
          // Graceful degradation: defeater activation is non-critical
          console.warn(`Defeater activation skipped: ${this.formatError(defeaterError)}`);
        }
      }

      // Persist with error handling
      try {
        const record = this.knowledgeToRecord(knowledge);
        await this.config.storage.upsertUniversalKnowledge(record);
      } catch (storageError) {
        return {
          success: false,
          partial: false,
          errors: [{
            entityId: id,
            entityKind: 'module',
            file: modulePath,
            error: `Storage failure: ${this.formatError(storageError)}`,
            phase: 'identity',
          }, ...errors],
        };
      }

      this.emit('understanding_generated', {
        entityId: id,
        entityKind: 'module',
        file: modulePath,
        confidence: knowledge.meta.confidence.overall,
        partial: errors.length > 0,
      });

      return {
        success: true,
        partial: errors.length > 0,
        errors,
      };
    } catch (error) {
      return {
        success: false,
        partial: false,
        errors: [{
          entityId: id,
          entityKind: 'module',
          file: modulePath,
          error: `Unexpected error: ${this.formatError(error)}`,
          phase: 'identity',
        }],
      };
    }
  }

  /**
   * Infer module purpose from file path.
   */
  private inferModulePurposeFromPath(filePath: string): string {
    if (!filePath || filePath === 'unknown') return 'Unknown module';

    const parts = filePath.split('/');
    const fileName = parts.pop() || filePath;
    const parentDir = parts.pop() || '';

    // Remove extension
    const baseName = fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    // Common patterns
    if (baseName === 'index') {
      return `Main entry point for ${parentDir || 'module'}`;
    }
    if (baseName.includes('types')) {
      return 'Type definitions';
    }
    if (baseName.includes('utils') || baseName.includes('helpers')) {
      return 'Utility functions';
    }
    if (baseName.includes('constants') || baseName.includes('config')) {
      return 'Configuration and constants';
    }
    if (baseName.includes('test') || baseName.includes('spec')) {
      return 'Test suite';
    }
    if (parentDir.includes('component') || baseName.endsWith('Component')) {
      return `UI component: ${baseName}`;
    }
    if (parentDir.includes('hook') || baseName.startsWith('use')) {
      return `React hook: ${baseName}`;
    }
    if (parentDir.includes('api') || parentDir.includes('service')) {
      return `API service: ${baseName}`;
    }

    // Convert to readable
    const readable = baseName
      .replace(/([A-Z])/g, ' $1')
      .replace(/[-_]/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();

    return `${readable} module`;
  }

  /**
   * Regenerate knowledge for entities in specific files.
   */
  async regenerateForFiles(filePaths: string[]): Promise<GenerationResult> {
    const startTime = Date.now();
    const errors: GenerationError[] = [];
    let successCount = 0;
    let failureCount = 0;
    let partialCount = 0;

    this.ensureLlmConfigured();

    for (const filePath of filePaths) {
      // Get functions in this file
      const allFunctions = await this.config.storage.getFunctions();
      const fileFunctions = allFunctions.filter((fn) => fn.filePath === filePath);

      // Get modules for this file
      const allModules = await this.config.storage.getModules();
      const fileModules = allModules.filter((mod) => mod.path === filePath);

      // Delete existing knowledge for this file
      await this.config.storage.deleteUniversalKnowledgeByFile(filePath);

      // Regenerate
      for (const fn of fileFunctions) {
        const result = await this.generateForFunction(fn);
        if (result.success) {
          result.partial ? partialCount++ : successCount++;
        } else {
          failureCount++;
          errors.push(...result.errors);
        }
      }

      for (const mod of fileModules) {
        const result = await this.generateForModule(mod);
        if (result.success) {
          result.partial ? partialCount++ : successCount++;
        } else {
          failureCount++;
          errors.push(...result.errors);
        }
      }
    }

    return {
      totalEntities: successCount + failureCount + partialCount,
      successCount,
      failureCount,
      partialCount,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private emit(type: string, data: Record<string, unknown>): void {
    if (this.config.onEvent) {
      this.config.onEvent({
        type: type as LibrarianEventType,
        timestamp: new Date(),
        data,
      });
    }
  }

  private ensureLlmConfigured(): void {
    if (this.config.skipLlm) {
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(llm_required): Knowledge generation cannot skip LLM.',
        missing: ['knowledge_generation_llm_required'],
        suggestion: 'Enable LLM providers via CLI authentication and configuration.',
      });
    }
    if (!this.config.llmProvider || !this.config.llmModelId) {
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): Knowledge generation requires a live LLM provider. There is no non-agentic mode.',
        missing: ['knowledge_generation_llm_not_configured'],
        suggestion: 'Authenticate providers via CLI and set LIBRARIAN_LLM_PROVIDER/LIBRARIAN_LLM_MODEL.',
      });
    }
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private parseSignature(signature: string, knowledge: UniversalKnowledge): void {
    // Basic signature parsing
    const paramMatch = signature.match(/\(([^)]*)\)/);
    if (paramMatch && paramMatch[1]) {
      const params = paramMatch[1].split(',').filter((p) => p.trim());
      knowledge.contract.signature.inputs = params.map((p) => {
        const [name, type] = p.split(':').map((s) => s.trim());
        return {
          name: name || 'arg',
          type: type || 'unknown',
          optional: name?.includes('?') ?? false,
          description: '',
        };
      });
      knowledge.quality.complexity.parameters = params.length;
    }

    // Parse return type
    const returnMatch = signature.match(/\):\s*(.+)$/);
    if (returnMatch) {
      knowledge.contract.signature.output = {
        raw: returnMatch[1].trim(),
        description: '',
        nullable: returnMatch[1].includes('null') || returnMatch[1].includes('undefined'),
      };
    }

    // Detect async
    if (signature.includes('async') || signature.includes('Promise')) {
      knowledge.contract.concurrency.asyncSemantics = 'async';
    }
  }

  /**
   * Query graph edges for an entity to populate relationships.
   */
  private async queryGraphEdges(
    entityId: string,
    filePath: string
  ): Promise<{ outgoing: CallReference[]; incoming: CallReference[] }> {
    const outgoing: CallReference[] = [];
    const incoming: CallReference[] = [];

    // Query outgoing edges (what this entity calls)
    const outEdges = await this.config.storage.getGraphEdges({
      fromIds: [entityId],
      edgeTypes: ['calls'],
    });

    for (const edge of outEdges) {
      outgoing.push({
        id: edge.toId,
        name: edge.toId.split(':').pop() || edge.toId,
        file: edge.sourceFile,
        line: edge.sourceLine ?? 1,
        callType: 'direct',
        frequency: 'few',
      });
    }

    // Query incoming edges (what calls this entity)
    const inEdges = await this.config.storage.getGraphEdges({
      toIds: [entityId],
      edgeTypes: ['calls'],
    });

    for (const edge of inEdges) {
      incoming.push({
        id: edge.fromId,
        name: edge.fromId.split(':').pop() || edge.fromId,
        file: edge.sourceFile,
        line: edge.sourceLine ?? 1,
        callType: 'direct',
        frequency: 'few',
      });
    }

    return { outgoing, incoming };
  }

  private knowledgeToRecord(knowledge: UniversalKnowledge): UniversalKnowledgeRecord {
    return {
      id: knowledge.id,
      kind: knowledge.kind,
      name: knowledge.name,
      qualifiedName: knowledge.qualifiedName,
      file: knowledge.location.file,
      line: knowledge.location.line,
      knowledge: JSON.stringify(knowledge),
      purposeSummary: knowledge.semantics.purpose.summary || undefined,
      maintainabilityIndex: knowledge.quality.maintainability.index,
      riskScore: knowledge.security.riskScore?.overall,
      testCoverage: knowledge.quality.coverage.statement,
      cyclomaticComplexity: knowledge.quality.complexity.cyclomatic,
      cognitiveComplexity: knowledge.semantics.complexity.cognitive,
      embedding: knowledge.embedding,
      confidence: knowledge.meta.confidence.overall,
      generatedAt: knowledge.meta.generatedAt,
      validUntil: knowledge.meta.validUntil,
      hash: knowledge.hash,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createKnowledgeGenerator(
  config: KnowledgeGeneratorConfig
): UniversalKnowledgeGenerator {
  return new UniversalKnowledgeGenerator(config);
}
