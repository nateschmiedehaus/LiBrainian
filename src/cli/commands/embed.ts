/**
 * @fileoverview Embed command - backfill semantic embeddings.
 *
 * Usage: librarian embed --fix [--json]
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { checkAllProviders } from '../../api/provider_check.js';
import { bootstrapProject, createBootstrapConfig } from '../../api/bootstrap.js';
import { computeEmbeddingCoverage } from '../../api/embedding_coverage.js';
import type { StorageStats } from '../../storage/types.js';
import { createError } from '../errors.js';

export interface EmbedCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function summarizeCoverage(stats: StorageStats): ReturnType<typeof computeEmbeddingCoverage> {
  return computeEmbeddingCoverage(stats.totalFunctions, stats.totalEmbeddings);
}

export async function embedCommand(options: EmbedCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1), // skip "embed"
    options: {
      fix: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const fix = values.fix as boolean;
  const json = values.json as boolean;
  if (!fix) {
    throw createError(
      'INVALID_ARGUMENT',
      'Embed command requires --fix. Run `librarian embed --fix` to backfill embeddings.'
    );
  }

  let workspaceRoot = path.resolve(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspaceRoot);
    if (resolution.changed) {
      workspaceRoot = resolution.workspace;
      if (!json) {
        const detail = resolution.marker ? `marker ${resolution.marker}` : (resolution.reason ?? 'source discovery');
        console.log(`Auto-detected project root at ${workspaceRoot} (${detail}). Using it.`);
      }
    }
  }

  const providers = await checkAllProviders({ workspaceRoot, forceProbe: true });
  if (!providers.embedding.available) {
    throw createError(
      'PROVIDER_UNAVAILABLE',
      `Embedding provider unavailable: ${providers.embedding.error ?? 'unknown error'}. Run \`librarian check-providers\`.`,
      {
        embeddingProvider: providers.embedding.provider,
      }
    );
  }

  const dbPath = await resolveDbPath(workspaceRoot);
  const storage = createSqliteStorage(dbPath, workspaceRoot);
  await storage.initialize();

  try {
    const beforeStats = await storage.getStats();
    const beforeCoverage = summarizeCoverage(beforeStats);
    const config = createBootstrapConfig(workspaceRoot, {
      bootstrapMode: 'fast',
      forceReindex: true,
      skipLlm: true,
      skipEmbeddings: false,
      emitBaseline: false,
    });
    const report = await bootstrapProject(config, storage);
    const afterStats = await storage.getStats();
    const afterCoverage = summarizeCoverage(afterStats);

    const output = {
      success: report.success,
      provider: providers.embedding.provider,
      model: providers.embedding.model,
      before: {
        total_functions: beforeCoverage.total_functions,
        embedded_functions: beforeCoverage.embedded_functions,
        coverage_pct: beforeCoverage.coverage_pct,
        needs_embedding_count: beforeCoverage.needs_embedding_count,
      },
      after: {
        total_functions: afterCoverage.total_functions,
        embedded_functions: afterCoverage.embedded_functions,
        coverage_pct: afterCoverage.coverage_pct,
        needs_embedding_count: afterCoverage.needs_embedding_count,
      },
      filesProcessed: report.totalFilesProcessed,
      functionsIndexed: report.totalFunctionsIndexed,
      error: report.error ?? null,
    };

    if (json) {
      console.log(JSON.stringify(output));
    } else {
      console.log('Embedding remediation complete');
      console.log(`Before coverage: ${beforeCoverage.coverage_pct.toFixed(1)}% (${beforeCoverage.embedded_functions}/${beforeCoverage.total_functions})`);
      console.log(`After coverage:  ${afterCoverage.coverage_pct.toFixed(1)}% (${afterCoverage.embedded_functions}/${afterCoverage.total_functions})`);
      console.log(`Files processed: ${report.totalFilesProcessed}`);
      if (report.error) {
        console.log(`Error: ${report.error}`);
      }
    }

    if (!report.success) {
      throw createError(
        'BOOTSTRAP_FAILED',
        `Embedding remediation failed: ${report.error ?? 'bootstrap reported failure'}.`
      );
    }
  } finally {
    await storage.close();
  }
}
