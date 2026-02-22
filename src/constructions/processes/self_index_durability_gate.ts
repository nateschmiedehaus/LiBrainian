import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLibrarian } from '../../api/librarian.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { getCurrentBranch, getCurrentGitSha } from '../../utils/git.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export type SelfIndexDurabilityScenarioKind = 'branch_switch' | 'rebase' | 'history_rewrite';

export interface SelfIndexDurabilityGateInput {
  repoPath?: string;
  scenarios?: SelfIndexDurabilityScenarioKind[];
  outputPath?: string;
  queryIntent?: string;
  maxDurationMs?: number;
}

export interface SelfIndexDurabilityCheck {
  required: boolean;
  reason: string;
}

export interface SelfIndexDurabilityScenarioResult {
  scenario: SelfIndexDurabilityScenarioKind;
  preHeadSha: string | null;
  postMutationHeadSha: string | null;
  preCheck: SelfIndexDurabilityCheck;
  postCheck: SelfIndexDurabilityCheck;
  preQueryPackCount: number | null;
  postQueryPackCount: number;
  remediationCommand: string;
  rebootstrapSucceeded: boolean;
  pass: boolean;
  findings: string[];
  durationMs: number;
}

export interface SelfIndexDurabilityGateOutput {
  kind: 'SelfIndexDurabilityGateResult.v1';
  pass: boolean;
  repoPath: string;
  branch: string | null;
  scenarios: SelfIndexDurabilityScenarioResult[];
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
  outputPath?: string;
}

const DEFAULT_SCENARIOS: SelfIndexDurabilityScenarioKind[] = [
  'branch_switch',
  'rebase',
  'history_rewrite',
];
const DEFAULT_QUERY_INTENT = 'query pipeline architecture';
const DEFAULT_MAX_DURATION_MS = 300_000;

function runGit(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function writeRepoFile(repoPath: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(repoPath, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

async function createDefaultRepoFixture(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-self-index-durability-'));
  try {
    runGit(repoPath, 'init -b main');
  } catch {
    runGit(repoPath, 'init');
  }
  runGit(repoPath, 'config user.email "librainian-local@example.com"');
  runGit(repoPath, 'config user.name "LiBrainian Durability Gate"');

  await writeRepoFile(
    repoPath,
    '.gitignore',
    [
      '.librarian/',
      '',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/constructions/registry.ts',
    [
      'export function listConstructions(): string[] {',
      "  return ['self-index-durability-gate'];",
      '}',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/api/query.ts',
    [
      "import { listConstructions } from '../constructions/registry';",
      'export function runQueryPipeline(intent: string): string {',
      '  return `${intent}:${listConstructions().length}`;',
      '}',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/api/query_interface.ts',
    [
      'export interface QueryRequest { intent: string }',
      'export function normalizeIntent(intent: string): string {',
      '  return intent.trim().toLowerCase();',
      '}',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/bootstrap/start.ts',
    [
      'export function bootstrapWorkspace(): boolean {',
      '  return true;',
      '}',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/mcp/server.ts',
    [
      "import { runQueryPipeline } from '../api/query';",
      'export function handleMcpQuery(intent: string): string {',
      '  return runQueryPipeline(intent);',
      '}',
    ].join('\n'),
  );
  await writeRepoFile(
    repoPath,
    'src/storage/sqlite_storage.ts',
    [
      'export class SqliteStorage {',
      '  getEngine(): string { return "sqlite"; }',
      '}',
    ].join('\n'),
  );
  runGit(repoPath, 'add .');
  runGit(repoPath, 'commit -m "seed fixture"');
  return repoPath;
}

function remediationFromReason(reason: string): string {
  return reason.includes('bootstrap --force') ? 'librarian bootstrap --force' : 'librarian bootstrap';
}

async function countQueryPacks(
  repoPath: string,
  queryIntent: string,
): Promise<number> {
  const librarian = await createLibrarian({
    workspace: repoPath,
    autoBootstrap: true,
    autoWatch: false,
    skipEmbeddings: false,
    bootstrapConfig: {
      forceReindex: true,
    },
  });
  try {
    const response = await librarian.queryOptional({
      intent: queryIntent,
      depth: 'L1',
      llmRequirement: 'disabled',
      deterministic: true,
      timeoutMs: 45_000,
    });
    return response.packs.length;
  } finally {
    await librarian.shutdown();
  }
}

async function readBootstrapCheck(repoPath: string): Promise<SelfIndexDurabilityCheck> {
  const dbPath = path.join(repoPath, '.librarian', 'librarian.sqlite');
  const storage = createSqliteStorage(dbPath, repoPath);
  await storage.initialize();
  try {
    const check = await isBootstrapRequired(repoPath, storage);
    return {
      required: check.required,
      reason: check.reason,
    };
  } finally {
    await storage.close();
  }
}

async function mutateForScenario(
  repoPath: string,
  baseBranch: string,
  scenario: SelfIndexDurabilityScenarioKind,
): Promise<void> {
  const stamp = Date.now().toString(36);
  if (scenario === 'branch_switch') {
    const branch = `durability-branch-switch-${stamp}`;
    const relativePath = `scenarios/${branch}.md`;
    runGit(repoPath, `checkout ${baseBranch}`);
    runGit(repoPath, `checkout -b ${branch}`);
    await writeRepoFile(
      repoPath,
      relativePath,
      `# Branch switch scenario ${stamp}\n`,
    );
    runGit(repoPath, `add ${relativePath}`);
    runGit(repoPath, `commit -m "scenario branch switch ${stamp}"`);
    return;
  }

  if (scenario === 'rebase') {
    const branch = `durability-rebase-${stamp}`;
    const topicRelativePath = `scenarios/${branch}-topic.md`;
    const baseRelativePath = `scenarios/${branch}-base.md`;
    runGit(repoPath, `checkout ${baseBranch}`);
    runGit(repoPath, `checkout -b ${branch}`);
    await writeRepoFile(
      repoPath,
      topicRelativePath,
      `# Rebase topic scenario ${stamp}\n`,
    );
    runGit(repoPath, `add ${topicRelativePath}`);
    runGit(repoPath, `commit -m "scenario rebase topic ${stamp}"`);
    runGit(repoPath, `checkout ${baseBranch}`);
    await writeRepoFile(
      repoPath,
      baseRelativePath,
      `# Rebase base scenario ${stamp}\n`,
    );
    runGit(repoPath, `add ${baseRelativePath}`);
    runGit(repoPath, `commit -m "scenario rebase base ${stamp}"`);
    runGit(repoPath, `checkout ${branch}`);
    runGit(repoPath, `rebase ${baseBranch}`);
    return;
  }

  const tempRelativePath = `scenarios/history-rewrite-temp-${stamp}.md`;
  const finalRelativePath = `scenarios/history-rewrite-final-${stamp}.md`;
  runGit(repoPath, `checkout ${baseBranch}`);
  await writeRepoFile(
    repoPath,
    tempRelativePath,
    `# History rewrite temp scenario ${stamp}\n`,
  );
  runGit(repoPath, `add ${tempRelativePath}`);
  runGit(repoPath, `commit -m "scenario rewrite temp ${stamp}"`);
  runGit(repoPath, 'reset --hard HEAD~1');
  await writeRepoFile(
    repoPath,
    finalRelativePath,
    `# History rewrite final scenario ${stamp}\n`,
  );
  runGit(repoPath, `add ${finalRelativePath}`);
  runGit(repoPath, `commit -m "scenario rewrite final ${stamp}"`);
}

async function evaluateScenario(
  repoPath: string,
  baseBranch: string,
  scenario: SelfIndexDurabilityScenarioKind,
  queryIntent: string,
): Promise<SelfIndexDurabilityScenarioResult> {
  const startedAt = Date.now();
  const findings: string[] = [];
  const preHeadSha = getCurrentGitSha(repoPath);

  await mutateForScenario(repoPath, baseBranch, scenario);

  const postMutationHeadSha = getCurrentGitSha(repoPath);
  const preCheck = await readBootstrapCheck(repoPath);
  const remediationCommand = remediationFromReason(preCheck.reason);
  if (!preCheck.required) {
    findings.push('expected stale-index detection after git history movement');
  }
  if (!preCheck.reason.includes('git HEAD')) {
    findings.push('missing explicit git HEAD drift diagnostics');
  }
  if (!preCheck.reason.includes('Run `librarian bootstrap')) {
    findings.push('missing deterministic remediation command in drift diagnostics');
  }

  let preQueryPackCount: number | null = null;
  if (!preCheck.required) {
    preQueryPackCount = await countQueryPacks(repoPath, queryIntent);
    if (preQueryPackCount <= 0) {
      findings.push('expected queryability when stale detection is absent');
    }
  }

  let rebootstrapSucceeded = true;
  let bootstrapLibrarian: Awaited<ReturnType<typeof createLibrarian>> | null = null;
  try {
    bootstrapLibrarian = await createLibrarian({
      workspace: repoPath,
      autoBootstrap: true,
      autoWatch: false,
      skipEmbeddings: false,
      bootstrapConfig: {
        forceReindex: true,
      },
    });
  } catch (error) {
    rebootstrapSucceeded = false;
    findings.push(
      `rebootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (bootstrapLibrarian) {
      await bootstrapLibrarian.shutdown();
    }
  }

  const postCheck = await readBootstrapCheck(repoPath);
  if (postCheck.required) {
    findings.push(`post-rebootstrap check still requires bootstrap: ${postCheck.reason}`);
  }

  let postQueryPackCount = 0;
  if (rebootstrapSucceeded) {
    try {
      postQueryPackCount = await countQueryPacks(repoPath, queryIntent);
      if (postQueryPackCount <= 0) {
        findings.push('post-rebootstrap query returned no packs');
      }
    } catch (error) {
      findings.push(
        `post-rebootstrap query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    findings.push('post-rebootstrap query skipped because rebootstrap failed');
  }

  return {
    scenario,
    preHeadSha,
    postMutationHeadSha,
    preCheck,
    postCheck,
    preQueryPackCount,
    postQueryPackCount,
    remediationCommand,
    rebootstrapSucceeded,
    pass: findings.length === 0,
    findings,
    durationMs: Date.now() - startedAt,
  };
}

export function createSelfIndexDurabilityGateConstruction(): Construction<
  SelfIndexDurabilityGateInput,
  SelfIndexDurabilityGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'self-index-durability-gate',
    name: 'Self-Index Durability Gate',
    description:
      'Validates fail-closed drift detection and deterministic recovery across branch switch, rebase, and history rewrite scenarios.',
    async execute(input: SelfIndexDurabilityGateInput = {}) {
      const startedAt = Date.now();
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const queryIntent = input.queryIntent ?? DEFAULT_QUERY_INTENT;
      const scenarios = input.scenarios ?? DEFAULT_SCENARIOS;
      const createdFixture = !input.repoPath;
      const repoPath = input.repoPath ?? await createDefaultRepoFixture();
      const findings: string[] = [];
      const scenarioResults: SelfIndexDurabilityScenarioResult[] = [];

      try {
        const baseBranch = getCurrentBranch(repoPath) ?? 'main';
        const initialQueryPackCount = await countQueryPacks(repoPath, queryIntent);
        if (initialQueryPackCount <= 0) {
          findings.push('initial bootstrap/queryability check returned no packs');
        }

        for (const scenario of scenarios) {
          const result = await evaluateScenario(repoPath, baseBranch, scenario, queryIntent);
          scenarioResults.push(result);
          if (!result.pass) {
            findings.push(...result.findings.map((finding) => `${scenario}: ${finding}`));
          }
        }

        const durationMs = Date.now() - startedAt;
        if (durationMs > maxDurationMs) {
          findings.push(`duration exceeded: ${durationMs}ms > ${maxDurationMs}ms`);
        }

        const output: SelfIndexDurabilityGateOutput = {
          kind: 'SelfIndexDurabilityGateResult.v1',
          pass: findings.length === 0,
          repoPath,
          branch: getCurrentBranch(repoPath),
          scenarios: scenarioResults,
          findings,
          durationMs,
          maxDurationMs,
          outputPath: input.outputPath,
        };

        if (input.outputPath) {
          await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
          await fs.writeFile(input.outputPath, JSON.stringify(output, null, 2), 'utf8');
        }

        return ok<SelfIndexDurabilityGateOutput, ConstructionError>(output);
      } finally {
        if (createdFixture) {
          await fs.rm(repoPath, { recursive: true, force: true });
        }
      }
    },
  };
}
