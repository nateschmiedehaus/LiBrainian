import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFunctionRangeMapper, type IndexedFunctionRange } from '../function_range_mapper.js';
import type { ParsedStackFrame } from '../stack_frame_parser.js';

describe('function_range_mapper', () => {
  const functionsByPath = new Map<string, IndexedFunctionRange[]>([
    [
      '/repo/src/a.ts',
      [
        { id: 'fn_2', startLine: 21, endLine: 40 },
        { id: 'fn_1', startLine: 10, endLine: 20 },
      ],
    ],
  ]);

  let getFunctionsByPath: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getFunctionsByPath = vi.fn(async (filePath: string) => functionsByPath.get(filePath) ?? []);
  });

  it('maps frame lines to overlapping function ids in deterministic order', async () => {
    const mapper = createFunctionRangeMapper({ getFunctionsByPath });

    const frames: ParsedStackFrame[] = [
      { raw: 'one', format: 'node', filePath: '/repo/src/a.ts', line: 12, column: 2 },
      { raw: 'two', format: 'python', filePath: '/repo/src/a.ts', line: 25, functionName: 'handler' },
      { raw: 'three', format: 'raw', filePath: '/repo/src/a.ts', line: 5 },
    ];

    const mapped = await mapper.mapFrames(frames);

    expect(mapped.map((entry) => entry.functionIds)).toEqual([
      ['fn_1'],
      ['fn_2'],
      [],
    ]);
  });

  it('caches function lookups per file path', async () => {
    const mapper = createFunctionRangeMapper({ getFunctionsByPath });

    const frames: ParsedStackFrame[] = [
      { raw: 'one', format: 'raw', filePath: '/repo/src/a.ts', line: 12 },
      { raw: 'two', format: 'raw', filePath: '/repo/src/a.ts', line: 22 },
    ];

    await mapper.mapFrames(frames);

    expect(getFunctionsByPath).toHaveBeenCalledTimes(1);
    expect(getFunctionsByPath).toHaveBeenCalledWith('/repo/src/a.ts');
  });
});
