/**
 * @fileoverview Quickstart Command
 *
 * Runs end-to-end onboarding recovery with sensible defaults to get
 * Librarian operational in a new workspace.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';
import { runOnboardingRecovery } from '../../api/onboarding_recovery.js';
import { createError } from '../errors.js';
import { printKeyValue } from '../progress.js';

export interface QuickstartCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type QuickstartStatus = 'ok' | 'warning' | 'error';

interface QuickstartReport {
  status: QuickstartStatus;
  workspace: string;
  mode: 'fast' | 'full';
  ci: boolean;
  mcp: {
    enabled: boolean;
    configured: boolean;
    skipped: boolean;
  };
  baseline: boolean;
  updateAgentDocs: boolean;
  warnings: string[];
  errors: string[];
  recovery: unknown;
}

function resolveBootstrapMode(raw: string): 'fast' | 'full' {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'fast' || normalized === 'full') return normalized;
  throw createError('INVALID_ARGUMENT', `Unknown mode "${raw}" (use "fast" or "full").`);
}

function resolveRiskTolerance(raw?: string): 'safe' | 'low' | 'medium' {
  if (!raw) return 'low';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'safe' || normalized === 'low' || normalized === 'medium') return normalized;
  throw createError('INVALID_ARGUMENT', `Unknown risk tolerance "${raw}" (use "safe", "low", or "medium").`);
}

function resolveDepth(raw?: string): 'quick' | 'full' | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'full') return normalized;
  throw createError('INVALID_ARGUMENT', `Unknown depth "${raw}" (use "quick" or "full").`);
}

function summarizeRecovery(recovery: {
  errors?: string[];
  configHeal?: { attempted: boolean; success: boolean; appliedFixes: number; failedFixes: number };
  storageRecovery?: { attempted: boolean; recovered: boolean; actions: string[] };
  bootstrap?: { required: boolean; attempted: boolean; success: boolean; skipEmbeddings: boolean; skipLlm: boolean; report?: { totalFilesProcessed?: number; warnings?: string[] } };
}): { status: QuickstartStatus; warnings: string[]; errors: string[] } {
  const errors: string[] = [...(recovery.errors ?? [])];
  const warnings: string[] = [];

  if (recovery.configHeal?.attempted && !recovery.configHeal.success) {
    errors.push('configuration_heal_failed');
  }

  if (recovery.storageRecovery?.attempted && !recovery.storageRecovery.recovered) {
    errors.push('storage_recovery_failed');
  }

  if (recovery.bootstrap?.required && recovery.bootstrap.attempted && !recovery.bootstrap.success) {
    errors.push('bootstrap_failed');
  }

  if (recovery.bootstrap?.skipEmbeddings) {
    warnings.push('Embeddings disabled (semantic search limited)');
  }
  if (recovery.bootstrap?.skipLlm) {
    warnings.push('LLM disabled (heuristic mode)');
  }
  if (recovery.bootstrap?.report?.warnings && recovery.bootstrap.report.warnings.length > 0) {
    warnings.push(...recovery.bootstrap.report.warnings);
  }

  const status: QuickstartStatus = errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'ok');
  return { status, warnings, errors };
}

function describeCapabilityState(options: {
  skip: boolean;
  mode: 'fast' | 'full';
  providerAvailable?: boolean | null;
  providerError?: string | null;
}): string {
  const { skip, mode, providerAvailable, providerError } = options;
  if (!skip) return 'enabled';

  const providerDetail = providerAvailable === true
    ? 'provider ready'
    : providerAvailable === false
      ? `provider unavailable${providerError ? `: ${providerError}` : ''}`
      : 'provider unknown';

  if (mode === 'fast') {
    return `disabled (fast mode; ${providerDetail})`;
  }

  return `disabled (${providerDetail})`;
}

export async function quickstartCommand(options: QuickstartCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      mode: { type: 'string', default: 'fast' },
      depth: { type: 'string' },
      'risk-tolerance': { type: 'string' },
      force: { type: 'boolean', default: false },
      'skip-baseline': { type: 'boolean', default: false },
      'update-agent-docs': { type: 'boolean', default: false },
      ci: { type: 'boolean', default: false },
      'no-mcp': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  let workspaceRoot = path.resolve(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspaceRoot);
    if (resolution.changed) {
      const detail = resolution.marker ? `marker ${resolution.marker}` : 'source discovery';
      console.log(`Auto-detected project root at ${resolution.workspace} (${detail}). Using it.`);
      workspaceRoot = resolution.workspace;
    }
  }

  const depth = resolveDepth(typeof values.depth === 'string' ? values.depth : undefined);
  const modeFromFlag = resolveBootstrapMode(String(values.mode ?? 'fast'));
  const modeFromDepth = depth === 'quick' ? 'fast' : depth === 'full' ? 'full' : undefined;
  const bootstrapMode = modeFromDepth ?? modeFromFlag;
  if (modeFromDepth && modeFromFlag !== modeFromDepth && rawArgs.slice(1).includes('--mode')) {
    throw createError(
      'INVALID_ARGUMENT',
      `Conflicting options: --mode ${modeFromFlag} does not match --depth ${depth}.`
    );
  }
  const riskTolerance = resolveRiskTolerance(typeof values['risk-tolerance'] === 'string' ? values['risk-tolerance'] : undefined);
  const forceBootstrap = values.force as boolean;
  const skipBaseline = values['skip-baseline'] as boolean;
  const emitBaseline = !skipBaseline;
  const updateAgentDocs = values['update-agent-docs'] as boolean;
  const ci = values.ci as boolean;
  const noMcp = values['no-mcp'] as boolean;
  const json = values.json as boolean;

  const dbPath = await resolveDbPath(workspaceRoot);

  const recovery = await runOnboardingRecovery({
    workspace: workspaceRoot,
    dbPath,
    autoHealConfig: true,
    riskTolerance,
    allowDegradedEmbeddings: true,
    bootstrapMode,
    emitBaseline,
    updateAgentDocs,
    forceBootstrap,
  });

  const summary = summarizeRecovery(recovery as any);
  const warnings = [...summary.warnings];
  if (noMcp) {
    warnings.push('MCP registration skipped (--no-mcp).');
  } else if (ci) {
    warnings.push('CI mode enabled: MCP auto-registration is skipped.');
  }
  const report: QuickstartReport = {
    status: summary.status,
    workspace: workspaceRoot,
    mode: bootstrapMode,
    ci,
    mcp: {
      enabled: !noMcp,
      configured: false,
      skipped: noMcp || ci,
    },
    baseline: emitBaseline,
    updateAgentDocs,
    warnings,
    errors: summary.errors,
    recovery,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Librarian Quickstart');
    console.log('====================\n');
    printKeyValue([
      { key: 'Workspace', value: workspaceRoot },
      { key: 'Mode', value: bootstrapMode },
      { key: 'CI Mode', value: ci ? 'enabled' : 'disabled' },
      { key: 'MCP Registration', value: noMcp || ci ? 'skipped' : 'manual setup (run `librarian mcp --print-config`)' },
      { key: 'Baseline', value: emitBaseline ? 'enabled' : 'disabled' },
      { key: 'Agent Docs Update', value: updateAgentDocs ? 'enabled' : 'disabled' },
      { key: 'Status', value: summary.status.toUpperCase() },
    ]);

    console.log('\nRecovery Summary:');
    const bootstrapFiles = recovery.bootstrap?.report?.totalFilesProcessed ?? 0;
    const bootstrapSummary = recovery.bootstrap?.required
      ? (recovery.bootstrap.success ? `ok (${bootstrapFiles} files)` : 'failed')
      : 'not required';
    const configSummary = recovery.configHeal?.attempted
      ? (recovery.configHeal.success ? `ok (${recovery.configHeal.appliedFixes} fixes)` : 'failed')
      : 'ok';
    const storageSummary = recovery.storageRecovery?.attempted
      ? (recovery.storageRecovery.recovered ? `recovered (${recovery.storageRecovery.actions.join(', ') || 'no actions'})` : 'failed')
      : 'ok';

    printKeyValue([
      { key: 'Config Heal', value: configSummary },
      { key: 'Storage Recovery', value: storageSummary },
      { key: 'Bootstrap', value: bootstrapSummary },
      {
        key: 'Embeddings',
        value: describeCapabilityState({
          skip: recovery.bootstrap?.skipEmbeddings ?? false,
          mode: bootstrapMode,
          providerAvailable: recovery.providerStatus?.embedding?.available ?? null,
          providerError: recovery.providerStatus?.embedding?.error ?? null,
        }),
      },
      {
        key: 'LLM',
        value: describeCapabilityState({
          skip: recovery.bootstrap?.skipLlm ?? false,
          mode: bootstrapMode,
          providerAvailable: recovery.providerStatus?.llm?.available ?? null,
          providerError: recovery.providerStatus?.llm?.error ?? null,
        }),
      },
    ]);

    if (warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
    }

    if (summary.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of summary.errors) {
        console.log(`  - ${error}`);
      }
      console.log('\nNext steps:');
      console.log('  - Run `librarian doctor --heal` for deeper diagnostics');
      console.log('  - Run `librarian bootstrap --force` for a full rebuild');
    } else {
      console.log('\nLibrarian is ready for use.');
    }
  }

  if (summary.status === 'error') {
    process.exitCode = 1;
  }
}
