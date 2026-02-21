#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function requireSuccess(command, args, label, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${label ?? `${command} ${args.join(' ')}`} failed${details ? `\n${details}` : ''}`);
  }
  return result.stdout;
}

function parseWorktreeList(raw) {
  const entries = [];
  let current = null;

  for (const line of String(raw ?? '').split('\n')) {
    if (line.trim().length === 0) {
      if (current) entries.push(current);
      current = null;
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = {
        path: line.slice('worktree '.length).trim(),
        head: '',
        branch: '(detached)',
      };
      continue;
    }

    if (!current) continue;
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      const branchRef = line.slice('branch '.length).trim();
      current.branch = branchRef.replace(/^refs\/heads\//, '');
    }
  }

  if (current) entries.push(current);
  return entries;
}

function inferWorktreesRootFromMain(worktrees) {
  const mainRow = worktrees.find((row) => row.branch === 'main');
  if (!mainRow) return '';
  const mainPath = path.resolve(mainRow.path);
  const parent = path.dirname(mainPath);
  const candidate = path.join(parent, `${path.basename(mainPath)}-worktrees`);
  return fs.existsSync(candidate) ? candidate : '';
}

function countDirtyPaths(worktreePath) {
  const status = run('git', ['status', '--porcelain'], { cwd: worktreePath });
  if (status.status !== 0) return Number.NaN;
  if (status.stdout.length === 0) return 0;
  return status.stdout.split('\n').filter((line) => line.trim().length > 0).length;
}

function countBackupDirs(worktreePath) {
  if (!fs.existsSync(worktreePath)) return 0;
  const entries = fs.readdirSync(worktreePath, { withFileTypes: true });
  return entries.filter((entry) => {
    if (!entry.isDirectory()) return false;
    return entry.name.startsWith('.librarian.backup.v0.') || entry.name.startsWith('.librainian.backup.v0.');
  }).length;
}

function printSummary(rows, unmanagedDirs, violations, warnings, mode, worktreesRoot) {
  console.log(`[worktree-hygiene] mode=${mode}`);
  if (worktreesRoot) {
    console.log(`[worktree-hygiene] worktrees_root=${worktreesRoot}`);
  }
  console.log('[worktree-hygiene] registered worktrees:');
  for (const row of rows) {
    console.log(`  - ${row.path} | branch=${row.branch} | dirty=${row.dirty} | backups=${row.backups}`);
  }

  if (unmanagedDirs.length > 0) {
    console.log('[worktree-hygiene] unmanaged issue-* directories:');
    for (const dir of unmanagedDirs) {
      console.log(`  - ${dir}`);
    }
  }

  for (const warning of warnings) {
    console.warn(`[worktree-hygiene] warning: ${warning}`);
  }
  for (const violation of violations) {
    console.error(`[worktree-hygiene] violation: ${violation}`);
  }
  console.log(`[worktree-hygiene] warnings=${warnings.length} violations=${violations.length}`);
}

function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'warn' },
      'worktrees-root': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const mode = String(values.mode ?? 'warn').trim().toLowerCase();
  if (mode !== 'warn' && mode !== 'enforce') {
    throw new Error(`Unsupported mode "${mode}". Use warn|enforce.`);
  }

  const repoRoot = requireSuccess('git', ['rev-parse', '--show-toplevel'], 'resolve git root');
  const worktrees = parseWorktreeList(
    requireSuccess('git', ['worktree', 'list', '--porcelain'], 'list git worktrees')
  );
  const inferredWorktreesRoot = inferWorktreesRootFromMain(worktrees);
  const worktreesRoot = typeof values['worktrees-root'] === 'string' && values['worktrees-root'].trim().length > 0
    ? path.resolve(values['worktrees-root'])
    : inferredWorktreesRoot;

  const rows = worktrees.map((entry) => ({
    ...entry,
    dirty: countDirtyPaths(entry.path),
    backups: countBackupDirs(entry.path),
  }));

  const violations = [];
  const warnings = [];

  const mainRow = rows.find((row) => row.path === repoRoot || row.branch === 'main');
  if (mainRow && Number.isFinite(mainRow.dirty) && mainRow.dirty > 0) {
    violations.push(`main worktree is dirty (${mainRow.dirty} path(s) changed). Quarantine/stash before proceeding.`);
  }

  const dirtyNonMain = rows.filter((row) => row.branch !== 'main' && Number.isFinite(row.dirty) && row.dirty > 0);
  if (dirtyNonMain.length > 1) {
    violations.push(
      `multiple active dirty issue worktrees detected (${dirtyNonMain.length}). Keep exactly one active WIP branch/worktree.`
    );
  }

  const backupTotal = rows.reduce((sum, row) => sum + (Number.isFinite(row.backups) ? row.backups : 0), 0);
  if (backupTotal > 0) {
    violations.push(`generated backup directories detected (${backupTotal}). Remove .librarian/.librainian backup folders.`);
  }

  const registered = new Set(rows.map((row) => path.resolve(row.path)));
  const unmanagedDirs = [];
  if (worktreesRoot.length > 0 && fs.existsSync(worktreesRoot)) {
    const entries = fs.readdirSync(worktreesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('issue-')) continue;
      const resolved = path.resolve(worktreesRoot, entry.name);
      if (!registered.has(resolved)) unmanagedDirs.push(resolved);
    }
  } else {
    warnings.push('worktrees root not found; unmanaged issue-* directory checks skipped.');
  }

  if (unmanagedDirs.length > 0) {
    violations.push(`unmanaged issue-* directories detected (${unmanagedDirs.length}). Remove or register these folders.`);
  }

  if (dirtyNonMain.length === 1) {
    warnings.push(`active issue worktree: ${dirtyNonMain[0].branch} (${dirtyNonMain[0].path})`);
  } else if (dirtyNonMain.length === 0) {
    warnings.push('no active dirty issue worktree detected.');
  }

  printSummary(rows, unmanagedDirs, violations, warnings, mode, worktreesRoot || null);
  if (mode === 'enforce' && violations.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`[worktree-hygiene] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
