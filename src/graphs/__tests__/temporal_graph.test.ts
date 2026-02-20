import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { buildTemporalGraph } from '../temporal_graph.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class MockReadable extends EventEmitter {
  setEncoding(_encoding: string): this {
    return this;
  }
}

class MockChildProcess extends EventEmitter {
  stdout = new MockReadable();
  stderr = new MockReadable();
  kill = vi.fn(() => true);
}

describe('temporal_graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds co-change edges from git log output asynchronously', async () => {
    const child = new MockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as any);

    setTimeout(() => {
      child.stdout.emit('data', [
        'abc1234',
        'src/a.ts',
        'src/b.ts',
        '',
        'def5678',
        'src/b.ts',
        'src/c.ts',
        '',
      ].join('\n'));
      child.emit('close', 0);
    }, 0);

    const graph = await buildTemporalGraph('/tmp/workspace', { maxCommits: 50 });

    expect(graph.commitCount).toBe(2);
    expect(graph.latestCommitSha).toBe('abc1234');
    expect(graph.fileChangeCounts['src/a.ts']).toBe(1);
    expect(graph.fileChangeCounts['src/b.ts']).toBe(2);
    expect(graph.fileChangeCounts['src/c.ts']).toBe(1);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileA: 'src/a.ts', fileB: 'src/b.ts', changeCount: 1, strength: 0.5 }),
      expect.objectContaining({ fileA: 'src/b.ts', fileB: 'src/c.ts', changeCount: 1, strength: 0.5 }),
    ]));
  });

  it('returns an empty graph when git exits with error', async () => {
    const child = new MockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as any);

    setTimeout(() => child.emit('close', 1), 0);

    const graph = await buildTemporalGraph('/tmp/workspace');
    expect(graph).toEqual({ edges: [], commitCount: 0, fileChangeCounts: {}, latestCommitSha: null });
  });

  it('supports cancellation via AbortSignal', async () => {
    const child = new MockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as any);

    const controller = new AbortController();
    const promise = buildTemporalGraph('/tmp/workspace', { signal: controller.signal });
    controller.abort();

    const graph = await promise;
    expect(graph).toEqual({ edges: [], commitCount: 0, fileChangeCounts: {}, latestCommitSha: null });
    expect(child.kill).toHaveBeenCalled();
  });

  it('supports incremental commit ranges via sinceCommitExclusive', async () => {
    const child = new MockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as any);

    setTimeout(() => {
      child.stdout.emit('data', [
        'feedbeef',
        'src/new_a.ts',
        'src/new_b.ts',
        '',
      ].join('\n'));
      child.emit('close', 0);
    }, 0);

    const graph = await buildTemporalGraph('/tmp/workspace', {
      maxCommits: 2000,
      sinceCommitExclusive: 'deadbeef',
    });

    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['log', '--name-only', '--pretty=format:%H', '-n', '2000', 'deadbeef..HEAD'],
      expect.objectContaining({ cwd: '/tmp/workspace' })
    );
    expect(graph.commitCount).toBe(1);
    expect(graph.latestCommitSha).toBe('feedbeef');
    expect(graph.edges).toEqual([
      expect.objectContaining({ fileA: 'src/new_a.ts', fileB: 'src/new_b.ts', changeCount: 1 }),
    ]);
  });
});
