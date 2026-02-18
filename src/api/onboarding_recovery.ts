import type { BootstrapConfig, BootstrapReport } from '../types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LibrarianStorage } from '../storage/types.js';
import type { AllProviderStatus } from './provider_check.js';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import {
  attemptStorageRecovery,
  cleanupWorkspaceLocks,
  isRecoverableStorageError,
} from '../storage/storage_recovery.js';
import { checkAllProviders } from './provider_check.js';
import { bootstrapProject, createBootstrapConfig, isBootstrapRequired } from './bootstrap.js';
import { planBootstrapRecovery } from '../bootstrap/bootstrap_recovery.js';
import { diagnoseConfiguration, autoHealConfiguration } from '../config/self_healing.js';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';

const SQLITE_FILENAME = 'librarian.sqlite';
const LEGACY_DB_FILENAME = 'librarian.db';

async function resolveDbPathForWorkspace(workspaceRoot: string): Promise<string> {
  const librarianDir = path.join(workspaceRoot, '.librarian');
  const sqlitePath = path.join(librarianDir, SQLITE_FILENAME);
  const legacyPath = path.join(librarianDir, LEGACY_DB_FILENAME);

  try {
    await fs.mkdir(librarianDir, { recursive: true });
  } catch {
    // Ignore; bootstrap will surface invalid paths.
  }

  try {
    await fs.access(sqlitePath);
    return sqlitePath;
  } catch {
    // Continue to legacy checks.
  }

  try {
    await fs.access(legacyPath);
    await fs.rename(legacyPath, sqlitePath);
    return sqlitePath;
  } catch {
    // No legacy DB found.
  }

  return sqlitePath;
}

export interface OnboardingConfigHealResult {
  attempted: boolean;
  success: boolean;
  appliedFixes: number;
  failedFixes: number;
  newHealthScore?: number;
  error?: string;
}

export interface OnboardingStorageRecoveryResult {
  attempted: boolean;
  recovered: boolean;
  actions: string[];
  errors: string[];
  workspaceLocks?: {
    lockDirs: string[];
    scannedFiles: number;
    staleFiles: number;
    activePidFiles: number;
    unknownFreshFiles: number;
    removedFiles: number;
    errors: string[];
  };
}

export interface OnboardingBootstrapResult {
  required: boolean;
  attempted: boolean;
  success: boolean;
  retries: number;
  skipEmbeddings: boolean;
  skipLlm: boolean;
  report?: BootstrapReport;
  error?: string;
}

export interface OnboardingRecoveryResult {
  configHeal?: OnboardingConfigHealResult;
  storageRecovery?: OnboardingStorageRecoveryResult;
  providerStatus?: AllProviderStatus | null;
  bootstrap?: OnboardingBootstrapResult;
  errors: string[];
}

export interface OnboardingRecoveryOptions {
  workspace: string;
  dbPath: string;
  autoHealConfig?: boolean;
  riskTolerance?: 'safe' | 'low' | 'medium';
  allowDegradedEmbeddings?: boolean;
  bootstrapMode?: 'full' | 'fast';
  emitBaseline?: boolean;
  updateAgentDocs?: boolean;
  forceBootstrap?: boolean;
  storage?: LibrarianStorage;
}

export async function runOnboardingRecovery(
  options: OnboardingRecoveryOptions
): Promise<OnboardingRecoveryResult> {
  const {
    workspace,
    dbPath,
    autoHealConfig = true,
    riskTolerance = 'low',
    allowDegradedEmbeddings = true,
    bootstrapMode = 'full',
    emitBaseline = false,
    updateAgentDocs = false,
    forceBootstrap = false,
    storage: providedStorage,
  } = options;

  const result: OnboardingRecoveryResult = {
    errors: [],
  };

  let activeWorkspace = workspace;
  let activeDbPath = dbPath;
  if (!providedStorage && process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(activeWorkspace);
    if (resolution.changed) {
      activeWorkspace = resolution.workspace;
      activeDbPath = await resolveDbPathForWorkspace(activeWorkspace);
    }
  }

  if (autoHealConfig) {
    try {
      const configReport = await diagnoseConfiguration(activeWorkspace);
      if (!configReport.isOptimal && configReport.autoFixable.length > 0) {
        const healResult = await autoHealConfiguration(activeWorkspace, { riskTolerance });
        result.configHeal = {
          attempted: true,
          success: healResult.success,
          appliedFixes: healResult.appliedFixes.length,
          failedFixes: healResult.failedFixes.length,
          newHealthScore: healResult.newHealthScore,
          error: healResult.success ? undefined : 'configuration_heal_failed',
        };
      } else {
        result.configHeal = {
          attempted: false,
          success: true,
          appliedFixes: 0,
          failedFixes: 0,
          newHealthScore: configReport.healthScore,
        };
      }
    } catch (error) {
      result.configHeal = {
        attempted: true,
        success: false,
        appliedFixes: 0,
        failedFixes: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      result.errors.push(result.configHeal.error ?? 'config_heal_failed');
    }
  }

  let storage: LibrarianStorage | null = providedStorage ?? null;
  let ownsStorage = false;

  if (!storage) {
    storage = createSqliteStorage(activeDbPath, activeWorkspace);
    ownsStorage = true;
  }

  const storageRecovery: OnboardingStorageRecoveryResult = {
    attempted: false,
    recovered: false,
    actions: [],
    errors: [],
  };

  try {
    await storage.initialize();
  } catch (error) {
    const recoverable = process.env.LIBRARIAN_DISABLE_STORAGE_RECOVERY !== '1' && isRecoverableStorageError(error);
    if (recoverable) {
      storageRecovery.attempted = true;
      const recovery = await attemptStorageRecovery(activeDbPath, { error });
      storageRecovery.recovered = recovery.recovered;
      storageRecovery.actions = recovery.actions;
      storageRecovery.errors = recovery.errors;
      if (recovery.recovered) {
        storage = createSqliteStorage(activeDbPath, activeWorkspace);
        ownsStorage = true;
        await storage.initialize();
      } else {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(message);
        result.storageRecovery = storageRecovery;
        return result;
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      result.storageRecovery = storageRecovery;
      return result;
    }
  }

  result.storageRecovery = storageRecovery;

  const workspaceLockCleanup = await cleanupWorkspaceLocks(activeWorkspace).catch((error) => ({
    lockDirs: [
      path.join(activeWorkspace, '.librarian', 'locks'),
      path.join(activeWorkspace, '.librarian', 'swarm', 'locks'),
    ],
    scannedFiles: 0,
    staleFiles: 0,
    activePidFiles: 0,
    unknownFreshFiles: 0,
    stalePaths: [],
    removedFiles: 0,
    errors: [String(error)],
  }));
  storageRecovery.workspaceLocks = {
    lockDirs: workspaceLockCleanup.lockDirs,
    scannedFiles: workspaceLockCleanup.scannedFiles,
    staleFiles: workspaceLockCleanup.staleFiles,
    activePidFiles: workspaceLockCleanup.activePidFiles,
    unknownFreshFiles: workspaceLockCleanup.unknownFreshFiles,
    removedFiles: workspaceLockCleanup.removedFiles,
    errors: workspaceLockCleanup.errors,
  };
  if (workspaceLockCleanup.staleFiles > 0 || workspaceLockCleanup.errors.length > 0) {
    storageRecovery.attempted = true;
  }
  if (workspaceLockCleanup.removedFiles > 0) {
    storageRecovery.recovered = true;
    storageRecovery.actions.push(`removed_workspace_locks:${workspaceLockCleanup.removedFiles}`);
  }
  if (workspaceLockCleanup.errors.length > 0) {
    for (const error of workspaceLockCleanup.errors) {
      storageRecovery.errors.push(`workspace_lock_cleanup:${error}`);
    }
  }

  try {
    const targetQualityTier = bootstrapMode === 'full' ? 'full' : 'mvp';
    const bootstrapCheck = await isBootstrapRequired(activeWorkspace, storage, { targetQualityTier });
    const shouldBootstrap = forceBootstrap || bootstrapCheck.required;
    const bootstrapResult: OnboardingBootstrapResult = {
      required: shouldBootstrap,
      attempted: false,
      success: false,
      retries: 0,
      skipEmbeddings: false,
      skipLlm: false,
    };

    if (!shouldBootstrap) {
      bootstrapResult.success = true;
      result.bootstrap = bootstrapResult;
      return result;
    }

    let providerStatus: AllProviderStatus | null = null;
    let skipEmbeddings = true;
    let skipLlm = true;

    try {
      providerStatus = await checkAllProviders({ workspaceRoot: activeWorkspace });
      // Fast bootstrap is intentionally deterministic and latency-first:
      // disable embeddings and LLM work to avoid long first-run stalls on large repos.
      skipEmbeddings = bootstrapMode !== 'full' ? true : !providerStatus.embedding.available;
      skipLlm = bootstrapMode !== 'full' ? true : !providerStatus.llm.available;
    } catch {
      providerStatus = null;
      skipEmbeddings = true;
      skipLlm = true;
    }

    result.providerStatus = providerStatus;
    bootstrapResult.skipEmbeddings = skipEmbeddings;
    bootstrapResult.skipLlm = skipLlm;

    if (skipEmbeddings && !allowDegradedEmbeddings) {
      bootstrapResult.error = 'embedding_unavailable';
      result.bootstrap = bootstrapResult;
      result.errors.push('embedding_unavailable');
      return result;
    }

    const llmProvider =
      !skipLlm && (providerStatus?.llm.provider === 'claude' || providerStatus?.llm.provider === 'codex')
        ? providerStatus.llm.provider
        : undefined;
    const llmModelId =
      !skipLlm && providerStatus?.llm.model && providerStatus.llm.model !== 'unknown'
        ? providerStatus.llm.model
        : undefined;

    let bootstrapConfig: BootstrapConfig = createBootstrapConfig(activeWorkspace, {
      bootstrapMode,
      skipEmbeddings,
      skipLlm,
      llmProvider,
      llmModelId,
      emitBaseline,
      emitInstallManifest: true,
      updateAgentDocs,
    });

    bootstrapResult.attempted = true;
    let report = await bootstrapProject(bootstrapConfig, storage);

    if (!report.success) {
      const plan = planBootstrapRecovery({
        workspaceRoot: activeWorkspace,
        scope: 'full',
        errorMessage: report.error ?? 'bootstrap_failed',
      });

      if (plan) {
        if (plan.workspaceRoot && plan.workspaceRoot !== activeWorkspace) {
          if (!ownsStorage) {
            bootstrapResult.error = 'workspace_root_changed';
            result.bootstrap = bootstrapResult;
            result.errors.push('workspace_root_changed');
            return result;
          }
          activeWorkspace = plan.workspaceRoot;
          activeDbPath = await resolveDbPathForWorkspace(activeWorkspace);
          await storage?.close?.();
          storage = createSqliteStorage(activeDbPath, activeWorkspace);
          await storage.initialize();
          ownsStorage = true;
        }
        const nextConfig: BootstrapConfig = {
          ...bootstrapConfig,
          workspace: activeWorkspace,
          include: plan.include ?? bootstrapConfig.include,
          exclude: plan.exclude ?? bootstrapConfig.exclude,
        };
        bootstrapResult.retries += 1;
        bootstrapConfig = nextConfig;
        report = await bootstrapProject(bootstrapConfig, storage);
      }
    }

    bootstrapResult.report = report;
    bootstrapResult.success = report.success;
    bootstrapResult.error = report.success ? undefined : (report.error ?? 'bootstrap_failed');
    result.bootstrap = bootstrapResult;
  } finally {
    if (ownsStorage) {
      await storage?.close?.();
    }
  }

  return result;
}
