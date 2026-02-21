import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface CliOutputSanityGateInput {
  repoRoot?: string;
  cliEntry?: string;
  maxDurationMs?: number;
  commandTimeoutMs?: number;
  registeredCommands?: string[];
}

export interface CliOutputProbeResult {
  args: string[];
  expectedExit: 'zero' | 'non-zero';
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  parseableJson: boolean;
  hasDebugNoise: boolean;
  hasStackTrace: boolean;
  hasDoubleOutput: boolean;
  pass: boolean;
  findings: string[];
}

export interface CliHelpValidation {
  listedCommands: string[];
  unknownListed: string[];
  missingListed: string[];
  pass: boolean;
}

export interface CliOutputSanityGateSnapshots {
  globalHelpHead: string[];
  queryHelpHead: string[];
  statusJsonKeys: string[];
}

export interface CliOutputSanityGateOutput {
  kind: 'CliOutputSanityGateResult.v1';
  pass: boolean;
  commandCount: number;
  commandResults: CliOutputProbeResult[];
  helpValidation: CliHelpValidation;
  snapshots: CliOutputSanityGateSnapshots;
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

type CliProbe = {
  args: string[];
  expectedExit: 'zero' | 'non-zero';
  expectJson?: boolean;
  snapshotKey?: 'globalHelp' | 'queryHelp' | 'statusJson';
};

const DEFAULT_CLI_ENTRY = 'src/cli/index.ts';
const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

function normalizeLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.replace(/\r/gu, '').trimEnd());
}

function hasDebugNoise(output: string): boolean {
  return /\bDEBUG:/u.test(output) || /\[debug\]/iu.test(output);
}

function hasStackTrace(output: string): boolean {
  return /(^|\n)\s*at\s+[^\n(]+\([^)]*\)/u.test(output);
}

function isIgnorableDuplicateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^[-=*_]{3,}$/u.test(trimmed);
}

function hasDoubleOutput(output: string): boolean {
  const lines = normalizeLines(output);
  for (let i = 1; i < lines.length; i += 1) {
    const current = lines[i] ?? '';
    const prev = lines[i - 1] ?? '';
    if (current === prev && !isIgnorableDuplicateLine(current)) {
      return true;
    }
  }
  return false;
}

function parseJsonOutput(output: string): { ok: boolean; keys: string[] } {
  const trimmed = output.trim();
  if (!trimmed) {
    return { ok: false, keys: [] };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, keys: Object.keys(parsed).sort() };
    }
    return { ok: true, keys: [] };
  } catch {
    return { ok: false, keys: [] };
  }
}

async function extractRegisteredCommands(repoRoot: string, cliEntry: string): Promise<string[]> {
  const absoluteCliEntry = path.isAbsolute(cliEntry)
    ? cliEntry
    : path.join(repoRoot, cliEntry);
  const source = await fs.readFile(absoluteCliEntry, 'utf8');
  const match = source.match(/type Command = ([\s\S]*?);/u);
  if (!match) {
    throw new Error(`unable to parse CLI command union from ${absoluteCliEntry}`);
  }
  const commands = Array.from(match[1].matchAll(/'([^']+)'/gu))
    .map((entry) => entry[1] ?? '')
    .filter((command) => command.length > 0);
  return Array.from(new Set(commands));
}

function extractHelpCommands(helpOutput: string): string[] {
  const lines = normalizeLines(helpOutput);
  const commands: string[] = [];
  let inCommandsBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inCommandsBlock) {
      if (trimmed === 'COMMANDS:') {
        inCommandsBlock = true;
      }
      continue;
    }

    if (trimmed === 'ADVANCED:' || trimmed === 'GLOBAL OPTIONS:' || trimmed === 'EXAMPLES:') {
      break;
    }
    if (!trimmed) continue;

    const token = trimmed.split(/\s+/u)[0] ?? '';
    if (token) {
      commands.push(token);
    }
  }

  return Array.from(new Set(commands));
}

function buildProbePlan(registeredCommands: string[]): CliProbe[] {
  const probes: CliProbe[] = [
    { args: ['help'], expectedExit: 'zero', snapshotKey: 'globalHelp' },
    { args: ['help', 'query'], expectedExit: 'zero', snapshotKey: 'queryHelp' },
    { args: ['status', '--json'], expectedExit: 'zero', expectJson: true, snapshotKey: 'statusJson' },
    { args: ['features', '--json'], expectedExit: 'zero', expectJson: true },
    { args: ['definitely-not-a-command'], expectedExit: 'non-zero' },
  ];

  for (const command of registeredCommands) {
    probes.push({ args: ['help', command], expectedExit: 'zero' });
  }

  const seen = new Set<string>();
  return probes.filter((probe) => {
    const key = `${probe.expectedExit}:${probe.args.join('\u001f')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runCliProbe(
  repoRoot: string,
  cliEntry: string,
  probe: CliProbe,
  timeoutMs: number,
): Promise<CliOutputProbeResult> {
  const startedAt = Date.now();
  const absoluteCliEntry = path.isAbsolute(cliEntry)
    ? cliEntry
    : path.join(repoRoot, cliEntry);
  const nodeArgs = ['--import', 'tsx', absoluteCliEntry, ...probe.args];

  return await new Promise<CliOutputProbeResult>((resolve) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: '1',
        LIBRARIAN_LOG_LEVEL: process.env.LIBRARIAN_LOG_LEVEL ?? 'silent',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    const finalize = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const combined = `${stdout}\n${stderr}`;
      const jsonParse = probe.expectJson ? parseJsonOutput(stdout) : { ok: false, keys: [] };
      const findings: string[] = [];
      const expectedExitCode = probe.expectedExit === 'zero' ? 0 : 1;
      const passExit =
        probe.expectedExit === 'zero'
          ? exitCode === 0
          : typeof exitCode === 'number' && exitCode !== 0;
      if (!passExit) {
        findings.push(
          `exit code mismatch: expected ${probe.expectedExit === 'zero' ? '0' : 'non-zero'}, got ${String(exitCode)}`,
        );
      }

      const debugNoise = hasDebugNoise(combined);
      if (debugNoise) {
        findings.push('debug noise detected (contains DEBUG markers)');
      }

      const stackTrace = hasStackTrace(combined);
      if (stackTrace && exitCode === 0) {
        findings.push('stack trace detected in successful command output');
      }

      const repeated = hasDoubleOutput(combined);
      if (repeated) {
        findings.push('double/repeated output detected');
      }

      if (probe.expectJson && !jsonParse.ok) {
        findings.push('expected JSON output was not parseable');
      }

      if (timedOut) {
        findings.push(`command timed out after ${timeoutMs}ms`);
      }

      resolve({
        args: probe.args,
        expectedExit: probe.expectedExit,
        exitCode: timedOut ? null : exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        parseableJson: probe.expectJson ? jsonParse.ok : false,
        hasDebugNoise: debugNoise,
        hasStackTrace: stackTrace,
        hasDoubleOutput: repeated,
        pass: findings.length === 0,
        findings,
      });
    };

    child.on('error', () => finalize(null));
    child.on('close', (code) => finalize(code));
  });
}

function snapshotHead(output: string, lines = 20): string[] {
  return normalizeLines(output)
    .filter((line) => line.trim().length > 0)
    .slice(0, lines);
}

export function createCliOutputSanityGateConstruction(): Construction<
  CliOutputSanityGateInput,
  CliOutputSanityGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'cli-output-sanity-gate',
    name: 'CLI Output Sanity Gate',
    description: 'Validates CLI output quality, exit codes, help accuracy, and parseability for agent-safe usage.',
    async execute(input: CliOutputSanityGateInput = {}): Promise<CliOutputSanityGateOutput> {
      const startedAt = Date.now();
      const repoRoot = input.repoRoot ?? process.cwd();
      const cliEntry = input.cliEntry ?? DEFAULT_CLI_ENTRY;
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const commandTimeoutMs = input.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

      const registeredCommands = input.registeredCommands
        ? Array.from(new Set(input.registeredCommands))
        : await extractRegisteredCommands(repoRoot, cliEntry);
      const probes = buildProbePlan(registeredCommands);
      const commandResults: CliOutputProbeResult[] = [];
      const findings: string[] = [];

      for (const probe of probes) {
        const result = await runCliProbe(repoRoot, cliEntry, probe, commandTimeoutMs);
        commandResults.push(result);
        if (!result.pass) {
          findings.push(
            `${probe.args.join(' ')}: ${result.findings.join('; ')}`,
          );
        }
      }

      const globalHelp = commandResults.find((result) => result.args.join(' ') === 'help');
      const listedCommands = extractHelpCommands(globalHelp?.stdout ?? '');
      const registeredSet = new Set(registeredCommands);
      const listedSet = new Set(listedCommands);
      const unknownListed = listedCommands.filter((command) => !registeredSet.has(command));
      const missingListed = registeredCommands.filter((command) => !listedSet.has(command));
      const helpValidation: CliHelpValidation = {
        listedCommands,
        unknownListed,
        missingListed,
        pass: unknownListed.length === 0,
      };

      if (unknownListed.length > 0) {
        findings.push(`help lists unknown command(s): ${unknownListed.join(', ')}`);
      }

      const queryHelp = commandResults.find((result) => result.args.join(' ') === 'help query');
      const statusJson = commandResults.find((result) => result.args.join(' ') === 'status --json');
      const statusKeys = parseJsonOutput(statusJson?.stdout ?? '').keys;
      const snapshots: CliOutputSanityGateSnapshots = {
        globalHelpHead: snapshotHead(globalHelp?.stdout ?? ''),
        queryHelpHead: snapshotHead(queryHelp?.stdout ?? ''),
        statusJsonKeys: statusKeys,
      };

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`duration exceeded: ${durationMs}ms > ${maxDurationMs}ms`);
      }

      return {
        kind: 'CliOutputSanityGateResult.v1',
        pass: findings.length === 0,
        commandCount: commandResults.length,
        commandResults,
        helpValidation,
        snapshots,
        findings,
        durationMs,
        maxDurationMs,
      };
    },
  };
}
