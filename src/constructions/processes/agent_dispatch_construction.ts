import { spawn } from 'node:child_process';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface AgentDispatchInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface AgentDispatchOutput {
  commandLine: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export function createAgentDispatchConstruction(): Construction<
  AgentDispatchInput,
  AgentDispatchOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'agent-dispatch',
    name: 'Agent Dispatch',
    description: 'Spawns an external agent/process and captures structured execution output.',
    async execute(input: AgentDispatchInput) {
      const startedAt = Date.now();
      const args = input.args ?? [];
      const timeoutMs = input.timeoutMs ?? 0;

      // Strip Claude Code nested session markers so dispatched agents
      // don't get rejected when this runs inside a Claude Code session.
      const childEnv: Record<string, string | undefined> = {
        ...process.env,
        ...(input.env ?? {}),
      };
      for (const key of [
        'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT',
        'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
        'CLAUDE_SESSION', 'SESSION_ID',
      ]) {
        delete childEnv[key];
      }

      const child = spawn(input.command, args, {
        cwd: input.cwd,
        env: childEnv,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      if (typeof input.stdin === 'string' && input.stdin.length > 0) {
        child.stdin.write(input.stdin);
      }
      child.stdin.end();

      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, timeoutMs)
        : undefined;

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code));
      }).finally(() => {
        if (timeout) clearTimeout(timeout);
      });

      return ok<AgentDispatchOutput, ConstructionError>({
        commandLine: [input.command, ...args].join(' ').trim(),
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    },
  };
}
