import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpCommand } from '../mcp.js';
import { startStdioServer } from '../../../mcp/server.js';

vi.mock('../../../mcp/server.js', () => ({
  startStdioServer: vi.fn(),
}));

describe('mcpCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(startStdioServer).mockResolvedValue({} as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints JSON config and exits when --print-config --json is provided', async () => {
    await mcpCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['mcp', '--print-config', '--json'],
    });

    expect(startStdioServer).not.toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, any>;
    expect(payload.claude.snippet.mcpServers.librarian.args).toEqual(['mcp', '--stdio']);
    expect(payload.cursor.configPath).toContain('.cursor');
  });

  it('starts stdio MCP server by default', async () => {
    await mcpCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['mcp'],
    });

    expect(startStdioServer).toHaveBeenCalledTimes(1);
    expect(startStdioServer).toHaveBeenCalledWith({
      authorization: {
        enabledScopes: ['read', 'write'],
        requireConsent: true,
      },
    });
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('Starting LiBrainian MCP server over stdio'))).toBe(true);
  });
});
