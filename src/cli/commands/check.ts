/**
 * @fileoverview CI-oriented knowledge integrity checks.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { getGitDiffNames, getGitStatusChanges, isGitRepo } from '../../utils/git.js';
import { emitJsonOutput } from '../json_output.js';
import { createError } from '../errors.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, GraphEdge } from '../../types.js';

const WISDOM_COVERAGE_MIN_FUNCTIONS = 50;
const WISDOM_COVERAGE_THRESHOLD = 0.2;

export interface CheckCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type CheckStatus = 'pass' | 'warn' | 'fail';

type OutputFormat = 'text' | 'json' | 'junit';

interface DiffChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface LintCheck {
  name: string;
  status: CheckStatus;
  message: string;
  files?: string[];
  fix?: string;
}

export interface LintResult {
  kind: 'LibrarianCheck.v1';
  status: CheckStatus | 'unchecked';
  diff: string;
  checks: LintCheck[];
  summary: string;
  generatedAt: string;
}

export async function checkCommand(options: CheckCommandOptions): Promise<number> {
  const workspaceRoot = path.resolve(options.workspace);
  const parseSource = options.rawArgs.length > 1 ? options.rawArgs.slice(1) : options.args;
  const { diff, format, out } = parseOptions(parseSource);

  const dbPath = await resolveDbPath(workspaceRoot);
  const storage = createSqliteStorage(dbPath, workspaceRoot);

  try {
    await storage.initialize();
  } catch {
    const report = createUncheckedResult(diff, 'Run librainian bootstrap first.');
    await emitResult(report, format, out);
    return 2;
  }

  try {
    const bootstrap = await isBootstrapRequired(workspaceRoot, storage);
    if (bootstrap.required) {
      const report = createUncheckedResult(diff, 'Run librainian bootstrap first.');
      await emitResult(report, format, out);
      return 2;
    }

    const changes = await resolveDiffChanges(workspaceRoot, diff);
    const checks = await runChecks(storage, workspaceRoot, changes);
    const report = buildResult(diff, checks);

    await emitResult(report, format, out);

    if (report.status === 'fail') return 1;
    return 0;
  } finally {
    await storage.close();
  }
}

function parseOptions(args: string[]): { diff: string; format: OutputFormat; out?: string } {
  const { values } = parseArgs({
    args,
    options: {
      diff: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const diff = typeof values.diff === 'string' && values.diff.trim().length > 0
    ? values.diff.trim()
    : 'working-tree';

  const rawFormat = (values.json ? 'json' : values.format) ?? 'text';
  if (rawFormat !== 'text' && rawFormat !== 'json' && rawFormat !== 'junit') {
    throw createError('INVALID_ARGUMENT', 'Invalid --format. Expected text|json|junit');
  }

  const out = typeof values.out === 'string' && values.out.trim().length > 0
    ? values.out.trim()
    : undefined;

  return {
    diff,
    format: rawFormat,
    out,
  };
}

function createUncheckedResult(diff: string, message: string): LintResult {
  return {
    kind: 'LibrarianCheck.v1',
    status: 'unchecked',
    diff,
    checks: [],
    summary: message,
    generatedAt: new Date().toISOString(),
  };
}

function buildResult(diff: string, checks: LintCheck[]): LintResult {
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;
  const passCount = checks.length - failCount - warnCount;

  const status: CheckStatus = failCount > 0
    ? 'fail'
    : warnCount > 0
      ? 'warn'
      : 'pass';

  return {
    kind: 'LibrarianCheck.v1',
    status,
    diff,
    checks,
    summary: `checks=${checks.length} pass=${passCount} warn=${warnCount} fail=${failCount}`,
    generatedAt: new Date().toISOString(),
  };
}

async function emitResult(report: LintResult, format: OutputFormat, out?: string): Promise<void> {
  if (format === 'json') {
    await emitJsonOutput(report, out);
    return;
  }

  if (format === 'junit') {
    const xml = renderJunit(report);
    await writeOutput(xml, out);
    return;
  }

  const text = renderText(report);
  await writeOutput(text, out);
}

async function writeOutput(content: string, out?: string): Promise<void> {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  if (!out) {
    console.log(normalized.trimEnd());
    return;
  }

  const resolved = path.resolve(out);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, normalized, 'utf8');
  process.stderr.write(`Output written to ${resolved}\n`);
}

function renderText(report: LintResult): string {
  const lines: string[] = [
    'LiBrainian Check',
    '================',
    `Status: ${report.status.toUpperCase()}`,
    `Diff: ${report.diff}`,
    `Summary: ${report.summary}`,
    '',
  ];

  if (report.status === 'unchecked') {
    lines.push('Run librainian bootstrap first.');
    return lines.join('\n');
  }

  for (const check of report.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.name} - ${check.message}`);
    if (check.files && check.files.length > 0) {
      lines.push(`  files: ${check.files.join(', ')}`);
    }
    if (check.fix) {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  return lines.join('\n');
}

function renderJunit(report: LintResult): string {
  const checks = report.status === 'unchecked'
    ? [{ name: 'bootstrap_required', status: 'fail' as const, message: report.summary }]
    : report.checks;

  const testCount = checks.length;
  const failures = checks.filter((check) => check.status === 'fail').length;

  const cases = checks.map((check) => {
    const name = escapeXml(check.name);
    const message = escapeXml(check.message);
    const files = check.files?.length ? ` files=${check.files.join(', ')}` : '';

    if (check.status === 'fail') {
      return `    <testcase classname="librarian.check" name="${name}">\n      <failure message="${message}">${escapeXml(`${check.message}${files}`)}</failure>\n    </testcase>`;
    }

    if (check.status === 'warn') {
      return `    <testcase classname="librarian.check" name="${name}">\n      <system-out>${escapeXml(`WARN: ${check.message}${files}`)}</system-out>\n    </testcase>`;
    }

    return `    <testcase classname="librarian.check" name="${name}"/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${testCount}" failures="${failures}">`,
    `  <testsuite name="librarian.check" tests="${testCount}" failures="${failures}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function resolveDiffChanges(workspaceRoot: string, diff: string): Promise<DiffChanges> {
  if (!isGitRepo(workspaceRoot)) {
    return { added: [], modified: [], deleted: [] };
  }

  if (diff === 'working-tree') {
    return (await getGitStatusChanges(workspaceRoot)) ?? { added: [], modified: [], deleted: [] };
  }

  if (diff.includes('..')) {
    try {
      const output = execSync(`git diff --name-status ${diff}`, {
        cwd: workspaceRoot,
        encoding: 'utf8',
      }) as string;
      return parseNameStatusOutput(String(output));
    } catch {
      return { added: [], modified: [], deleted: [] };
    }
  }

  return (await getGitDiffNames(workspaceRoot, diff)) ?? { added: [], modified: [], deleted: [] };
}

function parseNameStatusOutput(output: string): DiffChanges {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const line of output.trim().split('\n').filter(Boolean)) {
    const parts = line.split(/\s+/);
    const status = parts[0] ?? '';
    const pathA = parts[1];
    const pathB = parts[2];

    if (status.startsWith('A') && pathA) {
      added.push(pathA);
    } else if (status.startsWith('D') && pathA) {
      deleted.push(pathA);
    } else if (status.startsWith('R')) {
      if (pathA) deleted.push(pathA);
      if (pathB) added.push(pathB);
    } else if (status.startsWith('C') && pathB) {
      added.push(pathB);
    } else if (pathA) {
      modified.push(pathA);
    }
  }

  return { added, modified, deleted };
}

async function runChecks(storage: LibrarianStorage, workspaceRoot: string, changes: DiffChanges): Promise<LintCheck[]> {
  const changedExisting = uniq([
    ...changes.added.map((entry) => path.resolve(workspaceRoot, entry)),
    ...changes.modified.map((entry) => path.resolve(workspaceRoot, entry)),
  ]);
  const deletedFiles = uniq(changes.deleted.map((entry) => path.resolve(workspaceRoot, entry)));

  const staleContext = await checkStaleContext(storage, workspaceRoot, changedExisting);
  const brokenImports = await checkBrokenImports(storage, workspaceRoot, deletedFiles);
  const orphanedClaims = await checkOrphanedClaims(storage, workspaceRoot, changedExisting);
  const coverageRegression = await checkCoverageRegression(storage, workspaceRoot, changedExisting);
  const callGraphIntegrity = await checkCallGraphIntegrity(storage, workspaceRoot, changedExisting);
  const wisdomCoverage = await checkWisdomCoverage(storage, workspaceRoot);

  return [staleContext, brokenImports, orphanedClaims, coverageRegression, callGraphIntegrity, wisdomCoverage];
}

async function checkStaleContext(storage: LibrarianStorage, workspaceRoot: string, changedExisting: string[]): Promise<LintCheck> {
  if (changedExisting.length === 0) {
    return {
      name: 'stale_context',
      status: 'pass',
      message: 'No added or modified files in diff.',
    };
  }

  const staleFiles: string[] = [];

  for (const filePath of changedExisting) {
    const indexedFile = await storage.getFileByPath(filePath);
    if (!indexedFile || !indexedFile.lastIndexed) {
      staleFiles.push(filePath);
      continue;
    }

    const stats = await safeStat(filePath);
    if (!stats) continue;

    const indexedAt = new Date(indexedFile.lastIndexed).getTime();
    if (!Number.isFinite(indexedAt) || stats.mtime.getTime() > indexedAt) {
      staleFiles.push(filePath);
    }
  }

  if (staleFiles.length === 0) {
    return {
      name: 'stale_context',
      status: 'pass',
      message: 'Context index is fresh for changed files.',
    };
  }

  return {
    name: 'stale_context',
    status: 'fail',
    message: `${staleFiles.length} changed files are stale or unindexed.`,
    files: staleFiles.map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Run librainian index --force --staged (or --since <ref>) before CI.',
  };
}

async function checkBrokenImports(storage: LibrarianStorage, workspaceRoot: string, deletedFiles: string[]): Promise<LintCheck> {
  if (deletedFiles.length === 0) {
    return {
      name: 'broken_imports',
      status: 'pass',
      message: 'No deleted or renamed files in diff.',
    };
  }

  const impactedImporters = new Set<string>();

  for (const deletedPath of deletedFiles) {
    const deletedFile = await storage.getFileByPath(deletedPath);
    if (!deletedFile) continue;

    const edges = await storage.getGraphEdges({
      toIds: [deletedFile.id],
      edgeTypes: ['imports'],
    });

    for (const edge of edges) {
      if (edge.sourceFile) {
        impactedImporters.add(edge.sourceFile);
      }
    }
  }

  if (impactedImporters.size === 0) {
    return {
      name: 'broken_imports',
      status: 'pass',
      message: 'No import edges point at deleted files.',
    };
  }

  return {
    name: 'broken_imports',
    status: 'fail',
    message: `${deletedFiles.length} deleted files are still imported by ${impactedImporters.size} files.`,
    files: [...impactedImporters].map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Update import paths for renamed/deleted files, then reindex.',
  };
}

async function checkOrphanedClaims(storage: LibrarianStorage, workspaceRoot: string, changedExisting: string[]): Promise<LintCheck> {
  if (changedExisting.length === 0) {
    return {
      name: 'orphaned_claims',
      status: 'pass',
      message: 'No changed files to evaluate claim freshness.',
    };
  }

  const changedSet = new Set(changedExisting);
  const orphaned = new Set<string>();

  for (const filePath of changedExisting) {
    const module = await storage.getModuleByPath(filePath);
    if (module) {
      const evidence = await storage.getEvidenceForTarget(module.id, 'module');
      if (evidence.some((entry) => changedSet.has(resolveEvidencePath(workspaceRoot, entry.file)))) {
        orphaned.add(filePath);
      }
    }

    const functions = await storage.getFunctionsByPath(filePath);
    for (const fn of functions) {
      const evidence = await storage.getEvidenceForTarget(fn.id, 'function');
      if (evidence.some((entry) => changedSet.has(resolveEvidencePath(workspaceRoot, entry.file)))) {
        orphaned.add(filePath);
      }
    }
  }

  if (orphaned.size === 0) {
    return {
      name: 'orphaned_claims',
      status: 'pass',
      message: 'No claim evidence was invalidated by changed files.',
    };
  }

  return {
    name: 'orphaned_claims',
    status: 'warn',
    message: `${orphaned.size} files have claims whose evidence references changed files.`,
    files: [...orphaned].map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Regenerate evidence via librainian index --force on changed files.',
  };
}

async function checkCoverageRegression(storage: LibrarianStorage, workspaceRoot: string, changedExisting: string[]): Promise<LintCheck> {
  if (changedExisting.length === 0) {
    return {
      name: 'coverage_regression',
      status: 'pass',
      message: 'No changed files to evaluate context-pack coverage.',
    };
  }

  const uncovered: string[] = [];

  for (const filePath of changedExisting) {
    const packs = await storage.getContextPacks({
      relatedFile: filePath,
      includeInvalidated: true,
      limit: 10,
    });
    if (packs.length === 0) {
      uncovered.push(filePath);
    }
  }

  if (uncovered.length === 0) {
    return {
      name: 'coverage_regression',
      status: 'pass',
      message: 'All changed files have context-pack coverage.',
    };
  }

  const covered = changedExisting.length - uncovered.length;
  const coveragePercent = Math.round((covered / changedExisting.length) * 100);

  return {
    name: 'coverage_regression',
    status: 'fail',
    message: `${uncovered.length}/${changedExisting.length} changed files lack context packs (${coveragePercent}% covered).`,
    files: uncovered.map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Run librainian index --force on changed files to restore coverage.',
  };
}

async function checkCallGraphIntegrity(storage: LibrarianStorage, workspaceRoot: string, changedExisting: string[]): Promise<LintCheck> {
  if (changedExisting.length === 0) {
    return {
      name: 'call_graph_integrity',
      status: 'pass',
      message: 'No changed files to evaluate call-graph impact.',
    };
  }

  const changedFunctions: FunctionKnowledge[] = [];
  for (const filePath of changedExisting) {
    const functions = await storage.getFunctionsByPath(filePath);
    changedFunctions.push(...functions);
  }

  if (changedFunctions.length === 0) {
    return {
      name: 'call_graph_integrity',
      status: 'pass',
      message: 'No indexed functions found in changed files.',
    };
  }

  const changedIds = new Set(changedFunctions.map((fn) => fn.id));
  const impactedCallers = new Set<string>();
  const impactedCallees = new Set<string>();

  for (const fn of changedFunctions) {
    const incoming = await storage.getGraphEdges({ toIds: [fn.id], edgeTypes: ['calls'] });
    const outgoing = await storage.getGraphEdges({ fromIds: [fn.id], edgeTypes: ['calls'] });

    collectFunctionImpacts(incoming, 'fromId', changedIds, impactedCallers);
    collectFunctionImpacts(outgoing, 'toId', changedIds, impactedCallees);
  }

  const impactedPaths = new Set<string>();
  for (const functionId of [...impactedCallers, ...impactedCallees]) {
    const fn = await storage.getFunction(functionId);
    if (fn?.filePath) impactedPaths.add(fn.filePath);
  }

  if (impactedCallers.size === 0 && impactedCallees.size === 0) {
    return {
      name: 'call_graph_integrity',
      status: 'pass',
      message: 'No cross-file call graph impacts detected.',
    };
  }

  return {
    name: 'call_graph_integrity',
    status: 'warn',
    message: `${changedFunctions.length} changed functions touch ${impactedCallers.size} callers and ${impactedCallees.size} callees outside the diff.`,
    files: [...impactedPaths].map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Review impacted callers/callees and refresh index before merging.',
  };
}

async function checkWisdomCoverage(storage: LibrarianStorage, workspaceRoot: string): Promise<LintCheck> {
  const records = await storage.getUniversalKnowledgeByKind('function');

  if (records.length < WISDOM_COVERAGE_MIN_FUNCTIONS) {
    return {
      name: 'wisdom_coverage',
      status: 'pass',
      message: `Wisdom coverage check skipped (<${WISDOM_COVERAGE_MIN_FUNCTIONS} indexed functions).`,
    };
  }

  let enrichedCount = 0;
  const missingWisdomFiles: string[] = [];
  let parseErrors = 0;

  for (const record of records) {
    const wisdomStatus = hasWisdomKnowledge(record.knowledge);
    if (wisdomStatus === 'present') {
      enrichedCount += 1;
      continue;
    }
    if (wisdomStatus === 'parse_error') {
      parseErrors += 1;
    }
    if (missingWisdomFiles.length < 10) {
      missingWisdomFiles.push(record.file);
    }
  }

  const coverage = enrichedCount / records.length;
  const coveragePercent = Math.round(coverage * 100);
  const requiredPercent = Math.round(WISDOM_COVERAGE_THRESHOLD * 100);
  const parseSuffix = parseErrors > 0 ? ` (${parseErrors} parse errors)` : '';

  if (coverage >= WISDOM_COVERAGE_THRESHOLD) {
    return {
      name: 'wisdom_coverage',
      status: 'pass',
      message: `Wisdom coverage ${coveragePercent}% (${enrichedCount}/${records.length})${parseSuffix}.`,
    };
  }

  return {
    name: 'wisdom_coverage',
    status: 'fail',
    message: `Wisdom coverage ${coveragePercent}% (${enrichedCount}/${records.length}) is below required ${requiredPercent}%${parseSuffix}.`,
    files: missingWisdomFiles.map((filePath) => normalizeDisplayPath(workspaceRoot, filePath)),
    fix: 'Regenerate understanding with LLM semantic extraction and verify ownership.knowledge.gotchas/tips are populated.',
  };
}

function collectFunctionImpacts(
  edges: GraphEdge[],
  key: 'fromId' | 'toId',
  changedIds: Set<string>,
  impacted: Set<string>
): void {
  for (const edge of edges) {
    const id = edge[key];
    if (id && !changedIds.has(id)) {
      impacted.add(id);
    }
  }
}

function resolveEvidencePath(workspaceRoot: string, evidencePath: string): string {
  return path.isAbsolute(evidencePath)
    ? path.normalize(evidencePath)
    : path.resolve(workspaceRoot, evidencePath);
}

function hasWisdomKnowledge(knowledgeJson: string): 'present' | 'missing' | 'parse_error' {
  try {
    const parsed: unknown = JSON.parse(knowledgeJson);
    if (!isRecord(parsed)) return 'missing';
    const ownership = parsed.ownership;
    if (!isRecord(ownership)) return 'missing';
    const knowledge = ownership.knowledge;
    if (!isRecord(knowledge)) return 'missing';

    const gotchas = knowledge.gotchas;
    const tips = knowledge.tips;

    const hasGotchas = Array.isArray(gotchas) && gotchas.length > 0;
    const hasTips = Array.isArray(tips) && tips.length > 0;
    return hasGotchas || hasTips ? 'present' : 'missing';
  } catch {
    return 'parse_error';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDisplayPath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

async function safeStat(filePath: string): Promise<{ mtime: Date } | null> {
  try {
    const stats = await fs.stat(filePath);
    return { mtime: stats.mtime };
  } catch {
    return null;
  }
}
