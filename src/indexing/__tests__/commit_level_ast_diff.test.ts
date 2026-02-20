import { describe, expect, it } from 'vitest';
import { detectFunctionRenames, extractFunctionFingerprints } from '../commit_level_ast_diff.js';

describe('commit-level AST diff helpers', () => {
  it('extracts function fingerprints for TS/JS declarations', () => {
    const source = `
      function oldName(a, b) {
        return a + b;
      }
      const arrowName = (x) => {
        return x * 2;
      };
    `;
    const fingerprints = extractFunctionFingerprints(source, 'example.ts');
    expect(fingerprints.map((item) => item.name)).toEqual(expect.arrayContaining(['oldName', 'arrowName']));
  });

  it('detects pure function rename when body is unchanged', () => {
    const before = `
      function oldName(a, b) {
        return a + b;
      }
    `;
    const after = `
      function newName(a, b) {
        return a + b;
      }
    `;

    const renames = detectFunctionRenames(before, after, 'example.ts');
    expect(renames).toEqual([{ from: 'oldName', to: 'newName' }]);
  });

  it('does not mark rename when implementation changes', () => {
    const before = `
      function oldName(a, b) {
        return a + b;
      }
    `;
    const after = `
      function newName(a, b) {
        return a - b;
      }
    `;

    const renames = detectFunctionRenames(before, after, 'example.ts');
    expect(renames).toEqual([]);
  });

  it('detects Python def rename when body is unchanged', () => {
    const before = `
def old_name(a, b):
    return a + b
`;
    const after = `
def new_name(a, b):
    return a + b
`;
    const renames = detectFunctionRenames(before, after, 'module.py');
    expect(renames).toEqual([{ from: 'old_name', to: 'new_name' }]);
  });
});
