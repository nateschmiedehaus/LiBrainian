import { describe, expect, it } from 'vitest';
import { findLingeringProcesses, parseProcessList } from '../process_guard.js';

describe('process guard helpers', () => {
  it('parses ps-style output', () => {
    const entries = parseProcessList([
      '1234 node ./node_modules/.bin/tsx src/cli/index.ts live-fire --json',
      '  99 /usr/libexec/some-daemon',
    ].join('\n'));
    expect(entries).toEqual([
      { pid: 1234, command: 'node ./node_modules/.bin/tsx src/cli/index.ts live-fire --json' },
      { pid: 99, command: '/usr/libexec/some-daemon' },
    ]);
  });

  it('finds lingering processes by command patterns with pid exclusions', () => {
    const entries = parseProcessList([
      '101 node ./node_modules/.bin/tsx src/cli/index.ts live-fire --json',
      '202 node ./node_modules/.bin/tsx src/cli/index.ts watch',
      '303 node ./node_modules/.bin/tsx src/cli/index.ts live-fire --json',
    ].join('\n'));
    const lingering = findLingeringProcesses({
      entries,
      includePatterns: ['src/cli/index.ts', 'live-fire'],
      excludePids: [303],
    });
    expect(lingering).toEqual([
      { pid: 101, command: 'node ./node_modules/.bin/tsx src/cli/index.ts live-fire --json' },
    ]);
  });
});
