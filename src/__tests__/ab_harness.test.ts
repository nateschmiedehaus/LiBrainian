import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeAbLiftSummary,
  refineLibrarianContextFiles,
  runAbExperiment,
  runAbTask,
  type AbGroupStats,
  type AbTaskDefinition,
  type AbWorkerType,
} from '../evaluation/ab_harness.js';

async function createRepoFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ab-harness-fixture-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'feature.ts'),
    'export function greet() { return "hello"; }\n',
    'utf8'
  );
  await writeFile(path.join(root, 'README.md'), '# Fixture\n', 'utf8');
  return root;
}

describe('ab harness runner', () => {
  it('limits refined Librarian context to compact target-focused set by default', () => {
    const refined = refineLibrarianContextFiles(
      [
        'src/services/Orchestrator.ts',
        'src/utils/dependencyParser.ts',
        'src/utils/dependencyGraph.ts',
        'src/types.ts',
      ],
      ['src/utils/dependencyParser.ts']
    );
    expect(refined.length).toBeLessThanOrEqual(2);
    expect(refined).toContain('src/utils/dependencyParser.ts');
  });

  it('still retains target file when refiner receives noisy candidates', () => {
    const refined = refineLibrarianContextFiles(
      [
        'README.md',
        'src/utils/random.ts',
        'src/utils/getErrorMessage.ts',
        'src/utils/formatTime.ts',
      ],
      ['src/utils/getErrorMessage.ts']
    );
    expect(refined).toContain('src/utils/getErrorMessage.ts');
  });

  it('recovers treatment context and edits when target casing differs on disk', async () => {
    async function createCaseRepo(): Promise<string> {
      const repoRoot = await mkdtemp(path.join(tmpdir(), 'ab-harness-case-'));
      await writeFile(path.join(repoRoot, 'package.json'), '{"name":"fixture"}\n', 'utf8');
      await writeFile(path.join(repoRoot, 'readme.md'), '# Fixture\n', 'utf8');
      return repoRoot;
    }

    const task: AbTaskDefinition = {
      id: 'task-case-1',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Update the README heading.',
      contextLevel: 1,
      targetFiles: ['README.md'],
      edits: [
        {
          file: 'README.md',
          search: '# Fixture',
          replace: '# Fixture Updated',
        },
      ],
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['package.json'],
      },
    };

    const controlRepoRoot = await createCaseRepo();
    const controlResult = await runAbTask(task, controlRepoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });
    expect(controlResult.success).toBe(true);
    expect(controlResult.modifiedFiles).toContain('readme.md');

    const treatmentRepoRoot = await createCaseRepo();
    const treatmentResult = await runAbTask(task, treatmentRepoRoot, {
      workerType: 'treatment',
      resolveExtraContext: async () => [],
    });
    expect(treatmentResult.success).toBe(true);
    expect(treatmentResult.modifiedFiles).toContain('readme.md');

    const updated = await readFile(path.join(treatmentRepoRoot, 'readme.md'), 'utf8');
    expect(updated).toContain('# Fixture Updated');
  });

  it('lets treatment succeed when extra context includes target file', async () => {
    const controlRepoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-1',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Update greet output.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"hello world"',
        },
      ],
      verification: {
        tests: ['node -e "process.exit(0)"'],
        typecheck: ['node -e "process.exit(0)"'],
        build: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['README.md'],
      },
    };

    const controlResult = await runAbTask(task, controlRepoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(controlResult.success).toBe(true);
    expect(controlResult.modifiedFiles).toContain('src/feature.ts');

    const treatmentRepoRoot = await createRepoFixture();
    const treatmentResult = await runAbTask(task, treatmentRepoRoot, {
      workerType: 'treatment',
      resolveExtraContext: async () => ['src/feature.ts'],
    });

    expect(treatmentResult.success).toBe(true);
    expect(treatmentResult.verification.tests?.passed).toBe(true);

    const updated = await readFile(path.join(treatmentRepoRoot, 'src', 'feature.ts'), 'utf8');
    expect(updated).toContain('"hello world"');
  });

  it('allows setup commands to use an extended timeout budget', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-setup-timeout-window',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Setup should not inherit the short command timeout budget.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      setup: [
        'node -e "setTimeout(() => process.exit(0), 120)"',
      ],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"setup timeout ok"',
        },
      ],
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'\\\"setup timeout ok\\\"\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      commandTimeoutMs: 100,
      resolveExtraContext: async () => [],
    });

    expect(result.verification.setup?.passed).toBe(true);
    expect(result.verification.setup?.commands[0]?.timedOut).toBe(false);
    expect(result.failureReason).not.toBe('setup_command_timeout');
  });

  it('executes agent command mode and stores run artifacts', async () => {
    const repoRoot = await createRepoFixture();
    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-control.cjs'),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const prompt = fs.readFileSync(process.env.AB_HARNESS_PROMPT_FILE, "utf8");',
        'if (!prompt.includes("Update greet output")) process.exit(2);',
        'const timeoutMs = Number(process.env.AB_HARNESS_AGENT_TIMEOUT_MS ?? "0");',
        'if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) process.exit(7);',
        'const context = JSON.parse(fs.readFileSync(process.env.AB_HARNESS_CONTEXT_FILE, "utf8"));',
        'if (!Array.isArray(context.combinedContextFiles)) process.exit(3);',
        'const featurePath = path.join(process.cwd(), "src", "feature.ts");',
        'const before = fs.readFileSync(featurePath, "utf8");',
        'fs.writeFileSync(featurePath, before.replace(\'"hello"\', \'"agent control"\'));',
      ].join('\n'),
      'utf8'
    );

    const task: AbTaskDefinition = {
      id: 'task-2',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Update greet output via agent command.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-control.cjs',
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'\\\"agent control\\\"\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control' as AbWorkerType,
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(true);
    expect(result.agentCommand?.exitCode).toBe(0);
    expect(result.modifiedFiles).toContain('src/feature.ts');
    expect(result.artifacts?.files.prompt).toBeDefined();

    const promptPath = result.artifacts?.files.prompt;
    expect(promptPath).toBeDefined();
    const promptContents = await readFile(promptPath!, 'utf8');
    expect(promptContents).toContain('Target Files:');
    expect(promptContents).toContain('src/feature.ts');
    expect(promptContents).toContain('Context Excerpts');
  });

  it('injects librarian context into treatment prompt artifacts', async () => {
    const repoRoot = await createRepoFixture();
    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-treatment.cjs'),
      [
        'const fs = require("node:fs");',
        'const context = JSON.parse(fs.readFileSync(process.env.AB_HARNESS_CONTEXT_FILE, "utf8"));',
        'if (!context.extraContextFiles.includes("src/feature.ts")) process.exit(4);',
        'const prompt = fs.readFileSync(process.env.AB_HARNESS_PROMPT_FILE, "utf8");',
        'if (!prompt.includes("Librarian Context")) process.exit(5);',
        'if (!prompt.includes("src/feature.ts")) process.exit(6);',
        'const source = fs.readFileSync("src/feature.ts", "utf8");',
        'fs.writeFileSync("src/feature.ts", source.replace(\'"hello"\', \'"agent treatment"\'));',
      ].join('\n'),
      'utf8'
    );

    const task: AbTaskDefinition = {
      id: 'task-3',
      repo: 'fixture',
      complexity: 'T4',
      description: 'Update greet output via treatment agent.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: {
          treatment: 'node scripts/agent-treatment.cjs',
        },
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'\\\"agent treatment\\\"\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['README.md'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'treatment',
      resolveExtraContext: async () => ['src/feature.ts'],
    });

    expect(result.success).toBe(true);
    expect(result.extraContextFiles).toContain('src/feature.ts');
    expect(result.agentCommand?.exitCode).toBe(0);
    const promptPath = result.artifacts?.files.prompt;
    expect(promptPath).toBeDefined();
    const promptContents = await readFile(promptPath!, 'utf8');
    expect(promptContents).toContain('### src/feature.ts');
    expect(promptContents).not.toContain('### README.md');

    const updated = await readFile(path.join(repoRoot, 'src', 'feature.ts'), 'utf8');
    expect(updated).toContain('"agent treatment"');
  });

  it('fails closed when worker command template is missing', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-4',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Missing command template should fail.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: {
          treatment: 'node -e "process.exit(0)"',
        },
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_command_missing');
  });

  it('fails closed when command template depends on missing environment variables', async () => {
    const previous = process.env.AB_HARNESS_AGENT_CMD;
    delete process.env.AB_HARNESS_AGENT_CMD;
    try {
      const repoRoot = await createRepoFixture();
      const task: AbTaskDefinition = {
        id: 'task-4b',
        repo: 'fixture',
        complexity: 'T3',
        description: 'Missing env should fail closed.',
        contextLevel: 1,
        mode: 'agent_command',
        targetFiles: ['src/feature.ts'],
        agentExecution: {
          commandTemplate: '${AB_HARNESS_AGENT_CMD}',
        },
        verification: {
          tests: ['node -e "process.exit(0)"'],
        },
        contextByLevel: {
          L1: ['src/feature.ts'],
        },
      };

      const result = await runAbTask(task, repoRoot, {
        workerType: 'control',
        resolveExtraContext: async () => [],
      });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('agent_command_env_missing:AB_HARNESS_AGENT_CMD');
    } finally {
      if (typeof previous === 'string') {
        process.env.AB_HARNESS_AGENT_CMD = previous;
      } else {
        delete process.env.AB_HARNESS_AGENT_CMD;
      }
    }
  });

  it('expands environment variables in command templates before execution', async () => {
    const previous = process.env.AB_HARNESS_AGENT_CMD;
    process.env.AB_HARNESS_AGENT_CMD = 'node scripts/agent-control.cjs';
    try {
      const repoRoot = await createRepoFixture();
      await writeFile(
        path.join(repoRoot, 'scripts', 'agent-control.cjs'),
        [
          'const fs = require("node:fs");',
          'const featurePath = "src/feature.ts";',
          'const before = fs.readFileSync(featurePath, "utf8");',
          'fs.writeFileSync(featurePath, before.replace(\'"hello"\', \'"from env expansion"\'));',
        ].join('\n'),
        'utf8'
      );

      const task: AbTaskDefinition = {
        id: 'task-4c',
        repo: 'fixture',
        complexity: 'T3',
        description: 'Env command should run.',
        contextLevel: 1,
        mode: 'agent_command',
        targetFiles: ['src/feature.ts'],
        agentExecution: {
          commandTemplate: '${AB_HARNESS_AGENT_CMD}',
        },
        verification: {
          tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'\\\"from env expansion\\\"\') ? 0 : 1)"'],
        },
        contextByLevel: {
          L1: ['src/feature.ts'],
        },
      };

      const result = await runAbTask(task, repoRoot, {
        workerType: 'control',
        resolveExtraContext: async () => [],
      });

      expect(result.success).toBe(true);
      expect(result.agentCommand?.exitCode).toBe(0);
      expect(result.modifiedFiles).toContain('src/feature.ts');
    } finally {
      if (typeof previous === 'string') {
        process.env.AB_HARNESS_AGENT_CMD = previous;
      } else {
        delete process.env.AB_HARNESS_AGENT_CMD;
      }
    }
  });

  it('fails closed on agent command timeout and provider unavailability', async () => {
    const repoRoot = await createRepoFixture();
    const timeoutTask: AbTaskDefinition = {
      id: 'task-5',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Timeout command should fail.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "setTimeout(() => process.exit(0), 250)"',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const timeoutResult = await runAbTask(timeoutTask, repoRoot, {
      workerType: 'control',
      commandTimeoutMs: 25,
      resolveExtraContext: async () => [],
    });

    expect(timeoutResult.success).toBe(false);
    expect(timeoutResult.failureReason).toBe('agent_command_timeout');
    expect(timeoutResult.agentCommand?.timedOut).toBe(true);

    const wrapperTimeoutTask: AbTaskDefinition = {
      id: 'task-5-wrapper-timeout',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Wrapper timeout marker should classify as timeout.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "console.error(\'agent_timeout_ms_exceeded:50\');process.exit(124)"',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const wrapperTimeoutResult = await runAbTask(wrapperTimeoutTask, repoRoot, {
      workerType: 'control',
      commandTimeoutMs: 250,
      resolveExtraContext: async () => [],
    });

    expect(wrapperTimeoutResult.success).toBe(false);
    expect(wrapperTimeoutResult.failureReason).toBe('agent_command_timeout');
    expect(wrapperTimeoutResult.agentCommand?.timedOut).toBe(false);

    const markerLiteral = JSON.stringify(path.join(repoRoot, 'timeout-marker.txt'));
    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-timeout-tree.cjs'),
      [
        'const { spawn } = require("node:child_process");',
        'const path = require("node:path");',
        'const marker = path.join(process.cwd(), "timeout-marker.txt");',
        `spawn(process.execPath, ["-e", \`setTimeout(() => { require("node:fs").writeFileSync(${markerLiteral}, "late"); }, 400); setTimeout(() => {}, 5000);\`], { stdio: "ignore" });`,
        'setTimeout(() => {}, 5000);',
      ].join('\n'),
      'utf8'
    );

    const timeoutTreeTask: AbTaskDefinition = {
      id: 'task-5b',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Timeout must terminate child process tree.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-timeout-tree.cjs',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const timeoutTreeResult = await runAbTask(timeoutTreeTask, repoRoot, {
      workerType: 'control',
      commandTimeoutMs: 50,
      resolveExtraContext: async () => [],
    });
    expect(timeoutTreeResult.success).toBe(false);
    expect(timeoutTreeResult.failureReason).toBe('agent_command_timeout');

    await new Promise((resolve) => setTimeout(resolve, 700));
    const markerPath = path.join(repoRoot, 'timeout-marker.txt');
    const markerExists = await stat(markerPath).then(() => true).catch(() => false);
    expect(markerExists).toBe(false);

    const providerTask: AbTaskDefinition = {
      id: 'task-6',
      repo: 'fixture',
      complexity: 'T4',
      description: 'Provider failure should fail closed.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: {
          treatment: 'node -e "process.exit(0)"',
        },
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['README.md'],
      },
    };

    const providerResult = await runAbTask(providerTask, repoRoot, {
      workerType: 'treatment',
      resolveExtraContext: async () => {
        throw new Error('unverified_by_trace(provider_unavailable): missing provider');
      },
    });

    expect(providerResult.success).toBe(false);
    expect(providerResult.failureReason).toBe('librarian_provider_unavailable');

    const emptyStorageResult = await runAbTask(providerTask, repoRoot, {
      workerType: 'treatment',
      resolveExtraContext: async () => {
        throw new Error('unverified_by_trace(empty_storage): Cannot query librarian - no functions or modules indexed. Bootstrap may have failed silently or was not run. Run bootstrapProject() first with valid LLM/embedding providers configured.');
      },
    });

    expect(emptyStorageResult.success).toBe(false);
    expect(emptyStorageResult.failureReason).toBe('librarian_context_unavailable');

    const usageLimitTask: AbTaskDefinition = {
      id: 'task-6-usage-limit',
      repo: 'fixture',
      complexity: 'T4',
      description: 'Agent provider quota exhaustion should classify as provider unavailable.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "console.error(\'ERROR: You\\\'ve hit your usage limit\');process.exit(1)"',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const usageLimitResult = await runAbTask(usageLimitTask, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(usageLimitResult.success).toBe(false);
    expect(usageLimitResult.failureReason).toBe('agent_command_provider_unavailable');
  });

  it('enforces baseline-failure precondition when requested', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-7',
      repo: 'fixture',
      complexity: 'T4',
      description: 'Baseline must fail before a fix task is considered valid.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"hello from baseline guard"',
        },
      ],
      verification: {
        baseline: ['node -e "process.exit(0)"'],
        requireBaselineFailure: true,
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('baseline_expected_failure_missing');
  });

  it('fails closed when command makes no target-file modification', async () => {
    const repoRoot = await createRepoFixture();
    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-no-target-change.cjs'),
      [
        'const fs = require("node:fs");',
        'const readme = fs.readFileSync("README.md", "utf8");',
        'fs.writeFileSync("README.md", readme + "\\nupdated");',
      ].join('\n'),
      'utf8'
    );

    const task: AbTaskDefinition = {
      id: 'task-8',
      repo: 'fixture',
      complexity: 'T4',
      description: 'Agent should update target file but does not.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-no-target-change.cjs',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts', 'README.md'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('no_target_file_modified');
  });

  it('fails closed when verification command is unavailable without explicit fallback opt-in', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-proof-1',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Update greet output with fallback proof.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"verified by edit proof"',
        },
      ],
      verification: {
        tests: ['definitely_missing_command_12345'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('verification_command_missing');
  });

  it('rejects deterministic verification fallback configuration', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-proof-2',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Update greet output with fallback proof.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"verified by edit proof"',
        },
      ],
      verification: {
        tests: ['definitely_missing_command_12345'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };
    (task as AbTaskDefinition & { allowVerificationCommandFallback: boolean })
      .allowVerificationCommandFallback = true;

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('verification_fallback_disallowed');
    expect(result.verificationPolicy.verificationFallbackUsed).toBe(false);
  });
});

function buildStats(input: {
  n: number;
  successes: number;
  avgDurationMs: number;
}): AbGroupStats {
  const successRate = input.n > 0 ? input.successes / input.n : 0;
  return {
    n: input.n,
    successes: input.successes,
    successRate,
    avgDurationMs: input.avgDurationMs,
    byComplexity: {
      T1: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
      T2: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
      T3: { n: input.n, successes: input.successes, successRate, avgDurationMs: input.avgDurationMs },
      T4: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
      T5: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
    },
  };
}

describe('computeAbLiftSummary', () => {
  it('reports statistically significant lift when sample is adequate', () => {
    const control = buildStats({ n: 20, successes: 4, avgDurationMs: 1000 });
    const treatment = buildStats({ n: 20, successes: 14, avgDurationMs: 900 });

    const summary = computeAbLiftSummary(control, treatment);
    expect(summary).not.toBeNull();
    expect(summary?.absoluteSuccessRateDelta).toBeCloseTo(0.5, 6);
    expect(summary?.significance.sampleSizeAdequate).toBe(true);
    expect(summary?.significance.pValue).not.toBeNull();
    expect(summary?.significance.statisticallySignificant).toBe(true);
    expect(summary?.confidenceInterval95.lower).toBeGreaterThan(0);
  });

  it('marks small-sample runs as inconclusive', () => {
    const control = buildStats({ n: 2, successes: 0, avgDurationMs: 1000 });
    const treatment = buildStats({ n: 2, successes: 2, avgDurationMs: 900 });

    const summary = computeAbLiftSummary(control, treatment);
    expect(summary).not.toBeNull();
    expect(summary?.significance.sampleSizeAdequate).toBe(false);
    expect(summary?.significance.pValue).toBeNull();
    expect(summary?.significance.statisticallySignificant).toBeNull();
    expect(summary?.significance.inconclusiveReason).toBe('insufficient_samples');
  });

  it('keeps relative CI null when control rate is zero', () => {
    const control = buildStats({ n: 10, successes: 0, avgDurationMs: 1000 });
    const treatment = buildStats({ n: 10, successes: 3, avgDurationMs: 900 });

    const summary = computeAbLiftSummary(control, treatment);
    expect(summary).not.toBeNull();
    expect(summary?.controlSuccessRate).toBe(0);
    expect(summary?.relativeLiftConfidenceInterval95).toBeNull();
  });

  it('uses absolute delta as lift when control success is zero', () => {
    const control = buildStats({ n: 10, successes: 0, avgDurationMs: 1000 });
    const treatment = buildStats({ n: 10, successes: 4, avgDurationMs: 900 });

    const summary = computeAbLiftSummary(control, treatment);
    expect(summary).not.toBeNull();
    expect(summary?.controlSuccessRate).toBe(0);
    expect(summary?.absoluteSuccessRateDelta).toBeCloseTo(0.4, 6);
    expect(summary?.successRateLift).toBeCloseTo(0.4, 6);
  });

  it('emits diagnostics and gate failures for empty experiment runs', async () => {
    const report = await runAbExperiment({
      reposRoot: '/tmp',
      tasks: [],
      workerTypes: ['control'],
      minAgentCommandShare: 0,
    });

    expect(report.diagnostics.modeCounts.agent_command).toBe(0);
    expect(report.diagnostics.modeCounts.deterministic_edit).toBe(0);
    expect(report.gates.passed).toBe(false);
    expect(report.gates.reasons).toContain('t3_plus_lift_unavailable');
    expect(report.gates.classifiedReasons.some((reason) => reason.category === 'measurement')).toBe(true);
    expect(report.gates.severityCounts.blocking).toBeGreaterThan(0);
  });

  it('fails gates when critical prerequisite failures are present', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const task: AbTaskDefinition = {
      id: 'task-critical-1',
      repo: repoName,
      complexity: 'T3',
      description: 'Agent command template missing should be critical.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: {
          treatment: 'node -e "process.exit(0)"',
        },
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks: [task],
      workerTypes: ['control'],
      maxTasks: 1,
      requireNoCriticalFailures: true,
      minAgentCommandShare: 0,
    });

    expect(report.diagnostics.failureReasons.agent_command_missing).toBe(1);
    expect(report.diagnostics.criticalFailureReasons.agent_command_missing).toBe(1);
    expect(report.gates.reasons.some((reason) => reason.startsWith('critical_failures_present:'))).toBe(true);
    expect(report.gates.classifiedReasons.some((reason) => reason.category === 'execution')).toBe(true);
  });

  it('enforces baseline guards and verified execution share for agent-command realism', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const task: AbTaskDefinition = {
      id: 'task-realism-1',
      repo: repoName,
      complexity: 'T3',
      description: 'Agent modifies target file without explicit verification/baseline controls.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "const fs=require(\'node:fs\');const p=\'src/feature.ts\';const c=fs.readFileSync(p,\'utf8\');fs.writeFileSync(p,c.replace(\'\\\"hello\\\"\',\'\\\"agent realism\\\"\'));"',
      },
      verification: {},
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
      requireTargetFileModification: true,
    };

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks: [task],
      workerTypes: ['control'],
      maxTasks: 1,
      minAgentCommandShare: 0,
      minAgentVerifiedExecutionShare: 1,
      requireBaselineFailureForAgentTasks: true,
      requireNoCriticalFailures: false,
    });

    expect(report.diagnostics.agentCommandShare).toBe(1);
    expect(report.diagnostics.agentVerifiedExecutionShare).toBe(0);
    expect(report.diagnostics.agentBaselineGuardShare).toBe(0);
    expect(
      report.gates.reasons.some((reason) =>
        reason.startsWith('agent_verified_execution_share_below_threshold:')
      )
    ).toBe(true);
    expect(
      report.gates.reasons.some((reason) =>
        reason.startsWith('agent_baseline_guard_share_below_threshold:')
      )
    ).toBe(true);
  });

  it('counts verified execution when verification commands run but assertions fail', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const task: AbTaskDefinition = {
      id: 'task-realism-2',
      repo: repoName,
      complexity: 'T3',
      description: 'Agent changes target file but leaves failing verification output.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "const fs=require(\'node:fs\');fs.writeFileSync(\'src/feature.ts\',\'export function greet() { return \\\\\\"wrong\\\\\\"; }\\\\n\');"',
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'\\\"expected\\\"\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
      requireTargetFileModification: true,
    };

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks: [task],
      workerTypes: ['control'],
      maxTasks: 1,
      minAgentCommandShare: 0,
      minAgentVerifiedExecutionShare: 1,
      requireNoCriticalFailures: false,
    });

    expect(report.results[0]?.success).toBe(false);
    expect(report.results[0]?.failureReason).toBe('verification_failed');
    expect(report.diagnostics.agentVerifiedExecutionShare).toBe(1);
    expect(
      report.gates.reasons.some((reason) =>
        reason.startsWith('agent_verified_execution_share_below_threshold:')
      )
    ).toBe(false);
  });

  it('keeps artifact integrity complete for early agent command failures', async () => {
    const repoRoot = await createRepoFixture();
    const task: AbTaskDefinition = {
      id: 'task-artifacts-early-failure',
      repo: 'fixture',
      complexity: 'T3',
      description: 'Agent command exits non-zero before verification.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node -e "process.exit(1)"',
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const result = await runAbTask(task, repoRoot, {
      workerType: 'control',
      resolveExtraContext: async () => [],
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('agent_command_failed');
    expect(result.artifactIntegrity?.complete).toBe(true);
    expect(result.artifactIntegrity?.missingFiles ?? []).toHaveLength(0);
    expect(result.artifacts?.files.agent_command_result).toBeDefined();
    expect(result.artifacts?.files.prompt).toBeDefined();
  });

  it('enforces artifact integrity threshold for agent-command evidence completeness', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const task: AbTaskDefinition = {
      id: 'task-artifacts-1',
      repo: repoName,
      complexity: 'T3',
      description: 'Missing command template should produce incomplete artifact evidence.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: {
          treatment: 'node -e "process.exit(0)"',
        },
      },
      verification: {
        tests: ['node -e "process.exit(0)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks: [task],
      workerTypes: ['control'],
      maxTasks: 1,
      requireNoCriticalFailures: false,
      minAgentCommandShare: 0,
      minArtifactIntegrityShare: 1,
    });

    expect(report.diagnostics.artifactIntegrityShare).toBeLessThan(1);
    expect(
      report.gates.reasons.some((reason) =>
        reason.startsWith('artifact_integrity_share_below_threshold:')
      )
    ).toBe(true);
  });

  it('fails gates when verification fallback configuration is present', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const task: AbTaskDefinition = {
      id: 'task-fallback-share-1',
      repo: repoName,
      complexity: 'T3',
      description: 'Deterministic fallback configuration is disallowed.',
      contextLevel: 1,
      targetFiles: ['src/feature.ts'],
      edits: [
        {
          file: 'src/feature.ts',
          search: '"hello"',
          replace: '"fallback tracked"',
        },
      ],
      verification: {
        tests: ['definitely_missing_command_12345'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    };
    (task as AbTaskDefinition & { allowVerificationCommandFallback: boolean })
      .allowVerificationCommandFallback = true;

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks: [task],
      workerTypes: ['control'],
      maxTasks: 1,
      minAgentCommandShare: 0,
      minT3SuccessRateLift: 0,
      requireNoCriticalFailures: true,
    });

    expect(report.diagnostics.verificationFallbackRuns).toBe(0);
    expect(report.diagnostics.verificationFallbackShare).toBe(0);
    expect(report.diagnostics.failureReasons.verification_fallback_disallowed).toBe(1);
    expect(
      report.gates.reasons.some((reason) =>
        reason.startsWith('critical_failures_present:')
      )
    ).toBe(true);
  });

  it('uses ceiling-mode time reduction gating when both groups saturate success', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);

    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-ceiling.cjs'),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const worker = process.env.AB_HARNESS_WORKER_TYPE || "control";',
        'const delayMs = worker === "control" ? 250 : 10;',
        'setTimeout(() => {',
        '  const featurePath = path.join(process.cwd(), "src", "feature.ts");',
        '  fs.writeFileSync(featurePath, "export function greet() { return \\"ceiling mode\\"; }\\n");',
        '  process.exit(0);',
        '}, delayMs);',
      ].join('\n'),
      'utf8'
    );

    const tasks: AbTaskDefinition[] = Array.from({ length: 5 }, (_, index) => ({
      id: `task-ceiling-${index + 1}`,
      repo: repoName,
      complexity: 'T3',
      description: 'Force success saturation while preserving measurable timing delta.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-ceiling.cjs',
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'ceiling mode\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    }));

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks,
      workerTypes: ['control', 'treatment'],
      maxTasks: 5,
      resolveExtraContext: async () => ['src/feature.ts'],
      minAgentCommandShare: 1,
      minAgentVerifiedExecutionShare: 1,
      minArtifactIntegrityShare: 1,
      maxVerificationFallbackShare: 0,
      minT3SuccessRateLift: 0.25,
      requireT3Significance: true,
      requireNoCriticalFailures: false,
    });

    expect(report.results).toHaveLength(10);
    expect(report.results.every((result) => !result.failureReason)).toBe(true);
    expect(report.t3PlusLift?.controlSuccessRate).toBe(1);
    expect(report.t3PlusLift?.treatmentSuccessRate).toBe(1);
    expect(report.t3PlusLift?.timeReduction ?? 0).toBeGreaterThan(0.05);
    expect(report.t3PlusLift?.agentCommandTimeReduction ?? 0).toBeGreaterThan(0.05);
    expect(
      report.gates.reasons.some((reason) => reason.startsWith('t3_plus_lift_below_threshold:'))
    ).toBe(false);
    expect(report.gates.reasons).not.toContain('t3_plus_not_statistically_significant');
    expect(report.gates.passed).toBe(true);
  });

  it('allows ceiling-mode parity in smoke runs when the ceiling time gate is disabled', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);

    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-ceiling-parity.cjs'),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const worker = process.env.AB_HARNESS_WORKER_TYPE || "control";',
        'const delayMs = worker === "control" ? 10 : 200;',
        'setTimeout(() => {',
        '  const featurePath = path.join(process.cwd(), "src", "feature.ts");',
        '  fs.writeFileSync(featurePath, "export function greet() { return \\"ceiling parity\\"; }\\n");',
        '  process.exit(0);',
        '}, delayMs);',
      ].join('\n'),
      'utf8'
    );

    const tasks: AbTaskDefinition[] = Array.from({ length: 5 }, (_, index) => ({
      id: `task-ceiling-parity-${index + 1}`,
      repo: repoName,
      complexity: 'T3',
      description: 'Force 100% success with slower treatment to validate optional ceiling gate.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-ceiling-parity.cjs',
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'ceiling parity\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    }));

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks,
      workerTypes: ['control', 'treatment'],
      maxTasks: 5,
      resolveExtraContext: async () => ['src/feature.ts'],
      minAgentCommandShare: 1,
      minAgentVerifiedExecutionShare: 1,
      minArtifactIntegrityShare: 1,
      maxVerificationFallbackShare: 0,
      minT3SuccessRateLift: 0,
      requireT3Significance: false,
      requireNoCriticalFailures: false,
      ...( { requireT3CeilingTimeReduction: false } as Record<string, unknown> ),
    });

    expect(report.t3PlusLift?.controlSuccessRate).toBe(1);
    expect(report.t3PlusLift?.treatmentSuccessRate).toBe(1);
    expect(report.t3PlusLift?.timeReduction ?? 0).toBeLessThan(0);
    expect(report.t3PlusLift?.agentCommandTimeReduction ?? 0).toBeLessThanOrEqual(0);
    expect(
      report.gates.reasons.some((reason) => reason.startsWith('t3_plus_ceiling_time_reduction_below_threshold:'))
    ).toBe(false);
    expect(report.gates.passed).toBe(true);
  });

  it('enforces ceiling-mode time gate for release evidence profile', async () => {
    const repoRoot = await createRepoFixture();
    const parent = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);

    await writeFile(
      path.join(repoRoot, 'scripts', 'agent-ceiling-release.cjs'),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const worker = process.env.AB_HARNESS_WORKER_TYPE || "control";',
        'const delayMs = worker === "control" ? 10 : 200;',
        'setTimeout(() => {',
        '  const featurePath = path.join(process.cwd(), "src", "feature.ts");',
        '  fs.writeFileSync(featurePath, "export function greet() { return \\"ceiling release\\"; }\\n");',
        '  process.exit(0);',
        '}, delayMs);',
      ].join('\n'),
      'utf8'
    );

    const tasks: AbTaskDefinition[] = Array.from({ length: 5 }, (_, index) => ({
      id: `task-ceiling-release-${index + 1}`,
      repo: repoName,
      complexity: 'T3',
      description: 'Release profile must reject saturated parity when treatment is slower.',
      contextLevel: 1,
      mode: 'agent_command',
      targetFiles: ['src/feature.ts'],
      agentExecution: {
        commandTemplate: 'node scripts/agent-ceiling-release.cjs',
      },
      verification: {
        tests: ['node -e "const fs=require(\'node:fs\');process.exit(fs.readFileSync(\'src/feature.ts\', \'utf8\').includes(\'ceiling release\') ? 0 : 1)"'],
      },
      contextByLevel: {
        L1: ['src/feature.ts'],
      },
    }));

    const report = await runAbExperiment({
      reposRoot: parent,
      tasks,
      workerTypes: ['control', 'treatment'],
      maxTasks: 5,
      resolveExtraContext: async () => ['src/feature.ts'],
      evidenceProfile: 'release',
      minAgentCommandShare: 1,
      minAgentVerifiedExecutionShare: 1,
      minArtifactIntegrityShare: 1,
      maxVerificationFallbackShare: 0,
      minT3SuccessRateLift: 0,
      requireT3Significance: false,
      requireNoCriticalFailures: false,
    });

    expect(report.t3PlusLift?.controlSuccessRate).toBe(1);
    expect(report.t3PlusLift?.treatmentSuccessRate).toBe(1);
    expect(report.t3PlusLift?.timeReduction ?? 0).toBeLessThan(0);
    expect(
      report.gates.reasons.some((reason) => reason.startsWith('t3_plus_ceiling_time_reduction_below_threshold:'))
    ).toBe(true);
    expect(report.gates.passed).toBe(false);
  });
});
