import { describe, expect, it, vi } from 'vitest';
import { AstIndexer } from '../ast_indexer.js';
import type { ParserResult } from '../parser_registry.js';

describe('AstIndexer behavioral fingerprinting', () => {
  it('derives purity and side-effect flags from function bodies', async () => {
    const content = [
      'export function pureAdd(a: number, b: number) {',
      '  return a + b;',
      '}',
      '',
      'export function impureAssign(list: number[]) {',
      '  list.push(1);',
      '  return list.length;',
      '}',
      '',
      'export function explode(message: string) {',
      '  throw new Error(message);',
      '}',
      '',
    ].join('\n');

    const parserResult: ParserResult = {
      parser: 'ts-morph',
      functions: [
        { name: 'pureAdd', signature: 'export function pureAdd(a: number, b: number)', startLine: 1, endLine: 3, purpose: '' },
        { name: 'impureAssign', signature: 'export function impureAssign(list: number[])', startLine: 5, endLine: 8, purpose: '' },
        { name: 'explode', signature: 'export function explode(message: string)', startLine: 10, endLine: 12, purpose: '' },
      ],
      module: { exports: ['pureAdd', 'impureAssign', 'explode'], dependencies: [] },
    };

    const indexer = new AstIndexer({
      registry: { parseFile: vi.fn(() => parserResult) } as any,
      enableAnalysis: false,
      enableEmbeddings: false,
    });

    const result = await indexer.indexFile('/virtual/behavior.ts', content);
    const byName = new Map(result.functions.map((fn) => [fn.name, fn]));

    const pureAdd = byName.get('pureAdd');
    expect(pureAdd?.isPure).toBe(true);
    expect(pureAdd?.hasSideEffects).toBe(false);
    expect(pureAdd?.modifiesParams).toBe(false);
    expect(pureAdd?.throws).toBe(false);
    expect(pureAdd?.returnDependsOnInputs).toBe(true);

    const impureAssign = byName.get('impureAssign');
    expect(impureAssign?.isPure).toBe(false);
    expect(impureAssign?.hasSideEffects).toBe(true);
    expect(impureAssign?.modifiesParams).toBe(true);
    expect(impureAssign?.throws).toBe(false);

    const explode = byName.get('explode');
    expect(explode?.isPure).toBe(false);
    expect(explode?.hasSideEffects).toBe(true);
    expect(explode?.throws).toBe(true);
  });

  it('keeps purity false-negative rate below 10% on a known-pure set', async () => {
    const lines: string[] = [];
    const functions: ParserResult['functions'] = [];

    for (let i = 0; i < 10; i += 1) {
      const line = i + 1;
      const name = `pure_${i}`;
      lines.push(`export function ${name}(value: number) { return value + ${i}; }`);
      functions.push({
        name,
        signature: `export function ${name}(value: number)`,
        startLine: line,
        endLine: line,
        purpose: '',
      });
    }

    const parserResult: ParserResult = {
      parser: 'ts-morph',
      functions,
      module: { exports: functions.map((fn) => fn.name), dependencies: [] },
    };

    const indexer = new AstIndexer({
      registry: { parseFile: vi.fn(() => parserResult) } as any,
      enableAnalysis: false,
      enableEmbeddings: false,
    });

    const result = await indexer.indexFile('/virtual/pure-set.ts', lines.join('\n'));
    const pureDetected = result.functions.filter((fn) => fn.isPure === true).length;
    const falseNegativeRate = (result.functions.length - pureDetected) / result.functions.length;

    expect(falseNegativeRate).toBeLessThan(0.1);
  });
});
