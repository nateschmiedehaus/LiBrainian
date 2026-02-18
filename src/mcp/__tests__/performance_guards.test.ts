import { describe, expect, it, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

function parseToolPayload(result: unknown): Record<string, unknown> {
  const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`Expected text content in tool result: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function createDeferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

describe('MCP performance guards', () => {
  it('returns server_busy when maxConcurrent is exceeded', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      performance: { maxConcurrent: 1, timeoutMs: 30000, cacheEnabled: true },
    });

    const gate = createDeferred<void>();
    vi.spyOn(server as any, 'executeTool').mockImplementation(async () => {
      await gate.promise;
      return { success: true };
    });

    const first = (server as any).callTool('status', {});
    await Promise.resolve();
    const second = await (server as any).callTool('status', {});

    expect(second.isError).toBe(true);
    const payload = parseToolPayload(second);
    expect(payload.error).toBe(true);
    expect(payload.code).toBe('server_busy');
    expect(typeof payload.retryAfterMs).toBe('number');

    gate.resolve();
    await first;
  });

  it('times out tool execution using performance.timeoutMs', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      performance: { maxConcurrent: 5, timeoutMs: 25, cacheEnabled: true },
    });

    vi.spyOn(server as any, 'executeTool').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { success: true };
    });

    const result = await (server as any).callTool('status', {});
    expect(result.isError).toBe(true);
    const payload = parseToolPayload(result);
    expect(payload.error).toBe(true);
    expect(String(payload.message ?? '')).toContain('timed out');
  });

  it('deduplicates concurrent bootstrap calls for the same workspace', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      performance: { maxConcurrent: 5, timeoutMs: 30000, cacheEnabled: true },
    });

    let bootstrapCalls = 0;
    vi.spyOn(server as any, 'executeBootstrap').mockImplementation(async (input: { workspace: string }) => {
      bootstrapCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        success: true,
        runId: `run-${bootstrapCalls}`,
        workspace: input.workspace,
      };
    });

    const workspace = '/tmp/librarian-bootstrap-dedupe';
    const [first, second] = await Promise.all([
      (server as any).callTool('bootstrap', { workspace }),
      (server as any).callTool('bootstrap', { workspace }),
    ]);

    expect(first.isError).not.toBe(true);
    expect(second.isError).not.toBe(true);
    const firstPayload = parseToolPayload(first);
    const secondPayload = parseToolPayload(second);
    expect(firstPayload.runId).toBe('run-1');
    expect(secondPayload.runId).toBe('run-1');
    expect(bootstrapCalls).toBe(1);
  });
});
