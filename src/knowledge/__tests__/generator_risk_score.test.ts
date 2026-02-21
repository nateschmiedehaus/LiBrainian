import { describe, expect, it } from 'vitest';
import type { LibrarianStorage, UniversalKnowledgeRecord } from '../../storage/types.js';
import { UniversalKnowledgeGenerator } from '../generator.js';
import { createEmptyKnowledge } from '../universal_types.js';

function knowledgeToRecord(
  generator: UniversalKnowledgeGenerator,
  knowledge: ReturnType<typeof createEmptyKnowledge>
): UniversalKnowledgeRecord {
  const method = Reflect.get(generator as object, 'knowledgeToRecord');
  if (typeof method !== 'function') {
    throw new Error('knowledgeToRecord is unavailable');
  }
  return method.call(generator, knowledge) as UniversalKnowledgeRecord;
}

describe('UniversalKnowledgeGenerator risk score persistence mapping', () => {
  it('persists undefined risk score when security analysis has not run', () => {
    const generator = new UniversalKnowledgeGenerator({
      storage: {} as LibrarianStorage,
      workspace: '/tmp/workspace',
      llmProvider: 'codex',
      skipLlm: true,
    });

    const knowledge = createEmptyKnowledge('id-null', 'NullRisk', 'function', 'src/file.ts', 1);

    const record = knowledgeToRecord(generator, knowledge);
    expect(record.riskScore).toBeUndefined();
  });

  it('persists numeric risk score including explicit zero once analyzed', () => {
    const generator = new UniversalKnowledgeGenerator({
      storage: {} as LibrarianStorage,
      workspace: '/tmp/workspace',
      llmProvider: 'codex',
      skipLlm: true,
    });

    const knowledge = createEmptyKnowledge('id-zero', 'ZeroRisk', 'function', 'src/file.ts', 1);
    knowledge.security.riskScore = {
      overall: 0,
      confidentiality: 0,
      integrity: 0,
      availability: 0,
    };

    const record = knowledgeToRecord(generator, knowledge);
    expect(record.riskScore).toBe(0);
  });
});
