export function computeWorkerRetryDelay(attempt: number): number {
  const base = Math.min(attempt, 6) * 50;
  const jitter = 13;
  return base + jitter;
}

export const WORKER_BACKOFF_JITTER = 'worker-backoff-jitter-queue-retry';
