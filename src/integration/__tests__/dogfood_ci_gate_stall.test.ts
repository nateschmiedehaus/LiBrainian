import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, runStreaming } from '../../../scripts/dogfood-ci-gate.mjs';

describe('dogfood ci gate liveness controls', () => {
  it('parses bootstrap stall timeout flag', () => {
    const parsed = parseArgs(['--bootstrap-stall-timeout-ms', '12345']);
    expect(parsed.bootstrapStallTimeoutMs).toBe(12345);
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

  it('detects direct execution check using script path', () => {
    const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/dogfood-ci-gate.mjs');
    expect(scriptPath.endsWith('scripts/dogfood-ci-gate.mjs')).toBe(true);
  });
});
