import path from 'node:path';
import type { LibrarianStorage } from '../storage/types.js';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import type { FunctionKnowledge } from '../types.js';
import type { GraphMetricsEntry } from '../graphs/metrics.js';

export type RepoMapStyle = 'compact' | 'detailed' | 'json';

export interface RepoMapOptions {
  maxTokens?: number;
  focus?: string[];
  style?: RepoMapStyle;
  maxSymbolsPerFile?: number;
}

export interface RepoMapSymbol {
  name: string;
  kind: 'function';
  line: number;
  signature: string;
  isExported: boolean;
}

export interface RepoMapEntry {
  path: string;
  pagerankScore: number;
  symbols: RepoMapSymbol[];
}

export interface RepoMapResult {
  workspaceRoot: string;
  generatedAt: string;
  style: RepoMapStyle;
  maxTokens: number;
  consumedTokens: number;
  entries: RepoMapEntry[];
  text?: string;
}

type GraphMetricsReader = LibrarianStorage & {
  getGraphMetrics?: (options?: { entityIds?: string[]; entityType?: 'function' | 'module' }) => Promise<GraphMetricsEntry[]>;
};

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 8;

export async function getRepoMap(
  workspaceRoot: string,
  options: RepoMapOptions = {},
): Promise<RepoMapResult> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const dbPath = path.join(resolvedWorkspaceRoot, '.librarian', 'librarian.sqlite');
  const storage = createSqliteStorage(dbPath, resolvedWorkspaceRoot);
  await storage.initialize();
  try {
    return await generateRepoMap(storage, resolvedWorkspaceRoot, options);
  } finally {
    await storage.close();
  }
}

export async function generateRepoMap(
  storage: LibrarianStorage,
  workspaceRoot: string,
  options: RepoMapOptions = {},
): Promise<RepoMapResult> {
  const style: RepoMapStyle = options.style ?? 'compact';
  const maxTokens = clampInt(options.maxTokens, DEFAULT_MAX_TOKENS, 128, 32000);
  const maxSymbolsPerFile = clampInt(options.maxSymbolsPerFile, DEFAULT_MAX_SYMBOLS_PER_FILE, 1, 64);
  const focusPatterns = (options.focus ?? []).map((value) => normalizePath(value)).filter(Boolean);

  const functions = await storage.getFunctions({ limit: 100_000 });
  const pagerankByFunctionId = await loadFunctionPageRank(storage, functions);
  const entries = buildEntries(functions, workspaceRoot, pagerankByFunctionId, focusPatterns, maxSymbolsPerFile);
  const selected = selectEntriesByTokenBudget(entries, maxTokens, style);

  const rendered = style === 'json' ? undefined : renderRepoMap(selected.entries, style);
  return {
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    style,
    maxTokens,
    consumedTokens: selected.tokens,
    entries: selected.entries,
    text: rendered,
  };
}

async function loadFunctionPageRank(
  storage: LibrarianStorage,
  functions: FunctionKnowledge[],
): Promise<Map<string, number>> {
  const metricStore = storage as GraphMetricsReader;
  if (!metricStore.getGraphMetrics || functions.length === 0) {
    return new Map();
  }
  const functionIds = functions.map((fn) => fn.id);
  const metrics = await metricStore.getGraphMetrics({ entityIds: functionIds, entityType: 'function' });
  const scores = new Map<string, number>();
  for (const metric of metrics) {
    scores.set(metric.entityId, metric.pagerank);
  }
  return scores;
}

function buildEntries(
  functions: FunctionKnowledge[],
  workspaceRoot: string,
  pagerankByFunctionId: Map<string, number>,
  focusPatterns: string[],
  maxSymbolsPerFile: number,
): RepoMapEntry[] {
  const byFile = new Map<string, FunctionKnowledge[]>();
  for (const fn of functions) {
    const list = byFile.get(fn.filePath) ?? [];
    list.push(fn);
    byFile.set(fn.filePath, list);
  }

  const entries = Array.from(byFile.entries()).map(([filePath, fileFns]) => {
    const symbols = fileFns
      .slice()
      .sort((left, right) => left.startLine - right.startLine || left.name.localeCompare(right.name))
      .slice(0, maxSymbolsPerFile)
      .map((fn) => ({
        name: fn.name,
        kind: 'function' as const,
        line: fn.startLine,
        signature: truncate(fn.signature || `${fn.name}()`, 80),
        isExported: isLikelyExported(fn),
      }));

    const relativePath = toRelativePath(filePath, workspaceRoot);
    const normalizedPath = normalizePath(relativePath);
    const baseScore = computeFilePageRank(fileFns, pagerankByFunctionId);
    const fallbackScore = fileFns.length;
    const score = (baseScore > 0 ? baseScore : fallbackScore) + computeFocusBoost(normalizedPath, focusPatterns);

    return {
      path: relativePath,
      pagerankScore: score,
      symbols,
    };
  });

  entries.sort((left, right) => {
    if (right.pagerankScore !== left.pagerankScore) {
      return right.pagerankScore - left.pagerankScore;
    }
    return left.path.localeCompare(right.path);
  });
  return entries;
}

function computeFilePageRank(
  functions: FunctionKnowledge[],
  pagerankByFunctionId: Map<string, number>,
): number {
  let total = 0;
  let count = 0;
  for (const fn of functions) {
    const score = pagerankByFunctionId.get(fn.id);
    if (typeof score !== 'number') continue;
    total += score;
    count += 1;
  }
  if (count === 0) return 0;
  return total / count;
}

function computeFocusBoost(normalizedPath: string, focusPatterns: string[]): number {
  if (focusPatterns.length === 0) return 0;
  for (const pattern of focusPatterns) {
    if (normalizedPath.includes(pattern)) {
      return 10_000;
    }
  }
  return 0;
}

function selectEntriesByTokenBudget(
  entries: RepoMapEntry[],
  maxTokens: number,
  style: RepoMapStyle,
): { entries: RepoMapEntry[]; tokens: number } {
  const selected: RepoMapEntry[] = [];
  let tokens = 0;
  for (const entry of entries) {
    const rendered = renderEntry(entry, style);
    const entryTokens = estimateTokens(rendered);
    if (selected.length > 0 && tokens + entryTokens > maxTokens) {
      break;
    }
    selected.push(entry);
    tokens += entryTokens;
  }
  return { entries: selected, tokens };
}

function renderRepoMap(entries: RepoMapEntry[], style: RepoMapStyle): string {
  return entries.map((entry) => renderEntry(entry, style)).join('\n\n');
}

function renderEntry(entry: RepoMapEntry, style: RepoMapStyle): string {
  if (style === 'detailed') {
    const lines = [`${entry.path} [score: ${entry.pagerankScore.toFixed(3)}]`];
    for (const symbol of entry.symbols) {
      lines.push(`  - ${symbol.signature} (line ${symbol.line})`);
    }
    return lines.join('\n');
  }

  // compact/json share compact line formatting for token estimation
  const lines = [`${entry.path} [score: ${entry.pagerankScore.toFixed(3)}]:`];
  for (const symbol of entry.symbols) {
    lines.push(`|${symbol.signature}`);
  }
  return lines.join('\n');
}

function estimateTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncate(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isLikelyExported(fn: FunctionKnowledge): boolean {
  const normalized = fn.signature.toLowerCase();
  return normalized.includes('export ') || normalized.startsWith('export');
}

function toRelativePath(filePath: string, workspaceRoot: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
  const relative = path.relative(workspaceRoot, absolute);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, '/');
  }
  return filePath.replace(/\\/g, '/');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}
