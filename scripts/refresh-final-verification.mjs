#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

function asNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalize(p) {
  return p.split(path.sep).join('/');
}

async function updatePerformanceGate(gatesPath, summary) {
  const raw = await readFile(gatesPath, 'utf8');
  const gates = JSON.parse(raw);
  const tasks = gates.tasks ?? {};
  const task = tasks['layer7.performanceBenchmark'] ?? {};
  const status = summary.memoryMet && summary.latencyMet
    ? 'pass'
    : summary.memoryMet || summary.latencyMet
      ? 'partial'
      : 'fail';
  const byType = summary.phase21.latencyByQueryType ?? {};

  tasks['layer7.performanceBenchmark'] = {
    ...task,
    status,
    lastRun: summary.generatedAt.slice(0, 10),
    measured: {
      p50LatencyMs: summary.phase21.p50LatencyMs,
      p99LatencyMs: summary.phase21.p99LatencyMs,
      memoryPerKLOC: summary.phase21.memoryPerKLOC,
      targetP50LatencyMs: summary.targetP50LatencyMs,
      targetP99LatencyMs: summary.targetP99LatencyMs,
      latencyByQueryType: byType,
      latencyQueryCounts: summary.phase21.latencyQueryCounts ?? {},
    },
    note: 'Measured real end-to-end query latency with structural and synthesis query-type breakdown.',
  };

  gates.tasks = tasks;
  gates.lastUpdated = summary.generatedAt;
  await writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, 'utf8');
}

async function listCandidateRoots(workspaceRoot, reposRoot) {
  const candidates = [];
  const workspaceSrc = path.join(workspaceRoot, 'src');
  if (existsSync(workspaceSrc)) {
    candidates.push(workspaceSrc);
  }

  if (!existsSync(reposRoot)) {
    return candidates;
  }

  const repoEntries = await readdir(reposRoot, { withFileTypes: true });
  for (const entry of repoEntries) {
    if (!entry.isDirectory()) continue;
    const repoRoot = path.join(reposRoot, entry.name);
    const repoSrc = path.join(repoRoot, 'src');
    if (existsSync(repoSrc)) {
      candidates.push(repoSrc);
    }
  }
  return candidates;
}

function runBenchmark(workspaceRoot, benchmarkScript, sourceRoot, timeoutMs) {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--import', 'tsx', benchmarkScript, sourceRoot],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
      timeout: timeoutMs,
    },
  );

  if (result.error || result.status !== 0) {
    if (result.error?.code === 'ETIMEDOUT') {
      return { metrics: null, reason: `timeout:${timeoutMs}ms` };
    }
    return { metrics: null, reason: 'nonzero_exit' };
  }

  const payload = result.stdout.trim();
  if (!payload) return { metrics: null, reason: 'empty_stdout' };

  try {
    const parsed = JSON.parse(payload);
    if (
      typeof parsed.locCount !== 'number'
      || typeof parsed.heapDeltaMB !== 'number'
      || !Number.isFinite(parsed.locCount)
      || !Number.isFinite(parsed.heapDeltaMB)
      || parsed.locCount <= 0
    ) {
      return { metrics: null, reason: 'invalid_payload' };
    }
    return {
      metrics: {
        locCount: parsed.locCount,
        heapDeltaMB: Math.max(0, parsed.heapDeltaMB),
        heapDeltaPerKLOC: asNumber(parsed.heapDeltaPerKLOC, 0),
        rssDeltaMB: asNumber(parsed.rssDeltaMB, 0),
        rssDeltaPerKLOC: asNumber(parsed.rssDeltaPerKLOC, 0),
      },
      reason: 'ok',
    };
  } catch {
    return { metrics: null, reason: 'invalid_json' };
  }
}

function runLatencyBenchmark(workspaceRoot, benchmarkScript, timeoutMs) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', benchmarkScript, '--workspace', workspaceRoot],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
      timeout: timeoutMs,
    },
  );

  if (result.error || result.status !== 0) {
    if (result.error?.code === 'ETIMEDOUT') {
      return { metrics: null, reason: `timeout:${timeoutMs}ms` };
    }
    return { metrics: null, reason: 'nonzero_exit' };
  }

  const payload = result.stdout.trim();
  if (!payload) return { metrics: null, reason: 'empty_stdout' };

  try {
    const parsed = JSON.parse(payload);
    const overall = parsed?.latency?.overall;
    if (
      !overall
      || !Number.isFinite(overall.p50Ms)
      || !Number.isFinite(overall.p99Ms)
      || overall.p50Ms <= 0
      || overall.p99Ms <= 0
    ) {
      return { metrics: null, reason: 'invalid_latency_payload' };
    }
    return {
      metrics: {
        successfulQueryCount: asNumber(parsed.successfulQueryCount, 0),
        failedQueryCount: asNumber(parsed.failedQueryCount, 0),
        p50LatencyMs: overall.p50Ms,
        p99LatencyMs: overall.p99Ms,
        byQueryType: parsed.latency?.byQueryType ?? {},
      },
      reason: 'ok',
    };
  } catch {
    return { metrics: null, reason: 'invalid_json' };
  }
}

function buildPhase21(samples, latencyMetrics, benchmarkPlan) {
  const totalLoc = samples.reduce((sum, sample) => sum + sample.locCount, 0);
  const totalHeapDeltaMB = samples.reduce((sum, sample) => sum + sample.heapDeltaMB, 0);
  const totalRssDeltaMB = samples.reduce((sum, sample) => sum + sample.rssDeltaMB, 0);
  const memoryPerKLOC = totalLoc > 0 ? totalHeapDeltaMB / (totalLoc / 1000) : 0;
  const rssPerKLOC = totalLoc > 0 ? totalRssDeltaMB / (totalLoc / 1000) : 0;

  return {
    p50LatencyMs: latencyMetrics.p50LatencyMs,
    p99LatencyMs: latencyMetrics.p99LatencyMs,
    memoryMB: totalHeapDeltaMB,
    locCount: totalLoc,
    memoryPerKLOC,
    rssMB: totalRssDeltaMB,
    rssPerKLOC,
    latencyByQueryType: latencyMetrics.byQueryType,
    latencyQueryCounts: {
      successful: latencyMetrics.successfulQueryCount,
      failed: latencyMetrics.failedQueryCount,
    },
    samples,
    benchmarkPlan,
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workspace: { type: 'string' },
      reposRoot: { type: 'string' },
      output: { type: 'string' },
      'benchmark-timeout-ms': { type: 'string' },
      'latency-timeout-ms': { type: 'string' },
      'max-samples': { type: 'string' },
    },
    strict: false,
  });

  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const reposRoot = path.resolve(values.reposRoot ?? path.join(workspaceRoot, 'eval-corpus', 'external-repos'));
  const outputPath = path.resolve(values.output ?? path.join(workspaceRoot, 'eval-results', 'final-verification.json'));
  const gatesPath = path.join(workspaceRoot, 'docs', 'librarian', 'GATES.json');
  const benchmarkTimeoutMs = typeof values['benchmark-timeout-ms'] === 'string' && values['benchmark-timeout-ms'].trim().length > 0
    ? Number.parseInt(values['benchmark-timeout-ms'], 10)
    : 45000;
  if (!Number.isFinite(benchmarkTimeoutMs) || benchmarkTimeoutMs <= 0) {
    throw new Error('benchmark-timeout-ms must be a positive integer');
  }
  const latencyTimeoutMs = typeof values['latency-timeout-ms'] === 'string' && values['latency-timeout-ms'].trim().length > 0
    ? Number.parseInt(values['latency-timeout-ms'], 10)
    : 120000;
  if (!Number.isFinite(latencyTimeoutMs) || latencyTimeoutMs <= 0) {
    throw new Error('latency-timeout-ms must be a positive integer');
  }
  const maxSamples = typeof values['max-samples'] === 'string' && values['max-samples'].trim().length > 0
    ? Number.parseInt(values['max-samples'], 10)
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(maxSamples) || maxSamples <= 0) {
    throw new Error('max-samples must be a positive integer');
  }
  const benchmarkScript = path.join(workspaceRoot, 'scripts', 'benchmark-memory-per-kloc.ts');
  const latencyBenchmarkScript = path.join(workspaceRoot, 'scripts', 'benchmark-query-latency.ts');

  if (!existsSync(benchmarkScript)) {
    throw new Error(`benchmark script not found: ${benchmarkScript}`);
  }
  if (!existsSync(latencyBenchmarkScript)) {
    throw new Error(`latency benchmark script not found: ${latencyBenchmarkScript}`);
  }

  let previous = {};
  if (existsSync(outputPath)) {
    const raw = await readFile(outputPath, 'utf8');
    previous = JSON.parse(raw);
  }

  const candidates = await listCandidateRoots(workspaceRoot, reposRoot);
  if (candidates.length === 0) {
    throw new Error(`no benchmark roots found under ${reposRoot} or workspace src`);
  }
  const selectedCandidates = candidates.slice(0, Math.min(candidates.length, maxSamples));

  const rawSamples = [];
  const skipped = [];
  process.stdout.write(
    `[refresh-final-verification] benchmarking ${selectedCandidates.length} root(s) `
    + `(timeout=${benchmarkTimeoutMs}ms)\n`,
  );

  for (let index = 0; index < selectedCandidates.length; index += 1) {
    const candidate = selectedCandidates[index];
    const label = normalize(path.relative(workspaceRoot, candidate) || '.');
    process.stdout.write(`[refresh-final-verification] [${index + 1}/${selectedCandidates.length}] ${label}\n`);
    const { metrics, reason } = runBenchmark(workspaceRoot, benchmarkScript, candidate, benchmarkTimeoutMs);
    if (!metrics) {
      process.stdout.write(`[refresh-final-verification] skipped ${label} (${reason})\n`);
      skipped.push({
        sourceRoot: label,
        reason,
      });
      continue;
    }
    rawSamples.push({
      sourceRoot: label,
      ...metrics,
    });
  }

  if (rawSamples.length === 0) {
    throw new Error('all memory benchmark runs failed');
  }

  const benchmarkPlan = {
    requestedSamples: selectedCandidates.length,
    selectedCandidates: selectedCandidates.length,
    executedSamples: rawSamples.length,
    skippedSamples: skipped.length,
    skipped,
  };
  process.stdout.write('[refresh-final-verification] benchmarking query latency\n');
  const latencyBenchmark = runLatencyBenchmark(workspaceRoot, latencyBenchmarkScript, latencyTimeoutMs);
  if (!latencyBenchmark.metrics) {
    throw new Error(`latency benchmark failed (${latencyBenchmark.reason})`);
  }

  const phase21 = buildPhase21(rawSamples, latencyBenchmark.metrics, benchmarkPlan);
  const targetP50LatencyMs = asNumber(previous?.targets?.phase21?.p50LatencyMs, 500);
  const targetP99LatencyMs = asNumber(previous?.targets?.phase21?.p99LatencyMs, 2000);
  const targetMemoryPerKLOC = asNumber(previous?.targets?.phase21?.memoryPerKLOC, 50);
  const phase21Pass = phase21.memoryPerKLOC < targetMemoryPerKLOC;
  const phase21LatencyPass = phase21.p50LatencyMs <= targetP50LatencyMs && phase21.p99LatencyMs <= targetP99LatencyMs;

  const next = {
    ...previous,
    generated_at: new Date().toISOString(),
    validation_results: {
      ...(previous?.validation_results ?? {}),
      phase21,
    },
    targets: {
      ...(previous?.targets ?? {}),
      phase21: {
        ...(previous?.targets?.phase21 ?? {}),
        p50LatencyMs: targetP50LatencyMs,
        p99LatencyMs: targetP99LatencyMs,
        memoryPerKLOC: targetMemoryPerKLOC,
      },
    },
    targets_met: {
      ...(previous?.targets_met ?? {}),
      phase21_memory: phase21Pass,
      phase21_latency: phase21LatencyPass,
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await updatePerformanceGate(gatesPath, {
    generatedAt: next.generated_at,
    phase21,
    targetP50LatencyMs,
    targetP99LatencyMs,
    memoryMet: phase21Pass,
    latencyMet: phase21LatencyPass,
  });

  process.stdout.write(
    `[refresh-final-verification] updated ${normalize(path.relative(workspaceRoot, outputPath))}; `
    + `p50=${phase21.p50LatencyMs.toFixed(1)}ms `
    + `p99=${phase21.p99LatencyMs.toFixed(1)}ms `
    + `memoryPerKLOC=${phase21.memoryPerKLOC.toFixed(2)}MB `
    + `(target<${targetMemoryPerKLOC}MB) from ${rawSamples.length} sample(s)\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[refresh-final-verification] failed: ${message}\n`);
  process.exit(1);
});
