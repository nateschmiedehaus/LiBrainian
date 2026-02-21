import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { diagnoseCommand } from '../diagnose.js';
import { LiBrainian } from '../../../api/librainian.js';

vi.mock('../../../api/librainian.js');

describe('diagnoseCommand', () => {
  const mockWorkspace = '/test/workspace';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockLiBrainian: {
    initialize: Mock;
    diagnoseSelf: Mock;
    diagnoseConfig: Mock;
    healConfig: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockLiBrainian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      diagnoseSelf: vi.fn().mockResolvedValue({ status: 'ok' }),
      diagnoseConfig: vi.fn().mockResolvedValue({ healthScore: 0.9, isOptimal: true }),
      healConfig: vi.fn().mockResolvedValue({ success: true }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (LiBrainian as unknown as Mock).mockImplementation(() => mockLiBrainian);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints the diagnosis as JSON', async () => {
    await diagnoseCommand({ workspace: mockWorkspace });

    expect(mockLiBrainian.diagnoseSelf).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"status":"ok"'));
    expect(mockLiBrainian.shutdown).toHaveBeenCalled();
  });

  it('prints pretty JSON when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, pretty: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\n  "status": "ok"'));
  });

  it('includes config diagnosis when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, config: true });

    expect(mockLiBrainian.diagnoseConfig).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"config"'));
  });

  it('runs config healing when requested', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, config: true, heal: true });

    expect(mockLiBrainian.healConfig).toHaveBeenCalledWith({ riskTolerance: 'low' });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"healing"'));
  });

  it('prints a text summary when format is text', async () => {
    await diagnoseCommand({ workspace: mockWorkspace, format: 'text' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Self Diagnosis'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status: ok'));
  });
});
