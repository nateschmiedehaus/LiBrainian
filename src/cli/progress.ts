/**
 * @fileoverview Progress indicators for CLI operations
 *
 * Provides spinner and progress bar utilities for long-running operations.
 */

import cliProgress from 'cli-progress';

// Spinner frames for text-based spinner
const SPINNER_FRAMES = ['|', '/', '-', '\\'];
const SPINNER_INTERVAL_MS = 100;

function isProgressEnabled(): boolean {
  const disabled =
    process.env.LIBRARIAN_NO_PROGRESS === '1' ||
    process.env.LIBRARIAN_NO_PROGRESS === 'true';
  if (disabled) return false;
  return Boolean(process.stderr.isTTY);
}

export interface SpinnerHandle {
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

export function createSpinner(initialMessage: string): SpinnerHandle {
  if (!isProgressEnabled()) {
    return {
      update(): void {},
      succeed(): void {},
      fail(): void {},
      stop(): void {},
    };
  }

  let frameIndex = 0;
  let message = initialMessage;
  let running = true;
  let intervalId: NodeJS.Timeout | null = null;
  const stream = process.stderr;

  const render = (): void => {
    if (!running) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    stream.write(`\r${frame} ${message}`);
    frameIndex++;
  };

  // Clear current line
  const clearLine = (): void => {
    stream.write('\r' + ' '.repeat(message.length + 4) + '\r');
  };

  intervalId = setInterval(render, SPINNER_INTERVAL_MS);
  render();

  return {
    update(newMessage: string): void {
      clearLine();
      message = newMessage;
      render();
    },

    succeed(finalMessage?: string): void {
      running = false;
      if (intervalId) clearInterval(intervalId);
      clearLine();
      stream.write(`[OK] ${finalMessage || message}\n`);
    },

    fail(finalMessage?: string): void {
      running = false;
      if (intervalId) clearInterval(intervalId);
      clearLine();
      stream.write(`[FAIL] ${finalMessage || message}\n`);
    },

    stop(): void {
      running = false;
      if (intervalId) clearInterval(intervalId);
      clearLine();
    },
  };
}

export interface ProgressBarHandle {
  update(current: number, payload?: Record<string, unknown>): void;
  setTotal(total: number): void;
  increment(delta?: number, payload?: Record<string, unknown>): void;
  stop(): void;
}

export interface ProgressBarOptions {
  total: number;
  format?: string;
  showEta?: boolean;
  etaBuffer?: number;
}

export function createProgressBar(options: ProgressBarOptions): ProgressBarHandle {
  if (!isProgressEnabled()) {
    return {
      update(): void {},
      setTotal(): void {},
      increment(): void {},
      stop(): void {},
    };
  }

  const { total, showEta = true, etaBuffer = 10 } = options;

  const format = options.format || '{bar} {percentage}% | {value}/{total} | {task} | ETA: {eta_formatted}';

  const bar = new cliProgress.SingleBar(
    {
      format,
      barCompleteChar: '=',
      barIncompleteChar: '-',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
      etaBuffer,
      forceRedraw: true,
      stream: process.stderr,
    },
    cliProgress.Presets.shades_classic,
  );

  bar.start(total, 0, { task: 'Initializing...' });

  return {
    update(current: number, payload?: Record<string, unknown>): void {
      bar.update(current, payload);
    },

    setTotal(newTotal: number): void {
      bar.setTotal(newTotal);
    },

    increment(delta = 1, payload?: Record<string, unknown>): void {
      bar.increment(delta, payload);
    },

    stop(): void {
      bar.stop();
    },
  };
}

/**
 * Format milliseconds into a human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(date: Date | string | null): string {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format a file size in bytes to human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Display a simple table in the terminal
 */
export function printTable(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map((row) => (row[i] || '').length));
    return Math.max(h.length, maxRowWidth);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');

  console.log(headerLine);
  console.log(separator);

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell || '').padEnd(widths[i])).join(' | ');
    console.log(line);
  }
}

/**
 * Print a key-value list
 */
export function printKeyValue(items: Array<{ key: string; value: string | number | boolean | null }>): void {
  const maxKeyLength = Math.max(...items.map((item) => item.key.length));

  for (const item of items) {
    const value = item.value === null ? 'N/A' : String(item.value);
    console.log(`  ${item.key.padEnd(maxKeyLength)}: ${value}`);
  }
}
