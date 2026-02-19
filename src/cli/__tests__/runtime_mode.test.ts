import { describe, expect, it } from 'vitest';
import { applyCliRuntimeMode, deriveCliRuntimeMode, type CliRuntimeMode } from '../runtime_mode.js';

describe('cli runtime mode', () => {
  it('detects CI/non-interactive mode from environment', () => {
    const mode = deriveCliRuntimeMode({
      args: [],
      jsonMode: false,
      env: { CI: 'true' },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(mode.ci).toBe(true);
    expect(mode.nonInteractive).toBe(true);
    expect(mode.noProgress).toBe(true);
    expect(mode.assumeYes).toBe(true);
  });

  it('detects CI mode from GITHUB_ACTIONS environment', () => {
    const mode = deriveCliRuntimeMode({
      args: [],
      jsonMode: false,
      env: { GITHUB_ACTIONS: 'true' },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(mode.ci).toBe(true);
    expect(mode.nonInteractive).toBe(true);
    expect(mode.assumeYes).toBe(true);
  });

  it('detects non-interactive mode when stdout/stderr are not TTY', () => {
    const mode = deriveCliRuntimeMode({
      args: [],
      jsonMode: false,
      env: {},
      stdoutIsTTY: false,
      stderrIsTTY: false,
    });

    expect(mode.ci).toBe(true);
    expect(mode.nonInteractive).toBe(true);
  });

  it('respects explicit CLI flags', () => {
    const mode = deriveCliRuntimeMode({
      args: ['--yes', '--quiet', '--no-progress', '--no-color'],
      jsonMode: false,
      env: {},
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(mode.assumeYes).toBe(true);
    expect(mode.quiet).toBe(true);
    expect(mode.noProgress).toBe(true);
    expect(mode.noColor).toBe(true);
  });

  it('respects NO_COLOR environment variable', () => {
    const mode = deriveCliRuntimeMode({
      args: [],
      jsonMode: false,
      env: { NO_COLOR: '1' },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });

    expect(mode.noColor).toBe(true);
  });

  it('applies env settings and quiet console suppression', () => {
    const env: NodeJS.ProcessEnv = {};
    let logCalls = 0;
    let infoCalls = 0;
    let warnCalls = 0;
    let debugCalls = 0;

    const fakeConsole = {
      log: () => { logCalls++; },
      info: () => { infoCalls++; },
      warn: () => { warnCalls++; },
      debug: () => { debugCalls++; },
    };

    const mode: CliRuntimeMode = {
      ci: true,
      nonInteractive: true,
      quiet: true,
      noProgress: true,
      noColor: true,
      assumeYes: true,
      jsonMode: false,
    };

    const restore = applyCliRuntimeMode(mode, { env, consoleLike: fakeConsole });

    expect(env.LIBRARIAN_NO_INTERACTIVE).toBe('1');
    expect(env.LIBRARIAN_NO_PROGRESS).toBe('1');
    expect(env.NO_COLOR).toBe('1');
    expect(env.FORCE_COLOR).toBe('0');
    expect(env.LIBRARIAN_ASSUME_YES).toBe('1');
    expect(env.LIBRARIAN_LOG_LEVEL).toBe('silent');

    fakeConsole.log();
    fakeConsole.info();
    fakeConsole.warn();
    fakeConsole.debug();
    expect(logCalls).toBe(0);
    expect(infoCalls).toBe(0);
    expect(warnCalls).toBe(0);
    expect(debugCalls).toBe(0);

    restore();
    fakeConsole.log();
    fakeConsole.info();
    fakeConsole.warn();
    fakeConsole.debug();
    expect(logCalls).toBe(1);
    expect(infoCalls).toBe(1);
    expect(warnCalls).toBe(1);
    expect(debugCalls).toBe(1);
  });

  it('does not suppress console output in json mode', () => {
    const env: NodeJS.ProcessEnv = {};
    let logCalls = 0;
    const fakeConsole = {
      log: () => { logCalls++; },
      info: () => {},
      warn: () => {},
      debug: () => {},
    };

    const mode: CliRuntimeMode = {
      ci: false,
      nonInteractive: false,
      quiet: true,
      noProgress: false,
      noColor: false,
      assumeYes: false,
      jsonMode: true,
    };

    const restore = applyCliRuntimeMode(mode, { env, consoleLike: fakeConsole });
    fakeConsole.log();
    restore();
    fakeConsole.log();
    expect(logCalls).toBe(2);
  });
});
