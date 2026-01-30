// Bootstrap API for Librarian.
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { createHash } from 'crypto';
import { getErrorMessage } from '../utils/errors.js';
import { logWarning } from '../telemetry/logger.js';
import type { LibrarianStorage, TransactionContext } from '../storage/types.js';
import { withinTransaction } from '../storage/transactions.js';
import type {
  BootstrapConfig,
  BootstrapCompositionSuggestionConfig,
  BootstrapReport,
  BootstrapCapabilities,
  BootstrapPhase,
  BootstrapPhaseResult,
  BootstrapPhaseName,
  BootstrapPhaseMetrics,
  CompositionSuggestion,
  GraphEdge,
  LibrarianMetadata,
  LibrarianVersion,
  IndexingTask,
} from '../types.js';
import { BOOTSTRAP_PHASES } from '../types.js';
import { LIBRARIAN_VERSION, QUALITY_TIERS } from '../index.js';
import { IndexLibrarian } from '../agents/index_librarian.js';
import { ParserRegistry } from '../agents/parser_registry.js';
import { SwarmRunner } from '../agents/swarm_runner.js';
import { IngestionFramework, createIngestionContext } from '../ingest/framework.js';
import { createDocsIngestionSource } from '../ingest/docs_indexer.js';
import { createConfigIngestionSource } from '../ingest/config_indexer.js';
import { createCiIngestionSource } from '../ingest/ci_indexer.js';
import { createTeamIngestionSource } from '../ingest/team_indexer.js';
import { createProcessIngestionSource } from '../ingest/process_indexer.js';
import { createTestIngestionSource } from '../ingest/test_indexer.js';
import { createDepsIngestionSource } from '../ingest/deps_indexer.js';
import { createSecurityIngestionSource } from '../ingest/security_indexer.js';
import { createDomainIngestionSource } from '../ingest/domain_indexer.js';
import { createSchemaIngestionSource } from '../ingest/schema_indexer.js';
import { createApiIngestionSource } from '../ingest/api_indexer.js';
import { createCommitIngestionSource } from '../ingest/commit_indexer.js';
import { createOwnershipIngestionSource } from '../ingest/ownership_indexer.js';
import { createAdrIngestionSource } from '../ingest/adr_indexer.js';
import { updateRepoDocs } from '../ingest/docs_update.js';
// Advanced Library Features (2025-2026 research)
import { indexBlame } from '../ingest/blame_indexer.js';
import { indexDiffs } from '../ingest/diff_indexer.js';
import { indexReflog } from '../ingest/reflog_indexer.js';
import { analyzeClones } from '../analysis/code_clone_analysis.js';
import { analyzeDebt } from '../analysis/technical_debt_analysis.js';
import { buildKnowledgeGraph } from '../graphs/knowledge_graph.js';
import type { IngestionItem } from '../ingest/types.js';
import { detectLibrarianVersion, upgradeRequired, runUpgrade } from './versioning.js';
import { resolveLibrarianModelConfigWithDiscovery } from './llm_env.js';
import { EmbeddingService } from './embeddings.js';
import { generateContextPacks } from './packs.js';
import { createKnowledgeGenerator } from '../knowledge/generator.js';
import { requireProviders } from './provider_check.js';
import { ensureDailyModelSelection } from '../adapters/model_policy.js';
import { queryLibrarian } from './query.js';
import { CodebaseCompositionAdvisor } from './codebase_advisor.js';
import { preloadMethodPacks } from '../methods/method_pack_service.js';
import { sanitizePath } from '../security/sanitization.js';
import type { MethodFamilyId } from '../methods/method_guidance.js';
import {
  extractFileKnowledge,
  extractDirectoryKnowledge,
  computeTotalFileCounts,
  assessFile,
  assessDirectory,
  type FileExtractionConfig,
  type FlashAssessment,
} from '../knowledge/extractors/index.js';
import {
  DEFAULT_GOVERNOR_CONFIG,
  writeGovernorBudgetReport,
  type GovernorBudgetOutcome,
  type GovernorConfig,
} from './governors.js';
import { GovernorContext, createGovernorRunState, type GovernorRunState } from './governor_context.js';
import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';
import {
  getAllIncludePatterns,
  UNIVERSAL_EXCLUDES,
  INCLUDE_PATTERNS,
  EXCLUDE_PATTERNS,
  getFileCategory,
  shouldGenerateEmbeddings,
} from '../universal_patterns.js';
import { buildTemporalGraph } from '../graphs/temporal_graph.js';
import { createIndexStateWriter, type IndexState, type IndexStateWriter } from '../state/index_state.js';
import { computeChecksum16 } from '../utils/checksums.js';
import {
  globalEventBus,
  createBootstrapStartedEvent,
  createBootstrapPhaseCompleteEvent,
  createBootstrapCompleteEvent,
  createBootstrapErrorEvent,
  createIngestionStartedEvent,
  createIngestionSourceCompletedEvent,
  createIngestionCompletedEvent,
  createEntityCreatedEvent,
  createEntityUpdatedEvent,
} from '../events.js';
import {
  runPreconditionGates,
  runPostconditionGates,
  hasFatalFailure,
  getFailureMessages,
  type ValidationGateContext,
  type ValidationGateResult,
} from '../preflight/index.js';

export interface BootstrapState {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'upgrade_required';
  currentPhase: BootstrapPhase | null;
  progress: number; // 0-1
  startedAt: Date | null;
  completedAt: Date | null;
  error?: string;
}

interface WorkspaceFingerprint {
  file_list_hash: string;
  file_count: number;
  latest_mtime: number;
  git_head?: string;
}

interface BootstrapPhaseProgress {
  total: number;
  completed: number;
  currentFile?: string;
}

interface BootstrapRecoveryState {
  kind: 'BootstrapRecoveryState.v1';
  schema_version: 1;
  workspace: string;
  version: string;
  phase_index: number;
  phase_name: string;
  total_phases: number;
  started_at: string;
  updated_at: string;
  workspace_fingerprint?: WorkspaceFingerprint;
  phase_progress?: BootstrapPhaseProgress;
  last_error?: string;
}

type IndexProgressCallback = (progress: { total: number; completed: number; currentFile?: string }) => void | Promise<void>;

// Global bootstrap state (per-workspace)
const bootstrapStates = new Map<string, BootstrapState>();

const GOVERNOR_CONFIG_FILENAME = 'governor.json';
const BOOTSTRAP_STATE_FILENAME = 'bootstrap_state.json';
const BOOTSTRAP_CHECKPOINT_FILE_INTERVAL = 100;
const BOOTSTRAP_CHECKPOINT_TIME_INTERVAL_MS = 5 * 60_000;
const METHOD_PACK_PRELOAD_FAMILIES: MethodFamilyId[] = [
  'MF-01',
  'MF-02',
  'MF-03',
  'MF-04',
  'MF-05',
  'MF-06',
  'MF-07',
  'MF-08',
  'MF-09',
  'MF-10',
  'MF-11',
  'MF-12',
  'MF-13',
  'MF-14',
];

function bootstrapStatePath(workspace: string): string {
  return path.join(workspace, '.librarian', BOOTSTRAP_STATE_FILENAME);
}

async function readBootstrapRecoveryState(workspace: string): Promise<BootstrapRecoveryState | null> {
  const statePath = bootstrapStatePath(workspace);
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = safeJsonParse<unknown>(raw);
    return parsed.ok && isBootstrapRecoveryState(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

async function writeBootstrapRecoveryState(workspace: string, state: BootstrapRecoveryState): Promise<void> {
  const statePath = bootstrapStatePath(workspace);
  const tempPath = `${statePath}.tmp.${process.pid}`;
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  try {
    // Atomic write: write to temp file first, then rename
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, statePath);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

async function clearBootstrapRecoveryState(workspace: string): Promise<void> {
  const statePath = bootstrapStatePath(workspace);
  try {
    await fs.unlink(statePath);
  } catch (error) {
    // ENOENT is expected if state file doesn't exist - don't log
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logWarning('Bootstrap: Failed to clear recovery state', {
        statePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function isBootstrapRecoveryState(value: unknown): value is BootstrapRecoveryState {
  if (!isRecord(value)) return false;
  if (value.kind !== 'BootstrapRecoveryState.v1' || value.schema_version !== 1) return false;
  if (value.workspace_fingerprint !== undefined && !isWorkspaceFingerprint(value.workspace_fingerprint)) {
    return false;
  }
  if (value.phase_progress !== undefined && !isBootstrapPhaseProgress(value.phase_progress)) {
    return false;
  }
  return (
    typeof value.workspace === 'string' &&
    typeof value.version === 'string' &&
    typeof value.phase_index === 'number' &&
    typeof value.phase_name === 'string' &&
    typeof value.total_phases === 'number' &&
    typeof value.started_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkspaceFingerprint(value: unknown): value is WorkspaceFingerprint {
  if (!isRecord(value)) return false;
  return (
    typeof value.file_list_hash === 'string' &&
    typeof value.file_count === 'number' &&
    typeof value.latest_mtime === 'number' &&
    (value.git_head === undefined || typeof value.git_head === 'string')
  );
}

function isBootstrapPhaseProgress(value: unknown): value is BootstrapPhaseProgress {
  if (!isRecord(value)) return false;
  return (
    typeof value.total === 'number' &&
    typeof value.completed === 'number' &&
    (value.currentFile === undefined || typeof value.currentFile === 'string')
  );
}

const FINGERPRINT_EXCLUDE_PATTERNS = ['**/.librarian/**', '**/.git/**'];

function buildFingerprintExcludes(exclude: string[]): string[] {
  const combined = [...exclude, ...FINGERPRINT_EXCLUDE_PATTERNS];
  return Array.from(new Set(combined));
}

async function computeWorkspaceFingerprint(options: {
  workspace: string;
  include: string[];
  exclude: string[];
}): Promise<WorkspaceFingerprint> {
  const files = await glob(options.include, {
    cwd: options.workspace,
    ignore: buildFingerprintExcludes(options.exclude),
    absolute: false,
    follow: false,
    nodir: true,
  });
  files.sort();
  const hasher = createHash('sha256');
  for (const file of files) {
    hasher.update(file);
    hasher.update('\n');
  }
  let latestMtime = 0;
  for (const file of files) {
    try {
      const stats = await fs.stat(path.join(options.workspace, file));
      if (stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
      }
    } catch {
      // Best-effort fingerprinting; missing files will be caught by hash changes.
    }
  }
  const gitHead = await resolveGitHead(options.workspace);
  return {
    file_list_hash: hasher.digest('hex'),
    file_count: files.length,
    latest_mtime: latestMtime,
    git_head: gitHead,
  };
}

function fingerprintsMatch(current: WorkspaceFingerprint, stored: WorkspaceFingerprint): boolean {
  if (current.file_list_hash !== stored.file_list_hash) return false;
  if (current.file_count !== stored.file_count) return false;
  if (current.latest_mtime !== stored.latest_mtime) return false;
  if (current.git_head || stored.git_head) {
    if (current.git_head !== stored.git_head) return false;
  }
  return true;
}

async function resolveGitHead(workspace: string): Promise<string | undefined> {
  const gitDir = await resolveGitDir(workspace);
  if (!gitDir) return undefined;
  try {
    const headPath = path.join(gitDir, 'HEAD');
    const head = (await fs.readFile(headPath, 'utf8')).trim();
    if (!head) return undefined;
    if (!head.startsWith('ref:')) return head;
    const refPath = head.slice('ref:'.length).trim();
    if (!refPath) return undefined;
    const ref = (await fs.readFile(path.join(gitDir, refPath), 'utf8')).trim();
    return ref || undefined;
  } catch {
    return undefined;
  }
}

async function resolveGitDir(workspace: string): Promise<string | null> {
  let current = workspace;
  while (true) {
    const candidate = path.join(current, '.git');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
      if (stat.isFile()) {
        const content = await fs.readFile(candidate, 'utf8');
        const match = content.match(/gitdir:\s*(.+)/i);
        if (match) {
          return path.resolve(current, match[1].trim());
        }
      }
    } catch {
      // Continue searching parent directories.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

type BootstrapCheckpointSnapshot = {
  phaseIndex: number;
  phaseName: string;
  progress: BootstrapPhaseProgress;
};

type BootstrapCheckpointWriter = {
  update: (update: { phaseIndex: number; phaseName: string; progress: BootstrapPhaseProgress }) => Promise<void>;
  flush: () => Promise<void>;
  getSnapshot: () => BootstrapCheckpointSnapshot | null;
};

function normalizeCheckpointInterval(value: number | undefined, fallback: number): number {
  if (value === 0) return Number.POSITIVE_INFINITY;
  if (!value || value < 0 || !Number.isFinite(value)) return fallback;
  return value;
}

function createBootstrapCheckpointWriter(options: {
  workspace: string;
  version: string;
  totalPhases: number;
  startedAt: string;
  workspaceFingerprint?: WorkspaceFingerprint;
  fileInterval?: number;
  timeIntervalMs?: number;
}): BootstrapCheckpointWriter {
  let lastCheckpointAt = 0;
  let lastCheckpointCompleted = 0;
  let snapshot: BootstrapCheckpointSnapshot | null = null;
  let lastPhaseIndex = -1;
  let lastPhaseName = '';
  const fileInterval = normalizeCheckpointInterval(
    options.fileInterval,
    BOOTSTRAP_CHECKPOINT_FILE_INTERVAL
  );
  const timeIntervalMs = normalizeCheckpointInterval(
    options.timeIntervalMs,
    BOOTSTRAP_CHECKPOINT_TIME_INTERVAL_MS
  );

  const writeCheckpoint = async (): Promise<void> => {
    if (!snapshot) return;
    await writeBootstrapRecoveryState(options.workspace, {
      kind: 'BootstrapRecoveryState.v1',
      schema_version: 1,
      workspace: options.workspace,
      version: options.version,
      phase_index: snapshot.phaseIndex,
      phase_name: snapshot.phaseName,
      total_phases: options.totalPhases,
      started_at: options.startedAt,
      updated_at: new Date().toISOString(),
      workspace_fingerprint: options.workspaceFingerprint,
      phase_progress: snapshot.progress,
    });
  };

  const update = async (updateInput: { phaseIndex: number; phaseName: string; progress: BootstrapPhaseProgress }): Promise<void> => {
    snapshot = {
      phaseIndex: updateInput.phaseIndex,
      phaseName: updateInput.phaseName,
      progress: {
        total: updateInput.progress.total,
        completed: updateInput.progress.completed,
        currentFile: updateInput.progress.currentFile,
      },
    };
    if (updateInput.phaseIndex !== lastPhaseIndex || updateInput.phaseName !== lastPhaseName) {
      lastPhaseIndex = updateInput.phaseIndex;
      lastPhaseName = updateInput.phaseName;
      lastCheckpointAt = 0;
      lastCheckpointCompleted = 0;
    }
    const now = Date.now();
    const shouldCheckpointByCount = snapshot.progress.completed - lastCheckpointCompleted >= fileInterval;
    const shouldCheckpointByTime = now - lastCheckpointAt >= timeIntervalMs;
    if (!shouldCheckpointByCount && !shouldCheckpointByTime) {
      return;
    }
    lastCheckpointAt = now;
    lastCheckpointCompleted = snapshot.progress.completed;
    await writeCheckpoint();
  };

  return {
    update,
    flush: async () => {
      await writeCheckpoint();
    },
    getSnapshot: () => snapshot,
  };
}

/**
 * Loads the governor configuration from the workspace's .librarian directory.
 *
 * If no configuration file exists, returns the default governor config.
 * If maxConcurrentWorkers is set to 0 (auto mode), automatically detects
 * the optimal concurrency based on system resources (CPU cores, memory, load).
 *
 * @param workspace - Absolute path to the workspace root directory
 * @returns The loaded or default governor configuration
 * @throws Error if the configuration file exists but is invalid JSON
 */
export async function loadGovernorConfig(workspace: string): Promise<GovernorConfig> {
  // Blocked patterns for path validation
  // Note: System paths use 'i' flag for case-insensitive matching (macOS/Windows filesystems)
  const blockedPatterns = [
    /\.\./,                    // Directory traversal
    /^\/etc(?:\/|$)/i,         // System config (at path start only, case-insensitive)
    /^\/private\/etc(?:\/|$)/i, // macOS realpath for /etc
    /^\/proc(?:\/|$)/i,        // Process info (at path start only, case-insensitive)
    /^\/private\/proc(?:\/|$)/i, // macOS realpath for /proc (defensive)
    /^\/sys(?:\/|$)/i,         // System info (at path start only, case-insensitive)
    /^\/private\/sys(?:\/|$)/i, // macOS realpath for /sys (defensive)
    /\$\{/,                    // Variable expansion
    /\$\(/,                    // Command substitution
    /`/,                       // Backtick execution
    /\x00/,                    // Null byte injection
  ];

  // 1. Require absolute path
  if (!path.isAbsolute(workspace)) {
    throw new Error(`unverified_by_trace(invalid_workspace_path): Workspace must be an absolute path`);
  }

  // 2. Validate raw input BEFORE any resolution (catches traversal attempts)
  const rawPathResult = sanitizePath(workspace, {
    allowAbsolute: true,
    blockedPatterns,
  });

  if (!rawPathResult.valid) {
    const errorMessages = rawPathResult.errors.map(e => e.message).join('; ');
    throw new Error(`unverified_by_trace(invalid_workspace_path): ${errorMessages}`);
  }

  let symlinkTarget: string | null = null;
  try {
    const stat = await fs.lstat(workspace);
    if (stat.isSymbolicLink()) {
      const linkValue = await fs.readlink(workspace);
      symlinkTarget = path.isAbsolute(linkValue)
        ? linkValue
        : path.resolve(path.dirname(workspace), linkValue);
    }
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT')) {
      throw new Error(`unverified_by_trace(invalid_workspace_path): Cannot stat workspace path`);
    }
  }

  // 3. Resolve symlinks to get canonical path (prevents symlink attacks)
  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = await fs.realpath(workspace);
  } catch (err: unknown) {
    // For non-existent paths, only allow if the parent directory exists
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT') {
      // Verify parent directory exists (prevents creating paths in blocked directories)
      const targetPath = symlinkTarget ?? workspace;
      const parentDir = path.dirname(targetPath);
      try {
        await fs.access(parentDir);
      } catch {
        throw new Error(`unverified_by_trace(invalid_workspace_path): Parent directory does not exist`);
      }
      // Use path.resolve but re-validate to ensure normalization didn't create dangerous paths
      canonicalWorkspace = path.resolve(targetPath);
    } else {
      throw new Error(`unverified_by_trace(invalid_workspace_path): Cannot resolve workspace path`);
    }
  }

  // 4. Validate canonical path (catches symlinks pointing to dangerous locations)
  const canonicalResult = sanitizePath(canonicalWorkspace, {
    allowAbsolute: true,
    blockedPatterns,
  });

  if (!canonicalResult.valid || !canonicalResult.value) {
    const errorMessages = canonicalResult.errors.map(e => e.message).join('; ');
    throw new Error(`unverified_by_trace(invalid_workspace_path): ${errorMessages}`);
  }

  const safeWorkspace = canonicalResult.value;
  const configPath = path.join(safeWorkspace, '.librarian', GOVERNOR_CONFIG_FILENAME);
  let baseConfig: GovernorConfig;

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (!parsed.ok) {
      const message = getResultErrorMessage(parsed);
      throw new Error(message || 'invalid JSON');
    }
    baseConfig = coerceGovernorConfig(parsed.value);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      baseConfig = { ...DEFAULT_GOVERNOR_CONFIG };
    } else {
      const message = getErrorMessage(error);
      throw new Error(`unverified_by_trace(governor_config_invalid): ${message}`);
    }
  }

  // Auto-detect optimal concurrency ONLY if explicitly set to 'auto' (0)
  // If user provides any non-zero value (including the default), respect their choice
  if (baseConfig.maxConcurrentWorkers === 0) {
    try {
      const { autoDetectGovernorConfig, detectSystemResources } = await import('./governors.js');
      const { config, recommendation } = await autoDetectGovernorConfig(safeWorkspace);

      if (config.maxConcurrentWorkers) {
        baseConfig.maxConcurrentWorkers = config.maxConcurrentWorkers;

        // Log the auto-detection reasoning
        const resources = detectSystemResources();
        console.log(`\n📊 Auto-detected concurrency: ${config.maxConcurrentWorkers} workers`);
        console.log(`   System: ${resources.cpuCores} CPUs, ${resources.freeMemoryGB.toFixed(1)}GB free RAM, load ${resources.loadAverage.toFixed(2)}`);
        for (const reason of recommendation.reasoning.slice(0, 3)) {
          console.log(`   → ${reason}`);
        }
        for (const constraint of recommendation.constraints) {
          console.log(`   ⚠ ${constraint}`);
        }
        console.log('');
      }
    } catch (error) {
      // Log auto-detection failure - user explicitly requested auto mode (0), should know why it failed
      console.warn(`[librarian] Auto-detection failed, using default concurrency: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to DEFAULT_GOVERNOR_CONFIG.maxConcurrentWorkers
      baseConfig.maxConcurrentWorkers = DEFAULT_GOVERNOR_CONFIG.maxConcurrentWorkers;
    }
  }

  return baseConfig;
}

function coerceGovernorConfig(source: Record<string, unknown> | null): GovernorConfig {
  if (!source || typeof source !== 'object') {
    throw new Error('Governor config must be an object');
  }
  return {
    maxTokensPerFile: readNumericLimit(source, 'maxTokensPerFile', DEFAULT_GOVERNOR_CONFIG.maxTokensPerFile, true),
    maxTokensPerPhase: readNumericLimit(source, 'maxTokensPerPhase', DEFAULT_GOVERNOR_CONFIG.maxTokensPerPhase, true),
    maxTokensPerRun: readNumericLimit(source, 'maxTokensPerRun', DEFAULT_GOVERNOR_CONFIG.maxTokensPerRun, true),
    maxFilesPerPhase: readNumericLimit(source, 'maxFilesPerPhase', DEFAULT_GOVERNOR_CONFIG.maxFilesPerPhase, true),
    maxWallTimeMs: readNumericLimit(source, 'maxWallTimeMs', DEFAULT_GOVERNOR_CONFIG.maxWallTimeMs, true),
    maxRetries: readNumericLimit(source, 'maxRetries', DEFAULT_GOVERNOR_CONFIG.maxRetries, true),
    maxConcurrentWorkers: readNumericLimit(
      source,
      'maxConcurrentWorkers',
      DEFAULT_GOVERNOR_CONFIG.maxConcurrentWorkers,
      true
    ),
    maxEmbeddingsPerBatch: readNumericLimit(
      source,
      'maxEmbeddingsPerBatch',
      DEFAULT_GOVERNOR_CONFIG.maxEmbeddingsPerBatch,
      false
    ),
    resourceManagement: coerceResourceManagement(source.resourceManagement),
  };
}

function coerceResourceManagement(source: unknown): GovernorConfig['resourceManagement'] {
  if (!source || typeof source !== 'object') {
    return DEFAULT_GOVERNOR_CONFIG.resourceManagement;
  }
  const s = source as Record<string, unknown>;
  const defaults = DEFAULT_GOVERNOR_CONFIG.resourceManagement!;
  return {
    mode: (s.mode === 'auto' || s.mode === 'manual' || s.mode === 'conservative' || s.mode === 'aggressive')
      ? s.mode : defaults.mode,
    targetMemoryUtilization: typeof s.targetMemoryUtilization === 'number' ? s.targetMemoryUtilization : defaults.targetMemoryUtilization,
    targetCpuUtilization: typeof s.targetCpuUtilization === 'number' ? s.targetCpuUtilization : defaults.targetCpuUtilization,
    minReservedMemoryPercent: typeof s.minReservedMemoryPercent === 'number' ? s.minReservedMemoryPercent : defaults.minReservedMemoryPercent,
    minReservedCpuCores: typeof s.minReservedCpuCores === 'number' ? s.minReservedCpuCores : defaults.minReservedCpuCores,
    monitorIntervalMs: typeof s.monitorIntervalMs === 'number' ? s.monitorIntervalMs : defaults.monitorIntervalMs,
    oomKillThreshold: typeof s.oomKillThreshold === 'number' ? s.oomKillThreshold : defaults.oomKillThreshold,
  };
}

function readNumericLimit(
  source: Record<string, unknown>,
  key: keyof GovernorConfig,
  fallback: number,
  allowZero: boolean
): number {
  const value = source[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Governor config ${String(key)} must be a finite number`);
  }
  if (value < 0 || (!allowZero && value <= 0)) {
    throw new Error(`Governor config ${String(key)} must be ${allowZero ? '>= 0' : '> 0'}`);
  }
  return value;
}

// PUBLIC API

/**
 * Checks whether bootstrap is required for the given workspace.
 *
 * Bootstrap is required when:
 * - No existing librarian data is found
 * - A previous bootstrap was interrupted and needs recovery
 * - The existing version requires an upgrade to reach the target quality tier
 * - The index appears empty or corrupted
 *
 * @param workspace - Absolute path to the workspace root directory
 * @param storage - The storage backend to check
 * @param options - Optional configuration
 * @param options.targetQualityTier - Target quality tier ('mvp' or 'full'), defaults to 'mvp'
 * @returns Object with `required` boolean and `reason` string explaining the decision
 *
 * @example
 * ```typescript
 * const { required, reason } = await isBootstrapRequired(workspace, storage);
 * if (required) {
 *   console.log(`Bootstrap needed: ${reason}`);
 * }
 * ```
 */
export async function isBootstrapRequired(
  workspace: string,
  storage: LibrarianStorage,
  options?: { targetQualityTier?: LibrarianVersion['qualityTier'] }
): Promise<{ required: boolean; reason: string }> {
  const recovery = await readBootstrapRecoveryState(workspace);
  if (recovery) {
    return {
      required: true,
      reason: `Previous bootstrap incomplete (last recorded phase: ${recovery.phase_name}). Resume with \`librarian bootstrap\` or restart with \`librarian bootstrap --force\`.`,
    };
  }
  const existingVersion = await detectLibrarianVersion(storage);
  const targetQualityTier = options?.targetQualityTier ?? 'mvp';
  const targetVersion = getTargetVersion(targetQualityTier);

  if (!existingVersion) {
    return {
      required: true,
      reason: 'No existing librarian data found - fresh bootstrap required',
    };
  }

  // Check if upgrade is needed
  const upgrade = await upgradeRequired(existingVersion, targetVersion);

  if (upgrade.required) {
    return {
      required: true,
      reason: upgrade.reason,
    };
  }

  const [metadata, stats] = await Promise.all([
    storage.getMetadata().catch(() => null),
    storage.getStats().catch(() => null),
  ]);
  if (metadata && (metadata as { lastIndexing?: unknown }).lastIndexing === null) {
    return { required: true, reason: 'Indexing incomplete - previous bootstrap likely interrupted' };
  }
  if (stats && stats.totalFunctions === 0 && stats.totalModules === 0 && stats.totalContextPacks === 0 && stats.totalEmbeddings === 0) {
    return { required: true, reason: 'Index appears empty - previous bootstrap likely interrupted' };
  }

  const lastBootstrap = await storage.getLastBootstrapReport();
  if (!lastBootstrap || !lastBootstrap.success) {
    return {
      required: true,
      reason: 'Previous bootstrap did not complete successfully',
    };
  }

  return {
    required: false,
    reason: 'Librarian data is up-to-date',
  };
}

/**
 * Get current bootstrap status for a workspace.
 */
export function getBootstrapStatus(workspace: string): BootstrapState {
  return (
    bootstrapStates.get(workspace) || {
      status: 'not_started',
      currentPhase: null,
      progress: 0,
      startedAt: null,
      completedAt: null,
    }
  );
}

/**
 * Bootstraps the librarian index for a workspace.
 *
 * This is the main entry point for initializing the librarian knowledge base.
 * It scans the workspace, extracts code knowledge (functions, modules, dependencies),
 * generates embeddings for semantic search, and creates context packs.
 *
 * **CRITICAL**: This function BLOCKS until completion. No agent work should
 * proceed until this returns successfully. Use `ensureLibrarianReady` for
 * a higher-level API that handles bootstrap checks automatically.
 *
 * Bootstrap phases:
 * 1. Provider verification (LLM and embedding providers)
 * 2. File discovery and filtering
 * 3. AST parsing and knowledge extraction
 * 4. Embedding generation
 * 5. Context pack creation
 * 6. Graph construction and analysis
 *
 * @param config - Bootstrap configuration created via `createBootstrapConfig`
 * @param storage - Initialized storage backend (typically SQLite)
 * @returns A report containing success status, phases completed, and statistics
 * @throws Error if providers are unavailable or critical phases fail
 *
 * @example
 * ```typescript
 * const config = createBootstrapConfig('/path/to/workspace', { mode: 'full' });
 * const storage = createSqliteStorage('./librarian.db');
 * await storage.initialize();
 *
 * const report = await bootstrapProject(config, storage);
 * if (report.success) {
 *   console.log(`Indexed ${report.totalFilesProcessed} files`);
 * }
 * ```
 */
export async function bootstrapProject(
  config: BootstrapConfig,
  storage: LibrarianStorage
): Promise<BootstrapReport> {
  const { workspace } = config;
  const workspaceRoot = path.resolve(workspace);
  // Skip probe if caller already verified providers (avoids slow/flaky CLI test)
  const forceProbe = config.skipProviderProbe !== true;
  await requireProviders({ llm: true, embedding: true }, { workspaceRoot, forceProbe });
  const defaultProvider = config.llmProvider === 'codex' ? 'codex' : 'claude';
  await ensureDailyModelSelection(workspaceRoot, {
    defaultProvider,
    applyEnv: true,
    respectExistingEnv: true,
  });
  const baseGovernorConfig = await loadGovernorConfig(workspace);
  const normalizeTimeout = (value?: number): number => (value && value > 0 ? value : 0);
  const timeoutMs = normalizeTimeout(config.timeoutMs);
  const governorTimeoutMs = normalizeTimeout(baseGovernorConfig.maxWallTimeMs);
  // No timeouts by default; when both are set, respect the lower bound.
  const maxWallTimeMs =
    governorTimeoutMs > 0 && timeoutMs > 0
      ? Math.min(governorTimeoutMs, timeoutMs)
      : governorTimeoutMs > 0
        ? governorTimeoutMs
        : timeoutMs;
  const governorConfig = {
    ...baseGovernorConfig,
    maxWallTimeMs,
  };
  const governorRunState = createGovernorRunState();

  // Initialize state
  const state: BootstrapState = {
    status: 'in_progress',
    currentPhase: null,
    progress: 0,
    startedAt: new Date(),
    completedAt: null,
  };
  bootstrapStates.set(workspace, state);

  // Emit bootstrap:start event
  void globalEventBus.emit(createBootstrapStartedEvent(workspace));

  const report: BootstrapReport = {
    workspace,
    startedAt: state.startedAt!,
    completedAt: null,
    phases: [],
    totalFilesProcessed: 0,
    totalFunctionsIndexed: 0,
    totalContextPacksCreated: 0,
    version: getTargetVersion(config.bootstrapMode === 'full' ? 'full' : 'mvp'),
    success: false,
  };
  let indexStateWriter: IndexStateWriter | null = null;
  const writeIndexState = async (next: IndexState, options: { force?: boolean } = {}): Promise<void> => {
    if (indexStateWriter) {
      await indexStateWriter.write(next, options);
    }
  };
  const totalPhases = BOOTSTRAP_PHASES.length;
  const currentVersionString = report.version.string;
  let recovery = Boolean(config.forceReindex) ? null : await readBootstrapRecoveryState(workspace);
  if (config.forceReindex) {
    await clearBootstrapRecoveryState(workspace);
  }
  const currentFingerprint = await computeWorkspaceFingerprint({
    workspace,
    include: config.include,
    exclude: config.exclude,
  });
  const storedFingerprint = recovery?.workspace_fingerprint;
  const fingerprintMatches = storedFingerprint
    ? fingerprintsMatch(currentFingerprint, storedFingerprint)
    : false;
  if (recovery && (!storedFingerprint || !fingerprintMatches)) {
    if (!config.forceResume) {
      const detail = storedFingerprint
        ? 'Workspace changed since last bootstrap.'
        : 'Recovery state missing workspace fingerprint.';
      throw new Error(
        `unverified_by_trace(bootstrap_recovery_stale): ${detail}\n` +
        'Please run a fresh bootstrap or use --force-resume to continue anyway.'
      );
    }
    logWarning('Bootstrap: workspace fingerprint mismatch; resuming due to forceResume', {
      workspace,
      phase: recovery.phase_name,
    });
  }
  const effectiveFingerprint = storedFingerprint && fingerprintMatches
    ? storedFingerprint
    : currentFingerprint;
  const recoveryValid = Boolean(
    recovery &&
      recovery.workspace === workspace &&
      recovery.version === currentVersionString &&
      recovery.total_phases === totalPhases &&
      recovery.phase_index >= 0 &&
      recovery.phase_index <= totalPhases &&
      (config.forceResume || fingerprintMatches),
  );
  if (recovery && !recoveryValid) {
    await clearBootstrapRecoveryState(workspace);
  }
  const startPhaseIndex = recoveryValid ? (recovery?.phase_index ?? 0) : 0;
  const recoveryStartedAt = recovery?.started_at ?? state.startedAt?.toISOString() ?? new Date().toISOString();
  const checkpointWriter = createBootstrapCheckpointWriter({
    workspace,
    version: currentVersionString,
    totalPhases,
    startedAt: recoveryStartedAt,
    workspaceFingerprint: effectiveFingerprint,
  });

  try {
    // Check if upgrade is needed first
    const existingVersion = await detectLibrarianVersion(storage);
    if (existingVersion) {
      const upgrade = await upgradeRequired(existingVersion, report.version);
      if (upgrade.required) {
        state.status = 'upgrade_required';
        config.progressCallback?.(BOOTSTRAP_PHASES[0], 0);

        // Run upgrade
        const upgradeReport = await runUpgrade(storage, existingVersion, report.version);
        if (!upgradeReport.success) {
          throw new Error(`Upgrade failed: ${upgradeReport.error}`);
        }
      }
    }

    // Initialize storage
    await storage.initialize();

    indexStateWriter = createIndexStateWriter(storage);
    await writeIndexState({ phase: 'discovering' }, { force: true });

    // Run each bootstrap phase
    for (let phaseIndex = startPhaseIndex; phaseIndex < totalPhases; phaseIndex += 1) {
      const phase = BOOTSTRAP_PHASES[phaseIndex]!;
      state.currentPhase = phase;
      state.progress = phaseIndex / totalPhases;
      config.progressCallback?.(phase, state.progress);
      await writeBootstrapRecoveryState(workspace, {
        kind: 'BootstrapRecoveryState.v1',
        schema_version: 1,
        workspace,
        version: currentVersionString,
        phase_index: phaseIndex,
        phase_name: phase.name,
        total_phases: totalPhases,
        started_at: recoveryStartedAt,
        updated_at: new Date().toISOString(),
        workspace_fingerprint: effectiveFingerprint,
      });

      const phaseResult = await runBootstrapPhase(
        phase,
        config,
        storage,
        report,
        governorConfig,
        governorRunState,
        writeIndexState,
        phaseIndex,
        checkpointWriter
      );
      report.phases.push(phaseResult);

      // FAIL-FAST: If phase had fatal precondition or postcondition failures, abort bootstrap
      // Per AGENTS.md: Silent failures are unacceptable - fail loudly when things go wrong
      const hasFatalPrecondition = (phaseResult.metrics?.preconditionsFailed ?? 0) > 0;
      const hasFatalPostcondition = (phaseResult.metrics?.postconditionsFailed ?? 0) > 0;
      if (hasFatalPrecondition || hasFatalPostcondition) {
        const fatalErrors = phaseResult.errors.filter(
          (e) => e.includes('[PRECONDITION FATAL]') || e.includes('[POSTCONDITION FATAL]')
        );
        const errorSummary = fatalErrors.length > 0 ? fatalErrors.join('; ') : 'Unknown fatal error';
        const supplementalErrors = phaseResult.errors.filter(
          (e) => !e.includes('[PRECONDITION FATAL]') && !e.includes('[POSTCONDITION FATAL]')
        );
        const supplementalSummary = supplementalErrors.length > 0
          ? ` Additional errors: ${supplementalErrors.slice(0, 3).join('; ')}`
          : '';
        throw new Error(
          `unverified_by_trace(phase_fatal_failure): Bootstrap phase '${phase.name}' had fatal validation failures. ` +
            `${errorSummary}.${supplementalSummary} Bootstrap cannot continue with invalid state.`
        );
      }

      // Emit bootstrap:phase event
      void globalEventBus.emit(createBootstrapPhaseCompleteEvent(
        workspace,
        phase.name,
        phaseResult.durationMs,
        phaseResult.itemsProcessed
      ));
      const nextPhase = BOOTSTRAP_PHASES[phaseIndex + 1]?.name ?? 'complete';
      await writeBootstrapRecoveryState(workspace, {
        kind: 'BootstrapRecoveryState.v1',
        schema_version: 1,
        workspace,
        version: currentVersionString,
        phase_index: phaseIndex + 1,
        phase_name: nextPhase,
        total_phases: totalPhases,
        started_at: recoveryStartedAt,
        updated_at: new Date().toISOString(),
        workspace_fingerprint: effectiveFingerprint,
      });
    }

    if (config.bootstrapMode === 'full') {
      await preloadMethodPacksForBootstrap(config, storage, governorConfig, governorRunState);
    }

    // Mark version in storage
    await storage.setVersion(report.version);

    // Compute capabilities and generate summary
    const capabilitiesResult = await computeBootstrapCapabilities(storage, report);
    report.capabilities = capabilitiesResult.capabilities;
    report.warnings = capabilitiesResult.warnings;
    report.statusSummary = capabilitiesResult.statusSummary;
    report.nextSteps = capabilitiesResult.nextSteps;

    const suggestionResult = await computeCompositionSuggestions(
      storage,
      config,
      governorConfig,
      governorRunState,
      report.capabilities
    );
    if (suggestionResult.suggestions.length > 0) {
      report.compositionSuggestions = suggestionResult.suggestions;
    }
    if (suggestionResult.warnings.length > 0) {
      report.warnings.push(...suggestionResult.warnings);
    }

    // Record successful bootstrap
    report.completedAt = new Date();
    report.success = true;
    await storage.recordBootstrapReport(report);
    if (config.llmProvider && config.llmModelId) {
      await storage.setState('librarian.llm_defaults.v1', JSON.stringify({ schema_version: 1, kind: 'LibrarianLlmDefaults.v1', provider: config.llmProvider, modelId: config.llmModelId, bootstrapMode: config.bootstrapMode ?? 'fast', updatedAt: report.completedAt.toISOString() }));
    }

    // Update metadata (especially important for resumed bootstraps that skip structural_scan).
    await upsertMetadataForSuccessfulBootstrap(storage, workspace, report);

    // Update state
    state.status = 'completed';
    state.progress = 1;
    state.completedAt = report.completedAt;
    bootstrapStates.set(workspace, state);
    await clearBootstrapRecoveryState(workspace);

    // Emit bootstrap:complete event
    const totalDurationMs = report.completedAt!.getTime() - report.startedAt.getTime();
    void globalEventBus.emit(createBootstrapCompleteEvent(workspace, true, totalDurationMs));
    if (report.completedAt) {
      await writeIndexState(
        {
          phase: 'ready',
          lastFullIndex: report.completedAt.toISOString(),
          progress: report.totalFilesProcessed > 0
            ? { total: report.totalFilesProcessed, completed: report.totalFilesProcessed }
            : undefined,
        },
        { force: true }
      );
    }
    await indexStateWriter?.flush();

    // Update repo documentation with librarian usage info
    try {
      const docsResult = await updateRepoDocs({
        workspace,
        report,
        capabilities: report.capabilities,
        skipIfExists: false, // Update if content is stale
      });
      if (docsResult.filesUpdated.length > 0) {
        report.warnings.push(`Librarian docs updated: ${docsResult.filesUpdated.join(', ')}`);
      }
      if (docsResult.errors.length > 0) {
        report.warnings.push(`Docs update errors: ${docsResult.errors.join('; ')}`);
      }
    } catch (docsError) {
      // Non-fatal - log but don't fail bootstrap
      report.warnings.push(`Failed to update repo docs: ${getErrorMessage(docsError)}`);
    }

    return report;
  } catch (error: unknown) {
    // Record failed bootstrap
    report.completedAt = new Date();
    report.success = false;
    report.error = getErrorMessage(error);

    try {
      await storage.recordBootstrapReport(report);
    } catch {
      // Ignore storage errors during failure recording
    }

    // Update state
    state.status = 'failed';
    state.error = report.error;
    state.completedAt = report.completedAt;
    bootstrapStates.set(workspace, state);

    // Emit bootstrap:error event
    const failedDurationMs = report.completedAt.getTime() - report.startedAt.getTime();
    void globalEventBus.emit(createBootstrapErrorEvent(workspace, report.error, state.currentPhase?.name));
    void globalEventBus.emit(createBootstrapCompleteEvent(workspace, false, failedDurationMs, report.error));
    const phaseIndex = state.currentPhase ? BOOTSTRAP_PHASES.indexOf(state.currentPhase) : startPhaseIndex;
    const phaseName = state.currentPhase?.name ?? 'unknown';
    const checkpointSnapshot = checkpointWriter.getSnapshot();
    const phaseProgress = checkpointSnapshot && checkpointSnapshot.phaseIndex === phaseIndex
      ? checkpointSnapshot.progress
      : undefined;
    try {
      await writeBootstrapRecoveryState(workspace, {
        kind: 'BootstrapRecoveryState.v1',
        schema_version: 1,
        workspace,
        version: currentVersionString,
        phase_index: Math.max(0, phaseIndex),
        phase_name: phaseName,
        total_phases: totalPhases,
        started_at: recoveryStartedAt,
        updated_at: new Date().toISOString(),
        workspace_fingerprint: effectiveFingerprint,
        phase_progress: phaseProgress,
        last_error: report.error,
      });
    } catch {
      // Keep original error as the primary failure signal.
    }

    try {
      await writeIndexState({ phase: 'uninitialized' }, { force: true });
      await indexStateWriter?.flush();
    } catch {
      // Ignore index state errors during failure handling.
    }

    throw error;
  }
}

async function upsertMetadataForSuccessfulBootstrap(
  storage: LibrarianStorage,
  workspace: string,
  report: BootstrapReport
): Promise<void> {
  try {
    const completedAt = report.completedAt ?? new Date();
    const [existingMetadata, stats, files] = await Promise.all([
      storage.getMetadata(),
      storage.getStats(),
      storage.getFiles({}),
    ]);

	const nextMetadata: LibrarianMetadata = {
	  version: report.version,
	  workspace,
	  lastBootstrap: completedAt,
	  lastIndexing: completedAt,
	  totalFiles: existingMetadata?.totalFiles ?? files.length,
	  totalFunctions: stats.totalFunctions,
	  totalContextPacks: stats.totalContextPacks,
	  qualityTier: report.version.qualityTier,
	};

    await storage.setMetadata(nextMetadata);
    await storage.setState('pendingChanges', '0');
  } catch {
    // Metadata should not block successful bootstrap completion.
  }
}

async function preloadMethodPacksForBootstrap(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governorConfig: GovernorConfig,
  governorRunState: ReturnType<typeof createGovernorRunState>
): Promise<void> {
  await requireProviders({ llm: true, embedding: false });
  const resolved = await resolveLibrarianModelConfigWithDiscovery();
  const llmProvider = config.llmProvider ?? resolved.provider;
  const llmModelId = config.llmModelId ?? resolved.modelId;
  if (!llmProvider || !llmModelId) {
    throw new Error('unverified_by_trace(provider_unavailable): method pack preload requires LLM provider and model');
  }
  const governor = new GovernorContext({
    phase: 'method_pack_preload',
    config: governorConfig,
    runState: governorRunState,
  });
  governor.checkBudget();
  await preloadMethodPacks({
    storage,
    families: METHOD_PACK_PRELOAD_FAMILIES,
    llmProvider,
    llmModelId,
    governorContext: governor,
  });
}

// PHASE RUNNERS

async function runBootstrapPhase(
  phase: BootstrapPhase,
  config: BootstrapConfig,
  storage: LibrarianStorage,
  report: BootstrapReport,
  governorConfig: typeof DEFAULT_GOVERNOR_CONFIG,
  governorRunState: ReturnType<typeof createGovernorRunState>,
  writeIndexState: ((state: IndexState, options?: { force?: boolean }) => Promise<void>) | undefined,
  phaseIndex: number,
  checkpointWriter: BootstrapCheckpointWriter
): Promise<BootstrapPhaseResult> {
  const startedAt = new Date();
  const errors: string[] = [];
  let itemsProcessed = 0;
  let metrics: BootstrapPhaseMetrics | undefined;
  let outcome: GovernorBudgetOutcome = { status: 'success' };
  const governor = new GovernorContext({
    phase: phase.name,
    config: governorConfig,
    runState: governorRunState,
  });

  // Create validation gate context
  const gateContext: ValidationGateContext = {
    workspace: config.workspace,
    storage,
    config,
  };

  // Run precondition gates
  const preconditionResults = await runPreconditionGates(phase.name as BootstrapPhaseName, gateContext);
  if (hasFatalFailure(preconditionResults)) {
    const messages = getFailureMessages(preconditionResults);
    errors.push(...messages);
    return {
      phase,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      itemsProcessed: 0,
      errors,
      metrics: {
        totalItems: 0,
        preconditionsFailed: messages.length,
      },
    };
  }

  // Collect non-fatal precondition warnings
  for (const result of preconditionResults) {
    if (!result.passed && !result.fatal) {
      errors.push(`[PRECONDITION WARNING] ${result.message}`);
    }
  }

  try {
    governor.checkBudget();
    switch (phase.name) {
      case 'structural_scan': {
        const scanResult = await runStructuralScan(config, storage, governor);
        itemsProcessed = scanResult.itemsProcessed;
        errors.push(...scanResult.errors);
        metrics = scanResult.metrics;
        if (writeIndexState) {
          const progress = scanResult.totalFiles > 0
            ? { total: scanResult.totalFiles, completed: 0 }
            : undefined;
          await writeIndexState({ phase: 'discovering', progress });
        }
        break;
      }

      case 'semantic_indexing': {
        const startedAtMs = Date.now();
        const onProgress: IndexProgressCallback = async (progress) => {
          await checkpointWriter.update({
            phaseIndex,
            phaseName: phase.name,
            progress: {
              total: progress.total,
              completed: progress.completed,
              currentFile: progress.currentFile,
            },
          });
          if (!writeIndexState) return;
          const estimatedCompletion = estimateCompletion(startedAtMs, progress);
          await writeIndexState({
            phase: 'indexing',
            progress,
            estimatedCompletion,
          });
        };
        const indexResult = await runSemanticIndexing(config, storage, governor, { onProgress });
        itemsProcessed = indexResult.files;
        errors.push(...indexResult.errors);
        report.totalFilesProcessed = indexResult.files;
        report.totalFunctionsIndexed = (await storage.getStats()).totalFunctions;
        metrics = {
          totalFiles: indexResult.totalFiles,
          filesIndexed: indexResult.files,
          functionsIndexed: indexResult.functions,
          totalItems: indexResult.files,
        };
        if (writeIndexState && indexResult.totalFiles > 0) {
          await writeIndexState({
            phase: 'indexing',
            progress: { total: indexResult.totalFiles, completed: indexResult.files },
            estimatedCompletion: estimateCompletion(startedAtMs, { total: indexResult.totalFiles, completed: indexResult.files }),
          });
        }
        break;
      }

      case 'relationship_mapping': {
        if (writeIndexState) {
          await writeIndexState({ phase: 'computing_graph' });
        }
        itemsProcessed = await runRelationshipMapping(config, storage, governor);
        break;
      }

      case 'context_pack_generation': {
        if (writeIndexState) {
          await writeIndexState({ phase: 'computing_graph' });
        }
        itemsProcessed = await runContextPackGeneration(config, storage, governor);
        report.totalContextPacksCreated = itemsProcessed;
        metrics = {
          contextPacksCreated: itemsProcessed,
          totalItems: itemsProcessed,
        };
        break;
      }

      case 'knowledge_generation': {
        if (writeIndexState) {
          await writeIndexState({ phase: 'generating_knowledge' });
        }
        itemsProcessed = await runKnowledgeGeneration(config, storage, governor);
        break;
      }

      default:
        errors.push(`Unknown phase: ${phase.name}`);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    errors.push(message);
    const isProviderUnavailable =
      message.includes('unverified_by_trace(provider_unavailable)') ||
      (error instanceof Error && error.name === 'ProviderUnavailableError');
    const isProviderInvalid = message.includes('unverified_by_trace(provider_invalid_output)');
    if (message.includes('unverified_by_trace(budget_exhausted)')) {
      outcome = { status: 'unverified_by_trace', reason: 'budget_exhausted', message };
      throw error;
    }
    if (isProviderUnavailable || isProviderInvalid) {
      outcome = {
        status: 'unverified_by_trace',
        reason: isProviderInvalid ? 'provider_invalid_output' : 'provider_unavailable',
        message,
      };
      throw error;
    }
    outcome = { status: 'unverified_by_trace', reason: 'phase_failed', message };
  } finally {
    try {
      const report = await governor.buildReport(outcome);
      await writeGovernorBudgetReport(config.workspace, report);
    } catch (reportError: unknown) {
      const message = getErrorMessage(reportError);
      errors.push(`Governor report failure: ${message}`);
    }
  }

  const completedAt = new Date();

  // Build initial result for postcondition checking
  const phaseResult: BootstrapPhaseResult = {
    phase,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    itemsProcessed,
    errors: [...errors],
    metrics,
  };

  // Run postcondition gates with phase result
  const postconditionContext: ValidationGateContext = {
    ...gateContext,
    phaseResult,
  };
  const postconditionResults = await runPostconditionGates(phase.name as BootstrapPhaseName, postconditionContext);

  // Collect postcondition failures (non-fatal are warnings)
  for (const result of postconditionResults) {
    if (!result.passed) {
      const prefix = result.fatal ? '[POSTCONDITION FATAL]' : '[POSTCONDITION WARNING]';
      errors.push(`${prefix} ${result.message}`);
    }
  }

  // If fatal postcondition failure, mark in metrics
  if (hasFatalFailure(postconditionResults)) {
    phaseResult.metrics = {
      ...phaseResult.metrics,
      postconditionsFailed: postconditionResults.filter((r) => !r.passed && r.fatal).length,
    };
  }

  return {
    ...phaseResult,
    errors,
  };
}

async function runStructuralScan(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<{ itemsProcessed: number; errors: string[]; totalFiles: number; metrics: BootstrapPhaseMetrics }> {
  governor?.checkBudget();
  const phaseConfig = await withPhaseLlmConfig(config, 'structural_scan');
  // Scan directory structure and classify files
  const resolvedWorkspace = await fs.realpath(phaseConfig.workspace).catch(() => phaseConfig.workspace);
  let files = await glob(phaseConfig.include, {
    cwd: resolvedWorkspace,
    ignore: phaseConfig.exclude,
    absolute: true,
    follow: false,
    nodir: true,
  });
  if (files.length === 0 && resolvedWorkspace !== phaseConfig.workspace) {
    const fallbackFiles = await glob(phaseConfig.include, {
      cwd: phaseConfig.workspace,
      ignore: phaseConfig.exclude,
      absolute: true,
      follow: false,
      nodir: true,
    });
    if (fallbackFiles.length > 0) {
      files = fallbackFiles;
    }
  }
  if (files.length === 0) {
    let entryCount: number | null = null;
    let sampleEntries: string[] = [];
    try {
      const entries = await fs.readdir(phaseConfig.workspace);
      entryCount = entries.length;
      sampleEntries = entries.slice(0, 10);
    } catch {
      // Best-effort diagnostics only.
    }
    logWarning('[librarian] Structural scan found no files', {
      workspace: phaseConfig.workspace,
      resolvedWorkspace,
      include: phaseConfig.include,
      excludeCount: phaseConfig.exclude.length,
      entryCount,
      sampleEntries,
    });
  }

  for (const filePath of files) {
    governor?.enterFile(filePath);
  }

  // Store metadata about the workspace
  await storage.setMetadata({
    version: getTargetVersion(phaseConfig.bootstrapMode === 'full' ? 'full' : 'mvp'),
    workspace: phaseConfig.workspace,
    lastBootstrap: new Date(),
    lastIndexing: null,
    totalFiles: files.length,
    totalFunctions: 0,
    totalContextPacks: 0,
    qualityTier: phaseConfig.bootstrapMode === 'full' ? 'full' : 'mvp',
  });

  const ingestion = await runIngestionSources(phaseConfig, storage, governor);

  const fileKnowledgeResult = phaseConfig.bootstrapMode === 'full'
    ? await runFileDirectoryKnowledgeExtraction(phaseConfig, storage, files, governor)
    : { filesIndexed: 0, directoriesIndexed: 0, errors: [] as string[] };

  const metrics: BootstrapPhaseMetrics = {
    filesDiscovered: files.length,
    ingestionItems: ingestion.itemsProcessed,
    fileKnowledgeItems: fileKnowledgeResult.filesIndexed,
    directoryKnowledgeItems: fileKnowledgeResult.directoriesIndexed,
    totalSupplementalItems: ingestion.itemsProcessed + fileKnowledgeResult.filesIndexed + fileKnowledgeResult.directoriesIndexed,
    totalItems: files.length + ingestion.itemsProcessed + fileKnowledgeResult.filesIndexed + fileKnowledgeResult.directoriesIndexed,
  };

  return {
    itemsProcessed: files.length,
    errors: [...ingestion.errors, ...fileKnowledgeResult.errors],
    totalFiles: files.length,
    metrics,
  };
}

/**
 * Extract file-level and directory-level knowledge for all discovered files.
 * This provides comprehensive semantic understanding of the entire codebase structure.
 */
async function runFileDirectoryKnowledgeExtraction(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  files: string[],
  governor?: GovernorContext
): Promise<{ filesIndexed: number; directoriesIndexed: number; errors: string[] }> {
  const errors: string[] = [];
  let filesIndexed = 0;
  let directoriesIndexed = 0;
  const fileChecksumByPath = new Map<string, string>();

  const extractorConfig: FileExtractionConfig = {
    llmProvider: config.llmProvider,
    llmModelId: config.llmModelId,
    skipLlm: false, // LLM-only semantic extraction (no heuristic fallback)
  };

  // Collect unique directories
  const directories = new Set<string>();
  for (const filePath of files) {
    let dir = path.dirname(filePath);
    while (dir && dir !== config.workspace && !dir.endsWith('/') && dir !== '/') {
      directories.add(dir);
      dir = path.dirname(dir);
    }
    directories.add(config.workspace); // Include root
  }

  // Pre-compute total file counts for directories (avoids redundant I/O)
  const totalFileCounts = computeTotalFileCounts(files, config.workspace);

  // Process files in batches for efficiency
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    governor?.checkBudget();

    const batchAssessments: FlashAssessment[] = [];
    const batch = files.slice(i, i + batchSize);
    const fileKnowledgeBatch = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const existing = await storage.getFileByPath(filePath);
          if (existing) {
            try {
              const raw = await fs.readFile(filePath);
              if (!isProbablyBinary(raw)) {
                const checksum = computeChecksum16(raw.toString('utf8'));
                if (checksum === existing.checksum) {
                  fileChecksumByPath.set(filePath, existing.checksum);
                  const assessment = assessFile({ file: existing });
                  batchAssessments.push(assessment);
                  return { file: existing, didChange: false };
                }
              }
            } catch {
              // Continue to full extraction.
            }
          }

          const result = await extractFileKnowledge({
            absolutePath: filePath,
            workspaceRoot: config.workspace,
          }, extractorConfig);
          fileChecksumByPath.set(filePath, result.file.checksum);

          // Run flash assessment and collect it
          const assessment = assessFile({ file: result.file });
          batchAssessments.push(assessment);

          return { file: result.file, didChange: true };
        } catch (error) {
          errors.push(`File ${filePath}: ${getErrorMessage(error)}`);
          return null;
        }
      })
    );

    const validFiles = fileKnowledgeBatch.filter((f): f is NonNullable<typeof f> => f !== null);
    const changedFiles = validFiles.filter((entry) => entry.didChange).map((entry) => entry.file);
    if (changedFiles.length > 0) {
      const existingByPath = new Map<string, boolean>();
      for (const file of changedFiles) {
        const existing = await storage.getFileByPath(file.path);
        existingByPath.set(file.path, Boolean(existing));
      }
      await withinTransaction(storage, async (tx) => {
        const upsertFiles = requireTransactionMethod(tx, 'upsertFiles');
        await upsertFiles(changedFiles);
        if (batchAssessments.length > 0) {
          const upsertAssessments = requireTransactionMethod(tx, 'upsertAssessments');
          await upsertAssessments(batchAssessments);
        }
      });
      for (const file of changedFiles) {
        const existed = existingByPath.get(file.path) ?? false;
        const event = existed
          ? createEntityUpdatedEvent('file', file.id, file.path)
          : createEntityCreatedEvent('file', file.id, file.path);
        void globalEventBus.emit(event);
      }
      filesIndexed += changedFiles.length;
    } else if (batchAssessments.length > 0) {
      await withinTransaction(storage, async (tx) => {
        const upsertAssessments = requireTransactionMethod(tx, 'upsertAssessments');
        await upsertAssessments(batchAssessments);
      });
    }
    filesIndexed += validFiles.length - changedFiles.length;
  }

  // Process directories with pre-computed totalFiles
  const dirArray = Array.from(directories);
  for (let i = 0; i < dirArray.length; i += batchSize) {
    governor?.checkBudget();

    const batchAssessments: FlashAssessment[] = [];
    const batch = dirArray.slice(i, i + batchSize);
    const dirKnowledgeBatch = await Promise.all(
      batch.map(async (dirPath) => {
        try {
          const fingerprint = computeDirectoryFingerprint(dirPath, files, fileChecksumByPath, config.workspace);
          const existing = await storage.getDirectoryByPath(dirPath);
          if (existing && existing.fingerprint && existing.fingerprint === fingerprint) {
            const assessment = assessDirectory({ directory: existing });
            batchAssessments.push(assessment);
            return { directory: existing, didChange: false };
          }
          if (existing && !existing.fingerprint) {
            const backfilled = { ...existing, fingerprint };
            const assessment = assessDirectory({ directory: backfilled });
            batchAssessments.push(assessment);
            return { directory: backfilled, didChange: true };
          }

          const result = await extractDirectoryKnowledge({
            absolutePath: dirPath,
            workspaceRoot: config.workspace,
            totalFiles: totalFileCounts.get(dirPath), // Use pre-computed count
          }, extractorConfig);

          const directory = { ...result.directory, fingerprint };

          // Run flash assessment and collect it
          const assessment = assessDirectory({ directory });
          batchAssessments.push(assessment);

          return { directory, didChange: true };
        } catch (error) {
          errors.push(`Directory ${dirPath}: ${getErrorMessage(error)}`);
          return null;
        }
      })
    );

    const validDirs = dirKnowledgeBatch.filter((d): d is NonNullable<typeof d> => d !== null);
    const changedDirs = validDirs.filter((entry) => entry.didChange).map((entry) => entry.directory);
    const unchangedDirs = validDirs.filter((entry) => !entry.didChange).map((entry) => entry.directory);
    if (changedDirs.length > 0) {
      const existingByPath = new Map<string, boolean>();
      for (const dir of changedDirs) {
        const existing = await storage.getDirectoryByPath(dir.path);
        existingByPath.set(dir.path, Boolean(existing));
      }
      await withinTransaction(storage, async (tx) => {
        const upsertDirectories = requireTransactionMethod(tx, 'upsertDirectories');
        await upsertDirectories(changedDirs);
        if (batchAssessments.length > 0) {
          const upsertAssessments = requireTransactionMethod(tx, 'upsertAssessments');
          await upsertAssessments(batchAssessments);
        }
      });
      for (const dir of changedDirs) {
        const existed = existingByPath.get(dir.path) ?? false;
        const event = existed
          ? createEntityUpdatedEvent('directory', dir.id, dir.path)
          : createEntityCreatedEvent('directory', dir.id, dir.path);
        void globalEventBus.emit(event);
      }
      directoriesIndexed += changedDirs.length;
    } else if (batchAssessments.length > 0) {
      await withinTransaction(storage, async (tx) => {
        const upsertAssessments = requireTransactionMethod(tx, 'upsertAssessments');
        await upsertAssessments(batchAssessments);
      });
    }
    directoriesIndexed += unchangedDirs.length;
  }

  return { filesIndexed, directoriesIndexed, errors };
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);
  if (sampleSize === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const byte = buffer[i];
    if (byte === 0 || byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sampleSize > 0.3;
}

function computeDirectoryFingerprint(
  dirPath: string,
  allFiles: string[],
  fileChecksumByPath: Map<string, string>,
  workspaceRoot: string
): string {
  const prefix = dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`;
  const parts: string[] = [];
  for (const filePath of allFiles) {
    if (!filePath.startsWith(prefix)) continue;
    const checksum = fileChecksumByPath.get(filePath) ?? '';
    const rel = path.relative(workspaceRoot, filePath);
    parts.push(`${rel}:${checksum}`);
  }
  parts.sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

async function runSemanticIndexing(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext,
  progress?: { onProgress?: IndexProgressCallback }
): Promise<{ files: number; functions: number; totalFiles: number; errors: string[] }> {
  const phaseConfig = await withPhaseLlmConfig(config, 'semantic_indexing');
  // Get all indexable files
  const files = await glob(phaseConfig.include, {
    cwd: phaseConfig.workspace,
    ignore: phaseConfig.exclude,
    absolute: true,
    follow: false,
    nodir: true,
  });
  const parserRegistry = ParserRegistry.getInstance();
  const supportedExtensions = new Set(parserRegistry.getSupportedExtensions());
  const astFiles = files.filter((file) => supportedExtensions.has(path.extname(file).toLowerCase()));
  const totalFiles = astFiles.length;
  if (progress?.onProgress) {
    await progress.onProgress({ total: totalFiles, completed: 0 });
  }
  if (totalFiles === 0) {
    return { files: 0, functions: 0, totalFiles: 0, errors: [] };
  }
  const { llmProvider, llmModelId } = await resolveIndexLlmConfig(phaseConfig);

  const maxWorkers = Math.max(1, governor?.snapshot().config.maxConcurrentWorkers ?? 1);
  if (maxWorkers > 1) {
    const swarmResult = await new SwarmRunner({
      storage,
      workspace: phaseConfig.workspace,
      maxWorkers,
      maxFileSizeBytes: phaseConfig.maxFileSizeBytes,
      useAstIndexer: phaseConfig.useAstIndexer,
      generateEmbeddings: true,
      enableLlmAnalysis: phaseConfig.bootstrapMode === 'full',
      embeddingBatchSize: governor?.snapshot().config.maxEmbeddingsPerBatch ?? undefined,
      llmProvider,
      llmModelId,
      embeddingProvider: phaseConfig.embeddingProvider,
      embeddingModelId: phaseConfig.embeddingModelId,
      embeddingService: phaseConfig.embeddingService ?? undefined,
      fileTimeoutMs: phaseConfig.fileTimeoutMs,
      fileTimeoutRetries: phaseConfig.fileTimeoutRetries,
      fileTimeoutPolicy: phaseConfig.fileTimeoutPolicy,
      governor,
      progressCallback: progress?.onProgress,
      forceReindex: phaseConfig.forceReindex,
    }).run(astFiles);
    return { ...swarmResult, totalFiles };
  }

  // Create index librarian
  const indexer = new IndexLibrarian({
    maxFileSizeBytes: phaseConfig.maxFileSizeBytes,
    generateEmbeddings: true,
    createContextPacks: false, // Done in separate phase
    enableLlmAnalysis: phaseConfig.bootstrapMode === 'full',
    embeddingBatchSize: governor?.snapshot().config.maxEmbeddingsPerBatch ?? undefined,
    useAstIndexer: phaseConfig.useAstIndexer,
    llmProvider,
    llmModelId,
    extensions: Array.from(supportedExtensions),
    embeddingProvider: phaseConfig.embeddingProvider,
    embeddingModelId: phaseConfig.embeddingModelId,
    embeddingService: phaseConfig.embeddingService ?? undefined,
    governorContext: governor,
    workspaceRoot: phaseConfig.workspace,
    computeGraphMetrics: true,
    progressCallback: progress?.onProgress,
    forceReindex: phaseConfig.forceReindex,
    fileTimeoutMs: phaseConfig.fileTimeoutMs,
    fileTimeoutRetries: phaseConfig.fileTimeoutRetries,
    fileTimeoutPolicy: phaseConfig.fileTimeoutPolicy,
  });
  await indexer.initialize(storage);

  // Index all files
  const task: IndexingTask = {
    type: 'full',
    paths: astFiles,
    priority: 'high',
    reason: 'bootstrap',
    triggeredBy: 'bootstrap',
  };

  const result = await indexer.processTask(task);
  await indexer.shutdown();

  return {
    files: result.filesProcessed,
    functions: result.functionsIndexed,
    totalFiles,
    errors: result.errors.map((error) => `${error.path}: ${error.error}`),
  };
}

async function runRelationshipMapping(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<number> {
  governor?.checkBudget();
  const modules = await storage.getModules();
  if (!modules.length) return 0;

  const moduleIdByPath = new Map<string, string>();
  for (const module of modules) {
    moduleIdByPath.set(normalizeGraphPath(module.path), module.id);
  }

  const edges: GraphEdge[] = [];
  const computedAt = new Date();
  for (const module of modules) {
    const fromPath = normalizeGraphPath(module.path);
    for (const dep of module.dependencies) {
      const target = resolveModuleDependency(dep, fromPath, moduleIdByPath);
      if (!target) continue;
      edges.push({
        fromId: module.id,
        fromType: 'module',
        toId: target,
        toType: 'module',
        edgeType: 'imports',
        sourceFile: module.path,
        sourceLine: null,
        confidence: 0.9,
        computedAt,
      });
    }
  }

  if (edges.length) {
    await storage.upsertGraphEdges(edges);
  }

  const cochangeStore = storage as LibrarianStorage & {
    getCochangeEdgeCount?: () => Promise<number>;
    storeCochangeEdges?: (edges: ReturnType<typeof buildTemporalGraph>['edges'], computedAt?: string) => Promise<void>;
    deleteCochangeEdges?: () => Promise<void>;
  };
  if (cochangeStore.storeCochangeEdges) {
    const existing = cochangeStore.getCochangeEdgeCount
      ? await cochangeStore.getCochangeEdgeCount()
      : 0;
    if (existing === 0 || config.forceReindex) {
      if (config.forceReindex && cochangeStore.deleteCochangeEdges) {
        await cochangeStore.deleteCochangeEdges();
      }
      const temporal = buildTemporalGraph(config.workspace);
      if (temporal.edges.length) {
        await cochangeStore.storeCochangeEdges(temporal.edges);
      }
    }
  }

  // Advanced Library Features (2025-2026 research)
  // Run git primitives indexing and analysis passes for full mode
  if (config.bootstrapMode === 'full') {
    await runAdvancedLibraryFeatures(config, storage, governor);
  }

  return edges.length;
}

/**
 * Run Advanced Library Features - 2025-2026 research-based analysis.
 * Includes: git blame/diff/reflog indexing, clone detection, debt analysis, knowledge graph.
 */
async function runAdvancedLibraryFeatures(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<void> {
  governor?.checkBudget();

  // Phase 1: Git primitives indexing (blame, diff, reflog)
  try {
    await indexBlame({
      workspace: config.workspace,
      storage,
      maxFilesPerBatch: 10,
      timeoutMs: 60000,
    });
  } catch (error) {
    logWarning('Advanced Library: Blame indexing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await indexDiffs({
      workspace: config.workspace,
      storage,
      maxCommits: 200,
    });
  } catch (error) {
    logWarning('Advanced Library: Diff indexing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await indexReflog({
      workspace: config.workspace,
      storage,
      maxEntries: 200,
    });
  } catch (error) {
    logWarning('Advanced Library: Reflog indexing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Phase 2: Analysis passes (clone detection, debt analysis)
  try {
    await analyzeClones({
      storage,
      minSimilarity: 0.7,
    });
  } catch (error) {
    logWarning('Advanced Library: Clone analysis failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await analyzeDebt({
      storage,
    });
  } catch (error) {
    logWarning('Advanced Library: Debt analysis failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Phase 3: Knowledge graph construction (ties everything together)
  try {
    await buildKnowledgeGraph({
      workspace: config.workspace,
      storage,
    });
  } catch (error) {
    logWarning('Advanced Library: Knowledge graph build failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runContextPackGeneration(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<number> {
  governor?.checkBudget();
  const phaseConfig = await withPhaseLlmConfig(config, 'context_pack_generation');
  const fallback = await resolvePackLlmConfig({ allowMissing: phaseConfig.bootstrapMode !== 'full' });
  const provider = phaseConfig.llmProvider ?? fallback.provider;
  const modelId = phaseConfig.llmModelId ?? fallback.modelId;

  if (phaseConfig.bootstrapMode !== 'full') {
    // Fast bootstrap: generate module-level packs without LLM summaries (fallback-only).
    return generateContextPacks(storage, {
      governorContext: governor,
      llmProvider: provider,
      llmModelId: modelId,
      skipLlm: true,
      includeFunctionPacks: true,
      includeModulePacks: true,
      includeSupplemental: false,
      maxPacks: 5000,
      force: Boolean(config.forceReindex),
      version: getTargetVersion('mvp'),
    });
  }

  // Full bootstrap: LLM-backed summaries for packs.
  if (!provider || !modelId) {
    throw new Error('unverified_by_trace(provider_unavailable): Context pack generation requires live LLM providers.');
  }
  return generateContextPacks(storage, {
    governorContext: governor,
    llmProvider: provider,
    llmModelId: modelId,
    includeSupplemental: true,
    force: Boolean(config.forceReindex),
    version: getTargetVersion('full'),
  });
}

async function runKnowledgeGeneration(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<number> {
  const phaseConfig = await withPhaseLlmConfig(config, 'knowledge_generation');
  if (phaseConfig.bootstrapMode !== 'full') return 0;
  // Production mode: Full LLM-powered knowledge generation
  // No MVP shortcuts - generate comprehensive knowledge for every entity
  governor?.checkBudget();
  const generator = createKnowledgeGenerator({
    storage,
    workspace: phaseConfig.workspace,
    llmProvider: phaseConfig.llmProvider,
    llmModelId: phaseConfig.llmModelId,
    skipLlm: false, // PRODUCTION: Full LLM analysis for comprehensive knowledge
    governor, // Pass governor for token tracking and budget enforcement
    onEvent: (event) => { void globalEventBus.emit(event); },
  });

  const result = await generator.generateAll();
  return result.successCount + result.partialCount;
}

// HELPERS

function getTargetVersion(qualityTier: LibrarianVersion['qualityTier']): LibrarianVersion {
  return {
    major: LIBRARIAN_VERSION.major,
    minor: LIBRARIAN_VERSION.minor,
    patch: LIBRARIAN_VERSION.patch,
    string: LIBRARIAN_VERSION.string,
    qualityTier,
    indexedAt: new Date(),
    indexerVersion: LIBRARIAN_VERSION.string,
    features: [...LIBRARIAN_VERSION.features],
  };
}

async function resolvePackLlmConfig(options?: { allowMissing?: boolean }): Promise<{ provider?: 'claude' | 'codex'; modelId?: string }> {
  try {
    const resolved = await resolveLibrarianModelConfigWithDiscovery();
    return {
      provider: coerceProvider(resolved.provider),
      modelId: resolved.modelId,
    };
  } catch (error) {
    if (options?.allowMissing !== false) {
      return { provider: undefined, modelId: undefined };
    }
    throw error;
  }
}

async function resolveIndexLlmConfig(config: BootstrapConfig): Promise<{ llmProvider?: 'claude' | 'codex'; llmModelId?: string }> {
  if (config.llmProvider || config.llmModelId) {
    return { llmProvider: config.llmProvider, llmModelId: config.llmModelId };
  }
  const resolved = await resolvePackLlmConfig({ allowMissing: true });
  return { llmProvider: resolved.provider, llmModelId: resolved.modelId };
}

async function resolvePhaseLlmConfig(
  config: BootstrapConfig,
  phase: BootstrapPhaseName
): Promise<{ llmProvider?: 'claude' | 'codex'; llmModelId?: string }> {
  const override = config.llmPhaseOverrides?.[phase];
  const fallback = await resolvePackLlmConfig({ allowMissing: true });
  return {
    llmProvider: override?.llmProvider ?? config.llmProvider ?? fallback.provider,
    llmModelId: override?.llmModelId ?? config.llmModelId ?? fallback.modelId,
  };
}

async function withPhaseLlmConfig(config: BootstrapConfig, phase: BootstrapPhaseName): Promise<BootstrapConfig> {
  const resolved = await resolvePhaseLlmConfig(config, phase);
  return {
    ...config,
    llmProvider: resolved.llmProvider,
    llmModelId: resolved.llmModelId,
  };
}

function coerceProvider(value: string | undefined): 'claude' | 'codex' | undefined {
  if (value === 'claude' || value === 'codex') return value;
  return undefined;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

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

class IngestionTransactionError extends Error {
  readonly errors: string[];
  readonly stage: 'persist' | 'materialize';

  constructor(stage: 'persist' | 'materialize', errors: string[]) {
    if (!Array.isArray(errors) || errors.length === 0) {
      throw new Error('unverified_by_trace(ingestion_transaction_empty_errors)');
    }
    super(`Ingestion transaction failed during ${stage}`);
    this.name = 'IngestionTransactionError';
    this.stage = stage;
    this.errors = errors;
  }
}

function requireTransactionMethod<K extends keyof TransactionContext>(
  tx: TransactionContext,
  method: K
): NonNullable<TransactionContext[K]> {
  const value = tx[method];
  if (typeof value !== 'function') {
    throw new Error(`unverified_by_trace(transaction_missing_method): ${String(method)}`);
  }
  return value as NonNullable<TransactionContext[K]>;
}

async function applyIngestionResults(
  storage: LibrarianStorage,
  items: IngestionItem[],
  workspace: string
): Promise<
  | { success: true; stored: number; errors: [] }
  | { success: false; stored: 0; errors: string[] }
> {
  try {
    const transactionResult = await withinTransaction(storage, async (tx) => {
      const stored = await persistIngestionItems(tx, items);
      const materialized = await materializeIngestionItems(tx, items, workspace);
      return { stored, materialized };
    });
    return { success: true, stored: transactionResult.stored, errors: [] };
  } catch (error: unknown) {
    if (error instanceof IngestionTransactionError) {
      return { success: false, stored: 0, errors: error.errors };
    }
    throw error;
  }
}

async function runIngestionSources(
  config: BootstrapConfig,
  storage: LibrarianStorage,
  governor?: GovernorContext
): Promise<{ itemsProcessed: number; errors: string[] }> {
  // Use config values first, then fall back to environment variables
  const { llmProvider: configProvider, llmModelId: configModel } = await resolveIndexLlmConfig(config);
  const provider = configProvider;
  const modelId = configModel;
  const framework = new IngestionFramework({ sourceTimeoutMs: 120_000 });
  const errors: string[] = [];
  const ingestionWorkspace = config.ingestionWorkspace ?? config.workspace;

  void globalEventBus.emit(createIngestionStartedEvent(ingestionWorkspace));

  // Register non-LLM ingestion sources
  framework.registerSource(createConfigIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createCiIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createTeamIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createProcessIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createTestIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createOwnershipIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createAdrIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createDepsIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createSecurityIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createDomainIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createSchemaIngestionSource({ exclude: config.exclude }));
  framework.registerSource(createApiIngestionSource({ exclude: config.exclude }));

  const includeLlmSources = config.bootstrapMode === 'full';
  if (includeLlmSources) {
    if (!provider) {
      throw new Error('unverified_by_trace(provider_unavailable): LLM provider is required for full bootstrap ingestion.');
    }
    framework.registerSource(createDocsIngestionSource({
      exclude: config.exclude,
      llmProvider: provider,
      llmModelId: modelId,
      governorContext: governor ?? null,
    }));
    framework.registerSource(createCommitIngestionSource({
      exclude: config.exclude,
      llmProvider: provider,
      llmModelId: modelId,
      governorContext: governor ?? null,
    }));
  }

  // Run ingestion - errors must propagate, no graceful degradation
  const result = await framework.ingestAll(createIngestionContext(ingestionWorkspace));
  const errorBySource = countIngestionErrors(result.errors);
  for (const source of result.sources) {
    const errorCount = errorBySource.get(source.type) ?? 0;
    void globalEventBus.emit(createIngestionSourceCompletedEvent(
      ingestionWorkspace,
      source.type,
      source.itemCount,
      errorCount
    ));
  }
  const transactionResult = await applyIngestionResults(storage, result.items, ingestionWorkspace);
  const stored = transactionResult.success ? transactionResult.stored : 0;
  const transactionErrors = transactionResult.errors;
  const combinedErrors = [...errors, ...result.errors, ...transactionErrors];
  void globalEventBus.emit(createIngestionCompletedEvent(ingestionWorkspace, stored, combinedErrors.length));
  return { itemsProcessed: stored, errors: combinedErrors };
}

async function persistIngestionItems(
  storage: Pick<TransactionContext, 'upsertIngestionItem'>,
  items: IngestionItem[]
): Promise<number> {
  if (!items.length) return 0;
  const errors: string[] = [];
  let successCount = 0;
  for (const item of items) {
    const validation = validateIngestionItem(item);
    if (validation.errors.length > 0) {
      const idLabel = validation.id || 'unknown';
      errors.push(`ingestion_item:${idLabel}:${validation.errors.join('|')}`);
      continue;
    }
    try {
      await storage.upsertIngestionItem({
        ...item,
        payload: item.payload ?? null,
        metadata: item.metadata ?? {},
      });
      successCount += 1;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      errors.push(`ingestion_item:${item.id}:${message}`);
    }
  }
  if (errors.length > 0) {
    throw new IngestionTransactionError('persist', errors);
  }
  return successCount;
}

const MAX_INGESTION_JSON_CHARS = 100_000;
const MAX_INGESTION_JSON_DEPTH = 40;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function validateIngestionItem(item: IngestionItem): { id: string; errors: string[] } {
  const errors: string[] = [];
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (!id) {
    errors.push('id_invalid');
  }
  const sourceType = typeof item.sourceType === 'string' ? item.sourceType.trim() : '';
  if (!sourceType) {
    errors.push('source_type_invalid');
  }
  const sourceVersion = typeof item.sourceVersion === 'string' ? item.sourceVersion.trim() : '';
  if (!sourceVersion) {
    errors.push('source_version_invalid');
  }
  const ingestedAt = typeof item.ingestedAt === 'string' ? item.ingestedAt.trim() : '';
  if (!ingestedAt || !Number.isFinite(Date.parse(ingestedAt))) {
    errors.push('ingested_at_invalid');
  }
  errors.push(...validateJsonPayload('payload', item.payload ?? null));
  errors.push(...validateJsonPayload('metadata', item.metadata ?? {}));
  return { id, errors };
}

function validateJsonPayload(label: 'payload' | 'metadata', value: unknown): string[] {
  const errors: string[] = [];
  const seen = new WeakSet<object>();
  validateJsonNode(label, value, 0, seen, errors);
  if (errors.length > 0) return errors;
  const serialized = safeJsonLength(value);
  if (!serialized.ok) {
    errors.push(`${label}_unserializable`);
  } else if (serialized.length > MAX_INGESTION_JSON_CHARS) {
    errors.push(`${label}_too_large`);
  }
  return errors;
}

function validateJsonNode(
  label: 'payload' | 'metadata',
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  errors: string[]
): void {
  if (depth > MAX_INGESTION_JSON_DEPTH) {
    errors.push(`${label}_depth_exceeded`);
    return;
  }
  if (value === null) return;
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push(`${label}_non_finite_number`);
    }
    return;
  }
  if (typeof value !== 'object') {
    errors.push(`${label}_invalid_type`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJsonNode(label, item, depth + 1, seen, errors);
    }
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${label}_non_plain_object`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${label}_circular`);
    return;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      errors.push(`${label}_forbidden_key:${key}`);
      continue;
    }
    validateJsonNode(label, child, depth + 1, seen, errors);
  }
  seen.delete(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function safeJsonLength(value: unknown): { ok: true; length: number } | { ok: false } {
  try {
    return { ok: true, length: JSON.stringify(value).length };
  } catch {
    return { ok: false };
  }
}

function countIngestionErrors(errors: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const error of errors) {
    const match = /^\[([^\]]+)\]/.exec(error);
    if (!match) continue;
    const source = match[1];
    if (!source) continue;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return counts;
}

type IngestionMaterializationStorage = Pick<
  TransactionContext,
  'upsertTestMapping' | 'upsertCommit' | 'upsertOwnership'
>;

async function materializeIngestionItems(
  storage: IngestionMaterializationStorage,
  items: IngestionItem[],
  workspace: string
): Promise<{ errors: string[] }> {
  // Collect all materialization errors for diagnostics before rolling back.
  const errors: string[] = [];

  const testItems = items.filter((item) => item.sourceType === 'test');
  for (const item of testItems) {
    if (!isRecord(item.payload)) continue;
    const mappings = Array.isArray(item.payload.mappings) ? item.payload.mappings : [];
    for (const mapping of mappings) {
      if (!isRecord(mapping)) continue;
      const testFile = typeof mapping.testFile === 'string' ? mapping.testFile : '';
      const sourceFiles = Array.isArray(mapping.sourceFiles) ? mapping.sourceFiles : [];
      if (!testFile || sourceFiles.length === 0) continue;
      for (const sourceFile of sourceFiles) {
        if (typeof sourceFile !== 'string' || !sourceFile) continue;
        try {
          await storage.upsertTestMapping({
            testPath: normalizeIngestionPath(workspace, testFile),
            sourcePath: normalizeIngestionPath(workspace, sourceFile),
            confidence: 0.65,
          });
        } catch (error: unknown) {
          errors.push(`test_mapping:${testFile}:${sourceFile}:${getErrorMessage(error)}`);
        }
      }
    }
  }

  const commitItems = items.filter((item) => item.sourceType === 'commit');
  for (const item of commitItems) {
    if (!isRecord(item.payload)) continue;
    const commitHash = typeof item.payload.commitHash === 'string' ? item.payload.commitHash : '';
    const author = typeof item.payload.author === 'string' ? item.payload.author : 'unknown';
    const message = typeof item.payload.message === 'string' ? item.payload.message : '';
    const semanticSummary = typeof item.payload.semanticSummary === 'string' ? item.payload.semanticSummary : '';
    const filesChanged = Array.isArray(item.payload.filesChanged)
      ? item.payload.filesChanged.filter((file) => typeof file === 'string')
      : [];
    if (!commitHash) continue;
    const category = classifyCommitCategory(message || semanticSummary);
    try {
      await storage.upsertCommit({
        sha: commitHash,
        message: message || semanticSummary || 'no message',
        author,
        category,
        filesChanged: filesChanged.map((file) => normalizeIngestionPath(workspace, file)),
      });
    } catch (error: unknown) {
      errors.push(`commit:${commitHash}:${getErrorMessage(error)}`);
    }
  }

  const ownershipItems = items.filter((item) => item.sourceType === 'ownership');
  for (const item of ownershipItems) {
    if (!isRecord(item.payload)) continue;
    const filePath = typeof item.payload.path === 'string' ? item.payload.path : '';
    const expertise = isRecord(item.payload.expertiseScore) ? item.payload.expertiseScore : null;
    if (!filePath || !expertise) continue;
    const lastTouchedAt = typeof item.payload.lastTouchedAt === 'string' ? item.payload.lastTouchedAt : '';
    const lastModified = toValidDate(lastTouchedAt);
    if (!lastModified) {
      errors.push(`ownership:${filePath}:invalid_last_modified:${lastTouchedAt}`);
      continue;
    }
    for (const [author, score] of Object.entries(expertise)) {
      if (!author) continue;
      const numericScore = typeof score === 'number' && Number.isFinite(score) ? score : 0;
      try {
        await storage.upsertOwnership({
          filePath: normalizeIngestionPath(workspace, filePath),
          author,
          score: numericScore,
          lastModified,
        });
      } catch (error: unknown) {
        errors.push(`ownership:${filePath}:${author}:${getErrorMessage(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new IngestionTransactionError('materialize', errors);
  }
  return { errors: [] };
}

function normalizeIngestionPath(workspace: string, value: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    const relative = path.relative(workspace, normalized).replace(/\\/g, '/');
    return relative.startsWith('..') ? normalized : relative;
  }
  return normalized;
}

function classifyCommitCategory(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('hotfix')) return 'bugfix';
  if (lower.includes('refactor') || lower.includes('cleanup')) return 'refactor';
  if (lower.includes('test')) return 'test';
  if (lower.includes('doc') || lower.includes('readme')) return 'docs';
  if (lower.includes('chore') || lower.includes('deps') || lower.includes('build')) return 'chore';
  if (lower.includes('perf') || lower.includes('optimiz')) return 'performance';
  if (lower.includes('security') || lower.includes('auth')) return 'security';
  return 'feature';
}

function toValidDate(value: string): Date | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function estimateCompletion(startedAtMs: number, progress: { total: number; completed: number }): string | undefined {
  if (progress.completed <= 0 || progress.total <= 0) return undefined;
  const elapsed = Date.now() - startedAtMs;
  const perItem = elapsed / progress.completed;
  const totalMs = perItem * progress.total;
  return new Date(startedAtMs + totalMs).toISOString();
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

/**
 * DEFAULT BOOTSTRAP CONFIG - COMPREHENSIVE INDEXING
 *
 * PHILOSOPHY: Index EVERYTHING meaningful. A world-class knowledge system
 * requires complete codebase consciousness. Tests are knowledge. Configs are
 * knowledge. Documentation is knowledge.
 *
 * The librarian exists to answer questions about the codebase. It cannot
 * answer questions about files it hasn't indexed. Therefore, we index
 * everything except truly binary/generated content.
 *
 * EMBEDDING CONFIGURATION:
 * - Embeddings are mandatory and generated via real embedding providers
 *
 * See src/librarian/universal_patterns.ts for the complete file type list.
 * See docs/librarian/VISION.md section 6.3 for bootstrap modes.
 */
export const DEFAULT_BOOTSTRAP_CONFIG: Omit<BootstrapConfig, 'workspace'> = {
  bootstrapMode: 'fast',
  include: [...INCLUDE_PATTERNS],
  exclude: [...EXCLUDE_PATTERNS],

  // Larger file size to accommodate documentation and data files
  maxFileSizeBytes: 5 * 1024 * 1024, // 5MB

  // Default timeout (0 = unlimited, can be overridden via config)
  timeoutMs: 0,
  // Per-file timeout (skip and continue on repeated timeouts)
  fileTimeoutMs: 120000,
  fileTimeoutRetries: 1,
  fileTimeoutPolicy: 'skip',

  // Recovery behavior
  forceResume: false,

  // Composition suggestions (codebase-aware recommendations after bootstrap)
  compositionSuggestions: { enabled: true },

  // LLM/Embedding configuration is passed via createBootstrapConfig overrides
  // See scripts/bootstrap_librarian.ts for example usage
};

/**
 * Compute bootstrap capabilities and generate a human-readable summary.
 * This gives users a clear picture of what the librarian can do after bootstrap.
 */
async function computeBootstrapCapabilities(
  storage: LibrarianStorage,
  report: BootstrapReport
): Promise<{
  capabilities: BootstrapCapabilities;
  warnings: string[];
  statusSummary: string;
  nextSteps: string[];
}> {
  const stats = await storage.getStats();
  const warnings: string[] = [];

  // Get additional counts not in stats
  const files = await storage.getFiles({ limit: 1 });
  const hasFiles = files.length > 0;
  let graphEdgeCount = 0;
  try {
    const edges = await storage.getGraphEdges({ limit: 1 });
    graphEdgeCount = edges.length;
  } catch {
    // Graph edges may not be available
  }

  // Collect warnings from phase results
  for (const phase of report.phases) {
    for (const error of phase.errors) {
      if (error.includes('[PRECONDITION WARNING]') || error.includes('[POSTCONDITION WARNING]')) {
        // Extract the message part after the tag
        const cleanMessage = error
          .replace('[PRECONDITION WARNING]', '')
          .replace('[POSTCONDITION WARNING]', '')
          .trim();
        warnings.push(cleanMessage);
      }
    }
  }

  // Compute capabilities based on what was actually indexed
  const capabilities: BootstrapCapabilities = {
    semanticSearch: stats.totalEmbeddings > 0,
    llmEnrichment: stats.totalContextPacks > 0 && report.totalContextPacksCreated > 0,
    functionData: stats.totalFunctions > 0,
    structuralData: stats.totalModules > 0 || hasFiles,
    relationshipGraph: graphEdgeCount > 0,
    contextPacks: stats.totalContextPacks > 0,
  };

  // Add warnings for missing capabilities
  if (!capabilities.semanticSearch) {
    warnings.push('Semantic search unavailable - no embeddings generated. Check embedding provider configuration.');
  }
  if (!capabilities.functionData && report.totalFilesProcessed > 0) {
    warnings.push('No functions extracted from files. AST parsing may not support your languages or files may not contain parseable code.');
  }
  if (!capabilities.contextPacks && capabilities.functionData) {
    warnings.push('Context packs not generated despite having function data. LLM enrichment may be unavailable.');
  }

  // Generate status summary
  const capabilityCount = Object.values(capabilities).filter(Boolean).length;
  const totalCapabilities = Object.keys(capabilities).length;

  let statusSummary: string;
  if (capabilityCount === totalCapabilities) {
    statusSummary = `Bootstrap complete: All ${totalCapabilities} capabilities available. ` +
      `Indexed ${report.totalFilesProcessed} files, ${stats.totalFunctions} functions, ${stats.totalContextPacks} context packs.`;
  } else if (capabilityCount === 0) {
    statusSummary = `Bootstrap complete but limited: No capabilities available. ` +
      `Check provider configuration. Processed ${report.totalFilesProcessed} files but stored minimal data.`;
  } else {
    const available = Object.entries(capabilities)
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim())
      .join(', ');
    const unavailable = Object.entries(capabilities)
      .filter(([, v]) => !v)
      .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim())
      .join(', ');
    statusSummary = `Bootstrap complete with partial capabilities (${capabilityCount}/${totalCapabilities}). ` +
      `Available: ${available}. Limited: ${unavailable}. ` +
      `Indexed ${report.totalFilesProcessed} files, ${stats.totalFunctions} functions.`;
  }

  // Generate actionable next steps
  const nextSteps: string[] = [];

  // Always recommend starting file watcher
  nextSteps.push('Call librarian.startWatching() or set autoWatch:true to keep index updated on file changes.');

  // If partial capabilities, suggest how to get full
  if (!capabilities.semanticSearch) {
    nextSteps.push('Configure embedding provider (claude/codex login) and re-run bootstrap for semantic search.');
  }
  if (!capabilities.llmEnrichment) {
    nextSteps.push('Configure LLM provider and run bootstrap with mode:"full" for rich context packs.');
  }
  if (!capabilities.functionData && report.totalFilesProcessed > 0) {
    nextSteps.push('Check if your file types are supported by AST parsers (JS/TS/Python/Go/Rust).');
  }
  if (!capabilities.contextPacks && capabilities.functionData) {
    nextSteps.push('Run librarian.enhance() to generate context packs from existing function data.');
  }

  // If all capabilities available
  if (capabilityCount === totalCapabilities) {
    nextSteps.length = 0; // Clear and replace
    nextSteps.push('Librarian is fully operational. Use librarian.query() to search your codebase.');
    nextSteps.push('Consider librarian.startWatching() to keep index fresh as code changes.');
  }

  return { capabilities, warnings, statusSummary, nextSteps };
}

function resolveSuggestionConfig(
  config: BootstrapConfig
): BootstrapCompositionSuggestionConfig {
  return config.compositionSuggestions ?? {};
}

function resolveBootstrapEmbeddingService(config: BootstrapConfig): EmbeddingService {
  if (config.embeddingService) return config.embeddingService;
  if (config.embeddingProvider || config.embeddingModelId) {
    return new EmbeddingService({
      provider: config.embeddingProvider,
      modelId: config.embeddingModelId,
    });
  }
  return new EmbeddingService();
}

async function computeCompositionSuggestions(
  storage: LibrarianStorage,
  config: BootstrapConfig,
  governorConfig: GovernorConfig,
  governorRunState: GovernorRunState,
  capabilities?: BootstrapCapabilities
): Promise<{ suggestions: CompositionSuggestion[]; warnings: string[] }> {
  const suggestionConfig = resolveSuggestionConfig(config);
  if (suggestionConfig.enabled === false) {
    return { suggestions: [], warnings: [] };
  }
  if (capabilities && !capabilities.semanticSearch) {
    return {
      suggestions: [],
      warnings: ['Composition suggestions skipped: semantic search unavailable.'],
    };
  }

  const embeddingService = resolveBootstrapEmbeddingService(config);
  const governor = new GovernorContext({
    phase: 'bootstrap_suggestions',
    config: governorConfig,
    runState: governorRunState,
  });
  const advisor = new CodebaseCompositionAdvisor(
    {
      queryOptional: async (query) => {
        const response = await queryLibrarian(query, storage, embeddingService, governor);
        const llmRequirement = query.llmRequirement === 'disabled' ? 'disabled' : 'optional';
        return {
          ...response,
          llmRequirement,
          llmAvailable: response.llmAvailable ?? llmRequirement !== 'disabled',
        };
      },
    },
    {
      minConfidence: suggestionConfig.minConfidence,
      maxSuggestions: suggestionConfig.maxSuggestions,
      queryDepth: suggestionConfig.queryDepth,
      queryTimeoutMs: suggestionConfig.queryTimeoutMs,
    }
  );

  try {
    const suggestions = await advisor.suggestCompositions();
    return { suggestions, warnings: [] };
  } catch (error) {
    return {
      suggestions: [],
      warnings: [`Composition suggestions unavailable: ${getErrorMessage(error)}`],
    };
  }
}

/**
 * Creates a bootstrap configuration by merging defaults with provided overrides.
 *
 * @param workspace - Absolute path to the workspace root directory
 * @param overrides - Optional partial configuration to override defaults
 * @returns A complete BootstrapConfig with all required fields
 *
 * @example
 * ```typescript
 * // Minimal configuration
 * const config = createBootstrapConfig('/path/to/workspace');
 *
 * // With custom options
 * const config = createBootstrapConfig('/path/to/workspace', {
 *   mode: 'full',
 *   maxFilesPerBatch: 50,
 *   llmProvider: 'claude',
 * });
 * ```
 */
export function createBootstrapConfig(
  workspace: string,
  overrides?: Partial<BootstrapConfig>
): BootstrapConfig {
  return {
    ...DEFAULT_BOOTSTRAP_CONFIG,
    workspace,
    ...overrides,
  };
}

export const __testing = {
  readBootstrapRecoveryState,
  writeBootstrapRecoveryState,
  clearBootstrapRecoveryState,
  createBootstrapCheckpointWriter,
  computeWorkspaceFingerprint,
  fingerprintsMatch,
  applyIngestionResults,
  persistIngestionItems,
  materializeIngestionItems,
  IngestionTransactionError,
  validateIngestionItem,
  MAX_INGESTION_JSON_CHARS,
};
