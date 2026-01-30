/**
 * @fileoverview Bootstrap command - Initialize or refresh the knowledge index
 *
 * Now with pre-flight checks to detect problems at the earliest possible interval.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { resolveDbPath } from '../db_path.js';
import { bootstrapProject, isBootstrapRequired, createBootstrapConfig } from '../../api/bootstrap.js';
import { requireProviders, checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import { BOOTSTRAP_PHASES, type BootstrapConfig } from '../../types.js';
import { createError } from '../errors.js';
import { createSpinner, createProgressBar, formatDuration, printKeyValue, type ProgressBarHandle } from '../progress.js';
import type { BootstrapPhase } from '../../types.js';
import { ensureDailyModelSelection } from '../../adapters/model_policy.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { EXCLUDE_PATTERNS } from '../../universal_patterns.js';
import { runPreflightChecks, printPreflightReport } from '../../preflight/index.js';

export interface BootstrapCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function bootstrapCommand(options: BootstrapCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const workspaceRoot = path.resolve(workspace);

  // Parse command-specific options
  const { values } = parseArgs({
    args: rawArgs.slice(1), // Skip 'bootstrap' command
    options: {
      force: { type: 'boolean', default: false },
      'force-resume': { type: 'boolean', default: false },
      timeout: { type: 'string', default: '0' },
      scope: { type: 'string', default: 'full' },
      mode: { type: 'string', default: 'fast' },
      'llm-provider': { type: 'string' },
      'llm-model': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const force = values.force as boolean;
  const forceResume = values['force-resume'] as boolean;
  const timeoutMs = parseInt(values.timeout as string, 10);
  const scope = typeof values.scope === 'string' ? values.scope.toLowerCase() : 'full';
  const bootstrapModeRaw = typeof values.mode === 'string' ? values.mode.toLowerCase().trim() : 'fast';
  const bootstrapMode = bootstrapModeRaw === 'full' || bootstrapModeRaw === 'fast'
    ? bootstrapModeRaw
    : (() => { throw createError('INVALID_ARGUMENT', `Unknown mode "${bootstrapModeRaw}" (use "fast" or "full")`); })();
  const requestedLlmProviderRaw = typeof values['llm-provider'] === 'string' ? values['llm-provider'].trim() : '';
  const requestedLlmProvider = requestedLlmProviderRaw === 'claude' || requestedLlmProviderRaw === 'codex'
    ? requestedLlmProviderRaw
    : undefined;
  const requestedLlmModel = typeof values['llm-model'] === 'string' ? values['llm-model'].trim() : undefined;
  if (force && forceResume) {
    throw createError('INVALID_ARGUMENT', 'Use either --force or --force-resume (not both).');
  }
  if (timeoutMs > 0) {
    throw createError('INVALID_ARGUMENT', 'Timeouts are not allowed for librarian bootstrap');
  }

  console.log('Librarian Bootstrap');
  console.log('===================\n');
  if (scope !== 'full') {
    console.log(`Scope: ${scope}`);
  }
  console.log(`Mode: ${bootstrapMode}`);

  // Run pre-flight checks FIRST to detect problems early
  console.log('Running pre-flight checks...\n');
  const preflightReport = await runPreflightChecks({
    workspaceRoot,
    skipProviderChecks: false, // Will check providers
    forceProbe: true, // Bootstrap-grade provider probe (fail fast on usage/rate/model issues)
    verbose: true,
  });

  if (!preflightReport.canProceed) {
    printPreflightReport(preflightReport);
    throw createError(
      'PREFLIGHT_FAILED',
      `Pre-flight checks failed: ${preflightReport.failedChecks.map(c => c.name).join(', ')}`
    );
  }

  // Show warnings if any
  if (preflightReport.warnings.length > 0) {
    console.log('\nWarnings detected but proceeding:');
    for (const warning of preflightReport.warnings) {
      console.log(`  \u26A0\uFE0F  ${warning.name}: ${warning.message}`);
    }
    console.log();
  }

  // Check providers (detailed check after preflight)
  const providerSpinner = createSpinner('Verifying provider configuration...');
  let providerStatus: AllProviderStatus;
  try {
    await requireProviders({ llm: true, embedding: true }, { workspaceRoot, forceProbe: true });
    providerStatus = await checkAllProviders({ workspaceRoot });
    providerSpinner.succeed('Providers available');
  } catch (error) {
    providerSpinner.fail('Provider check failed');
    throw createError(
      'PROVIDER_UNAVAILABLE',
      error instanceof Error ? error.message : 'Provider unavailable',
    );
  }

  // Resolve LLM provider and model from the gate result
  const llmProvider = requestedLlmProvider ?? (
    providerStatus.llm.provider === 'claude' || providerStatus.llm.provider === 'codex'
      ? providerStatus.llm.provider
      : 'claude' // Default to claude if provider name doesn't match
  );
  const dailySelection = await ensureDailyModelSelection(workspaceRoot, {
    defaultProvider: llmProvider,
    applyEnv: false,
  });
  const policyModel = dailySelection?.providers[llmProvider]?.model_id;
  const selectedModel = requestedLlmModel ?? (
    llmProvider === 'codex' ? 'gpt-5.1-codex-mini' : policyModel
  );
  if (selectedModel && !requestedLlmModel) {
    process.env.LIBRARIAN_LLM_PROVIDER = llmProvider;
    process.env.LIBRARIAN_LLM_MODEL = selectedModel;
  } else if (requestedLlmModel) {
    process.env.LIBRARIAN_LLM_PROVIDER = llmProvider;
    process.env.LIBRARIAN_LLM_MODEL = requestedLlmModel;
  }
  const providerStatusModel =
    providerStatus.llm.provider === llmProvider && providerStatus.llm.model !== 'unknown'
      ? providerStatus.llm.model
      : 'unknown';
  const llmModelId = selectedModel
    ?? (providerStatusModel !== 'unknown' ? providerStatusModel : undefined)
    ?? resolveLibrarianModelId(llmProvider)
    ?? (llmProvider === 'codex' ? 'gpt-5.1-codex-mini' : 'claude-haiku-4-5-20241022');

  // Initialize storage (with migration from .db to .sqlite if needed)
  const storageSpinner = createSpinner('Initializing storage...');
  const dbPath = await resolveDbPath(workspaceRoot);
  const storage = createSqliteStorage(dbPath, workspaceRoot);

  try {
    try {
      await storage.initialize();
      storageSpinner.succeed('Storage initialized');
    } catch (error) {
      storageSpinner.fail('Storage initialization failed');
      throw error;
    }

    // Check if bootstrap is needed
    if (!force) {
      const checkSpinner = createSpinner('Checking bootstrap status...');
      const bootstrapCheck = await isBootstrapRequired(workspaceRoot, storage, { targetQualityTier: bootstrapMode === 'full' ? 'full' : 'mvp' });

      if (!bootstrapCheck.required) {
        checkSpinner.succeed('Bootstrap not required');
        console.log(`\nReason: ${bootstrapCheck.reason}`);
        console.log('\nUse --force to force a full reindex.');
        return;
      }
      checkSpinner.succeed(`Bootstrap required: ${bootstrapCheck.reason}`);
    }

    console.log('\nStarting bootstrap process...\n');

    // Track phase progress
    let currentPhaseIndex = 0;
    let phaseProgressBar: ProgressBarHandle | null = null;
    const startTime = Date.now();

    // Create bootstrap config with progress callback and LLM provider
    // Real embedding providers (xenova/sentence-transformers) are configured automatically
    const config = createBootstrapConfig(workspaceRoot, {
      bootstrapMode,
      timeoutMs: undefined,
      llmProvider,
      llmModelId,
      ...resolveScopeOverrides(scope),
      forceReindex: force,
      forceResume,
      progressCallback: (phase: BootstrapPhase, progress: number) => {
        const phaseIndex = BOOTSTRAP_PHASES.findIndex((p) => p.name === phase.name);
        if (phaseIndex !== currentPhaseIndex) {
          // New phase started
          if (phaseProgressBar) {
            phaseProgressBar.stop();
          }
          currentPhaseIndex = phaseIndex;
          console.log(`\n[${phaseIndex + 1}/${BOOTSTRAP_PHASES.length}] ${phase.description}`);

          // Create progress bar for indexing phase
          if (phase.name === 'semantic_indexing') {
            phaseProgressBar = createProgressBar({
              total: 100,
              format: '{bar} {percentage}% | {task} | ETA: {eta_formatted}',
            });
          }
        }

        // Update progress bar
        if (phaseProgressBar && phase.name === 'semantic_indexing') {
          phaseProgressBar.update(Math.round(progress * 100), { task: 'Indexing files' });
        }
      },
    });

    // Run bootstrap
    const report = await bootstrapProject(config, storage);

    // Cleanup progress bar
    if (phaseProgressBar !== null) {
      (phaseProgressBar as ProgressBarHandle).stop();
    }

    const elapsed = Date.now() - startTime;

    console.log('\n\nBootstrap Complete!');
    console.log('==================\n');

    printKeyValue([
      { key: 'Status', value: report.success ? 'Success' : 'Failed' },
      { key: 'Duration', value: formatDuration(elapsed) },
      { key: 'Files Processed', value: report.totalFilesProcessed },
      { key: 'Functions Indexed', value: report.totalFunctionsIndexed },
      { key: 'Context Packs Created', value: report.totalContextPacksCreated },
      { key: 'Version', value: report.version.string },
    ]);

    if (report.error) {
      console.log(`\nError: ${report.error}`);
    }

    console.log('\nPhase Summary:');
    for (const phaseResult of report.phases) {
      const status = phaseResult.errors.length > 0 ? 'with errors' : 'OK';
      console.log(`  - ${phaseResult.phase.name}: ${formatDuration(phaseResult.durationMs)} (${status})`);
      if (phaseResult.errors.length > 0 && phaseResult.errors.length <= 3) {
        for (const err of phaseResult.errors) {
          console.log(`      Error: ${err}`);
        }
      } else if (phaseResult.errors.length > 3) {
        console.log(`      ${phaseResult.errors.length} errors (showing first 3)`);
        for (const err of phaseResult.errors.slice(0, 3)) {
          console.log(`      Error: ${err}`);
        }
      }
    }

    if (!report.success) {
      console.log('\nBootstrap completed with errors. Some features may be limited.');
      console.log('Run `librarian status` for more details.');
    } else {
      console.log('\nLibrarian is ready! Run `librarian query "<intent>"` to search the knowledge base.');
    }

  } finally {
    await storage.close();
  }
}

function resolveScopeOverrides(scope: string): Partial<BootstrapConfig> {
  if (!scope || scope === 'full') {
    return {};
  }
  if (scope === 'librarian') {
    return {
      include: [
        'src/librarian/**/*',
        'docs/librarian/**/*',
        'docs/AGENTS.md',
        'docs/TEST.md',
        'docs/LIVE_PROVIDERS_PLAYBOOK.md',
        'docs/librarian-integration.md',
        'docs/AUTHENTICATION.md',
        'src/EMBEDDING_RULES.md',
      ],
      exclude: [...EXCLUDE_PATTERNS],
    };
  }
  throw createError('INVALID_ARGUMENT', `Unknown scope \"${scope}\" (use \"full\" or \"librarian\")`);
}
