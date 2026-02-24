/**
 * @fileoverview Automatic Agent Integration Hooks
 *
 * Provides transparent Librarian integration for any AI agent (Claude Code, Codex, etc.)
 * Agents don't need to know about Librarian - context is automatically injected.
 *
 * ARCHITECTURE NOTE: This module is a thin wrapper around the unified orchestrator
 * (../orchestrator/unified_init.ts). All core functionality is delegated to the
 * LibrarianSession interface. This layer provides:
 * - Agent-friendly API surface (TaskContext, TaskOutcome types)
 * - Caching for repeated queries
 * - File change monitoring utilities
 * - Pre/post task hooks for lifecycle management
 *
 * DESIGN PRINCIPLES:
 * 1. Zero-config: Works automatically when Librarian is bootstrapped
 * 2. Non-blocking: Falls back gracefully if Librarian unavailable
 * 3. Learning: Records outcomes to improve future context retrieval
 * 4. Transparent: Agents can use full API or simple helpers
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { LibrarianContext } from './wave0_integration.js';
import { formatLibrarianContext } from './wave0_integration.js';
import { processAgentFeedback, type AgentFeedback } from './agent_feedback.js';
import type { LibrarianStorage } from '../storage/types.js';
import { logInfo, logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import { getTaskQualityNorms, type TaskQualityNorm } from '../constructions/processes/quality_bar_constitution_construction.js';
import {
  AgentPhase,
  detectTaskPhase,
  type PhaseDetectionResult,
  type PhaseProactiveIntel,
} from '../constructions/processes/task_phase_detector_construction.js';
import {
  globalEventBus,
  createTaskReceivedEvent,
  createTaskCompletedEvent,
  createTaskFailedEvent,
  createFileModifiedEvent,
} from '../events.js';
import {
  initializeLibrarian,
  getSession,
  hasSession,
  type LibrarianSession,
  type Context,
} from '../orchestrator/unified_init.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal input for getting task context.
 * Agents only need to provide intent and optionally affected files.
 */
export interface TaskContextRequest {
  /** Natural language description of what the agent is doing */
  intent: string;
  /** Files that will be read or modified (optional but improves context) */
  affectedFiles?: string[];
  /** Task type hint for better context selection */
  taskType?: string;
  /** Unique task identifier (auto-generated if not provided) */
  taskId?: string;
  /** How long to wait for indexing to complete (ms) */
  waitForIndexMs?: number;
  /** Universal coverage requirements to satisfy */
  ucRequirements?: string[];
  /** Recent tool calls from the current session (used for lifecycle phase detection) */
  recentToolCalls?: string[];
  /** Optional previous detected phase for transition tracking */
  previousPhase?: AgentPhase;
}

/**
 * Context returned to agents for prompt injection.
 */
export interface TaskContext {
  /** Unique identifier for this task (use for outcome reporting) */
  taskId: string;
  /** Pre-formatted context string ready for prompt injection */
  formatted: string;
  /** Structured context data for programmatic access */
  structured: LibrarianContext;
  /** Pack IDs used (needed for outcome reporting) */
  packIds: string[];
  /** Overall confidence in the context (0-1) */
  confidence: number;
  /** Whether Librarian was available */
  librarianAvailable: boolean;
  /** Hints for agent on what to investigate further */
  drillDownHints: string[];
  /** Method hints for accomplishing the task */
  methodHints: string[];
  /** Repository-specific quality norms selected for this task */
  qualityNorms: TaskQualityNorm[];
  /** Detected lifecycle phase for this task */
  phaseDetection: PhaseDetectionResult;
  /** Phase-specific proactive intelligence suggestions */
  proactiveIntel: PhaseProactiveIntel[];
}

/**
 * Task outcome for learning loop.
 */
export interface TaskOutcome {
  /** Task ID from TaskContext */
  taskId: string;
  /** Whether the task succeeded */
  success: boolean;
  /** Files that were modified during the task */
  filesModified?: string[];
  /** Reason for failure (if applicable) */
  failureReason?: string;
  /** Category of failure for analysis */
  failureType?: 'knowledge_mismatch' | 'incorrect_context' | 'timeout' | 'provider_error' | 'other';
  /** Agent's assessment of context usefulness (0-1) */
  contextUsefulness?: number;
  /** Missing context that would have helped */
  missingContext?: string;
}

/**
 * Automatic hook configuration.
 */
export interface AgentHookConfig {
  /** Workspace root (auto-detected if not provided) */
  workspace?: string;
  /** Whether to automatically initialize Librarian */
  autoInitialize?: boolean;
  /** Timeout for initialization (ms) */
  initTimeoutMs?: number;
  /** Whether to emit events for telemetry */
  emitEvents?: boolean;
  /** Agent identifier for tracking */
  agentId?: string;
}

/**
 * File change tracking state.
 */
interface FileChangeTracker {
  taskId: string;
  startTime: number;
  initialSnapshots: Map<string, FileSnapshot>;
  affectedFiles: string[];
}

interface FileSnapshot {
  exists: boolean;
  mtime?: number;
  ctime?: number;
  size?: number;
  hash?: string;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const activeTrackers = new Map<string, FileChangeTracker>();
const taskContextCache = new Map<string, { context: TaskContext; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

// ============================================================================
// PRIMARY API - What agents should use
// ============================================================================

/**
 * Get context for a task - THE MAIN API FOR AGENTS.
 *
 * Agents just call this with their intent and get back formatted context.
 * Librarian initialization is handled automatically.
 *
 * @example
 * ```typescript
 * // Agent just needs to call this
 * const context = await getTaskContext({
 *   intent: 'Add error handling to the user authentication flow',
 *   affectedFiles: ['src/auth/login.ts', 'src/auth/session.ts']
 * });
 *
 * // Inject context into prompt
 * const prompt = `${context.formatted}\n\nTask: ${userRequest}`;
 *
 * // After task completion, report outcome
 * await reportTaskOutcome(context.taskId, {
 *   success: true,
 *   filesModified: ['src/auth/login.ts']
 * });
 * ```
 */
export async function getTaskContext(
  request: TaskContextRequest,
  config: AgentHookConfig = {}
): Promise<TaskContext> {
  const taskId = request.taskId ?? randomUUID();
  const workspace = await resolveWorkspace(config.workspace);

  // Check cache first
  const cacheKey = buildCacheKey(request, workspace);
  const cached = taskContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logInfo('[agent_hooks] Returning cached context', { taskId, cacheKey });
    return { ...cached.context, taskId };
  }

  // Emit task received event
  if (config.emitEvents !== false) {
    void globalEventBus.emit(createTaskReceivedEvent(taskId, request.intent, request.affectedFiles));
  }

  // Try to get Librarian context via unified_init
  try {
    let session: LibrarianSession;

    // Check if session already exists
    if (hasSession(workspace)) {
      const existingSession = getSession(workspace);
      if (existingSession) {
        session = existingSession;
        logInfo('[agent_hooks] Using existing session', { workspace });
      } else {
        // Shouldn't happen, but handle gracefully
        session = await initializeLibrarian(workspace, {
          silent: true,
          bootstrapTimeoutMs: config.initTimeoutMs ?? 60_000,
        });
      }
    } else if (config.autoInitialize !== false) {
      // Initialize new session
      session = await initializeLibrarian(workspace, {
        silent: true,
        bootstrapTimeoutMs: config.initTimeoutMs ?? 60_000,
      });
    } else {
      // Auto-initialize disabled and no existing session
      return createFallbackContext(taskId, request, 'Librarian not initialized');
    }

    // Query the session for context
    const sessionContext = await session.query(request.intent, {
      taskType: request.taskType,
      ucRequirements: request.ucRequirements,
      waitForIndexMs: request.waitForIndexMs,
    });

    // Convert Context to LibrarianContext for structured field
    const librarianContext: LibrarianContext = {
      intent: request.intent,
      taskType: request.taskType,
      summary: sessionContext.summary,
      keyFacts: sessionContext.keyFacts,
      snippets: sessionContext.snippets,
      relatedFiles: request.affectedFiles ?? sessionContext.relatedFiles,
      patterns: sessionContext.patterns,
      gotchas: sessionContext.gotchas,
      confidence: sessionContext.confidence,
      drillDownHints: sessionContext.drillDownHints,
      methodHints: sessionContext.methodHints,
      packIds: sessionContext.packIds,
      scenario: sessionContext.scenario,
    };

    const filesForNormSelection = request.affectedFiles ?? sessionContext.relatedFiles;
    let qualityNorms: TaskQualityNorm[] = [];
    try {
      qualityNorms = await getTaskQualityNorms({
        workspace,
        filesToModify: filesForNormSelection,
        taskType: request.taskType,
      });
    } catch (error) {
      logWarning('[agent_hooks] Failed to resolve quality norms', {
        taskId,
        error: getErrorMessage(error),
      });
    }

    const phaseResult = detectTaskPhase({
      intent: request.intent,
      recentToolCalls: request.recentToolCalls,
      affectedFiles: filesForNormSelection,
      previousPhase: request.previousPhase,
    });

    // Format for prompt injection
    const formatted = appendPhaseIntelSection(
      appendQualityNormsSection(formatLibrarianContext(librarianContext), qualityNorms),
      phaseResult.detection,
      phaseResult.proactiveIntel
    );

    const context: TaskContext = {
      taskId,
      formatted,
      structured: librarianContext,
      packIds: sessionContext.packIds,
      confidence: sessionContext.confidence,
      librarianAvailable: true,
      drillDownHints: sessionContext.drillDownHints,
      methodHints: sessionContext.methodHints,
      qualityNorms,
      phaseDetection: phaseResult.detection,
      proactiveIntel: phaseResult.proactiveIntel,
    };

    // Cache the result
    taskContextCache.set(cacheKey, {
      context,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    logInfo('[agent_hooks] Context retrieved via unified session', {
      taskId,
      packCount: sessionContext.packIds.length,
      confidence: sessionContext.confidence,
    });

    return context;
  } catch (error) {
    const message = getErrorMessage(error);
    logWarning('[agent_hooks] Context retrieval failed', { taskId, error: message });
    return createFallbackContext(taskId, request, message);
  }
}

/**
 * Simplified context getter - just intent and files.
 *
 * @example
 * ```typescript
 * const context = await getContext('Fix the null pointer in user lookup', ['src/users.ts']);
 * ```
 */
export async function getContext(
  intent: string,
  affectedFiles?: string[],
  config?: AgentHookConfig
): Promise<TaskContext> {
  return getTaskContext({ intent, affectedFiles }, config);
}

/**
 * Report task outcome for learning loop.
 *
 * Agents should call this after completing a task to help Librarian
 * learn which context was useful.
 */
export async function reportTaskOutcome(
  taskIdOrContext: string | TaskContext,
  outcome: Omit<TaskOutcome, 'taskId'>,
  config: AgentHookConfig = {}
): Promise<void> {
  const taskId = typeof taskIdOrContext === 'string' ? taskIdOrContext : taskIdOrContext.taskId;
  const packIds = typeof taskIdOrContext === 'object' ? taskIdOrContext.packIds : [];
  const intent = typeof taskIdOrContext === 'object' ? taskIdOrContext.structured.intent : undefined;
  const workspace = await resolveWorkspace(config.workspace);

  try {
    // Try to use session's recordOutcome if available
    const session = getSession(workspace);
    if (session) {
      // Use the unified session's recordOutcome method
      await session.recordOutcome({
        taskId,
        packIds,
        success: outcome.success,
        filesModified: outcome.filesModified,
        failureReason: outcome.failureReason,
        failureType: outcome.failureType,
        intent,
      });
    } else {
      // Fallback: log warning that no session exists
      logWarning('[agent_hooks] No session available for outcome recording', {
        taskId,
        workspace,
      });
    }

    // If context usefulness was provided, submit detailed feedback
    if (outcome.contextUsefulness !== undefined || outcome.missingContext) {
      const sessionForFeedback = getSession(workspace);
      const storage = sessionForFeedback?.librarian?.getStorage?.();
      if (storage) {
        await submitDetailedFeedback(taskId, packIds, outcome, storage, config.agentId);
      }
    }

    // Emit completion event
    if (config.emitEvents !== false) {
      const event = outcome.success
        ? createTaskCompletedEvent(taskId, true, packIds, outcome.failureReason)
        : createTaskFailedEvent(taskId, packIds, outcome.failureReason);
      void globalEventBus.emit(event);
    }

    logInfo('[agent_hooks] Outcome recorded via unified session', {
      taskId,
      success: outcome.success,
      filesModified: outcome.filesModified?.length ?? 0,
    });
  } catch (error) {
    logWarning('[agent_hooks] Failed to record outcome', {
      taskId,
      error: getErrorMessage(error),
    });
  }
}

// ============================================================================
// FILE CHANGE MONITORING
// ============================================================================

/**
 * Start monitoring files for changes during a task.
 * Call this before the task starts, then call stopFileMonitoring after.
 */
export async function startFileMonitoring(
  taskId: string,
  affectedFiles: string[],
  config: AgentHookConfig = {}
): Promise<void> {
  const workspace = await resolveWorkspace(config.workspace);
  const normalizedFiles = affectedFiles.map((f) =>
    path.isAbsolute(f) ? f : path.resolve(workspace, f)
  );

  // Snapshot initial state
  const initialSnapshots = new Map<string, FileSnapshot>();
  for (const filePath of normalizedFiles) {
    initialSnapshots.set(filePath, await snapshotFile(filePath));
  }

  activeTrackers.set(taskId, {
    taskId,
    startTime: Date.now(),
    initialSnapshots,
    affectedFiles: normalizedFiles,
  });

  logInfo('[agent_hooks] File monitoring started', {
    taskId,
    fileCount: normalizedFiles.length,
  });
}

/**
 * Stop monitoring and return list of modified files.
 */
export async function stopFileMonitoring(
  taskId: string,
  config: AgentHookConfig = {}
): Promise<string[]> {
  const tracker = activeTrackers.get(taskId);
  if (!tracker) {
    return [];
  }

  activeTrackers.delete(taskId);

  const modifiedFiles: string[] = [];

  for (const [filePath, initialSnapshot] of tracker.initialSnapshots) {
    const currentSnapshot = await snapshotFile(filePath);

    // File was modified if:
    // 1. It now exists but didn't before
    // 2. It doesn't exist but did before (deleted)
    // 3. mtime or size changed
    const wasModified =
      initialSnapshot.exists !== currentSnapshot.exists ||
      initialSnapshot.mtime !== currentSnapshot.mtime ||
      initialSnapshot.ctime !== currentSnapshot.ctime ||
      initialSnapshot.size !== currentSnapshot.size;

    const hasHash =
      initialSnapshot.hash !== undefined && currentSnapshot.hash !== undefined;
    const hashModified = hasHash && initialSnapshot.hash !== currentSnapshot.hash;

    if (wasModified || hashModified) {
      modifiedFiles.push(filePath);
      if (config.emitEvents !== false) {
        void globalEventBus.emit(createFileModifiedEvent(filePath, 'agent_task'));
      }
    }
  }

  logInfo('[agent_hooks] File monitoring stopped', {
    taskId,
    modifiedCount: modifiedFiles.length,
    durationMs: Date.now() - tracker.startTime,
  });

  return modifiedFiles;
}

/**
 * Convenience: Run a task with automatic file monitoring.
 *
 * @example
 * ```typescript
 * const result = await withFileMonitoring(
 *   context.taskId,
 *   context.structured.relatedFiles,
 *   async () => {
 *     // Do the task
 *     return { success: true };
 *   }
 * );
 * ```
 */
export async function withFileMonitoring<T>(
  taskId: string,
  affectedFiles: string[],
  task: () => Promise<T>,
  config: AgentHookConfig = {}
): Promise<{ result: T; filesModified: string[] }> {
  await startFileMonitoring(taskId, affectedFiles, config);
  try {
    const result = await task();
    const filesModified = await stopFileMonitoring(taskId, config);
    return { result, filesModified };
  } catch (error) {
    await stopFileMonitoring(taskId, config);
    throw error;
  }
}

// ============================================================================
// CONVENIENCE WRAPPERS
// ============================================================================

/**
 * Complete task lifecycle: get context, run task, report outcome.
 *
 * @example
 * ```typescript
 * const result = await executeWithContext(
 *   { intent: 'Add validation', affectedFiles: ['src/api.ts'] },
 *   async (context) => {
 *     // Use context.formatted in your prompt
 *     // Do the task
 *     return { success: true, data: 'result' };
 *   }
 * );
 * ```
 */
export async function executeWithContext<T extends { success: boolean }>(
  request: TaskContextRequest,
  task: (context: TaskContext) => Promise<T & { filesModified?: string[]; failureReason?: string }>,
  config: AgentHookConfig = {}
): Promise<T> {
  const context = await getTaskContext(request, config);

  // Start file monitoring if files are specified
  if (request.affectedFiles?.length) {
    await startFileMonitoring(context.taskId, request.affectedFiles, config);
  }

  try {
    const result = await task(context);

    // Get modified files from monitoring
    let filesModified = result.filesModified;
    if (request.affectedFiles?.length) {
      const monitored = await stopFileMonitoring(context.taskId, config);
      filesModified = filesModified ? [...new Set([...filesModified, ...monitored])] : monitored;
    }

    // Report outcome
    await reportTaskOutcome(context, {
      success: result.success,
      filesModified,
      failureReason: result.failureReason,
    }, config);

    return result;
  } catch (error) {
    // Stop monitoring on error
    if (request.affectedFiles?.length) {
      await stopFileMonitoring(context.taskId, config);
    }

    // Report failure
    await reportTaskOutcome(context, {
      success: false,
      failureReason: getErrorMessage(error),
      failureType: 'other',
    }, config);

    throw error;
  }
}

// ============================================================================
// AUTO-INJECTION HOOKS
// ============================================================================

/**
 * Create a pre-task hook for automatic context injection.
 * Returns a function that can be called before any agent task.
 *
 * @example
 * ```typescript
 * const preTask = createPreTaskHook({ workspace: '/my/project' });
 *
 * // Before each agent task
 * const context = await preTask('implement feature X', ['src/feature.ts']);
 * ```
 */
export function createPreTaskHook(
  config: AgentHookConfig = {}
): (intent: string, affectedFiles?: string[]) => Promise<TaskContext> {
  return async (intent: string, affectedFiles?: string[]): Promise<TaskContext> => {
    return getTaskContext({ intent, affectedFiles }, config);
  };
}

/**
 * Create a post-task hook for automatic outcome recording.
 *
 * @example
 * ```typescript
 * const postTask = createPostTaskHook({ workspace: '/my/project' });
 *
 * // After each agent task
 * await postTask(taskId, { success: true, filesModified: ['src/feature.ts'] });
 * ```
 */
export function createPostTaskHook(
  config: AgentHookConfig = {}
): (taskId: string, outcome: Omit<TaskOutcome, 'taskId'>) => Promise<void> {
  return async (taskId: string, outcome: Omit<TaskOutcome, 'taskId'>): Promise<void> => {
    await reportTaskOutcome(taskId, outcome, config);
  };
}

/**
 * Create both pre and post task hooks as a pair.
 */
export function createAgentHooks(config: AgentHookConfig = {}): {
  preTask: (intent: string, affectedFiles?: string[]) => Promise<TaskContext>;
  postTask: (taskId: string, outcome: Omit<TaskOutcome, 'taskId'>) => Promise<void>;
} {
  return {
    preTask: createPreTaskHook(config),
    postTask: createPostTaskHook(config),
  };
}

// ============================================================================
// DETECTION HELPERS
// ============================================================================

/**
 * Check if Librarian is available for the current workspace.
 * Agents can use this to decide whether to use Librarian or fall back.
 */
export async function isLibrarianAvailable(workspace?: string): Promise<boolean> {
  try {
    const resolved = await resolveWorkspace(workspace);
    return hasSession(resolved);
  } catch {
    return false;
  }
}

/**
 * Detect workspace from environment or current directory.
 */
export async function detectWorkspace(): Promise<string | null> {
  // Try environment variable first
  const envWorkspace = process.env.LIBRARIAN_WORKSPACE;
  if (envWorkspace) {
    try {
      const stats = await fs.stat(envWorkspace);
      if (stats.isDirectory()) {
        return path.resolve(envWorkspace);
      }
    } catch {
      // Fall through
    }
  }

  const cwd = process.cwd();

  // If `.librarian/` exists in the current directory, treat it as the workspace
  // even if the directory lacks other "project root" markers.
  try {
    const stats = await fs.stat(path.join(cwd, '.librarian'));
    if (stats.isDirectory()) return cwd;
  } catch {
    // continue
  }

  // Scope detection to a real project root so we don't "snap" to an unrelated
  // `.librarian/` directory elsewhere on the machine (common when users
  // accidentally index their home directory once).
  const projectMarkers = [
    '.git',
    // JS/TS
    'package.json',
    'tsconfig.json',
    // Python
    'pyproject.toml',
    'setup.py',
    'requirements.txt',
    // Go / Rust
    'go.mod',
    'Cargo.toml',
    // Java / Kotlin / Gradle / Maven
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    // Ruby / PHP / Elixir / Dart / Swift
    'Gemfile',
    'composer.json',
    'mix.exs',
    'pubspec.yaml',
    'Package.swift',
  ];

  const allowMarkerless =
    process.env.LIBRARIAN_ALLOW_MARKERLESS_WORKSPACE === '1' ||
    process.env.LIBRARIAN_ALLOW_MARKERLESS_WORKSPACE === 'true';
  const allowHomeRoot =
    process.env.LIBRARIAN_ALLOW_HOME_WORKSPACE === '1' ||
    process.env.LIBRARIAN_ALLOW_HOME_WORKSPACE === 'true';

  const home = os.homedir();
  const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

  let projectRoot: string | null = null;
  if (allowMarkerless) {
    projectRoot = cwd;
  } else {
    let dir = cwd;
    while (dir !== path.dirname(dir)) {
      // Avoid treating the user home directory as a project root by default.
      if (!allowHomeRoot && samePath(dir, home)) break;

      for (const marker of projectMarkers) {
        const markerPath = path.join(dir, marker);
        try {
          const stats = await fs.stat(markerPath);
          if (stats.isDirectory() || stats.isFile()) {
            projectRoot = dir;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (projectRoot) break;

      // If we reach the user home directory without seeing any project markers,
      // treat this as "no workspace" rather than a global fallback.
      if (samePath(dir, home)) break;
      dir = path.dirname(dir);
    }
  }

  if (!projectRoot) return null;

  // Walk from cwd up to projectRoot (inclusive) looking for `.librarian/`.
  let dir = cwd;
  while (true) {
    const libDir = path.join(dir, '.librarian');
    try {
      const stats = await fs.stat(libDir);
      if (stats.isDirectory()) return dir;
    } catch {
      // continue
    }

    if (samePath(dir, projectRoot)) break;
    if (dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }

  return null;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function resolveWorkspace(workspace?: string): Promise<string> {
  if (workspace) {
    return path.resolve(workspace);
  }

  const detected = await detectWorkspace();
  if (detected) {
    return detected;
  }

  return process.cwd();
}

function createFallbackContext(
  taskId: string,
  request: TaskContextRequest,
  reason: string
): TaskContext {
  return {
    taskId,
    formatted: '',
    structured: {
      intent: request.intent,
      taskType: request.taskType,
      summary: 'No context available',
      keyFacts: [reason],
      snippets: [],
      relatedFiles: request.affectedFiles ?? [],
      patterns: [],
      gotchas: [],
      confidence: 0,
      drillDownHints: [],
      methodHints: [],
      packIds: [],
    },
    packIds: [],
    confidence: 0,
    librarianAvailable: false,
    drillDownHints: [],
    methodHints: [],
    qualityNorms: [],
    phaseDetection: {
      phase: AgentPhase.Unknown,
      confidence: 0,
      signals: [],
    },
    proactiveIntel: [],
  };
}

function appendQualityNormsSection(formattedContext: string, qualityNorms: TaskQualityNorm[]): string {
  if (qualityNorms.length === 0) {
    return formattedContext;
  }
  const sections: string[] = [];
  if (formattedContext.trim().length > 0) {
    sections.push(formattedContext.trimEnd(), '');
  }
  sections.push('### Quality Norms');
  for (const norm of qualityNorms) {
    const frequency = Math.round(norm.frequency * 100);
    sections.push(`- [${norm.level}] ${norm.rule} (${frequency}% observed, example: ${norm.example})`);
  }
  return sections.join('\n');
}

function appendPhaseIntelSection(
  formattedContext: string,
  phaseDetection: PhaseDetectionResult,
  proactiveIntel: PhaseProactiveIntel[]
): string {
  const sections: string[] = [];
  if (formattedContext.trim().length > 0) {
    sections.push(formattedContext.trimEnd(), '');
  }
  const phaseLabel = phaseDetection.phase.toUpperCase();
  const confidencePercent = Math.round(phaseDetection.confidence * 100);
  sections.push(`### Task Phase`);
  sections.push(`- ${phaseLabel} (${confidencePercent}% confidence)`);
  if (phaseDetection.transitionedFrom) {
    sections.push(`- Transitioned from ${phaseDetection.transitionedFrom.toUpperCase()}`);
  }
  if (proactiveIntel.length > 0) {
    sections.push('', '### Proactive Intel');
    for (const intel of proactiveIntel) {
      sections.push(`- [${intel.type}] ${intel.content}`);
    }
  }
  return sections.join('\n');
}

function buildCacheKey(request: TaskContextRequest, workspace: string): string {
  const files = (request.affectedFiles ?? []).sort().join(',');
  const recentToolCalls = (request.recentToolCalls ?? []).map((value) => value.trim().toLowerCase()).sort().join(',');
  return `${workspace}:${request.intent}:${files}:${request.taskType ?? ''}:${request.previousPhase ?? ''}:${recentToolCalls}`;
}

async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  try {
    const stats = await fs.stat(filePath);
    let hash: string | undefined;

    // `mtimeMs` + `size` can miss quick same-size rewrites on some filesystems.
    // Hash small files to make change detection reliable without heavy IO.
    if (stats.isFile() && stats.size <= 64 * 1024) {
      try {
        const buf = await fs.readFile(filePath);
        hash = createHash('sha1').update(buf).digest('hex');
      } catch {
        // Ignore hash failures, fall back to metadata only.
      }
    }
    return {
      exists: true,
      mtime: stats.mtimeMs,
      ctime: stats.ctimeMs,
      size: stats.size,
      hash,
    };
  } catch {
    return { exists: false };
  }
}

async function submitDetailedFeedback(
  taskId: string,
  packIds: string[],
  outcome: Omit<TaskOutcome, 'taskId'>,
  storage: LibrarianStorage,
  agentId?: string
): Promise<void> {
  // Create relevance ratings based on context usefulness
  const usefulness = outcome.contextUsefulness ?? (outcome.success ? 1.0 : 0.0);
  const feedback: AgentFeedback = {
    queryId: taskId,
    relevanceRatings: packIds.map((packId) => ({
      packId,
      relevant: usefulness > 0.3,
      usefulness: usefulness,
      reason: outcome.failureReason ?? (outcome.success ? 'Task succeeded' : 'Task failed'),
    })),
    missingContext: outcome.missingContext,
    timestamp: new Date().toISOString(),
    agentId,
    taskContext: {
      taskType: 'agent_task',
      intent: 'task_outcome_feedback',
      outcome: outcome.success ? 'success' : 'failure',
    },
  };

  await processAgentFeedback(feedback, storage);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  type LibrarianContext,
  type AgentFeedback,
};
