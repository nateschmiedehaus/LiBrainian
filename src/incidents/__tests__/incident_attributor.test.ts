import { describe, expect, it, vi } from 'vitest';
import { createIncidentAttributor, type IndexedFunctionRange } from '../incident_attributor.js';

describe('incident_attributor', () => {
  it('attributes parsed stack frames to function ids end-to-end', async () => {
    const workspaceRoot = '/repo';
    const functionsByPath = new Map<string, IndexedFunctionRange[]>([
      [
        '/repo/src/a.ts',
        [
          { id: 'fn_a_1', startLine: 10, endLine: 20 },
          { id: 'fn_a_2', startLine: 25, endLine: 40 },
        ],
      ],
      [
        '/repo/src/b.ts',
        [
          { id: 'fn_b_1', startLine: 1, endLine: 10 },
        ],
      ],
    ]);

    const getFunctionsByPath = vi.fn(async (filePath: string) => functionsByPath.get(filePath) ?? []);
    const attributor = createIncidentAttributor({ workspaceRoot, getFunctionsByPath });

    const stackTrace = [
      'Error: boom',
      '    at doThing (/repo/src/a.ts:12:3)',
      '  File "/repo/src/a.ts", line 30, in python_handler',
      'src/b.ts:5',
      'https://example.com/remote.ts:2',
    ].join('\n');

    const report = await attributor.attributeIncident({ stackTrace });

    expect(report.frames).toHaveLength(3);
    expect(report.frames.map((frame) => frame.functionIds)).toEqual([
      ['fn_a_1'],
      ['fn_a_2'],
      ['fn_b_1'],
    ]);
    expect(report.functionIds).toEqual(['fn_a_1', 'fn_a_2', 'fn_b_1']);
    expect(report.summary).toEqual({
      parsedFrameCount: 4,
      normalizedFrameCount: 3,
      attributedFrameCount: 3,
      unattributedFrameCount: 0,
    });
  });
});
