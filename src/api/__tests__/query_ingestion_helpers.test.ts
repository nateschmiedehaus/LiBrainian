import { describe, expect, it } from 'vitest';
import {
  compileCodeownerPattern,
  countFindings,
  isCommitPayload,
  isRecord,
  readStringArray,
} from '../query_ingestion_helpers.js';

describe('query ingestion helpers', () => {
  it('parses non-empty string arrays', () => {
    expect(readStringArray(['a', ' ', '', 'b', 123, null])).toEqual(['a', 'b']);
  });

  it('counts findings arrays only', () => {
    expect(countFindings({ findings: [{ id: 1 }, { id: 2 }] })).toBe(2);
    expect(countFindings({ findings: 'oops' })).toBe(0);
    expect(countFindings(null)).toBe(0);
  });

  it('identifies commit payload shape', () => {
    expect(isCommitPayload({ commitHash: 'abc', filesChanged: ['src/a.ts'] })).toBe(true);
    expect(isCommitPayload({ commitHash: 'abc' })).toBe(false);
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord([])).toBe(false);
  });

  it('compiles CODEOWNERS-like patterns', () => {
    const regex = compileCodeownerPattern('/apps/web/src/index.ts');
    expect(regex?.test('apps/web/src/index.ts')).toBe(true);
    expect(regex?.test('apps/api/src/index.ts')).toBe(false);
  });
});
