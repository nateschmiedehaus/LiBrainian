/**
 * @fileoverview Health Command
 *
 * Shows current Librarian health status using the observability module.
 *
 * Usage: librarian health [--verbose] [--completeness]
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import {
  generateStateReport,
  exportPrometheusMetrics,
  type LibrarianStateReport,
} from '../../measurement/observability.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import {
  calculateIndexCompleteness,
  formatCompletenessReport,
  exportPrometheusMetrics as exportCompletenessPrometheus,
  type IndexCompletenessReport,
} from '../../metrics/index_completeness.js';

interface HealthOptions {
  workspace: string;
  verbose?: boolean;
  format?: 'text' | 'json' | 'prometheus';
  completeness?: boolean;
}

export async function healthCommand(options: HealthOptions): Promise<void> {
  const { workspace, verbose = false, format = 'text', completeness = false } = options;

  let storage: Awaited<ReturnType<typeof createSqliteStorage>> | null = null;

  try {
    // Initialize storage (fail-closed: never throw from healthCommand)
    const dbPath = await resolveDbPath(workspace);
    storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const bootstrapCheck = await isBootstrapRequired(workspace, storage, { targetQualityTier: 'mvp' });
    if (bootstrapCheck.required) {
      outputHealthFailure(
        format,
        {
          status: 'unhealthy',
          reason: 'bootstrap_required',
          message: bootstrapCheck.reason || 'Bootstrap required',
          suggestion: 'Run `librarian bootstrap` to initialize the index',
        },
        verbose
      );
      process.exitCode = 1;
      return;
    }

    // If completeness flag is set, show completeness report instead
    if (completeness) {
      const completenessReport = await calculateIndexCompleteness(workspace, storage);
      outputCompletenessReport(completenessReport, format, verbose);

      // Exit code based on completeness
      if (completenessReport.completeness < 0.8) {
        process.exitCode = 1;
      }
      return;
    }

    // Generate state report
    const report = await generateStateReport(storage);

    // Output based on format
    switch (format) {
      case 'json':
        console.log(JSON.stringify(report, null, 2));
        break;

      case 'prometheus':
        console.log(exportPrometheusMetrics(report));
        break;

      case 'text':
      default:
        printTextReport(report, verbose);
        break;
    }

    // Exit code based on health
    if (report.health.status === 'unhealthy') {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputHealthFailure(
      format,
      {
        status: 'unhealthy',
        reason: 'storage_unavailable',
        message,
        suggestion: 'Run `librarian doctor --heal` or `librarian bootstrap --force` to recover',
      },
      verbose
    );
    process.exitCode = 1;
  } finally {
    await storage?.close?.();
  }
}

function outputHealthFailure(
  format: 'text' | 'json' | 'prometheus',
  payload: { status: 'unhealthy'; reason: string; message: string; suggestion?: string },
  verbose: boolean
): void {
  const enriched = {
    ...payload,
    generatedAt: new Date().toISOString(),
  };
  switch (format) {
    case 'json':
      console.log(JSON.stringify(enriched, null, 2));
      break;
    case 'prometheus':
      console.log(`librarian_health_ok 0\nlibrarian_health_failure_reason{reason="${payload.reason}"} 1`);
      break;
    case 'text':
    default:
      console.log('\n=== Librarian Health Report ===\n');
      console.log(`Status: \u274C UNHEALTHY`);
      console.log(`Reason: ${payload.reason}`);
      console.log(`Message: ${payload.message}`);
      if (payload.suggestion) console.log(`Suggestion: ${payload.suggestion}`);
      if (verbose) console.log(`Generated: ${enriched.generatedAt}`);
      console.log('');
      break;
  }
}

function outputCompletenessReport(
  report: IndexCompletenessReport,
  format: 'text' | 'json' | 'prometheus',
  verbose: boolean
): void {
  switch (format) {
    case 'json':
      // Convert Date objects to ISO strings for JSON serialization
      const jsonReport = {
        ...report,
        lastIndexTime: report.lastIndexTime?.toISOString() ?? null,
        generatedAt: report.generatedAt.toISOString(),
        staleFiles: report.staleFiles.map(f => ({
          ...f,
          indexedAt: f.indexedAt.toISOString(),
          modifiedAt: f.modifiedAt.toISOString(),
        })),
      };
      console.log(JSON.stringify(jsonReport, null, 2));
      break;

    case 'prometheus':
      console.log(exportCompletenessPrometheus(report));
      break;

    case 'text':
    default:
      console.log(formatCompletenessReport(report, verbose));
      break;
  }
}

function printTextReport(report: LibrarianStateReport, verbose: boolean): void {
  const statusEmoji: Record<string, string> = {
    healthy: '\u2705',
    degraded: '\u26A0\uFE0F',
    recovering: '\u23F3',
    unhealthy: '\u274C',
  };

  console.log('\n=== Librarian Health Report ===\n');
  console.log(`Status: ${statusEmoji[report.health.status] ?? '\u2753'} ${report.health.status.toUpperCase()}`);
  console.log(`Recovery State: ${report.recoveryState}`);
  console.log(`Generated: ${report.generatedAt}\n`);

  // Health checks
  console.log('Health Checks:');
  console.log(`  Index Fresh: ${report.health.checks.indexFresh ? '\u2705' : '\u274C'}`);
  console.log(`  Confidence OK: ${report.health.checks.confidenceAcceptable ? '\u2705' : '\u274C'}`);
  console.log(`  Defeaters Low: ${report.health.checks.defeatersLow ? '\u2705' : '\u274C'}`);
  console.log(`  Latency OK: ${report.health.checks.latencyAcceptable ? '\u2705' : '\u274C'}`);
  console.log(`  Coverage OK: ${report.health.checks.coverageAcceptable ? '\u2705' : '\u274C'}`);

  // Degradation reasons
  if (report.health.degradationReasons.length > 0) {
    console.log('\nDegradation Reasons:');
    for (const reason of report.health.degradationReasons) {
      console.log(`  - ${reason}`);
    }
  }

  if (!report.health.checks.indexFresh) {
    console.log('\nSuggested Fixes:');
    console.log('  - Run `librarian watch` to keep the index fresh.');
    console.log('  - Or run `librarian bootstrap --mode fast` to refresh immediately.');
  }

  if (verbose) {
    console.log('\n--- Code Graph Health ---');
    console.log(`  Entities: ${report.codeGraphHealth.entityCount}`);
    console.log(`  Relations: ${report.codeGraphHealth.relationCount}`);
    console.log(`  Coverage: ${(report.codeGraphHealth.coverageRatio * 100).toFixed(1)}%`);
    console.log(`  Orphans: ${report.codeGraphHealth.orphanEntities}`);

    console.log('\n--- Index Freshness ---');
    console.log(`  Last Index: ${report.indexFreshness.lastIndexTime ?? 'never'}`);
    console.log(`  Staleness: ${formatDuration(report.indexFreshness.stalenessMs)}`);
    console.log(`  Pending Changes: ${report.indexFreshness.pendingChanges}`);

    console.log('\n--- Confidence State ---');
    console.log(`  Mean Confidence: ${(report.confidenceState.meanConfidence * 100).toFixed(1)}%`);
    console.log(`  Geometric Mean: ${(report.confidenceState.geometricMeanConfidence * 100).toFixed(1)}%`);
    console.log(`  Low Confidence Count: ${report.confidenceState.lowConfidenceCount}`);
    console.log(`  Defeaters: ${report.confidenceState.defeaterCount}`);

    console.log('\n--- Query Performance ---');
    console.log(`  P50 Latency: ${report.queryPerformance.queryLatencyP50}ms`);
    console.log(`  P99 Latency: ${report.queryPerformance.queryLatencyP99}ms`);
    console.log(`  Cache Hit Rate: ${(report.queryPerformance.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Query Count: ${report.queryPerformance.queryCount}`);
  }

  console.log('');
}

function formatDuration(ms: number): string {
  if (ms < 0) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}min`;
  return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
}
