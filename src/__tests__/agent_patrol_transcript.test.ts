import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeRunTranscript } from '../../scripts/agent-patrol.mjs';

describe('agent patrol transcripts', () => {
  it('writes per-run transcript artifacts with key run metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'librarian-patrol-transcript-'));
    const transcriptDir = path.join(root, 'state', 'patrol', 'transcripts');

    const transcriptRelativePath = await writeRunTranscript({
      transcriptDir,
      runIndex: 0,
      repoName: 'sample-repo',
      taskVariant: 'explore',
      prompt: 'Test prompt for transcript',
      result: {
        exitCode: 0,
        timedOut: false,
        error: null,
        stdout: 'agent output',
        stderr: '',
      },
      observations: {
        overallVerdict: { npsScore: 8 },
      },
      implicitSignals: {
        usedGrepInstead: false,
      },
      error: null,
      sandboxDir: '/tmp/sandbox',
    });

    const transcriptAbsolutePath = path.resolve(process.cwd(), transcriptRelativePath);
    const transcript = JSON.parse(await readFile(transcriptAbsolutePath, 'utf8')) as Record<string, unknown>;

    expect(transcript.kind).toBe('PatrolRunTranscript.v1');
    expect(transcript.repo).toBe('sample-repo');
    expect(transcript.task).toBe('explore');
    expect((transcript.result as Record<string, unknown>).exitCode).toBe(0);
    expect((transcript.result as Record<string, unknown>).stdout).toContain('agent output');
    expect((transcript.observations as Record<string, unknown>).overallVerdict).toBeTruthy();

    await rm(root, { recursive: true, force: true });
  });
});
