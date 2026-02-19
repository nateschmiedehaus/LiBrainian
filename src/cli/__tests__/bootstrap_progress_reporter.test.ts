import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOTSTRAP_PHASES } from '../../types.js';
import { createBootstrapProgressReporter } from '../bootstrap_progress_reporter.js';
import { createProgressBar } from '../progress.js';

vi.mock('../progress.js', () => ({
  createProgressBar: vi.fn(),
}));

type WritableCapture = Pick<NodeJS.WriteStream, 'write'> & { lines: string[] };

function createCaptureStream(): WritableCapture {
  const lines: string[] = [];
  return {
    lines,
    write: (chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  };
}

describe('createBootstrapProgressReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LIBRARIAN_NO_PROGRESS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LIBRARIAN_NO_PROGRESS;
  });

  it('uses in-place progress bars for TTY phase updates', () => {
    const barA = {
      update: vi.fn(),
      setTotal: vi.fn(),
      increment: vi.fn(),
      stop: vi.fn(),
    };
    const barB = {
      update: vi.fn(),
      setTotal: vi.fn(),
      increment: vi.fn(),
      stop: vi.fn(),
    };
    vi.mocked(createProgressBar)
      .mockReturnValueOnce(barA as any)
      .mockReturnValueOnce(barB as any);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = createBootstrapProgressReporter({ isTTY: true });

    reporter.onProgress(BOOTSTRAP_PHASES[0], 0, { total: 500, current: 0, currentFile: 'src/index.ts' });
    reporter.onProgress(BOOTSTRAP_PHASES[0], 0.2, { total: 500, current: 100, currentFile: 'src/main.ts' });
    reporter.onProgress(BOOTSTRAP_PHASES[1], 0, { total: 20, current: 0 });
    reporter.complete();

    expect(createProgressBar).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createProgressBar).mock.calls[0]?.[0]).toMatchObject({ total: 500 });
    expect(vi.mocked(createProgressBar).mock.calls[1]?.[0]).toMatchObject({ total: 20 });
    expect(barA.stop).toHaveBeenCalledTimes(1);
    expect(barA.update).toHaveBeenCalledWith(100, { task: 'src/main.ts' });
    expect(barB.update).toHaveBeenCalled();
    expect(barB.stop).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('[1/5]'))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('[2/5]'))).toBe(true);

    logSpy.mockRestore();
  });

  it('emits throttled non-TTY progress lines for phase updates', () => {
    const stream = createCaptureStream();
    let nowMs = 0;
    const now = () => nowMs;
    const reporter = createBootstrapProgressReporter({
      isTTY: false,
      now,
      stream,
      nonTtyIntervalMs: 10_000,
    });

    reporter.onProgress(BOOTSTRAP_PHASES[1], 0.001, { total: 1000, current: 1, currentFile: 'src/a.ts' });
    nowMs = 2_000;
    reporter.onProgress(BOOTSTRAP_PHASES[1], 0.05, { total: 1000, current: 50, currentFile: 'src/b.ts' });
    nowMs = 3_000;
    reporter.onProgress(BOOTSTRAP_PHASES[1], 0.18, { total: 1000, current: 180, currentFile: 'src/c.ts' });
    nowMs = 9_000;
    reporter.onProgress(BOOTSTRAP_PHASES[1], 0.22, { total: 1000, current: 220, currentFile: 'src/d.ts' });
    nowMs = 13_050;
    reporter.onProgress(BOOTSTRAP_PHASES[1], 0.23, { total: 1000, current: 230, currentFile: 'src/e.ts' });
    reporter.complete();

    expect(stream.lines.length).toBe(3);
    expect(stream.lines[0]).toContain('[2/5]');
    expect(stream.lines[1]).toContain('180/1000');
    expect(stream.lines[2]).toContain('230/1000');
  });

  it('emits heartbeat lines every interval in non-TTY mode and stops after completion', () => {
    vi.useFakeTimers();
    const stream = createCaptureStream();
    const reporter = createBootstrapProgressReporter({
      isTTY: false,
      stream,
      nonTtyIntervalMs: 10_000,
    });

    reporter.onProgress(BOOTSTRAP_PHASES[0], 0, { total: 100, current: 0 });
    expect(stream.lines.length).toBe(1);

    vi.advanceTimersByTime(10_000);
    expect(stream.lines.length).toBe(2);

    reporter.complete();
    const emitted = stream.lines.length;
    vi.advanceTimersByTime(20_000);
    expect(stream.lines.length).toBe(emitted);
  });
});
