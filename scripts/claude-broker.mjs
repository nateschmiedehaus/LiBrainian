#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execa } from 'execa';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

function sanitizeClaudeEnv(modelId) {
  const env = { ...process.env };
  // Strip nested Claude session markers so the broker can invoke claude independently.
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  delete env.CLAUDECODE;
  delete env.CLAUDE_SESSION;
  delete env.SESSION_ID;
  if (typeof modelId === 'string' && modelId.trim().length > 0) {
    env.CLAUDE_MODEL = modelId.trim();
  }
  return env;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractSystemPrompt(payload) {
  const direct = firstNonEmpty(payload.systemPrompt, payload.system);
  if (direct) return direct;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemParts = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role !== 'system') continue;
    if (typeof message.content !== 'string' || message.content.trim().length === 0) continue;
    systemParts.push(message.content);
  }
  return systemParts.length > 0 ? systemParts.join('\n\n') : null;
}

function buildPrompt(payload) {
  if (typeof payload.prompt === 'string' && payload.prompt.trim().length > 0) {
    return payload.prompt;
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const parts = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') continue;
    if (typeof message.content !== 'string' || message.content.length === 0) continue;
    parts.push(message.content);
  }
  return parts.length > 0 ? parts.join('\n\n') : '';
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function classifyClaudeFailure(raw) {
  const lowered = raw.toLowerCase();
  if (
    lowered.includes('not authenticated')
    || lowered.includes('setup-token')
    || lowered.includes('login required')
  ) {
    return { statusCode: 401, code: 'auth_failed' };
  }
  if (lowered.includes('cannot run inside nested')) {
    return { statusCode: 503, code: 'provider_unavailable' };
  }
  if (lowered.includes('rate limit') || lowered.includes('quota')) {
    return { statusCode: 429, code: 'rate_limit' };
  }
  return { statusCode: 502, code: 'llm_execution_failed' };
}

async function runClaudeChat({
  claudeBin,
  modelId,
  prompt,
  systemPrompt,
  timeoutMs,
}) {
  const args = ['--print'];
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  const result = await execa(claudeBin, args, {
    env: sanitizeClaudeEnv(modelId),
    input: prompt,
    timeout: timeoutMs,
    reject: false,
  });
  if (result.exitCode !== 0) {
    const raw = String(result.stderr || result.stdout || 'Claude CLI error');
    const classification = classifyClaudeFailure(raw);
    const message = raw.split(/\r?\n/u)[0]?.trim() || 'Claude CLI error';
    return {
      ok: false,
      statusCode: classification.statusCode,
      code: classification.code,
      message,
    };
  }
  return {
    ok: true,
    content: String(result.stdout ?? ''),
  };
}

function resolveClaudeConfigPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, '.claude.json');
}

async function checkHealth(claudeBin) {
  const version = await execa(claudeBin, ['--version'], {
    env: sanitizeClaudeEnv(null),
    timeout: 5_000,
    reject: false,
  });
  if (version.exitCode !== 0) {
    return {
      ok: false,
      statusCode: 503,
      error: String(version.stderr || version.stdout || 'Claude CLI unavailable'),
      authenticated: false,
    };
  }
  const configPath = resolveClaudeConfigPath();
  const authenticated = fs.existsSync(configPath);
  if (!authenticated) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Claude CLI not authenticated - run "claude setup-token" or start "claude" once',
      authenticated: false,
    };
  }
  return {
    ok: true,
    statusCode: 200,
    authenticated: true,
    version: String(version.stdout || '').trim(),
  };
}

function usage() {
  return [
    'Usage: node scripts/claude-broker.mjs [--host 127.0.0.1] [--port 8787] [--claude-bin claude] [--timeout-ms 120000]',
    '',
    'Endpoints:',
    '  GET  /health',
    '  POST /v1/chat',
  ].join('\n');
}

async function main() {
  const parsed = parseArgs({
    options: {
      host: { type: 'string', default: DEFAULT_HOST },
      port: { type: 'string', default: String(DEFAULT_PORT) },
      'claude-bin': { type: 'string', default: 'claude' },
      'timeout-ms': { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (parsed.values.help) {
    console.log(usage());
    return;
  }

  const host = parsed.values.host || DEFAULT_HOST;
  const port = toInt(parsed.values.port, DEFAULT_PORT);
  const claudeBin = parsed.values['claude-bin'] || 'claude';
  const timeoutMs = toInt(parsed.values['timeout-ms'], DEFAULT_TIMEOUT_MS);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        const health = await checkHealth(claudeBin);
        sendJson(res, health.statusCode, {
          ok: health.ok,
          authenticated: health.authenticated,
          provider: 'claude',
          transport: 'broker',
          error: health.error ?? null,
          version: health.version ?? null,
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/chat') {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object') {
          sendJson(res, 400, { message: 'invalid_request', error: { message: 'invalid_request' } });
          return;
        }

        const modelId = firstNonEmpty(payload.modelId, payload.model);
        const systemPrompt = extractSystemPrompt(payload);
        const prompt = buildPrompt(payload);
        const requestedTimeout = toInt(payload.timeoutMs, timeoutMs);
        const boundedTimeout = Math.min(Math.max(1_000, requestedTimeout), timeoutMs);

        const chatResult = await runClaudeChat({
          claudeBin,
          modelId,
          prompt,
          systemPrompt,
          timeoutMs: boundedTimeout,
        });

        if (!chatResult.ok) {
          sendJson(res, chatResult.statusCode, {
            message: chatResult.message,
            error: {
              message: chatResult.message,
              code: chatResult.code,
            },
          });
          return;
        }

        sendJson(res, 200, {
          provider: 'claude',
          content: chatResult.content,
          model: modelId ?? null,
        });
        return;
      }

      sendJson(res, 404, { message: 'not_found', error: { message: 'not_found' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'invalid_json') {
        sendJson(res, 400, { message: 'invalid_json', error: { message: 'invalid_json' } });
        return;
      }
      if (message === 'request_too_large') {
        sendJson(res, 413, { message: 'request_too_large', error: { message: 'request_too_large' } });
        return;
      }
      sendJson(res, 500, { message: 'internal_error', error: { message } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const effectivePort =
    typeof address === 'object' && address && typeof address.port === 'number'
      ? address.port
      : port;

  console.log(`[claude-broker] listening on http://${host}:${effectivePort}`);
  console.log('[claude-broker] export LIBRARIAN_CLAUDE_BROKER_URL for clients');

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[claude-broker] fatal: ${message}`);
  process.exit(1);
});
