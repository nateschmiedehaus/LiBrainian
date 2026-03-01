import { describe, expect, it } from 'vitest';
import { createEmptyKnowledge } from '../universal_types.js';

describe('createEmptyKnowledge security defaults', () => {
  it('initializes riskScore as null until security analysis runs', () => {
    const knowledge = createEmptyKnowledge('id', 'name', 'function', '/tmp/file.ts', 1);
    expect(knowledge.security.riskScore).toBeNull();
  });
});
