import { BOOTSTRAP_PHASES, type BootstrapPhase } from '../types.js';
import { createProgressBar, type ProgressBarHandle } from './progress.js';

const DEFAULT_NON_TTY_INTERVAL_MS = 10_000;
const ITEM_PROGRESS_LOG_DELTA = 100;

export interface BootstrapProgressReporterOptions {
  isTTY?: boolean;
  now?: () => number;
  stream?: Pick<NodeJS.WriteStream, 'write'>;
  nonTtyIntervalMs?: number;
}

export interface BootstrapProgressDetails {
  total?: number;
  current?: number;
  currentFile?: string;
}

interface PhaseProgressState {
  phase: BootstrapPhase;
  phaseIndex: number;
  startedAtMs: number;
  lastProgress: number;
  lastCurrent?: number;
  lastTotal?: number;
  lastFile?: string;
  lastLogAtMs: number;
  lastLoggedCurrent: number;
}

export interface BootstrapProgressReporter {
  onProgress(phase: BootstrapPhase, progress: number, details?: BootstrapProgressDetails): void;
  complete(): void;
}

export function createBootstrapProgressReporter(
  options: BootstrapProgressReporterOptions = {}
): BootstrapProgressReporter {
  if (isProgressDisabled()) {
    return {
      onProgress: () => {},
      complete: () => {},
    };
  }

  const now = options.now ?? (() => Date.now());
  const isTTY = options.isTTY ?? Boolean(process.stderr.isTTY);
  const stream = options.stream ?? process.stderr;
  const nonTtyIntervalMs = options.nonTtyIntervalMs ?? DEFAULT_NON_TTY_INTERVAL_MS;
  let phaseState: PhaseProgressState | null = null;
  let progressBar: ProgressBarHandle | null = null;
  let intervalId: NodeJS.Timeout | null = null;

  if (!isTTY) {
    intervalId = setInterval(() => {
      if (!phaseState) return;
      const currentNow = now();
      if (currentNow - phaseState.lastLogAtMs < nonTtyIntervalMs) return;
      emitNonTtyProgressLine(phaseState, currentNow, stream);
      phaseState.lastLogAtMs = currentNow;
      phaseState.lastLoggedCurrent = resolveCurrent(phaseState);
    }, nonTtyIntervalMs);
    intervalId.unref?.();
  }

  const onProgress = (phase: BootstrapPhase, progress: number, details?: BootstrapProgressDetails): void => {
    const currentNow = now();
    const phaseIndex = resolvePhaseIndex(phase);
    const hasPhaseChanged = !phaseState || phaseState.phase.name !== phase.name;

    if (hasPhaseChanged) {
      if (progressBar) {
        progressBar.stop();
        progressBar = null;
      }

      phaseState = {
        phase,
        phaseIndex,
        startedAtMs: currentNow,
        lastProgress: progress,
        lastCurrent: details?.current,
        lastTotal: details?.total,
        lastFile: details?.currentFile,
        lastLogAtMs: 0,
        lastLoggedCurrent: 0,
      };
    } else if (phaseState) {
      phaseState.lastProgress = progress;
      if (details?.current !== undefined) {
        phaseState.lastCurrent = details.current;
      }
      if (details?.total !== undefined) {
        phaseState.lastTotal = details.total;
      }
      if (details?.currentFile) {
        phaseState.lastFile = details.currentFile;
      }
    }

    if (!phaseState) return;

    if (isTTY) {
      const phaseLabel = `[${phaseState.phaseIndex + 1}/${BOOTSTRAP_PHASES.length}] ${phaseState.phase.description}`;
      if (hasPhaseChanged || !progressBar) {
        console.log(`\n${phaseLabel}`);
        const initialTotal = details?.total && details.total > 0 ? details.total : 100;
        progressBar = createProgressBar({
          total: initialTotal,
          format: '[{bar}] {percentage}% | {value}/{total} | {task}',
        });
      }
      updateProgressBar(progressBar, phaseState, details, progress);
      return;
    }

    const currentValue = resolveCurrent(phaseState);
    const previousLoggedValue = phaseState.lastLoggedCurrent;
    const isCompleted = isPhaseCompleted(phaseState);
    const shouldLog =
      hasPhaseChanged ||
      isCompleted ||
      currentNow - phaseState.lastLogAtMs >= nonTtyIntervalMs ||
      currentValue - previousLoggedValue >= ITEM_PROGRESS_LOG_DELTA;

    if (!shouldLog) return;

    emitNonTtyProgressLine(phaseState, currentNow, stream);
    phaseState.lastLogAtMs = currentNow;
    phaseState.lastLoggedCurrent = currentValue;
  };

  const complete = (): void => {
    if (progressBar) {
      progressBar.stop();
      progressBar = null;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  return { onProgress, complete };
}

function updateProgressBar(
  bar: ProgressBarHandle,
  phaseState: PhaseProgressState,
  details: BootstrapProgressDetails | undefined,
  progress: number
): void {
  const knownTotal = details?.total ?? phaseState.lastTotal;
  if (knownTotal !== undefined && knownTotal > 0) {
    bar.setTotal(knownTotal);
    phaseState.lastTotal = knownTotal;
    const current = details?.current ?? Math.round(progress * knownTotal);
    phaseState.lastCurrent = current;
    const task = details?.currentFile ? summarizeFilePath(details.currentFile) : phaseState.phase.description;
    bar.update(clamp(current, 0, knownTotal), { task });
    return;
  }

  const current = Math.round(progress * 100);
  phaseState.lastCurrent = current;
  bar.update(clamp(current, 0, 100), { task: phaseState.phase.description });
}

function emitNonTtyProgressLine(
  phaseState: PhaseProgressState,
  currentNow: number,
  stream: Pick<NodeJS.WriteStream, 'write'>
): void {
  const current = resolveCurrent(phaseState);
  const total = phaseState.lastTotal;
  const elapsedSec = Math.max((currentNow - phaseState.startedAtMs) / 1000, 0.001);
  const rate = current > 0 ? current / elapsedSec : undefined;
  const percent = total && total > 0
    ? Math.round((current / total) * 100)
    : Math.round(phaseState.lastProgress * 100);
  const etaSeconds = total && rate && rate > 0 ? Math.max((total - current) / rate, 0) : undefined;
  const fileHint = phaseState.lastFile ? ` | ${summarizeFilePath(phaseState.lastFile)}` : '';
  const counts = total && total > 0
    ? `${current}/${total} (${percent}%)`
    : `${percent}%`;
  const rateText = rate ? ` | ${rate.toFixed(1)}/s` : '';
  const etaText = etaSeconds !== undefined ? ` | ETA ${formatEta(etaSeconds)}` : '';
  stream.write(
    `[${phaseState.phaseIndex + 1}/${BOOTSTRAP_PHASES.length}] ${phaseState.phase.description}: ${counts}${rateText}${etaText}${fileHint}\n`
  );
}

function resolveCurrent(phaseState: PhaseProgressState): number {
  if (phaseState.lastCurrent !== undefined) {
    return Math.max(0, phaseState.lastCurrent);
  }
  if (phaseState.lastTotal !== undefined && phaseState.lastTotal > 0) {
    return Math.round(phaseState.lastProgress * phaseState.lastTotal);
  }
  return Math.max(0, Math.round(phaseState.lastProgress * 100));
}

function isPhaseCompleted(phaseState: PhaseProgressState): boolean {
  if (phaseState.lastTotal !== undefined && phaseState.lastTotal > 0 && phaseState.lastCurrent !== undefined) {
    return phaseState.lastCurrent >= phaseState.lastTotal;
  }
  return phaseState.lastProgress >= 1;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function summarizeFilePath(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return filePath;
  return parts.slice(-2).join('/');
}

function resolvePhaseIndex(phase: BootstrapPhase): number {
  const index = BOOTSTRAP_PHASES.findIndex((candidate) => candidate.name === phase.name);
  return index >= 0 ? index : 0;
}

function isProgressDisabled(): boolean {
  const raw = process.env.LIBRARIAN_NO_PROGRESS?.toLowerCase();
  return raw === '1' || raw === 'true';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
