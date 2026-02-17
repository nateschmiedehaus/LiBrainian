/**
 * @fileoverview External Repos Command
 *
 * Syncs `eval-corpus/external-repos/manifest.json` to disk by cloning/fetching
 * repos and checking out pinned commits. This is a reproducible, evidence-grade
 * corpus input for smoke tests and evaluation harnesses.
 *
 * Usage:
 *   librarian external-repos sync [--repos-root <path>] [--max-repos N] [--json] [--verify]
 */

import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { safeJsonParse } from '../../utils/safe_json.js';
import { runExternalRepoSmoke } from '../../evaluation/external_repo_smoke.js';

export interface ExternalReposCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface ExternalRepoManifest {
  repos: Array<{
    name: string;
    remote?: string;
    source?: string;
    commit?: string;
  }>;
}

interface SyncResult {
  repo: string;
  status: 'ok' | 'cloned' | 'updated' | 'skipped' | 'error';
  message?: string;
  commit?: string;
}

function runGit(cwd: string, args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status === 0) {
    return { ok: true, stdout: String(result.stdout ?? '') };
  }
  const stderr = String(result.stderr ?? '').trim();
  const stdout = String(result.stdout ?? '').trim();
  const detail = stderr || stdout || `git exited with code ${result.status ?? 'unknown'}`;
  return { ok: false, error: detail };
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureSymlink(linkPath: string, targetPath: string): void {
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const existing = fs.readlinkSync(linkPath);
      const resolved = path.resolve(path.dirname(linkPath), existing);
      if (resolved === path.resolve(targetPath)) return;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // Does not exist.
  }
  fs.symlinkSync(targetPath, linkPath);
}

function resolveReposRootFromArgs(rawArgs: string[]): string {
  // Match existing CLI defaults (see smoke.ts).
  const index = rawArgs.indexOf('--repos-root');
  if (index !== -1 && typeof rawArgs[index + 1] === 'string' && rawArgs[index + 1]!.trim().length > 0) {
    return rawArgs[index + 1]!;
  }
  return path.join(process.cwd(), 'eval-corpus', 'external-repos');
}

function parseMaxRepos(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function readManifest(reposRoot: string): ExternalRepoManifest {
  const manifestPath = path.join(reposRoot, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = safeJsonParse<ExternalRepoManifest>(raw);
  if (!parsed.ok || !parsed.value?.repos) {
    throw new Error('unverified_by_trace(test_fixture_missing): external repo manifest missing or invalid');
  }
  return parsed.value;
}

function inferRemote(repo: { remote?: string; source?: string; name: string }): string | null {
  if (repo.remote && repo.remote.trim().length > 0) return repo.remote.trim();
  if (repo.source && repo.source.trim().length > 0) {
    const src = repo.source.trim();
    return src.endsWith('.git') ? src : `${src}.git`;
  }
  return null;
}

async function syncOneRepo(reposRoot: string, repo: ExternalRepoManifest['repos'][number]): Promise<SyncResult> {
  const repoDir = path.join(reposRoot, repo.name);
  const remote = inferRemote(repo);
  if (!remote) {
    return { repo: repo.name, status: 'error', message: 'missing remote/source in manifest' };
  }
  if (!repo.commit || repo.commit.trim().length === 0) {
    return { repo: repo.name, status: 'error', message: 'missing pinned commit in manifest' };
  }
  const pinnedCommit = repo.commit.trim();

  ensureDir(reposRoot);

  const exists = fs.existsSync(repoDir);
  if (!exists) {
    const clone = runGit(reposRoot, ['clone', '--filter=blob:none', '--no-checkout', remote, repoDir]);
    if (!clone.ok) {
      return { repo: repo.name, status: 'error', message: `clone failed: ${clone.error}` };
    }
  }

  // Ensure it is a git repo.
  const gitDir = path.join(repoDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return { repo: repo.name, status: 'error', message: 'target exists but is not a git repo' };
  }

  // Fetch pinned commit (best-effort shallow).
  const fetch = runGit(repoDir, ['fetch', '--depth', '1', 'origin', pinnedCommit]);
  if (!fetch.ok) {
    // Fall back to a normal fetch of that commit.
    const fetch2 = runGit(repoDir, ['fetch', 'origin', pinnedCommit]);
    if (!fetch2.ok) {
      return { repo: repo.name, status: 'error', message: `fetch failed: ${fetch2.error}` };
    }
  }

  const checkout = runGit(repoDir, ['checkout', '--detach', pinnedCommit]);
  if (!checkout.ok) {
    return { repo: repo.name, status: 'error', message: `checkout failed: ${checkout.error}` };
  }

  const head = runGit(repoDir, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return { repo: repo.name, status: 'error', message: `rev-parse failed: ${head.error}` };
  }
  const actual = head.stdout.trim();
  if (actual !== pinnedCommit) {
    return { repo: repo.name, status: 'error', message: `pinned commit mismatch: expected ${pinnedCommit} got ${actual}`, commit: actual };
  }

  // Maintain symlink mirror for older harnesses.
  const symlinkDir = path.join(reposRoot, 'repos');
  ensureDir(symlinkDir);
  ensureSymlink(path.join(symlinkDir, repo.name), repoDir);

  return {
    repo: repo.name,
    status: exists ? 'updated' : 'cloned',
    commit: actual,
  };
}

export async function externalReposCommand(options: ExternalReposCommandOptions): Promise<void> {
  const { args, rawArgs } = options;
  const subcommand = args[0] ?? 'sync';

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'repos-root': { type: 'string' },
      'max-repos': { type: 'string' },
      json: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const json = Boolean(values.json);
  const verify = Boolean(values.verify);
  const reposRootArg = typeof values['repos-root'] === 'string' && values['repos-root']
    ? values['repos-root']
    : resolveReposRootFromArgs(rawArgs);
  // Normalize to an absolute path to avoid git clone writing to nested paths
  // when cwd is also set to a relative repos root.
  const reposRoot = path.resolve(reposRootArg);
  const maxRepos = parseMaxRepos(values['max-repos']);

  if (subcommand !== 'sync') {
    const message = `Unknown external-repos subcommand: ${subcommand}. Use: librarian external-repos sync`;
    if (json) {
      console.log(JSON.stringify({ error: { code: 'EINVALID_ARGUMENT', message } }, null, 2));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  const manifest = readManifest(reposRoot);
  const slice = typeof maxRepos === 'number' ? manifest.repos.slice(0, maxRepos) : manifest.repos;

  const results: SyncResult[] = [];
  for (const repo of slice) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await syncOneRepo(reposRoot, repo);
      results.push(result);
    } catch (error) {
      results.push({ repo: repo.name, status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  let smokeReport: unknown | null = null;
  if (verify) {
    smokeReport = await runExternalRepoSmoke({ reposRoot, maxRepos });
  }

  const errorCount = results.filter((r) => r.status === 'error').length;
  const payload = {
    reposRoot,
    total: results.length,
    errors: errorCount,
    results,
    smoke: smokeReport,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('External Repos Sync');
    console.log('===================\n');
    console.log(`Repos Root: ${reposRoot}`);
    console.log(`Total: ${results.length}`);
    console.log(`Errors: ${errorCount}`);
    if (verify) {
      console.log('Verify: smoke');
    }
    if (errorCount > 0) {
      console.log('\nFailures:');
      for (const result of results) {
        if (result.status === 'error') {
          console.log(`  - ${result.repo}: ${result.message ?? 'unknown error'}`);
        }
      }
    }
    console.log();
  }

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}
