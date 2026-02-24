import { describe, expect, it } from 'vitest';
import type { SymbolEntry } from '../../constructions/symbol_table.js';
import { __testing } from '../bootstrap.js';

function makeSymbolEntry(index: number): SymbolEntry {
  return {
    name: `S${index}`,
    kind: 'function',
    file: '/tmp/test.ts',
    line: index + 1,
    exported: false,
  };
}

describe('bootstrap symbol append helper', () => {
  it('appends large symbol arrays without stack overflow', () => {
    const target: SymbolEntry[] = [];
    const largeBatch = Array.from({ length: 70000 }, (_, index) => makeSymbolEntry(index));

    expect(() => __testing.appendSymbolEntries(target, largeBatch)).not.toThrow();
    expect(target).toHaveLength(70000);
    expect(target[69999]?.name).toBe('S69999');
  });
});
