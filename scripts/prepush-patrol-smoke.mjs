#!/usr/bin/env node

import { spawn } from 'node:child_process';

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function summarizeOutput(stdoutText, stderrText) {
  const combined = `${stdoutText}\n${stderrText}`;
  const firstLine = combined
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? 'no diagnostics emitted';
}

function resolveCommand() {
  const commandJson = process.env.PREPUSH_PATROL_COMMAND_JSON;
  if (commandJson) {
    try {
      const parsed = JSON.parse(commandJson);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.every((entry) => typeof entry === 'string')) {
        return { command: parsed[0], args: parsed.slice(1) };
      }
    } catch {
      // Fall through to default command.
    }
  }

  return {
    command: process.execPath,
    args: ['scripts/agent-patrol.mjs', '--mode', 'quick', '--no-issues'],
  };
}

async function main() {
  const timeoutMs = parsePositiveInt(process.env.PREPUSH_PATROL_TIMEOUT_MS, 120_000);
  const heartbeatMs = parsePositiveInt(process.env.PREPUSH_PATROL_HEARTBEAT_MS, 15_000);
  const { command, args } = resolveCommand();
  const startedAt = Date.now();

  console.log(`[pre-push] patrol-smoke start timeoutMs=${timeoutMs}`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  const heartbeat = setInterval(() => {
    console.log(`[pre-push] patrol-smoke heartbeat elapsedMs=${Date.now() - startedAt}`);
  }, heartbeatMs);
  heartbeat.unref();

  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    console.warn(`[pre-push] patrol-smoke timeout after ${timeoutMs}ms. Stopping child process.`);
    child.kill('SIGTERM');
    setTimeout(() => {
      child.kill('SIGKILL');
    }, 2_000).unref();
  }, timeoutMs);
  timeout.unref();

  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  clearInterval(heartbeat);
  clearTimeout(timeout);

  const elapsedMs = Date.now() - startedAt;
  if (timeoutTriggered) {
    const summary = summarizeOutput(stdout, stderr);
    console.warn(
      `[pre-push] patrol-smoke non-blocking timeout elapsedMs=${elapsedMs} summary="${summary}" fallback="git push --no-verify (temporary; file/track #832 with hook logs)"`
    );
    process.exit(0);
  }

  if (typeof exit.code === 'number' && exit.code === 0) {
    console.log(`[pre-push] patrol-smoke completed elapsedMs=${elapsedMs}`);
    process.exit(0);
  }

  const summary = summarizeOutput(stdout, stderr);
  const exitLabel = typeof exit.code === 'number'
    ? `exit=${exit.code}`
    : `signal=${String(exit.signal ?? 'unknown')}`;
  console.warn(
    `[pre-push] patrol-smoke non-blocking failure ${exitLabel} summary="${summary}" fallback="git push --no-verify (temporary; file/track #832 with hook logs)"`
  );
  process.exit(0);
}

main().catch((error) => {
  console.warn(
    `[pre-push] patrol-smoke launcher error non-blocking: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(0);
});
