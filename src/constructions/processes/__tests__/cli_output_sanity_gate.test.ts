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
    expect(unknownCommand?.hasSingleLineError).toBe(true);
    expect(unknownCommand?.hasActionableError).toBe(true);

    const configSubcommandError = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'config definitely-not-a-subcommand',
    );
    expect(configSubcommandError?.exitCode).not.toBe(0);
    expect(configSubcommandError?.hasSingleLineError).toBe(true);
    expect(configSubcommandError?.hasActionableError).toBe(true);

    const replayError = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'replay',
    );
    expect(replayError?.exitCode).not.toBe(0);
    expect(replayError?.hasSingleLineError).toBe(true);
    expect(replayError?.hasActionableError).toBe(true);

    const replayDebugError = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'replay --debug',
    );
    expect(replayDebugError?.exitCode).not.toBe(0);
    expect((replayDebugError?.errorLineCount ?? 0) >= 2).toBe(true);

    const statusJson = result.commandResults.find(
      (probe) => probe.args.join(' ') === 'status --json',
    );
    expect(statusJson?.parseableJson).toBe(true);

    expect(result.snapshots.globalHelpHead.length).toBeGreaterThan(0);
    expect(result.snapshots.queryHelpHead.length).toBeGreaterThan(0);
    expect(result.snapshots.statusJsonKeys.length).toBeGreaterThan(0);
  }, 140_000);
});
