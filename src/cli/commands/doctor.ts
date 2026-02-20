/**
 * @fileoverview Doctor Command - Health Diagnostic Tool
 *
 * Provides comprehensive health diagnostics for the Librarian system.
 * Checks database, embeddings, packs, vector index, graph edges, and bootstrap status.
 *
 * Usage: librarian doctor [--verbose] [--json] [--heal] [--fix] [--check-consistency]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired, getBootstrapStatus, bootstrapProject, createBootstrapConfig } from '../../api/bootstrap.js';
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
import { inspectWorkspaceLocks } from '../../storage/storage_recovery.js';
import { getSessionState } from '../../memory/session_store.js';

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
  fix?: boolean;
  checkConsistency?: boolean;
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
  'Index Freshness': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Lock File Staleness': {
    command: 'librarian doctor --heal',
    expectedArtifact: '.librarian/locks',
  },
  'Functions/Embeddings Correlation': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Cross-DB Consistency': {
    command: 'librarian bootstrap --force',
    expectedArtifact: '.librarian/librarian.sqlite',
  },
  'Cross-DB Referential Integrity': {
    command: 'librarian doctor --check-consistency --json',
    expectedArtifact: '.librarian/librarian.sqlite',
  },
  Modules: {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Modules Indexed': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Context Packs Health': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Context Pack References': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Vector Index': {
    command: 'librarian bootstrap --force',
    expectedArtifact: 'state/audits/librarian/bootstrap',
  },
  'Embedding Integrity': {
    command: 'librarian doctor --fix',
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
  'MCP Registration': {
    command: 'librarian quickstart --mode full',
    expectedArtifact: '.claude/settings.json',
  },
  'Install Footprint': {
    command: 'npm prune',
  },
  'Grammar Coverage': {
    command: 'librarian doctor --install-grammars',
  },
  'Parser Coverage': {
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

const INDEX_STALE_THRESHOLD_MS = 24 * 60 * 60_000;
const CONTEXT_PACK_REFERENCE_SCAN_LIMIT = 2_000;
const WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS = 2 * 60 * 60_000;
const SOURCE_SCAN_LIMIT = 8_000;
const SOURCE_SCAN_DIR_LIMIT = 4_000;
const EMBEDDING_INVALID_NORM_TOLERANCE = 1e-10;
const EMBEDDING_INTEGRITY_SAMPLE_LIMIT = 20;
const EXCLUDED_SCAN_DIRS = new Set([
  '.git',
  '.librarian',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'state',
]);
const SOURCE_FILE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.rs', '.rb', '.php',
  '.cs', '.cpp', '.cc', '.c', '.h', '.hpp',
  '.swift', '.kt', '.kts', '.scala',
]);

type EmbeddingIntegrityStorage = LibrarianStorage & {
  inspectEmbeddingIntegrity?: (options?: { normTolerance?: number; sampleLimit?: number }) => Promise<{
    totalEmbeddings: number;
    invalidEmbeddings: number;
    sampleEntityIds: string[];
  }>;
  purgeInvalidEmbeddings?: (options?: { normTolerance?: number; sampleLimit?: number }) => Promise<{
    removedEmbeddings: number;
    removedMultiVectors: number;
    sampleEntityIds: string[];
  }>;
};

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM';
  }
}

function parseLockPid(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)) return parsed.pid;
  } catch {
    const parsedInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsedInt)) return parsedInt;
  }
  return null;
}

type NewestSourceSnapshot = {
  newestFile: string | null;
  newestMtimeMs: number | null;
  scannedFiles: number;
  visitedDirs: number;
  truncated: boolean;
};

function scanNewestSourceFile(workspace: string): NewestSourceSnapshot {
  const snapshot: NewestSourceSnapshot = {
    newestFile: null,
    newestMtimeMs: null,
    scannedFiles: 0,
    visitedDirs: 0,
    truncated: false,
  };

  if (!fs.existsSync(workspace)) return snapshot;
  const stack: string[] = [workspace];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (snapshot.visitedDirs >= SOURCE_SCAN_DIR_LIMIT || snapshot.scannedFiles >= SOURCE_SCAN_LIMIT) {
      snapshot.truncated = true;
      break;
    }
    snapshot.visitedDirs += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_SCAN_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      snapshot.scannedFiles += 1;
      if (snapshot.scannedFiles >= SOURCE_SCAN_LIMIT) {
        snapshot.truncated = true;
      }

      try {
        const stats = fs.statSync(fullPath);
        if (snapshot.newestMtimeMs === null || stats.mtimeMs > snapshot.newestMtimeMs) {
          snapshot.newestMtimeMs = stats.mtimeMs;
          snapshot.newestFile = fullPath;
        }
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  return snapshot;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeSearchable(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return value.map(v => normalizeSearchable(v)).join(' ').toLowerCase();
  if (value && typeof value === 'object') return JSON.stringify(value).toLowerCase();
  return '';
}

function hasLibrarianMcpRegistration(config: Record<string, unknown>): boolean {
  const mcpServers = config.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return false;
  for (const [name, spec] of Object.entries(mcpServers)) {
    if (name.toLowerCase().includes('librarian') || name.toLowerCase().includes('librainian')) {
      return true;
    }
    const searchable = normalizeSearchable(spec);
    if (searchable.includes('librarian') || searchable.includes('librainian')) {
      return true;
    }
  }
  return false;
}

function resolveMcpConfigCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'claude_desktop_config.json'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, '.config', 'Cursor', 'User', 'settings.json'),
  ];
}

function removeStaleBootstrapLock(workspace: string): { removed: boolean; path?: string; error?: string } {
  const lockPath = path.join(workspace, '.librarian', 'bootstrap.lock');
  if (!fs.existsSync(lockPath)) return { removed: false };
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const pid = parseLockPid(raw);
    const stats = fs.statSync(lockPath);
    const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
    const staleByPid = pid !== null && !isPidAlive(pid);
    const staleUnknown = pid === null && ageMs > WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS;
    if (staleByPid || staleUnknown) {
      fs.unlinkSync(lockPath);
      return { removed: true, path: lockPath };
    }
    return { removed: false };
  } catch (error) {
    return {
      removed: false,
      path: lockPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

    if (coverage < 20) {
      check.status = 'ERROR';
      check.message = `Critical embedding coverage: ${coverage.toFixed(1)}% (${totalEmbeddings}/${totalFunctions})`;
      check.suggestion = 'Embedding generation likely failed. Run `librarian bootstrap --force` and verify provider health.';
    } else if (coverage < 80) {
      check.status = 'WARNING';
      check.message = `Partial embedding coverage: ${coverage.toFixed(1)}% (${totalEmbeddings}/${totalFunctions})`;
      check.suggestion = 'Some functions may be missing embeddings. Consider rebootstrapping.';
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
 * Check: context pack file references still resolve on disk.
 */
async function checkContextPackReferences(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Context Pack References',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    const [stats, packs] = await Promise.all([
      storage.getStats(),
      storage.getContextPacks({ limit: CONTEXT_PACK_REFERENCE_SCAN_LIMIT }),
    ]);
    await storage.close();

    const missingRefs: string[] = [];
    let missingCount = 0;
    for (const pack of packs) {
      const referencedPaths = new Set<string>();
      for (const relatedFile of pack.relatedFiles) {
        if (typeof relatedFile === 'string' && relatedFile.trim()) referencedPaths.add(relatedFile);
      }
      for (const snippet of pack.codeSnippets) {
        if (snippet?.filePath?.trim()) referencedPaths.add(snippet.filePath);
      }
      for (const referencedPath of referencedPaths) {
        const resolved = path.isAbsolute(referencedPath)
          ? referencedPath
          : path.join(workspace, referencedPath);
        if (!fs.existsSync(resolved)) {
          missingCount += 1;
          if (missingRefs.length < 20) {
            missingRefs.push(`${pack.packId}:${referencedPath}`);
          }
        }
      }
    }

    check.details = {
      scannedPacks: packs.length,
      totalPacks: stats.totalContextPacks,
      truncated: stats.totalContextPacks > packs.length,
      missingReferenceCount: missingCount,
      sampleMissingReferences: missingRefs,
    };

    if (missingCount > 0) {
      check.status = 'WARNING';
      check.message = `Broken context-pack references detected (${missingCount})`;
      check.suggestion = 'Run `librarian bootstrap --force` to refresh context packs after file moves/deletes';
      return check;
    }

    check.message = 'Context-pack references are valid';
    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to validate context-pack references: ${error instanceof Error ? error.message : String(error)}`;
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
 * Check: invalid embedding vectors (zero norm / non-finite) in persistent storage.
 */
async function checkEmbeddingIntegrity(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Embedding Integrity',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace) as EmbeddingIntegrityStorage;
    await storage.initialize();
    const inspect = storage.inspectEmbeddingIntegrity;
    if (typeof inspect !== 'function') {
      await storage.close();
      check.message = 'Embedding integrity scan unavailable for this storage backend';
      return check;
    }

    const integrity = await inspect({
      normTolerance: EMBEDDING_INVALID_NORM_TOLERANCE,
      sampleLimit: EMBEDDING_INTEGRITY_SAMPLE_LIMIT,
    });
    await storage.close();

    check.details = {
      totalEmbeddings: integrity.totalEmbeddings,
      invalidEmbeddings: integrity.invalidEmbeddings,
      sampleEntityIds: integrity.sampleEntityIds,
      normTolerance: EMBEDDING_INVALID_NORM_TOLERANCE,
    };

    if (integrity.invalidEmbeddings > 0) {
      check.status = 'WARNING';
      check.message = `Detected ${integrity.invalidEmbeddings} invalid embedding(s) (zero-norm or non-finite)`;
      check.suggestion = 'Run `librarian doctor --fix` to purge and regenerate invalid embeddings';
      return check;
    }

    check.message = 'All stored embeddings passed norm/integrity validation';
    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check embedding integrity: ${error instanceof Error ? error.message : String(error)}`;
    check.suggestion = 'Run `librarian bootstrap --force` to rebuild embeddings';
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
 * Check: Index freshness against source file changes.
 */
async function checkIndexFreshness(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Index Freshness',
    status: 'OK',
    message: '',
  };

  try {
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    const metadata = await storage.getMetadata();
    await storage.close();

    const lastIndexing = metadata?.lastIndexing
      ? new Date(metadata.lastIndexing).getTime()
      : null;
    const scan = scanNewestSourceFile(workspace);

    check.details = {
      lastIndexing: lastIndexing !== null ? new Date(lastIndexing).toISOString() : null,
      newestSourceFile: scan.newestFile,
      newestSourceMtime: scan.newestMtimeMs !== null ? new Date(scan.newestMtimeMs).toISOString() : null,
      scannedFiles: scan.scannedFiles,
      visitedDirs: scan.visitedDirs,
      truncated: scan.truncated,
      staleThresholdHours: INDEX_STALE_THRESHOLD_MS / (60 * 60_000),
    };

    if (scan.newestMtimeMs === null) {
      check.status = 'WARNING';
      check.message = 'No source files detected for freshness check';
      check.suggestion = 'Verify workspace root points to the project source tree';
      return check;
    }

    if (lastIndexing === null || !Number.isFinite(lastIndexing)) {
      check.status = 'WARNING';
      check.message = 'Missing last-index timestamp';
      check.suggestion = 'Run `librarian bootstrap --force` to create a fresh index baseline';
      return check;
    }

    const lagMs = scan.newestMtimeMs - lastIndexing;
    if (lagMs > INDEX_STALE_THRESHOLD_MS) {
      check.status = 'WARNING';
      check.message = `Index stale by ${formatAge(lagMs)} relative to source changes`;
      check.suggestion = 'Run `librarian bootstrap --force` to refresh stale index data';
      return check;
    }

    check.message = 'Index freshness within 24h threshold';
    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check index freshness: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check: Detect legacy multi-DB divergence artifacts.
 */
async function checkCrossDbConsistency(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Cross-DB Consistency',
    status: 'OK',
    message: '',
  };

  try {
    const librarianDir = path.join(workspace, '.librarian');
    const legacyCandidates = [
      path.join(librarianDir, 'knowledge.db'),
      path.join(librarianDir, 'evidence_ledger.db'),
      path.join(librarianDir, 'librarian.db'),
    ];

    const activeDb = path.resolve(dbPath);
    const legacyFiles = legacyCandidates.filter((candidate) => {
      if (!fs.existsSync(candidate)) return false;
      return path.resolve(candidate) !== activeDb;
    });

    check.details = {
      activeDb,
      legacyFiles,
      legacyCount: legacyFiles.length,
    };

    if (legacyFiles.length === 0) {
      check.message = 'No legacy DB divergence artifacts detected';
      return check;
    }

    let newestLegacyMs = 0;
    for (const legacyFile of legacyFiles) {
      try {
        newestLegacyMs = Math.max(newestLegacyMs, fs.statSync(legacyFile).mtimeMs);
      } catch {
        // Ignore stat failures; existence already confirmed.
      }
    }
    const activeMtimeMs = fs.existsSync(activeDb) ? fs.statSync(activeDb).mtimeMs : 0;

    if (newestLegacyMs > activeMtimeMs + 1_000) {
      check.status = 'ERROR';
      check.message = `Legacy DB files are newer than active store (${legacyFiles.length} files)`;
      check.suggestion = 'Run `librarian bootstrap --force` to rebuild and converge into .librarian/librarian.sqlite';
      return check;
    }

    check.status = 'WARNING';
    check.message = `Legacy DB artifacts detected (${legacyFiles.length} files)`;
    check.suggestion = 'Remove stale legacy DB files after verifying current index health';
    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to check cross-DB consistency: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check: strict referential integrity across core knowledge tables.
 *
 * Triggered by `doctor --check-consistency` for deeper consistency audits.
 */
async function checkCrossDbReferentialIntegrity(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Cross-DB Referential Integrity',
    status: 'OK',
    message: '',
  };

  const tableExists = (db: Database.Database, table: string): boolean => {
    const row = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table) as { 1?: number } | undefined;
    return Boolean(row);
  };

  const collectSample = (db: Database.Database, sql: string, limit = 8): string[] => {
    const rows = db.prepare(`${sql} LIMIT ?`).all(limit) as Array<{ ref?: string }>;
    return rows
      .map((row) => (typeof row.ref === 'string' ? row.ref : null))
      .filter((value): value is string => Boolean(value));
  };

  try {
    if (!fs.existsSync(dbPath)) {
      check.status = 'WARNING';
      check.message = 'Consistency check skipped: active database not found';
      check.suggestion = 'Run `librarian bootstrap --force` to create the active store';
      return check;
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const requiredTables = [
        'librarian_embeddings',
        'librarian_functions',
        'librarian_modules',
        'librarian_context_packs',
        'librarian_confidence_events',
        'librarian_evidence',
      ];
      const presentTables = requiredTables.filter((table) => tableExists(db, table));
      const missingTables = requiredTables.filter((table) => !presentTables.includes(table));

      const orphanEmbeddingCount = presentTables.includes('librarian_embeddings')
        && presentTables.includes('librarian_functions')
        && presentTables.includes('librarian_modules')
        ? Number((db.prepare(`
          SELECT COUNT(*) AS count
          FROM librarian_embeddings e
          LEFT JOIN librarian_functions f ON e.entity_type = 'function' AND f.id = e.entity_id
          LEFT JOIN librarian_modules m ON e.entity_type = 'module' AND m.id = e.entity_id
          WHERE (e.entity_type = 'function' AND f.id IS NULL)
             OR (e.entity_type = 'module' AND m.id IS NULL)
        `).get() as { count?: number } | undefined)?.count ?? 0)
        : null;

      const orphanEmbeddingSample = orphanEmbeddingCount && orphanEmbeddingCount > 0
        ? collectSample(db, `
          SELECT e.entity_type || ':' || e.entity_id AS ref
          FROM librarian_embeddings e
          LEFT JOIN librarian_functions f ON e.entity_type = 'function' AND f.id = e.entity_id
          LEFT JOIN librarian_modules m ON e.entity_type = 'module' AND m.id = e.entity_id
          WHERE (e.entity_type = 'function' AND f.id IS NULL)
             OR (e.entity_type = 'module' AND m.id IS NULL)
        `)
        : [];

      const orphanConfidenceCount = presentTables.includes('librarian_confidence_events')
        && presentTables.includes('librarian_functions')
        && presentTables.includes('librarian_modules')
        && presentTables.includes('librarian_context_packs')
        ? Number((db.prepare(`
          SELECT COUNT(*) AS count
          FROM librarian_confidence_events c
          LEFT JOIN librarian_functions f ON c.entity_type = 'function' AND f.id = c.entity_id
          LEFT JOIN librarian_modules m ON c.entity_type = 'module' AND m.id = c.entity_id
          LEFT JOIN librarian_context_packs p ON c.entity_type = 'context_pack' AND p.pack_id = c.entity_id
          WHERE (c.entity_type = 'function' AND f.id IS NULL)
             OR (c.entity_type = 'module' AND m.id IS NULL)
             OR (c.entity_type = 'context_pack' AND p.pack_id IS NULL)
        `).get() as { count?: number } | undefined)?.count ?? 0)
        : null;

      const orphanConfidenceSample = orphanConfidenceCount && orphanConfidenceCount > 0
        ? collectSample(db, `
          SELECT c.entity_type || ':' || c.entity_id AS ref
          FROM librarian_confidence_events c
          LEFT JOIN librarian_functions f ON c.entity_type = 'function' AND f.id = c.entity_id
          LEFT JOIN librarian_modules m ON c.entity_type = 'module' AND m.id = c.entity_id
          LEFT JOIN librarian_context_packs p ON c.entity_type = 'context_pack' AND p.pack_id = c.entity_id
          WHERE (c.entity_type = 'function' AND f.id IS NULL)
             OR (c.entity_type = 'module' AND m.id IS NULL)
             OR (c.entity_type = 'context_pack' AND p.pack_id IS NULL)
        `)
        : [];

      const orphanEvidenceCount = presentTables.includes('librarian_evidence')
        && presentTables.includes('librarian_functions')
        && presentTables.includes('librarian_modules')
        ? Number((db.prepare(`
          SELECT COUNT(*) AS count
          FROM librarian_evidence e
          LEFT JOIN librarian_functions f ON e.entity_type = 'function' AND f.id = e.entity_id
          LEFT JOIN librarian_modules m ON e.entity_type = 'module' AND m.id = e.entity_id
          WHERE (e.entity_type = 'function' AND f.id IS NULL)
             OR (e.entity_type = 'module' AND m.id IS NULL)
        `).get() as { count?: number } | undefined)?.count ?? 0)
        : null;

      const orphanEvidenceSample = orphanEvidenceCount && orphanEvidenceCount > 0
        ? collectSample(db, `
          SELECT e.entity_type || ':' || e.entity_id AS ref
          FROM librarian_evidence e
          LEFT JOIN librarian_functions f ON e.entity_type = 'function' AND f.id = e.entity_id
          LEFT JOIN librarian_modules m ON e.entity_type = 'module' AND m.id = e.entity_id
          WHERE (e.entity_type = 'function' AND f.id IS NULL)
             OR (e.entity_type = 'module' AND m.id IS NULL)
        `)
        : [];

      const orphanTotal = [orphanEmbeddingCount, orphanConfidenceCount, orphanEvidenceCount]
        .filter((value): value is number => typeof value === 'number')
        .reduce((sum, value) => sum + value, 0);

      check.details = {
        workspace,
        dbPath,
        presentTables,
        missingTables,
        orphanEmbeddingCount,
        orphanEmbeddingSample,
        orphanConfidenceCount,
        orphanConfidenceSample,
        orphanEvidenceCount,
        orphanEvidenceSample,
      };

      if (presentTables.length === 0) {
        check.status = 'WARNING';
        check.message = 'Consistency check skipped: core tables were not found in active DB';
        check.suggestion = 'Run `librarian bootstrap --force` to initialize schema tables';
        return check;
      }

      if (orphanTotal > 0) {
        check.status = 'ERROR';
        check.message = `Detected ${orphanTotal} orphan references across active consistency tables`;
        check.suggestion = 'Run `librarian bootstrap --force` and re-run `librarian doctor --check-consistency --json`';
        return check;
      }

      if (missingTables.length > 0) {
        check.status = 'WARNING';
        check.message = 'No orphan references detected in available tables, but some consistency tables are missing';
        check.suggestion = 'Run `librarian bootstrap --force` to restore missing schema tables';
        return check;
      }

      check.message = 'No orphan references detected across consistency tables';
      return check;
    } finally {
      db.close();
    }
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to run strict consistency check: ${error instanceof Error ? error.message : String(error)}`;
    check.suggestion = 'Run `librarian bootstrap --force` and retry `librarian doctor --check-consistency`';
    return check;
  }
}

/**
 * Check: stale lock files in workspace lock directories.
 */
async function checkLockFileStaleness(
  workspace: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Lock File Staleness',
    status: 'OK',
    message: '',
  };

  try {
    const inspectedLocks = await inspectWorkspaceLocks(workspace);
    const stalePaths = [...inspectedLocks.stalePaths];
    const bootstrapLockPath = path.join(workspace, '.librarian', 'bootstrap.lock');
    let bootstrapLockPid: number | null = null;
    let bootstrapLockActive = false;

    if (fs.existsSync(bootstrapLockPath)) {
      try {
        const raw = fs.readFileSync(bootstrapLockPath, 'utf8');
        bootstrapLockPid = parseLockPid(raw);
        const stats = fs.statSync(bootstrapLockPath);
        const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
        const staleByPid = bootstrapLockPid !== null && !isPidAlive(bootstrapLockPid);
        const staleUnknown = bootstrapLockPid === null && ageMs > WORKSPACE_LOCK_UNKNOWN_STALE_TIMEOUT_MS;
        if (staleByPid || staleUnknown) {
          stalePaths.push(bootstrapLockPath);
        } else if (bootstrapLockPid !== null && isPidAlive(bootstrapLockPid)) {
          bootstrapLockActive = true;
        }
      } catch {
        stalePaths.push(bootstrapLockPath);
      }
    }

    check.details = {
      lockDirs: inspectedLocks.lockDirs,
      scannedFiles: inspectedLocks.scannedFiles,
      staleFiles: inspectedLocks.staleFiles,
      activePidFiles: inspectedLocks.activePidFiles,
      unknownFreshFiles: inspectedLocks.unknownFreshFiles,
      bootstrapLockPath: fs.existsSync(bootstrapLockPath) ? bootstrapLockPath : null,
      bootstrapLockPid,
      bootstrapLockActive,
      stalePaths,
    };

    if (stalePaths.length > 0) {
      check.status = 'WARNING';
      check.message = `Detected ${stalePaths.length} stale lock file(s)`;
      check.suggestion = 'Run `librarian doctor --heal` to safely remove stale lock files';
      return check;
    }

    if (inspectedLocks.unknownFreshFiles > 0) {
      check.status = 'WARNING';
      check.message = `Found ${inspectedLocks.unknownFreshFiles} lock file(s) with unknown PID`;
      check.suggestion = 'If indexing appears stuck, run `librarian doctor --heal`';
      return check;
    }

    check.message = 'No stale lock files detected';
    return check;
  } catch (error) {
    check.status = 'ERROR';
    check.message = `Failed to inspect lock files: ${error instanceof Error ? error.message : String(error)}`;
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
 * Check: MCP registration in known local client config files.
 */
async function checkMcpRegistration(): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'MCP Registration',
    status: 'OK',
    message: '',
  };

  try {
    const configCandidates = resolveMcpConfigCandidates();
    const existingConfigs = configCandidates.filter(candidate => fs.existsSync(candidate));
    const matchedConfigs: string[] = [];

    for (const configPath of existingConfigs) {
      const parsed = readJsonFile(configPath);
      if (!parsed) continue;
      if (hasLibrarianMcpRegistration(parsed)) {
        matchedConfigs.push(configPath);
      }
    }

    check.details = {
      configCandidates,
      existingConfigs,
      matchedConfigs,
    };

    if (matchedConfigs.length > 0) {
      check.message = `MCP registration found (${matchedConfigs[0]})`;
      return check;
    }

    if (existingConfigs.length === 0) {
      check.status = 'WARNING';
      check.message = 'No MCP client config files found';
      check.suggestion = 'Add librarian to MCP client config (see docs/librarian/MCP_SERVER.md)';
      return check;
    }

    check.status = 'WARNING';
    check.message = 'MCP config exists but librarian server is not registered';
    check.suggestion = 'Add a `mcpServers.librarian` entry in ~/.claude/settings.json or cursor MCP config';
    return check;
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Failed to check MCP registration: ${error instanceof Error ? error.message : String(error)}`;
    return check;
  }
}

/**
 * Check: installation footprint for known packaging bloat.
 */
async function checkInstallFootprint(
  workspace: string
): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Install Footprint',
    status: 'OK',
    message: '',
  };

  try {
    const packageRoots = [
      path.join(workspace, 'node_modules', 'librainian'),
      path.join(workspace, 'node_modules', '@librainian', 'core'),
    ];
    const discoveredRoots = packageRoots.filter(candidate => fs.existsSync(candidate));
    const bloatCandidates = [
      'src/epistemics',
      'src/evaluation',
      'docs/librarian/legacy',
    ];

    const bloatedPaths: string[] = [];
    for (const pkgRoot of discoveredRoots) {
      for (const relativePath of bloatCandidates) {
        const candidate = path.join(pkgRoot, relativePath);
        if (fs.existsSync(candidate)) {
          bloatedPaths.push(candidate);
        }
      }
    }

    check.details = {
      packageRoots: discoveredRoots,
      bloatCandidates,
      bloatedPaths,
    };

    if (discoveredRoots.length === 0) {
      check.message = 'No local node_modules package footprint to inspect';
      return check;
    }

    if (bloatedPaths.length > 0) {
      check.status = 'WARNING';
      check.message = `Detected ${bloatedPaths.length} potentially dead packaged directories`;
      check.suggestion = 'Run `npm prune` and update package `files` exclusions before release';
      return check;
    }

    check.message = 'Package footprint excludes known dead-code directories';
    return check;
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Failed to inspect install footprint: ${error instanceof Error ? error.message : String(error)}`;
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

async function checkSessionMemory(workspace: string): Promise<DiagnosticCheck> {
  const check: DiagnosticCheck = {
    name: 'Session Memory',
    status: 'OK',
    message: 'Session memory healthy',
  };

  try {
    const state = await getSessionState(workspace);
    const startedAtMs = Date.parse(state.startedAt);
    const lastActiveMs = Date.parse(state.lastActiveAt);
    const ageMinutes = Number.isFinite(startedAtMs)
      ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000))
      : null;
    const inactiveMinutes = Number.isFinite(lastActiveMs)
      ? Math.max(0, Math.floor((Date.now() - lastActiveMs) / 60000))
      : null;
    check.message = state.episodicLog.length > 0
      ? `Session active (${state.episodicLog.length} episodic events)`
      : 'Session initialized (no episodic events yet)';
    check.details = {
      startedAt: state.startedAt,
      lastActiveAt: state.lastActiveAt,
      ageMinutes,
      inactiveMinutes,
      activeTask: state.workingContext.activeTask ?? null,
      recentQueries: state.workingContext.recentQueries.slice(0, 5),
      recentFiles: state.workingContext.recentFiles.slice(0, 5),
      coreMemoryEntries: Object.keys(state.workingContext.coreMemory).length,
    };
  } catch (error) {
    check.status = 'WARNING';
    check.message = `Session memory unavailable: ${error instanceof Error ? error.message : String(error)}`;
    check.suggestion = 'Run a query to initialize session memory and retry `librarian doctor --json`.';
  }

  return check;
}

async function runEmbeddingIntegrityFix(
  workspace: string,
  dbPath: string
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const storage = createSqliteStorage(dbPath, workspace) as EmbeddingIntegrityStorage;
  await storage.initialize();

  try {
    if (typeof storage.inspectEmbeddingIntegrity !== 'function' || typeof storage.purgeInvalidEmbeddings !== 'function') {
      checks.push({
        name: 'Embedding Integrity Remediation',
        status: 'WARNING',
        message: 'Embedding integrity remediation unavailable for this storage backend',
        suggestion: 'Run `librarian bootstrap --force` to regenerate embeddings',
      });
      return checks;
    }

    const integrity = await storage.inspectEmbeddingIntegrity({
      normTolerance: EMBEDDING_INVALID_NORM_TOLERANCE,
      sampleLimit: EMBEDDING_INTEGRITY_SAMPLE_LIMIT,
    });

    if (integrity.invalidEmbeddings === 0) {
      checks.push({
        name: 'Embedding Integrity Remediation',
        status: 'OK',
        message: 'No invalid embeddings detected; remediation not required',
        details: {
          totalEmbeddings: integrity.totalEmbeddings,
          invalidEmbeddings: 0,
        },
      });
      return checks;
    }

    const purge = await storage.purgeInvalidEmbeddings({
      normTolerance: EMBEDDING_INVALID_NORM_TOLERANCE,
      sampleLimit: EMBEDDING_INTEGRITY_SAMPLE_LIMIT,
    });

    checks.push({
      name: 'Embedding Integrity Remediation',
      status: 'OK',
      message: `Removed ${purge.removedEmbeddings} invalid embedding(s) and ${purge.removedMultiVectors} multi-vector record(s)`,
      details: {
        removedEmbeddings: purge.removedEmbeddings,
        removedMultiVectors: purge.removedMultiVectors,
        sampleEntityIds: purge.sampleEntityIds,
      },
    });

    const bootstrapConfig = createBootstrapConfig(workspace, {
      bootstrapMode: 'fast',
      forceReindex: true,
      skipLlm: true,
      skipEmbeddings: false,
      emitBaseline: false,
    });
    const bootstrap = await bootstrapProject(bootstrapConfig, storage);
    checks.push({
      name: 'Embedding Re-embed',
      status: bootstrap.success ? 'OK' : 'ERROR',
      message: bootstrap.success
        ? `Re-embedded via bootstrap (${bootstrap.totalFilesProcessed} files)`
        : `Re-embed bootstrap failed: ${bootstrap.error ?? 'unknown error'}`,
      details: {
        success: bootstrap.success,
        totalFilesProcessed: bootstrap.totalFilesProcessed,
        totalFunctionsIndexed: bootstrap.totalFunctionsIndexed,
      },
      suggestion: bootstrap.success ? undefined : 'Run `librarian bootstrap --force` to complete re-embedding',
    });
  } catch (error) {
    checks.push({
      name: 'Embedding Integrity Remediation',
      status: 'ERROR',
      message: `Failed to remediate invalid embeddings: ${error instanceof Error ? error.message : String(error)}`,
      suggestion: 'Run `librarian bootstrap --force` to rebuild embeddings',
    });
  } finally {
    await storage.close();
  }

  return checks;
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
    fix = false,
    checkConsistency = false,
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

      const staleBootstrapCleanup = removeStaleBootstrapLock(workspaceRoot);
      if (staleBootstrapCleanup.error) {
        healChecks.push({
          name: 'Lock File Staleness',
          status: 'ERROR',
          message: `Failed to remove stale bootstrap lock: ${staleBootstrapCleanup.error}`,
          details: { lockPath: staleBootstrapCleanup.path ?? null },
          suggestion: 'Delete .librarian/bootstrap.lock manually if the process is no longer running',
        });
      } else if (staleBootstrapCleanup.removed) {
        healChecks.push({
          name: 'Lock File Staleness',
          status: 'OK',
          message: 'Removed stale bootstrap lock file',
          details: { lockPath: staleBootstrapCleanup.path ?? null },
        });
      }

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

  if (fix) {
    const embeddingFixChecks = await runEmbeddingIntegrityFix(workspaceRoot, dbPath);
    healChecks.push(...embeddingFixChecks);
  }

  // Run all diagnostic checks
  const checks = await Promise.all([
    checkDatabase(workspaceRoot),
    checkBootstrapStatus(workspaceRoot, dbPath),
    checkIndexFreshness(workspaceRoot, dbPath),
    checkWatchFreshness(workspaceRoot, dbPath),
    checkSessionMemory(workspaceRoot),
    checkLockFileStaleness(workspaceRoot),
    checkFunctionsVsEmbeddings(workspaceRoot, dbPath),
    checkCrossDbConsistency(workspaceRoot, dbPath),
    checkModules(workspaceRoot, dbPath),
    checkPacksCorrelation(workspaceRoot, dbPath),
    checkContextPackReferences(workspaceRoot, dbPath),
    checkVectorIndex(workspaceRoot, dbPath),
    checkEmbeddingIntegrity(workspaceRoot, dbPath),
    checkGraphEdges(workspaceRoot, dbPath),
    checkConfidenceLevel(workspaceRoot, dbPath),
    checkEmbeddingProvider(workspaceRoot),
    checkLLMProvider(workspaceRoot),
    checkMcpRegistration(),
    checkInstallFootprint(workspaceRoot),
    checkGrammarCoverage(workspaceRoot, installGrammars, json),
    ...(checkConsistency ? [checkCrossDbReferentialIntegrity(workspaceRoot, dbPath)] : []),
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
