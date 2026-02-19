import type {
  ConcurrencyContract,
  LibrarianStorage,
  TransactionConflictStrategy,
  TransactionContext,
} from './types.js';

export const DEFAULT_CONCURRENCY_CONTRACT: ConcurrencyContract = {
  readIsolation: 'snapshot',
  conflictDetection: 'optimistic',
  onConflict: 'retry',
  maxRetries: 3,
};

export class TransactionConflictError extends Error {
  readonly code = 'transaction_conflict';

  constructor(message = 'transaction conflict detected') {
    super(message);
    this.name = 'TransactionConflictError';
  }
}

export function isTransactionConflictError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TransactionConflictError) return true;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    return code === 'transaction_conflict';
  }
  return false;
}

export type ConflictHandler = (args: {
  error: unknown;
  attempt: number;
  contract: ConcurrencyContract;
}) => TransactionConflictStrategy;

export async function withinTransaction<T>(
  storage: LibrarianStorage,
  fn: (tx: TransactionContext) => Promise<T>,
  options: {
    contract?: Partial<ConcurrencyContract>;
    onConflict?: ConflictHandler;
    backoffMs?: number;
    maxBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<T> {
  const contract = resolveConcurrencyContract(options.contract);
  const maxAttempts = Math.max(1, contract.maxRetries + 1);
  const conflictHandler = options.onConflict ?? defaultConflictHandler;
  const baseBackoffMs = Math.max(0, Math.floor(options.backoffMs ?? 0));
  const maxBackoffMs = Math.max(baseBackoffMs, Math.floor(options.maxBackoffMs ?? 1000));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await storage.transaction(fn);
    } catch (error) {
      if (!isTransactionConflictError(error)) throw error;
      const strategy = conflictHandler({ error, attempt, contract });
      if (strategy === 'retry' && attempt < maxAttempts) {
        const delayMs = computeRetryBackoffMs(attempt, baseBackoffMs, maxBackoffMs);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        continue;
      }
      if (strategy === 'merge') {
        throw new Error('unverified_by_trace(transaction_merge_unimplemented)');
      }
      throw error;
    }
  }
  throw new Error('unverified_by_trace(transaction_retry_exhausted)');
}

function resolveConcurrencyContract(
  overrides?: Partial<ConcurrencyContract>
): ConcurrencyContract {
  const contract = {
    ...DEFAULT_CONCURRENCY_CONTRACT,
    ...overrides,
  };
  contract.maxRetries = coerceMaxRetries(contract.maxRetries);
  return contract;
}

function coerceMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY_CONTRACT.maxRetries;
  if (value < 0) return 0;
  return Math.floor(value);
}

function defaultConflictHandler(args: {
  error: unknown;
  attempt: number;
  contract: ConcurrencyContract;
}): TransactionConflictStrategy {
  const { contract } = args;
  return contract.onConflict;
}

function computeRetryBackoffMs(
  attempt: number,
  baseBackoffMs: number,
  maxBackoffMs: number
): number {
  if (baseBackoffMs <= 0) return 0;
  const exponent = Math.max(0, attempt - 1);
  const computed = baseBackoffMs * (2 ** exponent);
  if (!Number.isFinite(computed)) return maxBackoffMs;
  return Math.min(maxBackoffMs, Math.floor(computed));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const __testing = {
  resolveConcurrencyContract,
  coerceMaxRetries,
  computeRetryBackoffMs,
};
