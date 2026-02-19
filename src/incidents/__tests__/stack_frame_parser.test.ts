import { describe, expect, it } from 'vitest';
import { parseStackFrameLine, parseStackTrace } from '../stack_frame_parser.js';

describe('stack_frame_parser', () => {
  it('parses Node.js stack frames with function and column', () => {
    const frame = parseStackFrameLine('    at doThing (/repo/src/a.ts:27:9)');

    expect(frame).toEqual({
      raw: '    at doThing (/repo/src/a.ts:27:9)',
      format: 'node',
      filePath: '/repo/src/a.ts',
      line: 27,
      column: 9,
      functionName: 'doThing',
    });
  });

  it('parses Python stack frames', () => {
    const frame = parseStackFrameLine('  File "/repo/app/main.py", line 44, in handle_request');

    expect(frame).toEqual({
      raw: '  File "/repo/app/main.py", line 44, in handle_request',
      format: 'python',
      filePath: '/repo/app/main.py',
      line: 44,
      functionName: 'handle_request',
    });
  });

  it('parses raw file:line frames', () => {
    const frame = parseStackFrameLine('src/module.ts:12');

    expect(frame).toEqual({
      raw: 'src/module.ts:12',
      format: 'raw',
      filePath: 'src/module.ts',
      line: 12,
    });
  });

  it('returns null for non-frame lines', () => {
    expect(parseStackFrameLine('Error: something exploded')).toBeNull();
  });

  it('parses multiple frame styles from a single trace deterministically', () => {
    const trace = [
      'Error: failure',
      '    at doThing (/repo/src/a.ts:27:9)',
      '  File "/repo/app/main.py", line 44, in handle_request',
      'src/module.ts:12',
      'Caused by: nope',
    ].join('\n');

    const frames = parseStackTrace(trace);

    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.format)).toEqual(['node', 'python', 'raw']);
    expect(frames.map((frame) => frame.line)).toEqual([27, 44, 12]);
  });
});
