import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

function parseToolPayload(result: unknown): Record<string, unknown> {
  const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`Expected text content in tool result: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP agent-actionable errors', () => {
  it('adds code, nextSteps, and recoverWith for workspace bootstrap failures', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/mcp-missing-workspace';
    const result = await (server as any).callTool('query', {
      workspace,
      intent: 'test intent',
    });

    expect(result.isError).toBe(true);
    const payload = parseToolPayload(result);
    expect(payload.error).toBe(true);
    expect(payload.code).toBe('workspace_not_bootstrapped');
    expect(payload.error_type).toBe('INDEX_NOT_INITIALIZED');
    expect(payload.severity).toBe('blocking');
    expect(payload.retry_safe).toBe(true);
    expect(payload.human_review_needed).toBe(false);
    expect(String(payload.what_was_attempted)).toContain('query');
    expect(String(payload.what_failed).length).toBeGreaterThan(0);
    expect(payload.nextSteps).toEqual(expect.arrayContaining([
      expect.stringContaining('bootstrap'),
    ]));
    expect(payload.suggested_next_steps).toEqual(expect.arrayContaining([
      expect.stringContaining('bootstrap'),
    ]));
    expect(payload.recoverWith).toEqual({
      tool: 'bootstrap',
      args: { workspace },
    });
    expect(String(payload.disclosures ?? '')).not.toContain('unverified_by_trace');
  });

  it('returns invalid_input guidance for schema validation failures', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const result = await (server as any).callTool('query', {
      workspace: '/tmp/anything',
    });

    expect(result.isError).toBe(true);
    const payload = parseToolPayload(result);
    expect(payload.error).toBe(true);
    expect(payload.code).toBe('invalid_input');
    expect(payload.error_type).toBe('QUERY_TOO_VAGUE');
    expect(payload.severity).toBe('recoverable');
    expect(Array.isArray(payload.suggested_rephrasings)).toBe(true);
    expect(payload.nextSteps).toEqual(expect.arrayContaining([
      expect.stringContaining('list_tools'),
    ]));
  });

  it('returns authorization_denied guidance when scopes are missing', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const result = await (server as any).callTool('bootstrap', {
      workspace: '/tmp/any',
    });

    expect(result.isError).toBe(true);
    const payload = parseToolPayload(result);
    expect(payload.error).toBe(true);
    expect(payload.code).toBe('authorization_denied');
    expect(payload.nextSteps).toEqual(expect.arrayContaining([
      expect.stringContaining('required scopes'),
    ]));
  });
});
