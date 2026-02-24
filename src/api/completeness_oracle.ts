import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { LibrarianStorage } from '../storage/types.js';
import type { FileKnowledge, FunctionKnowledge } from '../types.js';
import { getGitStatusChanges, isGitRepo } from '../utils/git.js';
import { safeJsonParse } from '../utils/safe_json.js';

export type CompletenessPattern =
  | 'crud_function'
  | 'api_endpoint'
  | 'service_module'
  | 'env_var_read'
  | 'config_value';

export type CompletenessArtifact =
  | 'test_file'
  | 'migration'
  | 'api_route'
  | 'openapi_entry'
  | 'auth_middleware'
  | 'rate_limiting'
  | 'error_handler'
  | 'env_example_entry'
  | 'config_docs_entry'
  | 'healthcheck_registration'
  | 'dependency_injection_wiring';

export interface CompletenessCounterevidence {
  artifact: CompletenessArtifact;
  pattern?: CompletenessPattern;
  filePattern?: string;
  reason: string;
  weight?: number;
}

export interface CompletenessTemplate {
  pattern: CompletenessPattern;
  artifact: CompletenessArtifact;
  support: number;
  presentCount: number;
  prevalence: number;
  mode: 'enforced' | 'informational';
  examples: string[];
}

export interface CompletenessGap {
  element: string;
  file: string;
  pattern: CompletenessPattern;
  artifact: CompletenessArtifact;
  confidence: number;
  support: number;
  prevalence: number;
  mode: 'enforced' | 'informational';
  examples: string[];
  message: string;
  counterevidenceApplied: string[];
}

export interface CompletenessOracleReport {
  tool: 'librarian_completeness_check';
  workspace: string;
  mode: 'auto' | 'changed' | 'full';
  supportThreshold: number;
  changedFiles: string[];
  checkedElements: number;
  templates: CompletenessTemplate[];
  gaps: CompletenessGap[];
  suggestions: CompletenessGap[];
  counterevidence: {
    configured: number;
    matched: number;
    suppressed: number;
  };
  falsePositiveRateEstimate: number;
  generatedAt: string;
}

export interface CompletenessOracleInput {
  workspaceRoot: string;
  storage: Pick<LibrarianStorage, 'getFunctions' | 'getFiles'>;
  changedFiles?: string[];
  mode?: 'auto' | 'changed' | 'full';
  supportThreshold?: number;
  counterevidence?: CompletenessCounterevidence[];
}

interface OracleElement {
  id: string;
  name: string;
  filePath: string;
  pattern: CompletenessPattern;
  artifacts: Set<CompletenessArtifact>;
}

interface FileIndex {
  allFiles: string[];
  byCategory: {
    tests: string[];
    migrations: string[];
    routes: string[];
    openApi: string[];
    docs: string[];
    health: string[];
    di: string[];
    envExamples: string[];
  };
  functionNamesByFile: Map<string, string[]>;
}

const DEFAULT_SUPPORT_THRESHOLD = 5;
const SUPPORT_NORMALIZATION_CAP = 12;

const EXPECTED_ARTIFACTS: Record<CompletenessPattern, CompletenessArtifact[]> = {
  crud_function: ['test_file', 'migration', 'api_route', 'openapi_entry'],
  api_endpoint: ['test_file', 'auth_middleware', 'rate_limiting', 'error_handler', 'openapi_entry'],
  service_module: ['test_file', 'healthcheck_registration', 'dependency_injection_wiring'],
  env_var_read: ['env_example_entry', 'config_docs_entry', 'test_file'],
  config_value: ['test_file', 'config_docs_entry'],
};

const ARTIFACT_LABELS: Record<CompletenessArtifact, string> = {
  test_file: 'test file',
  migration: 'migration',
  api_route: 'API route',
  openapi_entry: 'OpenAPI entry',
  auth_middleware: 'auth middleware',
  rate_limiting: 'rate limiting',
  error_handler: 'error handling',
  env_example_entry: '.env.example entry',
  config_docs_entry: 'configuration documentation',
  healthcheck_registration: 'health-check registration',
  dependency_injection_wiring: 'dependency-injection wiring',
};

const PATTERN_LABELS: Record<CompletenessPattern, string> = {
  crud_function: 'CRUD function',
  api_endpoint: 'API endpoint',
  service_module: 'service module',
  env_var_read: 'environment-variable reader',
  config_value: 'configuration value',
};

export async function detectChangedFilesFromGit(workspaceRoot: string): Promise<string[]> {
  if (!isGitRepo(workspaceRoot)) return [];
  const changes = await getGitStatusChanges(workspaceRoot);
  if (!changes) return [];
  const files = [...changes.added, ...changes.modified]
    .map((value) => normalizePath(value))
    .filter((value) => value.length > 0);
  return Array.from(new Set(files));
}

export async function loadCompletenessCounterevidence(workspaceRoot: string): Promise<CompletenessCounterevidence[]> {
  const configPath = path.join(workspaceRoot, '.librarian', 'completeness_exceptions.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = safeJsonParse<unknown>(raw);
    if (!parsed.ok) return [];
    const root = parsed.value;
    const rawItems = Array.isArray(root)
      ? root
      : (isRecord(root) && Array.isArray(root.exceptions) ? root.exceptions : []);
    return rawItems
      .map(normalizeCounterevidence)
      .filter((entry): entry is CompletenessCounterevidence => entry !== null);
  } catch {
    return [];
  }
}

export function isCompletionSignalClaim(claim: string, tags: string[]): boolean {
  const normalizedClaim = claim.toLowerCase();
  const completionTagSet = new Set(['done', 'completed', 'complete', 'implementation-complete', 'ready-for-review', 'final']);
  if (tags.some((tag) => completionTagSet.has(tag.toLowerCase()))) return true;
  return /\b(done|completed|implementation complete|ready for review|finished)\b/.test(normalizedClaim);
}

export async function runCompletenessOracle(input: CompletenessOracleInput): Promise<CompletenessOracleReport> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const supportThreshold = Math.max(1, Math.trunc(input.supportThreshold ?? DEFAULT_SUPPORT_THRESHOLD));
  const requestedMode = input.mode ?? 'auto';

  const changedFiles = input.changedFiles && input.changedFiles.length > 0
    ? normalizePathList(input.changedFiles)
    : (requestedMode === 'full' ? [] : await detectChangedFilesFromGit(workspaceRoot));

  const mode: 'auto' | 'changed' | 'full' = requestedMode === 'auto'
    ? (changedFiles.length > 0 ? 'changed' : 'full')
    : requestedMode;

  const [functions, files, configuredCounterevidence, discoveredCounterevidence] = await Promise.all([
    input.storage.getFunctions(),
    input.storage.getFiles(),
    Promise.resolve(input.counterevidence ?? []),
    loadCompletenessCounterevidence(workspaceRoot),
  ]);

  const counterevidence = [
    ...configuredCounterevidence,
    ...discoveredCounterevidence,
  ].map(normalizeCounterevidence).filter((entry): entry is CompletenessCounterevidence => entry !== null);

  const fileIndex = buildFileIndex(workspaceRoot, files, functions);
  const allElements = buildElements(workspaceRoot, functions, fileIndex);

  const targets = selectTargetElements(workspaceRoot, allElements, changedFiles, mode);

  const templates = buildTemplates(allElements, supportThreshold);
  const templateMap = groupTemplatesByPattern(templates);

  const gaps: CompletenessGap[] = [];
  const suggestions: CompletenessGap[] = [];
  let matchedCounterevidence = 0;
  let suppressedByCounterevidence = 0;

  for (const element of targets) {
    const patternTemplates = templateMap.get(element.pattern) ?? [];
    for (const template of patternTemplates) {
      if (element.artifacts.has(template.artifact)) continue;

      const supportWeight = clamp(template.support / SUPPORT_NORMALIZATION_CAP, 0, 1);
      const baseConfidence = clamp(template.prevalence * supportWeight, 0, 1);
      const applied = matchingCounterevidence(counterevidence, template.artifact, element.pattern, element.filePath);
      if (applied.length > 0) matchedCounterevidence += applied.length;
      const reduction = clamp(applied.reduce((sum, item) => sum + (item.weight ?? 0.5), 0), 0, 0.95);
      const confidence = roundTo(clamp(baseConfidence * (1 - reduction), 0, 1), 3);

      const gap: CompletenessGap = {
        element: `${element.name}@${element.filePath}`,
        file: element.filePath,
        pattern: element.pattern,
        artifact: template.artifact,
        confidence,
        support: template.support,
        prevalence: roundTo(template.prevalence, 3),
        mode: template.mode,
        examples: template.examples.slice(0, 3),
        message: `${template.support > 0 ? `${template.presentCount}/${template.support}` : '0/0'} ${PATTERN_LABELS[element.pattern]} examples include ${ARTIFACT_LABELS[template.artifact]}; expected for ${element.name}`,
        counterevidenceApplied: applied.map((item) => item.reason),
      };

      const suppressed = reduction >= 0.8 || confidence < 0.2;
      if (suppressed) {
        suppressedByCounterevidence += 1;
        continue;
      }

      if (template.mode === 'enforced') {
        gaps.push(gap);
      } else {
        suggestions.push(gap);
      }
    }
  }

  const falsePositiveRateEstimate = gaps.length === 0
    ? 0
    : roundTo(
      gaps.filter((gap) => gap.counterevidenceApplied.length > 0).length / gaps.length,
      3,
    );

  return {
    tool: 'librarian_completeness_check',
    workspace: workspaceRoot,
    mode,
    supportThreshold,
    changedFiles,
    checkedElements: targets.length,
    templates,
    gaps,
    suggestions,
    counterevidence: {
      configured: counterevidence.length,
      matched: matchedCounterevidence,
      suppressed: suppressedByCounterevidence,
    },
    falsePositiveRateEstimate,
    generatedAt: new Date().toISOString(),
  };
}

function buildElements(workspaceRoot: string, functions: FunctionKnowledge[], fileIndex: FileIndex): OracleElement[] {
  const elements: OracleElement[] = [];
  for (const fn of functions) {
    const relativePath = toWorkspaceRelative(workspaceRoot, fn.filePath);
    const pattern = classifyPattern(fn.name, relativePath);
    if (!pattern) continue;
    const artifacts = detectArtifacts(pattern, relativePath, fn.name, fileIndex);
    elements.push({
      id: fn.id,
      name: fn.name,
      filePath: relativePath,
      pattern,
      artifacts,
    });
  }
  return elements;
}

function selectTargetElements(
  workspaceRoot: string,
  allElements: OracleElement[],
  changedFiles: string[],
  mode: 'auto' | 'changed' | 'full',
): OracleElement[] {
  if (mode === 'full') return allElements;

  const changedSet = new Set(changedFiles.map((value) => normalizePath(value)));
  const selected = allElements.filter((element) => changedSet.has(element.filePath));
  if (selected.length > 0) return selected;

  const synthetic = changedFiles
    .map((filePath, index) => {
      const pattern = classifyPattern(path.basename(filePath), filePath) ?? deriveFilePattern(filePath);
      if (!pattern) return null;
      return {
        id: `synthetic-${index}`,
        name: path.basename(filePath, path.extname(filePath)),
        filePath: toWorkspaceRelative(workspaceRoot, filePath),
        pattern,
        artifacts: new Set<CompletenessArtifact>(),
      } satisfies OracleElement;
    })
    .filter((entry): entry is OracleElement => entry !== null);

  return synthetic;
}

function deriveFilePattern(filePath: string): CompletenessPattern | null {
  const lower = normalizePath(filePath).toLowerCase();
  if (lower.includes('/api/') || lower.includes('/routes/') || lower.includes('/controllers/')) {
    return 'api_endpoint';
  }
  if (lower.includes('/services/') || lower.endsWith('.service.ts') || lower.endsWith('_service.ts')) {
    return 'service_module';
  }
  if (lower.includes('.env') || lower.includes('/config/')) {
    return 'env_var_read';
  }
  return null;
}

function buildTemplates(elements: OracleElement[], supportThreshold: number): CompletenessTemplate[] {
  const templates: CompletenessTemplate[] = [];
  const byPattern = new Map<CompletenessPattern, OracleElement[]>();
  for (const element of elements) {
    const list = byPattern.get(element.pattern) ?? [];
    list.push(element);
    byPattern.set(element.pattern, list);
  }

  for (const [pattern, members] of byPattern.entries()) {
    const expected = EXPECTED_ARTIFACTS[pattern] ?? [];
    const support = members.length;
    for (const artifact of expected) {
      const present = members.filter((entry) => entry.artifacts.has(artifact));
      const examples = present.map((entry) => entry.filePath).slice(0, 3);
      const prevalence = support > 0 ? present.length / support : 0;
      templates.push({
        pattern,
        artifact,
        support,
        presentCount: present.length,
        prevalence,
        mode: support >= supportThreshold ? 'enforced' : 'informational',
        examples,
      });
    }
  }

  return templates.sort((a, b) => {
    if (a.pattern !== b.pattern) return a.pattern.localeCompare(b.pattern);
    if (b.support !== a.support) return b.support - a.support;
    return a.artifact.localeCompare(b.artifact);
  });
}

function groupTemplatesByPattern(templates: CompletenessTemplate[]): Map<CompletenessPattern, CompletenessTemplate[]> {
  const map = new Map<CompletenessPattern, CompletenessTemplate[]>();
  for (const template of templates) {
    const list = map.get(template.pattern) ?? [];
    list.push(template);
    map.set(template.pattern, list);
  }
  return map;
}

function classifyPattern(name: string, filePath: string): CompletenessPattern | null {
  const lowerName = name.toLowerCase();
  const lowerFile = normalizePath(filePath).toLowerCase();

  if (/^(create|update|delete|remove|upsert|insert|patch)/.test(lowerName)) {
    return 'crud_function';
  }

  if (lowerFile.includes('/api/') || lowerFile.includes('/routes/') || lowerFile.includes('/controllers/')) {
    return 'api_endpoint';
  }

  if (/(handler|controller)$/i.test(name) && (lowerName.startsWith('get') || lowerName.startsWith('post') || lowerName.startsWith('delete'))) {
    return 'api_endpoint';
  }

  if (lowerFile.includes('/services/') || lowerName.endsWith('service') || lowerName.endsWith('manager')) {
    return 'service_module';
  }

  if (lowerFile.includes('.env') || lowerFile.includes('/config/') || lowerName.includes('config')) {
    return 'env_var_read';
  }

  if (lowerName.includes('setting') || lowerName.includes('config')) {
    return 'config_value';
  }

  return null;
}

function detectArtifacts(
  pattern: CompletenessPattern,
  filePath: string,
  name: string,
  index: FileIndex,
): Set<CompletenessArtifact> {
  const artifacts = new Set<CompletenessArtifact>();
  const tokens = extractElementTokens(filePath, name);
  const lowerFilePath = filePath.toLowerCase();

  if (matchesTokenizedPath(index.byCategory.tests, tokens)) {
    artifacts.add('test_file');
  }
  if (matchesTokenizedPath(index.byCategory.migrations, tokens)) {
    artifacts.add('migration');
  }
  if (lowerFilePath.includes('/api/') || lowerFilePath.includes('/routes/') || lowerFilePath.includes('/controllers/') || matchesTokenizedPath(index.byCategory.routes, tokens)) {
    artifacts.add('api_route');
  }
  if (index.byCategory.openApi.length > 0) {
    artifacts.add('openapi_entry');
  }
  if (index.byCategory.envExamples.length > 0) {
    artifacts.add('env_example_entry');
  }
  if (index.byCategory.docs.some((doc) => /config|environment|env\.?example/i.test(doc))) {
    artifacts.add('config_docs_entry');
  }
  if (matchesTokenizedPath(index.byCategory.health, tokens)) {
    artifacts.add('healthcheck_registration');
  }
  if (matchesTokenizedPath(index.byCategory.di, tokens)) {
    artifacts.add('dependency_injection_wiring');
  }

  const functionNames = index.functionNamesByFile.get(filePath) ?? [];
  if (functionNames.some((value) => /auth|authorize|requireauth/i.test(value))) {
    artifacts.add('auth_middleware');
  }
  if (functionNames.some((value) => /rate|throttle|limit/i.test(value))) {
    artifacts.add('rate_limiting');
  }
  if (functionNames.some((value) => /error|exception|fail|guard/i.test(value))) {
    artifacts.add('error_handler');
  }

  if (pattern === 'env_var_read' && index.byCategory.envExamples.length > 0) {
    artifacts.add('env_example_entry');
  }

  return artifacts;
}

function buildFileIndex(workspaceRoot: string, files: FileKnowledge[], functions: FunctionKnowledge[]): FileIndex {
  const fromKnowledge = files
    .map((file) => normalizePath(file.relativePath || toWorkspaceRelative(workspaceRoot, file.path)))
    .filter((value) => value.length > 0);

  const fromFunctions = functions
    .map((fn) => toWorkspaceRelative(workspaceRoot, fn.filePath))
    .filter((value) => value.length > 0);

  const allFiles = Array.from(new Set([...fromKnowledge, ...fromFunctions]));
  const lowerFiles = allFiles.map((value) => value.toLowerCase());
  const functionNamesByFile = new Map<string, string[]>();
  for (const fn of functions) {
    const filePath = toWorkspaceRelative(workspaceRoot, fn.filePath);
    const names = functionNamesByFile.get(filePath) ?? [];
    names.push(fn.name);
    functionNamesByFile.set(filePath, names);
  }

  const byCategory = {
    tests: allFiles.filter((value, idx) => isTestPath(lowerFiles[idx]!)),
    migrations: allFiles.filter((value, idx) => /(^|\/)migrations?\//.test(lowerFiles[idx]!)),
    routes: allFiles.filter((value, idx) => /(^|\/)(api|routes?|controllers?)\//.test(lowerFiles[idx]!)),
    openApi: allFiles.filter((value, idx) => /(openapi|swagger|specs\/openapi)/.test(lowerFiles[idx]!) || /openapi\.(yaml|yml|json)$/.test(lowerFiles[idx]!)),
    docs: allFiles.filter((value, idx) => /(^|\/)docs?\//.test(lowerFiles[idx]!)),
    health: allFiles.filter((value, idx) => /(health|readiness|liveness|heartbeat)/.test(lowerFiles[idx]!)),
    di: allFiles.filter((value, idx) => /(container|inject|dependency|ioc|wire)/.test(lowerFiles[idx]!)),
    envExamples: allFiles.filter((value, idx) => /(^|\/)\.env(\.example|\.sample)?$/.test(lowerFiles[idx]!)),
  };

  return { allFiles, byCategory, functionNamesByFile };
}

function matchesTokenizedPath(paths: string[], tokens: string[]): boolean {
  return paths.some((entry) => matchesToken(entry, tokens));
}

function matchesToken(candidate: string, tokens: string[]): boolean {
  const lower = candidate.toLowerCase();
  return tokens.some((token) => token.length >= 3 && lower.includes(token));
}

function extractElementTokens(filePath: string, name: string): string[] {
  const base = path.basename(filePath, path.extname(filePath));
  const combined = `${base} ${name}`;
  const split = combined
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return Array.from(new Set(split));
}

function matchingCounterevidence(
  entries: CompletenessCounterevidence[],
  artifact: CompletenessArtifact,
  pattern: CompletenessPattern,
  filePath: string,
): CompletenessCounterevidence[] {
  return entries.filter((entry) => {
    if (entry.artifact !== artifact) return false;
    if (entry.pattern && entry.pattern !== pattern) return false;
    if (!entry.filePattern) return true;
    try {
      return new RegExp(entry.filePattern, 'i').test(filePath);
    } catch {
      return false;
    }
  });
}

function normalizeCounterevidence(value: unknown): CompletenessCounterevidence | null {
  if (!isRecord(value)) return null;
  const artifact = typeof value.artifact === 'string' ? value.artifact : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (!isCompletenessArtifact(artifact) || !reason) return null;

  const pattern = typeof value.pattern === 'string' && isCompletenessPattern(value.pattern)
    ? value.pattern
    : undefined;

  const filePattern = typeof value.filePattern === 'string' && value.filePattern.trim().length > 0
    ? value.filePattern.trim()
    : undefined;

  const weight = typeof value.weight === 'number' && Number.isFinite(value.weight)
    ? clamp(value.weight, 0, 1)
    : undefined;

  return {
    artifact,
    pattern,
    filePattern,
    reason,
    weight,
  };
}

function normalizePathList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizePath(value))
        .filter((value) => value.length > 0),
    ),
  );
}

function toWorkspaceRelative(workspaceRoot: string, inputPath: string): string {
  const normalized = normalizePath(inputPath);
  if (!normalized) return normalized;
  const root = normalizePath(path.resolve(workspaceRoot));
  const absolute = path.isAbsolute(normalized)
    ? normalizePath(path.resolve(normalized))
    : normalizePath(path.resolve(root, normalized));
  const relative = normalizePath(path.relative(root, absolute));
  return relative.startsWith('..') ? normalized : relative;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isTestPath(value: string): boolean {
  return /(^|\/)(test|tests|__tests__)\//.test(value)
    || /\.(test|spec)\.[a-z0-9]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCompletenessArtifact(value: string): value is CompletenessArtifact {
  return Object.hasOwn(ARTIFACT_LABELS, value);
}

function isCompletenessPattern(value: string): value is CompletenessPattern {
  return Object.hasOwn(EXPECTED_ARTIFACTS, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
