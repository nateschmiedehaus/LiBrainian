import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import { runProviderReadinessGate, type ProviderGateResult } from '../api/provider_gate.js';
import { TimeoutError, withTimeout } from '../utils/async.js';
import { EXCLUDE_PATTERNS } from '../universal_patterns.js';
import type { BootstrapReport } from '../types.js';

export interface ExternalRepoSmokeResult {
  repo: string;
  overviewOk: boolean;
  contextOk: boolean;
  contextFile?: string;
  errors: string[];
}

export interface ExternalRepoSmokeReport {
  results: ExternalRepoSmokeResult[];
  artifacts?: {
    root: string;
    reportPath: string;
    repoReportPaths: string[];
    progressPath?: string;
  };
}

const EMPTY_SUMMARIES = new Set(['No context available', 'No relevant context found']);
const DEFAULT_QUERIES = [
  'Provide a concise project overview.',
  'What are the key modules or components?',
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.h',
  '.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx',
  '.cs',
  '.php', '.phtml',
  '.rb', '.rake',
  '.swift',
  '.scala', '.sc',
  '.dart',
  '.lua',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
]);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '.pytest_cache',
]);

const STRICT_BOOTSTRAP_WARNING_PATTERNS = [
  /semantic search unavailable/i,
  /no functions extracted/i,
  /parser unavailable/i,
  /embeddings skipped/i,
  /semantic search disabled/i,
];
const SMOKE_EXTRA_EXCLUDES = [
  '**/__tests__/**',
  '**/test/**',
  '**/tests/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.snap',
  '**/docs/**',
  '**/documentation/**',
  '**/scripts/**',
  '**/skills/**',
  '**/extensions/**',
  '**/examples/**',
  '**/vendor/**',
  '**/third_party/**',
  '**/bench/**',
  '**/benchmark/**',
  '**/perf/**',
  '**/fixtures/**',
  '**/mocks/**',
  '**/mock/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/target/**',
  '**/tmp/**',
];
const SMOKE_INCLUDE_PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.py', '**/*.go', '**/*.rs',
  '**/*.java', '**/*.kt', '**/*.kts',
  '**/*.c', '**/*.h', '**/*.cpp', '**/*.hpp', '**/*.cc', '**/*.hh', '**/*.cxx', '**/*.hxx',
  '**/*.cs',
  '**/*.php', '**/*.phtml',
  '**/*.rb', '**/*.rake',
  '**/*.swift',
  '**/*.scala', '**/*.sc',
  '**/*.dart',
  '**/*.lua',
  '**/*.sh', '**/*.bash', '**/*.zsh',
  '**/*.sql',
  '**/README*',
  '**/package.json', '**/Cargo.toml', '**/go.mod', '**/pyproject.toml',
];
const SMOKE_EXCLUDE_PATTERNS = Array.from(new Set([...EXCLUDE_PATTERNS, ...SMOKE_EXTRA_EXCLUDES]));
const DEFAULT_REPO_TIMEOUT_MS = 180_000;
const MAX_ADAPTIVE_REPO_TIMEOUT_MS = 900_000;
const ADAPTIVE_TIMEOUT_PER_FILE_MS = 120;
const ADAPTIVE_TIMEOUT_FILE_CAP = 20_000;

function collectStrictBootstrapWarnings(report: BootstrapReport | undefined): string[] {
  const warnings = report?.warnings ?? [];
  const matched: string[] = [];
  for (const warning of warnings) {
    if (STRICT_BOOTSTRAP_WARNING_PATTERNS.some((pattern) => pattern.test(warning))) {
      matched.push(warning);
    }
  }
  return matched;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const dirStat = await stat(dirPath);
    return dirStat.isDirectory();
  } catch {
    return false;
  }
}

async function estimateRepoSize(repoRoot: string): Promise<number> {
  let count = 0;
  const queue: string[] = [repoRoot];
  while (queue.length > 0 && count < ADAPTIVE_TIMEOUT_FILE_CAP) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(path.join(current, entry.name));
        continue;
      }
      if (entry.isFile()) {
        count += 1;
        if (count >= ADAPTIVE_TIMEOUT_FILE_CAP) break;
      }
    }
  }
  return count;
}

async function resolveRepoTimeoutMs(repoRoot: string, configuredTimeoutMs: number | null): Promise<number> {
  if (configuredTimeoutMs && configuredTimeoutMs > 0) return configuredTimeoutMs;
  const size = await estimateRepoSize(repoRoot);
  const adaptive = DEFAULT_REPO_TIMEOUT_MS + (size * ADAPTIVE_TIMEOUT_PER_FILE_MS);
  return Math.max(DEFAULT_REPO_TIMEOUT_MS, Math.min(MAX_ADAPTIVE_REPO_TIMEOUT_MS, adaptive));
}

async function pickRepresentativeFile(repoRoot: string): Promise<string | null> {
  const candidates = [
    'README.md',
    'README',
    'package.json',
    'pyproject.toml',
    'setup.py',
    'Cargo.toml',
    'go.mod',
  ];
  for (const candidate of candidates) {
    if (await fileExists(path.join(repoRoot, candidate))) {
      return candidate;
    }
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: '', depth: 0 }];
  const maxDepth = 2;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth > maxDepth) continue;
    const dirPath = path.join(repoRoot, current.dir);
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const relPath = current.dir ? path.join(current.dir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        queue.push({ dir: relPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        return relPath.split(path.sep).join('/');
      }
    }
  }
  return null;
}

function isResponseUseful(response: { packs: Array<{ summary: string; keyFacts: string[]; codeSnippets: unknown[] }> }): boolean {
  if (!response || response.packs.length === 0) return false;
  const firstSummary = response.packs[0]?.summary ?? '';
  if (firstSummary && !EMPTY_SUMMARIES.has(firstSummary)) return true;
  return response.packs.some((pack) => (pack.codeSnippets?.length ?? 0) > 0 || (pack.keyFacts?.length ?? 0) > 0);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (typeof reason === 'string' && reason.trim().length > 0) {
    throw new Error(reason);
  }
  throw new Error(`${label}_aborted`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeCandidateFile(filePath: string, repoRoot: string): string {
  const normalizedRepoRoot = repoRoot.split(path.sep).join('/');
  const normalizedRaw = filePath.split(path.sep).join('/').replace(/^\.\/+/, '');
  if (path.isAbsolute(filePath)) {
    const normalizedAbs = filePath.split(path.sep).join('/');
    if (normalizedAbs.startsWith(`${normalizedRepoRoot}/`)) {
      return normalizedAbs.slice(normalizedRepoRoot.length + 1);
    }
    return normalizedRaw;
  }
  if (normalizedRaw.startsWith(`${normalizedRepoRoot}/`)) {
    return normalizedRaw.slice(normalizedRepoRoot.length + 1);
  }
  return normalizedRaw;
}

function summarizeQueryResponse(
  response: {
    packs?: Array<{
      summary?: string;
      relatedFiles?: string[];
      keyFacts?: string[];
      codeSnippets?: Array<{ filePath: string }>;
    }>;
  },
  repoRoot: string
): {
  packCount: number;
  hasUsefulSummary: boolean;
  relatedFiles: string[];
  keyFactsCount: number;
  snippetFiles: string[];
} {
  const packs = response.packs ?? [];
  const relatedFiles = new Set<string>();
  const snippetFiles = new Set<string>();
  let keyFactsCount = 0;
  let hasUsefulSummary = false;

  for (const pack of packs) {
    const summary = (pack.summary ?? '').trim();
    if (summary.length > 0 && !EMPTY_SUMMARIES.has(summary)) {
      hasUsefulSummary = true;
    }
    for (const file of pack.relatedFiles ?? []) {
      relatedFiles.add(normalizeCandidateFile(file, repoRoot));
    }
    for (const snippet of pack.codeSnippets ?? []) {
      snippetFiles.add(normalizeCandidateFile(snippet.filePath, repoRoot));
    }
    keyFactsCount += pack.keyFacts?.length ?? 0;
  }

  return {
    packCount: packs.length,
    hasUsefulSummary,
    relatedFiles: Array.from(relatedFiles),
    keyFactsCount,
    snippetFiles: Array.from(snippetFiles),
  };
}

export async function runExternalRepoSmoke(options: {
  reposRoot: string;
  maxRepos?: number;
  queries?: string[];
  repoNames?: string[];
  artifactRoot?: string;
  runLabel?: string;
  repoTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ExternalRepoSmokeReport> {
  throwIfAborted(options.signal, 'smoke');
  const manifestPath = path.join(options.reposRoot, 'manifest.json');
  await stat(manifestPath);
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = safeJsonParse<{ repos?: Array<{ name: string }> }>(raw);
  if (!parsed.ok || !parsed.value?.repos) {
    throw new Error('unverified_by_trace(test_fixture_missing): external repo manifest missing or invalid');
  }

  const repos = parsed.value.repos;
  let requested = repos;
  if (Array.isArray(options.repoNames) && options.repoNames.length > 0) {
    const byName = new Map(repos.map((repo) => [repo.name, repo] as const));
    const resolved: Array<{ name: string }> = [];
    const missing: string[] = [];

    for (const name of options.repoNames) {
      const fromManifest = byName.get(name);
      if (fromManifest) {
        resolved.push(fromManifest);
        continue;
      }
      const repoDir = path.join(options.reposRoot, name);
      if (await directoryExists(repoDir)) {
        resolved.push({ name });
        continue;
      }
      missing.push(name);
    }

    if (missing.length > 0) {
      throw new Error(`unverified_by_trace(test_fixture_missing): requested repos not found in manifest or reposRoot: ${missing.join(', ')}`);
    }
    requested = resolved;
  }

  const slice = typeof options.maxRepos === 'number' && options.maxRepos > 0
    ? requested.slice(0, options.maxRepos)
    : requested;
  const queries = options.queries && options.queries.length > 0 ? options.queries : DEFAULT_QUERIES;
  const artifactRoot = options.artifactRoot && options.artifactRoot.trim().length > 0
    ? path.resolve(options.artifactRoot)
    : null;
  const runLabel = options.runLabel && options.runLabel.trim().length > 0
    ? sanitizePathSegment(options.runLabel)
    : `smoke-${Date.now()}`;
  const repoReportPaths: string[] = [];
  const runArtifactsRoot = artifactRoot
    ? path.join(artifactRoot, sanitizePathSegment(runLabel))
    : null;
  const progressPath = runArtifactsRoot
    ? path.join(runArtifactsRoot, 'progress.json')
    : null;
  const configuredRepoTimeoutMs = Number.isFinite(options.repoTimeoutMs) && (options.repoTimeoutMs ?? 0) > 0
    ? Math.floor(options.repoTimeoutMs ?? 0)
    : null;
  const runStartedAt = new Date().toISOString();
  const failedRepos = new Set<string>();
  let completedRepos = 0;

  async function writeProgress(activeRepo: string | null): Promise<void> {
    if (!progressPath) return;
    await writeJson(progressPath, {
      schema: 'ExternalRepoSmokeProgress.v1',
      startedAt: runStartedAt,
      updatedAt: new Date().toISOString(),
      options: {
        reposRoot: options.reposRoot,
        maxRepos: options.maxRepos,
        repoNames: options.repoNames,
        repoTimeoutMs: configuredRepoTimeoutMs ?? DEFAULT_REPO_TIMEOUT_MS,
      },
      totalRepos: slice.length,
      completedRepos,
      remainingRepos: Math.max(0, slice.length - completedRepos),
      activeRepo,
      failedRepos: Array.from(failedRepos),
    });
  }

  const results: ExternalRepoSmokeResult[] = [];
  await writeProgress(null);

  for (const repo of slice) {
    throwIfAborted(options.signal, 'smoke');
    await writeProgress(repo.name);
    const repoRoot = path.join(options.reposRoot, repo.name);
    const result: ExternalRepoSmokeResult = {
      repo: repo.name,
      overviewOk: false,
      contextOk: false,
      errors: [],
    };
    const repoTimeoutMs = await resolveRepoTimeoutMs(repoRoot, configuredRepoTimeoutMs);
    let librarianForCleanup: { shutdown(): Promise<void> } | null = null;
    let providerSnapshotSummary: Record<string, unknown> | null = null;
    const queryArtifacts: Array<{
      intent: string;
      summary: ReturnType<typeof summarizeQueryResponse>;
    }> = [];
    const runRepoSmoke = async (): Promise<void> => {
      try {
        const resolvedWorkspace = resolveWorkspaceRoot(repoRoot).workspace;
        const providerGate = async (root: string): Promise<ProviderGateResult> => {
          const base = await runProviderReadinessGate(root, { emitReport: true });
          providerSnapshotSummary = {
            ready: base.ready,
            llmReady: base.llmReady,
            embeddingReady: base.embeddingReady,
            selectedProvider: base.selectedProvider ?? null,
            reason: base.reason ?? null,
            providers: base.providers.map((provider) => ({
              provider: provider.provider,
              available: provider.available,
              authenticated: provider.authenticated,
              error: provider.error ?? null,
            })),
            embedding: {
              provider: base.embedding.provider,
              available: base.embedding.available,
              error: base.embedding.error ?? null,
            },
          };
          return {
            ...base,
            llmReady: false,
            selectedProvider: null,
            ready: base.embeddingReady,
            reason: base.reason ?? 'LLM disabled for smoke run',
          };
        };

        const gateResult = await ensureLibrarianReady(resolvedWorkspace, {
          allowDegradedEmbeddings: false,
          requireCompleteParserCoverage: true,
          autoInstallGrammars: true,
          includePatterns: SMOKE_INCLUDE_PATTERNS,
          excludePatterns: SMOKE_EXCLUDE_PATTERNS,
          providerGate,
          throwOnFailure: true,
        });

        if (!gateResult.librarian) {
          result.errors.push('unverified_by_trace(initialization_failed): librarian unavailable');
          return;
        }
        librarianForCleanup = gateResult.librarian;
        const strictWarnings = collectStrictBootstrapWarnings(gateResult.report);
        if (strictWarnings.length > 0) {
          result.errors.push(
            ...strictWarnings.map((warning) => `unverified_by_trace(bootstrap_warning): ${warning}`)
          );
          return;
        }

        const overview = await gateResult.librarian.queryOptional({
          intent: queries[0] ?? DEFAULT_QUERIES[0]!,
          depth: 'L1',
          llmRequirement: 'disabled',
          embeddingRequirement: 'required',
          includeEngines: false,
        });
        queryArtifacts.push({
          intent: queries[0] ?? DEFAULT_QUERIES[0]!,
          summary: summarizeQueryResponse(overview, resolvedWorkspace),
        });
        result.overviewOk = isResponseUseful(overview);

        const contextFile = await pickRepresentativeFile(resolvedWorkspace);
        if (contextFile) {
          const fileContext = await gateResult.librarian.queryOptional({
            intent: queries[1] ?? DEFAULT_QUERIES[1]!,
            affectedFiles: [contextFile],
            depth: 'L1',
            llmRequirement: 'disabled',
            embeddingRequirement: 'required',
            includeEngines: false,
          });
          queryArtifacts.push({
            intent: queries[1] ?? DEFAULT_QUERIES[1]!,
            summary: summarizeQueryResponse(fileContext, resolvedWorkspace),
          });
          result.contextOk = isResponseUseful(fileContext);
          result.contextFile = contextFile;
        } else {
          result.errors.push('no_candidate_file');
        }
      } finally {
        if (librarianForCleanup) {
          await librarianForCleanup.shutdown().catch(() => {});
        }
      }
    };

    try {
      await withTimeout(runRepoSmoke(), repoTimeoutMs, {
        context: `external_repo_smoke:${repo.name}`,
        errorCode: 'smoke_repo_timeout',
      });
    } catch (error) {
      if (error instanceof TimeoutError) {
        result.errors.push(`unverified_by_trace(smoke_repo_timeout): ${repo.name} exceeded ${repoTimeoutMs}ms`);
      } else {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    results.push(result);
    const failed = result.errors.length > 0 || (!result.overviewOk && !result.contextOk);
    if (failed) {
      failedRepos.add(repo.name);
    }
    completedRepos += 1;

    if (runArtifactsRoot) {
      const repoReportPath = path.join(runArtifactsRoot, 'repos', `${sanitizePathSegment(repo.name)}.json`);
      await writeJson(repoReportPath, {
        schema: 'ExternalRepoSmokeRepoArtifact.v1',
        createdAt: new Date().toISOString(),
        repo: repo.name,
        providerSnapshot: providerSnapshotSummary,
        queryArtifacts,
        result,
      });
      repoReportPaths.push(repoReportPath);
    }
    await writeProgress(null);
  }

  if (runArtifactsRoot) {
    const reportPath = path.join(runArtifactsRoot, 'report.json');
    await writeJson(reportPath, {
      schema: 'ExternalRepoSmokeRunArtifact.v1',
      startedAt: runStartedAt,
      completedAt: new Date().toISOString(),
      options: {
        reposRoot: options.reposRoot,
        maxRepos: options.maxRepos,
        repoNames: options.repoNames,
        repoTimeoutMs: configuredRepoTimeoutMs ?? 'adaptive',
      },
      summary: {
        total: results.length,
        failures: results.filter((result) => result.errors.length > 0 || (!result.overviewOk && !result.contextOk)).length,
      },
      results,
      repoReportPaths,
    });
    return {
      results,
      artifacts: {
        root: runArtifactsRoot,
        reportPath,
        repoReportPaths,
        progressPath: progressPath!,
      },
    };
  }

  return { results };
}
