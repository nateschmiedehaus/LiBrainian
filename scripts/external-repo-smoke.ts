import { parseArgs } from 'node:util';
import path from 'node:path';
import { runExternalRepoSmoke } from '../src/evaluation/external_repo_smoke.js';

const args = parseArgs({
  options: {
    reposRoot: { type: 'string' },
    maxRepos: { type: 'string' },
    repoNames: { type: 'string' },
    artifactRoot: { type: 'string' },
    runLabel: { type: 'string' },
    repoTimeoutMs: { type: 'string' },
  },
});

const reposRoot = args.values.reposRoot ?? path.join(process.cwd(), 'eval-corpus', 'external-repos');
const maxRepos = args.values.maxRepos ? Number(args.values.maxRepos) : undefined;
const repoTimeoutMs = args.values.repoTimeoutMs ? Number(args.values.repoTimeoutMs) : undefined;
const repoNames = args.values.repoNames
  ? args.values.repoNames.split(',').map((value) => value.trim()).filter(Boolean)
  : undefined;
const artifactRoot = args.values.artifactRoot?.trim() || undefined;
const runLabel = args.values.runLabel?.trim() || undefined;

const report = await runExternalRepoSmoke({
  reposRoot,
  maxRepos,
  repoNames,
  artifactRoot,
  runLabel,
  repoTimeoutMs,
});
const failures = report.results.filter((result) => result.errors.length > 0 || (!result.overviewOk && !result.contextOk));

console.log(JSON.stringify({
  summary: {
    total: report.results.length,
    failures: failures.length,
  },
  artifacts: report.artifacts ?? null,
  results: report.results,
}, null, 2));

process.exit(failures.length > 0 ? 1 : 0);
