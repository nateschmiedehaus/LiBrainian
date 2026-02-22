/**
 * @fileoverview Index Command - Incremental file indexing
 *
 * Indexes specific files without requiring a full bootstrap.
 * Use this for adding new files to the knowledge base incrementally.
 *
 * IMPORTANT: This command invalidates context packs for target files and their
 * dependents BEFORE reindexing. If indexing fails, context packs may be lost.
 * Run `librarian bootstrap` to regenerate if needed.
 *
 * Usage: librarian index <file...> [--workspace <path>]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LiBrainian } from '../../api/librarian.js';
import { CliError } from '../errors.js';
import { globalEventBus, type LiBrainianEvent } from '../../events.js';
import { acquireWorkspaceLock, type WorkspaceLockHandle } from '../../integration/workspace_lock.js';
import {
  getGitDiffNames,
  getGitFileContentAtRef,
  getGitStagedChanges,
  getGitStatusChanges,
  isGitRepo,
  type GitRename,
} from '../../utils/git.js';
import { detectFunctionRenames } from '../../indexing/commit_level_ast_diff.js';
import { setDefaultLlmServiceFactory } from '../../adapters/llm_service.js';
import { createCliLlmServiceFactory } from '../../adapters/cli_llm_service.js';

export interface IndexCommandOptions {
  workspace?: string;
  verbose?: boolean;
  force?: boolean;
  files: string[];
  incremental?: boolean;
  staged?: boolean;
  since?: string;
  allowLockSkip?: boolean;
}

function isStorageLockError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('storage_locked')
    || normalized.includes('indexing in progress')
    || normalized.includes('sqlite_busy')
    || normalized.includes('database is locked')
    || normalized.includes('lease_conflict')
    || normalized.includes('bootstrap lock');
}

function buildIndexFailureGuidance(
  errorMessage: string,
  finalStatus: { stats: { totalFunctions: number; totalModules: number } } | null,
): string {
  const normalized = errorMessage.toLowerCase();
  let guidance = 'Run "librarian bootstrap" to recover and retry.';

  if (normalized.includes('providerunavailable') || normalized.includes('provider')) {
    guidance = 'Check provider credentials/network, then retry. If needed, run "librarian check-providers".';
  } else if (normalized.includes('lock') || normalized.includes('sqlite_busy')) {
    guidance = 'Another process may hold the database lock; wait and retry.';
  } else if (normalized.includes('extract') || normalized.includes('parse')) {
    guidance = 'Check file syntax/support and retry after fixing parse issues.';
  }

  if (finalStatus) {
    guidance += ` Context packs were invalidated; current totals: ${finalStatus.stats.totalFunctions} functions, ${finalStatus.stats.totalModules} modules.`;
  } else {
    guidance += ' Database state may be unknown; run "librarian bootstrap" before continuing.';
  }

  return guidance;
}

function ensureIndexLlmFactoryRegistered(): void {
  try {
    setDefaultLlmServiceFactory(createCliLlmServiceFactory());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('llm_adapter_default_factory_already_registered')) {
      return;
    }
    throw error;
  }
}

export async function indexCommand(options: IndexCommandOptions): Promise<void> {
  const workspace = options.workspace || process.cwd();
  const verbose = options.verbose ?? false;
  const force = options.force ?? false;
  const lockTimeoutMs = resolveMutationLockTimeoutMs();
  const files = await resolveRequestedFiles(workspace, options);
  const selectorMode = Boolean(options.incremental || options.staged || options.since);

  if (selectorMode && files.length === 0) {
    if (verbose) {
      console.log('No candidate files selected by git selector. Index is already up to date.');
    }
    return;
  }

  if (!files || files.length === 0) {
    if (options.allowLockSkip) {
      console.log('No modified files found to index. Workspace is already up to date.');
      return;
    }
    throw new CliError(
      'No files specified. Usage: librarian index <file...>',
      'INVALID_ARGUMENT'
    );
  }

  // CRITICAL: Require --force flag due to non-atomic context pack invalidation
  // If indexing fails mid-operation, context packs for target files will be lost.
  // This is an architectural limitation that requires explicit user acknowledgment.
  if (!force) {
    throw new CliError(
      'CAUTION: Indexing invalidates context packs BEFORE reindexing.\n' +
      'If indexing fails, context packs for target files will be PERMANENTLY LOST.\n' +
      'Recovery requires running `librarian bootstrap` to regenerate all context packs.\n\n' +
      'To proceed, use the --force flag to acknowledge this risk:\n' +
      '  librarian index --force <file...>',
      'INVALID_ARGUMENT'
    );
  }

  console.log('\n=== LiBrainian Index ===\n');
  console.log(`Workspace: ${workspace}`);
  if (options.since) {
    console.log(`Selection mode: --since ${options.since}`);
  } else if (options.staged) {
    console.log('Selection mode: --staged');
  } else if (options.incremental) {
    console.log('Selection mode: --incremental');
  } else {
    console.log('Selection mode: explicit files');
  }
  console.log(`Files to index: ${files.length}\n`);

  // Resolve workspace to its real path for symlink protection
  let resolvedWorkspace: string;
  try {
    resolvedWorkspace = fs.realpathSync(workspace);
  } catch {
    throw new CliError(`Cannot resolve workspace path: ${workspace}`, 'INVALID_ARGUMENT');
  }

  // Resolve and validate file paths with symlink protection
  const resolvedFiles: string[] = [];
  for (const file of files) {
    const absolutePath = path.isAbsolute(file)
      ? file
      : path.resolve(workspace, file);

    if (!fs.existsSync(absolutePath)) {
      console.log(`\u26A0\uFE0F  File not found: ${file}`);
      continue;
    }

    // Resolve symlinks to prevent path traversal attacks
    let realPath: string;
    try {
      realPath = fs.realpathSync(absolutePath);
    } catch {
      console.log(`\u26A0\uFE0F  Cannot resolve path: ${file}`);
      continue;
    }

    // SECURITY: Validate file is within workspace BEFORE any further operations
    // This prevents information disclosure via timing/errors on external paths
    const relPath = path.relative(resolvedWorkspace, realPath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      console.log(`\u26A0\uFE0F  File outside workspace: ${file}`);
      continue;
    }

    // Now safe to stat the validated path
    let stat: fs.Stats;
    try {
      stat = fs.statSync(realPath);
    } catch {
      console.log(`\u26A0\uFE0F  Cannot stat file: ${file}`);
      continue;
    }

    if (!stat.isFile()) {
      console.log(`\u26A0\uFE0F  Not a file: ${file}`);
      continue;
    }

    resolvedFiles.push(realPath);
  }

  if (resolvedFiles.length === 0) {
    throw new CliError('No valid files to index', 'INVALID_ARGUMENT');
  }

  console.log(`Valid files: ${resolvedFiles.length}`);
  if (verbose) {
    for (const f of resolvedFiles) {
      console.log(`  - ${path.relative(workspace, f)}`);
    }
  }
  console.log('');

  const envProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const envModel = process.env.LIBRARIAN_LLM_MODEL;
  const llmProvider = envProvider === 'claude' || envProvider === 'codex' ? envProvider : undefined;
  const llmModelId = typeof envModel === 'string' && envModel.trim().length > 0 ? envModel : undefined;
  const hasLlmConfig = Boolean(llmProvider && llmModelId);
  if (verbose && !hasLlmConfig) {
    console.log('\u26A0\uFE0F  LLM not configured - proceeding without LLM enrichment. Context packs will not be regenerated.');
  }

  // Initialize librarian with proper error handling
  let initialized = false;
  let workspaceLock: WorkspaceLockHandle | null = null;
  const librarian = new LiBrainian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: hasLlmConfig ? llmProvider : undefined,
    llmModelId: hasLlmConfig ? llmModelId : undefined,
  });

  try {
    try {
      workspaceLock = await acquireWorkspaceLock(workspace, { timeoutMs: lockTimeoutMs });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (options.allowLockSkip && isStorageLockError(errorMessage)) {
        console.warn('LiBrainian index is busy (another workspace mutation is active); skipping update. Retry shortly.');
        if (verbose) {
          console.warn(`Details: ${toSingleLine(errorMessage)}`);
        }
        return;
      }
      throw new CliError(
        `LiBrainian index lock unavailable: ${toSingleLine(errorMessage)}. Run "librainian doctor --heal" if stale.`,
        'STORAGE_ERROR'
      );
    }

    ensureIndexLlmFactoryRegistered();
    await librarian.initialize();
    initialized = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.allowLockSkip && isStorageLockError(errorMessage)) {
      console.warn('LiBrainian index is busy (another process is indexing); skipping update. Retry shortly.');
      if (verbose) {
        console.warn(`Details: ${errorMessage}`);
      }
      return;
    }
    throw new CliError(
      `Failed to initialize librarian: ${errorMessage}`,
      'STORAGE_ERROR'
    );
  }

  // Track events for verbose output
  let created = 0;
  let updated = 0;
  const unsubscribe = verbose
    ? globalEventBus.on('*', (event: LiBrainianEvent) => {
        switch (event.type) {
          case 'entity_created':
            created++;
            console.log(`  + Created: ${(event.data as { entityId?: string })?.entityId || 'unknown'}`);
            break;
          case 'entity_updated':
            updated++;
            console.log(`  ~ Updated: ${(event.data as { entityId?: string })?.entityId || 'unknown'}`);
            break;
        }
      })
    : null;

  try {
    const status = await librarian.getStatus();
    if (!status.bootstrapped) {
      if (options.allowLockSkip) {
        console.warn('LiBrainian index is not bootstrapped; skipping update. Run "librarian bootstrap" to initialize.');
        return;
      }
      throw new CliError(
        'LiBrainian not bootstrapped. Run "librarian bootstrap" first.',
        'NOT_BOOTSTRAPPED'
      );
    }

    console.log(`Current index: ${status.stats.totalFunctions} functions, ${status.stats.totalModules} modules`);

    // Warn about data loss risk
    console.log('\n\u26A0\uFE0F  Note: Indexing invalidates context packs for target files.');
    console.log('   If indexing fails, run `librarian bootstrap` to regenerate.\n');

    console.log('Indexing files...\n');
    const startTime = Date.now();

    try {
      await librarian.reindexFiles(resolvedFiles);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const finalStatus = await librarian.getStatus().catch(() => null);
      const guidance = buildIndexFailureGuidance(errorMessage, finalStatus);

      throw new CliError(
        `Failed to index files: ${errorMessage}. ${guidance}`,
        'INDEX_FAILED',
        undefined,
        {
          operation: 'reindexFiles',
          stack: error instanceof Error ? error.stack : undefined,
          entitiesCreated: created,
          entitiesUpdated: updated,
        },
      );
    }

    const duration = Date.now() - startTime;
    const finalStatus = await librarian.getStatus();

    console.log('');
    console.log('=== Index Complete ===\n');
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Files indexed: ${resolvedFiles.length}`);
    if (verbose) {
      console.log(`Entities created: ${created}`);
      console.log(`Entities updated: ${updated}`);
    }
    console.log(`\nNew totals: ${finalStatus.stats.totalFunctions} functions, ${finalStatus.stats.totalModules} modules\n`);

    console.log('\u2705 Indexing successful!\n');
  } finally {
    unsubscribe?.();
    if (initialized) {
      try {
        await librarian.shutdown();
      } catch (shutdownError) {
        if (verbose) {
          console.error(`Warning: Shutdown error: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`);
        }
      }
    }
    if (workspaceLock) {
      try {
        await workspaceLock.release();
      } catch (releaseError) {
        if (verbose) {
          console.error(`Warning: Workspace lock release error: ${toSingleLine(releaseError instanceof Error ? releaseError.message : String(releaseError))}`);
        }
      }
    }
  }
}

function resolveMutationLockTimeoutMs(): number {
  const raw = process.env.LIBRARIAN_MUTATION_LOCK_TIMEOUT_MS;
  if (!raw || raw.trim().length === 0) {
    return 30_000;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 30_000;
  }
  return value;
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

async function resolveRequestedFiles(workspace: string, options: IndexCommandOptions): Promise<string[]> {
  const explicitFiles = options.files ?? [];
  const modeCount = [Boolean(options.incremental), Boolean(options.staged), Boolean(options.since)].filter(Boolean).length;

  if (modeCount > 1) {
    throw new CliError(
      'Use only one selector at a time: --incremental, --staged, or --since <ref>.',
      'INVALID_ARGUMENT'
    );
  }

  if (modeCount === 0) {
    return explicitFiles;
  }

  if (!isGitRepo(workspace)) {
    throw new CliError(
      'Incremental selectors require a git repository in the target workspace.',
      'INVALID_ARGUMENT'
    );
  }

  const fromGit = await resolveGitSelectedFiles(workspace, options);
  return dedupeStrings([...explicitFiles, ...fromGit]);
}

async function resolveGitSelectedFiles(workspace: string, options: IndexCommandOptions): Promise<string[]> {
  const changes = options.since
    ? await getGitDiffNames(workspace, options.since)
    : options.staged
      ? await getGitStagedChanges(workspace)
      : await getGitStatusChanges(workspace);

  if (!changes) return [];
  if (changes.deleted.length > 0) {
    console.log(`WARNING: Skipping ${changes.deleted.length} deleted file(s).`);
  }
  const renamed = changes.renamed ?? [];
  if (options.since && renamed.length > 0) {
    logCommitLevelRenameInsights(workspace, options.since, renamed, options.verbose === true);
  }

  return [...changes.added, ...changes.modified].map((file) => path.resolve(workspace, file));
}

function logCommitLevelRenameInsights(
  workspace: string,
  baseRef: string,
  renamedFiles: GitRename[],
  verbose: boolean
): void {
  const supportedExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go']);
  const insights: Array<{ file: string; renames: Array<{ from: string; to: string }> }> = [];

  for (const fileRename of renamedFiles.slice(0, 30)) {
    const ext = path.extname(fileRename.to).toLowerCase();
    if (!supportedExt.has(ext)) continue;

    const beforeSource = getGitFileContentAtRef(workspace, baseRef, fileRename.from);
    if (!beforeSource) continue;

    const afterPath = path.resolve(workspace, fileRename.to);
    if (!fs.existsSync(afterPath)) continue;

    let afterSource = '';
    try {
      afterSource = fs.readFileSync(afterPath, 'utf8');
    } catch {
      continue;
    }

    const renames = detectFunctionRenames(beforeSource, afterSource, fileRename.to);
    if (renames.length > 0) {
      insights.push({ file: fileRename.to, renames });
    }
  }

  if (insights.length === 0) {
    if (verbose) {
      console.log(`Commit-level diff: ${renamedFiles.length} renamed file(s), no function rename signatures detected.`);
    }
    return;
  }

  const renameCount = insights.reduce((sum, item) => sum + item.renames.length, 0);
  console.log(
    `Commit-level diff: detected ${renameCount} function rename signature(s) across ${insights.length}/${renamedFiles.length} renamed file(s).`
  );
  if (!verbose) return;

  for (const insight of insights) {
    for (const rename of insight.renames.slice(0, 6)) {
      console.log(`  - ${insight.file}: ${rename.from} -> ${rename.to}`);
    }
  }
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return deduped;
}
