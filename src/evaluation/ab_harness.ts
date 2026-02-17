import { readFile, stat, readdir, mkdtemp, rm, cp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { safeJsonParse } from '../utils/safe_json.js';
import { initializeLibrarian } from '../orchestrator/unified_init.js';
import type { LibrarianResponse } from '../types.js';
import {
  classifyGateReasons,
  countByCategory,
  countBySeverity,
  type ClassifiedGateReason,
  type GateReasonCategory,
  type GateReasonSeverity,
} from './reason_taxonomy.js';

export type AbTaskComplexity = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
export type AbWorkerType = 'control' | 'treatment';
export type ContextLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type AbTaskMode = 'deterministic_edit' | 'agent_command';
export type AbTaskSelectionMode = 'sequential' | 'uncertainty' | 'adaptive';
export type AbEvidenceProfile = 'release' | 'quick' | 'reference' | 'custom';

export interface AbFileEdit {
  file: string;
  search: string;
  replace: string;
  occurrence?: number;
}

export interface AbVerification {
  baseline?: string[];
  requireBaselineFailure?: boolean;
  tests?: string[];
  typecheck?: string[];
  build?: string[];
}

export interface AbAgentCommandTemplate {
  default?: string;
  control?: string;
  treatment?: string;
}

export interface AbAgentExecution {
  commandTemplate: string | AbAgentCommandTemplate;
  promptTemplate?: string;
  workingDirectory?: string;
  requireTreatmentContext?: boolean;
}

export interface AbTaskDefinition {
  id: string;
  repo: string;
  complexity: AbTaskComplexity;
  description: string;
  contextLevel: ContextLevel;
  targetFiles: string[];
  edits?: AbFileEdit[];
  verification: AbVerification;
  mode?: AbTaskMode;
  agentExecution?: AbAgentExecution;
  setup?: string[];
  contextByLevel?: Partial<Record<'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5', string[]>>;
  tags?: string[];
  requireTargetFileModification?: boolean;
}

export interface AbCommandResult {
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface AbVerificationPhaseResult {
  passed: boolean;
  commands: AbCommandResult[];
}

export interface AbVerificationResult {
  setup?: AbVerificationPhaseResult;
  baseline?: AbVerificationPhaseResult;
  tests?: AbVerificationPhaseResult;
  typecheck?: AbVerificationPhaseResult;
  build?: AbVerificationPhaseResult;
}

export interface AbTaskRunResult {
  taskId: string;
  repo: string;
  complexity: AbTaskComplexity;
  workerType: AbWorkerType;
  mode?: AbTaskMode;
  contextLevel: ContextLevel;
  success: boolean;
  durationMs: number;
  failureReason?: string;
  contextFiles: string[];
  extraContextFiles: string[];
  modifiedFiles: string[];
  agentCommand?: AbCommandResult;
  artifacts?: {
    directory: string;
    files: Record<string, string>;
  };
  verification: AbVerificationResult;
  verificationPolicy: {
    requireBaselineFailure: boolean;
    baselineCommandsConfigured: number;
    verificationCommandsConfigured: number;
    verificationFallbackUsed: boolean;
  };
  artifactIntegrity?: {
    complete: boolean;
    requiredFiles: string[];
    missingFiles: string[];
  };
}

type InitializedLibrarianSession = Awaited<ReturnType<typeof initializeLibrarian>>;

export interface AbContextRequest {
  task: AbTaskDefinition;
  repoRoot: string;
  contextLevel: ContextLevel;
  contextFiles: string[];
}

export interface AbTaskRunOptions {
  workerType: AbWorkerType;
  contextLevelOverride?: ContextLevel;
  resolveExtraContext?: (request: AbContextRequest) => Promise<string[]>;
  commandTimeoutMs?: number;
  artifactRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export interface AbHarnessOptions {
  reposRoot: string;
  tasks: AbTaskDefinition[];
  workerTypes?: AbWorkerType[];
  maxTasks?: number;
  selectionMode?: AbTaskSelectionMode;
  uncertaintyScores?: Map<string, number>;
  contextLevelOverride?: ContextLevel;
  cloneMissing?: boolean;
  commandTimeoutMs?: number;
  artifactRoot?: string;
  resolveExtraContext?: (request: AbContextRequest) => Promise<string[]>;
  requireAgentCommandTasks?: boolean;
  minAgentCommandShare?: number;
  minT3SuccessRateLift?: number;
  requireT3Significance?: boolean;
  requireNoCriticalFailures?: boolean;
  minAgentVerifiedExecutionShare?: number;
  requireBaselineFailureForAgentTasks?: boolean;
  minArtifactIntegrityShare?: number;
  maxVerificationFallbackShare?: number;
  requireT3CeilingTimeReduction?: boolean;
  minT3CeilingTimeReduction?: number;
  evidenceProfile?: AbEvidenceProfile;
}

export interface AbGroupStats {
  n: number;
  successes: number;
  successRate: number;
  avgDurationMs: number;
  avgAgentCommandDurationMs?: number;
  byComplexity: Record<AbTaskComplexity, { n: number; successes: number; successRate: number; avgDurationMs: number }>;
}

export interface AbConfidenceInterval {
  lower: number;
  upper: number;
}

export interface AbLiftSignificance {
  method: 'two_proportion_z';
  alpha: number;
  pValue: number | null;
  statisticallySignificant: boolean | null;
  sampleSizeAdequate: boolean;
  minimumSamplePerGroup: number;
  inconclusiveReason?: 'insufficient_samples' | 'zero_standard_error';
}

export interface AbLiftSummary {
  successRateLift: number;
  absoluteSuccessRateDelta: number;
  controlSuccessRate: number;
  treatmentSuccessRate: number;
  timeReduction: number;
  agentCommandTimeReduction?: number;
  confidenceInterval95: AbConfidenceInterval;
  relativeLiftConfidenceInterval95: AbConfidenceInterval | null;
  significance: AbLiftSignificance;
}

export interface AbExperimentReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  options: {
    reposRoot: string;
    taskCount: number;
    selectedTaskIds: string[];
    selectionMode: AbTaskSelectionMode;
    evidenceProfile: AbEvidenceProfile;
    workerTypes: AbWorkerType[];
    contextLevelOverride?: ContextLevel;
  };
  results: AbTaskRunResult[];
  control: AbGroupStats | null;
  treatment: AbGroupStats | null;
  lift: AbLiftSummary | null;
  t3PlusLift: AbLiftSummary | null;
  diagnostics: {
    failureReasons: Record<string, number>;
    criticalFailureReasons: Record<string, number>;
    modeCounts: Record<AbTaskMode, number>;
    agentCommandShare: number;
    agentVerifiedExecutionShare: number;
    agentBaselineGuardShare: number;
    artifactIntegrityShare: number;
    verificationFallbackRuns: number;
    verificationFallbackShare: number;
  };
  gates: {
    passed: boolean;
    reasons: string[];
    classifiedReasons: ClassifiedGateReason[];
    severityCounts: Record<GateReasonSeverity, number>;
    categoryCounts: Record<GateReasonCategory, number>;
    thresholds: {
      requireAgentCommandTasks: boolean;
      minAgentCommandShare: number;
      minT3SuccessRateLift: number;
      requireT3Significance: boolean;
      requireNoCriticalFailures: boolean;
      minAgentVerifiedExecutionShare: number;
      requireBaselineFailureForAgentTasks: boolean;
      minArtifactIntegrityShare: number;
      maxVerificationFallbackShare: number;
      requireT3CeilingTimeReduction: boolean;
      minT3CeilingTimeReduction: number;
    };
  };
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SETUP_TIMEOUT_MS = 300_000;
const CONTEXT_SNIPPET_LIMIT = 2_000;
const AB_SIGNIFICANCE_ALPHA = 0.05;
const AB_MIN_SAMPLE_PER_GROUP = 5;
const AB_Z95 = 1.959963984540054;
const AB_SUCCESS_SATURATION_RATE = 0.999;
const AB_CEILING_MIN_TIME_REDUCTION = 0.01;
const AB_MAX_LIBRARIAN_CONTEXT_FILES = 2;
const AB_PROMPT_EXCERPT_MAX_FILES = 2;
const AB_PROMPT_EXCERPT_MAX_CHARS = 900;
const DEFAULT_AGENT_PROMPT_TEMPLATE = [
  'Task ID: {{TASK_ID}}',
  'Description:',
  '{{TASK_DESCRIPTION}}',
  '',
  'Worker: {{WORKER_TYPE}}',
  'Context Level: {{CONTEXT_LEVEL}}',
  '',
  'Target Files:',
  '{{TARGET_FILES}}',
  '',
  'Base Context Files:',
  '{{BASE_CONTEXT_FILES}}',
  '',
  'Librarian Context:',
  '{{LIBRARIAN_CONTEXT_FILES}}',
  '',
  'Context Excerpts:',
  '{{CONTEXT_EXCERPTS}}',
].join('\n');
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  '.ab-harness-artifacts',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '.pytest_cache',
]);

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizePaths(values: string[]): string[] {
  return values.map((value) => normalizePath(value));
}

function isLikelyTestPath(file: string): boolean {
  const normalized = normalizePath(file).toLowerCase();
  return (
    normalized.includes('/__tests__/')
    || normalized.includes('/tests/')
    || normalized.includes('/test/')
    || normalized.endsWith('.test.ts')
    || normalized.endsWith('.test.js')
    || normalized.endsWith('.spec.ts')
    || normalized.endsWith('.spec.js')
  );
}

function stemForPath(file: string): string {
  const base = path.posix.basename(normalizePath(file));
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

function shouldDropJavaScriptTwin(candidate: string, allCandidates: Set<string>, targetFiles: Set<string>): boolean {
  if (!candidate.endsWith('.js')) return false;
  const tsTwin = `${candidate.slice(0, -3)}.ts`;
  if (!allCandidates.has(tsTwin)) return false;
  return !targetFiles.has(candidate);
}

export function refineLibrarianContextFiles(
  candidates: string[],
  targetFiles: string[],
  maxFiles = AB_MAX_LIBRARIAN_CONTEXT_FILES
): string[] {
  if (candidates.length === 0) return [];

  const normalizedCandidates = mergeUniquePaths(candidates.filter((value) => value.trim().length > 0));
  const normalizedTargets = normalizePaths(targetFiles.filter((value) => value.trim().length > 0));
  const targetSet = new Set(normalizedTargets);
  const targetDirs = new Set(normalizedTargets.map((file) => normalizePath(path.posix.dirname(file))));
  const targetStems = new Set(normalizedTargets.map((file) => stemForPath(file)));
  const targetExts = new Set(normalizedTargets.map((file) => path.posix.extname(file).toLowerCase()));
  const allowTestPaths = normalizedTargets.some((file) => isLikelyTestPath(file));
  const candidateSet = new Set(normalizedCandidates);

  const ranked = normalizedCandidates
    .filter((candidate) => allowTestPaths || !isLikelyTestPath(candidate))
    .filter((candidate) => !shouldDropJavaScriptTwin(candidate, candidateSet, targetSet))
    .map((candidate, index) => {
      const candidateDir = normalizePath(path.posix.dirname(candidate));
      const candidateStem = stemForPath(candidate);
      const candidateExt = path.posix.extname(candidate).toLowerCase();
      let score = 0;
      if (targetSet.has(candidate)) score += 100;
      if (targetDirs.has(candidateDir)) score += 20;
      if (targetStems.has(candidateStem)) score += 10;
      if (candidateExt && targetExts.has(candidateExt)) score += 4;
      if (candidate.startsWith('src/')) score += 1;
      if (isLikelyTestPath(candidate)) score -= 5;
      return { candidate, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index || left.candidate.localeCompare(right.candidate))
    .slice(0, Math.max(1, maxFiles))
    .map((entry) => entry.candidate);

  return ranked;
}

function normalizeRepoRelativePath(input: string, repoRoot: string): string {
  const normalizedInput = normalizePath(input).replace(/^\.\/+/, '');
  if (path.isAbsolute(input)) {
    const relative = normalizePath(path.relative(repoRoot, input));
    if (!relative.startsWith('../') && relative !== '..') {
      return relative;
    }
  }
  return normalizedInput;
}

function resolveInnerAgentTimeoutMs(commandTimeoutMs: number): number {
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 1) {
    return 1;
  }
  const buffer = Math.min(5_000, Math.max(250, Math.floor(commandTimeoutMs * 0.15)));
  return Math.max(1, Math.floor(commandTimeoutMs - buffer));
}

async function resolveRepoPathCaseAware(repoRoot: string, requestedPath: string): Promise<string> {
  const normalized = normalizeRepoRelativePath(requestedPath, repoRoot);
  if (!normalized || normalized === '.') return normalized;

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const resolvedSegments: string[] = [];
  let cursor = repoRoot;

  for (const segment of segments) {
    let directoryEntries: Array<{ name: string }> = [];
    try {
      directoryEntries = await readdir(cursor, { withFileTypes: true });
    } catch {
      return normalized;
    }

    const exactMatch = directoryEntries.find((entry) => entry.name === segment);
    const caseInsensitiveMatch = directoryEntries.find((entry) => entry.name.toLowerCase() === segment.toLowerCase());
    const selected = exactMatch ?? caseInsensitiveMatch;
    if (!selected) {
      return normalized;
    }

    resolvedSegments.push(selected.name);
    cursor = path.join(cursor, selected.name);
  }
  const resolvedPath = normalizePath(resolvedSegments.join('/'));
  if (await fileExists(path.join(repoRoot, resolvedPath))) {
    return resolvedPath;
  }
  return normalized;
}

async function resolveRepoPathsCaseAware(repoRoot: string, requestedPaths: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const requestedPath of requestedPaths) {
    resolved.push(await resolveRepoPathCaseAware(repoRoot, requestedPath));
  }
  return mergeUniquePaths(resolved);
}

async function resolveTaskEditsCaseAware(repoRoot: string, edits: AbFileEdit[]): Promise<AbFileEdit[]> {
  const resolved: AbFileEdit[] = [];
  for (const edit of edits) {
    resolved.push({
      ...edit,
      file: await resolveRepoPathCaseAware(repoRoot, edit.file),
    });
  }
  return resolved;
}

async function resolveMissingTargetContext(
  repoRoot: string,
  targetFiles: string[],
  contextFiles: string[],
  extraContextFiles: string[]
): Promise<string[]> {
  const available = new Set(normalizePaths([...contextFiles, ...extraContextFiles]));
  const missingTargets = targetFiles.filter((target) => !available.has(normalizePath(target)));
  const recovered: string[] = [];
  for (const missingTarget of missingTargets) {
    const absoluteTarget = path.join(repoRoot, missingTarget);
    if (await fileExists(absoluteTarget)) {
      recovered.push(missingTarget);
    }
  }
  return mergeUniquePaths(recovered);
}

async function listTopLevelFiles(repoRoot: string): Promise<string[]> {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => normalizePath(entry.name));
}

function contextKey(level: ContextLevel): 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' {
  return `L${level}` as 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
}

async function buildContextFiles(task: AbTaskDefinition, repoRoot: string, level: ContextLevel): Promise<string[]> {
  const override = task.contextByLevel?.[contextKey(level)];
  if (override && override.length > 0) {
    return normalizePaths(override);
  }

  if (level === 0) return [];

  if (level === 1) {
    return normalizePaths(await listTopLevelFiles(repoRoot));
  }

  if (level === 5) {
    const base = await listTopLevelFiles(repoRoot);
    return normalizePaths([...base, ...task.targetFiles]);
  }

  const base = await listTopLevelFiles(repoRoot);
  return normalizePaths(base);
}

function extractFilesFromResponse(response: LibrarianResponse | null | undefined, repoRoot: string): string[] {
  if (!response) return [];
  const files = new Set<string>();
  for (const pack of response.packs ?? []) {
    for (const file of pack.relatedFiles ?? []) {
      const normalized = normalizePath(file);
      files.add(normalized);
    }
    for (const snippet of pack.codeSnippets ?? []) {
      const normalized = normalizePath(snippet.filePath);
      files.add(normalized);
    }
  }
  const repoPrefix = normalizePath(repoRoot);
  const normalized = Array.from(files).map((file) => {
    if (path.isAbsolute(file) && normalizePath(file).startsWith(repoPrefix)) {
      return normalizePath(path.relative(repoRoot, file));
    }
    return normalizePath(file);
  });
  return normalized;
}

async function queryLibrarianContext(task: AbTaskDefinition, repoRoot: string): Promise<string[]> {
  const session = await initializeLibrarian(repoRoot, {
    silent: true,
    skipWatcher: true,
    skipHealing: true,
    skipLlm: true,
    reuseExistingSession: false,
    allowDegradedEmbeddings: false,
  });
  try {
    const response = await session.librarian.queryOptional({
      intent: task.description,
      depth: 'L1',
      llmRequirement: 'disabled',
      embeddingRequirement: 'required',
      includeEngines: false,
      deterministic: true,
    });
    return refineLibrarianContextFiles(extractFilesFromResponse(response, repoRoot), task.targetFiles);
  } finally {
    await session.shutdown();
  }
}

async function queryLibrarianContextWithSession(
  task: AbTaskDefinition,
  repoRoot: string,
  session: InitializedLibrarianSession
): Promise<string[]> {
  const response = await session.librarian.queryOptional({
    intent: task.description,
    depth: 'L1',
    llmRequirement: 'disabled',
    embeddingRequirement: 'required',
    includeEngines: false,
    deterministic: true,
  });
  return refineLibrarianContextFiles(extractFilesFromResponse(response, repoRoot), task.targetFiles);
}

function includesAllTargets(contextFiles: string[], targetFiles: string[]): boolean {
  const contextSet = new Set(normalizePaths(contextFiles));
  return targetFiles.every((file) => contextSet.has(normalizePath(file)));
}

interface AbContextArtifactFile {
  file: string;
  source: 'base' | 'librarian';
  exists: boolean;
  excerpt?: string;
  error?: string;
}

interface AbContextArtifact {
  baseContextFiles: string[];
  extraContextFiles: string[];
  combinedContextFiles: string[];
  targetFiles: string[];
  files: AbContextArtifactFile[];
}

interface AbArtifactState {
  directory: string;
  files: Record<string, string>;
}

function resolveTaskMode(task: AbTaskDefinition): AbTaskMode {
  if (task.mode) return task.mode;
  if (task.agentExecution) return 'agent_command';
  return 'deterministic_edit';
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized.slice(0, 80) : 'run';
}

function mergeUniquePaths(values: string[]): string[] {
  const merged = new Set<string>();
  for (const value of values) {
    merged.add(normalizePath(value));
  }
  return Array.from(merged);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...<truncated>`;
}

function formatContextList(values: string[]): string {
  if (values.length === 0) return '(none)';
  return values.map((value) => `- ${value}`).join('\n');
}

function formatContextExcerpts(files: AbContextArtifactFile[]): string {
  if (files.length === 0) return '(none)';
  return files.map((entry) => {
    if (!entry.exists) {
      return `### ${entry.file}\n[missing] ${entry.error ?? 'file_not_found'}`;
    }
    return `### ${entry.file}\n${entry.excerpt ?? ''}`;
  }).join('\n\n');
}

function formatPromptContextExcerpts(
  files: AbContextArtifactFile[],
  targetFiles: string[],
  workerType: AbWorkerType
): string {
  if (files.length === 0) return '(none)';
  const normalizedTargets = new Set(targetFiles.map((file) => normalizePath(file)));
  const ranked = files.map((entry, index) => {
    const normalizedFile = normalizePath(entry.file);
    const lower = normalizedFile.toLowerCase();
    let score = 0;
    if (normalizedTargets.has(normalizedFile)) score += 300;
    if (entry.source === 'librarian') score += workerType === 'treatment' ? 140 : 20;
    if (entry.source === 'base') score += workerType === 'control' ? 20 : 0;
    if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.sql')) {
      score += 20;
    }
    if (lower === 'package.json' || lower.endsWith('/package.json')) score -= 40;
    if (lower.endsWith('/readme.md') || lower === 'readme.md') score -= 20;
    if (!entry.exists) score -= 120;
    return { entry, index, score };
  });

  const prioritized = ranked
    .sort((left, right) => right.score - left.score || left.index - right.index || left.entry.file.localeCompare(right.entry.file));

  const withContent = prioritized.filter((candidate) => candidate.entry.exists);
  const maxFiles = workerType === 'treatment' ? 1 : AB_PROMPT_EXCERPT_MAX_FILES;
  const selected = (withContent.length > 0 ? withContent : prioritized).slice(0, maxFiles);
  if (selected.length === 0) return '(none)';

  return selected.map(({ entry }) => {
    if (!entry.exists) {
      return `### ${entry.file}\n[missing] ${entry.error ?? 'file_not_found'}`;
    }
    const excerpt = truncateText(entry.excerpt ?? '', AB_PROMPT_EXCERPT_MAX_CHARS);
    return `### ${entry.file}\n${excerpt}`;
  }).join('\n\n');
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

function expandEnvTemplateVariables(template: string): { value: string; missing: string[] } {
  const missing = new Set<string>();
  const value = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    const raw = process.env[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
    missing.add(key);
    return '';
  });
  return { value, missing: Array.from(missing) };
}

function resolveAgentCommandTemplate(agentExecution: AbAgentExecution | undefined, workerType: AbWorkerType): string | null {
  if (!agentExecution) return null;
  const template = agentExecution.commandTemplate;
  if (typeof template === 'string') {
    const normalized = template.trim();
    return normalized.length > 0 ? normalized : null;
  }
  const workerTemplate = template[workerType]?.trim();
  if (workerTemplate) return workerTemplate;
  const defaultTemplate = template.default?.trim();
  return defaultTemplate && defaultTemplate.length > 0 ? defaultTemplate : null;
}

function classifyLibrarianError(error: unknown): 'librarian_provider_unavailable' | 'librarian_context_unavailable' {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  if (
    normalized.includes('empty_storage')
    || normalized.includes('no functions or modules indexed')
    || normalized.includes('cannot query librarian')
  ) {
    return 'librarian_context_unavailable';
  }
  if (
    normalized.includes('provider_unavailable')
    || normalized.includes('embedding provider')
    || normalized.includes('llm provider')
    || normalized.includes('api key')
  ) {
    return 'librarian_provider_unavailable';
  }
  return 'librarian_context_unavailable';
}

function commandMissing(result: AbCommandResult): boolean {
  if (result.exitCode === 127) return true;
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes('not found') || combined.includes('is not recognized');
}

function commandProviderUnavailable(result: AbCommandResult): boolean {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    combined.includes('provider_unavailable')
    || combined.includes('usage limit')
    || combined.includes('rate limit')
    || combined.includes('quota')
    || combined.includes('insufficient_quota')
    || combined.includes('billing')
    || combined.includes('api key')
    || combined.includes('credits')
    || combined.includes('service unavailable')
    || combined.includes('model overloaded')
  );
}

function commandTimedOut(result: AbCommandResult): boolean {
  if (result.timedOut) return true;
  if (result.exitCode !== 124) return false;
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes('agent_timeout_ms_exceeded');
}

function classifyCommandFailure(prefix: string, result: AbCommandResult): string {
  if (commandTimedOut(result)) return `${prefix}_timeout`;
  if (commandMissing(result)) return `${prefix}_missing`;
  if (commandProviderUnavailable(result)) return `${prefix}_provider_unavailable`;
  return `${prefix}_failed`;
}

function collectCommands(result: AbVerificationResult | AbVerificationPhaseResult | undefined): AbCommandResult[] {
  if (!result) return [];
  if ('commands' in result) return result.commands;
  return [
    ...(result.tests?.commands ?? []),
    ...(result.typecheck?.commands ?? []),
    ...(result.build?.commands ?? []),
  ];
}

function deriveVerificationFailureReason(verification: AbVerificationResult): string {
  const commands = collectCommands(verification);
  if (commands.some((command) => commandTimedOut(command))) return 'verification_timeout';
  if (commands.some((command) => commandMissing(command))) return 'verification_command_missing';
  return 'verification_failed';
}

function hasTargetFileModification(modifiedFiles: string[], targetFiles: string[]): boolean {
  if (targetFiles.length === 0) return modifiedFiles.length > 0;
  const targetSet = new Set(targetFiles.map((value) => normalizePath(value)));
  return modifiedFiles.some((file) => targetSet.has(normalizePath(file)));
}

async function createArtifactState(root: string, taskId: string, workerType: AbWorkerType): Promise<AbArtifactState> {
  const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const directory = path.join(root, sanitizeSegment(taskId), `${workerType}-${runSuffix}`);
  await mkdir(directory, { recursive: true });
  return { directory, files: {} };
}

async function writeArtifactJson(state: AbArtifactState, key: string, value: unknown): Promise<string> {
  const filePath = path.join(state.directory, `${key}.json`);
  await writeFileSafe(filePath, JSON.stringify(value, null, 2));
  state.files[key] = filePath;
  return filePath;
}

async function writeArtifactText(state: AbArtifactState, key: string, value: string): Promise<string> {
  const filePath = path.join(state.directory, `${key}.txt`);
  await writeFileSafe(filePath, value);
  state.files[key] = filePath;
  return filePath;
}

async function buildContextArtifact(
  repoRoot: string,
  contextFiles: string[],
  extraContextFiles: string[],
  targetFiles: string[]
): Promise<AbContextArtifact> {
  const base = normalizePaths(contextFiles);
  const extra = normalizePaths(extraContextFiles);
  const extraSet = new Set(extra);
  const combined = mergeUniquePaths([...base, ...extra]);
  const files: AbContextArtifactFile[] = [];

  for (const relativePath of combined) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      files.push({
        file: relativePath,
        source: extraSet.has(relativePath) ? 'librarian' : 'base',
        exists: false,
        error: 'file_not_found',
      });
      continue;
    }
    try {
      const contents = await readFile(absolutePath, 'utf8');
      files.push({
        file: relativePath,
        source: extraSet.has(relativePath) ? 'librarian' : 'base',
        exists: true,
        excerpt: truncateText(contents, CONTEXT_SNIPPET_LIMIT),
      });
    } catch (error) {
      files.push({
        file: relativePath,
        source: extraSet.has(relativePath) ? 'librarian' : 'base',
        exists: false,
        error: error instanceof Error ? error.message : 'read_failed',
      });
    }
  }

  return {
    baseContextFiles: base,
    extraContextFiles: extra,
    combinedContextFiles: combined,
    targetFiles: normalizePaths(targetFiles),
    files,
  };
}

async function snapshotFiles(repoRoot: string, files: string[]): Promise<Map<string, string | null>> {
  const snapshot = new Map<string, string | null>();
  for (const file of normalizePaths(files)) {
    const absolutePath = path.join(repoRoot, file);
    if (!(await fileExists(absolutePath))) {
      snapshot.set(file, null);
      continue;
    }
    try {
      snapshot.set(file, await readFile(absolutePath, 'utf8'));
    } catch {
      snapshot.set(file, null);
    }
  }
  return snapshot;
}

function detectModifiedFiles(before: Map<string, string | null>, after: Map<string, string | null>): string[] {
  const modified: string[] = [];
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    if ((before.get(key) ?? null) !== (after.get(key) ?? null)) {
      modified.push(key);
    }
  }
  return modified;
}

function replaceOccurrence(content: string, search: string, replace: string, occurrence?: number): string | null {
  if (!search) return null;
  if (!occurrence || occurrence <= 1) {
    const idx = content.indexOf(search);
    if (idx === -1) return null;
    return content.slice(0, idx) + replace + content.slice(idx + search.length);
  }
  let idx = -1;
  let cursor = 0;
  for (let count = 0; count < occurrence; count += 1) {
    idx = content.indexOf(search, cursor);
    if (idx === -1) return null;
    cursor = idx + search.length;
  }
  return content.slice(0, idx) + replace + content.slice(idx + search.length);
}

async function applyEdits(repoRoot: string, edits: AbFileEdit[]): Promise<string[]> {
  const modified = new Set<string>();
  for (const edit of edits) {
    const filePath = path.join(repoRoot, edit.file);
    const original = await readFile(filePath, 'utf8');
    const updated = replaceOccurrence(original, edit.search, edit.replace, edit.occurrence);
    if (updated === null) {
      throw new Error(`edit_not_found:${edit.file}`);
    }
    if (updated !== original) {
      await cp(filePath, filePath + '.ab.bak', { force: true });
      await writeFileSafe(filePath, updated);
      modified.add(normalizePath(edit.file));
    }
  }
  return Array.from(modified);
}

async function writeFileSafe(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, 'utf8');
}

async function runCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<AbCommandResult> {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const supportsProcessGroups = process.platform !== 'win32';

  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: supportsProcessGroups,
  });

  const killChildTree = (): void => {
    if (child.killed) return;
    if (supportsProcessGroups && typeof child.pid === 'number') {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return;
      } catch {
        // Fall through to direct child kill when process group kill is unavailable.
      }
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    killChildTree();
  }, timeoutMs);

  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code));
  });

  clearTimeout(timeout);
  return {
    command,
    exitCode,
    durationMs: Date.now() - start,
    stdout,
    stderr,
    timedOut,
  };
}

async function runCommandPhase(commands: string[] | undefined, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<AbVerificationPhaseResult | undefined> {
  if (!commands || commands.length === 0) return undefined;
  const results: AbCommandResult[] = [];
  for (const command of commands) {
    const result = await runCommand(command, cwd, env, timeoutMs);
    results.push(result);
    if (result.exitCode !== 0 || result.timedOut) {
      return { passed: false, commands: results };
    }
  }
  return { passed: true, commands: results };
}

async function runVerification(verification: AbVerification, repoRoot: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<AbVerificationResult> {
  const tests = await runCommandPhase(verification.tests, repoRoot, env, timeoutMs);
  if (tests && !tests.passed) {
    return { tests };
  }
  const typecheck = await runCommandPhase(verification.typecheck, repoRoot, env, timeoutMs);
  if (typecheck && !typecheck.passed) {
    return { tests, typecheck };
  }
  const build = await runCommandPhase(verification.build, repoRoot, env, timeoutMs);
  return { tests, typecheck, build };
}

export async function runAbTask(task: AbTaskDefinition, repoRoot: string, options: AbTaskRunOptions): Promise<AbTaskRunResult> {
  const start = Date.now();
  const mode = resolveTaskMode(task);
  const contextLevel = options.contextLevelOverride ?? task.contextLevel;
  const targetFiles = await resolveRepoPathsCaseAware(repoRoot, task.targetFiles ?? []);
  const resolvedEdits = await resolveTaskEditsCaseAware(repoRoot, task.edits ?? []);
  const contextFiles = await resolveRepoPathsCaseAware(
    repoRoot,
    await buildContextFiles(task, repoRoot, contextLevel)
  );
  const extraContextFiles: string[] = [];
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setupTimeoutMs = Math.max(commandTimeoutMs, DEFAULT_SETUP_TIMEOUT_MS);
  const runEnv: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}) };
  const artifactRoot = options.artifactRoot ?? path.join(repoRoot, '.ab-harness-artifacts');
  const requireTargetFileModification = task.requireTargetFileModification
    ?? (mode === 'agent_command' && targetFiles.length > 0);
  const verificationPolicy = {
    requireBaselineFailure: Boolean(task.verification.requireBaselineFailure),
    baselineCommandsConfigured: task.verification.baseline?.length ?? 0,
    verificationCommandsConfigured:
      (task.verification.tests?.length ?? 0)
      + (task.verification.typecheck?.length ?? 0)
      + (task.verification.build?.length ?? 0),
    verificationFallbackUsed: false,
  };
  const fallbackOptIn = (task as AbTaskDefinition & { allowVerificationCommandFallback?: boolean })
    .allowVerificationCommandFallback === true;

  let artifactState: AbArtifactState;
  try {
    artifactState = await createArtifactState(artifactRoot, task.id, options.workerType);
  } catch {
    return {
      taskId: task.id,
      repo: task.repo,
      complexity: task.complexity,
      workerType: options.workerType,
      mode,
      contextLevel,
      success: false,
      durationMs: Date.now() - start,
      failureReason: 'artifact_write_failed',
      contextFiles,
      extraContextFiles,
      modifiedFiles: [],
      verification: {},
      verificationPolicy,
    };
  }

  const finalize = async (payload: {
    success: boolean;
    failureReason?: string;
    modifiedFiles: string[];
    verification: AbVerificationResult;
    agentCommand?: AbCommandResult;
  }): Promise<AbTaskRunResult> => {
    const requiredArtifactKeys = ['task', 'context', 'result'];
    const verificationExecuted = Boolean(
      payload.verification.tests
      || payload.verification.typecheck
      || payload.verification.build
    );
    if (payload.success || verificationExecuted) {
      requiredArtifactKeys.push('verification');
    }
    if (payload.verification.setup) requiredArtifactKeys.push('setup');
    if (payload.verification.baseline) requiredArtifactKeys.push('baseline');
    if (mode === 'agent_command') {
      requiredArtifactKeys.push('prompt', 'agent_command', 'agent_command_result');
    }

    const result: AbTaskRunResult = {
      taskId: task.id,
      repo: task.repo,
      complexity: task.complexity,
      workerType: options.workerType,
      mode,
      contextLevel,
      success: payload.success,
      durationMs: Date.now() - start,
      failureReason: payload.failureReason,
      contextFiles,
      extraContextFiles,
      modifiedFiles: payload.modifiedFiles,
      agentCommand: payload.agentCommand,
      verification: payload.verification,
      verificationPolicy,
    };
    await writeArtifactJson(artifactState, 'result', result);
    const missingFiles: string[] = [];
    for (const key of requiredArtifactKeys) {
      const filePath = artifactState.files[key];
      if (!filePath || !(await fileExists(filePath))) {
        missingFiles.push(key);
      }
    }
    const artifactIntegrity = {
      complete: missingFiles.length === 0,
      requiredFiles: requiredArtifactKeys,
      missingFiles,
    };
    if (!artifactIntegrity.complete && result.success) {
      result.success = false;
      result.failureReason = 'artifact_incomplete';
    }
    result.artifactIntegrity = artifactIntegrity;
    await writeArtifactJson(artifactState, 'result', result);
    result.artifacts = {
      directory: artifactState.directory,
      files: { ...artifactState.files },
    };
    return result;
  };

  if (fallbackOptIn) {
    await writeArtifactJson(artifactState, 'verification_fallback_disallowed', {
      reason: 'verification_fallback_disabled',
      policy: 'NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE',
    });
    return finalize({
      success: false,
      failureReason: 'verification_fallback_disallowed',
      modifiedFiles: [],
      verification: {},
    });
  }

  await writeArtifactJson(artifactState, 'task', {
    mode,
    workerType: options.workerType,
    contextLevel,
    definition: task,
  });

  const setupResult = task.setup
    ? await runCommandPhase(task.setup, repoRoot, runEnv, setupTimeoutMs)
    : undefined;
  let baselineResult: AbVerificationPhaseResult | undefined;
  if (setupResult) {
    await writeArtifactJson(artifactState, 'setup', setupResult);
  }
  if (setupResult && !setupResult.passed) {
    const failedCommand = setupResult.commands.find((command) => command.timedOut || command.exitCode !== 0);
    const failureReason = failedCommand
      ? classifyCommandFailure('setup_command', failedCommand)
      : 'setup_failed';
    return finalize({
      success: false,
      failureReason,
      modifiedFiles: [],
      verification: { setup: setupResult },
    });
  }

  if (task.verification.requireBaselineFailure && (!task.verification.baseline || task.verification.baseline.length === 0)) {
    return finalize({
      success: false,
      failureReason: 'baseline_required_but_missing',
      modifiedFiles: [],
      verification: { setup: setupResult },
    });
  }

  baselineResult = task.verification.baseline
    ? await runCommandPhase(task.verification.baseline, repoRoot, runEnv, commandTimeoutMs)
    : undefined;
  if (baselineResult) {
    await writeArtifactJson(artifactState, 'baseline', baselineResult);
  }
  if (task.verification.requireBaselineFailure && baselineResult) {
    if (baselineResult.passed) {
      return finalize({
        success: false,
        failureReason: 'baseline_expected_failure_missing',
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
    const failedBaselineCommand = baselineResult.commands.find((command) => command.timedOut || command.exitCode !== 0);
    if (failedBaselineCommand && (failedBaselineCommand.timedOut || commandMissing(failedBaselineCommand))) {
      return finalize({
        success: false,
        failureReason: classifyCommandFailure('baseline_command', failedBaselineCommand),
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
  }

  if (options.workerType === 'treatment') {
    const resolver = options.resolveExtraContext ?? (async (request: AbContextRequest) => queryLibrarianContext(request.task, request.repoRoot));
    try {
      const extra = await resolver({ task, repoRoot, contextLevel, contextFiles });
      const resolvedExtra = await resolveRepoPathsCaseAware(repoRoot, normalizePaths(extra ?? []));
      extraContextFiles.push(...resolvedExtra);
      const recoveredTargets = await resolveMissingTargetContext(repoRoot, targetFiles, contextFiles, extraContextFiles);
      extraContextFiles.push(...recoveredTargets);
      const refinedExtra = refineLibrarianContextFiles(extraContextFiles, targetFiles);
      extraContextFiles.splice(0, extraContextFiles.length, ...refinedExtra);
    } catch (error) {
      await writeArtifactJson(artifactState, 'librarian_error', {
        reason: classifyLibrarianError(error),
        message: error instanceof Error ? error.message : String(error),
      });
      return finalize({
        success: false,
        failureReason: classifyLibrarianError(error),
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
  }

  if (
    mode === 'agent_command'
    && options.workerType === 'treatment'
    && (task.agentExecution?.requireTreatmentContext ?? true)
    && extraContextFiles.length === 0
  ) {
    return finalize({
      success: false,
      failureReason: 'librarian_context_unavailable',
      modifiedFiles: [],
      verification: { setup: setupResult, baseline: baselineResult },
    });
  }

  const contextArtifact = await buildContextArtifact(repoRoot, contextFiles, extraContextFiles, targetFiles);
  const contextArtifactPath = await writeArtifactJson(artifactState, 'context', contextArtifact);

  const combinedContext = contextArtifact.combinedContextFiles;

  if (options.workerType === 'treatment' && !includesAllTargets(combinedContext, targetFiles)) {
    return finalize({
      success: false,
      failureReason: 'missing_context_after_librarian',
      modifiedFiles: [],
      verification: { setup: setupResult, baseline: baselineResult },
    });
  }

  let modifiedFiles: string[] = [];
  let agentCommandResult: AbCommandResult | undefined;

  if (mode === 'agent_command') {
    const commandTemplate = resolveAgentCommandTemplate(task.agentExecution, options.workerType);
    if (!commandTemplate) {
      return finalize({
        success: false,
        failureReason: 'agent_command_missing',
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
    const expandedCommandTemplate = expandEnvTemplateVariables(commandTemplate);
    if (expandedCommandTemplate.missing.length > 0) {
      await writeArtifactJson(artifactState, 'agent_command_env', {
        missing: expandedCommandTemplate.missing,
        template: commandTemplate,
      });
      return finalize({
        success: false,
        failureReason: `agent_command_env_missing:${expandedCommandTemplate.missing.join(',')}`,
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }

    const promptTemplate = task.agentExecution?.promptTemplate ?? DEFAULT_AGENT_PROMPT_TEMPLATE;
    const prompt = renderTemplate(promptTemplate, {
      TASK_ID: task.id,
      TASK_DESCRIPTION: task.description,
      WORKER_TYPE: options.workerType,
      CONTEXT_LEVEL: String(contextLevel),
      TARGET_FILES: formatContextList(targetFiles),
      BASE_CONTEXT_FILES: formatContextList(contextArtifact.baseContextFiles),
      LIBRARIAN_CONTEXT_FILES: formatContextList(contextArtifact.extraContextFiles),
      CONTEXT_EXCERPTS: formatPromptContextExcerpts(contextArtifact.files, targetFiles, options.workerType),
    });
    const promptPath = await writeArtifactText(artifactState, 'prompt', prompt);

    const commandTaskPath = artifactState.files.task ?? '';
    const commandValues = {
      TASK_ID: task.id,
      WORKER_TYPE: options.workerType,
      WORKSPACE_ROOT: repoRoot,
      ARTIFACT_DIR: artifactState.directory,
      PROMPT_FILE: promptPath,
      CONTEXT_FILE: contextArtifactPath,
      TASK_FILE: commandTaskPath,
    };
    const command = renderTemplate(expandedCommandTemplate.value, commandValues).trim();
    if (command.length === 0) {
      return finalize({
        success: false,
        failureReason: 'agent_command_missing',
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
    await writeArtifactText(artifactState, 'agent_command', command);

    const beforeSnapshot = await snapshotFiles(repoRoot, targetFiles);
    const agentEnv: NodeJS.ProcessEnv = {
      ...runEnv,
      AB_HARNESS_TASK_ID: task.id,
      AB_HARNESS_WORKER_TYPE: options.workerType,
      AB_HARNESS_WORKSPACE_ROOT: repoRoot,
      AB_HARNESS_ARTIFACT_DIR: artifactState.directory,
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_CONTEXT_FILE: contextArtifactPath,
      AB_HARNESS_TASK_FILE: commandTaskPath,
      AB_HARNESS_AGENT_TIMEOUT_MS: String(resolveInnerAgentTimeoutMs(commandTimeoutMs)),
      AB_HARNESS_ACCEPTANCE_COMMANDS: (task.verification.tests ?? []).join('\n'),
    };
    const commandCwd = task.agentExecution?.workingDirectory
      ? path.join(repoRoot, task.agentExecution.workingDirectory)
      : repoRoot;
    agentCommandResult = await runCommand(command, commandCwd, agentEnv, commandTimeoutMs);
    await writeArtifactJson(artifactState, 'agent_command_result', agentCommandResult);
    if (agentCommandResult.exitCode !== 0 || agentCommandResult.timedOut) {
      return finalize({
        success: false,
        failureReason: classifyCommandFailure('agent_command', agentCommandResult),
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
        agentCommand: agentCommandResult,
      });
    }

    const afterSnapshot = await snapshotFiles(repoRoot, targetFiles);
    modifiedFiles = detectModifiedFiles(beforeSnapshot, afterSnapshot);
  } else {
    try {
      modifiedFiles = await applyEdits(repoRoot, resolvedEdits);
    } catch (error) {
      return finalize({
        success: false,
        failureReason: error instanceof Error ? error.message : 'edit_failed',
        modifiedFiles: [],
        verification: { setup: setupResult, baseline: baselineResult },
      });
    }
  }

  if (requireTargetFileModification && !hasTargetFileModification(modifiedFiles, targetFiles)) {
    return finalize({
      success: false,
      failureReason: 'no_target_file_modified',
      modifiedFiles,
      verification: { setup: setupResult, baseline: baselineResult },
      agentCommand: agentCommandResult,
    });
  }

  const verification = await runVerification(
    task.verification,
    repoRoot,
    runEnv,
    commandTimeoutMs
  );
  await writeArtifactJson(artifactState, 'verification', verification);

  let success = Boolean(verification.tests?.passed ?? true)
    && Boolean(verification.typecheck?.passed ?? true)
    && Boolean(verification.build?.passed ?? true);
  let failureReason = success ? undefined : deriveVerificationFailureReason(verification);

  return finalize({
    success,
    failureReason,
    modifiedFiles,
    verification: { ...verification, setup: setupResult, baseline: baselineResult },
    agentCommand: agentCommandResult,
  });
}

function aggregateByComplexity(results: AbTaskRunResult[], workerType: AbWorkerType): AbGroupStats {
  const filtered = results.filter((result) => result.workerType === workerType);
  const totals: Record<AbTaskComplexity, { n: number; successes: number; duration: number }> = {
    T1: { n: 0, successes: 0, duration: 0 },
    T2: { n: 0, successes: 0, duration: 0 },
    T3: { n: 0, successes: 0, duration: 0 },
    T4: { n: 0, successes: 0, duration: 0 },
    T5: { n: 0, successes: 0, duration: 0 },
  };
  for (const result of filtered) {
    const bucket = totals[result.complexity];
    bucket.n += 1;
    if (result.success) bucket.successes += 1;
    bucket.duration += result.durationMs;
  }

  const byComplexity = Object.fromEntries(Object.entries(totals).map(([key, value]) => {
    const avgDurationMs = value.n > 0 ? value.duration / value.n : 0;
    return [key, { n: value.n, successes: value.successes, successRate: value.n > 0 ? value.successes / value.n : 0, avgDurationMs }];
  })) as AbGroupStats['byComplexity'];

  const totalN = filtered.length;
  const totalSuccesses = filtered.filter((result) => result.success).length;
  const totalDuration = filtered.reduce((sum, result) => sum + result.durationMs, 0);
  const agentCommandDurations = filtered
    .map((result) => result.agentCommand?.durationMs)
    .filter((value): value is number => Number.isFinite(value));
  const avgAgentCommandDurationMs = agentCommandDurations.length > 0
    ? agentCommandDurations.reduce((sum, duration) => sum + duration, 0) / agentCommandDurations.length
    : undefined;

  return {
    n: totalN,
    successes: totalSuccesses,
    successRate: totalN > 0 ? totalSuccesses / totalN : 0,
    avgDurationMs: totalN > 0 ? totalDuration / totalN : 0,
    avgAgentCommandDurationMs,
    byComplexity,
  };
}

function erfApprox(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const polynomial = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t;
  const y = 1 - polynomial * Math.exp(-(absolute * absolute));
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erfApprox(value / Math.sqrt(2)));
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeAbsoluteDeltaConfidenceInterval(
  control: AbGroupStats,
  treatment: AbGroupStats
): AbConfidenceInterval {
  const controlRate = control.successRate;
  const treatmentRate = treatment.successRate;
  const diff = treatmentRate - controlRate;
  const stderr = Math.sqrt(
    ((controlRate * (1 - controlRate)) / control.n)
    + ((treatmentRate * (1 - treatmentRate)) / treatment.n)
  );

  if (!Number.isFinite(stderr) || stderr <= 0) {
    return {
      lower: diff,
      upper: diff,
    };
  }

  return {
    lower: diff - AB_Z95 * stderr,
    upper: diff + AB_Z95 * stderr,
  };
}

function computeRelativeLiftConfidenceInterval(
  absoluteCi: AbConfidenceInterval,
  controlRate: number
): AbConfidenceInterval | null {
  if (controlRate <= 0) return null;
  return {
    lower: absoluteCi.lower / controlRate,
    upper: absoluteCi.upper / controlRate,
  };
}

function computeLiftSignificance(
  control: AbGroupStats,
  treatment: AbGroupStats
): AbLiftSignificance {
  const sampleSizeAdequate = control.n >= AB_MIN_SAMPLE_PER_GROUP && treatment.n >= AB_MIN_SAMPLE_PER_GROUP;
  if (!sampleSizeAdequate) {
    return {
      method: 'two_proportion_z',
      alpha: AB_SIGNIFICANCE_ALPHA,
      pValue: null,
      statisticallySignificant: null,
      sampleSizeAdequate,
      minimumSamplePerGroup: AB_MIN_SAMPLE_PER_GROUP,
      inconclusiveReason: 'insufficient_samples',
    };
  }

  const pooledRate = (control.successes + treatment.successes) / (control.n + treatment.n);
  const pooledStdErr = Math.sqrt(pooledRate * (1 - pooledRate) * ((1 / control.n) + (1 / treatment.n)));
  if (!Number.isFinite(pooledStdErr) || pooledStdErr <= 0) {
    return {
      method: 'two_proportion_z',
      alpha: AB_SIGNIFICANCE_ALPHA,
      pValue: null,
      statisticallySignificant: null,
      sampleSizeAdequate,
      minimumSamplePerGroup: AB_MIN_SAMPLE_PER_GROUP,
      inconclusiveReason: 'zero_standard_error',
    };
  }

  const zScore = (treatment.successRate - control.successRate) / pooledStdErr;
  const pValue = clampProbability(2 * (1 - normalCdf(Math.abs(zScore))));
  return {
    method: 'two_proportion_z',
    alpha: AB_SIGNIFICANCE_ALPHA,
    pValue,
    statisticallySignificant: pValue <= AB_SIGNIFICANCE_ALPHA,
    sampleSizeAdequate,
    minimumSamplePerGroup: AB_MIN_SAMPLE_PER_GROUP,
  };
}

export function computeAbLiftSummary(control: AbGroupStats | null, treatment: AbGroupStats | null): AbLiftSummary | null {
  if (!control || !treatment || control.n === 0 || treatment.n === 0) return null;
  const absoluteSuccessRateDelta = treatment.successRate - control.successRate;
  const successRateLift = control.successRate === 0
    ? absoluteSuccessRateDelta
    : absoluteSuccessRateDelta / control.successRate;
  const controlDurationReliable = control.avgDurationMs >= 50;
  const timeReduction = !controlDurationReliable || control.avgDurationMs === 0
    ? 0
    : (control.avgDurationMs - treatment.avgDurationMs) / control.avgDurationMs;
  const controlAgentDuration = control.avgAgentCommandDurationMs;
  const treatmentAgentDuration = treatment.avgAgentCommandDurationMs;
  const controlAgentDurationReliable = Number.isFinite(controlAgentDuration)
    && Number.isFinite(treatmentAgentDuration)
    && (controlAgentDuration as number) >= 50;
  const agentCommandTimeReduction = !controlAgentDurationReliable || (controlAgentDuration as number) === 0
    ? undefined
    : ((controlAgentDuration as number) - (treatmentAgentDuration as number)) / (controlAgentDuration as number);
  const confidenceInterval95 = computeAbsoluteDeltaConfidenceInterval(control, treatment);
  const relativeLiftConfidenceInterval95 = computeRelativeLiftConfidenceInterval(confidenceInterval95, control.successRate);
  const significance = computeLiftSignificance(control, treatment);

  return {
    successRateLift,
    absoluteSuccessRateDelta,
    controlSuccessRate: control.successRate,
    treatmentSuccessRate: treatment.successRate,
    timeReduction,
    agentCommandTimeReduction,
    confidenceInterval95,
    relativeLiftConfidenceInterval95,
    significance,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

interface AbTaskHistoryStats {
  runs: number;
  failures: number;
  timeoutFailures: number;
  contextFailures: number;
  successes: number;
}

function complexityRank(complexity: AbTaskComplexity): number {
  switch (complexity) {
    case 'T5': return 5;
    case 'T4': return 4;
    case 'T3': return 3;
    case 'T2': return 2;
    case 'T1':
    default:
      return 1;
  }
}

function scoreAbTaskUncertainty(stats: AbTaskHistoryStats): number {
  if (stats.runs <= 0) return 1;
  const failureRate = stats.failures / stats.runs;
  const timeoutRate = stats.timeoutFailures / stats.runs;
  const contextRate = stats.contextFailures / stats.runs;
  const disagreement = stats.successes > 0 && stats.failures > 0 ? 1 : 0;
  const recencyWeight = Math.max(0, 1 - Math.min(stats.runs, 10) / 10) * 0.1;
  return clamp01(
    (failureRate * 0.55)
    + (timeoutRate * 0.2)
    + (contextRate * 0.1)
    + (disagreement * 0.05)
    + recencyWeight
  );
}

export function buildAbTaskUncertaintyScoresFromHistory(history: unknown): Map<string, number> {
  if (!history || typeof history !== 'object') return new Map<string, number>();
  const results = (history as { results?: unknown }).results;
  if (!Array.isArray(results)) return new Map<string, number>();
  const statsByTask = new Map<string, AbTaskHistoryStats>();

  for (const value of results) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as {
      taskId?: unknown;
      success?: unknown;
      failureReason?: unknown;
    };
    const taskId = typeof entry.taskId === 'string' ? entry.taskId : '';
    if (!taskId) continue;
    const stats = statsByTask.get(taskId) ?? {
      runs: 0,
      failures: 0,
      timeoutFailures: 0,
      contextFailures: 0,
      successes: 0,
    };
    const success = entry.success === true;
    const failureReason = typeof entry.failureReason === 'string' ? entry.failureReason.toLowerCase() : '';
    stats.runs += 1;
    if (success) {
      stats.successes += 1;
    } else {
      stats.failures += 1;
      if (failureReason.includes('timeout')) stats.timeoutFailures += 1;
      if (failureReason.includes('provider_unavailable') || failureReason.includes('context_unavailable')) {
        stats.contextFailures += 1;
      }
    }
    statsByTask.set(taskId, stats);
  }

  const scores = new Map<string, number>();
  for (const [taskId, stats] of statsByTask.entries()) {
    scores.set(taskId, scoreAbTaskUncertainty(stats));
  }
  return scores;
}

export function selectAbTasksForExecution(
  tasks: AbTaskDefinition[],
  options: {
    maxTasks?: number;
    selectionMode?: AbTaskSelectionMode;
    uncertaintyScores?: Map<string, number>;
  }
): AbTaskDefinition[] {
  const maxTasks = options.maxTasks;
  if (!maxTasks || maxTasks <= 0 || tasks.length <= maxTasks) return tasks;
  const selectionMode = options.selectionMode ?? 'sequential';
  const uncertaintyScores = options.uncertaintyScores;
  if (selectionMode === 'sequential' || !uncertaintyScores || uncertaintyScores.size === 0) {
    return tasks.slice(0, maxTasks);
  }

  const scored = tasks.map((task) => ({
    task,
    score: uncertaintyScores.get(task.id) ?? 1,
  }));
  const byUncertaintyDesc = [...scored].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const complexityDelta = complexityRank(right.task.complexity) - complexityRank(left.task.complexity);
    if (complexityDelta !== 0) return complexityDelta;
    return left.task.id.localeCompare(right.task.id);
  });

  if (selectionMode === 'uncertainty') {
    return byUncertaintyDesc.slice(0, maxTasks).map((entry) => entry.task);
  }

  const byUncertaintyAsc = [...scored].sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    return left.task.id.localeCompare(right.task.id);
  });
  const uncertainBudget = maxTasks <= 2
    ? maxTasks
    : Math.max(1, Math.floor(maxTasks * 0.75));
  const stableBudget = Math.max(0, maxTasks - uncertainBudget);
  const stablePool = byUncertaintyAsc.filter((entry) => entry.score <= 0.15);
  const stableCandidates = stablePool.length > 0 ? stablePool : byUncertaintyAsc;
  const selected: AbTaskDefinition[] = [];
  const selectedIds = new Set<string>();

  for (const entry of byUncertaintyDesc) {
    if (selected.length >= uncertainBudget) break;
    selected.push(entry.task);
    selectedIds.add(entry.task.id);
  }

  for (const entry of stableCandidates) {
    if (selected.length >= uncertainBudget + stableBudget) break;
    if (selectedIds.has(entry.task.id)) continue;
    selected.push(entry.task);
    selectedIds.add(entry.task.id);
  }

  if (selected.length < maxTasks) {
    for (const entry of byUncertaintyDesc) {
      if (selected.length >= maxTasks) break;
      if (selectedIds.has(entry.task.id)) continue;
      selected.push(entry.task);
      selectedIds.add(entry.task.id);
    }
  }

  return selected;
}

function countFailureReasons(results: AbTaskRunResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (!result.failureReason) continue;
    counts[result.failureReason] = (counts[result.failureReason] ?? 0) + 1;
  }
  return counts;
}

function countModes(results: AbTaskRunResult[]): Record<AbTaskMode, number> {
  const counts: Record<AbTaskMode, number> = {
    deterministic_edit: 0,
    agent_command: 0,
  };
  for (const result of results) {
    const mode: AbTaskMode = result.mode ?? 'deterministic_edit';
    counts[mode] += 1;
  }
  return counts;
}

function computeAgentRunDiagnostics(results: AbTaskRunResult[]): {
  totalAgentRuns: number;
  agentVerifiedExecutionShare: number;
  agentBaselineGuardShare: number;
} {
  const agentRuns = results.filter((result) => (result.mode ?? 'deterministic_edit') === 'agent_command');
  const totalAgentRuns = agentRuns.length;
  if (totalAgentRuns === 0) {
    return {
      totalAgentRuns: 0,
      agentVerifiedExecutionShare: 0,
      agentBaselineGuardShare: 0,
    };
  }

  const verifiedAgentRuns = agentRuns.filter((result) => {
    if (result.verificationPolicy.verificationCommandsConfigured <= 0) {
      return false;
    }
    const testsRan = (result.verification.tests?.commands.length ?? 0) > 0;
    const typecheckRan = (result.verification.typecheck?.commands.length ?? 0) > 0;
    const buildRan = (result.verification.build?.commands.length ?? 0) > 0;
    return testsRan || typecheckRan || buildRan;
  }).length;
  const guardedAgentRuns = agentRuns.filter((result) =>
    result.verificationPolicy.requireBaselineFailure
    && result.verificationPolicy.baselineCommandsConfigured > 0
  ).length;

  return {
    totalAgentRuns,
    agentVerifiedExecutionShare: verifiedAgentRuns / totalAgentRuns,
    agentBaselineGuardShare: guardedAgentRuns / totalAgentRuns,
  };
}

function computeArtifactIntegrityShare(results: AbTaskRunResult[]): number {
  if (results.length === 0) return 1;
  const complete = results.filter((result) => result.artifactIntegrity?.complete !== false).length;
  return complete / results.length;
}

function computeVerificationFallbackUsage(results: AbTaskRunResult[]): {
  verificationFallbackRuns: number;
  verificationFallbackShare: number;
} {
  if (results.length === 0) {
    return {
      verificationFallbackRuns: 0,
      verificationFallbackShare: 0,
    };
  }
  const verificationFallbackRuns = results.filter((result) => result.verificationPolicy.verificationFallbackUsed).length;
  return {
    verificationFallbackRuns,
    verificationFallbackShare: verificationFallbackRuns / results.length,
  };
}

function computeExperimentGates(input: {
  modeCounts: Record<AbTaskMode, number>;
  failureReasons: Record<string, number>;
  t3PlusLift: AbLiftSummary | null;
  agentVerifiedExecutionShare: number;
  agentBaselineGuardShare: number;
  artifactIntegrityShare: number;
  verificationFallbackShare: number;
  thresholds: {
    requireAgentCommandTasks: boolean;
    minAgentCommandShare: number;
    minT3SuccessRateLift: number;
    requireT3Significance: boolean;
    requireNoCriticalFailures: boolean;
    minAgentVerifiedExecutionShare: number;
    requireBaselineFailureForAgentTasks: boolean;
    minArtifactIntegrityShare: number;
    maxVerificationFallbackShare: number;
    requireT3CeilingTimeReduction: boolean;
    minT3CeilingTimeReduction: number;
  };
}): {
  passed: boolean;
  reasons: string[];
  classifiedReasons: ClassifiedGateReason[];
  severityCounts: Record<GateReasonSeverity, number>;
  categoryCounts: Record<GateReasonCategory, number>;
} {
  const {
    modeCounts,
    failureReasons,
    t3PlusLift,
    agentVerifiedExecutionShare,
    agentBaselineGuardShare,
    artifactIntegrityShare,
    verificationFallbackShare,
    thresholds,
  } = input;
  const reasons: string[] = [];
  const totalModes = modeCounts.agent_command + modeCounts.deterministic_edit;
  const agentCommandShare = totalModes > 0 ? modeCounts.agent_command / totalModes : 0;

  if (thresholds.requireAgentCommandTasks && modeCounts.agent_command === 0) {
    reasons.push('agent_command_tasks_missing');
  }
  if (agentCommandShare < thresholds.minAgentCommandShare) {
    reasons.push(`agent_command_share_below_threshold:${agentCommandShare.toFixed(3)}<${thresholds.minAgentCommandShare.toFixed(3)}`);
  }
  if (agentVerifiedExecutionShare < thresholds.minAgentVerifiedExecutionShare) {
    reasons.push(
      `agent_verified_execution_share_below_threshold:${agentVerifiedExecutionShare.toFixed(3)}<${thresholds.minAgentVerifiedExecutionShare.toFixed(3)}`
    );
  }
  if (thresholds.requireBaselineFailureForAgentTasks && agentBaselineGuardShare < 1) {
    reasons.push(`agent_baseline_guard_share_below_threshold:${agentBaselineGuardShare.toFixed(3)}<1.000`);
  }
  if (artifactIntegrityShare < thresholds.minArtifactIntegrityShare) {
    reasons.push(
      `artifact_integrity_share_below_threshold:${artifactIntegrityShare.toFixed(3)}<${thresholds.minArtifactIntegrityShare.toFixed(3)}`
    );
  }
  if (verificationFallbackShare > thresholds.maxVerificationFallbackShare) {
    reasons.push(
      `verification_fallback_share_above_threshold:${verificationFallbackShare.toFixed(3)}>${thresholds.maxVerificationFallbackShare.toFixed(3)}`
    );
  }

  if (!t3PlusLift) {
    reasons.push('t3_plus_lift_unavailable');
  } else {
    const successCeilingReached = t3PlusLift.controlSuccessRate >= AB_SUCCESS_SATURATION_RATE
      && t3PlusLift.treatmentSuccessRate >= AB_SUCCESS_SATURATION_RATE
      && Math.abs(t3PlusLift.absoluteSuccessRateDelta) < 1e-9;

    if (successCeilingReached) {
      const agentCommandTimeReduction = Number.isFinite(t3PlusLift.agentCommandTimeReduction)
        ? (t3PlusLift.agentCommandTimeReduction as number)
        : Number.NEGATIVE_INFINITY;
      const effectiveTimeReduction = Math.max(t3PlusLift.timeReduction, agentCommandTimeReduction);
      if (thresholds.requireT3CeilingTimeReduction && effectiveTimeReduction < thresholds.minT3CeilingTimeReduction) {
        reasons.push(
          `t3_plus_ceiling_time_reduction_below_threshold:${effectiveTimeReduction.toFixed(3)}<${thresholds.minT3CeilingTimeReduction.toFixed(3)}`
        );
      }
      if (!t3PlusLift.significance.sampleSizeAdequate) {
        reasons.push('t3_plus_significance_sample_insufficient');
      }
    } else {
      if (t3PlusLift.successRateLift < thresholds.minT3SuccessRateLift) {
        reasons.push(`t3_plus_lift_below_threshold:${t3PlusLift.successRateLift.toFixed(3)}<${thresholds.minT3SuccessRateLift.toFixed(3)}`);
      }
      if (!t3PlusLift.significance.sampleSizeAdequate) {
        reasons.push('t3_plus_significance_sample_insufficient');
      } else if (thresholds.requireT3Significance && t3PlusLift.significance.statisticallySignificant !== true) {
        reasons.push('t3_plus_not_statistically_significant');
      }
    }
  }

  if (thresholds.requireNoCriticalFailures) {
    const criticalFailureReasons = extractCriticalFailureReasons(failureReasons);
    const criticalFailureCount = Object.values(criticalFailureReasons).reduce((sum, count) => sum + count, 0);
    if (criticalFailureCount > 0) {
      reasons.push(`critical_failures_present:${criticalFailureCount}`);
    }
  }

  const classifiedReasons = classifyGateReasons(reasons);
  return {
    passed: reasons.length === 0,
    reasons,
    classifiedReasons,
    severityCounts: countBySeverity(classifiedReasons),
    categoryCounts: countByCategory(classifiedReasons),
  };
}

function isCriticalFailureReason(reason: string): boolean {
  if (reason.includes('provider_unavailable')) return true;
  if (reason.includes('context_unavailable')) return true;
  if (reason === 'verification_command_missing') return true;
  if (reason === 'baseline_required_but_missing') return true;
  if (reason === 'baseline_expected_failure_missing') return true;
  if (reason === 'artifact_incomplete') return true;
  if (reason === 'verification_fallback_disallowed') return true;
  if (reason.startsWith('setup_command_')) return true;
  if (reason.startsWith('baseline_command_')) return true;
  if (reason.startsWith('agent_command_')) return true;
  if (reason.startsWith('missing_repo')) return true;
  if (reason.startsWith('clone_failed')) return true;
  if (reason.startsWith('checkout_failed')) return true;
  return false;
}

function extractCriticalFailureReasons(failureReasons: Record<string, number>): Record<string, number> {
  const entries = Object.entries(failureReasons).filter(([reason]) => isCriticalFailureReason(reason));
  return Object.fromEntries(entries);
}

async function ensureRepoExists(reposRoot: string, repoName: string, cloneMissing: boolean): Promise<string> {
  const primary = path.join(reposRoot, repoName);
  const secondary = path.join(reposRoot, 'repos', repoName);
  if (await fileExists(primary)) return primary;
  if (await fileExists(secondary)) return secondary;
  if (!cloneMissing) {
    throw new Error(`missing_repo:${repoName}`);
  }

  const manifestPath = path.join(reposRoot, 'manifest.json');
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = safeJsonParse<{ repos?: Array<{ name: string; remote?: string; commit?: string }> }>(manifestRaw);
  if (!manifest.ok || !manifest.value?.repos) {
    throw new Error('unverified_by_trace(test_fixture_missing): external repo manifest missing or invalid');
  }
  const entry = manifest.value.repos.find((repo) => repo.name === repoName);
  if (!entry?.remote) {
    throw new Error(`missing_remote:${repoName}`);
  }
  const cloneResult = await runCommand(`git clone ${entry.remote} ${primary}`, process.cwd(), process.env, DEFAULT_TIMEOUT_MS);
  if (cloneResult.exitCode !== 0) {
    throw new Error(`clone_failed:${repoName}`);
  }
  if (entry.commit) {
    const checkoutResult = await runCommand(`git -C ${primary} checkout ${entry.commit}`, process.cwd(), process.env, DEFAULT_TIMEOUT_MS);
    if (checkoutResult.exitCode !== 0) {
      throw new Error(`checkout_failed:${repoName}`);
    }
  }
  return primary;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory() || fileStat.isFile();
  } catch {
    return false;
  }
}

async function copyRepoToTemp(repoRoot: string, repoName: string): Promise<{ tempRoot: string; workspaceRoot: string }> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `ab-harness-${repoName}-`));
  const workspaceRoot = path.join(tempRoot, repoName);
  const shouldCopy = (src: string): boolean => {
    const parts = src.split(path.sep);
    return !parts.some((part) => SKIP_DIRS.has(part));
  };
  await cp(repoRoot, workspaceRoot, { recursive: true, filter: shouldCopy });
  return { tempRoot, workspaceRoot };
}

export async function runAbExperiment(options: AbHarnessOptions): Promise<AbExperimentReport> {
  const startedAt = new Date();
  const verbose = process.env.AB_HARNESS_VERBOSE !== '0';
  const workerTypes: AbWorkerType[] =
    options.workerTypes && options.workerTypes.length > 0
      ? options.workerTypes
      : ['control', 'treatment'];
  const selectionMode = options.selectionMode ?? 'sequential';
  const evidenceProfile = options.evidenceProfile ?? 'custom';
  const tasks = selectAbTasksForExecution(options.tasks, {
    maxTasks: options.maxTasks,
    selectionMode,
    uncertaintyScores: options.uncertaintyScores,
  });
  const contextLevelOverride = options.contextLevelOverride;
  const defaultRequireCeilingTimeReduction = true;
  const thresholds = {
    requireAgentCommandTasks: options.requireAgentCommandTasks ?? false,
    minAgentCommandShare: clamp01(options.minAgentCommandShare ?? 0),
    minT3SuccessRateLift: Number.isFinite(options.minT3SuccessRateLift) ? (options.minT3SuccessRateLift as number) : 0.25,
    requireT3Significance: options.requireT3Significance ?? false,
    requireNoCriticalFailures: options.requireNoCriticalFailures ?? true,
    minAgentVerifiedExecutionShare: clamp01(options.minAgentVerifiedExecutionShare ?? 0),
    requireBaselineFailureForAgentTasks: options.requireBaselineFailureForAgentTasks ?? false,
    minArtifactIntegrityShare: clamp01(options.minArtifactIntegrityShare ?? 0),
    maxVerificationFallbackShare: clamp01(options.maxVerificationFallbackShare ?? 0),
    requireT3CeilingTimeReduction: options.requireT3CeilingTimeReduction ?? defaultRequireCeilingTimeReduction,
    minT3CeilingTimeReduction: Number.isFinite(options.minT3CeilingTimeReduction)
      ? (options.minT3CeilingTimeReduction as number)
      : AB_CEILING_MIN_TIME_REDUCTION,
  };

  const results: AbTaskRunResult[] = [];
  const contextCache = new Map<string, string[]>();
  const librarianSessionCache = new Map<string, InitializedLibrarianSession>();
  const totalRuns = tasks.length * workerTypes.length;
  let runIndex = 0;

  const getLibrarianSession = async (repoRoot: string): Promise<InitializedLibrarianSession> => {
    const cached = librarianSessionCache.get(repoRoot);
    if (cached) return cached;
    const session = await initializeLibrarian(repoRoot, {
      silent: true,
      skipWatcher: true,
      skipHealing: true,
      skipLlm: true,
      reuseExistingSession: false,
      allowDegradedEmbeddings: false,
    });
    librarianSessionCache.set(repoRoot, session);
    return session;
  };

  try {
    for (const task of tasks) {
      const repoRoot = await ensureRepoExists(options.reposRoot, task.repo, options.cloneMissing ?? false);

      for (const workerType of workerTypes) {
        runIndex += 1;
        if (verbose) {
          console.log(
            `[ab-harness] run ${runIndex}/${totalRuns} task=${task.id} worker=${workerType} complexity=${task.complexity}`
          );
        }
        const { tempRoot, workspaceRoot } = await copyRepoToTemp(repoRoot, task.repo);
        try {
          const resolveExtraContext = workerType === 'treatment'
            ? async (request: AbContextRequest) => {
              const effectiveLevel = contextLevelOverride ?? task.contextLevel;
              const key = `${repoRoot}::${task.id}::${effectiveLevel}`;
              const cached = contextCache.get(key);
              if (cached) return cached;
              const extra = options.resolveExtraContext
                ? await options.resolveExtraContext(request)
                : await queryLibrarianContextWithSession(task, repoRoot, await getLibrarianSession(repoRoot));
              const normalizedExtra = normalizePaths(extra ?? []);
              contextCache.set(key, normalizedExtra);
              return normalizedExtra;
            }
            : undefined;

          const result = await runAbTask(task, workspaceRoot, {
            workerType,
            contextLevelOverride: options.contextLevelOverride,
            commandTimeoutMs: options.commandTimeoutMs,
            artifactRoot: options.artifactRoot ?? path.join(options.reposRoot, '.ab-harness-artifacts'),
            resolveExtraContext,
          });
          results.push(result);
          if (verbose) {
            console.log(
              `[ab-harness] result task=${task.id} worker=${workerType} success=${result.success ? 'true' : 'false'}`
              + ` failure=${result.failureReason ?? 'none'} durationMs=${result.durationMs}`
            );
          }
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      }
    }
  } finally {
    for (const session of librarianSessionCache.values()) {
      try {
        await session.shutdown();
      } catch {
        // Best-effort cleanup for benchmark-only sessions.
      }
    }
  }

  const control = workerTypes.includes('control') ? aggregateByComplexity(results, 'control') : null;
  const treatment = workerTypes.includes('treatment') ? aggregateByComplexity(results, 'treatment') : null;
  const lift = computeAbLiftSummary(control, treatment);

  const t3PlusResults = results.filter((result) => ['T3', 'T4', 'T5'].includes(result.complexity));
  const t3Control = workerTypes.includes('control') ? aggregateByComplexity(t3PlusResults, 'control') : null;
  const t3Treatment = workerTypes.includes('treatment') ? aggregateByComplexity(t3PlusResults, 'treatment') : null;
  const t3PlusLift = computeAbLiftSummary(t3Control, t3Treatment);
  const failureReasons = countFailureReasons(results);
  const criticalFailureReasons = extractCriticalFailureReasons(failureReasons);
  const modeCounts = countModes(results);
  const modeTotal = modeCounts.agent_command + modeCounts.deterministic_edit;
  const agentCommandShare = modeTotal > 0 ? modeCounts.agent_command / modeTotal : 0;
  const {
    agentVerifiedExecutionShare,
    agentBaselineGuardShare,
  } = computeAgentRunDiagnostics(results);
  const artifactIntegrityShare = computeArtifactIntegrityShare(results);
  const {
    verificationFallbackRuns,
    verificationFallbackShare,
  } = computeVerificationFallbackUsage(results);
  const gates = computeExperimentGates({
    modeCounts,
    failureReasons,
    t3PlusLift,
    agentVerifiedExecutionShare,
    agentBaselineGuardShare,
    artifactIntegrityShare,
    verificationFallbackShare,
    thresholds,
  });

  return {
    runId: `ab-${startedAt.toISOString()}`,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    options: {
      reposRoot: options.reposRoot,
      taskCount: tasks.length,
      selectedTaskIds: tasks.map((task) => task.id),
      selectionMode,
      evidenceProfile,
      workerTypes,
      contextLevelOverride: options.contextLevelOverride,
    },
    results,
    control,
    treatment,
    lift,
    t3PlusLift,
    diagnostics: {
      failureReasons,
      criticalFailureReasons,
      modeCounts,
      agentCommandShare,
      agentVerifiedExecutionShare,
      agentBaselineGuardShare,
      artifactIntegrityShare,
      verificationFallbackRuns,
      verificationFallbackShare,
    },
    gates: {
      ...gates,
      thresholds,
    },
  };
}

export async function loadAbTasks(tasksPath: string): Promise<AbTaskDefinition[]> {
  const raw = await readFile(tasksPath, 'utf8');
  const parsed = safeJsonParse<{ tasks?: AbTaskDefinition[] }>(raw);
  if (!parsed.ok || !parsed.value?.tasks) {
    throw new Error('invalid_ab_tasks');
  }
  return parsed.value.tasks;
}
