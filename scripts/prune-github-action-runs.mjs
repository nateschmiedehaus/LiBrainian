import { execFileSync } from 'node:child_process';

/**
 * @typedef {{
 *   databaseId: number;
 *   workflowName: string;
 *   conclusion?: string;
 *   headSha?: string;
 *   status?: string;
 * }} WorkflowRunSummary
 */

/**
 * Delete completed runs for explicitly retired workflows, plus stale
 * failed/cancelled runs from the active public workflow set once a newer SHA is green.
 *
 * @param {WorkflowRunSummary[]} runs
 * @param {{ keepWorkflows: Set<string>; pruneWorkflows: Set<string>; currentSha?: string | undefined }} options
 * @returns {number[]}
 */
export function selectRunIdsForDeletion(runs, options) {
  const deletions = [];
  for (const run of runs) {
    if (run.status !== 'completed') continue;

    if (options.pruneWorkflows.has(run.workflowName)) {
      deletions.push(run.databaseId);
      continue;
    }

    if (!options.keepWorkflows.has(run.workflowName)) continue;

    const conclusion = typeof run.conclusion === 'string' ? run.conclusion : '';
    if ((conclusion === 'failure' || conclusion === 'cancelled') && run.headSha !== options.currentSha) {
      deletions.push(run.databaseId);
    }
  }
  return deletions;
}

function parseArgs(argv) {
  const keepWorkflows = new Set();
  const pruneWorkflows = new Set();
  let repo = process.env.GITHUB_REPOSITORY ?? '';
  let currentSha = process.env.GITHUB_SHA ?? '';
  let limit = 1000;
  let dryRun = false;
  let showHelp = false;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--repo') {
      repo = argv[idx + 1] ?? repo;
      idx += 1;
    } else if (arg === '--current-sha') {
      currentSha = argv[idx + 1] ?? currentSha;
      idx += 1;
    } else if (arg === '--keep-workflow') {
      const value = argv[idx + 1];
      if (typeof value === 'string' && value.length > 0) keepWorkflows.add(value);
      idx += 1;
    } else if (arg === '--prune-workflow') {
      const value = argv[idx + 1];
      if (typeof value === 'string' && value.length > 0) pruneWorkflows.add(value);
      idx += 1;
    } else if (arg === '--limit') {
      const parsed = Number.parseInt(argv[idx + 1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
      idx += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (keepWorkflows.size === 0) {
    keepWorkflows.add('ci');
    keepWorkflows.add('npm-publish');
  }

  if (pruneWorkflows.size === 0) {
    pruneWorkflows.add('Agent Work Loop');
    pruneWorkflows.add('Agent Verify Loop');
    pruneWorkflows.add('Agent Patrol');
    pruneWorkflows.add('e2e-cadence');
  }

  if (showHelp) {
    return { repo, currentSha, keepWorkflows, pruneWorkflows, limit, dryRun, showHelp };
  }

  if (!repo) {
    throw new Error('missing --repo and GITHUB_REPOSITORY is unset');
  }

  return { repo, currentSha, keepWorkflows, pruneWorkflows, limit, dryRun, showHelp };
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    console.log(`Usage: node scripts/prune-github-action-runs.mjs [options]

Options:
  --repo <owner/name>         GitHub repository (defaults to GITHUB_REPOSITORY)
  --current-sha <sha>         Current release/public SHA (defaults to GITHUB_SHA)
  --keep-workflow <name>      Active public workflow name to preserve
  --prune-workflow <name>     Explicit retired workflow name eligible for deletion
  --limit <n>                 Max runs to inspect (default: 1000)
  --dry-run                   Print candidate deletions without deleting
  --help, -h                  Show this help
`);
    return;
  }
  /** @type {WorkflowRunSummary[]} */
  const runs = ghJson([
    'run',
    'list',
    '-R',
    options.repo,
    '--limit',
    String(options.limit),
    '--json',
    'databaseId,workflowName,conclusion,headSha,status',
  ]);
  const deletions = selectRunIdsForDeletion(runs, options);

  if (deletions.length === 0) {
    console.log(
      JSON.stringify({
        deleted: 0,
        keepWorkflows: [...options.keepWorkflows],
        pruneWorkflows: [...options.pruneWorkflows],
        currentSha: options.currentSha,
      }),
    );
    return;
  }

  for (const runId of deletions) {
    if (options.dryRun) {
      console.log(`would_delete:${runId}`);
      continue;
    }
    execFileSync('gh', ['api', '-X', 'DELETE', `repos/${options.repo}/actions/runs/${runId}`], { stdio: 'ignore' });
    console.log(`deleted:${runId}`);
  }

  console.log(
    JSON.stringify({
      deleted: deletions.length,
      keepWorkflows: [...options.keepWorkflows],
      pruneWorkflows: [...options.pruneWorkflows],
      currentSha: options.currentSha,
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
