import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ASTFactExtractor } from '../evaluation/ast_fact_extractor.js';

describe('ASTFactExtractor multi-language', () => {
  it('extracts Java facts via tree-sitter', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ast-'));
    const filePath = path.join(tmpDir, 'Calculator.java');
    await fs.writeFile(
      filePath,
      `
public class Calculator {
  public int add(int a, int b) {
    return a + b;
  }
}
`
    );

    const extractor = new ASTFactExtractor();
    const facts = await extractor.extractFromFile(filePath);
    const functionFacts = facts.filter((fact) => fact.type === 'function_def');
    const classFacts = facts.filter((fact) => fact.type === 'class');

    expect(functionFacts.some((fact) => fact.identifier === 'add')).toBe(true);
    expect(classFacts.some((fact) => fact.identifier === 'Calculator')).toBe(true);
  });

  it('skips generated state directories during directory extraction', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ast-state-skip-'));
    const srcDir = path.join(tmpDir, 'src');
    const stateDir = path.join(tmpDir, 'state');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'main.ts'),
      'export function keepMe(): number { return 1; }\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(stateDir, 'huge.json'),
      '{"generated":true,"payload":"' + 'x'.repeat(10000) + '"}',
      'utf8'
    );

    const extractor = new ASTFactExtractor();
    const facts = await extractor.extractFromDirectory(tmpDir);
    expect(facts.some((fact) => fact.identifier === 'keepMe')).toBe(true);
    expect(facts.some((fact) => fact.file.includes(`${path.sep}state${path.sep}`))).toBe(false);
  });

  it('respects maxFiles extraction limit', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ast-max-files-'));
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'b.ts'), 'export const b = 2;\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'c.ts'), 'export const c = 3;\n', 'utf8');

    const extractor = new ASTFactExtractor({ maxFiles: 1 });
    const facts = await extractor.extractFromDirectory(tmpDir);
    const touchedFiles = new Set(facts.map((fact) => fact.file));

    expect(facts.length).toBeGreaterThan(0);
    expect(touchedFiles.size).toBeLessThanOrEqual(1);
  });
});
