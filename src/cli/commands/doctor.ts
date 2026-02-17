/**
 * @fileoverview Doctor Command - Health Diagnostic Tool
 *
 * Provides comprehensive health diagnostics for the Librarian system.
 * Checks database, embeddings, packs, vector index, graph edges, and bootstrap status.
 *
 * Usage: librarian doctor [--verbose] [--json]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired, getBootstrapStatus } from '../../api/bootstrap.js';
import { checkAllProviders } from '../../api/provider_check.js';
import { LIBRARIAN_VERSION } from '../../index.js';
import { printKeyValue, formatBytes } from '../progress.js';
import { runOnboardingRecovery } from '../../api/onboarding_recovery.js';
import { getWatchState } from '../../state/watch_state.js';
import { deriveWatchHealth } from '../../state/watch_health.js';
import {
  scanWorkspaceLanguages,
  assessGrammarCoverage,
  getMissingGrammarPackages,
  installMissingGrammars,
} from '../grammar_support.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';

// ============================================================================
// TYPES
// ============================================================================

export type CheckStatus = 'OK' | 'WARNING' | 'ERROR';

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

export interface DoctorReport {
  timestamp: string;
  version: string;
  workspace: string;
  workspaceOriginal?: string;
  overallStatus: CheckStatus;
  checks: DiagnosticCheck[];
  actions: DoctorAction[];
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
  };
}

export interface DoctorAction {
  id: string;
  severity: 'error' | 'warning';
  check: string;
  command: string;
  reason: string;
  expectedArtifact?: string;
}

export interface DoctorCommandOptions {
  workspace: string;
  verbose?: boolean;
  json?: boolean;
  heal?: boolean;
  installGrammars?: boolean;
  riskTolerance?: 'safe' | 'low' | 'medium';
}

interface ActionTemplate {
  command: string;
  expectedArtifact?: string;
}

const ACTION_BY_CHECK: Record<string, ActionTemplate> = {
  'Database Path Resolution': {
    command: 'librarian bootstrap --force',
    expectedArtifact: '.librarian/librarian.db',
  },
  'Database Access': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Bootstrap Status': {
    command: 'librarian quickstart --mode full',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Watch Freshness': {
    command: 'librarian watch',
    expectedArtifact: '.librarian/watch-state.json',
  },
  'Functions/Embeddings Correlation': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  Modules: {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Context Packs Health': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Vector Index': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Graph Edges': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Knowledge Confidence': {
    command: 'librarian bootstrap --mode full',
    expectedArtifact: 'state/audits/librarian/calibration',
  },
  'Embedding Provider': {
    command: 'librarian check-providers --format json',
    expectedArtifact: 'state/audits/providers',
  },
  'LLM Provider': {
    command: 'librarian check-providers --format json',
    expectedArtifact: 'state/audits/providers',
  },
  'Grammar Coverage': {
    command: 'librarian doctor --install-grammars',
  },
  'Configuration Auto-Heal': {
    command: 'librarian config heal --risk-tolerance low',
    expectedArtifact: '.librarian/governor.json',
  },
  'Storage Recovery': {
    command: 'librarian bootstrap --force',
    expectedArtifact: '.librarian/librarian.db',
  },
  'Bootstrap Recovery': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Onboarding Recovery': {
    command: 'librarian quickstart --mode full',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
};

function sanitizeActionId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function defaultActionForCheck(check: DiagnosticCheck): ActionTemplate {
  const lowerMessage = check.message.toLowerCase();
  if (lowerMessage.includes('provider')) {
    return {
      command: 'librarian check-providers --format json',
      expectedArtifact: 'state/audits/providers',
    };
  }
  if (lowerMessage.includes('bootstrap') || lowerMessage.includes('index')) {
    return {
      command: 'librarian bootstrap --force',
      expectedArtifact: 'state/audits/librarian/bootstrap',
    };
  }
  if (lowerMessage.includes('watch')) {
    return {
      command: 'librarian watch',
      expectedArtifact: '.librarian/watch-state.json',
    };
  }
  return {
    command: 'librarian doctor --json',
  };
}

function buildDoctorActions(checks: DiagnosticCheck[]): DoctorAction[] {
  const actions: DoctorAction[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    if (check.status === 'OK') continue;
    const template = ACTION_BY_CHECK[check.name] ?? defaultActionForCheck(check);
    const dedupeKey = `${check.name}:${template.command}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const idSuffix = sanitizeActionId(check.name);
    actions.push({
      id: `doctor.${idSuffix}`,
      severity: check.status === 'ERROR' ? 'error' : 'warning',
      check: check.name,
      command: template.command,
      reason: check.message,
      expectedArtifact: template.expectedArtifact,
    });
  }
  return actions;
}

// ============================================================================
// DIAGNOSTIC CHECKS
// ============================================================================

/**
 * Check 1: Database exists and is accessible
 */
async function checkDatabase(
  workspace: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Database Access',
    status: 'OK',
    message: '',
  };

  try {
    const dbPath = await resolveDbPath(workspace);

    // Check if database file exists
    if (!fs.existsSync(dbPath)) {
      check.status = 'ERROR';
      check.message = 'Database file does not exist';
      check.suggestion = 'Run `librarian bootstrap` to initialize the database';
      return check;
    }

    // Check if we can read the file
    const stats = fs.statSync(dbPath);
    check.details = {
      path: dbPath,
      sizeBytes: stats.size,
      sizeFormatted: formatBytes(stats.size),
      lastModified: stats.mtime.toISOString(),
    };

    // Try to open and query the database
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    // Quick health check - can we query?
    const metadata = await storage.getMetadata();
    await storage.close();

    if (metadata) {
      check.message = `Database accessible (${formatBytes(stats.size)})`;
      check.details.version = metadata.version.string;
      check.details.qualityTier = metadata.qualityTier;
    } else {
      check.status = 'WARNING';
      check.message = 'Database exists but has no metadata';
      check.suggestion = 'Run `librarian bootstrap` to initialize properly';
    }

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Database error: ${error instanceof Error ? error.message : String(error)}`;
    check.suggestion = 'Check file permissions or run `librarian bootstrap --force`';
    return check;
  }
}

/**
 * Check 2: Functions count vs embeddings count
 */
async function checkFunctionsVsEmbeddings(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Functions/Embeddings Correlation',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const stats = await storage.getStats();
    await storage.close();

    const { totalFunctions, totalEmbeddings } = stats;
    check.details = {
      totalFunctions,
      totalEmbeddings,
      ratio: totalFunctions > 0 ? (totalEmbeddings / totalFunctions).toFixed(2) : 'N/A',
    };

    if (totalFunctions === 0) {
      check.status = 'WARNING';
      check.message = 'No functions indexed';
      check.suggestion = 'Run `librarian bootstrap` to index codebase';
      return check;
    }

    if (totalEmbeddings === 0) {
      check.status = 'ERROR';
      check.message = `${totalFunctions} functions but 0 embeddings`;
      check.suggestion = 'Embedding model may have failed. Run `librarian bootstrap --force`';
      return check;
    }

    // Calculate coverage percentage
    const coverage = (totalEmbeddings / totalFunctions) * 100;

    if (coverage < 50) {
      check.status = 'WARNING';
      check.message = `Low embedding coverage: ${coverage.toFixed(1)}% (${totalEmbeddings}/${totalFunctions})`;
      check.suggestion = 'Some functions may be missing embeddings. Consider rebootstrapping.';
    } else if (coverage < 80) {
      check.status = 'WARNING';
      check.message = `Partial embedding coverage: ${coverage.toFixed(1)}% (${totalEmbeddings}/${totalFunctions})`;
    } else {
      check.message = `${totalFunctions} functions, ${totalEmbeddings} embeddings (${coverage.toFixed(1)}% coverage)`;
    }

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 3: Packs count vs targetId correlation
 */
async function checkPacksCorrelation(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Context Packs Health',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const stats = await storage.getStats();
    const packs = await storage.getContextPacks({ limit: 1000 });
    await storage.close();

    const totalPacks = stats.totalContextPacks;
    const invalidatedPacks = packs.filter(p => p.confidence < 0.1).length;
    const packTypes = new Map<string, number>();

    for (const pack of packs) {
      const type = pack.packType;
      packTypes.set(type, (packTypes.get(type) || 0) + 1);
    }

    check.details = {
      totalPacks,
      invalidatedPacks,
      packTypes: Object.fromEntries(packTypes),
    };

    if (totalPacks === 0) {
      check.status = 'WARNING';
      check.message = 'No context packs generated';
      check.suggestion = 'Run `librarian bootstrap` to generate context packs';
      return check;
    }

    const validRatio = (totalPacks - invalidatedPacks) / totalPacks;

    if (validRatio < 0.5) {
      check.status = 'WARNING';
      check.message = `Many low-confidence packs: ${invalidatedPacks}/${totalPacks} (${((1 - validRatio) * 100).toFixed(1)}%)`;
      check.suggestion = 'Consider reindexing to refresh stale packs';
    } else {
      check.message = `${totalPacks} context packs (${packTypes.size} types)`;
    }

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 4: Vector index size (embeddings vs index entries)
 */
async function checkVectorIndex(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Vector Index',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const stats = await storage.getStats();

    // Try to get multi-vector records which indicate HNSW index population
    const multiVectors = await storage.getMultiVectors({ limit: 1 });
    await storage.close();

    const { totalEmbeddings } = stats;
    const hasMultiVectors = multiVectors.length > 0;

    check.details = {
      totalEmbeddings,
      hasMultiVectors,
    };

    if (totalEmbeddings === 0) {
      check.status = 'ERROR';
      check.message = 'Vector index is empty (no embeddings)';
      check.suggestion = 'Run `librarian bootstrap` to generate embeddings';
      return check;
    }

    if (!hasMultiVectors && totalEmbeddings > 0) {
      check.status = 'WARNING';
      check.message = `${totalEmbeddings} embeddings but no multi-vectors`;
      check.suggestion = 'Multi-vector indexing may have failed';
    } else {
      check.message = `Vector index populated with ${totalEmbeddings} embeddings`;
    }

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 5: Graph edges count
 */
async function checkGraphEdges(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Graph Edges',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const edges = await storage.getGraphEdges({ limit: 10000 });
    const stats = await storage.getStats();
    await storage.close();

    const edgeCount = edges.length;
    const edgeTypes = new Map<string, number>();

    for (const edge of edges) {
      const type = edge.edgeType;
      edgeTypes.set(type, (edgeTypes.get(type) || 0) + 1);
    }

    check.details = {
      totalEdges: edgeCount,
      edgeTypes: Object.fromEntries(edgeTypes),
      totalFunctions: stats.totalFunctions,
    };

    if (edgeCount === 0 && stats.totalFunctions > 0) {
      check.status = 'WARNING';
      check.message = 'No graph edges but functions exist';
      check.suggestion = 'Graph building may have failed. Consider rebootstrapping.';
      return check;
    }

    if (edgeCount === 0) {
      check.status = 'WARNING';
      check.message = 'No graph edges (codebase may not have dependencies)';
      return check;
    }

    // Calculate edge density
    const density = stats.totalFunctions > 0
      ? (edgeCount / stats.totalFunctions).toFixed(2)
      : 'N/A';

    check.message = `${edgeCount} graph edges (${edgeTypes.size} types, ~${density} per function)`;

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 6: Bootstrap status
 */
async function checkBootstrapStatus(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Bootstrap Status',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const [mvpCheck, fullCheck, lastBootstrap] = await Promise.all([
      isBootstrapRequired(workspace, storage, { targetQualityTier: 'mvp' }),
      isBootstrapRequired(workspace, storage, { targetQualityTier: 'full' }),
      storage.getLastBootstrapReport(),
    ]);

    const bootstrapState = getBootstrapStatus(workspace);
    await storage.close();

    check.details = {
      mvpRequired: mvpCheck.required,
      mvpReason: mvpCheck.reason,
      fullRequired: fullCheck.required,
      fullReason: fullCheck.reason,
      lastBootstrapSuccess: lastBootstrap?.success ?? null,
      lastBootstrapError: lastBootstrap?.error ?? null,
      currentStatus: bootstrapState.status,
    };

    if (!lastBootstrap) {
      check.status = 'ERROR';
      check.message = 'Never bootstrapped';
      check.suggestion = 'Run `librarian bootstrap` to initialize the index';
      return check;
    }

    if (!lastBootstrap.success) {
      check.status = 'ERROR';
      check.message = `Last bootstrap failed: ${lastBootstrap.error || 'unknown error'}`;
      check.suggestion = 'Run `librarian bootstrap --force` to retry';
      return check;
    }

    if (mvpCheck.required) {
      check.status = 'WARNING';
      check.message = `Bootstrap outdated: ${mvpCheck.reason}`;
      check.suggestion = 'Run `librarian bootstrap` to refresh';
      return check;
    }

    check.message = 'Bootstrap complete and up-to-date';

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 7: Embedding provider availability
 */
async function checkEmbeddingProvider(
  workspace: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Embedding Provider',
    status: 'OK',
    message: '',
  };

  try {
    const providers = await checkAllProviders({ workspaceRoot: workspace });

    check.details = {
      available: providers.embedding.available,
      provider: providers.embedding.provider,
      error: providers.embedding.error ?? null,
    };

    if (!providers.embedding.available) {
      check.status = 'ERROR';
      check.message = `Embedding provider unavailable: ${providers.embedding.error || 'unknown'}`;
      check.suggestion = 'Check embedding provider installation or run `librarian check-providers`';
      return check;
    }

    check.message = `Embedding provider ready (${providers.embedding.provider})`;

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 8: LLM provider availability
 */
async function checkLLMProvider(
  workspace: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'LLM Provider',
    status: 'OK',
    message: '',
  };

  try {
    const providers = await checkAllProviders({ workspaceRoot: workspace });

    check.details = {
      available: providers.llm.available,
      provider: providers.llm.provider,
      model: providers.llm.model,
      error: providers.llm.error ?? null,
    };

    if (!providers.llm.available) {
      check.status = 'WARNING';
      check.message = `LLM provider unavailable: ${providers.llm.error || 'unknown'}`;
      check.suggestion = 'Run `claude` or `codex login` to authenticate';
      return check;
    }

    check.message = `LLM provider ready (${providers.llm.provider}: ${providers.llm.model})`;

    return check;
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 9: Parser/grammar coverage for detected languages
 */
async function checkGrammarCoverage(
  workspace: string,
  installGrammars: boolean,
  jsonMode: boolean
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Parser Coverage',
    status: 'OK',
    message: '',
  };

  try {
    const scan = await scanWorkspaceLanguages(workspace);
    let coverage = assessGrammarCoverage(scan);
    const missingPackages = getMissingGrammarPackages(coverage);

    if (installGrammars && missingPackages.length > 0) {
      const installResult = await installMissingGrammars(workspace, coverage, {
        stdio: jsonMode ? 'ignore' : 'inherit',
      });
      check.details = {
        installAttempted: true,
        installSuccess: installResult.success,
        installedPackages: installResult.packages,
        installError: installResult.error ?? null,
      };
      if (installResult.success) {
        coverage = assessGrammarCoverage(scan);
      } else {
        check.status = 'ERROR';
        check.message = `Failed to install grammar packages (${installResult.packages.join(', ')})`;
        check.suggestion = 'Install missing grammars manually or rerun with a configured package manager.';
        return check;
      }
    }

    const supportedCount = coverage.supportedByTsMorph.length + coverage.supportedByTreeSitter.length;

    check.details = {
      languagesDetected: coverage.languagesDetected,
      supportedByTsMorph: coverage.supportedByTsMorph,
      supportedByTreeSitter: coverage.supportedByTreeSitter,
      missingLanguageConfigs: coverage.missingLanguageConfigs,
      missingGrammarModules: coverage.missingGrammarModules,
      missingTreeSitterCore: coverage.missingTreeSitterCore,
      totalFiles: coverage.totalFiles,
      truncated: coverage.truncated,
      errors: coverage.errors,
    };

    if (coverage.languagesDetected.length === 0) {
      check.status = 'WARNING';
      check.message = 'No code languages detected for parsing';
      check.suggestion = 'Ensure workspace points to the project root';
      return check;
    }

    if (supportedCount === 0) {
      check.status = 'ERROR';
      check.message = `No parsers available for detected languages (${coverage.languagesDetected.join(', ')})`;
      check.suggestion = 'Install tree-sitter and grammar packages or add language configs.';
      return check;
    }

    if (coverage.missingLanguageConfigs.length > 0 || coverage.missingGrammarModules.length > 0 || coverage.missingTreeSitterCore) {
      check.status = 'WARNING';
      const missingPieces: string[] = [];
      if (coverage.missingTreeSitterCore) {
        missingPieces.push('tree-sitter core');
      }
      if (coverage.missingGrammarModules.length > 0) {
        missingPieces.push(`grammars (${coverage.missingGrammarModules.join(', ')})`);
      }
      if (coverage.missingLanguageConfigs.length > 0) {
        missingPieces.push(`configs (${coverage.missingLanguageConfigs.join(', ')})`);
      }
      check.message = `Parser coverage incomplete: ${missingPieces.join('; ')}`;
      check.suggestion = installGrammars
        ? 'Add missing language configs to tree_sitter_parser or install remaining grammars.'
        : 'Run `librarian doctor --install-grammars` to install missing grammars.';
      return check;
    }

    check.message = `Parser coverage OK for ${coverage.languagesDetected.length} languages`;
    return check;
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Failed to check grammar coverage: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 10: Modules indexed
 */
async function checkModules(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Modules Indexed',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const stats = await storage.getStats();
    await storage.close();

    check.details = {
      totalModules: stats.totalModules,
      totalFunctions: stats.totalFunctions,
    };

    if (stats.totalModules === 0 && stats.totalFunctions > 0) {
      check.status = 'WARNING';
      check.message = 'No modules indexed but functions exist';
      check.suggestion = 'Module extraction may have failed';
      return check;
    }

    if (stats.totalModules === 0) {
      check.status = 'WARNING';
      check.message = 'No modules indexed';
      check.suggestion = 'Run `librarian bootstrap` to index codebase';
      return check;
    }

    check.message = `${stats.totalModules} modules indexed`;

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check 11: Average confidence level
 */
async function checkConfidenceLevel(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Knowledge Confidence',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    const stats = await storage.getStats();
    await storage.close();

    const avgConfidence = stats.averageConfidence;

    check.details = {
      averageConfidence: avgConfidence.toFixed(3),
    };

    // averageConfidence is primarily function-derived today; treat “no functions” as N/A rather than “broken”.
    if (stats.totalFunctions === 0) {
      check.status = stats.totalModules > 0 ? 'WARNING' : 'OK';
      check.message = stats.totalModules > 0
        ? 'No functions indexed; confidence metrics are incomplete'
        : 'No code entities indexed; confidence metrics unavailable';
      check.suggestion = stats.totalModules > 0
        ? 'Index code with functions for richer confidence signals'
        : undefined;
      return check;
    }

    if (avgConfidence < 0.3) {
      check.status = 'ERROR';
      check.message = `Very low average confidence: ${(avgConfidence * 100).toFixed(1)}%`;
      check.suggestion = 'Knowledge quality is poor. Consider rebootstrapping.';
      return check;
    }

    if (avgConfidence < 0.5) {
      check.status = 'WARNING';
      check.message = `Low average confidence: ${(avgConfidence * 100).toFixed(1)}%`;
      check.suggestion = 'Some knowledge may be unreliable';
      return check;
    }

    check.message = `Average confidence: ${(avgConfidence * 100).toFixed(1)}%`;

    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check: Watch freshness / catch-up status
 */
async function checkWatchFreshness(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Watch Freshness',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    const state = await getWatchState(storage);
    const health = deriveWatchHealth(state);
    await storage.close();

    const reconcileAgeMs = (() => {
      const cursor = state?.cursor;
      if (!cursor || cursor.kind !== 'fs') return null;
      const parsed = Date.parse(cursor.lastReconcileCompletedAt);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Date.now() - parsed);
    })();

    check.details = {
      hasState: Boolean(state),
      suspectedDead: health?.suspectedDead ?? null,
      heartbeatAgeMs: health?.heartbeatAgeMs ?? null,
      reindexAgeMs: health?.reindexAgeMs ?? null,
      stalenessMs: health?.stalenessMs ?? null,
      reconcileAgeMs,
      needsCatchup: state?.needs_catchup ?? null,
      storageAttached: state?.storage_attached ?? null,
      lastError: state?.last_error ?? null,
    };

    if (!state) {
      check.status = 'WARNING';
      check.message = 'No watch state recorded';
      check.suggestion = 'Run `librarian watch` to keep the index fresh';
      return check;
    }

    const stalenessMs = health?.stalenessMs ?? null;
    const reconcileStale = (reconcileAgeMs !== null && stalenessMs !== null && reconcileAgeMs > stalenessMs);
    const parts: string[] = [];
    if (state.storage_attached === false) parts.push('storage detached');
    if (state.last_error) parts.push(`last error: ${state.last_error}`);
    if (health?.suspectedDead) parts.push('watcher suspected dead');
    if (state.needs_catchup) parts.push('needs catch-up');
    if (reconcileStale) parts.push('reconcile stale');
    if (parts.length > 0) {
      check.status = 'WARNING';
      check.message = `Watch degraded: ${parts.join(', ')}`;
      check.suggestion = 'Run `librarian watch` to restart indexing and catch up on changes';
      return check;
    }

    check.message = 'Watch healthy';
    return check;
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Failed to check watch freshness: ${error instanceof Error ? error.message : String(error)}`;
    check.suggestion = 'Run `librarian status` and `librarian watch` to restore freshness';
    return check;
  }
}

// ============================================================================
// MAIN DOCTOR COMMAND
// ============================================================================

export async function doctorCommand(options: DoctorCommandOptions): Promise<void> {
  const {
    workspace,
    verbose = false,
    json = false,
    heal = false,
    installGrammars = false,
    riskTolerance = 'low',
  } = options;

  let workspaceRoot = path.resolve(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspaceRoot);
    if (resolution.changed) {
      workspaceRoot = resolution.workspace;
      if (!json) {
        const detail = resolution.marker ? `marker ${resolution.marker}` : (resolution.reason ?? 'source discovery');
        console.log(`Auto-detected project root at ${workspaceRoot} (${detail}). Using it.\n`);
      }
    }
  }

  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    version: LIBRARIAN_VERSION.string,
    workspace: workspaceRoot,
    workspaceOriginal: workspaceRoot !== workspace ? workspace : undefined,
    overallStatus: 'OK',
    checks: [],
    actions: [],
    summary: {
      total: 0,
      ok: 0,
      warnings: 0,
      errors: 0,
    },
  };

  // Resolve database path early for checks that need it
  let dbPath: string;
  try {
    dbPath = await resolveDbPath(workspaceRoot);
  } catch (error) {
    const check: DiagnosticCheck = {
      name: 'Database Path Resolution',
      status: 'ERROR',
      message: `Failed to resolve database path: ${error instanceof Error ? error.message : String(error)}`,
      suggestion: 'Check workspace directory permissions',
    };
    report.checks.push(check);
    report.summary.total = 1;
    report.summary.errors = 1;
    report.actions = buildDoctorActions(report.checks);
    report.overallStatus = 'ERROR';

    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      outputTextReport(report, verbose);
    }
    process.exitCode = 1;
    return;
  }

  const healChecks: DiagnosticCheck[] = [];
  if (heal) {
    try {
      const bootstrapMode = riskTolerance === 'medium' ? 'full' : 'fast';
      const recovery = await runOnboardingRecovery({
        workspace: workspaceRoot,
        dbPath,
        autoHealConfig: true,
        riskTolerance,
        allowDegradedEmbeddings: true,
        bootstrapMode,
      });

      const configHeal = recovery.configHeal;
      if (configHeal) {
        if (!configHeal.attempted) {
          healChecks.push({
            name: 'Configuration Auto-Heal',
            status: 'OK',
            message: 'Configuration already optimal',
          });
        } else {
          healChecks.push({
            name: 'Configuration Auto-Heal',
            status: configHeal.success ? 'OK' : 'ERROR',
            message: configHeal.success
              ? `Applied ${configHeal.appliedFixes} configuration fixes`
              : `Failed to apply ${configHeal.failedFixes} configuration fixes`,
            details: {
              appliedFixes: configHeal.appliedFixes,
              failedFixes: configHeal.failedFixes,
              newHealthScore: configHeal.newHealthScore,
            },
            suggestion: configHeal.success
              ? undefined
              : 'Review configuration issues and rerun `librarian config heal --diagnose-only`',
          });
        }
      }

      const storageRecovery = recovery.storageRecovery;
      if (storageRecovery) {
        healChecks.push({
          name: 'Storage Recovery',
          status: storageRecovery.attempted
            ? (storageRecovery.recovered ? 'OK' : 'ERROR')
            : 'OK',
          message: storageRecovery.attempted
            ? (storageRecovery.recovered
              ? `Recovered storage (${storageRecovery.actions.join(', ') || 'no actions'})`
              : 'Storage recovery attempted but failed')
            : 'Storage recovery not required',
          details: storageRecovery.attempted
            ? { actions: storageRecovery.actions, errors: storageRecovery.errors }
            : undefined,
          suggestion: storageRecovery.recovered
            ? undefined
            : (storageRecovery.attempted ? 'Run `librarian bootstrap --force` to rebuild storage' : undefined),
        });
      }

      const bootstrap = recovery.bootstrap;
      if (bootstrap) {
        if (!bootstrap.required) {
          healChecks.push({
            name: 'Bootstrap Recovery',
            status: 'OK',
            message: 'Bootstrap not required',
          });
        } else {
          healChecks.push({
            name: 'Bootstrap Recovery',
            status: bootstrap.success ? 'OK' : 'ERROR',
            message: bootstrap.success
              ? `Bootstrap completed (${bootstrap.report?.totalFilesProcessed ?? 0} files)`
              : `Bootstrap failed: ${bootstrap.error ?? bootstrap.report?.error ?? 'unknown error'}`,
            details: {
              retries: bootstrap.retries,
              skipEmbeddings: bootstrap.skipEmbeddings,
              skipLlm: bootstrap.skipLlm,
            },
            suggestion: bootstrap.success
              ? undefined
              : 'Run `librarian bootstrap --force` for a full rebuild',
          });
        }
      }
    } catch (error) {
      healChecks.push({
        name: 'Onboarding Recovery',
        status: 'ERROR',
        message: `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        suggestion: 'Run `librarian bootstrap --force` to recover',
      });
    }
  }

  // Run all diagnostic checks
  const checks = await Promise.all([
    checkDatabase(workspaceRoot),
    checkBootstrapStatus(workspaceRoot, dbPath),
    checkWatchFreshness(workspaceRoot, dbPath),
    checkFunctionsVsEmbeddings(workspaceRoot, dbPath),
    checkModules(workspaceRoot, dbPath),
    checkPacksCorrelation(workspaceRoot, dbPath),
    checkVectorIndex(workspaceRoot, dbPath),
    checkGraphEdges(workspaceRoot, dbPath),
    checkConfidenceLevel(workspaceRoot, dbPath),
    checkEmbeddingProvider(workspaceRoot),
    checkLLMProvider(workspaceRoot),
    checkGrammarCoverage(workspaceRoot, installGrammars, json),
  ]);

  report.checks = healChecks.length > 0 ? [...healChecks, ...checks] : checks;

  // Calculate summary
  for (const check of report.checks) {
    report.summary.total++;
    switch (check.status) {
      case 'OK':
        report.summary.ok++;
        break;
      case 'WARNING':
        report.summary.warnings++;
        break;
      case 'ERROR':
        report.summary.errors++;
        break;
    }
  }

  // Determine overall status
  if (report.summary.errors > 0) {
    report.overallStatus = 'ERROR';
  } else if (report.summary.warnings > 0) {
    report.overallStatus = 'WARNING';
  }
  report.actions = buildDoctorActions(report.checks);

  // Output report
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    outputTextReport(report, verbose);
  }

  // Set exit code based on overall status
  if (report.overallStatus === 'ERROR') {
    process.exitCode = 1;
  }
}

/**
 * Output report in human-readable text format
 */
function outputTextReport(report: DoctorReport, verbose: boolean): void {
  const statusIcons: Record<CheckStatus, string> = {
    OK: '[OK]',
    WARNING: '[WARN]',
    ERROR: '[ERROR]',
  };

  console.log('\nLibrarian Doctor - Health Diagnostic Report');
  console.log('============================================\n');

  printKeyValue([
    { key: 'Version', value: report.version },
    { key: 'Workspace', value: report.workspace },
    { key: 'Timestamp', value: report.timestamp },
  ]);
  console.log();

  // Display each check
  console.log('Diagnostic Checks:');
  console.log('------------------\n');

  for (const check of report.checks) {
    const icon = statusIcons[check.status];
    const padding = check.status === 'OK' ? '   ' : (check.status === 'WARNING' ? '' : '');
    console.log(`${icon}${padding} ${check.name}`);
    console.log(`       ${check.message}`);

    if (check.suggestion) {
      console.log(`       Suggestion: ${check.suggestion}`);
    }

    if (verbose && check.details) {
      console.log('       Details:');
      for (const [key, value] of Object.entries(check.details)) {
        const displayValue = typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
        console.log(`         ${key}: ${displayValue}`);
      }
    }
    console.log();
  }

  // Display summary
  console.log('Summary:');
  console.log('--------');
  console.log(`  Total checks: ${report.summary.total}`);
  console.log(`  OK: ${report.summary.ok}`);
  console.log(`  Warnings: ${report.summary.warnings}`);
  console.log(`  Errors: ${report.summary.errors}`);
  console.log();

  if (report.actions.length > 0) {
    console.log('Action Plan:');
    console.log('------------');
    for (const action of report.actions) {
      const severity = action.severity.toUpperCase();
      console.log(`  [${severity}] ${action.check}`);
      console.log(`    Command: ${action.command}`);
      if (action.expectedArtifact) {
        console.log(`    Expect: ${action.expectedArtifact}`);
      }
    }
    console.log();
  }

  // Display overall status
  const overallIcon = statusIcons[report.overallStatus];
  console.log(`Overall Status: ${overallIcon} ${report.overallStatus}`);

  if (report.overallStatus === 'ERROR') {
    console.log('\nAction Required: Address the errors above before using Librarian.');
  } else if (report.overallStatus === 'WARNING') {
    console.log('\nNote: Librarian is functional but may have degraded performance.');
  } else {
    console.log('\nLibrarian is healthy and ready to use.');
  }
  console.log();
}
