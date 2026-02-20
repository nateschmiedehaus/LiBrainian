import { describe, expect, it, vi } from 'vitest';
import { AstIndexer, type AstIndexerOptions } from '../ast_indexer.js';
import type { ParserResult, ParserRegistry } from '../parser_registry.js';

describe('AstIndexer SCIP backend integration', () => {
  it('uses SCIP backend results before parser-registry fallback', async () => {
    const scipResult: ParserResult = {
      parser: 'scip-typescript',
      functions: [
        {
          name: 'fromScip',
          signature: 'fromScip(): number',
          startLine: 1,
          endLine: 1,
          purpose: 'from scip',
        },
      ],
      module: {
        exports: ['fromScip'],
        dependencies: ['lodash'],
      },
    };

    const scipBackend = {
      parseFile: vi.fn(async () => scipResult),
    };

    const throwingRegistry = {
      parseFile: vi.fn(() => {
        throw new Error('registry should not be called when SCIP is available');
      }),
    } as unknown as ParserRegistry;

    const indexer = new AstIndexer({
      registry: throwingRegistry,
      enableAnalysis: false,
      enableEmbeddings: false,
      scipBackend,
    } as AstIndexerOptions);

    const result = await indexer.indexFile('/tmp/example.ts', 'export function fromScip() { return 1; }');

    expect(scipBackend.parseFile).toHaveBeenCalledTimes(1);
    expect(result.parser).toBe('scip-typescript');
    expect(result.functions.some((fn) => fn.name === 'fromScip')).toBe(true);
    expect(result.module?.dependencies).toContain('lodash');
  });
});
