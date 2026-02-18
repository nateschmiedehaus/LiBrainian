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
import { Librarian } from '../../api/librarian.js';
import { CliError } from '../errors.js';
import { globalEventBus, type LibrarianEvent } from '../../events.js';
import { getGitDiffNames, getGitStagedChanges, getGitStatusChanges, isGitRepo } from '../../utils/git.js';

export interface IndexCommandOptions {
  workspace?: string;
  verbose?: boolean;
  force?: boolean;
  files: string[];
  incremental?: boolean;
  staged?: boolean;
  since?: string;
}

export async function indexCommand(options: IndexCommandOptions): Promise<void> {
  const workspace = options.workspace || process.cwd();
  const verbose = options.verbose ?? false;
  const force = options.force ?? false;
  const files = await resolveRequestedFiles(workspace, options);

  if (!files || files.length === 0) {
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

  console.log('\n=== Librarian Index ===\n');
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
  const librarian = new Librarian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: hasLlmConfig ? llmProvider : undefined,
    llmModelId: hasLlmConfig ? llmModelId : undefined,
  });

  try {
    await librarian.initialize();
    initialized = true;
  } catch (error) {
    throw new CliError(
      `Failed to initialize librarian: ${error instanceof Error ? error.message : String(error)}`,
      'STORAGE_ERROR'
    );
  }

  // Track events for verbose output
  let created = 0;
  let updated = 0;
  const unsubscribe = verbose
    ? globalEventBus.on('*', (event: LibrarianEvent) => {
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
      throw new CliError(
        'Librarian not bootstrapped. Run "librarian bootstrap" first.',
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
      console.error('\n\u274C Indexing failed\n');

      if (error instanceof Error) {
        console.error(`Error: ${error.message}\n`);

        if (error.message.includes('ProviderUnavailable') || error.message.includes('provider')) {
          console.error('The LLM provider is unavailable or not configured correctly.');
          console.error('Check your API credentials and network connection.\n');
        } else if (error.message.includes('lock') || error.message.includes('SQLITE_BUSY')) {
          console.error('Database lock conflict detected.');
          console.error('Another process may be accessing the database.\n');
        } else if (error.message.includes('extract') || error.message.includes('parse')) {
          console.error('Failed to extract or parse file content.');
          console.error('One or more files may have syntax errors or unsupported formats.\n');
        }

        if (verbose && error.stack) {
          console.error('Stack trace:');
          console.error(error.stack);
          console.error('');
        }
      } else {
        console.error(`Unknown error: ${String(error)}\n`);
      }

      const finalStatus = await librarian.getStatus().catch((err) => {
        if (verbose) {
          console.error(`Could not retrieve status: ${err instanceof Error ? err.message : String(err)}`);
        }
        return null;
      });
      if (finalStatus) {
        console.error('\u26A0\uFE0F  Context packs for indexed files have been invalidated.');
        console.error('   Run "librarian bootstrap" to regenerate them.');
        console.error(`Current totals: ${finalStatus.stats.totalFunctions} functions, ${finalStatus.stats.totalModules} modules\n`);
      } else {
        console.error('\u26A0\uFE0F  Database may be in an unknown state. Run "librarian bootstrap" to recover.\n');
      }

      if (verbose && (created > 0 || updated > 0)) {
        console.error('Partial progress before failure:');
        console.error(`  Entities created: ${created}`);
        console.error(`  Entities updated: ${updated}\n`);
      }

      throw new CliError(
        `Failed to index files: ${error instanceof Error ? error.message : String(error)}`,
        'INDEX_FAILED'
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
  }
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
  const merged = dedupeStrings([...explicitFiles, ...fromGit]);
  if (merged.length === 0) {
    if (options.since) {
      throw new CliError(`No changed files found for --since ${options.since}.`, 'INVALID_ARGUMENT');
    }
    if (options.staged) {
      throw new CliError('No staged files found to index.', 'INVALID_ARGUMENT');
    }
    throw new CliError('No modified files found to index.', 'INVALID_ARGUMENT');
  }

  return merged;
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

  return [...changes.added, ...changes.modified].map((file) => path.resolve(workspace, file));
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
