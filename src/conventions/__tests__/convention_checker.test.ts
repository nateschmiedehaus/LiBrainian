import { describe, it, expect } from 'vitest';
import type { ConventionRecord } from '../../storage/types.js';
import { evaluateConventionsForFile } from '../convention_checker.js';

const baseRecord: Omit<ConventionRecord, 'pattern'> = {
  id: 'test',
  name: 'Test Convention',
  category: 'import_pattern',
  ruleType: 'always',
  evidenceCount: 1,
  totalCount: 1,
  confidence: 1,
  exceptions: [],
  source: 'mined',
  description: 'desc',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('evaluateConventionsForFile', () => {
  it('flags missing import conventions', () => {
    const convention: ConventionRecord = {
      ...baseRecord,
      pattern: {
        kind: 'import_presence',
        directories: ['src/api'],
        importPath: 'src/storage/index.ts',
      },
    };
    const violations = evaluateConventionsForFile('src/api/example.ts', 'export const test = 1;', [convention]);
    expect(violations).toHaveLength(1);

    const ok = evaluateConventionsForFile('src/api/example.ts', "import '../storage/index.ts';", [convention]);
    expect(ok).toHaveLength(0);
  });

  it('enforces naming conventions', () => {
    const convention: ConventionRecord = {
      ...baseRecord,
      category: 'naming',
      pattern: {
        kind: 'naming_style',
        appliesTo: 'file',
        style: 'snake_case',
        directories: ['src/constructions/processes'],
      },
    };
    const violations = evaluateConventionsForFile(
      'src/constructions/processes/CamelCaseName.ts',
      'export const test = 1;',
      [convention]
    );
    expect(violations).toHaveLength(1);

    const ok = evaluateConventionsForFile(
      'src/constructions/processes/snake_case_name.ts',
      'export const test = 1;',
      [convention]
    );
    expect(ok).toHaveLength(0);
  });
});
