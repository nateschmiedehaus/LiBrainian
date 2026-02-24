import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSandboxLifecycleConstruction,
  createAgentDispatchConstruction,
  createObservationExtractionConstruction,
  createImplicitSignalConstruction,
  createCostControlConstruction,
  createAggregationConstruction,
} from '../index.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('patrol primitives', () => {
  it('SandboxLifecycle creates isolated copy sandbox and preserves source files', async () => {
    const sourceDir = await makeTempDir('librarian-patrol-source-');
    const sandboxRoot = await makeTempDir('librarian-patrol-sandboxes-');
    const filePath = path.join(sourceDir, 'sample.txt');

    await fs.writeFile(filePath, 'hello patrol', 'utf8');

    const sandbox = createSandboxLifecycleConstruction();
    const output = unwrapConstructionExecutionResult(
      await sandbox.execute({
        repoPath: sourceDir,
        mode: 'copy',
        sandboxRoot,
      }),
    );

    expect(output.created).toBe(true);
    expect(output.mode).toBe('copy');
    expect(output.sandboxPath).not.toBe(sourceDir);

    const copied = await fs.readFile(path.join(output.sandboxPath, 'sample.txt'), 'utf8');
    expect(copied).toBe('hello patrol');
  });

  it('SandboxLifecycle supports reuse mode without creating a new sandbox', async () => {
    const sourceDir = await makeTempDir('librarian-patrol-reuse-');
    const sandbox = createSandboxLifecycleConstruction();

    const output = unwrapConstructionExecutionResult(
      await sandbox.execute({
        repoPath: sourceDir,
        mode: 'reuse',
      }),
    );

    expect(output.created).toBe(false);
    expect(output.sandboxPath).toBe(path.resolve(sourceDir));
    expect(output.cleanupOnExit).toBe(false);
  });

  it('AgentDispatch executes command and captures structured output', async () => {
    const dispatch = createAgentDispatchConstruction();

    const output = unwrapConstructionExecutionResult(
      await dispatch.execute({
        command: process.execPath,
        args: ['-e', "process.stdout.write('ok'); process.stderr.write('warn');"],
      }),
    );

    expect(output.exitCode).toBe(0);
    expect(output.timedOut).toBe(false);
    expect(output.stdout).toContain('ok');
    expect(output.stderr).toContain('warn');
    expect(output.commandLine).toContain(process.execPath);
  });

  it('AgentDispatch enforces timeout budget', async () => {
    const dispatch = createAgentDispatchConstruction();

    const output = unwrapConstructionExecutionResult(
      await dispatch.execute({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 1000);'],
        timeoutMs: 25,
      }),
    );

    expect(output.timedOut).toBe(true);
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('ObservationExtractor parses incremental lines and full observation block', async () => {
    const extractor = createObservationExtractionConstruction();
    const output = [
      'PATROL_OBS: {"kind":"finding","severity":"high"}',
      'PATROL_OBSERVATION_JSON_START',
      '{"overallVerdict":{"npsScore":8,"wouldRecommend":true}}',
      'PATROL_OBSERVATION_JSON_END',
    ].join('\n');

    const result = unwrapConstructionExecutionResult(await extractor.execute({ output }));

    expect(result.incrementalObservations).toHaveLength(1);
    expect(result.incrementalObservations[0]?.kind).toBe('finding');
    expect(result.fullObservation?.overallVerdict).toBeTruthy();
    expect(result.parseWarnings).toHaveLength(0);
  });

  it('ObservationExtractor returns parse warnings for malformed observation JSON', async () => {
    const extractor = createObservationExtractionConstruction();
    const output = 'PATROL_OBS: {bad-json}';

    const result = unwrapConstructionExecutionResult(await extractor.execute({ output }));

    expect(result.incrementalObservations).toHaveLength(0);
    expect(result.parseWarnings.length).toBeGreaterThan(0);
  });

  it('ImplicitSignalDetector infers fallback patterns and command failures', async () => {
    const detector = createImplicitSignalConstruction();

    const signals = unwrapConstructionExecutionResult(
      await detector.execute({
        stdout: 'used rg -n and cat file.ts for investigation',
        stderr: 'command not found',
        exitCode: 1,
        durationMs: 100,
        timeoutMs: 200,
      }),
    );

    expect(signals.fellBackToGrep).toBe(true);
    expect(signals.catInsteadOfContext).toBe(true);
    expect(signals.commandsFailed).toBeGreaterThan(0);
    expect(signals.abortedEarly).toBe(true);
    expect(signals.stderrAnomalies).toContain('stderr_present');
  });

  it('CostController blocks execution when usage exceeds budget', async () => {
    const controller = createCostControlConstruction();

    const decision = unwrapConstructionExecutionResult(
      await controller.execute({
        budget: {
          maxDurationMs: 10,
          maxTokens: 100,
          maxUsd: 0.1,
        },
        usage: {
          durationMs: 20,
          tokens: 101,
          usd: 0.2,
        },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.breaches).toHaveLength(3);
  });

  it('Aggregator merges patrol runs into rollup metrics', async () => {
    const aggregator = createAggregationConstruction();

    const result = unwrapConstructionExecutionResult(
      await aggregator.execute({
        runs: [
          {
            observations: {
              overallVerdict: { npsScore: 8, wouldRecommend: true },
              negativeFindingsMandatory: [{ category: 'process', severity: 'medium' }],
            },
            implicitSignals: { commandsFailed: 0 },
          },
          {
            observations: {
              overallVerdict: { npsScore: 6, wouldRecommend: false },
              negativeFindingsMandatory: [
                { category: 'quality', severity: 'high' },
                { category: 'coverage', severity: 'medium' },
              ],
            },
            implicitSignals: { commandsFailed: 2 },
          },
        ],
      }),
    );

    expect(result.runCount).toBe(2);
    expect(result.meanNps).toBe(7);
    expect(result.wouldRecommendRate).toBe(0.5);
    expect(result.avgNegativeFindings).toBe(1.5);
    expect(result.implicitFallbackRate).toBe(0.5);
  });
});
