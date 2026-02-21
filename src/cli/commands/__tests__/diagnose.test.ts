import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { diagnoseCommand } from '../diagnose.js';
import { Librarian } from '../../../api/librarian.js';

vi.mock('../../../api/librarian.js');

describe('diagnoseCommand', () => {
  const mockWorkspace = '/test/workspace';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockLibrarian: {
    initialize: Mock;
    diagnoseSelf: Mock;
    diagnoseConfig: Mock;
    healConfig: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockLibrarian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      diagnoseSelf: vi.fn().mockResolvedValue({ status: 'ok' }),
      diagnoseConfig: vi.fn().mockResolvedValue({ healthScore: 0.9, isOptimal: true }),
      healConfig: vi.fn().mockResolvedValue({ success: true }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (Librarian as unknown as Mock).mockImplementation(() => mockLibrarian);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints the diagnosis as JSON', async () => {
    await diagnoseCommand({ workspace: mockWorkspace });

    expect(mockLibrarian.diagnoseSelf).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"status":"ok"'));
    expect(mockLibrarian.shutdown).toHaveBeenCalled();
  });

  it('prints pretty JSON when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, pretty: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\n  "status": "ok"'));
  });

  it('includes config diagnosis when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, config: true });

    expect(mockLibrarian.diagnoseConfig).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"config"'));
  });

  it('runs config healing when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, config: true, heal: true });

    expect(mockLibrarian.healConfig).toHaveBeenCalledWith({ riskTolerance: 'low' });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"healing"'));
  });

  it('prints a text summary when format is text', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, format: 'text' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Self Diagnosis'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status: ok'));
  });

  it('emits diagnostics scope summary when run output is provided', async () => {
    await diagnoseCommand({
      workspace: mockWorkspace,
      runOutput: {
        repositoryRole: 'client',
        commandResults: [
          {
            command: 'git commit -m "test"',
            exitCode: 127,
            stderr: '/bin/bash: librainian-update: command not found',
          },
        ],
      },
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"diagnosticsScope"'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"must_fix_now"'));
  });

  it('prints deferred issue action count in text mode when diagnostics scope is included', async () => {
    await diagnoseCommand({
      workspace: mockWorkspace,
      format: 'text',
      runOutput: {
        repositoryRole: 'client',
        baselineIssueRefs: [{ pattern: 'confidence_calibration_validation.test.ts' }],
        commandResults: [
          {
            command: 'npm test -- --run',
            exitCode: 1,
            stderr: 'FAIL src/__tests__/confidence_calibration_validation.test.ts > ECE 0.183 > expected 0.15',
          },
        ],
      },
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Diagnostics Scope Verdict: defer_non_scope'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Deferred Issue Actions: 1'));
  });
});
