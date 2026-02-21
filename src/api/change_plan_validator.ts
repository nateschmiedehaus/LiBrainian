import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { LibrarianStorage } from '../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge } from '../types.js';

export type ChangePlanType =
  | 'rename'
  | 'signature_change'
  | 'delete'
  | 'move'
  | 'add_param'
  | 'general';

export interface ChangePlanValidationInput {
  workspaceRoot: string;
  description: string;
  planned_files: string[];
  change_type: ChangePlanType;
  symbols_affected?: string[];
}

export interface ChangePlanValidationPathIssue {
  path: string;
  line: number;
  reason: string;
}

export interface ChangePlanValidationBlastRadius {
  file_count: number;
  module_count: number;
  test_count: number;
}

export interface ChangePlanValidationResult {
  verdict: 'COMPLETE' | 'INCOMPLETE' | 'RISKY';
  missing_files: ChangePlanValidationPathIssue[];
  extra_files: Array<{ path: string; reason: string }>;
  blast_radius: ChangePlanValidationBlastRadius;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  suggestions: string[];
}

interface CandidateIssue {
  path: string;
  line: number;
  reason: string;
  kind: 'definition' | 'call_site' | 'importer' | 'string_reference' | 'signature_mismatch';
}

interface ResolvedTarget {
  symbol: string;
  function: FunctionKnowledge;
}

const MAX_UNFILTERED_STRING_SCAN_PATHS = 2000;
const MAX_FILTERED_STRING_SCAN_PATHS = 4000;

const TEXT_SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
]);

export async function computeChangePlanValidation(
  storage: LibrarianStorage,
  input: ChangePlanValidationInput
): Promise<ChangePlanValidationResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const plannedFiles = normalizePlannedFiles(input.planned_files, workspaceRoot);
  const symbols = normalizeSymbols(input);
  let modulesCache: ModuleKnowledge[] | null = null;
  const getModules = async (): Promise<ModuleKnowledge[]> => {
    if (modulesCache) return modulesCache;
    modulesCache = await storage.getModules({ limit: 20000 }).catch(() => []);
    return modulesCache;
  };
  const resolvedTargets = await resolveTargets(storage, symbols);

  const expectedIssues = new Map<string, CandidateIssue>();
  const fileCache = new Map<string, string | null>();

  for (const target of resolvedTargets) {
    addIssue(expectedIssues, {
      path: normalizeToWorkspaceAbsolute(target.function.filePath, workspaceRoot),
      line: clampLine(target.function.startLine),
      reason: `Symbol definition for ${target.symbol} is affected.`,
      kind: 'definition',
    });

    const edges = await storage.getGraphEdges({
      toIds: [target.function.id],
      edgeTypes: ['calls'],
      limit: 5000,
    }).catch(() => []);

    const expectedArity = computeExpectedArity(
      input.change_type,
      target.function,
      input.description,
      target.symbol
    );

    for (const edge of edges) {
      const callerPath = normalizeToWorkspaceAbsolute(edge.sourceFile, workspaceRoot);
      const callerLine = clampLine(edge.sourceLine);
      addIssue(expectedIssues, {
        path: callerPath,
        line: callerLine,
        reason: `Call site for ${target.symbol}.`,
        kind: 'call_site',
      });

      if (expectedArity !== null && callerLine > 0) {
        const actualArity = await inferCallArityAtSite({
          filePath: callerPath,
          line: callerLine,
          functionName: target.function.name,
          cache: fileCache,
        });
        if (actualArity !== null && actualArity !== expectedArity) {
          addIssue(expectedIssues, {
            path: callerPath,
            line: callerLine,
            reason: `Caller passes ${actualArity} argument(s), expected ${expectedArity} after ${input.change_type}.`,
            kind: 'signature_mismatch',
          });
        }
      }
    }

    if (input.change_type === 'delete' || input.change_type === 'rename' || input.change_type === 'move') {
      const modules = await getModules();
      for (const importer of findImporters(modules, target.function.filePath, workspaceRoot)) {
        addIssue(expectedIssues, {
          path: importer.path,
          line: importer.line,
          reason: `Module imports ${path.basename(target.function.filePath)} and likely needs update.`,
          kind: 'importer',
        });
      }
    }
  }

  if (shouldScanStringReferences(input.change_type)) {
    const symbolTerms = buildStringReferenceTerms(symbols, resolvedTargets);
    const stringReferenceRegex = buildStringReferenceRegex(symbolTerms);
    const modules = await getModules();
    const candidatePaths = gatherCandidatePaths({
      workspaceRoot,
      plannedFiles,
      modules,
      issues: expectedIssues,
      symbolTerms,
    });

    for (const filePath of candidatePaths) {
      if (!shouldScanTextFile(filePath)) continue;
      const content = await readFileCached(fileCache, filePath);
      if (!content) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const lineContent = lines[i] ?? '';
        if (!looksLikeStringLiteralContext(lineContent)) continue;
        if (stringReferenceRegex) {
          const match = lineContent.match(stringReferenceRegex);
          const matchedTerm = match?.[0];
          if (matchedTerm) {
            addIssue(expectedIssues, {
              path: filePath,
              line: i + 1,
              reason: `String reference "${matchedTerm}" may require update.`,
              kind: 'string_reference',
            });
          }
        }
      }
    }
  }

  const expectedPaths = new Set(Array.from(expectedIssues.values()).map((issue) => issue.path));
  const missingFiles = Array.from(expectedIssues.values())
    .filter((issue) => !plannedFiles.has(issue.path))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    .map((issue) => ({ path: issue.path, line: issue.line, reason: issue.reason }));

  const extraFiles = Array.from(plannedFiles)
    .filter((planned) => expectedPaths.size > 0 && !expectedPaths.has(planned))
    .sort((a, b) => a.localeCompare(b))
    .map((planned) => ({
      path: planned,
      reason: 'No call/import/string-reference evidence linked this file to the requested change.',
    }));

  const blastRadius = buildBlastRadius(expectedPaths);
  const riskLevel = computeRiskLevel({
    changeType: input.change_type,
    blastRadius,
    missingCount: missingFiles.length,
  });

  const verdict = missingFiles.length > 0
    ? 'INCOMPLETE'
    : (riskLevel === 'high' || riskLevel === 'critical')
      ? 'RISKY'
      : 'COMPLETE';

  const suggestions = buildSuggestions({
    changeType: input.change_type,
    missingFiles,
    extraFiles,
    blastRadius,
    issues: expectedIssues,
  });

  return {
    verdict,
    missing_files: missingFiles,
    extra_files: extraFiles,
    blast_radius: blastRadius,
    risk_level: riskLevel,
    suggestions,
  };
}

function normalizeSymbols(input: ChangePlanValidationInput): string[] {
  const explicit = (input.symbols_affected ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const discovered = new Set<string>();
  for (const match of input.description.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g)) {
    const symbol = match[0]?.trim();
    if (symbol) discovered.add(symbol);
  }
  for (const match of input.description.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const symbol = match[1]?.trim();
    if (symbol) discovered.add(symbol);
  }
  return Array.from(discovered);
}

async function resolveTargets(
  storage: LibrarianStorage,
  symbols: string[]
): Promise<ResolvedTarget[]> {
  const resolved: ResolvedTarget[] = [];
  const seen = new Set<string>();

  for (const symbol of symbols) {
    const normalized = stripCallSuffix(symbol);
    const candidates = new Set<string>();
    candidates.add(normalized);
    const tail = normalized.split('.').pop();
    if (tail && tail.length > 0) candidates.add(tail);

    const functions: FunctionKnowledge[] = [];
    for (const candidate of candidates) {
      const byName = await storage.getFunctionsByName(candidate).catch(() => []);
      for (const fn of byName) functions.push(fn);
    }

    const ranked = dedupeFunctions(functions)
      .sort((a, b) => scoreTargetMatch(b, normalized) - scoreTargetMatch(a, normalized))
      .slice(0, 64);

    const qualifierTokens = extractQualifierTokens(normalized);
    const qualifiedCandidates = qualifierTokens.length > 0
      ? ranked.filter((fn) => matchesQualifierTokens(fn, qualifierTokens))
      : ranked;
    const selected = (qualifiedCandidates.length > 0 ? qualifiedCandidates : ranked)
      .slice(0, qualifierTokens.length > 0 ? 12 : 8);

    for (const fn of selected) {
      const key = `${normalized}::${fn.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({ symbol: normalized, function: fn });
    }
  }

  return resolved;
}

function dedupeFunctions(functions: FunctionKnowledge[]): FunctionKnowledge[] {
  const map = new Map<string, FunctionKnowledge>();
  for (const fn of functions) {
    if (!map.has(fn.id)) map.set(fn.id, fn);
  }
  return Array.from(map.values());
}

function scoreTargetMatch(fn: FunctionKnowledge, symbol: string): number {
  const tail = symbol.split('.').pop() ?? symbol;
  let score = 0;
  if (fn.name === tail) score += 4;
  if (fn.signature.includes(tail)) score += 2;
  if (fn.signature.includes(symbol)) score += 2;
  if (fn.filePath.includes(tail)) score += 1;
  return score;
}

function findImporters(
  modules: ModuleKnowledge[],
  targetPath: string,
  workspaceRoot: string
): Array<{ path: string; line: number }> {
  const target = normalizeComparablePath(targetPath, workspaceRoot);
  const importers: Array<{ path: string; line: number }> = [];

  for (const moduleEntry of modules) {
    const modulePath = normalizeToWorkspaceAbsolute(moduleEntry.path, workspaceRoot);
    if (!modulePath) continue;
    for (const dependency of moduleEntry.dependencies ?? []) {
      const resolvedDependency = normalizeDependencyPath(dependency, modulePath, workspaceRoot);
      if (!resolvedDependency) continue;
      if (pathsLikelyEqual(target, normalizeComparablePath(resolvedDependency, workspaceRoot))) {
        importers.push({ path: modulePath, line: 1 });
        break;
      }
    }
  }

  return importers;
}

function normalizeDependencyPath(
  dependency: string,
  modulePath: string,
  workspaceRoot: string
): string | null {
  const trimmed = dependency.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  if (trimmed.startsWith('.')) return path.normalize(path.resolve(path.dirname(modulePath), trimmed));
  return path.normalize(path.resolve(workspaceRoot, trimmed));
}

function pathsLikelyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (value: string): string => value
    .replace(/\.(tsx?|jsx?|mjs|cjs)$/i, '')
    .replace(/\/index$/i, '');
  return strip(a) === strip(b);
}

function shouldScanStringReferences(changeType: ChangePlanType): boolean {
  return changeType === 'rename'
    || changeType === 'delete'
    || changeType === 'signature_change'
    || changeType === 'add_param';
}

function buildStringReferenceTerms(
  symbols: string[],
  resolvedTargets: ResolvedTarget[]
): string[] {
  const terms = new Set<string>();
  for (const symbol of symbols) {
    const normalized = stripCallSuffix(symbol);
    terms.add(normalized);
    const tail = normalized.split('.').pop();
    if (tail && tail.length >= 3) terms.add(tail);
  }
  for (const target of resolvedTargets) {
    if (target.function.name.length >= 3) terms.add(target.function.name);
  }
  return Array.from(terms);
}

function buildStringReferenceRegex(symbolTerms: string[]): RegExp | null {
  const escaped = symbolTerms
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .map((term) => escapeRegExp(term));
  if (escaped.length === 0) return null;
  return new RegExp(escaped.join('|'));
}

function gatherCandidatePaths(input: {
  workspaceRoot: string;
  plannedFiles: Set<string>;
  modules: ModuleKnowledge[];
  issues: Map<string, CandidateIssue>;
  symbolTerms: string[];
}): string[] {
  const prioritized = new Set<string>();
  for (const planned of input.plannedFiles) prioritized.add(planned);
  for (const issue of input.issues.values()) prioritized.add(issue.path);

  const symbolTokens = extractScanTokens(input.symbolTerms);
  const modulePaths: string[] = [];
  const scanAllModules = input.modules.length <= MAX_UNFILTERED_STRING_SCAN_PATHS;
  for (const moduleEntry of input.modules) {
    const absolutePath = normalizeToWorkspaceAbsolute(moduleEntry.path, input.workspaceRoot);
    if (scanAllModules || modulePathLooksRelevant(absolutePath, symbolTokens)) {
      modulePaths.push(absolutePath);
    }
  }

  const paths = new Set<string>();
  for (const entry of prioritized) paths.add(entry);
  for (const modulePath of modulePaths) {
    paths.add(modulePath);
    if (paths.size >= MAX_FILTERED_STRING_SCAN_PATHS) break;
  }

  return Array.from(paths)
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function extractScanTokens(symbolTerms: string[]): string[] {
  const tokens = new Set<string>();
  for (const term of symbolTerms) {
    const chunks = term.split(/[^A-Za-z0-9]+/).flatMap(splitCamelCase);
    for (const chunk of chunks) {
      const normalized = chunk.trim().toLowerCase();
      if (normalized.length >= 3) tokens.add(normalized);
    }
  }
  return Array.from(tokens);
}

function modulePathLooksRelevant(modulePath: string, symbolTokens: string[]): boolean {
  const lowered = modulePath.toLowerCase();
  if (lowered.includes('__tests__') || lowered.endsWith('.test.ts') || lowered.endsWith('.spec.ts')) {
    return true;
  }
  return symbolTokens.some((token) => lowered.includes(token));
}

function extractQualifierTokens(symbol: string): string[] {
  const parts = symbol.split('.');
  if (parts.length < 2) return [];
  const qualifier = parts.slice(0, -1).join('.');
  const tokens = qualifier
    .split(/[^A-Za-z0-9]+/)
    .flatMap(splitCamelCase)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);
  return Array.from(new Set(tokens));
}

function splitCamelCase(value: string): string[] {
  const withBreaks = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withBreaks.split(/\s+/).filter((entry) => entry.length > 0);
}

function matchesQualifierTokens(fn: FunctionKnowledge, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${fn.filePath} ${fn.signature}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function normalizePlannedFiles(plannedFiles: string[], workspaceRoot: string): Set<string> {
  const normalized = new Set<string>();
  for (const filePath of plannedFiles) {
    const trimmed = filePath.trim();
    if (!trimmed) continue;
    normalized.add(normalizeToWorkspaceAbsolute(trimmed, workspaceRoot));
  }
  return normalized;
}

function normalizeToWorkspaceAbsolute(filePath: string, workspaceRoot: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath);
  return path.normalize(path.resolve(workspaceRoot, filePath));
}

function normalizeComparablePath(filePath: string, workspaceRoot: string): string {
  return normalizeToWorkspaceAbsolute(filePath, workspaceRoot).replace(/\\/g, '/');
}

function addIssue(target: Map<string, CandidateIssue>, issue: CandidateIssue): void {
  const key = `${issue.path}::${issue.line}::${issue.kind}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, issue);
    return;
  }
  if (issue.reason.length > existing.reason.length) {
    target.set(key, issue);
  }
}

function clampLine(line: number | null | undefined): number {
  if (typeof line !== 'number' || !Number.isFinite(line)) return 1;
  return Math.max(1, Math.trunc(line));
}

function shouldScanTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_SCAN_EXTENSIONS.has(ext);
}

async function readFileCached(cache: Map<string, string | null>, filePath: string): Promise<string | null> {
  if (cache.has(filePath)) {
    return cache.get(filePath) ?? null;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    cache.set(filePath, content);
    return content;
  } catch {
    cache.set(filePath, null);
    return null;
  }
}

function looksLikeStringLiteralContext(line: string): boolean {
  return line.includes('"') || line.includes('\'') || line.includes('`');
}

function computeExpectedArity(
  changeType: ChangePlanType,
  fn: FunctionKnowledge,
  description: string,
  symbol: string
): number | null {
  if (changeType !== 'add_param' && changeType !== 'signature_change') {
    return null;
  }

  const currentArity = parseFunctionArity(fn.signature);
  if (changeType === 'add_param') {
    return currentArity === null ? null : currentArity + 1;
  }

  const explicit = parseArityFromDescription(description, symbol, fn.name);
  if (explicit !== null) return explicit;

  if (/\badd(?:ed|ing)?\s+(?:a\s+|an\s+)?(?:new\s+)?param/i.test(description)) {
    return currentArity === null ? null : currentArity + 1;
  }
  if (/\bremove(?:d|ing)?\s+(?:a\s+|an\s+)?param/i.test(description)) {
    return currentArity === null ? null : Math.max(0, currentArity - 1);
  }
  return null;
}

function parseArityFromDescription(
  description: string,
  symbol: string,
  fnName: string
): number | null {
  const patterns = [
    new RegExp(`to\\s+${escapeRegExp(fnName)}\\s*\\(([^)]*)\\)`, 'i'),
    new RegExp(`to\\s+${escapeRegExp(stripCallSuffix(symbol))}\\s*\\(([^)]*)\\)`, 'i'),
    new RegExp(`${escapeRegExp(fnName)}\\s*\\(([^)]*)\\)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    const params = match?.[1];
    if (typeof params === 'string') {
      return countTopLevelParams(params);
    }
  }
  return null;
}

function parseFunctionArity(signature: string): number | null {
  const start = signature.indexOf('(');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < signature.length; i += 1) {
    const ch = signature[i];
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        const params = signature.slice(start + 1, i);
        return countTopLevelParams(params);
      }
    }
  }
  return null;
}

function countTopLevelParams(params: string): number {
  const trimmed = params.trim();
  if (!trimmed) return 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let angleDepth = 0;
  let count = 1;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '(') roundDepth += 1;
    else if (ch === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (ch === '[') squareDepth += 1;
    else if (ch === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (ch === '{') curlyDepth += 1;
    else if (ch === '}') curlyDepth = Math.max(0, curlyDepth - 1);
    else if (ch === '<') angleDepth += 1;
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === ',' && roundDepth === 0 && squareDepth === 0 && curlyDepth === 0 && angleDepth === 0) {
      count += 1;
    }
  }

  return count;
}

async function inferCallArityAtSite(input: {
  filePath: string;
  line: number;
  functionName: string;
  cache: Map<string, string | null>;
}): Promise<number | null> {
  const content = await readFileCached(input.cache, input.filePath);
  if (!content) return null;
  const lines = content.split('\n');
  const start = Math.max(0, input.line - 3);
  const end = Math.min(lines.length - 1, input.line + 2);
  const pattern = new RegExp(`(?:\\.|\\b)${escapeRegExp(input.functionName)}\\s*\\(`);

  for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
    const lineContent = lines[lineIndex] ?? '';
    const match = lineContent.match(pattern);
    if (!match || typeof match.index !== 'number') continue;
    const openIndex = lineContent.indexOf('(', match.index);
    if (openIndex === -1) continue;
    const args = extractArgumentText(lineContent, openIndex);
    if (args === null) continue;
    return countTopLevelParams(args);
  }
  return null;
}

function extractArgumentText(line: string, openParenIndex: number): string | null {
  let depth = 0;
  let result = '';
  for (let i = openParenIndex; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '(') {
      depth += 1;
      if (depth === 1) continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return result;
    }
    if (depth >= 1) {
      result += ch;
    }
  }
  return null;
}

function stripCallSuffix(symbol: string): string {
  return symbol.replace(/\(\)$/, '').trim();
}

function buildBlastRadius(paths: Set<string>): ChangePlanValidationBlastRadius {
  const modules = new Set<string>();
  let testCount = 0;

  for (const filePath of paths) {
    if (isTestPath(filePath)) testCount += 1;
    modules.add(extractModuleName(filePath));
  }

  return {
    file_count: paths.size,
    module_count: modules.size,
    test_count: testCount,
  };
}

function isTestPath(filePath: string): boolean {
  return /(?:__tests__|\/tests\/|\.test\.|\.spec\.)/i.test(filePath);
}

function extractModuleName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const srcIndex = normalized.indexOf('/src/');
  if (srcIndex >= 0) {
    const rest = normalized.slice(srcIndex + 5);
    const first = rest.split('/')[0];
    return first || 'src';
  }
  const segments = normalized.split('/').filter((entry) => entry.length > 0);
  return segments.length >= 2 ? segments[segments.length - 2] : (segments[0] ?? 'unknown');
}

function computeRiskLevel(input: {
  changeType: ChangePlanType;
  blastRadius: ChangePlanValidationBlastRadius;
  missingCount: number;
}): 'low' | 'medium' | 'high' | 'critical' {
  let score = 0;
  switch (input.changeType) {
    case 'delete':
      score += 3;
      break;
    case 'rename':
    case 'signature_change':
    case 'add_param':
      score += 2;
      break;
    case 'move':
    case 'general':
      score += 1;
      break;
  }

  if (input.blastRadius.file_count >= 15) score += 3;
  else if (input.blastRadius.file_count >= 8) score += 2;
  else if (input.blastRadius.file_count >= 4) score += 1;

  if (input.blastRadius.test_count === 0 && input.blastRadius.file_count > 0) score += 1;
  if (input.missingCount > 0) score += 1;

  if (score >= 7) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function buildSuggestions(input: {
  changeType: ChangePlanType;
  missingFiles: ChangePlanValidationPathIssue[];
  extraFiles: Array<{ path: string; reason: string }>;
  blastRadius: ChangePlanValidationBlastRadius;
  issues: Map<string, CandidateIssue>;
}): string[] {
  const suggestions: string[] = [];
  if (input.missingFiles.length > 0) {
    suggestions.push(`Add ${input.missingFiles.length} missing file(s) to the plan before writing code.`);
  }

  const mismatchCount = Array.from(input.issues.values()).filter((issue) => issue.kind === 'signature_mismatch').length;
  if (mismatchCount > 0) {
    suggestions.push(`Update ${mismatchCount} caller site(s) with the new argument shape before implementation.`);
  }

  const importerCount = Array.from(input.issues.values()).filter((issue) => issue.kind === 'importer').length;
  if ((input.changeType === 'delete' || input.changeType === 'move') && importerCount > 0) {
    suggestions.push('Update importers first, then remove or move the symbol to avoid broken imports.');
  }

  const callSiteCount = Array.from(input.issues.values()).filter((issue) => issue.kind === 'call_site').length;
  if (input.changeType === 'rename' && callSiteCount >= 5) {
    suggestions.push('Use a deprecation alias during the rename rollout to reduce breakage risk.');
  }

  if (input.blastRadius.test_count === 0 && input.blastRadius.file_count > 0) {
    suggestions.push('Add at least one test file to the plan for safe verification.');
  }

  if (input.extraFiles.length > 0) {
    suggestions.push(`Review ${input.extraFiles.length} extra planned file(s) that are not backed by graph evidence.`);
  }

  if (suggestions.length === 0) {
    suggestions.push('Plan coverage looks complete; proceed with implementation and verify with targeted tests.');
  }

  return suggestions;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
