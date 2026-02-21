import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { composeCommand } from '../compose.js';
import { LiBrainian } from '../../../api/librarian.js';
import { composeConstructions } from '../../../constructions/lego_pipeline.js';

vi.mock('../../../api/librarian.js');
vi.mock('../../../constructions/lego_pipeline.js', () => ({
  composeConstructions: vi.fn().mockResolvedValue({
    mode: 'constructions',
    executed: ['knowledge', 'refactoring', 'security'],
    findings: [],
    recommendations: [],
    confidence: { type: 'deterministic', value: 0.8 },
  }),
}));

describe('composeCommand', () => {
  const mockWorkspace = '/test/workspace';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockLiBrainian: {
    initialize: Mock;
    compileTechniqueBundlesFromIntent: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockLiBrainian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      compileTechniqueBundlesFromIntent: vi.fn().mockResolvedValue([
        {
          template: { id: 'wt_tc_release_readiness' },
          primitives: [{ id: 'tp_release_plan' }],
          missingPrimitiveIds: [],
        },
      ]),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (LiBrainian as unknown as Mock).mockImplementation(() => mockLiBrainian);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('prints bundles as JSON', async () => {
    await composeCommand({
      workspace: mockWorkspace,
      args: ['release', 'plan'],
      rawArgs: ['compose', 'release', 'plan'],
    });

    expect(composeConstructions).toHaveBeenCalledWith(mockLiBrainian, 'release plan');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"executed"'));
  });

  it('passes includePrimitives and limit in techniques mode', async () => {
    await composeCommand({
      workspace: mockWorkspace,
      args: ['release', 'plan'],
      rawArgs: ['compose', 'release', 'plan', '--mode', 'techniques', '--limit', '1', '--include-primitives', '--pretty'],
    });

    expect(mockLiBrainian.compileTechniqueBundlesFromIntent).toHaveBeenCalledWith(
      'release plan',
      expect.objectContaining({ includePrimitives: true, limit: 1 })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\n'));
  });

  it('throws for invalid limit', async () => {
    await expect(
      composeCommand({
        workspace: mockWorkspace,
        args: ['release', 'plan'],
        rawArgs: ['compose', 'release', 'plan', '--limit', '-1'],
      })
    ).rejects.toThrow('Limit must be a positive integer');
  });

  it('throws for invalid mode', async () => {
    await expect(
      composeCommand({
        workspace: mockWorkspace,
        args: ['release', 'plan'],
        rawArgs: ['compose', 'release', 'plan', '--mode', 'invalid'],
      })
    ).rejects.toThrow('Invalid mode');
  });

  it('supports timeout and fails cleanly when compose exceeds it', async () => {
    (composeConstructions as unknown as Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
    );

    await expect(
      composeCommand({
        workspace: mockWorkspace,
        args: ['release', 'plan'],
        rawArgs: ['compose', 'release', 'plan', '--timeout', '10'],
      })
    ).rejects.toThrow('timed out');
  });

  it('emits periodic progress while compose is running', async () => {
    (composeConstructions as unknown as Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1200))
    );

    await composeCommand({
      workspace: mockWorkspace,
      args: ['release', 'plan'],
      rawArgs: ['compose', 'release', 'plan', '--timeout', '5000'],
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[compose] progress'));
  });

  it('emits verbose stage logs with --verbose', async () => {
    await composeCommand({
      workspace: mockWorkspace,
      args: ['release', 'plan'],
      rawArgs: ['compose', 'release', 'plan', '--verbose'],
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[compose] init:start'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[compose] compose:start'));
  });
});
