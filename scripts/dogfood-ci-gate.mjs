import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ARTIFACT_KIND = 'CleanCloneSelfHostingArtifact.v1';
const MIN_SEMANTIC_COVERAGE_PCT = 80;
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
    question: 'In src/constructions/base/construction_base.ts, what does execute() do?',
    relevancePatterns: [/src\/constructions\/base\/construction_base\.ts/i, /src\/constructions\/types\.ts/i],
  },
  {
    question: 'To add a new MCP tool, should I edit src/mcp/server.ts, src/mcp/schema.ts, or src/mcp/types.ts?',
    relevancePatterns: [/src\/mcp\/server\.ts/i, /src\/mcp\/schema\.ts/i, /src\/mcp\/types\.ts/i],
  },
  {
    question: 'Where is authentication implemented (src/mcp/authentication.ts and src/security)?',
    relevancePatterns: [/src\/mcp\/authentication\.ts/i, /src\/security\//i],
  },
];

function fail(message) {
  throw new Error(message);
}

function toSingleLine(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function extractLockSignals(text) {
  const normalized = String(text ?? '').toLowerCase();
  const signals = [];
  if (normalized.includes('lease_conflict')) signals.push('lease_conflict');
  if (normalized.includes('bootstrap lock')) signals.push('bootstrap_lock');
  if (normalized.includes('lock unavailable')) signals.push('lock_unavailable');
  if (normalized.includes('storage_locked')) signals.push('storage_locked');
  return [...new Set(signals)];
}

function parseArgs(argv) {
  let artifact = 'state/dogfood/clean-clone-self-hosting.json';
  let sourceWorkspace = process.cwd();
  let keepSandbox = false;
  let embeddingProvider =
    process.env.LIBRAINIAN_EMBEDDING_PROVIDER ??
    process.env.LIBRARIAN_EMBEDDING_PROVIDER ??
    'xenova';
  let embeddingModel =
    process.env.LIBRAINIAN_EMBEDDING_MODEL ??
    process.env.LIBRARIAN_EMBEDDING_MODEL ??
    'all-MiniLM-L6-v2';
  let allowProviderless = false;
  let commandTimeoutMs = Number(process.env.DOGFOOD_CI_COMMAND_TIMEOUT_MS ?? 600_000);
  let bootstrapTimeoutMs = Number(process.env.DOGFOOD_CI_BOOTSTRAP_TIMEOUT_MS ?? 1_200_000);
  let bootstrapStallTimeoutMs = Number(process.env.DOGFOOD_CI_BOOTSTRAP_STALL_TIMEOUT_MS ?? 300_000);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact') {
      const next = argv[index + 1];
      if (!next) fail('--artifact requires a value');
      artifact = next;
      index += 1;
      continue;
    }
    if (arg === '--source-workspace') {
      const next = argv[index + 1];
      if (!next) fail('--source-workspace requires a value');
      sourceWorkspace = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--keep-sandbox') {
      keepSandbox = true;
      continue;
    }
    if (arg === '--embedding-provider') {
      const next = argv[index + 1];
      if (!next) fail('--embedding-provider requires a value');
      embeddingProvider = next;
      index += 1;
      continue;
    }
    if (arg === '--embedding-model') {
      const next = argv[index + 1];
      if (!next) fail('--embedding-model requires a value');
      embeddingModel = next;
      index += 1;
      continue;
    }
    if (arg === '--allow-providerless') {
      allowProviderless = true;
      continue;
    }
    if (arg === '--command-timeout-ms') {
      const next = argv[index + 1];
      if (!next) fail('--command-timeout-ms requires a value');
      commandTimeoutMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--bootstrap-timeout-ms') {
      const next = argv[index + 1];
      if (!next) fail('--bootstrap-timeout-ms requires a value');
      bootstrapTimeoutMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--bootstrap-stall-timeout-ms') {
      const next = argv[index + 1];
      if (!next) fail('--bootstrap-stall-timeout-ms requires a value');
      bootstrapStallTimeoutMs = Number(next);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
    fail(`Invalid --command-timeout-ms value: ${commandTimeoutMs}`);
  }
  if (!Number.isFinite(bootstrapTimeoutMs) || bootstrapTimeoutMs <= 0) {
    fail(`Invalid --bootstrap-timeout-ms value: ${bootstrapTimeoutMs}`);
  }
  if (!Number.isFinite(bootstrapStallTimeoutMs) || bootstrapStallTimeoutMs <= 0) {
    fail(`Invalid --bootstrap-stall-timeout-ms value: ${bootstrapStallTimeoutMs}`);
  }

  return {
    artifact,
    sourceWorkspace,
    keepSandbox,
    embeddingProvider,
    embeddingModel,
    allowProviderless,
    commandTimeoutMs,
    bootstrapTimeoutMs,
    bootstrapStallTimeoutMs,
  };
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    shell: false,
    timeout: options.timeoutMs,
  });

  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    fail(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }
  if (result.error?.name === 'Error' && result.error?.message?.includes('ETIMEDOUT')) {
    const timeoutMs = options.timeoutMs ?? 0;
    fail(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    durationMs: Date.now() - startedAt,
    command,
    args: [...args],
    cwd: options.cwd ?? process.cwd(),
  };
}

function terminateProcessGroup(child, signal) {
  const pid = child.pid;
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // Best-effort termination only.
  }
}

async function runStreaming(command, args, options = {}) {
  const startedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let stalled = false;
  let terminated = false;
  let spawnError = null;
  let lastActivityAt = Date.now();
  const timeoutMs = options.timeoutMs;
  const stallTimeoutMs = options.stallTimeoutMs;

  const onStdout = (chunk) => {
    const text = String(chunk);
    stdout += text;
    lastActivityAt = Date.now();
    if (options.stdio === 'inherit') process.stdout.write(text);
  };
  const onStderr = (chunk) => {
    const text = String(chunk);
    stderr += text;
    lastActivityAt = Date.now();
    if (options.stdio === 'inherit') process.stderr.write(text);
  };

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);

  const terminateChild = (reason) => {
    if (terminated) return;
    terminated = true;
    if (reason === 'timeout') timedOut = true;
    if (reason === 'stall') stalled = true;
    terminateProcessGroup(child, 'SIGTERM');
    setTimeout(() => terminateProcessGroup(child, 'SIGKILL'), 2000);
  };

  const timeoutHandle = timeoutMs && timeoutMs > 0
    ? setTimeout(() => terminateChild('timeout'), timeoutMs)
    : null;
  const stallHandle = stallTimeoutMs && stallTimeoutMs > 0
    ? setInterval(() => {
      if (Date.now() - lastActivityAt > stallTimeoutMs) {
        terminateChild('stall');
      }
    }, 1000)
    : null;

  const status = await new Promise((resolve) => {
    child.on('error', (error) => {
      spawnError = error;
      terminateChild('spawn_error');
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (stallHandle) clearInterval(stallHandle);

  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  const result = {
    status,
    stdout: trimmedStdout,
    stderr: trimmedStderr,
    durationMs: Date.now() - startedAt,
    command,
    args: [...args],
    cwd,
    timedOut,
    stalled,
    stallTimeoutMs: stallTimeoutMs ?? null,
    spawnError: spawnError instanceof Error ? spawnError.message : null,
  };

  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr, result.spawnError ?? ''].filter(Boolean).join('\n');
    const mode = result.stalled
      ? ` (stall_detected after ${result.stallTimeoutMs}ms without output)`
      : (result.timedOut ? ` (timed_out after ${timeoutMs}ms)` : '');
    fail(`${command} ${args.join(' ')} failed${mode}${output ? `\n${output}` : ''}`);
  }

  return result;
}

function runCli(cliWorkspace, targetWorkspace, cliArgs, options = {}) {
  return run(
    process.execPath,
    [
      'scripts/run-with-tmpdir.mjs',
      '--',
      'npx',
      'tsx',
      'src/cli/index.ts',
      '--workspace',
      targetWorkspace,
      ...cliArgs,
    ],
    { ...options, cwd: cliWorkspace },
  );
}

async function runCliStreaming(cliWorkspace, targetWorkspace, cliArgs, options = {}) {
  return runStreaming(
    process.execPath,
    [
      'scripts/run-with-tmpdir.mjs',
      '--',
      'npx',
      'tsx',
      'src/cli/index.ts',
      '--workspace',
      targetWorkspace,
      ...cliArgs,
    ],
    { ...options, cwd: cliWorkspace },
  );
}

function createTempJsonPath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-dogfood-'));
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
  const textBlob =
    typeof queryResult === 'string'
      ? queryResult
      : JSON.stringify(queryResult);
  if (packs.length === 0 && !/Packs Found\s*:\s*[1-9]/iu.test(textBlob)) {
    fail(`Dogfood query returned no packs: "${questionSpec.question}"`);
  }

  const blob = textBlob;
  const isRelevant = questionSpec.relevancePatterns.some((pattern) => pattern.test(blob));
  if (!isRelevant) {
    fail(`Dogfood query was non-empty but not relevant for "${questionSpec.question}".`);
  }
}

function commandRecord(name, result, pass, extra = {}) {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const lockSignals = extractLockSignals(combinedOutput);
  return {
    name,
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    pass,
    status: result.status,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    lockSignals,
    timedOut: Boolean(result.timedOut),
    stalled: Boolean(result.stalled),
    stallTimeoutMs: result.stallTimeoutMs ?? null,
    ...extra,
  };
}

function writeArtifact(artifactPath, artifact) {
  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(artifact.sourceWorkspace, artifactPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(artifact, null, 2), 'utf8');
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (parsed.kind !== ARTIFACT_KIND) {
    fail(`Artifact parse check failed: expected kind=${ARTIFACT_KIND}`);
  }
  if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    fail('Artifact parse check failed: commands[] missing');
  }
  if (!Array.isArray(parsed.queryChecks)) {
    fail('Artifact parse check failed: queryChecks[] missing');
  }
  if (parsed.pass === true && parsed.queryChecks.length === 0) {
    fail('Artifact parse check failed: successful run must include queryChecks[] entries');
  }
  return absolutePath;
}

async function main() {
  const {
    artifact: artifactPath,
    sourceWorkspace,
    keepSandbox,
    embeddingProvider,
    embeddingModel,
    allowProviderless,
    commandTimeoutMs,
    bootstrapTimeoutMs,
    bootstrapStallTimeoutMs,
  } = parseArgs(process.argv.slice(2));
  const skipHealthAssert = process.env.DOGFOOD_CI_SKIP_HEALTH_ASSERT === '1';
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-clean-clone-'));
  const cleanCloneWorkspace = path.join(sandboxRoot, 'workspace');
  const cliEnv = {
    LIBRAINIAN_SKIP_PROVIDER_CHECK: '0',
    LIBRAINIAN_EMBEDDING_PROVIDER: embeddingProvider,
    LIBRAINIAN_EMBEDDING_MODEL: embeddingModel,
    LIBRAINIAN_NO_PROGRESS: '1',
    LIBRAINIAN_NO_INTERACTIVE: '1',
    LIBRAINIAN_ASSUME_YES: '1',
  };
  const commands = [];
  const queryChecks = [];

  const artifact = {
    kind: ARTIFACT_KIND,
    generatedAt: new Date().toISOString(),
    sourceWorkspace,
    cleanCloneWorkspace,
    provider: {
      embeddingProvider,
      embeddingModel,
      allowProviderless,
    },
    timeouts: {
      commandTimeoutMs,
      bootstrapTimeoutMs,
      bootstrapStallTimeoutMs,
    },
    pass: false,
    checks: {
      cleanCloneCreated: false,
      bootstrapSucceeded: false,
      updateSucceeded: false,
      statusSucceeded: false,
      noRuntimeImportCrash: false,
      noZeroIndex: false,
      relevantQueryResults: false,
    },
    status: null,
    queryChecks,
    commands,
    lockSignals: [],
    error: null,
  };

  try {
    console.log('[dogfood-ci] Creating clean clone workspace');
    const cloneResult = run(
      'git',
      ['clone', '--depth', '1', '--no-local', sourceWorkspace, cleanCloneWorkspace],
      { allowFailure: true, timeoutMs: commandTimeoutMs },
    );
    commands.push(commandRecord('git.clone', cloneResult, cloneResult.status === 0));
    if (cloneResult.status !== 0) {
      fail(`Unable to create clean clone workspace: ${toSingleLine(cloneResult.stderr || cloneResult.stdout)}`);
    }
    artifact.checks.cleanCloneCreated = true;

    console.log('[dogfood-ci] Running bootstrap in clean clone');
    const bootstrapResult = await runCliStreaming(sourceWorkspace, cleanCloneWorkspace, [
      'bootstrap',
      '--scope',
      'librainian',
      '--mode',
      'fast',
      '--no-claude-md',
      '--force-resume',
    ], {
      allowFailure: true,
      env: cliEnv,
      timeoutMs: bootstrapTimeoutMs,
      stallTimeoutMs: bootstrapStallTimeoutMs,
      stdio: 'inherit',
    });
    commands.push(commandRecord('librainian.bootstrap', bootstrapResult, bootstrapResult.status === 0));
    if (bootstrapResult.status !== 0) {
      if (bootstrapResult.stalled) {
        fail(`Bootstrap stalled: no output for ${bootstrapStallTimeoutMs}ms`);
      }
      fail(`Bootstrap failed: ${toSingleLine(bootstrapResult.stderr || bootstrapResult.stdout)}`);
    }
    artifact.checks.bootstrapSucceeded = true;

    console.log('[dogfood-ci] Running update in clean clone');
    const updateResult = runCli(sourceWorkspace, cleanCloneWorkspace, ['update'], {
      allowFailure: true,
      env: cliEnv,
      timeoutMs: commandTimeoutMs,
      stdio: 'inherit',
    });
    const updateOutput = `${updateResult.stdout}\n${updateResult.stderr}`;
    const updateNoChanges = /No modified files found to index/iu.test(updateOutput);
    const updatePass = updateResult.status === 0 || updateNoChanges;
    commands.push(commandRecord('librainian.update', updateResult, updatePass, { skippedNoChanges: updateNoChanges }));
    if (!updatePass) {
      fail(`Update failed: ${toSingleLine(updateResult.stderr || updateResult.stdout)}`);
    }
    artifact.checks.updateSucceeded = true;

    console.log('[dogfood-ci] Running status in clean clone');
    const statusOut = createTempJsonPath('status');
    const statusResult = runCli(
      sourceWorkspace,
      cleanCloneWorkspace,
      ['status', '--format', 'json', '--out', statusOut],
      { allowFailure: true, env: cliEnv, timeoutMs: commandTimeoutMs },
    );
    const statusPass = statusResult.status === 0 || fs.existsSync(statusOut);
    commands.push(commandRecord('librainian.status', statusResult, statusPass, { outputFile: statusOut }));
    if (statusResult.status !== 0 && !fs.existsSync(statusOut)) {
      fail('Status command failed before producing JSON output.');
    }
    const statusReport = JSON.parse(fs.readFileSync(statusOut, 'utf8'));
    artifact.status = {
      storage: statusReport.storage?.status ?? null,
      bootstrapRequired: Boolean(statusReport.bootstrap?.required?.mvp),
      totalFunctions: Number(statusReport.stats?.totalFunctions ?? 0),
      totalEmbeddings: Number(statusReport.stats?.totalEmbeddings ?? 0),
      embeddingCoveragePct:
        typeof statusReport.embeddingCoverage?.coveragePct === 'number'
          ? statusReport.embeddingCoverage.coveragePct
          : null,
    };
    artifact.checks.statusSucceeded = statusPass;
    if (!skipHealthAssert) {
      assertHealthyStatus(statusReport);
    } else {
      console.log('[dogfood-ci] Skipping status health assertion (DOGFOOD_CI_SKIP_HEALTH_ASSERT=1).');
    }
    artifact.checks.noZeroIndex = artifact.status.totalFunctions > 0 && artifact.status.totalEmbeddings > 0;
    if (!allowProviderless && artifact.status.totalEmbeddings <= 0) {
      fail('Providerless or embedding-free run detected in required wet mode (totalEmbeddings<=0).');
    }

    console.log('[dogfood-ci] Running dogfood query suite in clean clone');
    QUESTION_SPECS.forEach((questionSpec, index) => {
      const queryResult = runCli(sourceWorkspace, cleanCloneWorkspace, [
        'query',
        questionSpec.question,
      ], { allowFailure: true, env: cliEnv, timeoutMs: commandTimeoutMs });
      commands.push(commandRecord(`librainian.query.${index + 1}`, queryResult, queryResult.status === 0));
      if (queryResult.status !== 0) {
        fail(`Query failed for "${questionSpec.question}": ${toSingleLine(queryResult.stderr || queryResult.stdout)}`);
      }
      const resultPayload = `${queryResult.stdout}\n${queryResult.stderr}`;
      assertQueryResult(questionSpec, resultPayload);
      const packCount = Number((resultPayload.match(/Packs Found\s*:\s*(\d+)/iu)?.[1] ?? '0'));
      queryChecks.push({
        question: questionSpec.question,
        packCount,
        relevant: true,
        pass: true,
      });
      console.log(`[dogfood-ci] PASS: ${questionSpec.question}`);
    });

    artifact.checks.relevantQueryResults = queryChecks.every((check) => check.pass);
    artifact.checks.noRuntimeImportCrash = commands.every((command) => command.pass === true);
    artifact.lockSignals = commands
      .filter((command) => Array.isArray(command.lockSignals) && command.lockSignals.length > 0)
      .map((command) => ({ name: command.name, lockSignals: command.lockSignals }));
    artifact.pass = Object.values(artifact.checks).every(Boolean);
  } catch (error) {
    artifact.lockSignals = commands
      .filter((command) => Array.isArray(command.lockSignals) && command.lockSignals.length > 0)
      .map((command) => ({ name: command.name, lockSignals: command.lockSignals }));
    artifact.pass = false;
    artifact.error = toSingleLine(error instanceof Error ? error.message : String(error));
  } finally {
    const artifactAbsolutePath = writeArtifact(artifactPath, artifact);
    console.log(`[dogfood-ci] artifact: ${artifactAbsolutePath}`);
    if (!keepSandbox) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    } else {
      console.log(`[dogfood-ci] kept sandbox: ${sandboxRoot}`);
    }
  }

  if (!artifact.pass) {
    fail(`[dogfood-ci] FAILED ${artifact.error ? `- ${artifact.error}` : ''}`.trim());
  }

  console.log('[dogfood-ci] All clean-clone self-hosting gates passed.');
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error('[dogfood-ci] FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { parseArgs, runStreaming };
