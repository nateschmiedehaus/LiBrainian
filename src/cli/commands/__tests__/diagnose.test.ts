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
});
