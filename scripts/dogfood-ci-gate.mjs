import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ARTIFACT_KIND = 'CleanCloneSelfHostingArtifact.v1';
const MIN_SEMANTIC_COVERAGE_PCT = 80;
const DURABILITY_RELATION_EXPECTATIONS = [
  {
    scenario: 'branch_switch',
    relation: 'indexed_ancestor',
    reasonPattern: /new commits detected on current lineage/iu,
    remediationPattern: /Run `librarian bootstrap`/u,
  },
  {
    scenario: 'history_rewrite',
    relation: 'head_ancestor',
    reasonPattern: /branch\/reset moved HEAD behind indexed commit/iu,
    remediationPattern: /bootstrap --force/iu,
  },
  {
    scenario: 'rebase_divergence',
    relation: 'diverged',
    reasonPattern: /history diverged \(rebase\/rewrite\/switch\)/iu,
    remediationPattern: /bootstrap --force/iu,
  },
];
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function extractBootstrapDriftRelation(reason) {
  const normalized = String(reason ?? '');
  if (/new commits detected on current lineage/iu.test(normalized)) {
    return 'indexed_ancestor';
  }
  if (/branch\/reset moved HEAD behind indexed commit/iu.test(normalized)) {
    return 'head_ancestor';
  }
  if (/history diverged \(rebase\/rewrite\/switch\)/iu.test(normalized)) {
    return 'diverged';
  }
  return 'unknown';
}

function parseElapsedSeconds(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^\d+$/u.test(text)) return Number(text);
  let days = 0;
  let rest = text;
  if (text.includes('-')) {
    const [dayPart, timePart] = text.split('-', 2);
    days = Number(dayPart);
    rest = timePart ?? '';
  }
  const pieces = rest.split(':').map((part) => Number(part));
  if (pieces.some((piece) => Number.isNaN(piece))) return 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (pieces.length === 3) {
    [hours, minutes, seconds] = pieces;
  } else if (pieces.length === 2) {
    [minutes, seconds] = pieces;
  } else if (pieces.length === 1) {
    [seconds] = pieces;
  }
  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}

function parsePsTable() {
  if (process.platform === 'win32') {
    return [];
  }
  const attempts = [
    ['-axo', 'pid=,ppid=,user=,etimes=,time=,command='],
    ['-axo', 'pid=,ppid=,user=,etime=,time=,command='],
  ];
  let stdout = '';
  for (const args of attempts) {
    const result = spawnSync('ps', args, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if ((result.status ?? 1) === 0 && result.stdout) {
      stdout = result.stdout;
      break;
    }
  }
  if (!stdout) {
    return [];
  }
  const rows = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([0-9:.-]+)\s+(.*)$/u);
    const fallbackMatch = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+([0-9:.-]+)\s+([0-9:.-]+)\s+(.*)$/u);
    const tokens = match ?? fallbackMatch;
    if (!tokens) continue;
    const [, pidRaw, ppidRaw, user, elapsedRaw, cpuRaw, command] = tokens;
    const elapsedSec = parseElapsedSeconds(elapsedRaw);
    const cpuSec = parseElapsedSeconds(cpuRaw);
    rows.push({
      pid: Number(pidRaw),
      ppid: Number(ppidRaw),
      user,
      elapsedSec,
      cpuSec,
      command: command.trim(),
    });
  }
  return rows;
}

function collectProcessDiagnostics(rootPid) {
  const table = parsePsTable();
  const byPid = new Map(table.map((row) => [row.pid, row]));
  const descendants = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length > 0) {
    const currentPid = queue.shift();
    if (!currentPid || seen.has(currentPid)) continue;
    seen.add(currentPid);
    const row = byPid.get(currentPid);
    if (row) descendants.push(row);
    for (const candidate of table) {
      if (candidate.ppid === currentPid && !seen.has(candidate.pid)) {
        queue.push(candidate.pid);
      }
    }
  }

  const lineage = [];
  let cursor = byPid.get(rootPid);
  while (cursor) {
    lineage.push(cursor);
    if (cursor.ppid <= 1 || lineage.length >= 20) break;
    cursor = byPid.get(cursor.ppid);
  }

  return {
    capturedAt: new Date().toISOString(),
    rootPid,
    lineage,
    descendants,
  };
}

function summarizeCpuActivity(diagnostics) {
  const descendants = Array.isArray(diagnostics?.descendants) ? diagnostics.descendants : [];
  const totalCpuSec = descendants.reduce(
    (sum, processRow) => sum + (Number.isFinite(processRow.cpuSec) ? processRow.cpuSec : 0),
    0,
  );
  return {
    totalCpuSec,
    descendantCount: descendants.length,
  };
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  if (!Number.isFinite(bootstrapStallTimeoutMs) || bootstrapStallTimeoutMs < 0) {
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
  if (!pid || pid <= 0) return { ok: false, error: 'missing_pid' };
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: `signal_failed:${signal}` };
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
  let lastObservedCpuSec = null;
  const timeoutMs = options.timeoutMs;
  const stallTimeoutMs = options.stallTimeoutMs;
  const heartbeatTimeline = [];
  const stageTimeline = [];
  const stageSeen = new Set();
  let terminationReason = null;
  let recoveryAudit = null;

  const pushHeartbeat = (event, details = {}) => {
    if (heartbeatTimeline.length >= 500) return;
    heartbeatTimeline.push({
      event,
      atMs: Date.now() - startedAt,
      ...details,
    });
  };
  const stageMatchers = [
    { stage: 'bootstrap_banner', pattern: /LiBrainian Bootstrap/iu },
    { stage: 'preflight_checks', pattern: /Running pre-flight checks/iu },
    { stage: 'bootstrap_start', pattern: /Starting bootstrap process/iu },
    { stage: 'bootstrap_complete', pattern: /Bootstrap process completed/iu },
  ];
  const parseStages = (text, stream) => {
    for (const rawLine of String(text).split(/\r?\n/gu)) {
      const line = rawLine.trim();
      if (!line) continue;
      for (const matcher of stageMatchers) {
        if (matcher.pattern.test(line) && !stageSeen.has(matcher.stage)) {
          stageSeen.add(matcher.stage);
          stageTimeline.push({
            stage: matcher.stage,
            stream,
            line,
            atMs: Date.now() - startedAt,
          });
        }
      }
    }
  };
  pushHeartbeat('spawned', { pid: child.pid ?? null });
  if (child.pid && child.pid > 0) {
    const baselineDiagnostics = collectProcessDiagnostics(child.pid);
    const baselineCpu = summarizeCpuActivity(baselineDiagnostics);
    lastObservedCpuSec = baselineCpu.totalCpuSec;
    pushHeartbeat('cpu_baseline', {
      totalCpuSec: baselineCpu.totalCpuSec,
      descendants: baselineCpu.descendantCount,
    });
  }

  const onStdout = (chunk) => {
    const text = String(chunk);
    stdout += text;
    lastActivityAt = Date.now();
    pushHeartbeat('stdout_chunk', { bytes: text.length });
    parseStages(text, 'stdout');
    if (options.stdio === 'inherit') process.stdout.write(text);
  };
  const onStderr = (chunk) => {
    const text = String(chunk);
    stderr += text;
    lastActivityAt = Date.now();
    pushHeartbeat('stderr_chunk', { bytes: text.length });
    parseStages(text, 'stderr');
    if (options.stdio === 'inherit') process.stderr.write(text);
  };

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);

  const terminateChild = (reason) => {
    if (terminated) return;
    terminated = true;
    terminationReason = reason;
    if (reason === 'timeout') timedOut = true;
    if (reason === 'stall') stalled = true;
    const pid = child.pid ?? null;
    const preDiagnostics = pid ? collectProcessDiagnostics(pid) : null;
    const targetPids = preDiagnostics
      ? preDiagnostics.descendants.map((entry) => entry.pid)
      : [];
    recoveryAudit = {
      reason,
      policy: 'scoped_process_group_only',
      scopeRootPid: pid,
      stageAtTermination: stageTimeline.length > 0 ? stageTimeline[stageTimeline.length - 1].stage : null,
      preTermination: preDiagnostics,
      targetDescendantPids: targetPids,
      unrelatedTerminationPrevented: true,
      actions: [],
      postTermination: null,
      targetStillAlivePids: [],
    };
    pushHeartbeat('termination_requested', {
      reason,
      pid,
      targetCount: targetPids.length,
    });
    const sigterm = terminateProcessGroup(child, 'SIGTERM');
    recoveryAudit.actions.push({
      signal: 'SIGTERM',
      ok: sigterm.ok,
      error: sigterm.error,
      atMs: Date.now() - startedAt,
    });
    setTimeout(() => {
      const sigkill = terminateProcessGroup(child, 'SIGKILL');
      recoveryAudit.actions.push({
        signal: 'SIGKILL',
        ok: sigkill.ok,
        error: sigkill.error,
        atMs: Date.now() - startedAt,
      });
    }, 2000);
  };

  const timeoutHandle = timeoutMs && timeoutMs > 0
    ? setTimeout(() => terminateChild('timeout'), timeoutMs)
    : null;
  const stallHandle = stallTimeoutMs && stallTimeoutMs > 0
    ? setInterval(() => {
      if (child.pid && child.pid > 0) {
        const cpuDiagnostics = collectProcessDiagnostics(child.pid);
        const cpuSummary = summarizeCpuActivity(cpuDiagnostics);
        if (
          lastObservedCpuSec !== null
          && Number.isFinite(cpuSummary.totalCpuSec)
          && cpuSummary.totalCpuSec > lastObservedCpuSec
        ) {
          const deltaCpuSec = cpuSummary.totalCpuSec - lastObservedCpuSec;
          lastActivityAt = Date.now();
          pushHeartbeat('cpu_progress', {
            deltaCpuSec,
            totalCpuSec: cpuSummary.totalCpuSec,
            descendants: cpuSummary.descendantCount,
          });
        }
        lastObservedCpuSec = cpuSummary.totalCpuSec;
      }
      if (Date.now() - lastActivityAt > stallTimeoutMs) {
        terminateChild('stall');
      }
    }, 1000)
    : null;

  const status = await new Promise((resolve) => {
    child.on('error', (error) => {
      spawnError = error;
      pushHeartbeat('child_error', { message: getErrorMessage(error) });
      terminateChild('spawn_error');
    });
    child.on('close', (code) => {
      pushHeartbeat('close', { code: code ?? 1 });
      resolve(code ?? 1);
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (stallHandle) clearInterval(stallHandle);
  if (recoveryAudit && recoveryAudit.scopeRootPid) {
    recoveryAudit.postTermination = collectProcessDiagnostics(recoveryAudit.scopeRootPid);
    recoveryAudit.targetStillAlivePids = recoveryAudit.targetDescendantPids.filter((pid) => isPidAlive(pid));
  }

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
    terminationReason,
    stallTimeoutMs: stallTimeoutMs ?? null,
    spawnError: spawnError instanceof Error ? spawnError.message : null,
    heartbeatTimeline,
    stageTimeline,
    recoveryAudit,
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

function runGit(cleanCloneWorkspace, args, commands, commandName, timeoutMs) {
  const result = run('git', args, {
    allowFailure: true,
    cwd: cleanCloneWorkspace,
    timeoutMs,
  });
  const pass = result.status === 0;
  commands.push(commandRecord(commandName, result, pass));
  if (!pass) {
    fail(`Git command failed (${commandName}): ${toSingleLine(result.stderr || result.stdout)}`);
  }
  return result;
}

function summarizeStatusReport(statusReport) {
  return {
    storage: statusReport.storage?.status ?? null,
    bootstrapRequired: Boolean(statusReport.bootstrap?.required?.mvp),
    bootstrapReason: statusReport.bootstrap?.reasons?.mvp ?? null,
    totalFunctions: Number(statusReport.stats?.totalFunctions ?? 0),
    totalEmbeddings: Number(statusReport.stats?.totalEmbeddings ?? 0),
    embeddingCoveragePct:
      typeof statusReport.embeddingCoverage?.coveragePct === 'number'
        ? statusReport.embeddingCoverage.coveragePct
        : null,
  };
}

function runStatusJson(sourceWorkspace, cleanCloneWorkspace, cliEnv, commandTimeoutMs, commands, commandName, statusOutPrefix) {
  const statusOut = createTempJsonPath(statusOutPrefix);
  const statusResult = runCli(
    sourceWorkspace,
    cleanCloneWorkspace,
    ['status', '--format', 'json', '--out', statusOut],
    { allowFailure: true, env: cliEnv, timeoutMs: commandTimeoutMs },
  );
  const statusPass = statusResult.status === 0 || fs.existsSync(statusOut);
  commands.push(commandRecord(commandName, statusResult, statusPass, { outputFile: statusOut }));
  if (statusResult.status !== 0 && !fs.existsSync(statusOut)) {
    fail(`Status command failed before producing JSON output (${commandName}).`);
  }
  const statusReport = JSON.parse(fs.readFileSync(statusOut, 'utf8'));
  return {
    outputFile: statusOut,
    commandResult: statusResult,
    pass: statusPass,
    statusReport,
    summary: summarizeStatusReport(statusReport),
  };
}

function runUpdateAndRecord(sourceWorkspace, cleanCloneWorkspace, cliEnv, commandTimeoutMs, commands, commandName) {
  const updateResult = runCli(sourceWorkspace, cleanCloneWorkspace, ['update'], {
    allowFailure: true,
    env: cliEnv,
    timeoutMs: commandTimeoutMs,
  });
  const updateOutput = `${updateResult.stdout ?? ''}\n${updateResult.stderr ?? ''}`;
  const updateNoChanges = isUpdateNoopOutput(updateOutput);
  const updatePass = updateResult.status === 0 || updateNoChanges;
  commands.push(commandRecord(commandName, updateResult, updatePass, { skippedNoChanges: updateNoChanges }));
  if (!updatePass) {
    fail(`Update failed (${commandName}): ${toSingleLine(updateResult.stderr || updateResult.stdout)}`);
  }
  return {
    status: updateResult.status,
    skippedNoChanges: updateNoChanges,
    pass: updatePass,
  };
}

function runQuerySmoke(sourceWorkspace, cleanCloneWorkspace, cliEnv, commandTimeoutMs, commands, commandName, questionSpec) {
  const queryResult = runCli(sourceWorkspace, cleanCloneWorkspace, [
    'query',
    questionSpec.question,
  ], { allowFailure: true, env: cliEnv, timeoutMs: commandTimeoutMs });
  commands.push(commandRecord(commandName, queryResult, queryResult.status === 0));
  if (queryResult.status !== 0) {
    fail(`Query failed (${commandName}) for "${questionSpec.question}": ${toSingleLine(queryResult.stderr || queryResult.stdout)}`);
  }
  const payload = `${queryResult.stdout}\n${queryResult.stderr}`;
  assertQueryResult(questionSpec, payload);
  const packCount = Number((payload.match(/Packs Found\s*:\s*(\d+)/iu)?.[1] ?? '0'));
  return {
    question: questionSpec.question,
    packCount,
    pass: true,
  };
}

function runDurabilityScenarios(sourceWorkspace, cleanCloneWorkspace, cliEnv, commandTimeoutMs, commands) {
  const scenarios = [];
  const questionSpec = QUESTION_SPECS[0];

  runGit(cleanCloneWorkspace, ['config', 'user.email', 'dogfood-ci@librainian.invalid'], commands, 'git.config.email', commandTimeoutMs);
  runGit(cleanCloneWorkspace, ['config', 'user.name', 'LiBrainian Dogfood CI'], commands, 'git.config.name', commandTimeoutMs);
  const baseBranch = runGit(cleanCloneWorkspace, ['branch', '--show-current'], commands, 'git.branch.current', commandTimeoutMs).stdout || 'main';

  {
    const expectation = DURABILITY_RELATION_EXPECTATIONS[0];
    const branchName = 'dogfood-drift-branch-switch';
    const scenario = {
      scenario: expectation.scenario,
      expectedRelation: expectation.relation,
      preStatus: null,
      driftStatus: null,
      recoveredStatus: null,
      driftDetected: false,
      relation: 'unknown',
      remediationApplied: null,
      querySmoke: null,
      pass: false,
    };
    try {
      scenario.preStatus = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.branch_switch.pre',
        'status-branch-switch-pre',
      ).summary;
      runGit(cleanCloneWorkspace, ['checkout', '-b', branchName], commands, 'git.branch_switch.checkout', commandTimeoutMs);
      runGit(
        cleanCloneWorkspace,
        ['commit', '--allow-empty', '-m', 'dogfood: branch switch drift commit'],
        commands,
        'git.branch_switch.commit',
        commandTimeoutMs,
      );
      const drift = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.branch_switch.drift',
        'status-branch-switch-drift',
      );
      scenario.driftStatus = drift.summary;
      scenario.relation = extractBootstrapDriftRelation(drift.summary.bootstrapReason);
      scenario.driftDetected =
        drift.summary.bootstrapRequired
        && expectation.reasonPattern.test(String(drift.summary.bootstrapReason ?? ''))
        && expectation.remediationPattern.test(String(drift.summary.bootstrapReason ?? ''))
        && scenario.relation === expectation.relation;
      scenario.remediationApplied = runUpdateAndRecord(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.update.branch_switch.recover',
      );
      const recovered = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.branch_switch.recovered',
        'status-branch-switch-recovered',
      );
      scenario.recoveredStatus = recovered.summary;
      scenario.querySmoke = runQuerySmoke(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.query.branch_switch.smoke',
        questionSpec,
      );
      scenario.pass = scenario.driftDetected && !recovered.summary.bootstrapRequired && scenario.querySmoke.pass;
      if (!scenario.pass) {
        fail('Durability scenario branch_switch failed deterministic drift/recovery checks.');
      }
    } finally {
      run('git', ['checkout', baseBranch], { allowFailure: true, cwd: cleanCloneWorkspace, timeoutMs: commandTimeoutMs });
      run('git', ['branch', '-D', branchName], { allowFailure: true, cwd: cleanCloneWorkspace, timeoutMs: commandTimeoutMs });
    }
    scenarios.push(scenario);
  }

  {
    const expectation = DURABILITY_RELATION_EXPECTATIONS[1];
    const scenario = {
      scenario: expectation.scenario,
      expectedRelation: expectation.relation,
      preStatus: null,
      driftStatus: null,
      recoveredStatus: null,
      driftDetected: false,
      relation: 'unknown',
      remediationApplied: null,
      querySmoke: null,
      pass: false,
    };
    scenario.preStatus = runStatusJson(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.status.history_rewrite.pre',
      'status-history-rewrite-pre',
    ).summary;
    runGit(
      cleanCloneWorkspace,
      ['commit', '--allow-empty', '-m', 'dogfood: history rewrite temp commit'],
      commands,
      'git.history_rewrite.commit',
      commandTimeoutMs,
    );
    runUpdateAndRecord(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.update.history_rewrite.align',
    );
    runGit(cleanCloneWorkspace, ['reset', '--hard', 'HEAD~1'], commands, 'git.history_rewrite.reset', commandTimeoutMs);
    const drift = runStatusJson(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.status.history_rewrite.drift',
      'status-history-rewrite-drift',
    );
    scenario.driftStatus = drift.summary;
    scenario.relation = extractBootstrapDriftRelation(drift.summary.bootstrapReason);
    scenario.driftDetected =
      drift.summary.bootstrapRequired
      && expectation.reasonPattern.test(String(drift.summary.bootstrapReason ?? ''))
      && expectation.remediationPattern.test(String(drift.summary.bootstrapReason ?? ''))
      && scenario.relation === expectation.relation;
    scenario.remediationApplied = runUpdateAndRecord(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.update.history_rewrite.recover',
    );
    const recovered = runStatusJson(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.status.history_rewrite.recovered',
      'status-history-rewrite-recovered',
    );
    scenario.recoveredStatus = recovered.summary;
    scenario.querySmoke = runQuerySmoke(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.query.history_rewrite.smoke',
      questionSpec,
    );
    scenario.pass = scenario.driftDetected && !recovered.summary.bootstrapRequired && scenario.querySmoke.pass;
    if (!scenario.pass) {
      fail('Durability scenario history_rewrite failed deterministic drift/recovery checks.');
    }
    scenarios.push(scenario);
  }

  {
    const expectation = DURABILITY_RELATION_EXPECTATIONS[2];
    const branchName = 'dogfood-drift-diverged';
    const scenario = {
      scenario: expectation.scenario,
      expectedRelation: expectation.relation,
      preStatus: null,
      driftStatus: null,
      recoveredStatus: null,
      driftDetected: false,
      relation: 'unknown',
      remediationApplied: null,
      querySmoke: null,
      pass: false,
    };
    try {
      scenario.preStatus = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.rebase_divergence.pre',
        'status-rebase-divergence-pre',
      ).summary;
      runGit(
        cleanCloneWorkspace,
        ['commit', '--allow-empty', '-m', 'dogfood: divergence anchor commit'],
        commands,
        'git.rebase_divergence.anchor_commit',
        commandTimeoutMs,
      );
      runUpdateAndRecord(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.update.rebase_divergence.align',
      );
      const anchorSha = runGit(
        cleanCloneWorkspace,
        ['rev-parse', 'HEAD~1'],
        commands,
        'git.rebase_divergence.anchor_sha',
        commandTimeoutMs,
      ).stdout;
      runGit(cleanCloneWorkspace, ['checkout', '-b', branchName, anchorSha], commands, 'git.rebase_divergence.checkout', commandTimeoutMs);
      runGit(
        cleanCloneWorkspace,
        ['commit', '--allow-empty', '-m', 'dogfood: divergence branch commit'],
        commands,
        'git.rebase_divergence.commit',
        commandTimeoutMs,
      );
      const drift = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.rebase_divergence.drift',
        'status-rebase-divergence-drift',
      );
      scenario.driftStatus = drift.summary;
      scenario.relation = extractBootstrapDriftRelation(drift.summary.bootstrapReason);
      scenario.driftDetected =
        drift.summary.bootstrapRequired
        && expectation.reasonPattern.test(String(drift.summary.bootstrapReason ?? ''))
        && expectation.remediationPattern.test(String(drift.summary.bootstrapReason ?? ''))
        && scenario.relation === expectation.relation;
      scenario.remediationApplied = runUpdateAndRecord(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.update.rebase_divergence.recover',
      );
      const recovered = runStatusJson(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.status.rebase_divergence.recovered',
        'status-rebase-divergence-recovered',
      );
      scenario.recoveredStatus = recovered.summary;
      scenario.querySmoke = runQuerySmoke(
        sourceWorkspace,
        cleanCloneWorkspace,
        cliEnv,
        commandTimeoutMs,
        commands,
        'librainian.query.rebase_divergence.smoke',
        questionSpec,
      );
      scenario.pass = scenario.driftDetected && !recovered.summary.bootstrapRequired && scenario.querySmoke.pass;
      if (!scenario.pass) {
        fail('Durability scenario rebase_divergence failed deterministic drift/recovery checks.');
      }
    } finally {
      run('git', ['checkout', baseBranch], { allowFailure: true, cwd: cleanCloneWorkspace, timeoutMs: commandTimeoutMs });
      run('git', ['branch', '-D', branchName], { allowFailure: true, cwd: cleanCloneWorkspace, timeoutMs: commandTimeoutMs });
      run('git', ['reset', '--hard', 'HEAD~1'], { allowFailure: true, cwd: cleanCloneWorkspace, timeoutMs: commandTimeoutMs });
    }
    scenarios.push(scenario);
  }

  return scenarios;
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

function isUpdateNoopOutput(text) {
  const normalized = String(text ?? '');
  return (
    /No modified files found to index/iu.test(normalized)
    || /No files specified\.\s*Usage:\s*librarian index <file\.\.\.>/iu.test(normalized)
  );
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
    terminationReason: result.terminationReason ?? null,
    stallTimeoutMs: result.stallTimeoutMs ?? null,
    heartbeatTimeline: Array.isArray(result.heartbeatTimeline) ? result.heartbeatTimeline : [],
    stageTimeline: Array.isArray(result.stageTimeline) ? result.stageTimeline : [],
    recoveryAudit: result.recoveryAudit ?? null,
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
  if (!Array.isArray(parsed.durabilityScenarios)) {
    fail('Artifact parse check failed: durabilityScenarios[] missing');
  }
  if (parsed.pass === true && parsed.queryChecks.length === 0) {
    fail('Artifact parse check failed: successful run must include queryChecks[] entries');
  }
  if (parsed.pass === true && parsed.durabilityScenarios.length === 0) {
    fail('Artifact parse check failed: successful run must include durabilityScenarios[] entries');
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
      durabilityScenarios: false,
    },
    status: null,
    queryChecks,
    durabilityScenarios: [],
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
        fail(`stall_detected: bootstrap produced no output for ${bootstrapStallTimeoutMs}ms`);
      }
      if (bootstrapResult.timedOut) {
        fail(`bootstrap_timeout: bootstrap exceeded ${bootstrapTimeoutMs}ms before completion`);
      }
      const signal = bootstrapResult.terminationReason ?? 'none';
      const output = toSingleLine(bootstrapResult.stderr || bootstrapResult.stdout);
      fail(`bootstrap_failed: status=${bootstrapResult.status} termination=${signal}${output ? ` output=${output}` : ''}`);
    }
    artifact.checks.bootstrapSucceeded = true;

    console.log('[dogfood-ci] Running update in clean clone');
    runUpdateAndRecord(sourceWorkspace, cleanCloneWorkspace, cliEnv, commandTimeoutMs, commands, 'librainian.update');
    artifact.checks.updateSucceeded = true;

    console.log('[dogfood-ci] Running status in clean clone');
    const statusCheck = runStatusJson(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
      'librainian.status',
      'status',
    );
    const statusReport = statusCheck.statusReport;
    artifact.status = statusCheck.summary;
    artifact.checks.statusSucceeded = statusCheck.pass;
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
    console.log('[dogfood-ci] Running self-index durability scenarios');
    artifact.durabilityScenarios = runDurabilityScenarios(
      sourceWorkspace,
      cleanCloneWorkspace,
      cliEnv,
      commandTimeoutMs,
      commands,
    );
    artifact.checks.durabilityScenarios = artifact.durabilityScenarios.every((scenario) => scenario.pass === true);
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

export { extractBootstrapDriftRelation, isUpdateNoopOutput, parseArgs, runStreaming };
