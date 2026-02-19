import type { Context } from '../constructions/types.js';

export interface MockLedgerEntry<T = unknown> {
  id: string;
  timestamp: string;
  entry: T;
}

export interface MockLedger<T = unknown> {
  append(entry: T): Promise<MockLedgerEntry<T>>;
  list(): Promise<MockLedgerEntry<T>[]>;
  query(predicate: (entry: MockLedgerEntry<T>) => boolean): Promise<MockLedgerEntry<T>[]>;
  clear(): void;
  size(): number;
}

export interface MockCalibrationTracker {
  calibrate(raw: number): number;
  current(): number;
  set(value: number): void;
}

/**
 * Create a deterministic construction execution context for tests.
 */
export function mockLibrarianContext<TDeps extends Record<string, unknown>>(
  deps: TDeps,
  overrides: Partial<Omit<Context<TDeps>, 'deps'>> = {},
): Context<TDeps> {
  return {
    deps,
    signal: overrides.signal ?? new AbortController().signal,
    sessionId: overrides.sessionId ?? 'test-session',
    tokenBudget: overrides.tokenBudget,
    metadata: overrides.metadata,
    traceContext: overrides.traceContext,
  };
}

/**
 * Create an in-memory evidence ledger for deterministic tests.
 */
export function mockLedger<T = unknown>(seed: T[] = []): MockLedger<T> {
  let nextId = 1;
  const entries: MockLedgerEntry<T>[] = seed.map((entry) => ({
    id: `ev_${nextId++}`,
    timestamp: new Date().toISOString(),
    entry,
  }));

  return {
    async append(entry: T): Promise<MockLedgerEntry<T>> {
      const created: MockLedgerEntry<T> = {
        id: `ev_${nextId++}`,
        timestamp: new Date().toISOString(),
        entry,
      };
      entries.push(created);
      return created;
    },
    async list(): Promise<MockLedgerEntry<T>[]> {
      return [...entries];
    },
    async query(predicate: (entry: MockLedgerEntry<T>) => boolean): Promise<MockLedgerEntry<T>[]> {
      return entries.filter(predicate);
    },
    clear(): void {
      entries.length = 0;
    },
    size(): number {
      return entries.length;
    },
  };
}

/**
 * Create a deterministic confidence calibration tracker for tests.
 */
export function mockCalibrationTracker(initial = 0.8): MockCalibrationTracker {
  let value = initial;
  return {
    calibrate(_raw: number): number {
      return value;
    },
    current(): number {
      return value;
    },
    set(next: number): void {
      value = next;
    },
  };
}

/**
 * Fixture helper for deterministic construction output in tests.
 */
export function constructionFixture<TInput, TResult>(
  id: string,
  result: TResult | ((input: TInput) => TResult | Promise<TResult>),
): {
  id: string;
  execute(input: TInput): Promise<TResult>;
} {
  return {
    id,
    async execute(input: TInput): Promise<TResult> {
      if (typeof result === 'function') {
        return (result as (value: TInput) => TResult | Promise<TResult>)(input);
      }
      return result;
    },
  };
}
