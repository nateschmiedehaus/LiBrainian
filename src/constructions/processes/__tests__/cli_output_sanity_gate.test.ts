import { describe, expect, it } from 'vitest';
import { createCliOutputSanityGateConstruction } from '../cli_output_sanity_gate.js';

describe('CLI Output Sanity Gate', () => {
  it('validates CLI output quality, exit-code behavior, and help consistency', async () => {
    const gate = createCliOutputSanityGateConstruction();
    const result = await gate.execute({
      registeredCommands: ['help', 'status', 'query', 'features'],
      commandTimeoutMs: 20_000,
      maxDurationMs: 120_000,
    });

    expect(result.kind).toBe('CliOutputSanityGateResult.v1');
    expect(result.commandCount).toBeGreaterThanOrEqual(6);
    expect(result.commandResults.length).toBe(result.commandCount);
    expect(result.helpValidation.listedCommands.length).toBeGreaterThan(0);
    expect(result.helpValidation.listedCommands).toContain('query');
    expect(result.helpValidation.listedCommands).toContain('status');

    const unknownCommand = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'definitely-not-a-command',
    );
    expect(unknownCommand?.exitCode).not.toBe(0);

    const statusJson = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'status --json',
    );
    expect(statusJson?.parseableJson).toBe(true);

    expect(result.snapshots.globalHelpHead.length).toBeGreaterThan(0);
    expect(result.snapshots.queryHelpHead.length).toBeGreaterThan(0);
    expect(result.snapshots.statusJsonKeys.length).toBeGreaterThan(0);
  }, 140_000);
});
