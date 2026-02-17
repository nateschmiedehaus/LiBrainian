import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanWorkspaceLanguages, assessGrammarCoverage } from '../../grammar_support.js';

describe('grammar support helpers', () => {
  it('detects languages and missing grammars', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-grammar-'));
    await fs.writeFile(path.join(workspace, 'main.ts'), 'export const value = 1;');
    await fs.writeFile(path.join(workspace, 'main.py'), 'def hello():\n  return 1\n');
    await fs.writeFile(path.join(workspace, 'main.zig'), 'const std = @import("std");');

    const scan = await scanWorkspaceLanguages(workspace, { maxFiles: 50 });
    expect(scan.languageCounts.typescript).toBe(1);
    expect(scan.languageCounts.python).toBe(1);
    expect(scan.languageCounts.zig).toBe(1);

    const coverage = assessGrammarCoverage(scan, {
      resolveModule: (moduleName) => moduleName === 'tree-sitter',
    });

    expect(coverage.supportedByTsMorph).toContain('typescript');
    expect(coverage.missingGrammarModules).toContain('tree-sitter-python');
    expect(coverage.missingLanguageConfigs).toContain('zig');
    expect(coverage.missingTreeSitterCore).toBe(false);
  });
});
