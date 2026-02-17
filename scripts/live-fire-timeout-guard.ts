import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { findLingeringProcesses, parseProcessList } from '../src/utils/process_guard.js';

const execFileAsync = promisify(execFile);

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function main(): Promise<void> {
  const runResult = await runCommand('node', [
    'scripts/run-with-tmpdir.mjs',
    '--',
    'tsx',
    'src/cli/index.ts',
    'live-fire',
    '--profile',
    'hardcore',
    '--profiles-file',
    'config/live_fire_profiles.json',
    '--repos-root',
    'eval-corpus/external-repos',
    '--max-repos',
    '1',
    '--rounds',
    '1',
    '--llm-modes',
    'disabled',
    '--journey-timeout-ms',
    '1',
    '--smoke-timeout-ms',
    '1',
    '--json',
  ]);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const processList = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  const entries = parseProcessList(processList.stdout);
  const lingering = findLingeringProcesses({
    entries,
    includePatterns: ['src/cli/index.ts', 'live-fire'],
    excludePids: [process.pid],
  });

  const report = {
    schema: 'LiveFireTimeoutGuardReport.v1',
    createdAt: new Date().toISOString(),
    liveFireExitCode: runResult.exitCode,
    lingeringCount: lingering.length,
    lingering,
  };

  if (lingering.length > 0) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    schema: 'LiveFireTimeoutGuardReport.v1',
    createdAt: new Date().toISOString(),
    error: message,
  }, null, 2));
  process.exitCode = 1;
});
