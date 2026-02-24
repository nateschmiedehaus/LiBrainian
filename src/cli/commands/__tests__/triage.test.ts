import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triageCommand } from '../triage.js';

function runGit(workspace: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`git ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
  return (result.stdout ?? '').trim();
}

async function createRepo(prefix: string, fileCount: number): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  runGit(workspace, ['init']);
  runGit(workspace, ['checkout', '-B', 'main']);
  runGit(workspace, ['config', 'user.email', 'tests@librainian.invalid']);
  runGit(workspace, ['config', 'user.name', 'LiBrainian Tests']);

  for (let index = 0; index < fileCount; index += 1) {
    const filePath = path.join(workspace, 'src', `file_${index}.ts`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `export const LibrarianSymbol${index} = "Librarian";\n`,
      'utf8',
    );
  }

  await fs.writeFile(path.join(workspace, 'package.json'), '{ "name": "triage-test" }\n', 'utf8');
  runGit(workspace, ['add', '.']);
  runGit(workspace, ['commit', '--no-gpg-sign', '-m', 'baseline']);
  return workspace;
}

async function modifyRenamePattern(workspace: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const filePath = path.join(workspace, 'src', `file_${index}.ts`);
    const content = await fs.readFile(filePath, 'utf8');
    await fs.writeFile(filePath, content.replaceAll('Librarian', 'LiBrainian'), 'utf8');
  }
}

describe('triageCommand', () => {
  const workspaces: string[] = [];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    process.exitCode = originalExitCode;
    for (const workspace of workspaces.splice(0)) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('produces a moderate-severity cluster report with deterministic bulk-rename detection', async () => {
    const workspace = await createRepo('librainian-triage-moderate-', 15);
    workspaces.push(workspace);

    await modifyRenamePattern(workspace, 11);
    await fs.writeFile(path.join(workspace, 'src', 'new_feature.ts'), 'export const feature = true;\n', 'utf8');

    await triageCommand({
      workspace,
      args: [],
      rawArgs: ['triage', '--json'],
    });

    const payloadText = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((line) => typeof line === 'string' && line.includes('"WorktreeTriageCli.v1"'));
    expect(payloadText).toBeTruthy();

    const payload = JSON.parse(String(payloadText)) as {
      report: {
        assessment: { severity: string; totalDirty: number };
        thresholdPolicy: { exceeded: boolean };
        clusters: Array<{ type: string; fileCount: number }>;
      };
    };
    expect(payload.report.assessment.severity).toBe('moderate');
    expect(payload.report.assessment.totalDirty).toBe(12);
    expect(payload.report.thresholdPolicy.exceeded).toBe(false);

    const renameCluster = payload.report.clusters.find((cluster) => cluster.type === 'bulk-rename');
    expect(renameCluster).toBeTruthy();
    expect(renameCluster?.fileCount).toBeGreaterThanOrEqual(10);
  });

  it('marks critical dirty state as blocked by threshold policy', async () => {
    const workspace = await createRepo('librainian-triage-critical-', 240);
    workspaces.push(workspace);

    await modifyRenamePattern(workspace, 205);

    await triageCommand({
      workspace,
      args: [],
      rawArgs: ['triage', '--json', '--threshold', '50'],
    });

    const payloadText = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((line) => typeof line === 'string' && line.includes('"WorktreeTriageCli.v1"'));
    expect(payloadText).toBeTruthy();

    const payload = JSON.parse(String(payloadText)) as {
      report: {
        assessment: { severity: string; totalDirty: number };
        thresholdPolicy: { exceeded: boolean; action: string };
        clusters: Array<{ type: string; fileCount: number }>;
      };
    };
    expect(payload.report.assessment.totalDirty).toBe(205);
    expect(payload.report.assessment.severity).toBe('critical');
    expect(payload.report.thresholdPolicy.exceeded).toBe(true);
    expect(payload.report.thresholdPolicy.action).toBe('block');
    expect(process.exitCode).toBe(2);

    const renameCluster = payload.report.clusters.find((cluster) => cluster.type === 'bulk-rename');
    expect(renameCluster).toBeTruthy();
    expect(renameCluster?.fileCount).toBeGreaterThanOrEqual(200);
  });
});
