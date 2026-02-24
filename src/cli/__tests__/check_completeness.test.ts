import { describe, it, expect } from 'vitest';
import { normalizeCounterevidenceInput } from '../commands/check_completeness.js';

describe('check completeness command helpers', () => {
  it('normalizes valid counterevidence entries and drops invalid ones', () => {
    const parsed = normalizeCounterevidenceInput([
      {
        artifact: 'migration',
        reason: 'Intentional externalized storage for this workflow.',
        pattern: 'crud_function',
        filePattern: 'src/order\\.ts$',
        weight: 0.9,
      },
      { artifact: '', reason: 'invalid' },
      null,
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.artifact).toBe('migration');
    expect(parsed[0]?.pattern).toBe('crud_function');
  });
});
