import { describe, it, expect } from 'vitest';
import type { ASTFact } from '../evaluation/ast_fact_extractor.js';
import { GroundTruthGenerator } from '../evaluation/ground_truth_generator.js';

describe('GroundTruthGenerator call graph grouping', () => {
  it('handles prototype-like caller names without crashing', () => {
    const generator = new GroundTruthGenerator();
    const facts: ASTFact[] = [
      {
        type: 'call',
        identifier: 'call-1',
        file: 'src/a.ts',
        line: 1,
        details: { caller: 'constructor', callee: 'doWork' },
      },
      {
        type: 'call',
        identifier: 'call-2',
        file: 'src/b.ts',
        line: 2,
        details: { caller: '__proto__', callee: 'init' },
      },
    ];

    const queries = generator.generateCallGraphQueries(facts);

    expect(queries.length).toBeGreaterThan(0);
  });
});
