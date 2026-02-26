import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type JsonRecord = Record<string, unknown>;

async function writeJson(filePath: string, value: JsonRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

describe('patrol post-process script', () => {
  it('creates actionable synthetic findings for timeout/no-observation runs', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-patrol-pp-'));
    const reportPath = path.join(workspace, 'patrol-run.json');
    const artifactPath = path.join(workspace, 'patrol-summary.json');
    const markdownPath = path.join(workspace, 'patrol-summary.md');

    await writeJson(reportPath, {
      kind: 'PatrolReport.v1',
      mode: 'release',
      createdAt: new Date().toISOString(),
      commitSha: 'abc1234',
      runs: [
        {
          repo: 'demo-repo',
          task: 'explore',
          observations: null,
          agentExitCode: 1,
          durationMs: 1234,
          timedOut: true,
          transcriptPath: 'state/patrol/transcripts/run-01-demo-explore.json',
        },
      ],
      aggregate: {
        meanNps: 0,
        wouldRecommendRate: 0,
        avgNegativeFindings: 0,
        implicitFallbackRate: 0,
        constructionCoverage: { exercised: 0 },
      },
      policy: {
        enforcement: 'blocked',
        reason: 'wet-testing policy fail-closed',
        requiredEvidenceMode: 'wet',
        observedEvidenceMode: 'none',
      },
    });

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'patrol-post-process.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--report',
        reportPath,
        '--artifact',
        artifactPath,
        '--markdown',
        markdownPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).toBe(0);
    const summary = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord;
    const findings = (summary.findings as JsonRecord[]) ?? [];
    const findingTitles = findings.map((f) => String(f.title ?? ''));
    expect(findingTitles).toContain('Patrol run timed out before producing observations');
    expect(findingTitles).toContain('Patrol policy gate blocked evidence quality');

    const timeoutFinding = findings.find((f) => f.title === 'Patrol run timed out before producing observations');
    expect(timeoutFinding).toBeTruthy();
    expect(timeoutFinding?.transcripts).toEqual(['state/patrol/transcripts/run-01-demo-explore.json']);

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('Patrol run timed out before producing observations');

    await rm(workspace, { recursive: true, force: true });
  });
});
