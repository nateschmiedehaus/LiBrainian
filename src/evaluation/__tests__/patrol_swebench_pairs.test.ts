import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generatePatrolTestPairs,
  materializePatrolTestPairs,
  runPatrolSwebenchHarness,
  type PatrolFindingDescriptor,
  type PatrolTestPair,
} from '../patrol_swebench_pairs.js';

function runGit(repoRoot: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

describe('patrol_swebench_pairs', () => {
  it('auto-generates template-specific FAIL_TO_PASS and PASS_TO_PASS specs from finding descriptions', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'patrol-pairs-generate-'));
    try {
      await mkdir(path.join(repoRoot, 'src/cli/__tests__'), { recursive: true });
      await mkdir(path.join(repoRoot, 'src/cli/commands/__tests__'), { recursive: true });
      await mkdir(path.join(repoRoot, 'src/mcp/__tests__'), { recursive: true });
      await mkdir(path.join(repoRoot, 'src/constructions/processes/__tests__'), { recursive: true });
      await writeFile(path.join(repoRoot, 'src/cli/__tests__/errors.test.ts'), '// fixture\n', 'utf8');
      await writeFile(path.join(repoRoot, 'src/cli/commands/__tests__/capabilities.test.ts'), '// fixture\n', 'utf8');
      await writeFile(path.join(repoRoot, 'src/mcp/__tests__/list_capabilities.test.ts'), '// fixture\n', 'utf8');
      await writeFile(
        path.join(repoRoot, 'src/constructions/processes/__tests__/result_quality_judge.test.ts'),
        '// fixture\n',
        'utf8',
      );
      await writeFile(
        path.join(repoRoot, 'src/constructions/processes/__tests__/query_relevance_gate.test.ts'),
        '// fixture\n',
        'utf8',
      );
      await writeFile(
        path.join(repoRoot, 'src/constructions/processes/__tests__/unit_patrol.test.ts'),
        '// fixture\n',
        'utf8',
      );

      const findings: PatrolFindingDescriptor[] = [
        {
          issueNumber: 593,
          title: 'CLI error envelope formatting',
          description: 'single-line error behavior and --debug diagnostics',
          preFixRef: 'deadbeef',
        },
        {
          issueNumber: 598,
          title: 'Capability inventory discovery',
          description: 'machine-readable capability inventory via CLI and MCP',
          preFixRef: 'deadbeef',
        },
        {
          issueNumber: 601,
          title: 'ResultQualityJudge',
          description: 'relevance completeness actionability accuracy thresholds',
          preFixRef: 'deadbeef',
        },
      ];

      const pairs = await generatePatrolTestPairs(findings, repoRoot);
      expect(pairs).toHaveLength(3);

      const cliPair = pairs.find((pair) => pair.issueNumber === 593);
      expect(cliPair?.template).toBe('cli_error_envelope');
      expect((cliPair?.passToPassTests.length ?? 0) > 0).toBe(true);

      const capabilityPair = pairs.find((pair) => pair.issueNumber === 598);
      expect(capabilityPair?.template).toBe('capability_inventory');
      expect((capabilityPair?.passToPassTests.length ?? 0) > 0).toBe(true);

      const qualityPair = pairs.find((pair) => pair.issueNumber === 601);
      expect(qualityPair?.template).toBe('result_quality_judge');
      expect((qualityPair?.passToPassTests.length ?? 0) > 0).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('materializes generated patrol test pairs into eval corpus artifact', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'patrol-pairs-materialize-'));
    try {
      await mkdir(path.join(repoRoot, 'eval-corpus/patrol-test-pairs'), { recursive: true });
      await mkdir(path.join(repoRoot, 'src/constructions/processes/__tests__'), { recursive: true });
      await writeFile(
        path.join(repoRoot, 'src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts'),
        '// fixture\n',
        'utf8',
      );
      await writeFile(
        path.join(repoRoot, 'src/constructions/processes/__tests__/unit_patrol.test.ts'),
        '// fixture\n',
        'utf8',
      );

      const corpusPath = path.join(repoRoot, 'eval-corpus/patrol-test-pairs/findings.json');
      await writeFile(
        corpusPath,
        `${JSON.stringify(
          {
            schema: 'PatrolFindingCorpus.v1',
            findings: [
              {
                issueNumber: 600,
                title: 'Regression closure gate',
                description: 'generic fallback patrol check',
                preFixRef: 'deadbeef',
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const outputPath = path.join(repoRoot, 'eval-corpus/patrol-test-pairs/pairs.generated.json');
      const artifact = await materializePatrolTestPairs({
        repoRoot,
        corpusPath,
        outputPath,
      });

      expect(artifact.schema).toBe('PatrolTestPairCorpus.v1');
      expect(artifact.pairCount).toBe(1);
      expect(artifact.outputPath).toBe(outputPath);

      const written = JSON.parse(await readFile(outputPath, 'utf8')) as { schema: string; pairCount: number };
      expect(written.schema).toBe('PatrolTestPairCorpus.v1');
      expect(written.pairCount).toBe(1);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('runs FAIL_TO_PASS + PASS_TO_PASS harness and reports resolve rate', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'patrol-pairs-harness-'));
    try {
      await mkdir(path.join(repoRoot, 'src'), { recursive: true });
      await writeFile(path.join(repoRoot, 'src/feature.ts'), "export const marker = 'old';\n", 'utf8');
      await writeFile(path.join(repoRoot, 'src/feature.test.ts'), '// pass_to_pass fixture\n', 'utf8');

      runGit(repoRoot, 'init');
      runGit(repoRoot, 'config', 'user.email', 'patrol@example.com');
      runGit(repoRoot, 'config', 'user.name', 'Patrol Test');
      runGit(repoRoot, 'add', '.');
      runGit(repoRoot, 'commit', '-m', 'pre-fix');
      const preFixRef = runGit(repoRoot, 'rev-parse', 'HEAD');

      await writeFile(path.join(repoRoot, 'src/feature.ts'), "export const marker = 'old';\n// NEW_LOGIC\n", 'utf8');
      await writeFile(path.join(repoRoot, 'verification.ok'), 'ok\n', 'utf8');

      const pairs: PatrolTestPair[] = [
        {
          id: 'issue-999-new-logic',
          issueNumber: 999,
          template: 'generic',
          title: 'Fixture pair',
          description: 'Fixture pair for harness test',
          failToPass: {
            generatedFrom: 'fixture',
            preFixRef,
            preFixCheck: {
              filePath: 'src/feature.ts',
              pattern: 'NEW_LOGIC',
              shouldMatch: false,
            },
            postFixCheck: {
              filePath: 'src/feature.ts',
              pattern: 'NEW_LOGIC',
              shouldMatch: true,
            },
            postFixVerificationCommand: 'test -f verification.ok',
          },
          passToPassTests: ['src/feature.test.ts'],
        },
      ];

      const result = await runPatrolSwebenchHarness(pairs, {
        repoRoot,
        executeVerificationCommands: true,
        verificationTimeoutMs: 10_000,
      });

      expect(result.kind).toBe('PatrolSwebenchHarnessResult.v1');
      expect(result.pass).toBe(true);
      expect(result.pairCount).toBe(1);
      expect(result.resolvedCount).toBe(1);
      expect(result.resolveRate).toBe(1);
      expect(result.evaluations[0]?.verificationExecuted).toBe(true);
      expect(result.evaluations[0]?.verificationPassed).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
