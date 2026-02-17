import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logWarning } from '../telemetry/logger.js';
import { extractMarkedJson, stripAnsi } from '../spine/marked_json.js';
import { getErrorMessage } from '../utils/errors.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { resolveLlmServiceAdapter, type LlmServiceAdapter } from '../adapters/llm_service.js';
import type { FunctionKnowledge, ModuleKnowledge } from '../types.js';
import { EmbeddingService, type EmbeddingProvider } from '../api/embeddings.js';
import { ParserRegistry, type ParsedFunction, type ParsedModule, type ParserResult } from './parser_registry.js';
import { extractCallEdgesFromAst, type ParsedCallEdge } from './call_edge_extractor.js';
import type { CoverageReport } from '../api/coverage.js';
import type { EvidenceEntry } from '../api/evidence.js';
import { GovernorContext } from '../api/governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from '../api/governors.js';
import { redactText } from '../api/redaction.js';
import { buildEmbeddingInput } from './index_librarian.js';
import type { LibrarianStorage } from '../storage/types.js';
import { computeGraphMetrics, writeGraphMetricsReport, type GraphMetricsEntry } from '../graphs/metrics.js';
import { emptyArray, noResult } from '../api/empty_values.js';
import { globalEventBus, createLanguageOnboardingEvent } from '../events.js';

export type LlmProvider = 'claude' | 'codex';

export interface AstIndexerOptions {
  llmProvider?: LlmProvider;
  llmModelId?: string;
  registry?: ParserRegistry;
  llmService?: LlmServiceAdapter;
  /** When false, skips per-file LLM analysis (purpose extraction). */
  enableAnalysis?: boolean;
  /** When true, allows LLM-based parser fallback when deterministic parsers are unavailable. */
  enableLlmFallback?: boolean;
  embeddingProvider?: EmbeddingProvider;
  embeddingModelId?: string;
  embeddingService?: EmbeddingService;
  enableEmbeddings?: boolean;
  storage?: LibrarianStorage;
  workspaceRoot?: string;
  computeGraphMetrics?: boolean;
  governorContext?: GovernorContext;
  maxPromptChars?: number;
  resolveFunctionIds?: (filePath: string, functions: ParsedFunction[]) => Promise<Map<string, string>>;
  resolveModuleId?: (filePath: string) => Promise<string | null>;
}

export interface AstIndexResult {
  filePath: string;
  parser: string;
  functions: FunctionKnowledge[];
  module: ModuleKnowledge | null;
  callEdges: ResolvedCallEdge[];
  partiallyIndexed: boolean;
  llmTokensUsed: number;
}

type AnalysisPayload = { schema_version: number; kind: 'LibrarianAstAnalysis.v1'; module: { purpose: string }; functions: Array<{ name: string; purpose?: string }> };
type LlmAnalysisResult = { modulePurpose: string; functionPurposes: Map<string, string> };
type ParserFallbackPayload = {
  schema_version: number;
  kind: 'LibrarianParserFallback.v1';
  functions: Array<{ name: string; signature?: string; startLine: number; endLine: number }>;
  module: { exports: string[]; dependencies: string[] };
};
const ANALYSIS_BEGIN_MARKER = 'BEGIN_ANALYSIS_JSON', ANALYSIS_END_MARKER = 'END_ANALYSIS_JSON';
const PARSER_BEGIN_MARKER = 'BEGIN_PARSER_JSON', PARSER_END_MARKER = 'END_PARSER_JSON';
const DEFAULT_MAX_PROMPT_CHARS = 12000, MAX_ANALYSIS_RESPONSE_CHARS = 200_000;

export class AstIndexer {
  private registry: ParserRegistry; private readonly llmProvider: LlmProvider | null; private readonly llmModelId: string | null; private readonly llmService: LlmServiceAdapter | null; private readonly analysisEnabled: boolean; private readonly fallbackEnabled: boolean; private readonly embeddingService: EmbeddingService | null; private readonly embeddingsEnabled: boolean; private readonly storage?: LibrarianStorage; private readonly workspaceRoot?: string; private readonly computeMetrics: boolean; private governor: GovernorContext | null; private readonly maxPromptChars: number; private readonly resolveFunctionIds?: (filePath: string, functions: ParsedFunction[]) => Promise<Map<string, string>>; private readonly resolveModuleId?: (filePath: string) => Promise<string | null>;

  constructor(options: AstIndexerOptions) {
    this.registry = options.registry ?? ParserRegistry.getInstance();
    this.llmProvider = options.llmProvider ?? null;
    this.llmModelId = options.llmModelId ?? null;
    const llmConfigured = Boolean(this.llmProvider && this.llmModelId);
    this.llmService = llmConfigured ? resolveLlmServiceAdapter(options.llmService ?? null) : null;
    this.governor = options.governorContext ?? new GovernorContext({ phase: 'ast_index', config: DEFAULT_GOVERNOR_CONFIG });
    this.analysisEnabled = llmConfigured && (options.enableAnalysis ?? false);
    this.fallbackEnabled = llmConfigured && (options.enableLlmFallback ?? true);
    // Real embedding providers (xenova/sentence-transformers) - configured automatically
    // NO LLM-generated embeddings (they're hallucinated numbers, not real vectors)
    this.embeddingsEnabled = options.enableEmbeddings ?? true;
    this.embeddingService = this.embeddingsEnabled
      ? options.embeddingService ?? new EmbeddingService({})
      : null;
    this.storage = options.storage;
    this.workspaceRoot = options.workspaceRoot;
    this.computeMetrics = options.computeGraphMetrics ?? false;
    this.maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
    this.resolveFunctionIds = options.resolveFunctionIds;
    this.resolveModuleId = options.resolveModuleId;
  }

  setGovernorContext(governor: GovernorContext | null): void { this.governor = governor; }

  async indexFile(filePath: string, content?: string): Promise<AstIndexResult> {
    const source = content ?? (await fs.readFile(filePath, 'utf8'));
    let parsed: ParserResult;
    let parserFallback = false;
    const governor = this.governor;
    try {
      parsed = this.registry.parseFile(filePath, source);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (
        message.includes('unverified_by_trace(parser_unavailable)') ||
        message.includes('unverified_by_trace(parser_failed)') ||
        message.includes('unverified_by_trace(regex_parser_disallowed)')
      ) {
        await this.recordLanguageGap(filePath, message);
        if (!this.fallbackEnabled) {
          // Degrade gracefully: still index the file as a module so bootstrap/query
          // does not end up in an empty-storage state on repos without AST parsers.
          // This is provider-free and keeps indexing deterministic.
          parserFallback = true;
          parsed = {
            parser: 'unverified_by_trace(parser_unavailable)',
            functions: [],
            module: { exports: [], dependencies: [] },
          };
          logWarning('Parser unavailable; indexing as text-only module (LLM fallback disabled)', { filePath, error: message });
        } else {
          parserFallback = true;
          parsed = await this.parseWithLlmFallback(filePath, source, governor ?? undefined);
          void globalEventBus.emit(createLanguageOnboardingEvent(
            filePath,
            path.extname(filePath) || 'unknown',
            parsed.parser,
            message
          ));
          logWarning('Parser unavailable; using LLM fallback parsing', { filePath, error: message });
        }
      } else {
        throw error;
      }
    }
    let partiallyIndexed = false;
    let analysis: LlmAnalysisResult | null = null;
    const redaction = redactText(source);
    const analysisSource = redaction.text;
    const hasRedactions = redaction.counts.total > 0;
    const existingFunctionIds = this.resolveFunctionIds
      ? await this.resolveFunctionIds(filePath, parsed.functions)
      : undefined;
    const existingModuleId = this.resolveModuleId
      ? await this.resolveModuleId(filePath)
      : undefined;
    let tokensBefore = 0;
    if (governor) {
      try { governor.enterFile(filePath); } catch (error: unknown) {
        if (isBudgetExceeded(error)) {
          const functions = parsed.functions.map((fn) => this.buildFunctionKnowledge(filePath, fn, undefined, existingFunctionIds?.get(fn.name), parsed.parser));
          const module = this.buildModuleKnowledge(filePath, parsed.module, functions, undefined, existingModuleId ?? undefined, parsed.parser);
          return { filePath, parser: parsed.parser, functions, module, callEdges: [], partiallyIndexed: true, llmTokensUsed: 0 };
        }
        throw error;
      }
      tokensBefore = governor.snapshot().usage.tokens_used_file;
    }

    if (parserFallback) {
      partiallyIndexed = true;
    }
    // Redactions only imply partial indexing when they prevent LLM-backed enrichment.
    // If analysis is disabled (no LLM configured), redactions do not reduce indexing quality.
    if (hasRedactions && this.analysisEnabled) {
      partiallyIndexed = true;
    }
    if (this.analysisEnabled && !hasRedactions) {
      try {
        analysis = await this.analyzeWithLlm(filePath, analysisSource, parsed, governor ?? undefined);
      } catch (error: unknown) {
        if (isBudgetExceeded(error)) {
          partiallyIndexed = true;
        } else {
          const message = getErrorMessage(error);
          const isExpectedFailure =
            message.includes('unverified_by_trace(provider_unavailable)') ||
            message.includes('unverified_by_trace(provider_invalid_output)') ||
            message.includes('unverified_by_trace(llm_execution_failed)') ||
            message.includes('unverified_by_trace(llm_adapter_') ||
            message.includes('unverified_by_trace(analysis_redaction_blocked)');
          if (isExpectedFailure) {
            partiallyIndexed = true;
            logWarning('LLM analysis failed; continuing without analysis', {
              filePath,
              error: message,
            });
          } else {
            throw error;
          }
        }
      }
    }

    const functions = parsed.functions.map((fn) => this.buildFunctionKnowledge(filePath, fn, analysis?.functionPurposes.get(fn.name), existingFunctionIds?.get(fn.name), parsed.parser));
    const module = this.buildModuleKnowledge(filePath, parsed.module, functions, analysis?.modulePurpose, existingModuleId ?? undefined, parsed.parser);
    const parsedCallEdges = extractCallEdgesFromAst(filePath, source, parsed.functions, parsed.parser);
    const callEdges = resolveCallEdges(parsedCallEdges, functions);
	const evidenceEntries = buildEvidenceEntries(filePath, source, functions, module);
	const evidenceStore = this.storage as { setEvidence?: (entries: EvidenceEntry[]) => Promise<void> };
	if (evidenceEntries.length && evidenceStore?.setEvidence) {
	  const initable = this.storage as unknown as { isInitialized?: () => boolean; initialize?: () => Promise<void> };
	  if (initable?.initialize && initable?.isInitialized && !initable.isInitialized()) {
	    try {
	      await initable.initialize();
	    } catch (error: unknown) {
	      logWarning('Librarian evidence store failed to initialize storage', {
	        filePath,
	        error: getErrorMessage(error),
	      });
	    }
	  }
	  try { await evidenceStore.setEvidence(evidenceEntries); } catch (error: unknown) {
	    if (!isBudgetExceeded(error)) {
	      logWarning('Librarian evidence store failed', {
	        filePath,
	        error: getErrorMessage(error),
	      });
        }
      }
    }
    if (this.embeddingService && functions.length > 0) {
      try {
        const requests = functions.map((fn) => ({ kind: 'code' as const, text: buildEmbeddingInput(fn, source), hint: `${fn.name} (${path.basename(filePath)})` }));
        const embeddings = await this.embeddingService.generateEmbeddings(requests, { governorContext: governor ?? undefined });
        if (embeddings.length !== functions.length) throw wrapInvalidOutput(`Embedding count mismatch (${embeddings.length} != ${functions.length})`);
        for (let i = 0; i < functions.length; i += 1) functions[i].embedding = embeddings[i].embedding;
      } catch (error: unknown) {
        if (isBudgetExceeded(error)) partiallyIndexed = true; else throw error;
      }
    }

    const tokensAfter = governor ? governor.snapshot().usage.tokens_used_file : tokensBefore;
    const llmTokensUsed = Math.max(0, tokensAfter - tokensBefore);
    return { filePath, parser: parsed.parser, functions, module, callEdges, partiallyIndexed, llmTokensUsed };
  }

  async indexFiles(filePaths: string[]): Promise<AstIndexResult[]> {
    const results: AstIndexResult[] = [];
    for (const filePath of filePaths) {
      results.push(await this.indexFile(filePath));
    }
    if (this.computeMetrics && this.storage) {
      await this.computeAndPersistMetrics(results);
    }
    return results;
  }
  getCoverageReport(): CoverageReport { return this.registry.getCoverageReport(); }
  resetCoverage(): void { this.registry.resetCoverage(); }

  private async recordLanguageGap(filePath: string, reason: string): Promise<void> {
    if (!this.storage) return;
    const extension = path.extname(filePath).toLowerCase() || 'unknown';
    const key = 'librarian.language_onboarding.v1';
    const existing = await this.storage.getState(key);
    const parsed = existing ? safeJsonParse<Record<string, unknown>>(existing) : { ok: false } as const;
    const now = new Date().toISOString();
    const payload = parsed.ok && parsed.value && typeof parsed.value === 'object'
      ? parsed.value as Record<string, unknown>
      : { schema_version: 1, updated_at: now, languages: {} as Record<string, unknown> };
    const languages = (payload.languages && typeof payload.languages === 'object')
      ? payload.languages as Record<string, { first_seen?: string; last_seen?: string; sample_files?: string[]; reasons?: string[] }>
      : {};
    const entry = languages[extension] ?? { first_seen: now, sample_files: [], reasons: [] };
    entry.last_seen = now;
    entry.sample_files = Array.from(new Set([...(entry.sample_files ?? []), filePath])).slice(0, 5);
    entry.reasons = Array.from(new Set([...(entry.reasons ?? []), reason])).slice(0, 5);
    languages[extension] = entry;
    payload.languages = languages;
    payload.updated_at = now;
    await this.storage.setState(key, JSON.stringify(payload));
  }

  private async parseWithLlmFallback(
    filePath: string,
    source: string,
    governor?: GovernorContext
  ): Promise<ParserResult> {
    if (!this.llmService || !this.llmProvider || !this.llmModelId) {
      throw wrapProviderUnavailable('LLM parser fallback disabled or provider not configured');
    }
    const sanitized = redactText(source);
    if (sanitized.counts.total > 0) {
      throw new Error('unverified_by_trace(analysis_redaction_blocked): redactions detected in parser fallback input');
    }
    const prompt = buildParserFallbackPrompt(filePath, sanitized.text, this.maxPromptChars);
    governor?.checkBudget();
    const response = await this.llmService.chat({
      provider: this.llmProvider,
      modelId: this.llmModelId,
      messages: [
        { role: 'system', content: 'You extract function boundaries and dependencies. Follow the schema exactly.' },
        { role: 'user', content: prompt },
      ],
      governorContext: governor ?? undefined,
    });
    return parseParserFallbackResponse(response.content);
  }

  private buildFunctionKnowledge(filePath: string, parsed: ParsedFunction, purposeOverride?: string, existingId?: string, parserType?: string): FunctionKnowledge {
    const purpose = choosePurpose(purposeOverride, parsed.purpose);
    const confidence = computeFunctionConfidence(parsed, purpose, parserType);
    return { id: existingId ?? randomUUID(), filePath, name: parsed.name, signature: parsed.signature, purpose, startLine: parsed.startLine, endLine: parsed.endLine, confidence, accessCount: 0, lastAccessed: null, validationCount: 0, outcomeHistory: { successes: 0, failures: 0 } };
  }

  private buildModuleKnowledge(filePath: string, parsed: ParsedModule, functions: FunctionKnowledge[], purposeOverride?: string, existingId?: string, parserType?: string): ModuleKnowledge {
    const purpose = choosePurpose(purposeOverride, this.generateModulePurpose(filePath, functions, parsed.exports));
    const confidence = computeModuleConfidence(functions, parsed, purpose, parserType);
    return { id: existingId ?? randomUUID(), path: filePath, purpose, exports: parsed.exports, dependencies: parsed.dependencies, confidence };
  }

  private generateModulePurpose(filePath: string, functions: FunctionKnowledge[], exports: string[]): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    const functionNames = functions.map((fn) => fn.name).slice(0, 5);
    if (exports.length > 0) return `Module ${fileName} exporting ${exports.slice(0, 3).join(', ')}${exports.length > 3 ? '...' : ''}`;
    if (functionNames.length > 0) return `Module ${fileName} containing ${functionNames.join(', ')}${functions.length > 5 ? '...' : ''}`;
    return `Module ${fileName}`;
  }

  private async analyzeWithLlm(filePath: string, source: string, parsed: ParserResult, governor?: GovernorContext): Promise<LlmAnalysisResult> {
    if (!this.llmService || !this.llmProvider || !this.llmModelId) {
      throw wrapProviderUnavailable('LLM analysis disabled or provider not configured');
    }
    const sanitized = redactText(source);
    if (sanitized.counts.total > 0) {
      throw new Error('unverified_by_trace(analysis_redaction_blocked): redactions detected in analysis input');
    }
    const prompt = buildAnalysisPrompt(filePath, sanitized.text, parsed, this.maxPromptChars);
    const maxRetries = governor ? governor.snapshot().config.maxRetries : DEFAULT_GOVERNOR_CONFIG.maxRetries;
    let lastError: Error | null = null;
    let lastReason: 'provider_invalid_output' | 'provider_unavailable' = 'provider_unavailable';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        governor?.checkBudget();
        const response = await this.llmService.chat({ provider: this.llmProvider, modelId: this.llmModelId, messages: [{ role: 'system', content: 'You are a static analysis engine. Follow the user schema exactly.' }, { role: 'user', content: prompt }], governorContext: governor ?? undefined });
        return parseAnalysisResponse(response.content, parsed.functions);
      } catch (error: unknown) {
        if (isBudgetExceeded(error)) throw error;
        const message = getErrorMessage(error);
        lastError = error instanceof Error ? error : new Error(message);
        if (message.includes('unverified_by_trace(provider_invalid_output)')) lastReason = 'provider_invalid_output';
        if (attempt < maxRetries) governor?.recordRetry();
      }
    }

    if (lastError) throw lastReason === 'provider_invalid_output' ? wrapInvalidOutput(lastError.message) : wrapProviderUnavailable(lastError.message);
    throw wrapProviderUnavailable('LLM analysis failed');
  }

  private async computeAndPersistMetrics(results: AstIndexResult[]): Promise<void> {
    const functionGraph = new Map<string, Set<string>>();
    const moduleGraph = new Map<string, Set<string>>();
    const moduleIdByPath = new Map<string, string>();
    const modulePathById = new Map<string, string>();
    const moduleDepsById = new Map<string, string[]>();
    for (const result of results) {
      for (const fn of result.functions) functionGraph.set(fn.id, new Set());
      for (const edge of result.callEdges) {
        const neighbors = functionGraph.get(edge.fromId);
        if (!neighbors) continue;
        neighbors.add(edge.toId);
      }
      if (result.module) {
        const normalized = normalizePath(result.module.path);
        moduleIdByPath.set(normalized, result.module.id);
        modulePathById.set(result.module.id, normalized);
        moduleDepsById.set(result.module.id, result.module.dependencies);
      }
    }
    for (const [moduleId, deps] of moduleDepsById) {
      const fromPath = modulePathById.get(moduleId);
      if (!fromPath) continue;
      const edges = new Set<string>();
      for (const dep of deps) {
        const target = resolveDependency(dep, fromPath, moduleIdByPath);
        if (target) edges.add(target);
      }
      moduleGraph.set(moduleId, edges);
    }
    const { metrics, report } = computeGraphMetrics({ function: functionGraph, module: moduleGraph });
    const storage = this.storage as { setGraphMetrics?: (entries: GraphMetricsEntry[]) => Promise<void> };
    if (storage.setGraphMetrics) await storage.setGraphMetrics(metrics);
    if (this.workspaceRoot) {
      await writeGraphMetricsReport(this.workspaceRoot, report);
    }
  }
}
function buildEvidenceEntries(filePath: string, source: string, functions: FunctionKnowledge[], module: ModuleKnowledge | null): EvidenceEntry[] {
  const createdAt = new Date().toISOString(); const entries: EvidenceEntry[] = [];
  for (const fn of functions) entries.push(...buildFunctionEvidence(filePath, source, fn, createdAt));
  if (module) entries.push(...buildModuleEvidence(filePath, source, module, createdAt));
  return entries;
}
function buildFunctionEvidence(filePath: string, source: string, fn: FunctionKnowledge, createdAt: string): EvidenceEntry[] {
  const snippet = extractSnippet(source, fn.startLine, fn.endLine); const entries: EvidenceEntry[] = [];
  entries.push({ claimId: randomUUID(), entityId: fn.id, entityType: 'function', file: filePath, line: fn.startLine, endLine: fn.endLine, snippet, claim: `Definition of ${fn.name}`, confidence: 'verified', createdAt });
  if (fn.purpose) entries.push({ claimId: randomUUID(), entityId: fn.id, entityType: 'function', file: filePath, line: fn.startLine, endLine: fn.endLine, snippet, claim: `Purpose: ${fn.purpose}`, confidence: 'inferred', createdAt });
  return entries;
}
function buildModuleEvidence(filePath: string, source: string, module: ModuleKnowledge, createdAt: string): EvidenceEntry[] {
  const snippet = extractSnippet(source, 1, Math.min(8, source.split(/\r?\n/).length || 1));
  const entries: EvidenceEntry[] = [];
  entries.push({ claimId: randomUUID(), entityId: module.id, entityType: 'module', file: filePath, line: 1, endLine: Math.min(8, source.split(/\r?\n/).length || 1), snippet, claim: `Module ${path.basename(filePath)} defined`, confidence: 'verified', createdAt });
  if (module.purpose) entries.push({ claimId: randomUUID(), entityId: module.id, entityType: 'module', file: filePath, line: 1, endLine: Math.min(8, source.split(/\r?\n/).length || 1), snippet, claim: `Module purpose: ${module.purpose}`, confidence: 'inferred', createdAt });
  return entries;
}
function extractSnippet(source: string, startLine: number, endLine: number, maxChars: number = 500): string {
  const lines = source.split(/\r?\n/); const start = Math.max(1, Math.min(startLine, lines.length)); const end = Math.max(start, Math.min(endLine, lines.length));
  const snippet = lines.slice(start - 1, end).join('\n'); return snippet.length <= maxChars ? snippet : `${snippet.slice(0, maxChars)}…`;
}
function buildAnalysisPrompt(filePath: string, source: string, parsed: ParserResult, maxChars: number): string {
  const exportsList = parsed.module.exports.length ? parsed.module.exports.join(', ') : 'none';
  const dependenciesList = parsed.module.dependencies.length ? parsed.module.dependencies.join(', ') : 'none';
  const functionsList = parsed.functions.length
    ? parsed.functions.map((fn) => `- ${fn.name} | ${fn.signature} | lines ${fn.startLine}-${fn.endLine}`).join('\n')
    : '- none';
  const content = truncateContent(source, maxChars);
  return ['Return JSON only, no commentary.', `Wrap JSON with ${ANALYSIS_BEGIN_MARKER} and ${ANALYSIS_END_MARKER}.`, 'Schema:', '{"schema_version":1,"kind":"LibrarianAstAnalysis.v1","module":{"purpose":""},"functions":[{"name":"","purpose":""}]}', 'Rules:', '- Use the provided function list; include every function exactly once.', '- Do not invent functions.', '- If purpose is unknown, use empty string.', '- Keep each purpose under 160 characters.', '', `File: ${filePath}`, `Exports: ${exportsList}`, `Dependencies: ${dependenciesList}`, 'Functions:', functionsList, '', 'File content:', content].join('\n');
}

function buildParserFallbackPrompt(filePath: string, source: string, maxChars: number): string {
  const content = truncateContent(source, maxChars);
  return [
    'Return JSON only, no commentary.',
    `Wrap JSON with ${PARSER_BEGIN_MARKER} and ${PARSER_END_MARKER}.`,
    'Schema:',
    '{"schema_version":1,"kind":"LibrarianParserFallback.v1","functions":[{"name":"","signature":"","startLine":1,"endLine":1}],"module":{"exports":[],"dependencies":[]}}',
    'Rules:',
    '- Include top-level functions, classes, methods, or exported definitions.',
    '- startLine/endLine must be 1-based line numbers.',
    '- Use empty arrays when unknown.',
    '',
    `File: ${filePath}`,
    'File content:',
    content,
  ].join('\n');
}

function parseAnalysisResponse(text: string, expected: ParsedFunction[]): LlmAnalysisResult {
  const cleaned = stripAnsi(String(text ?? ''));
  if (cleaned.length > MAX_ANALYSIS_RESPONSE_CHARS) throw wrapInvalidOutput(`LLM analysis response too large (${cleaned.length} chars)`);
  const payload = extractMarkedJson({ text: cleaned, beginMarker: ANALYSIS_BEGIN_MARKER, endMarker: ANALYSIS_END_MARKER, validate: isAnalysisPayload });
  if (!payload) throw wrapInvalidOutput('LLM analysis response missing JSON markers');
  const functionPurposes = new Map<string, string>();
  for (const entry of payload.functions) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    if (functionPurposes.has(name)) continue;
    const purpose = typeof entry.purpose === 'string' ? entry.purpose.trim() : '';
    functionPurposes.set(name, purpose);
  }
  if (expected.length > 0) {
    // Deduplicate expected names since there can be multiple functions with the same name in different scopes
    const expectedNames = new Set(expected.map((fn) => fn.name));
    const missing = [...expectedNames].filter((name) => !functionPurposes.has(name));
    if (missing.length > 0) {
      // Log warning but continue - LLM may legitimately skip some functions if content was truncated
      logWarning('[librarian] LLM analysis missing functions (will use AST fallback)', { missing: missing.slice(0, 5), total: missing.length });
    }
  }
  const modulePurpose = typeof payload.module?.purpose === 'string' ? payload.module.purpose.trim() : '';
  return { modulePurpose, functionPurposes };
}

function parseParserFallbackResponse(text: string): ParserResult {
  const cleaned = stripAnsi(String(text ?? ''));
  if (cleaned.length > MAX_ANALYSIS_RESPONSE_CHARS) throw wrapInvalidOutput(`LLM parser response too large (${cleaned.length} chars)`);
  const payload = extractMarkedJson({ text: cleaned, beginMarker: PARSER_BEGIN_MARKER, endMarker: PARSER_END_MARKER, validate: isParserFallbackPayload });
  if (!payload) throw wrapInvalidOutput('LLM parser response missing JSON markers');
  const functions: ParsedFunction[] = [];
  const seen = new Set<string>();
  for (const entry of payload.functions ?? []) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const signature = typeof entry?.signature === 'string' && entry.signature.trim() ? entry.signature.trim() : name;
    const startLine = Number.isFinite(entry?.startLine) ? Math.max(1, Math.trunc(entry.startLine)) : 1;
    const endLine = Number.isFinite(entry?.endLine) ? Math.max(startLine, Math.trunc(entry.endLine)) : startLine;
    const key = `${name}:${startLine}:${endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    functions.push({ name, signature, startLine, endLine, purpose: '' });
  }
  const module: ParsedModule = {
    exports: Array.isArray(payload.module?.exports) ? payload.module.exports.filter((item) => typeof item === 'string') : [],
    dependencies: Array.isArray(payload.module?.dependencies) ? payload.module.dependencies.filter((item) => typeof item === 'string') : [],
  };
  return { parser: 'llm-fallback', functions, module };
}

function isAnalysisPayload(value: unknown): value is AnalysisPayload { return !!value && typeof value === 'object' && (value as AnalysisPayload).schema_version === 1 && (value as AnalysisPayload).kind === 'LibrarianAstAnalysis.v1' && typeof (value as AnalysisPayload).module === 'object' && typeof (value as AnalysisPayload).module?.purpose === 'string' && Array.isArray((value as AnalysisPayload).functions); }
function isParserFallbackPayload(value: unknown): value is ParserFallbackPayload {
  return !!value &&
    typeof value === 'object' &&
    (value as ParserFallbackPayload).schema_version === 1 &&
    (value as ParserFallbackPayload).kind === 'LibrarianParserFallback.v1' &&
    Array.isArray((value as ParserFallbackPayload).functions) &&
    typeof (value as ParserFallbackPayload).module === 'object';
}
function truncateContent(text: string, limit: number): string {
  if (limit <= 0) return '';
  const redacted = redactText(String(text ?? '')).text;
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit)}\n[truncated]`;
}
function choosePurpose(primary?: string, fallback?: string): string { const first = (primary ?? '').trim(); return first ? first : (fallback ?? '').trim(); }
function isBudgetExceeded(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); return message.includes('unverified_by_trace(budget_exhausted)'); }
function wrapProviderUnavailable(message: string): Error { return message.includes('unverified_by_trace') ? new Error(message) : new Error(`unverified_by_trace(provider_unavailable): ${message}`); }
function wrapInvalidOutput(message: string): Error { return message.includes('unverified_by_trace') ? new Error(message) : new Error(`unverified_by_trace(provider_invalid_output): ${message}`); }
const callEdgeWarnings = new Set<string>();
let didWarnCallEdgeSuppression = false;

function shouldLogCallEdgeWarnings(): boolean {
  // Extremely common on large codebases; keep silent by default to avoid
  // drowning out real bootstrap/indexing failures. Enable explicitly when
  // debugging relationship mapping.
  return (
    process.env.LIBRARIAN_DEBUG_CALL_EDGES === '1' ||
    process.env.LIBRARIAN_DEBUG_CALL_EDGES === 'true'
  );
}

function getCallEdgeWarningLimit(): number {
  const raw = process.env.LIBRARIAN_DEBUG_CALL_EDGES_MAX;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 25;
}

function warnCallEdgeOnce(key: string, message: string, meta: Record<string, unknown>): void {
  if (!shouldLogCallEdgeWarnings()) return;
  if (callEdgeWarnings.has(key)) return;
  const limit = getCallEdgeWarningLimit();
  if (callEdgeWarnings.size >= limit) {
    if (!didWarnCallEdgeSuppression) {
      didWarnCallEdgeSuppression = true;
      logWarning('[librarian] Suppressing further call-edge ambiguity warnings', { limit });
    }
    return;
  }
  callEdgeWarnings.add(key);
  logWarning(`[librarian] ${message}`, meta);
}

/**
 * Resolved call edge with quality metadata for confidence computation.
 * Extends basic edge info with ambiguity and resolution tracking.
 */
export interface ResolvedCallEdge {
  fromId: string;
  toId: string;
  sourceLine: number | null;
  /** Whether the target function was found in the indexed functions */
  targetResolved: boolean;
  /** Whether multiple overloads could match (callee ambiguity) */
  isAmbiguous: boolean;
  /** Number of matching functions for the target name */
  overloadCount: number;
}

export function resolveCallEdges(
  parsedEdges: ParsedCallEdge[],
  functions: FunctionKnowledge[]
): ResolvedCallEdge[] {
  const edges: ResolvedCallEdge[] = [];
  const byName = new Map<string, FunctionKnowledge[]>();
  const byNameStart = new Map<string, FunctionKnowledge>();
  for (const fn of functions) {
    const list = byName.get(fn.name) ?? [];
    list.push(fn);
    byName.set(fn.name, list);
    byNameStart.set(`${fn.name}:${fn.startLine}`, fn);
  }
  const seen = new Set<string>();
  for (const edge of parsedEdges) {
    const from = resolveCaller(edge, byNameStart, byName);
    if (!from) continue;

    // Resolve callee with metadata
    const calleeResult = resolveCalleeWithMetadata(edge.toName, byName);
    const line = edge.callLine ?? null;

    // Skip self-calls
    if (calleeResult.resolved && calleeResult.fn?.id === from.id) continue;

    const toId = calleeResult.resolved
      ? calleeResult.fn!.id
      : `external:${edge.toName}`;

    const key = `${from.id}:${toId}:${line ?? 'n/a'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      fromId: from.id,
      toId,
      sourceLine: line,
      targetResolved: calleeResult.resolved,
      isAmbiguous: calleeResult.isAmbiguous,
      overloadCount: calleeResult.overloadCount,
    });
  }
  return edges;
}

function resolveCaller(
  edge: ParsedCallEdge,
  byNameStart: Map<string, FunctionKnowledge>,
  byName: Map<string, FunctionKnowledge[]>
): FunctionKnowledge | null {
  const exact = byNameStart.get(`${edge.fromName}:${edge.fromStartLine}`);
  if (exact) return exact;
  const candidates = byName.get(edge.fromName) ?? [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    warnCallEdgeOnce(`caller:${edge.fromName}`, 'Ambiguous call edge caller', {
      name: edge.fromName,
      startLine: edge.fromStartLine,
      totalMatches: candidates.length,
      matches: candidates.slice(0, 3).map((fn) => ({ id: fn.id, filePath: fn.filePath, startLine: fn.startLine })),
    });
  }
  return null;
}

/**
 * Result of callee resolution with metadata for confidence computation.
 */
interface CalleeResolutionResult {
  /** The resolved function, if found (picks first when ambiguous) */
  fn: FunctionKnowledge | null;
  /** Whether a matching function was found */
  resolved: boolean;
  /** Whether multiple overloads could match */
  isAmbiguous: boolean;
  /** Number of matching functions */
  overloadCount: number;
}

function resolveCalleeWithMetadata(
  name: string,
  byName: Map<string, FunctionKnowledge[]>
): CalleeResolutionResult {
  const candidates = byName.get(name) ?? [];

  if (candidates.length === 0) {
    // External/unresolved - not found in indexed functions
    return {
      fn: null,
      resolved: false,
      isAmbiguous: false,
      overloadCount: 0,
    };
  }

  if (candidates.length === 1) {
    // Unique match - best case
    return {
      fn: candidates[0],
      resolved: true,
      isAmbiguous: false,
      overloadCount: 1,
    };
  }

  // Multiple matches - ambiguous, pick first but mark it
  warnCallEdgeOnce(`callee:${name}`, 'Ambiguous call edge target', {
    name,
    totalMatches: candidates.length,
    matches: candidates.slice(0, 3).map((fn) => ({ id: fn.id, filePath: fn.filePath, startLine: fn.startLine })),
  });

  return {
    fn: candidates[0], // Pick first match
    resolved: true,
    isAmbiguous: true,
    overloadCount: candidates.length,
  };
}

function resolveCallee(
  name: string,
  byName: Map<string, FunctionKnowledge[]>
): FunctionKnowledge | null {
  const result = resolveCalleeWithMetadata(name, byName);
  // Legacy behavior: return null for ambiguous (for backwards compatibility in old code paths)
  if (result.isAmbiguous) return null;
  return result.fn;
}

function extractLines(lines: string[], startLine: number, endLine: number): string {
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, Math.max(start, endLine));
  if (start >= lines.length || end <= start) return '';
  return lines.slice(start, end).join('\n');
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveDependency(
  dependency: string,
  fromPath: string,
  moduleIdByPath: Map<string, string>
): string | null {
  if (!dependency.startsWith('.') && !dependency.startsWith('/')) return noResult();
  const direct = moduleIdByPath.get(normalizePath(dependency));
  if (direct) return direct;
  const base = dependency.startsWith('/')
    ? normalizePath(dependency)
    : normalizePath(path.resolve(path.dirname(fromPath), dependency));
  const candidates = new Set<string>([base]);
  if (!path.extname(base)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.add(`${base}${ext}`);
      candidates.add(path.join(base, `index${ext}`));
    }
  }
  for (const candidate of candidates) {
    const resolved = moduleIdByPath.get(candidate);
    if (resolved) return resolved;
  }
  return noResult();
}

function normalizePath(value: string): string {
  return path.normalize(path.resolve(value));
}

/**
 * Compute confidence for a function using continuous signals.
 * Produces real variance based on extraction quality and metadata richness.
 */
function computeFunctionConfidence(
  parsed: ParsedFunction,
  purpose: string,
  parserType?: string
): number {
  // Base confidence by parser type (continuous based on parser reliability)
  const parserConfidence = getParserConfidence(parserType);

  // Purpose quality: continuous based on length and content
  const purposeScore = computePurposeScore(purpose);

  // Signature complexity: continuous based on params and types
  const signatureScore = computeSignatureScore(parsed.signature);

  // Function size: penalize very small or very large functions
  const sizeScore = computeSizeScore(parsed.startLine, parsed.endLine);

  // Name quality: heuristic based on naming conventions
  const nameScore = computeNameScore(parsed.name);

  // Weighted combination (weights sum to 1.0)
  const confidence =
    parserConfidence * 0.35 +    // Parser reliability is most important
    purposeScore * 0.25 +        // Purpose description quality
    signatureScore * 0.15 +      // Signature completeness
    sizeScore * 0.15 +           // Reasonable function size
    nameScore * 0.10;            // Good naming conventions

  // Clamp to valid range [0.15, 0.92] - never fully certain or uncertain
  return Math.max(0.15, Math.min(0.92, confidence));
}

/**
 * Compute confidence for a module using continuous signals.
 */
function computeModuleConfidence(
  functions: FunctionKnowledge[],
  parsed: ParsedModule,
  purpose: string,
  parserType?: string
): number {
  // Base confidence by parser type
  const parserConfidence = getParserConfidence(parserType);

  // Function confidence distribution (prefer modules with consistent function quality)
  let functionScore = 0.5;
  if (functions.length > 0) {
    const avgConf = functions.reduce((s, f) => s + f.confidence, 0) / functions.length;
    const variance = functions.reduce((s, f) => s + Math.pow(f.confidence - avgConf, 2), 0) / functions.length;
    // Higher avg confidence and lower variance = better
    functionScore = avgConf * 0.7 + (1 - Math.min(1, variance * 10)) * 0.3;
  }

  // Export completeness: more exports with good names = higher confidence
  const exportScore = computeExportScore(parsed.exports);

  // Dependency clarity: well-defined dependencies = higher confidence
  const dependencyScore = computeDependencyScore(parsed.dependencies);

  // Purpose quality
  const purposeScore = computePurposeScore(purpose);

  // Weighted combination
  const confidence =
    parserConfidence * 0.25 +
    functionScore * 0.30 +
    exportScore * 0.15 +
    dependencyScore * 0.10 +
    purposeScore * 0.20;

  // Clamp to valid range
  return Math.max(0.15, Math.min(0.92, confidence));
}

// ============================================================================
// CONFIDENCE SIGNAL HELPERS
// ============================================================================

/**
 * Get base confidence for a parser type.
 * AST parsers are more reliable than LLM fallback.
 */
function getParserConfidence(parserType?: string): number {
  if (!parserType) return 0.5;

  // Tiered parser confidence
  if (parserType === 'ts-morph') return 0.95;           // TypeScript AST - highest reliability
  if (parserType.startsWith('tree-sitter')) return 0.90; // Tree-sitter - very reliable
  if (parserType === 'llm-fallback') return 0.45;       // LLM fallback - lowest
  return 0.6; // Unknown parser
}

/**
 * Compute purpose description quality score.
 * Continuous based on length, specificity, and content.
 */
function computePurposeScore(purpose: string): number {
  if (!purpose) return 0.2;

  const len = purpose.length;

  // Length-based score (diminishing returns after 100 chars)
  const lengthScore = Math.min(1, len / 100) * 0.4;

  // Specificity: penalize generic descriptions
  const genericPhrases = ['function', 'method', 'helper', 'utility', 'handles', 'does'];
  const words = purpose.toLowerCase().split(/\s+/);
  const genericCount = words.filter(w => genericPhrases.includes(w)).length;
  const specificityScore = Math.max(0, 1 - genericCount * 0.15) * 0.3;

  // Technical depth: reward specific technical terms
  const technicalTerms = ['async', 'promise', 'callback', 'validation', 'parse', 'transform',
    'compute', 'calculate', 'render', 'serialize', 'deserialize', 'encrypt', 'decrypt',
    'authenticate', 'authorize', 'cache', 'index', 'query', 'fetch', 'store'];
  const technicalCount = words.filter(w => technicalTerms.some(t => w.includes(t))).length;
  const technicalScore = Math.min(1, technicalCount * 0.3) * 0.3;

  return lengthScore + specificityScore + technicalScore;
}

/**
 * Compute signature complexity score.
 * Rewards well-typed, documented signatures.
 */
function computeSignatureScore(signature: string): number {
  if (!signature) return 0.2;

  let score = 0.4; // Base score for having a signature

  // Has parameters
  const paramMatch = signature.match(/\(([^)]*)\)/);
  if (paramMatch) {
    const params = paramMatch[1];
    if (params.length > 0) {
      // Count typed parameters (look for : type patterns)
      const typedParams = (params.match(/:\s*\w+/g) || []).length;
      const totalParams = params.split(',').filter(p => p.trim()).length;
      if (totalParams > 0) {
        score += (typedParams / totalParams) * 0.3;
      }
    }
  }

  // Has return type
  if (signature.includes('): ') || signature.includes('=> ')) {
    score += 0.2;
  }

  // Has generic types (more sophisticated)
  if (signature.includes('<') && signature.includes('>')) {
    score += 0.1;
  }

  return Math.min(1, score);
}

/**
 * Compute size score based on function length.
 * Penalize very small (likely trivial) or very large (likely complex) functions.
 */
function computeSizeScore(startLine: number, endLine: number): number {
  if (startLine <= 0 || endLine < startLine) return 0.3;

  const lines = endLine - startLine + 1;

  // Ideal range: 5-50 lines
  if (lines >= 5 && lines <= 50) return 0.9;

  // Small functions (1-4 lines): might be trivial
  if (lines < 5) return 0.5 + (lines / 5) * 0.3;

  // Large functions (51-200 lines): increasingly complex
  if (lines <= 200) return 0.9 - ((lines - 50) / 150) * 0.4;

  // Very large functions (200+ lines): likely needs refactoring
  return 0.4;
}

/**
 * Compute name quality score based on naming conventions.
 */
function computeNameScore(name: string): number {
  if (!name) return 0.2;

  let score = 0.5;

  // Reasonable length (3-30 chars is ideal)
  if (name.length >= 3 && name.length <= 30) score += 0.2;
  else if (name.length < 3) score -= 0.2;

  // Uses camelCase or snake_case (not all lowercase or uppercase)
  const hasCamelCase = /[a-z][A-Z]/.test(name);
  const hasSnakeCase = /_[a-z]/.test(name);
  if (hasCamelCase || hasSnakeCase) score += 0.15;

  // Starts with verb (good practice for functions)
  const verbPrefixes = ['get', 'set', 'is', 'has', 'can', 'should', 'will', 'create',
    'build', 'make', 'init', 'load', 'save', 'fetch', 'find', 'compute', 'calculate',
    'validate', 'check', 'parse', 'format', 'render', 'handle', 'process', 'on'];
  const lowerName = name.toLowerCase();
  if (verbPrefixes.some(v => lowerName.startsWith(v))) score += 0.15;

  return Math.min(1, score);
}

/**
 * Compute export quality score.
 */
function computeExportScore(exports: string[]): number {
  if (!exports || exports.length === 0) return 0.3;

  // More exports with good names = higher confidence
  const wellNamedExports = exports.filter(e => e.length >= 3 && /^[a-zA-Z]/.test(e)).length;
  const ratio = wellNamedExports / exports.length;

  // Diminishing returns after 10 exports
  const countScore = Math.min(1, exports.length / 10) * 0.5;
  const qualityScore = ratio * 0.5;

  return 0.3 + countScore + qualityScore;
}

/**
 * Compute dependency clarity score.
 */
function computeDependencyScore(dependencies: string[]): number {
  if (!dependencies || dependencies.length === 0) return 0.4; // No deps is neutral

  // Relative imports (local) vs package imports
  const localDeps = dependencies.filter(d => d.startsWith('.') || d.startsWith('/')).length;
  const packageDeps = dependencies.length - localDeps;

  // Well-balanced dependencies
  const total = dependencies.length;
  const localRatio = localDeps / total;

  // Penalize too many dependencies (complexity) or too few (isolation)
  let score = 0.5;
  if (total >= 1 && total <= 15) score += 0.2;
  else if (total > 15) score -= Math.min(0.2, (total - 15) * 0.01);

  // Reward balanced local/package mix
  if (localRatio >= 0.2 && localRatio <= 0.8) score += 0.15;

  // Reward well-named dependencies
  const wellNamed = dependencies.filter(d => !d.includes('..') && d.length > 2).length;
  score += (wellNamed / total) * 0.15;

  return Math.min(1, score);
}

// ============================================================================
// EDGE-BASED CONFIDENCE AGGREGATION
// ============================================================================

/**
 * Graph edge data for confidence aggregation
 */
export interface EdgeForAggregation {
  fromId: string;
  toId: string;
  confidence: number;
  edgeType: 'calls' | 'imports';
}

/**
 * Compute edge-based confidence boost for a function.
 * Functions connected to high-confidence code are likely more reliable.
 *
 * @param functionId - The function ID to compute boost for
 * @param incomingEdges - Edges where this function is the target (callers)
 * @param outgoingEdges - Edges where this function is the source (callees)
 * @returns Confidence adjustment factor (0.0 to 0.15)
 */
export function computeEdgeAggregationBoost(
  functionId: string,
  incomingEdges: EdgeForAggregation[],
  outgoingEdges: EdgeForAggregation[]
): number {
  // No edges = neutral (no boost, no penalty)
  if (incomingEdges.length === 0 && outgoingEdges.length === 0) {
    return 0;
  }

  let boost = 0;

  // Incoming edges (callers) - being called by well-understood code is a good sign
  if (incomingEdges.length > 0) {
    const avgIncoming = incomingEdges.reduce((s, e) => s + e.confidence, 0) / incomingEdges.length;
    // Scale: if avg confidence is 0.9, boost is +0.05; if 0.5, no boost
    const incomingBoost = Math.max(0, (avgIncoming - 0.5) * 0.125);
    // Cap incoming boost at 0.05
    boost += Math.min(0.05, incomingBoost);
  }

  // Outgoing edges (callees) - calling well-understood code is good
  if (outgoingEdges.length > 0) {
    const avgOutgoing = outgoingEdges.reduce((s, e) => s + e.confidence, 0) / outgoingEdges.length;
    // Scale: if avg confidence is 0.9, boost is +0.04; if 0.5, no boost
    const outgoingBoost = Math.max(0, (avgOutgoing - 0.5) * 0.1);
    // Cap outgoing boost at 0.04
    boost += Math.min(0.04, outgoingBoost);
  }

  // Connectivity bonus: well-connected functions are likely important/well-understood
  const totalEdges = incomingEdges.length + outgoingEdges.length;
  if (totalEdges >= 3) {
    // Small bonus for being well-connected (max 0.03)
    const connectivityBonus = Math.min(0.03, totalEdges * 0.005);
    boost += connectivityBonus;
  }

  // Cap total boost at 0.12 to prevent edge effects from dominating
  return Math.min(0.12, boost);
}

/**
 * Apply edge-based confidence aggregation to a function's base confidence.
 * This blends the base confidence with the edge quality signal.
 *
 * @param baseConfidence - The function's intrinsic confidence (from AST analysis)
 * @param edgeBoost - The edge aggregation boost
 * @returns Adjusted confidence
 */
export function applyEdgeAggregation(
  baseConfidence: number,
  edgeBoost: number
): number {
  // Add boost but respect bounds
  return Math.max(0.15, Math.min(0.95, baseConfidence + edgeBoost));
}

// ============================================================================
// EVIDENCE QUALITY FACTORS
// ============================================================================

/**
 * Evidence entry for quality scoring
 */
export interface EvidenceForQuality {
  claim: string;
  confidence: 'verified' | 'inferred' | 'uncertain';
  createdAt: string;
}

/**
 * Evidence type weights for quality scoring
 */
const EVIDENCE_TYPE_WEIGHTS: Record<string, number> = {
  verified: 0.95,   // Verified by AST/parser
  inferred: 0.65,   // Inferred by LLM
  uncertain: 0.35,  // Uncertain/unverified
};

/**
 * Compute evidence quality score for an entity.
 * More evidence and higher-quality evidence = higher score.
 *
 * @param entries - Evidence entries for this entity
 * @returns Score between 0 and 1
 */
export function computeEvidenceQualityScore(
  entries: EvidenceForQuality[]
): number {
  if (entries.length === 0) return 0.3; // No evidence = low score

  // Base score from evidence count (diminishing returns)
  const countScore = Math.min(1, entries.length / 5) * 0.3;

  // Quality score from evidence types
  let qualitySum = 0;
  for (const entry of entries) {
    qualitySum += EVIDENCE_TYPE_WEIGHTS[entry.confidence] ?? 0.5;
  }
  const avgQuality = qualitySum / entries.length;
  const qualityScore = avgQuality * 0.5;

  // Freshness score (decay based on oldest evidence)
  let freshnessScore = 0.2;
  const now = Date.now();
  const oldestEntry = entries.reduce((oldest, e) => {
    const time = new Date(e.createdAt).getTime();
    return isNaN(time) ? oldest : Math.min(oldest, time);
  }, now);

  if (oldestEntry < now) {
    const daysSinceOldest = (now - oldestEntry) / (1000 * 60 * 60 * 24);
    // Decay freshness over 90 days
    freshnessScore = Math.max(0, 0.2 * (1 - daysSinceOldest / 90));
  }

  return countScore + qualityScore + freshnessScore;
}

/**
 * Compute evidence quality boost for a function/module confidence.
 * Strong evidence increases confidence; weak/missing evidence decreases it.
 *
 * @param evidenceQualityScore - Score from computeEvidenceQualityScore
 * @returns Adjustment factor (-0.10 to +0.10)
 */
export function computeEvidenceQualityBoost(
  evidenceQualityScore: number
): number {
  // Score of 0.5 is neutral (no adjustment)
  // Higher than 0.5 = boost, lower = penalty
  const adjustment = (evidenceQualityScore - 0.5) * 0.2;
  return Math.max(-0.10, Math.min(0.10, adjustment));
}

/**
 * Apply all confidence adjustments (edge + evidence).
 * Combines base confidence with edge and evidence signals.
 *
 * @param baseConfidence - Initial confidence from AST analysis
 * @param edgeBoost - Boost from graph connectivity
 * @param evidenceBoost - Boost from evidence quality
 * @returns Final adjusted confidence
 */
export function computeFinalConfidence(
  baseConfidence: number,
  edgeBoost: number,
  evidenceBoost: number
): number {
  const adjusted = baseConfidence + edgeBoost + evidenceBoost;
  // Clamp to valid range [0.10, 0.95]
  // Lower floor (0.10) to allow evidence-poor entries to be penalized
  return Math.max(0.10, Math.min(0.95, adjusted));
}
