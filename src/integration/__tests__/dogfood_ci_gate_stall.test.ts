import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArgs, runStreaming } from '../../../scripts/dogfood-ci-gate.mjs';

describe('dogfood ci gate liveness controls', () => {
  it('parses bootstrap stall timeout flag', () => {
    const parsed = parseArgs(['--bootstrap-stall-timeout-ms', '12345']);
    expect(parsed.bootstrapStallTimeoutMs).toBe(12345);
  });

  it('allows disabling bootstrap stall timeout with zero', () => {
    const parsed = parseArgs(['--bootstrap-stall-timeout-ms', '0']);
    expect(parsed.bootstrapStallTimeoutMs).toBe(0);
  });

  it('parses bootstrap progress stall timeout flag', () => {
    const parsed = parseArgs(['--bootstrap-progress-stall-timeout-ms', '4321']);
    expect(parsed.bootstrapProgressStallTimeoutMs).toBe(4321);
  });

  it('marks silent command as stalled before hard timeout', async () => {
    const result = await runStreaming(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10_000);'],
      {
        allowFailure: true,
        timeoutMs: 5_000,
        stallTimeoutMs: 150,
      },
    );
    expect(result.stalled).toBe(true);
    expect(result.status).not.toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.terminationReason).toBe('stall');
    expect(Array.isArray(result.heartbeatTimeline)).toBe(true);
    expect(result.heartbeatTimeline.length).toBeGreaterThan(0);
    expect(result.recoveryAudit?.policy).toBe('scoped_process_group_only');
    expect(result.recoveryAudit?.unrelatedTerminationPrevented).toBe(true);
  });

  it('does not mark command stalled when output keeps flowing', async () => {
    const script = `
let count = 0;
const timer = setInterval(() => {
  process.stdout.write('tick\\n');
  count += 1;
  if (count >= 3) {
    clearInterval(timer);
    process.exit(0);
  }
}, 50);
`;
    const result = await runStreaming(
      process.execPath,
      ['-e', script],
      {
        allowFailure: true,
        timeoutMs: 5_000,
        stallTimeoutMs: 500,
      },
    );
    expect(result.stalled).toBe(false);
    expect(result.status).toBe(0);
  });

  it('does not mark command stalled when command is silent but CPU-active', async () => {
    const script = `
const end = Date.now() + 2500;
while (Date.now() < end) {
  Math.sqrt(Math.random() * 1000);
}
process.exit(0);
`;
    const result = await runStreaming(
      process.execPath,
      ['-e', script],
      {
        allowFailure: true,
        timeoutMs: 10_000,
        stallTimeoutMs: 300,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stalled).toBe(false);
    expect(result.timedOut).toBe(false);
    const cpuProgressEvents = (result.heartbeatTimeline ?? []).filter(
      (entry) => entry.event === 'cpu_progress',
    );
    expect(cpuProgressEvents.length).toBeGreaterThan(0);
  });

  it('classifies hard timeout when stall watchdog is disabled', async () => {
    const result = await runStreaming(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10_000);'],
      {
        allowFailure: true,
        timeoutMs: 200,
        stallTimeoutMs: 0,
      },
    );
    expect(result.timedOut).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.terminationReason).toBe('timeout');
    expect(result.status).not.toBe(0);
  });

  it('does not classify timeout when silent command remains CPU-active', async () => {
    const script = `
const end = Date.now() + 2500;
while (Date.now() < end) {
  Math.sqrt(Math.random() * 1000);
}
process.exit(0);
`;
    const result = await runStreaming(
      process.execPath,
      ['-e', script],
      {
        allowFailure: true,
        timeoutMs: 2000,
        stallTimeoutMs: 0,
      },
    );
    expect(result.status).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.terminationReason).toBe(null);
    const cpuProgressEvents = (result.heartbeatTimeline ?? []).filter(
      (entry) => entry.event === 'cpu_progress',
    );
    expect(cpuProgressEvents.length).toBeGreaterThan(0);
  });

  it('marks CPU-active command as progress stalled when semantic progress stops', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogfood-progress-stall-'));
    const progressStatePath = path.join(tempDir, 'bootstrap_state.json');
    fs.writeFileSync(progressStatePath, JSON.stringify({
      phase_name: 'semantic_indexing',
      phase_progress: {
        total: 100,
        completed: 42,
        currentFile: '/tmp/hot.ts',
      },
    }), 'utf8');

    const script = `
const end = Date.now() + 10000;
while (Date.now() < end) {
  Math.sqrt(Math.random() * 1000);
}
`;

    try {
      const result = await runStreaming(
        process.execPath,
        ['-e', script],
        {
          allowFailure: true,
          timeoutMs: 10_000,
          stallTimeoutMs: 0,
          progressStateFile: progressStatePath,
          progressStallTimeoutMs: 250,
        },
      );
      expect(result.progressStalled).toBe(true);
      expect(result.terminationReason).toBe('progress_stall');
      expect(result.stalled).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.status).not.toBe(0);
      expect(result.progressSnapshot?.phaseName).toBe('semantic_indexing');
      expect(result.progressSnapshot?.completed).toBe(42);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('records bootstrap stage timeline when stage lines are emitted', async () => {
    const script = `
process.stdout.write('LiBrainian Bootstrap\\n');
process.stdout.write('Running pre-flight checks...\\n');
setTimeout(() => {}, 10_000);
`;
    const result = await runStreaming(
      process.execPath,
      ['-e', script],
      {
        allowFailure: true,
        timeoutMs: 5_000,
        stallTimeoutMs: 200,
      },
    );
    const stages = Array.isArray(result.stageTimeline)
      ? result.stageTimeline.map((entry) => entry.stage)
      : [];
    expect(stages).toContain('bootstrap_banner');
    expect(stages).toContain('preflight_checks');
    expect(result.stalled).toBe(true);
  });

  it('never targets unrelated external processes during stall recovery', async () => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
      detached: true,
      stdio: 'ignore',
    });
    unrelated.unref();
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid) {
      throw new Error('Expected unrelated process pid');
    }

    try {
      const result = await runStreaming(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 10_000);'],
        {
          allowFailure: true,
          timeoutMs: 5_000,
          stallTimeoutMs: 200,
        },
      );
      const targeted = result.recoveryAudit?.targetDescendantPids ?? [];
      expect(targeted.includes(unrelatedPid)).toBe(false);
      expect(() => process.kill(unrelatedPid, 0)).not.toThrow();
    } finally {
      try {
        process.kill(unrelatedPid, 'SIGTERM');
      } catch {
        // best-effort cleanup
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      try {
        process.kill(unrelatedPid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  });

  it('captures descendant process diagnostics for stalled process trees', async () => {
    const script = `
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
setTimeout(() => {}, 10_000);
`;
    const result = await runStreaming(
      process.execPath,
      ['-e', script],
      {
        allowFailure: true,
        timeoutMs: 5_000,
        stallTimeoutMs: 600,
      },
    );
    expect(result.stalled).toBe(true);
    const descendants = result.recoveryAudit?.preTermination?.descendants ?? [];
    expect(descendants.length).toBeGreaterThanOrEqual(1);
    expect(result.recoveryAudit?.targetDescendantPids.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('detects direct execution check using script path', () => {
    const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/dogfood-ci-gate.mjs');
    expect(scriptPath.endsWith('scripts/dogfood-ci-gate.mjs')).toBe(true);
  });
});
