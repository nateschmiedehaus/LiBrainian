/**
 * @fileoverview Bootstrap command - Initialize or refresh the knowledge index
 *
 * Now with pre-flight checks to detect problems at the earliest possible interval.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { attemptStorageRecovery, isRecoverableStorageError } from '../../storage/storage_recovery.js';
import { resolveDbPath } from '../db_path.js';
import { bootstrapProject, isBootstrapRequired, createBootstrapConfig } from '../../api/bootstrap.js';
import { checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import type { BootstrapConfig } from '../../types.js';
import { createError } from '../errors.js';
import { createSpinner, formatDuration, printKeyValue } from '../progress.js';
import type { BootstrapPhase } from '../../types.js';
import { createBootstrapProgressReporter } from '../bootstrap_progress_reporter.js';
import { ensureDailyModelSelection } from '../../adapters/model_policy.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { EXCLUDE_PATTERNS } from '../../universal_patterns.js';
import { runPreflightChecks, printPreflightReport } from '../../preflight/index.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';
import { planBootstrapRecovery } from './bootstrap_recovery.js';
import {
  buildWorkspaceSetDependencyGraph,
  loadWorkspaceSetConfig,
  persistWorkspaceSetGraphDb,
  type WorkspaceSetPackageState,
  writeWorkspaceSetState,
} from '../workspace_set.js';
import {
  scanWorkspaceLanguages,
  assessGrammarCoverage,
  getMissingGrammarPackages,
  installMissingGrammars,
} from '../grammar_support.js';
import { acquireWorkspaceLock, type WorkspaceLockHandle } from '../../integration/workspace_lock.js';

export interface BootstrapCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 1_200_000;

export async function bootstrapCommand(options: BootstrapCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  let workspaceRoot = path.resolve(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspaceRoot);
    if (resolution.changed) {
      const detail = resolution.marker
        ? `marker ${resolution.marker}`
        : 'source discovery';
      console.log(`Auto-detected project root at ${resolution.workspace} (${detail}). Using it.`);
      workspaceRoot = resolution.workspace;
    }
  }

  // Parse command-specific options
  const { values } = parseArgs({
    args: rawArgs.slice(1), // Skip 'bootstrap' command
    options: {
      force: { type: 'boolean', default: false },
      'force-resume': { type: 'boolean', default: false },
      timeout: { type: 'string', default: String(DEFAULT_BOOTSTRAP_TIMEOUT_MS) },
      scope: { type: 'string', default: 'full' },
      mode: { type: 'string', default: 'full' },
      'emit-baseline': { type: 'boolean', default: false },
      'update-agent-docs': { type: 'boolean', default: false },
      'no-claude-md': { type: 'boolean', default: false },
      'install-grammars': { type: 'boolean', default: false },
      'workspace-set': { type: 'string' },
      'llm-provider': { type: 'string' },
      'llm-model': { type: 'string' },
      'lock-timeout-ms': { type: 'string', default: '30000' },
    },
    allowPositionals: true,
    strict: false,
  });

  const force = values.force as boolean;
  const forceResume = values['force-resume'] as boolean;
  const timeoutMs = parseNonNegativeInt(values.timeout as string, 'timeout');
  const rawScope = typeof values.scope === 'string' ? values.scope.toLowerCase() : 'full';
  const scope = rawScope === 'librainian' ? 'librarian' : rawScope;
  const bootstrapModeRaw = typeof values.mode === 'string' ? values.mode.toLowerCase().trim() : 'full';
  const emitBaseline = values['emit-baseline'] as boolean;
  const updateAgentDocs = values['update-agent-docs'] as boolean;
  const noClaudeMd = values['no-claude-md'] as boolean;
  const installGrammars = values['install-grammars'] as boolean;
  const workspaceSetPath = typeof values['workspace-set'] === 'string' ? values['workspace-set'].trim() : '';
  const bootstrapMode = bootstrapModeRaw === 'full' || bootstrapModeRaw === 'fast'
    ? bootstrapModeRaw
    : (() => { throw createError('INVALID_ARGUMENT', `Unknown mode "${bootstrapModeRaw}" (use "fast" or "full")`); })();
  const requestedLlmProviderRaw = typeof values['llm-provider'] === 'string' ? values['llm-provider'].trim() : '';
  const requestedLlmProvider = requestedLlmProviderRaw === 'claude' || requestedLlmProviderRaw === 'codex'
    ? requestedLlmProviderRaw
    : undefined;
  const requestedLlmModel = typeof values['llm-model'] === 'string' ? values['llm-model'].trim() : undefined;
  const lockTimeoutRaw = typeof values['lock-timeout-ms'] === 'string' ? values['lock-timeout-ms'] : '30000';
  const lockTimeoutMs = parsePositiveInt(lockTimeoutRaw, 'lock-timeout-ms');
  const explicitLlmRequested = Boolean(requestedLlmProvider || requestedLlmModel);
  let enableLlm = explicitLlmRequested;
  let skipLlm = !enableLlm;
  let skipEmbeddings = false;
  if (force && forceResume) {
    throw createError('INVALID_ARGUMENT', 'Use either --force or --force-resume (not both).');
  }
  console.log('LiBrainian Bootstrap');
  console.log('===================\n');
  if (scope !== 'full') {
    const scopeLabel = scope === 'librarian' ? 'LiBrainian' : scope;
    console.log(`Scope: ${scopeLabel}`);
  }
  console.log(`Mode: ${bootstrapMode}`);
  if (explicitLlmRequested) {
    console.log('LLM: requested');
  } else {
    console.log('LLM: auto (enabled when providers are ready)');
  }
  console.log(`Agent docs update: ${updateAgentDocs ? 'enabled' : 'disabled (opt-in)'}`);
  if (updateAgentDocs) {
    console.log(`CLAUDE.md injection: ${noClaudeMd ? 'disabled (--no-claude-md)' : 'enabled'}`);
  }
  if (workspaceSetPath) {
    console.log(`Workspace set: ${workspaceSetPath}`);
  }

  const runBootstrapFlow = async (
    runWorkspaceRoot: string,
    runScope: string,
    includeOverride?: string[],
    excludeOverride?: string[]
  ): Promise<void> => {
    // Run pre-flight checks FIRST to detect problems early
    console.log('Running pre-flight checks...\n');
    const skipProviders =
      (process.env.LIBRAINIAN_SKIP_PROVIDER_CHECK ?? process.env.LIBRARIAN_SKIP_PROVIDER_CHECK) === '1'
      || !explicitLlmRequested;
    const preflightReport = await runPreflightChecks({
      workspaceRoot: runWorkspaceRoot,
      skipProviderChecks: skipProviders,
      forceProbe: explicitLlmRequested,
      verbose: true,
    });

    if (!preflightReport.canProceed) {
      printPreflightReport(preflightReport);
      throw createError(
        'PREFLIGHT_FAILED',
        `Pre-flight checks failed: ${preflightReport.failedChecks.map(c => c.name).join(', ')}`
      );
    }

    if (preflightReport.warnings.length > 0) {
      console.log('\nWarnings detected but proceeding:');
      for (const warning of preflightReport.warnings) {
        console.log(`  \u26A0\uFE0F  ${warning.name}: ${warning.message}`);
      }
      console.log();
    }

    const grammarSpinner = createSpinner('Checking parser coverage...');
    let grammarCoverage = await (async () => {
      const scan = await scanWorkspaceLanguages(runWorkspaceRoot);
      return assessGrammarCoverage(scan);
    })();
    const missingGrammarPackages = getMissingGrammarPackages(grammarCoverage);
    if (installGrammars && missingGrammarPackages.length > 0) {
      grammarSpinner.update(`Installing missing grammars (${missingGrammarPackages.join(', ')})...`);
      const installResult = await installMissingGrammars(runWorkspaceRoot, grammarCoverage);
      if (installResult.success) {
        grammarCoverage = await (async () => {
          const scan = await scanWorkspaceLanguages(runWorkspaceRoot);
          return assessGrammarCoverage(scan);
        })();
        grammarSpinner.succeed('Grammar packages installed');
      } else {
        grammarSpinner.fail('Grammar package installation failed');
        console.log(`⚠️  Grammar install failed: ${installResult.error ?? 'unknown error'}`);
      }
    } else {
      grammarSpinner.succeed('Parser coverage checked');
    }

    if (grammarCoverage.languagesDetected.length === 0) {
      console.log('⚠️  No code languages detected in workspace.');
    } else {
      const coverageWarnings: string[] = [];
      if (grammarCoverage.missingTreeSitterCore) {
        coverageWarnings.push('tree-sitter core missing');
      }
      if (grammarCoverage.missingGrammarModules.length > 0) {
        coverageWarnings.push(`missing grammars: ${grammarCoverage.missingGrammarModules.join(', ')}`);
      }
      if (grammarCoverage.missingLanguageConfigs.length > 0) {
        coverageWarnings.push(`missing configs: ${grammarCoverage.missingLanguageConfigs.join(', ')}`);
      }
      if (coverageWarnings.length > 0) {
        console.log(`⚠️  Parser coverage incomplete: ${coverageWarnings.join('; ')}`);
        if (!installGrammars && missingGrammarPackages.length > 0) {
          console.log('   Run `librainian bootstrap --install-grammars` to install missing grammar packages.');
        }
      }
    }

    let enableLlm = explicitLlmRequested;
    let skipLlm = !enableLlm;
    let skipEmbeddings = false;

    const providerSpinner = createSpinner('Verifying provider configuration...');
    let providerStatus: AllProviderStatus | null = null;
    try {
      const providerCheckSkipped =
        (process.env.LIBRAINIAN_SKIP_PROVIDER_CHECK ?? process.env.LIBRARIAN_SKIP_PROVIDER_CHECK) === '1';
      if (providerCheckSkipped) {
        providerSpinner.succeed('Provider checks skipped (offline/degraded mode)');
        skipEmbeddings = true;
      } else {
        providerStatus = await checkAllProviders({ workspaceRoot: runWorkspaceRoot, forceProbe: explicitLlmRequested });
        const llmOk = providerStatus.llm.available;
        const embedOk = providerStatus.embedding.available;
        if (explicitLlmRequested && llmOk && embedOk) {
          providerSpinner.succeed('Providers available');
        } else if (!explicitLlmRequested && embedOk) {
          providerSpinner.succeed('Embedding provider available');
        } else {
          providerSpinner.succeed('Providers limited (continuing in degraded mode)');
        }
        if (!embedOk) {
          skipEmbeddings = true;
        }
      }
    } catch (error) {
      providerSpinner.succeed('Provider check failed (continuing in degraded mode)');
      providerStatus = null;
      skipEmbeddings = true;
    }

    if (!explicitLlmRequested) {
      enableLlm = Boolean(providerStatus?.llm.available);
      skipLlm = !enableLlm;
    } else if (providerStatus && !providerStatus.llm.available) {
      console.log('⚠️  LLM provider unavailable - continuing without LLM enrichment.');
      enableLlm = false;
      skipLlm = true;
    }
    if (skipLlm) {
      console.log('LLM: disabled (heuristic mode)');
    }
    if (skipEmbeddings) {
      console.log('Embeddings: disabled (semantic search limited)');
    }

    let llmProvider: 'claude' | 'codex' | undefined;
    let llmModelId: string | undefined;
    if (enableLlm) {
      llmProvider = requestedLlmProvider ?? (
        providerStatus?.llm.provider === 'claude' || providerStatus?.llm.provider === 'codex'
          ? providerStatus!.llm.provider
          : 'claude'
      );
      const dailySelection = await ensureDailyModelSelection(runWorkspaceRoot, {
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
        providerStatus && providerStatus.llm.provider === llmProvider && providerStatus.llm.model !== 'unknown'
          ? providerStatus.llm.model
          : 'unknown';
      llmModelId = selectedModel
        ?? (providerStatusModel !== 'unknown' ? providerStatusModel : undefined)
        ?? resolveLibrarianModelId(llmProvider)
        ?? (llmProvider === 'codex' ? 'gpt-5.1-codex-mini' : 'claude-haiku-4-5-20241022');
    }

    const storageSpinner = createSpinner('Initializing storage...');
    const lockSpinner = createSpinner('Acquiring workspace bootstrap lock...');
    const dbPath = await resolveDbPath(runWorkspaceRoot);
    let storage = createSqliteStorage(dbPath, runWorkspaceRoot);
    let workspaceLock: WorkspaceLockHandle | null = null;
    const progressReporter = createBootstrapProgressReporter();

    try {
      try {
        workspaceLock = await acquireWorkspaceLock(runWorkspaceRoot, { timeoutMs: lockTimeoutMs });
        lockSpinner.succeed('Workspace bootstrap lock acquired');
      } catch (error) {
        lockSpinner.fail('Workspace bootstrap lock unavailable');
        const detail = toSingleLine(error instanceof Error ? error.message : String(error));
        throw createError(
          'STORAGE_ERROR',
          `LiBrainian bootstrap lock unavailable: ${detail}. Run \`librainian doctor --heal\` if stale.`
        );
      }

      try {
        await storage.initialize();
        storageSpinner.succeed('Storage initialized');
      } catch (error) {
        storageSpinner.fail('Storage initialization failed');
        const canRecover = process.env.LIBRARIAN_DISABLE_STORAGE_RECOVERY !== '1' && isRecoverableStorageError(error);
        if (canRecover) {
          console.log('Attempting storage recovery (clearing stale locks/WAL)...');
          const recovery = await attemptStorageRecovery(dbPath, { error });
          if (recovery.recovered) {
            storage = createSqliteStorage(dbPath, runWorkspaceRoot);
            await storage.initialize();
            storageSpinner.succeed('Storage initialized after recovery');
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      if (!force) {
        const checkSpinner = createSpinner('Checking bootstrap status...');
        const bootstrapCheck = await isBootstrapRequired(runWorkspaceRoot, storage, { targetQualityTier: bootstrapMode === 'full' ? 'full' : 'mvp' });

        if (!bootstrapCheck.required) {
          checkSpinner.succeed('Bootstrap not required');
          console.log(`\nReason: ${bootstrapCheck.reason}`);
          console.log('\nUse --force to force a full reindex.');
          return;
        }
        checkSpinner.succeed(`Bootstrap required: ${bootstrapCheck.reason}`);
      }

      console.log('\nStarting bootstrap process...\n');

      const startTime = Date.now();

      const scopeOverrides = resolveScopeOverrides(runScope, bootstrapMode);
      const resolvedInclude = includeOverride ?? scopeOverrides.include;
      const resolvedExclude = excludeOverride ?? scopeOverrides.exclude;
      const configOverrides: Partial<BootstrapConfig> = {
        bootstrapMode,
        timeoutMs,
        skipLlm,
        skipEmbeddings,
        llmProvider,
        llmModelId,
        emitBaseline,
        emitInstallManifest: true,
        updateAgentDocs,
        noClaudeMd,
        ...scopeOverrides,
        forceReindex: force,
        forceResume,
        progressCallback: (phase: BootstrapPhase, progress: number, details?: { total?: number; current?: number; currentFile?: string }) => {
          progressReporter.onProgress(phase, progress, details);
        },
      };
      if (resolvedInclude !== undefined) {
        configOverrides.include = resolvedInclude;
      }
      if (resolvedExclude !== undefined) {
        configOverrides.exclude = resolvedExclude;
      }
      const config = createBootstrapConfig(runWorkspaceRoot, configOverrides);

      const report = await withBootstrapCommandTimeout(
        timeoutMs,
        () => bootstrapProject(config, storage)
      );
      progressReporter.complete();

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

      if (report.codebaseBriefing) {
        const roleSummary = report.codebaseBriefing.roleCounts
          .filter((entry) => entry.count > 0)
          .map((entry) => `${entry.role}:${entry.count}`)
          .join(', ');
        printKeyValue([
          { key: 'Briefing Path', value: report.codebaseBriefing.path },
          { key: 'Frameworks', value: report.codebaseBriefing.frameworks.join(', ') || 'none detected' },
          { key: 'Primary Language', value: report.codebaseBriefing.primaryLanguage },
          { key: 'Entry Points', value: String(report.codebaseBriefing.keyEntryPoints.length) },
          { key: 'Role Coverage', value: roleSummary || 'none detected' },
        ]);
      }

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
        console.log('Run `librainian status` for more details.');
      } else {
        console.log('\nLiBrainian is ready! Run `librainian query \"<intent>\"` to search the knowledge base.');
      }
    } finally {
      progressReporter.complete();
      await storage.close();
      if (workspaceLock) {
        await workspaceLock.release().catch(() => {});
      }
    }
  };

  const autoRetryEnabled = process.env.LIBRARIAN_DISABLE_BOOTSTRAP_AUTORETRY !== '1';

  const runBootstrapWithAutoRetry = async (
    initialWorkspaceRoot: string,
    initialScope: string,
    initialIncludeOverride?: string[],
    initialExcludeOverride?: string[],
  ): Promise<void> => {
    let attempt = 0;
    let currentWorkspaceRoot = initialWorkspaceRoot;
    let currentScope = initialScope;
    let includeOverride = initialIncludeOverride;
    let excludeOverride = initialExcludeOverride;

    while (true) {
      try {
        await runBootstrapFlow(currentWorkspaceRoot, currentScope, includeOverride, excludeOverride);
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attempt === 0 && autoRetryEnabled) {
          const plan = planBootstrapRecovery({
            workspaceRoot: currentWorkspaceRoot,
            scope: currentScope,
            errorMessage,
          });
          if (plan) {
            console.log(`\nRetrying bootstrap: ${plan.reason}`);
            if (plan.workspaceRoot) {
              currentWorkspaceRoot = plan.workspaceRoot;
            }
            if (plan.scopeOverride) {
              currentScope = plan.scopeOverride;
            }
            includeOverride = plan.include ?? includeOverride;
            excludeOverride = plan.exclude ?? excludeOverride;
            attempt += 1;
            continue;
          }
        }
        throw error;
      }
    }
  };

  if (workspaceSetPath) {
    const workspaceSet = await loadWorkspaceSetConfig(workspaceSetPath, workspaceRoot);
    const graph = await buildWorkspaceSetDependencyGraph(workspaceSet);
    const sharedDb = await persistWorkspaceSetGraphDb(workspaceSet, graph);
    const packageStates: WorkspaceSetPackageState[] = [];
    let bootstrapError: unknown;

    console.log(`\nWorkspace-set root: ${workspaceSet.root}`);
    console.log(`Packages: ${workspaceSet.packages.length}`);
    console.log(`Cross-package edges: ${graph.edges.length}`);
    if (sharedDb) {
      console.log(`Cross-package graph DB: ${sharedDb}`);
    }

    for (const pkg of workspaceSet.packages) {
      console.log(`\n=== [workspace-set] ${pkg.name} (${pkg.relativePath}) ===\n`);
      const dbPath = await resolveDbPath(pkg.path);
      try {
        await runBootstrapWithAutoRetry(pkg.path, scope, pkg.include, pkg.exclude);
        packageStates.push({
          name: pkg.name,
          path: pkg.path,
          dbPath,
          status: 'ready',
        });
      } catch (error) {
        packageStates.push({
          name: pkg.name,
          path: pkg.path,
          dbPath,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        bootstrapError = error;
        break;
      }
    }

    const statePath = await writeWorkspaceSetState(workspaceSet.root, {
      kind: 'WorkspaceSetState.v1',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      root: workspaceSet.root,
      configPath: workspaceSet.configPath,
      sharedDb,
      packages: packageStates,
      graph,
    });
    console.log(`\nWorkspace-set state written: ${statePath}`);

    if (bootstrapError) {
      throw bootstrapError;
    }
    return;
  }

  await runBootstrapWithAutoRetry(workspaceRoot, scope);
}

function resolveScopeOverrides(scope: string, bootstrapMode: 'fast' | 'full' = 'full'): Partial<BootstrapConfig> {
  if (!scope || scope === 'full') {
    return {};
  }
  if (scope === 'librarian') {
    const include = [
      // Actual Librarian source directories
      'src/api/**/*.ts',
      'src/agents/**/*.ts',
      'src/cli/**/*.ts',
      'src/config/**/*.ts',
      'src/knowledge/**/*.ts',
      'src/storage/**/*.ts',
      'src/ingest/**/*.ts',
      'src/preflight/**/*.ts',
      'src/utils/**/*.ts',
      'src/graphs/**/*.ts',
      'src/strategic/**/*.ts',
      'src/epistemics/**/*.ts',
      'src/bootstrap/**/*.ts',
      'src/metrics/**/*.ts',
      'src/core/**/*.ts',
      'src/analysis/**/*.ts',
      'src/adapters/**/*.ts',
      'src/engines/**/*.ts',
      'src/evolution/**/*.ts',
      'src/federation/**/*.ts',
      'src/guidance/**/*.ts',
      'src/homeostasis/**/*.ts',
      'src/integration/**/*.ts',
      'src/connectors/**/*.ts',
      'src/learning/**/*.ts',
      'src/mcp/**/*.ts',
      'src/measurement/**/*.ts',
      'src/methods/**/*.ts',
      'src/migrations/**/*.ts',
      'src/orchestrator/**/*.ts',
      'src/providers/**/*.ts',
      'src/quality/**/*.ts',
      'src/query/**/*.ts',
      'src/recommendations/**/*.ts',
      'src/security/**/*.ts',
      'src/skills/**/*.ts',
      'src/spine/**/*.ts',
      'src/state/**/*.ts',
      'src/telemetry/**/*.ts',
      'src/constructions/**/*.ts',
      'src/types.ts',
      'src/index.ts',
      'src/events.ts',
      'src/universal_patterns.ts',
      // Docs (correct paths - at repo root, not docs/)
      'AGENTS.md',
      'docs/**/*.md',
    ];
    const exclude = [...EXCLUDE_PATTERNS];
    // Keep bootstrap runtime bounded for dogfood/clean-clone flows by excluding tests.
    // Tests are high-volume and not required for core runtime retrieval bootstrap.
    exclude.push('src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.spec.ts');
    return {
      include,
      exclude,
    };
  }
  throw createError('INVALID_ARGUMENT', `Unknown scope \"${scope}\" (use \"full\", \"librarian\", or \"librainian\")`);
}

function parsePositiveInt(raw: string, optionName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError('INVALID_ARGUMENT', `--${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(raw: string, optionName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError('INVALID_ARGUMENT', `--${optionName} must be a non-negative integer`);
  }
  return parsed;
}

async function withBootstrapCommandTimeout<T>(
  timeoutMs: number,
  run: () => Promise<T>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run();
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const nextTimeoutMs = Math.max(Math.round(timeoutMs * 1.5), timeoutMs + 1000);
      reject(
        createError(
          'TIMEOUT',
          `Bootstrap timed out after ${timeoutMs}ms. Run \`librainian doctor --heal\` and retry with \`--timeout ${nextTimeoutMs}\`.`
        )
      );
    }, timeoutMs);

    run()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export const __testing = {
  resolveScopeOverrides,
  parseNonNegativeInt,
  withBootstrapCommandTimeout,
};
