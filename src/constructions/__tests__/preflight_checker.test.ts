import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PreflightReport, PreflightOptions } from '../../preflight/checks.js';
import { runPreflightChecks } from '../../preflight/index.js';
import { getConstructableDefinition } from '../constructable_registry.js';
import { PreFlightChecker, createPreFlightChecker } from '../preflight_checker.js';

vi.mock('../../preflight/index.js', () => ({
  runPreflightChecks: vi.fn(),
}));

function createReport(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    canProceed: true,
    totalChecks: 3,
    passedChecks: 3,
    failedChecks: [],
    warnings: [],
    info: [],
    totalDurationMs: 10,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('PreFlightChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps runPreflightChecks with structured summary', async () => {
    const report = createReport({
      canProceed: false,
      failedChecks: [
        {
          checkId: 'llm_provider',
          name: 'LLM Provider',
          category: 'providers',
          passed: false,
          severity: 'critical',
          message: 'provider unavailable',
          durationMs: 1,
        },
      ],
      warnings: [
        {
          checkId: 'workspace_root',
          name: 'Workspace Root',
          category: 'filesystem',
          passed: false,
          severity: 'warning',
          message: 'workspace mismatch',
          durationMs: 1,
        },
      ],
      totalChecks: 5,
      passedChecks: 3,
    });

    vi.mocked(runPreflightChecks).mockResolvedValue(report);

    const checker = new PreFlightChecker();
    const options: PreflightOptions = { workspaceRoot: '/tmp/workspace', skipProviderChecks: true };

    const result = await checker.check(options);

    expect(result.canProceed).toBe(false);
    expect(result.criticalCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.report).toBe(report);
  });

  it('passes options through to runPreflightChecks', async () => {
    vi.mocked(runPreflightChecks).mockResolvedValue(createReport());

    const checker = createPreFlightChecker();
    const options: PreflightOptions = {
      workspaceRoot: '/tmp/workspace',
      skipProviderChecks: true,
      forceProbe: false,
      verbose: true,
      onlyChecks: ['workspace_dir', 'source_files'],
    };

    await checker.check(options);

    expect(runPreflightChecks).toHaveBeenCalledTimes(1);
    expect(runPreflightChecks).toHaveBeenCalledWith(options);
  });

  it('is registered as a constructable definition', () => {
    const definition = getConstructableDefinition('preflight-checker');

    expect(definition).toBeDefined();
    expect(definition?.isCore).toBe(true);
    expect(definition?.availability).toBe('ready');
  });
});
