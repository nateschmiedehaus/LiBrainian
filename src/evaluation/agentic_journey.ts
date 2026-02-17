import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import { runProviderReadinessGate, type ProviderGateResult } from '../api/provider_gate.js';
import { ConstraintEngine } from '../engines/constraint_engine.js';
import type { LlmRequirement } from '../types.js';

export type JourneyLlmMode = 'disabled' | 'optional';
export type JourneyProtocol = 'legacy' | 'objective';

export interface AgenticJourneyStep {
  intent: string;
  packs: number;
  useful: boolean;
}

export interface AgenticJourneyValidation {
  blocking: boolean;
  violations: number;
  warnings: number;
}

export interface AgenticJourneyRepoResult {
  repo: string;
  protocol?: JourneyProtocol;
  overviewOk: boolean;
  moduleOk: boolean;
  onboardingOk: boolean;
  fileContextOk: boolean;
  glanceOk: boolean;
  recommendations: number;
  validation?: AgenticJourneyValidation;
  journeyOk: boolean;
  contextFile?: string;
  contextSelection?: 'retrieved' | 'fallback';
  steps: AgenticJourneyStep[];
  errors: string[];
}

export interface AgenticJourneyReport {
  results: AgenticJourneyRepoResult[];
  artifacts?: {
    root: string;
    reportPath: string;
    repoReportPaths: string[];
  };
}

const EMPTY_SUMMARIES = new Set(['No context available', 'No relevant context found']);
const DEFAULT_QUERIES = [
  'Provide a concise project overview.',
  'What are the key modules or components?',
  'Where should a new contributor start?',
];
const FILE_CONTEXT_INTENT = 'Explain this file’s purpose and key responsibilities.';

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
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

function truncateText(value: string, maxChars = 500): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...<truncated>`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
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

async function pickRetrievedContextFile(
  repoRoot: string,
  responses: Array<{ packs: Array<{ relatedFiles?: string[]; codeSnippets?: Array<{ filePath: string }> }> }>
): Promise<string | null> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const response of responses) {
    for (const pack of response.packs ?? []) {
      for (const relatedFile of pack.relatedFiles ?? []) {
        const candidate = normalizeCandidateFile(relatedFile, repoRoot);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
      for (const snippet of pack.codeSnippets ?? []) {
        const candidate = normalizeCandidateFile(snippet.filePath, repoRoot);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
    }
  }
  for (const candidate of candidates) {
    if (await fileExists(path.join(repoRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

export async function runAgenticJourney(options: {
  reposRoot: string;
  maxRepos?: number;
  deterministic?: boolean;
  llmMode?: JourneyLlmMode;
  queries?: string[];
  protocol?: JourneyProtocol;
  strictObjective?: boolean;
  repoNames?: string[];
  artifactRoot?: string;
  runLabel?: string;
  signal?: AbortSignal;
}): Promise<AgenticJourneyReport> {
  throwIfAborted(options.signal, 'journey');
  const manifestPath = path.join(options.reposRoot, 'manifest.json');
  await stat(manifestPath);
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = safeJsonParse<{ repos?: Array<{ name: string }> }>(raw);
  if (!parsed.ok || !parsed.value?.repos) {
    throw new Error('unverified_by_trace(test_fixture_missing): external repo manifest missing or invalid');
  }

  const repos = parsed.value.repos;
  const requested = Array.isArray(options.repoNames) && options.repoNames.length > 0
    ? repos.filter((repo) => options.repoNames!.includes(repo.name))
    : repos;
  if (Array.isArray(options.repoNames) && options.repoNames.length > 0) {
    const missing = options.repoNames.filter((name) => !repos.some((repo) => repo.name === name));
    if (missing.length > 0) {
      throw new Error(`unverified_by_trace(test_fixture_missing): requested repos not found in manifest: ${missing.join(', ')}`);
    }
  }
  const slice = typeof options.maxRepos === 'number' && options.maxRepos > 0
    ? requested.slice(0, options.maxRepos)
    : requested;
  const queries = options.queries && options.queries.length > 0 ? options.queries : DEFAULT_QUERIES;
  const llmMode = options.llmMode ?? 'disabled';
  const protocol = options.protocol ?? 'objective';
  const strictObjective = Boolean(options.strictObjective);
  const artifactRoot = options.artifactRoot && options.artifactRoot.trim().length > 0
    ? path.resolve(options.artifactRoot)
    : null;
  const runLabel = options.runLabel && options.runLabel.trim().length > 0
    ? sanitizePathSegment(options.runLabel)
    : `journey-${Date.now()}`;
  const repoReportPaths: string[] = [];
  const runArtifactsRoot = artifactRoot
    ? path.join(artifactRoot, sanitizePathSegment(runLabel))
    : null;
  const runStartedAt = new Date().toISOString();

  const results: AgenticJourneyRepoResult[] = [];

  for (const repo of slice) {
    throwIfAborted(options.signal, 'journey');
    const repoRoot = path.join(options.reposRoot, repo.name);
    const result: AgenticJourneyRepoResult = {
      repo: repo.name,
      protocol,
      overviewOk: false,
      moduleOk: false,
      onboardingOk: false,
      fileContextOk: false,
      glanceOk: false,
      recommendations: 0,
      journeyOk: false,
      steps: [],
      errors: [],
    };
    let librarianForCleanup: { shutdown(): Promise<void> } | null = null;
    let providerSnapshotSummary: Record<string, unknown> | null = null;
    const queryArtifacts: Array<{
      intent: string;
      summary: ReturnType<typeof summarizeQueryResponse>;
    }> = [];
    try {
      const resolvedWorkspace = resolveWorkspaceRoot(repoRoot).workspace;
      const providerSnapshot = await runProviderReadinessGate(resolvedWorkspace, { emitReport: true });
      providerSnapshotSummary = {
        ready: providerSnapshot.ready,
        llmReady: providerSnapshot.llmReady,
        embeddingReady: providerSnapshot.embeddingReady,
        selectedProvider: providerSnapshot.selectedProvider ?? null,
        reason: providerSnapshot.reason ?? null,
        providers: providerSnapshot.providers.map((provider) => ({
          provider: provider.provider,
          available: provider.available,
          authenticated: provider.authenticated,
          error: provider.error ?? null,
        })),
        embedding: {
          provider: providerSnapshot.embedding.provider,
          available: providerSnapshot.embedding.available,
          error: providerSnapshot.embedding.error ?? null,
        },
      };
      const providerFailures = providerSnapshot.providers
        .map((provider) => {
          if (provider.available && provider.authenticated) return `${provider.provider}:ready`;
          const detail = provider.error ?? (provider.available ? 'unauthenticated' : 'unavailable');
          return `${provider.provider}:${detail}`;
        })
        .join('; ');
      const missingPrerequisites: string[] = [];
      if (!providerSnapshot.embeddingReady) {
        missingPrerequisites.push(`Embedding: ${providerSnapshot.embedding.error ?? 'unavailable'}`);
      }
      if (llmMode !== 'disabled' && !providerSnapshot.llmReady) {
        const llmDetail = providerSnapshot.reason || providerFailures || 'unavailable';
        missingPrerequisites.push(`LLM: ${llmDetail}`);
      }
      if (missingPrerequisites.length > 0) {
        throw new Error(
          `unverified_by_trace(provider_unavailable): journey prerequisites unavailable (${missingPrerequisites.join('; ')})`
        );
      }

      const providerGate = llmMode === 'disabled'
        ? async (): Promise<ProviderGateResult> => ({
          ...providerSnapshot,
          llmReady: false,
          selectedProvider: null,
          ready: providerSnapshot.embeddingReady,
          reason: providerSnapshot.reason ?? 'LLM disabled for journey run',
        })
        : async (): Promise<ProviderGateResult> => providerSnapshot;

      const gateResult = await ensureLibrarianReady(resolvedWorkspace, {
        allowDegradedEmbeddings: false,
        requireCompleteParserCoverage: strictObjective,
        providerGate,
        throwOnFailure: true,
      });

      if (!gateResult.librarian) {
        result.errors.push('unverified_by_trace(initialization_failed): librarian unavailable');
        results.push(result);
        continue;
      }
      librarianForCleanup = gateResult.librarian;

      const baseQueryDefaults = {
        depth: 'L1' as const,
        embeddingRequirement: 'required' as const,
        deterministic: options.deterministic ?? false,
        includeEngines: false,
      };
      const retrievalQueryDefaults = {
        ...baseQueryDefaults,
        llmRequirement: 'disabled' as LlmRequirement,
      };
      const synthesisQueryDefaults = {
        ...baseQueryDefaults,
        llmRequirement: (llmMode === 'disabled' ? 'disabled' : 'required') as LlmRequirement,
      };

      const overview = await gateResult.librarian.queryOptional({
        intent: queries[0] ?? DEFAULT_QUERIES[0]!,
        ...retrievalQueryDefaults,
      });
      queryArtifacts.push({
        intent: queries[0] ?? DEFAULT_QUERIES[0]!,
        summary: summarizeQueryResponse(overview, resolvedWorkspace),
      });
      result.overviewOk = isResponseUseful(overview);
      result.steps.push({ intent: queries[0] ?? DEFAULT_QUERIES[0]!, packs: overview.packs.length, useful: result.overviewOk });

      const modules = await gateResult.librarian.queryOptional({
        intent: queries[1] ?? DEFAULT_QUERIES[1]!,
        ...retrievalQueryDefaults,
      });
      queryArtifacts.push({
        intent: queries[1] ?? DEFAULT_QUERIES[1]!,
        summary: summarizeQueryResponse(modules, resolvedWorkspace),
      });
      result.moduleOk = isResponseUseful(modules);
      result.steps.push({ intent: queries[1] ?? DEFAULT_QUERIES[1]!, packs: modules.packs.length, useful: result.moduleOk });

      const onboarding = await gateResult.librarian.queryOptional({
        intent: queries[2] ?? DEFAULT_QUERIES[2]!,
        ...synthesisQueryDefaults,
      });
      queryArtifacts.push({
        intent: queries[2] ?? DEFAULT_QUERIES[2]!,
        summary: summarizeQueryResponse(onboarding, resolvedWorkspace),
      });
      result.onboardingOk = isResponseUseful(onboarding);
      result.steps.push({ intent: queries[2] ?? DEFAULT_QUERIES[2]!, packs: onboarding.packs.length, useful: result.onboardingOk });

      let contextFile: string | null = null;
      if (protocol === 'objective') {
        contextFile = await pickRetrievedContextFile(resolvedWorkspace, [overview, modules, onboarding]);
        if (contextFile) {
          result.contextSelection = 'retrieved';
        } else if (!strictObjective) {
          contextFile = await pickRepresentativeFile(resolvedWorkspace);
          if (contextFile) {
            result.contextSelection = 'fallback';
            result.errors.push('fallback_context_file_selection');
          }
        } else {
          result.errors.push('no_retrieved_context_file');
        }
      } else {
        contextFile = await pickRepresentativeFile(resolvedWorkspace);
      }

      if (contextFile) {
        result.contextFile = contextFile;
        const fileContext = await gateResult.librarian.queryOptional({
          intent: FILE_CONTEXT_INTENT,
          affectedFiles: [contextFile],
          ...retrievalQueryDefaults,
        });
        queryArtifacts.push({
          intent: FILE_CONTEXT_INTENT,
          summary: summarizeQueryResponse(fileContext, resolvedWorkspace),
        });
        result.fileContextOk = isResponseUseful(fileContext);
        result.steps.push({ intent: FILE_CONTEXT_INTENT, packs: fileContext.packs.length, useful: result.fileContextOk });
      } else {
        result.errors.push('no_candidate_file');
      }

      const packWithTarget = overview.packs.find((pack) => Boolean(pack.targetId))
        ?? modules.packs.find((pack) => Boolean(pack.targetId))
        ?? onboarding.packs.find((pack) => Boolean(pack.targetId));
      if (packWithTarget?.targetId) {
        const glance = await gateResult.librarian.getGlanceCard(packWithTarget.targetId);
        result.glanceOk = Boolean(glance?.oneLiner && glance.oneLiner.trim().length > 0);
      }

      if (result.contextFile) {
        try {
          const recs = await gateResult.librarian.getRecommendations(result.contextFile, 'all');
          result.recommendations = recs.length;
        } catch {
          result.recommendations = 0;
        }
      }

      const markValidationUnavailable = (message: string): void => {
        if (!result.errors.includes(message)) {
          result.errors.push(message);
        }
        result.validation = {
          blocking: true,
          violations: Math.max(result.validation?.violations ?? 0, 1),
          warnings: result.validation?.warnings ?? 0,
        };
      };

      const storage = gateResult.librarian.getStorage();
      if (storage && result.contextFile) {
        try {
          const absoluteFile = path.join(resolvedWorkspace, result.contextFile);
          const content = await readFile(absoluteFile, 'utf8');
          const relativePath = path.relative(resolvedWorkspace, absoluteFile);
          const engine = new ConstraintEngine(storage, resolvedWorkspace);
          const validation = await engine.validateChange(relativePath, content, content);
          result.validation = {
            blocking: validation.blocking,
            violations: validation.violations.length,
            warnings: validation.warnings.length,
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          markValidationUnavailable(`unverified_by_trace(validation_unavailable): ${detail}`);
        }
      } else if (!result.contextFile) {
        markValidationUnavailable('unverified_by_trace(validation_unavailable): context file unavailable for validation');
      } else {
        markValidationUnavailable('unverified_by_trace(validation_unavailable): constraint validation storage unavailable');
      }

      if (result.validation?.blocking && !result.errors.includes('blocking_validation_failed')) {
        result.errors.push('blocking_validation_failed');
      }

      const validationOk = result.validation ? !result.validation.blocking : false;
      const objectiveProtocolOk = protocol !== 'objective'
        || !strictObjective
        || (result.contextSelection === 'retrieved' && result.fileContextOk);
      result.journeyOk = result.overviewOk
        && result.moduleOk
        && (result.fileContextOk || result.glanceOk)
        && validationOk
        && objectiveProtocolOk;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (librarianForCleanup) {
        await librarianForCleanup.shutdown().catch(() => {});
      }
    }
    results.push(result);

    if (runArtifactsRoot) {
      const repoReportPath = path.join(runArtifactsRoot, 'repos', `${sanitizePathSegment(repo.name)}.json`);
      const repoReport = {
        schema: 'AgenticJourneyRepoArtifact.v1',
        createdAt: new Date().toISOString(),
        repo: repo.name,
        options: {
          protocol,
          llmMode,
          strictObjective,
          deterministic: options.deterministic ?? false,
        },
        providerSnapshot: providerSnapshotSummary,
        queryArtifacts,
        result: {
          ...result,
          errors: result.errors.map((error) => truncateText(error, 700)),
        },
      };
      await writeJson(repoReportPath, repoReport);
      repoReportPaths.push(repoReportPath);
    }
  }

  if (runArtifactsRoot) {
    const reportPath = path.join(runArtifactsRoot, 'report.json');
    await writeJson(reportPath, {
      schema: 'AgenticJourneyRunArtifact.v1',
      startedAt: runStartedAt,
      completedAt: new Date().toISOString(),
      options: {
        reposRoot: options.reposRoot,
        maxRepos: options.maxRepos,
        repoNames: options.repoNames,
        llmMode,
        protocol,
        strictObjective,
        deterministic: options.deterministic ?? false,
      },
      summary: {
        total: results.length,
        failures: results.filter((result) => !result.journeyOk || result.errors.length > 0).length,
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
      },
    };
  }

  return { results };
}
