import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('run-with-tmpdir script', () => {
  it('documents timeout flag in help output', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'run-with-tmpdir.mjs');
    const result = spawnSync(process.execPath, [scriptPath, '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('--timeout-seconds N');
  });

  it('terminates long-running child commands when timeout is exceeded', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'run-with-tmpdir.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--timeout-seconds',
        '1',
        '--',
        process.execPath,
        '-e',
        'setInterval(() => {}, 1000);',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15_000,
      },
    );

    expect(result.status).toBe(124);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('Command timed out after 1s');
  });
});
