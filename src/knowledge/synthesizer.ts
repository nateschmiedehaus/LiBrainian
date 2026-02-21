/**
 * @fileoverview Knowledge Synthesizer
 *
 * Synthesizes knowledge from the Knowledge module for agent context assembly.
 * Uses LLM to summarize knowledge query results into actionable insights.
 *
 * Extracted from librainian.ts to reduce god object size.
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { LiBrainianQuery } from '../types.js';
import type { KnowledgeSourceRef } from '../api/context_assembly.js';
import type { KnowledgeCategory, KnowledgeQuery, KnowledgeResult } from './index.js';
import { Knowledge } from './index.js';
import { GovernorContext } from '../api/governor_context.js';
import { ProviderUnavailableError } from '../api/provider_check.js';
import { resolveLiBrainianModelConfigWithDiscovery, resolveLiBrainianModelId } from '../api/llm_env.js';
import { llmProviderRegistry } from '../api/llm_provider_discovery.js';
import { requireProviders } from '../api/provider_check.js';
import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';
import { resolveLlmServiceAdapter, type LlmServiceAdapter } from '../adapters/llm_service.js';

// ============================================================================
// TYPES
// ============================================================================

export interface KnowledgeSynthesizerConfig {
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  workspaceRoot: string;
}

type KnowledgeSummary = {
  summary: string;
  highlights: string[];
  confidence: number;
};

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_KNOWLEDGE_SOURCES = 6;

const KNOWLEDGE_MAP_CODES: Record<KnowledgeCategory, string[]> = {
  architecture: ['MAP.ARCH', 'MAP.DEP', 'MAP.CONTRACT'],
  impact: ['MAP.IMPACT', 'MAP.TEST', 'MAP.RISK'],
  quality: ['MAP.QUALITY', 'MAP.RISK'],
  patterns: ['MAP.QUALITY', 'MAP.RATIONALE'],
  structure: ['MAP.STRUCT', 'MAP.ID'],
  evolution: ['MAP.EVOL', 'MAP.KNOW'],
};

const KEYWORD_CATEGORY_HINTS: Array<{ category: KnowledgeCategory; keywords: string[] }> = [
  { category: 'architecture', keywords: ['architecture', 'boundary', 'layer', 'dependency', 'component'] },
  { category: 'impact', keywords: ['impact', 'blast', 'risk', 'change', 'break'] },
  { category: 'quality', keywords: ['quality', 'debt', 'complexity', 'refactor', 'maintain'] },
  { category: 'patterns', keywords: ['pattern', 'convention', 'anti-pattern', 'style'] },
  { category: 'structure', keywords: ['structure', 'directory', 'entry', 'module', 'organization'] },
  { category: 'evolution', keywords: ['history', 'churn', 'trend', 'evolution', 'incident'] },
];

const UC_CATEGORY_RANGES: Array<{ min: number; max: number; categories: KnowledgeCategory[] }> = [
  { min: 1, max: 10, categories: ['structure'] },
  { min: 11, max: 20, categories: ['architecture'] },
  { min: 41, max: 50, categories: ['impact'] },
  { min: 71, max: 80, categories: ['quality'] },
  { min: 91, max: 100, categories: ['quality'] },
  { min: 131, max: 140, categories: ['quality', 'architecture'] },
  { min: 161, max: 170, categories: ['evolution'] },
  { min: 221, max: 230, categories: ['structure', 'patterns'] },
  { min: 231, max: 240, categories: ['evolution', 'quality'] },
];

// ============================================================================
// KNOWLEDGE SYNTHESIZER
// ============================================================================

export class KnowledgeSynthesizer {
  private knowledge: Knowledge;
  private config: KnowledgeSynthesizerConfig;

  constructor(storage: LiBrainianStorage, config: KnowledgeSynthesizerConfig) {
    this.knowledge = new Knowledge(storage);
    this.config = config;
  }

  /**
   * Build knowledge sources for agent context assembly.
   */
  async buildKnowledgeSources(
    query: LiBrainianQuery,
    workspaceRoot: string,
    governor: GovernorContext
  ): Promise<KnowledgeSourceRef[]> {
    const categories = resolveKnowledgeCategories(query);
    if (!categories.length) return [];

    await requireProviders({ llm: true, embedding: false });
    const resolved = await resolveLiBrainianModelConfigWithDiscovery();
    const overrideProvider = this.config.llmProvider;
    const overrideModel = this.config.llmModelId;
    const llmProvider = overrideProvider ?? resolved.provider;
    let llmModelId =
      overrideModel ??
      (overrideProvider ? resolveLiBrainianModelId(overrideProvider) : undefined) ??
      resolved.modelId ??
      llmProviderRegistry.getProbe(overrideProvider ?? '')?.descriptor.defaultModel;
    if (!llmProvider || !llmModelId) {
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): knowledge summaries require LLM provider and model',
        missing: ['llm_provider_config_missing'],
        suggestion: 'Authenticate providers via CLI and set LIBRARIAN_LLM_PROVIDER/LIBRARIAN_LLM_MODEL.',
      });
    }

    const target = resolveKnowledgeTarget(query, workspaceRoot);
    const llm = resolveLlmServiceAdapter();
    const sources: KnowledgeSourceRef[] = [];

    for (const category of categories) {
      if (sources.length >= MAX_KNOWLEDGE_SOURCES) break;
      const knowledgeQuery = buildKnowledgeQuery(category, query, target);
      if (!knowledgeQuery) continue;
      const result = await this.knowledge.query(knowledgeQuery);
      const summary = await this.summarizeKnowledgeResult({
        category,
        query,
        result,
        llm,
        llmProvider,
        llmModelId,
        governor,
      });
      const relatedFiles = collectRelatedFiles(category, result, workspaceRoot);
      const mapCodes = KNOWLEDGE_MAP_CODES[category] ?? [];
      const highlights = [
        ...summary.highlights,
        ...(mapCodes.length ? [`Maps: ${mapCodes.join(', ')}`] : []),
        ...(relatedFiles.length ? [`Evidence: ${relatedFiles.slice(0, 5).join(', ')}`] : []),
      ];
      sources.push({
        id: `knowledge:${category}:${randomUUID()}`,
        sourceType: `knowledge.${category}`,
        summary: summary.summary,
        relatedFiles,
        highlights,
        confidence: summary.confidence,
        // Explicit map codes for direct agent access (UNDERSTANDING_LAYER mandate)
        mapCodes,
        category,
      });
    }

    return sources;
  }

  private async summarizeKnowledgeResult(options: {
    category: KnowledgeCategory;
    query: LiBrainianQuery;
    result: KnowledgeResult;
    llm: LlmServiceAdapter;
    llmProvider: 'claude' | 'codex';
    llmModelId: string;
    governor: GovernorContext;
  }): Promise<KnowledgeSummary> {
    const payload = formatKnowledgePayload(options.category, options.result);
    const prompt = [
      'Summarize the knowledge-map output for agent context.',
      'Return JSON only with schema:',
      '{"summary":"...","highlights":["..."],"confidence":0.0}',
      'Rules:',
      '- summary <= 60 words.',
      '- highlights: 3-6 short bullets.',
      '- use only facts from the payload.',
      '',
      `Category: ${options.category}`,
      `Intent: ${options.query.intent}`,
      `TaskType: ${options.query.taskType ?? 'none'}`,
      `Depth: ${options.query.depth}`,
      '',
      `Payload: ${JSON.stringify(payload)}`,
    ].join('\n');

    options.governor.checkBudget();
    const response = await options.llm.chat({
      provider: options.llmProvider,
      modelId: options.llmModelId,
      messages: [
        { role: 'system', content: 'Return JSON only. Follow the schema exactly.' },
        { role: 'user', content: prompt },
      ],
      governorContext: options.governor,
    });
    const json = extractFirstJson(response.content);
    if (!json) {
      throw new Error('unverified_by_trace(provider_invalid_output): knowledge summary JSON missing');
    }
    const parsed = safeJsonParse<Record<string, unknown>>(json);
    if (!parsed.ok) {
      const message = getResultErrorMessage(parsed) || 'invalid JSON';
      throw new Error(`unverified_by_trace(provider_invalid_output): ${message}`);
    }
    const summary = extractRequiredString(parsed.value.summary, 'summary');
    const highlights = extractHighlights(parsed.value.highlights);
    if (highlights.length === 0) {
      throw new Error('unverified_by_trace(provider_invalid_output): knowledge summary missing highlights');
    }
    return {
      summary,
      highlights,
      confidence: clampConfidence(parsed.value.confidence),
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function resolveKnowledgeCategories(query: LiBrainianQuery): KnowledgeCategory[] {
  const categories = new Set<KnowledgeCategory>();
  const depth = query.depth ?? 'L1';
  const depthDefaults: Record<NonNullable<LiBrainianQuery['depth']>, KnowledgeCategory[]> = {
    L0: ['structure'],
    L1: ['structure', 'architecture'],
    L2: ['structure', 'architecture', 'impact', 'quality', 'patterns'],
    L3: ['structure', 'architecture', 'impact', 'quality', 'patterns', 'evolution'],
  };
  for (const category of depthDefaults[depth]) categories.add(category);

  const tokens = `${query.intent ?? ''} ${query.taskType ?? ''}`.toLowerCase();
  for (const hint of KEYWORD_CATEGORY_HINTS) {
    if (hint.keywords.some((keyword) => tokens.includes(keyword))) {
      categories.add(hint.category);
    }
  }

  const ucIds = query.ucRequirements?.ucIds ?? [];
  for (const ucId of ucIds) {
    const numeric = Number.parseInt(ucId.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(numeric)) continue;
    const match = UC_CATEGORY_RANGES.find((entry) => numeric >= entry.min && numeric <= entry.max);
    if (match) {
      for (const category of match.categories) categories.add(category);
    }
  }

  return Array.from(categories.values());
}

function resolveKnowledgeTarget(query: LiBrainianQuery, workspaceRoot: string): string | null {
  const target = query.affectedFiles?.find(Boolean);
  if (!target) return null;
  return path.isAbsolute(target) ? target : path.resolve(workspaceRoot, target);
}

function buildKnowledgeQuery(
  category: KnowledgeCategory,
  query: LiBrainianQuery,
  target: string | null
): KnowledgeQuery | null {
  const depth = query.depth === 'L3' ? 4 : query.depth === 'L2' ? 3 : 2;
  switch (category) {
    case 'architecture':
      return {
        category: 'architecture',
        query: { type: target ? 'dependencies' : 'layers', target: target ?? undefined, depth },
      };
    case 'impact':
      if (!target) return null;
      return {
        category: 'impact',
        query: { type: 'change_impact', target, depth },
      };
    case 'quality':
      return {
        category: 'quality',
        query: { type: query.depth === 'L3' ? 'maintainability' : 'complexity', target: target ?? undefined },
      };
    case 'patterns':
      return {
        category: 'patterns',
        query: { type: query.depth === 'L3' ? 'emergent' : 'anti_patterns', target: target ?? undefined },
      };
    case 'structure':
      return {
        category: 'structure',
        query: { type: query.depth === 'L0' ? 'file_types' : 'organization', target: target ?? undefined },
      };
    case 'evolution':
      return {
        category: 'evolution',
        query: { type: query.depth === 'L3' ? 'trends' : 'performance', target: target ?? undefined },
      };
    default:
      return null;
  }
}

function formatKnowledgePayload(category: KnowledgeCategory, result: KnowledgeResult): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid knowledge result: expected non-null object');
  }
  const base = result as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    summary: typeof base.summary === 'string' ? base.summary : '',
    recommendations: Array.isArray(base.recommendations) ? base.recommendations.slice(0, 6) : [],
  };

  switch (category) {
    case 'architecture':
      payload.dependencies = limitList(base.dependencies as unknown[] | undefined, 8);
      payload.cycles = limitList(base.cycles as unknown[] | undefined, 3);
      payload.coreModules = limitList(base.coreModules as unknown[] | undefined, 5);
      payload.violations = limitList(base.violations as unknown[] | undefined, 5);
      break;
    case 'impact':
      payload.affected = limitList(base.affected as unknown[] | undefined, 10);
      payload.tests = limitList(base.tests as unknown[] | undefined, 8);
      payload.risk = base.risk ?? null;
      break;
    case 'quality':
      payload.complexity = base.complexity ?? null;
      payload.smells = limitList(base.smells as unknown[] | undefined, 8);
      payload.refactoring = limitList(base.refactoring as unknown[] | undefined, 6);
      payload.improvements = limitList(base.improvements as unknown[] | undefined, 6);
      payload.score = base.score ?? null;
      break;
    case 'patterns':
      payload.patterns = limitList(base.patterns as unknown[] | undefined, 6);
      payload.antiPatterns = limitList(base.antiPatterns as unknown[] | undefined, 6);
      payload.conventions = limitList(base.conventions as unknown[] | undefined, 6);
      break;
    case 'structure':
      payload.organization = base.organization ?? null;
      payload.entryPoints = limitList(base.entryPoints as unknown[] | undefined, 6);
      payload.directories = limitList(base.directories as unknown[] | undefined, 6);
      payload.fileTypes = base.fileTypes ?? null;
      payload.exports = base.exports ?? null;
      break;
    case 'evolution':
      payload.performance = base.performance ?? null;
      payload.trends = base.trends ?? null;
      payload.optimizations = limitList(base.optimizations as unknown[] | undefined, 5);
      payload.learnings = limitList(base.learnings as unknown[] | undefined, 5);
      break;
  }

  return payload;
}

function collectRelatedFiles(
  category: KnowledgeCategory,
  result: KnowledgeResult,
  workspaceRoot: string
): string[] {
  const files = new Set<string>();
  const add = (value?: string): void => {
    if (!value) return;
    const resolved = path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
    files.add(resolved);
  };
  const addArray = (values: unknown[], field: string): void => {
    for (const entry of values) {
      if (!isRecord(entry)) continue;
      const raw = entry[field];
      if (typeof raw === 'string') add(raw);
    }
  };
  if (!result || typeof result !== 'object') {
    return [];
  }
  const base = result as unknown as Record<string, unknown>;

  switch (category) {
    case 'architecture':
      addArray((base.dependencies as unknown[] | undefined) ?? [], 'path');
      addArray((base.coreModules as unknown[] | undefined) ?? [], 'path');
      addArray((base.violations as unknown[] | undefined) ?? [], 'source');
      addArray((base.violations as unknown[] | undefined) ?? [], 'target');
      for (const cycle of (base.cycles as Array<{ nodes?: string[] }> | undefined) ?? []) {
        if (Array.isArray(cycle.nodes)) cycle.nodes.forEach((node) => add(node));
      }
      break;
    case 'impact':
      addArray((base.affected as unknown[] | undefined) ?? [], 'path');
      addArray((base.tests as unknown[] | undefined) ?? [], 'testFile');
      break;
    case 'quality':
      addArray((base.refactoring as unknown[] | undefined) ?? [], 'source');
      addArray((base.refactoring as unknown[] | undefined) ?? [], 'target');
      if (isRecord(base.complexity) && Array.isArray(base.complexity.hotspots)) {
        addArray(base.complexity.hotspots as unknown[], 'path');
      }
      if (Array.isArray(base.smells)) {
        for (const smell of base.smells) {
          if (!isRecord(smell)) continue;
          const location = smell.location;
          if (isRecord(location) && typeof location.file === 'string') {
            add(location.file);
          }
        }
      }
      break;
    case 'patterns':
      addArray((base.patterns as unknown[] | undefined) ?? [], 'occurrences');
      addArray((base.antiPatterns as unknown[] | undefined) ?? [], 'occurrences');
      if (Array.isArray(base.patterns)) {
        for (const pattern of base.patterns as Array<{ occurrences?: Array<{ file?: string }> }>) {
          pattern.occurrences?.forEach((occ) => add(occ.file));
        }
      }
      if (Array.isArray(base.antiPatterns)) {
        for (const pattern of base.antiPatterns as Array<{ occurrences?: Array<{ file?: string }> }>) {
          pattern.occurrences?.forEach((occ) => add(occ.file));
        }
      }
      break;
    case 'structure':
      addArray((base.entryPoints as unknown[] | undefined) ?? [], 'path');
      addArray((base.directories as unknown[] | undefined) ?? [], 'path');
      break;
    case 'evolution':
      addArray((base.optimizations as unknown[] | undefined) ?? [], 'target');
      break;
  }

  return Array.from(files.values());
}

function limitList<T>(values: T[] | undefined, limit: number): T[] {
  if (!Array.isArray(values)) return [];
  return values.slice(0, limit);
}

function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function extractRequiredString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`unverified_by_trace(provider_invalid_output): knowledge summary missing ${label}`);
}

function extractHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0.6;
  return Math.max(0.1, Math.min(0.95, numeric));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
