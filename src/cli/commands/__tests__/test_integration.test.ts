import { describe, expect, it, vi } from 'vitest';
import { testIntegrationCommand } from '../test_integration.js';

describe('testIntegrationCommand', () => {
  it('runs the openclaw suite and emits JSON output', async () => {
    const outputs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => {
      outputs.push(typeof value === 'string' ? value : String(value));
    });
    try {
      await testIntegrationCommand({
        workspace: process.cwd(),
        args: [],
        rawArgs: ['test-integration', '--suite', 'openclaw', '--json'],
      });
    } finally {
      logSpy.mockRestore();
    }

    const payload = outputs.find((entry) => entry.includes('OpenclawIntegrationSuite.v1'));

    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.summary.total).toBe(6);
    expect(parsed.summary.failing).toBe(0);
  });
});
