import { describe, it, expect } from 'vitest';
import {
  withinTransaction,
  TransactionConflictError,
} from '../transactions.js';
import type { LibrarianStorage, TransactionContext } from '../types.js';

describe('withinTransaction', () => {
  it('runs the callback inside storage.transaction', async () => {
    const calls: string[] = [];
    const storage = {
      transaction: async <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> => {
        calls.push('transaction');
        return fn({} as TransactionContext);
      },
    } as unknown as LibrarianStorage;

    const result = await withinTransaction(storage, async () => 'ok');

    expect(result).toBe('ok');
    expect(calls).toEqual(['transaction']);
  });

  it('retries on conflict with default contract', async () => {
    let attempts = 0;
    const storage = {
      transaction: async <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> => {
        attempts += 1;
        if (attempts === 1) {
          throw new TransactionConflictError('collision');
        }
        return fn({} as TransactionContext);
      },
    } as unknown as LibrarianStorage;

    const result = await withinTransaction(storage, async () => 'ok');

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('fails fast when onConflict is fail', async () => {
    const storage = {
      transaction: async (): Promise<string> => {
        throw new TransactionConflictError('collision');
      },
    } as unknown as LibrarianStorage;

    await expect(
      withinTransaction(storage, async () => 'ok', {
        contract: { onConflict: 'fail', maxRetries: 0 },
      })
    ).rejects.toThrow('collision');
  });

  it('throws for merge strategy until implemented', async () => {
    const storage = {
      transaction: async (): Promise<string> => {
        throw new TransactionConflictError('collision');
      },
    } as unknown as LibrarianStorage;

    await expect(
      withinTransaction(storage, async () => 'ok', {
        contract: { onConflict: 'merge', maxRetries: 0 },
      })
    ).rejects.toThrow('transaction_merge_unimplemented');
  });

  it('applies exponential backoff between retry attempts', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const storage = {
      transaction: async <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> => {
        attempts += 1;
        if (attempts < 3) {
          throw new TransactionConflictError(`collision_${attempts}`);
        }
        return fn({} as TransactionContext);
      },
    } as unknown as LibrarianStorage;

    const result = await withinTransaction(storage, async () => 'ok', {
      contract: { onConflict: 'retry', maxRetries: 3 },
      backoffMs: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });
});
