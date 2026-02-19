import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFunctionRangeMapper,
  type FileLineRange,
} from '../function_range_mapper.js';

describe('FunctionRangeMapper', () => {
  const workspaceRoot = '/repo';
  const functionsByPath = new Map<string, Array<{ id: string; startLine: number; endLine: number }>>([
    [
      '/repo/src/a.ts',
      [
        { id: 'fn_a_1', startLine: 10, endLine: 20 },
        { id: 'fn_a_2', startLine: 25, endLine: 40 },
        { id: 'fn_a_3', startLine: 45, endLine: 60 },
      ],
    ],
    [
      '/repo/src/b.ts',
      [
        { id: 'fn_b_1', startLine: 5, endLine: 15 },
      ],
    ],
  ]);

  let storage: { getFunctionsByPath: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    storage = {
      getFunctionsByPath: vi.fn(async (filePath: string) => {
        const matches = functionsByPath.get(filePath) ?? [];
        return matches.map((entry) => ({
          id: entry.id,
          filePath,
          name: entry.id,
          signature: '',
          purpose: '',
          startLine: entry.startLine,
          endLine: entry.endLine,
          confidence: 1,
          accessCount: 0,
          lastAccessed: null,
          validationCount: 0,
          outcomeHistory: { successes: 0, failures: 0 },
        }));
      }),
    };
  });

  function toIds(ranges: Array<{ functionIds: string[] }>): string[][] {
    return ranges.map((range) => range.functionIds);
  }

  it('resolves exact and partial overlaps from explicit ranges', async () => {
    const mapper = createFunctionRangeMapper({ storage: storage as any, workspaceRoot });
    const ranges: FileLineRange[] = [
      { filePath: 'src/a.ts', startLine: 12, endLine: 12 },
      { filePath: 'src/a.ts', startLine: 20, endLine: 25 },
      { filePath: 'src/a.ts', startLine: 15, endLine: 50 },
      { filePath: 'src/a.ts', startLine: 1, endLine: 5 },
    ];

    const result = await mapper.resolve({ type: 'explicit', ranges });

    expect(toIds(result)).toEqual([
      ['fn_a_1'],
      ['fn_a_1', 'fn_a_2'],
      ['fn_a_1', 'fn_a_2', 'fn_a_3'],
      [],
    ]);
  });

  it('parses git-diff and pr-diff hunk ranges', async () => {
    const mapper = createFunctionRangeMapper({ storage: storage as any, workspaceRoot });
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -24,0 +26,3 @@',
      '+const x = 1;',
      '+const y = 2;',
      '+const z = 3;',
    ].join('\n');

    const diffResult = await mapper.resolve({ type: 'git-diff', diff: patch });
    const prResult = await mapper.resolve({ type: 'pr-diff', patch });

    expect(diffResult).toHaveLength(1);
    expect(prResult).toHaveLength(1);
    expect(diffResult[0]?.functionIds).toEqual(['fn_a_2']);
    expect(prResult[0]?.functionIds).toEqual(['fn_a_2']);
  });

  it('parses stack traces in node, python, and raw file:line formats', async () => {
    const mapper = createFunctionRangeMapper({ storage: storage as any, workspaceRoot });
    const raw = [
      'at doThing (/repo/src/a.ts:27:9)',
      'File "/repo/src/a.ts", line 11, in handler',
      '/repo/src/a.ts:47',
    ].join('\n');

    const result = await mapper.resolve({ type: 'stack-trace', raw });

    expect(result).toHaveLength(3);
    expect(toIds(result)).toEqual([
      ['fn_a_2'],
      ['fn_a_1'],
      ['fn_a_3'],
    ]);
  });

  it('maps git-blame file source to all functions in the file', async () => {
    const mapper = createFunctionRangeMapper({ storage: storage as any, workspaceRoot });
    const result = await mapper.resolve({ type: 'git-blame', filePath: 'src/a.ts' });

    expect(result).toHaveLength(1);
    expect(result[0]?.functionIds).toEqual(['fn_a_1', 'fn_a_2', 'fn_a_3']);
  });

  it('caches per-file function index across calls', async () => {
    const mapper = createFunctionRangeMapper({ storage: storage as any, workspaceRoot });

    await mapper.resolve({
      type: 'explicit',
      ranges: [
        { filePath: 'src/a.ts', startLine: 12, endLine: 12 },
        { filePath: 'src/a.ts', startLine: 30, endLine: 30 },
      ],
    });
    await mapper.resolve({
      type: 'explicit',
      ranges: [
        { filePath: 'src/a.ts', startLine: 45, endLine: 45 },
      ],
    });

    expect(storage.getFunctionsByPath).toHaveBeenCalledTimes(1);
  });
});
