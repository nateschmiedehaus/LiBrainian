import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed_to_resolve_port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('broker_start_timeout');
}

async function startBroker(stubScript: string, options?: { createConfig?: boolean }) {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-broker-script-'));
  const binDir = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  const argsPath = path.join(root, 'claude-args.txt');
  const inputPath = path.join(root, 'claude-input.txt');
  const stubPath = path.join(binDir, 'claude');
  await writeFile(stubPath, stubScript, 'utf8');
  await chmod(stubPath, 0o755);

  if (options?.createConfig ?? true) {
    const configDir = path.join(homeDir, '.claude');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, '.claude.json'), '{"auth":"ok"}\n', 'utf8');
  }

  const port = await getFreePort();
  const scriptPath = path.resolve(process.cwd(), 'scripts/claude-broker.mjs');
  const child = spawn('node', [scriptPath, '--host', '127.0.0.1', '--port', String(port), '--claude-bin', stubPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      BROKER_ARGS_PATH: argsPath,
      BROKER_INPUT_PATH: inputPath,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(`${baseUrl}/health`);

  return {
    root,
    child,
    baseUrl,
    argsPath,
    inputPath,
    getStderr: () => stderr,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('close', resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe('claude-broker script', () => {
  it('returns healthy status when Claude CLI is available and authenticated', async () => {
    if (process.platform === 'win32') return;
    const broker = await startBroker('#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "claude 1.0.0"; exit 0; fi\ncat >/dev/null\nprintf "ok"');
    try {
      const response = await fetch(`${broker.baseUrl}/health`);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok?: boolean; authenticated?: boolean; provider?: string };
      expect(body.ok).toBe(true);
      expect(body.authenticated).toBe(true);
      expect(body.provider).toBe('claude');
    } finally {
      await broker.stop();
    }
  });

  it('reports unauthenticated health when Claude auth config is missing', async () => {
    if (process.platform === 'win32') return;
    const broker = await startBroker('#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "claude 1.0.0"; exit 0; fi\ncat >/dev/null\nprintf "ok"', {
      createConfig: false,
    });
    try {
      const response = await fetch(`${broker.baseUrl}/health`);
      expect(response.status).toBe(401);
      const body = await response.json() as { ok?: boolean; authenticated?: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.authenticated).toBe(false);
      expect(body.error?.toLowerCase()).toContain('not authenticated');
    } finally {
      await broker.stop();
    }
  });

  it('proxies /v1/chat calls to Claude CLI with model and system prompt', async () => {
    if (process.platform === 'win32') return;
    const stubScript = [
      '#!/usr/bin/env bash',
      'if [ "$1" = "--version" ]; then',
      '  echo "claude 1.0.0"',
      '  exit 0',
      'fi',
      'printf "%s\\n" "$@" > "$BROKER_ARGS_PATH"',
      'printf "MODEL=%s\\n" "$CLAUDE_MODEL" >> "$BROKER_ARGS_PATH"',
      'cat > "$BROKER_INPUT_PATH"',
      'printf "broker-response"',
    ].join('\n');
    const broker = await startBroker(stubScript);
    try {
      const response = await fetch(`${broker.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'system rule',
          prompt: 'hello from user',
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { provider?: string; content?: string };
      expect(body.provider).toBe('claude');
      expect(body.content).toBe('broker-response');

      const argsLog = await readFile(broker.argsPath, 'utf8');
      const inputLog = await readFile(broker.inputPath, 'utf8');
      expect(argsLog).toContain('--print');
      expect(argsLog).toContain('--system-prompt');
      expect(argsLog).toContain('system rule');
      expect(argsLog).toContain('MODEL=claude-sonnet-4-20250514');
      expect(inputLog).toBe('hello from user');
    } finally {
      await broker.stop();
    }
  });

  it('returns non-200 when Claude CLI execution fails', async () => {
    if (process.platform === 'win32') return;
    const stubScript = [
      '#!/usr/bin/env bash',
      'if [ "$1" = "--version" ]; then',
      '  echo "claude 1.0.0"',
      '  exit 0',
      'fi',
      'echo "simulated broker failure" >&2',
      'exit 1',
    ].join('\n');
    const broker = await startBroker(stubScript);
    try {
      const response = await fetch(`${broker.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(response.status).toBe(502);
      const body = await response.json() as { message?: string };
      expect(body.message).toContain('simulated broker failure');
    } finally {
      await broker.stop();
    }
  });
});
