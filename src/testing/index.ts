import type { Context } from '../constructions/types.js';
import type { Construction, ConstructionOutcome } from '../constructions/types.js';
import type { ConstructionError } from '../constructions/base/construction_base.js';
import { getNumericValue, isConfidenceValue } from '../epistemics/confidence.js';

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

export interface TestConstructionOptions<I, R extends Record<string, unknown> = Record<string, unknown>> {
  input: I;
  deps?: R;
  fixture?: string;
  context?: Partial<Omit<Context<R>, 'deps'>>;
}

export type TestConstructionResult<O, E extends ConstructionError = ConstructionError> =
  | {
      ok: true;
      output: O;
      confidence?: number;
      outcome: ConstructionOutcome<O, E>;
      fixture?: string;
    }
  | {
      ok: false;
      error: E;
      outcome: ConstructionOutcome<O, E>;
      fixture?: string;
    };

function extractOutputConfidence(output: unknown): number | undefined {
  if (typeof output !== 'object' || output === null || !('confidence' in output)) {
    return undefined;
  }
  const confidence = (output as { confidence?: unknown }).confidence;
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    return confidence;
  }
  if (isConfidenceValue(confidence)) {
    const numeric = getNumericValue(confidence);
    return numeric === null ? undefined : numeric;
  }
  return undefined;
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
 * Execute a Construction with deterministic test context wiring.
 *
 * Designed for fixture-driven tests where callers want one helper that:
 * - creates context with deps/signal/session defaults
 * - preserves fixture metadata for traceability
 * - normalizes confidence extraction for assertions
 */
export async function testConstruction<
  I,
  O,
  E extends ConstructionError = ConstructionError,
  R extends Record<string, unknown> = Record<string, unknown>,
>(
  construction: Pick<Construction<I, O, E, R>, 'execute'>,
  options: TestConstructionOptions<I, R>,
): Promise<TestConstructionResult<O, E>> {
  const metadata = options.fixture
    ? {
        ...(options.context?.metadata ?? {}),
        fixture: options.fixture,
      }
    : options.context?.metadata;

  const context = mockLibrarianContext((options.deps ?? ({} as R)), {
    ...options.context,
    metadata,
  });

  const outcome = await construction.execute(options.input, context);
  if (outcome.ok) {
    return {
      ok: true,
      output: outcome.value,
      confidence: extractOutputConfidence(outcome.value),
      outcome,
      fixture: options.fixture,
    };
  }
  return {
    ok: false,
    error: outcome.error,
    outcome,
    fixture: options.fixture,
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
