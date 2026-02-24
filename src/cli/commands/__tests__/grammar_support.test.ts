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

  it('skips hidden temp directories during language scans', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-grammar-hidden-'));
    await fs.writeFile(path.join(workspace, 'main.ts'), 'export const value = 1;');
    await fs.mkdir(path.join(workspace, '.tmp'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.tmp', 'hidden.ts'), 'export const hidden = 1;');

    const scan = await scanWorkspaceLanguages(workspace, { maxFiles: 50 });
    expect(scan.languageCounts.typescript).toBe(1);
  });

  it('truncates scan when entry limit is reached', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-grammar-limit-'));
    const bulkDir = path.join(workspace, 'bulk');
    await fs.mkdir(bulkDir, { recursive: true });
    for (let i = 0; i < 30; i += 1) {
      await fs.writeFile(path.join(bulkDir, `file_${i}.txt`), `item-${i}`);
    }

    const scan = await scanWorkspaceLanguages(workspace, { maxEntries: 10, maxFiles: 1000 });
    expect(scan.truncated).toBe(true);
    expect(scan.errors).toContain('entry_limit_reached:10');
  });
});
