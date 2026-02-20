import { describe, it, expect, vi } from 'vitest';
import type { ParserRegistry } from '../../agents/parser_registry.js';
import { extractPolyglotFunctionSymbolsFromFiles } from '../polyglot_symbol_extractor.js';

describe('extractPolyglotFunctionSymbolsFromFiles', () => {
  it('converts parser functions into SymbolEntry records', async () => {
    const parseFile = vi.fn((_filePath: string) => ({
      parser: 'tree-sitter-python',
      functions: [
        { name: 'build_index', signature: 'def build_index(root):', startLine: 3, endLine: 9, purpose: '' },
        { name: 'run', signature: 'def run():', startLine: 12, endLine: 20, purpose: '' },
      ],
      module: { exports: [], dependencies: [] },
    }));

    const parserRegistry = { parseFile } as unknown as ParserRegistry;
    const result = await extractPolyglotFunctionSymbolsFromFiles(
      ['/repo/src/indexer.py'],
      {
        parserRegistry,
        workspaceRoot: '/repo',
        readFile: async () => 'def build_index(root):\n  pass\n\ndef run():\n  pass\n',
      },
    );

    expect(result.filesProcessed).toBe(1);
    expect(result.filesWithErrors).toEqual([]);
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0]).toMatchObject({
      name: 'build_index',
      kind: 'function',
      file: '/repo/src/indexer.py',
      line: 3,
      endLine: 9,
      qualifiedName: 'src/indexer.py:build_index',
    });
  });

  it('skips TypeScript files to avoid overriding ts symbol extraction', async () => {
    const parseFile = vi.fn((_filePath: string) => ({
      parser: 'tree-sitter-python',
      functions: [{ name: 'handle', signature: 'def handle():', startLine: 1, endLine: 1, purpose: '' }],
      module: { exports: [], dependencies: [] },
    }));

    const parserRegistry = { parseFile } as unknown as ParserRegistry;
    const result = await extractPolyglotFunctionSymbolsFromFiles(
      ['/repo/src/server.ts', '/repo/src/tool.py'],
      {
        parserRegistry,
        readFile: async (filePath) => (filePath.endsWith('.py') ? 'def handle():\n  pass\n' : 'export function server() {}'),
      },
    );

    expect(result.filesProcessed).toBe(1);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]?.file).toBe('/repo/src/tool.py');
    expect(parseFile).toHaveBeenCalledTimes(1);
    expect(parseFile).toHaveBeenCalledWith('/repo/src/tool.py', expect.any(String));
  });

  it('fails closed on parser errors and ignores binary payloads', async () => {
    const parseFile = vi.fn((filePath: string) => {
      if (filePath.endsWith('.rb')) {
        throw new Error('parser unavailable');
      }
      return {
        parser: 'tree-sitter-python',
        functions: [{ name: 'ok', signature: 'def ok():', startLine: 1, endLine: 1, purpose: '' }],
        module: { exports: [], dependencies: [] },
      };
    });

    const parserRegistry = { parseFile } as unknown as ParserRegistry;
    const result = await extractPolyglotFunctionSymbolsFromFiles(
      ['/repo/src/fail.rb', '/repo/src/image.py'],
      {
        parserRegistry,
        readFile: async (filePath) => (filePath.endsWith('.py') ? '\u0000PNG' : 'def fail():\n  pass\n'),
      },
    );

    expect(result.filesWithErrors).toEqual(['/repo/src/fail.rb']);
    expect(result.filesProcessed).toBe(1);
    expect(result.symbols).toEqual([]);
    expect(parseFile).toHaveBeenCalledTimes(1);
  });
});
