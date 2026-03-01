import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { coverageCommand } from '../coverage.js';

describe('coverageCommand', () => {
  it('emits plain-language remediation reasons without unverified trace markers', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-coverage-'));
    const docsDir = path.join(workspace, 'docs', 'archive');
    await fs.mkdir(docsDir, { recursive: true });

    await fs.writeFile(
      path.join(docsDir, 'USE_CASE_MATRIX.md'),
      [
        '| UC ID | Description |',
        '| --- | --- |',
        '| UC-999 | Unmapped test case |',
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(docsDir, 'scenarios.md'),
      ['### S-COVERAGE-001', '', 'Placeholder scenario'].join('\n'),
      'utf8'
    );

    const outputRel = path.join('state', 'audits', 'coverage-test.json');
    await coverageCommand({
      workspace,
      args: ['--output', outputRel],
    });

    const outputPath = path.join(workspace, outputRel);
    const raw = await fs.readFile(outputPath, 'utf8');
    const report = JSON.parse(raw) as {
      entries: Array<{ evidence?: { reason?: string } }>;
    };
    const reason = report.entries[0]?.evidence?.reason ?? '';

    expect(reason).not.toContain('unverified_by_trace');
    expect(reason).toContain('Fix:');
  });
});
