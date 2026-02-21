import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { contractCommand } from '../contract.js';
import { LiBrainian } from '../../../api/librainian.js';

vi.mock('../../../api/librainian.js');

describe('contractCommand', () => {
  const mockWorkspace = '/test/workspace';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockLiBrainian: {
    initialize: Mock;
    getSystemContract: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockLiBrainian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getSystemContract: vi.fn().mockResolvedValue({ sentinel: true }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (LiBrainian as unknown as Mock).mockImplementation(() => mockLiBrainian);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints the system contract as JSON', async () => {
    await contractCommand({ workspace: mockWorkspace });

    expect(mockLiBrainian.getSystemContract).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"sentinel":true'));
    expect(mockLiBrainian.shutdown).toHaveBeenCalled();
  });

  it('prints pretty JSON when requested', async () => {
    await contractCommand({ workspace: mockWorkspace, pretty: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\n  "sentinel": true'));
  });
});
