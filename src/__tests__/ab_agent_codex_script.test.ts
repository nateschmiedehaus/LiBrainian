import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function runScriptWithStub(
  env: NodeJS.ProcessEnv,
  stubScript = '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$AB_ARGS_PATH"\ncat > "$AB_CAPTURE_PATH"\nexit 0\n'
): Promise<{ exitCode: number | null; captured: string; stderr: string; args: string }> {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-script-'));
  const binDir = path.join(sandbox, 'bin');
  const capturePath = path.join(sandbox, 'captured-prompt.txt');
  const argsPath = path.join(sandbox, 'captured-args.txt');
  await mkdir(binDir, { recursive: true });

  const stubPath = path.join(binDir, 'codex');
  await writeFile(stubPath, stubScript, 'utf8');
  await chmod(stubPath, 0o755);

  const scriptPath = path.resolve(process.cwd(), 'scripts/ab-agent-codex.mjs');
  const child = spawn('node', [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      AB_CAPTURE_PATH: capturePath,
      AB_ARGS_PATH: argsPath,
      AB_HARNESS_CODEX_BIN: stubPath,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  const captured = await readFile(capturePath, 'utf8').catch(() => '');
  const args = await readFile(argsPath, 'utf8').catch(() => '');
  return { exitCode, captured, stderr, args };
}

describe('ab-agent-codex script', () => {
  it('prefers harness prompt artifact when provided', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-prompt-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(
      promptPath,
      [
        'Task ID: task-a',
        'Librarian Context:',
        '- src/utils/target.ts',
        '',
        'Context Excerpts:',
        '### src/utils/target.ts',
        '```',
        'export const marker = true;',
        '```',
      ].join('\n'),
      'utf8'
    );

    const { exitCode, captured } = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'task-a',
      AB_HARNESS_WORKER_TYPE: 'treatment',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(exitCode).toBe(0);

    expect(captured).toContain('Task prompt follows:');
    expect(captured).toContain('Librarian Context:');
    expect(captured).toContain('Context Excerpts:');
    expect(captured).toContain('export const marker = true;');
  });

  it('falls back to task/context artifact parsing and includes treatment excerpts', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-fallback-'));
    const taskPath = path.join(sandbox, 'task.json');
    const contextPath = path.join(sandbox, 'context.json');
    await writeFile(
      taskPath,
      JSON.stringify({
        definition: {
          id: 'task-b',
          description: 'Fix a regression in path handling.',
          targetFiles: ['src/utils/path.ts'],
        },
      }),
      'utf8'
    );
    await writeFile(
      contextPath,
      JSON.stringify({
        baseContextFiles: ['package.json'],
        extraContextFiles: ['src/utils/path.ts'],
        files: [
          {
            file: 'src/utils/path.ts',
            source: 'librarian',
            exists: true,
            excerpt: 'export function normalizePath(input) { return input.trim(); }',
          },
        ],
      }),
      'utf8'
    );

    const { exitCode, captured } = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'task-b',
      AB_HARNESS_WORKER_TYPE: 'treatment',
      AB_HARNESS_TASK_FILE: taskPath,
      AB_HARNESS_CONTEXT_FILE: contextPath,
      AB_HARNESS_INCLUDE_EXCERPTS: '1',
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(exitCode).toBe(0);

    expect(captured).toContain('Bug report: Fix a regression in path handling.');
    expect(captured).toContain('Acceptance target files (must modify at least one):');
    expect(captured).toContain('src/utils/path.ts');
    expect(captured).toContain('Librarian-retrieved file hints:');
    expect(captured).toContain('Librarian context excerpts:');
    expect(captured).toContain('normalizePath');
  });

  it('includes patch-command safety guidance in harness instructions', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-guidance-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: safety-task\n', 'utf8');

    const { exitCode, captured } = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'safety-task',
      AB_HARNESS_WORKER_TYPE: 'control',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(exitCode).toBe(0);
    expect(captured).toContain('Do not invoke `apply_patch` as a shell command');
  });

  it('fails fast when codex subprocess exceeds wrapper timeout', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-timeout-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: timeout-task\n', 'utf8');

    const { exitCode, stderr } = await runScriptWithStub(
      {
        AB_HARNESS_TASK_ID: 'timeout-task',
        AB_HARNESS_WORKER_TYPE: 'control',
        AB_HARNESS_PROMPT_FILE: promptPath,
        AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
        AB_HARNESS_AGENT_TIMEOUT_MS: '50',
      },
      '#!/usr/bin/env bash\ncat >/dev/null\nsleep 1\n'
    );

    expect(exitCode).toBe(124);
    expect(stderr).toContain('agent_timeout_ms_exceeded:50');
  });

  it('injects strict validation guidance and acceptance commands when provided', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-acceptance-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: acceptance-task\n', 'utf8');

    const { exitCode, captured } = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'acceptance-task',
      AB_HARNESS_WORKER_TYPE: 'treatment',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
      AB_HARNESS_ACCEPTANCE_COMMANDS: [
        'npx vitest run src/utils/getErrorMessage.test.ts --reporter=dot',
        'npx vitest run src/utils/formatTime.test.ts --reporter=dot',
      ].join('\n'),
    });
    expect(exitCode).toBe(0);
    expect(captured).toContain('Do not run additional validation commands');
    expect(captured).toContain('Acceptance command(s) (optional; run at most one):');
    expect(captured).toContain('npx vitest run src/utils/getErrorMessage.test.ts --reporter=dot');
  });

  it('passes configured reasoning effort to codex invocation', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-reasoning-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: reasoning-task\n', 'utf8');

    const { exitCode, args } = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'reasoning-task',
      AB_HARNESS_WORKER_TYPE: 'control',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
      AB_HARNESS_CODEX_REASONING_EFFORT: 'low',
    });
    expect(exitCode).toBe(0);
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort="low"');
  });

  it('uses worker-specific default models when no global model override is set', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-models-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: model-task\n', 'utf8');

    const controlRun = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'model-task-control',
      AB_HARNESS_WORKER_TYPE: 'control',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(controlRun.exitCode).toBe(0);
    expect(controlRun.args).toContain('-m');
    expect(controlRun.args).toContain('gpt-5');

    const treatmentRun = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'model-task-treatment',
      AB_HARNESS_WORKER_TYPE: 'treatment',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(treatmentRun.exitCode).toBe(0);
    expect(treatmentRun.args).toContain('-m');
    expect(treatmentRun.args).toContain('gpt-5-codex');
  });

  it('uses worker-specific default reasoning effort when no override is provided', async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), 'ab-agent-codex-reasoning-defaults-'));
    const promptPath = path.join(sandbox, 'prompt.txt');
    await writeFile(promptPath, 'Task ID: reasoning-default-task\n', 'utf8');

    const controlRun = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'reasoning-default-control',
      AB_HARNESS_WORKER_TYPE: 'control',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(controlRun.exitCode).toBe(0);
    expect(controlRun.args).toContain('model_reasoning_effort="medium"');

    const treatmentRun = await runScriptWithStub({
      AB_HARNESS_TASK_ID: 'reasoning-default-treatment',
      AB_HARNESS_WORKER_TYPE: 'treatment',
      AB_HARNESS_PROMPT_FILE: promptPath,
      AB_HARNESS_WORKSPACE_ROOT: process.cwd(),
    });
    expect(treatmentRun.exitCode).toBe(0);
    expect(treatmentRun.args).toContain('model_reasoning_effort="low"');
  });
});
