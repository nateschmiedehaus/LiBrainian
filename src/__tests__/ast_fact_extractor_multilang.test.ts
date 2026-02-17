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
});
