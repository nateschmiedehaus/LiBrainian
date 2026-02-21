import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const QUESTION_SPECS = [
  {
    question: 'Where is the MCP server initialized?',
    relevancePatterns: [/src\/mcp\/server\.ts/i, /src\/cli\/commands\/mcp\.ts/i],
  },
  {
    question: 'What functions handle evidence ledger writes?',
    relevancePatterns: [/src\/epistemics\/evidence_ledger\.ts/i, /src\/epistemics\/event_ledger_bridge\.ts/i],
  },
  {
    question: 'What does the Construction execute() method do?',
    relevancePatterns: [/src\/constructions\/base\/construction_base\.ts/i, /src\/constructions\/types\.ts/i],
  },
  {
    question: 'Which files would I need to change to add a new MCP tool?',
    relevancePatterns: [/src\/mcp\/server\.ts/i, /src\/mcp\/schema\.ts/i, /src\/mcp\/types\.ts/i],
  },
  {
    question: 'Where is authentication or access control implemented?',
    relevancePatterns: [/src\/mcp\/authentication\.ts/i, /src\/security\//i],
  },
];
const MIN_SEMANTIC_COVERAGE_PCT = 80;

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: {
      ...process.env,
      LIBRARIAN_SKIP_PROVIDER_CHECK: '1',
      ...(options.env ?? {}),
    },
    shell: false,
  });

  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    fail(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function runCli(workspace, cliArgs, options = {}) {
  return run(
    process.execPath,
    ['scripts/run-with-tmpdir.mjs', '--', 'npx', 'tsx', 'src/cli/index.ts', '--workspace', workspace, ...cliArgs],
    options,
  );
}

function createTempJsonPath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-dogfood-'));
  return path.join(dir, `${prefix}.json`);
}

function assertHealthyStatus(statusReport) {
  if (statusReport.storage?.status !== 'ready') {
    fail(`Status storage is not ready: ${statusReport.storage?.status ?? 'unknown'}`);
  }
  if (statusReport.bootstrap?.required?.mvp) {
    fail(`Status indicates MVP bootstrap required: ${statusReport.bootstrap.reasons?.mvp ?? 'unknown reason'}`);
  }
  const totalFunctions = statusReport.stats?.totalFunctions ?? 0;
  if (totalFunctions <= 0) {
    fail('Status indicates zero indexed functions.');
  }
  const totalEmbeddings = statusReport.stats?.totalEmbeddings ?? 0;
  if (totalEmbeddings <= 0) {
    fail('Status indicates semantic indexing is missing (totalEmbeddings=0).');
  }
  const semanticCoveragePct =
    typeof statusReport.embeddingCoverage?.coveragePct === 'number'
      ? statusReport.embeddingCoverage.coveragePct
      : (totalFunctions > 0 ? (Math.min(totalEmbeddings, totalFunctions) / totalFunctions) * 100 : 100);
  if (semanticCoveragePct < MIN_SEMANTIC_COVERAGE_PCT) {
    fail(
      `Semantic coverage below threshold: ${semanticCoveragePct.toFixed(1)}% < ${MIN_SEMANTIC_COVERAGE_PCT}%`,
    );
  }
}

function assertQueryResult(questionSpec, queryResult) {
  const packs = Array.isArray(queryResult?.packs) ? queryResult.packs : [];
  if (packs.length === 0) {
    fail(`Dogfood query returned no packs: "${questionSpec.question}"`);
  }

  const blob = JSON.stringify(queryResult);
  const isRelevant = questionSpec.relevancePatterns.some((pattern) => pattern.test(blob));
  if (!isRelevant) {
    fail(`Dogfood query was non-empty but not relevant for "${questionSpec.question}".`);
  }
}

function main() {
  const workspace = process.cwd();
  const skipHealthAssert = process.env.DOGFOOD_CI_SKIP_HEALTH_ASSERT === '1';

  console.log('[dogfood-ci] Printing status (CI visibility)');
  runCli(workspace, ['status'], { stdio: 'inherit', allowFailure: true });

  console.log('[dogfood-ci] Validating status health');
  const statusOut = createTempJsonPath('status');
  const statusResult = runCli(workspace, ['status', '--format', 'json', '--out', statusOut], { allowFailure: true });
  if (statusResult.status !== 0 && !fs.existsSync(statusOut)) {
    fail('Status command failed before producing JSON output.');
  }
  const statusReport = JSON.parse(fs.readFileSync(statusOut, 'utf8'));
  if (!skipHealthAssert) {
    assertHealthyStatus(statusReport);
  } else {
    console.log('[dogfood-ci] Skipping status health assertion (DOGFOOD_CI_SKIP_HEALTH_ASSERT=1).');
  }

  console.log('[dogfood-ci] Running explicit index command');
  runCli(workspace, ['index', '--force', 'src/mcp/server.ts'], { stdio: 'inherit' });

  console.log('[dogfood-ci] Running dogfood query suite');
  QUESTION_SPECS.forEach((questionSpec, index) => {
    const queryOut = createTempJsonPath(`query-${index + 1}`);
    runCli(workspace, [
      'query',
      questionSpec.question,
      '--strategy',
      'heuristic',
      '--no-synthesis',
      '--json',
      '--out',
      queryOut,
    ]);
    const result = JSON.parse(fs.readFileSync(queryOut, 'utf8'));
    assertQueryResult(questionSpec, result);
    console.log(`[dogfood-ci] PASS: ${questionSpec.question}`);
  });

  console.log('[dogfood-ci] All dogfood gates passed.');
}

try {
  main();
} catch (error) {
  console.error('[dogfood-ci] FAILED');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
