import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.js';

export interface OpenclawDaemonCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type OpenclawDaemonAction = 'start' | 'status' | 'stop';

interface OpenclawDaemonState {
  running: boolean;
  pid?: number;
  workspace: string;
  openclawRoot: string;
  configPath: string;
  statePath: string;
  startedAt?: string;
  stoppedAt?: string;
  updatedAt: string;
  lastCommand: OpenclawDaemonAction;
}

interface OpenclawDaemonReport {
  success: boolean;
  action: OpenclawDaemonAction;
  running: boolean;
  pid?: number;
  workspace: string;
  openclawRoot: string;
  configPath: string;
  statePath: string;
  configRegistered: boolean;
  updatedAt: string;
}

function resolveHomeRelativePath(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  const home = os.homedir();
  if (!value) return fallback;
  if (value === '~') return home;
  if (value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }
  return path.resolve(value);
}

function toAction(value: string | undefined): OpenclawDaemonAction {
  if (value === 'start' || value === 'status' || value === 'stop') {
    return value;
  }
  throw new CliError(
    `Unknown or missing action: ${value ?? '<none>'}. Usage: librarian openclaw-daemon <start|status|stop> [--openclaw-root <path>] [--state-root <path>] [--json]`,
    'INVALID_ARGUMENT',
  );
}

function renderServiceEntry(workspace: string): string[] {
  const escapedWorkspace = workspace.replace(/"/g, '\\"');
  return [
    '  - name: librainian',
    `    command: npx librainian daemon --mode openclaw --foreground --workspace "${escapedWorkspace}"`,
    '    restartPolicy: always',
    '    healthCheck: http://localhost:7842/health',
    '    mcpEndpoint: http://localhost:7842/mcp',
  ];
}

function hasLibrainianService(configContent: string): boolean {
  return /(^|\n)\s*-\s*name:\s*librainian\s*($|\n)/m.test(configContent);
}

function ensureBackgroundServiceRegistration(configContent: string, workspace: string): string {
  const normalized = configContent.replace(/\r\n/g, '\n');
  if (hasLibrainianService(normalized)) return normalized;

  const lines = normalized.length > 0 ? normalized.split('\n') : [];
  const serviceLines = renderServiceEntry(workspace);
  const sectionStart = lines.findIndex((line) => /^\s*backgroundServices:\s*$/.test(line));

  if (sectionStart === -1) {
    const next = [...lines];
    if (next.length > 0 && next[next.length - 1].trim().length > 0) {
      next.push('');
    }
    next.push('backgroundServices:');
    next.push(...serviceLines);
    next.push('');
    return next.join('\n');
  }

  let insertAt = sectionStart + 1;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || /^\s*#/.test(line)) {
      insertAt = index + 1;
      continue;
    }
    if (/^\S/.test(line)) {
      insertAt = index;
      break;
    }
    insertAt = index + 1;
  }

  const merged = [
    ...lines.slice(0, insertAt),
    ...serviceLines,
    ...lines.slice(insertAt),
  ];
  if (merged.length === 0 || merged[merged.length - 1].trim().length > 0) {
    merged.push('');
  }
  return merged.join('\n');
}

async function readState(statePath: string): Promise<OpenclawDaemonState | null> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as OpenclawDaemonState;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeState(statePath: string, state: OpenclawDaemonState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function readConfig(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch {
    return '';
  }
}

async function writeConfig(configPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function toReport(state: OpenclawDaemonState, configRegistered: boolean): OpenclawDaemonReport {
  return {
    success: true,
    action: state.lastCommand,
    running: state.running,
    pid: state.pid,
    workspace: state.workspace,
    openclawRoot: state.openclawRoot,
    configPath: state.configPath,
    statePath: state.statePath,
    configRegistered,
    updatedAt: state.updatedAt,
  };
}

function printTextReport(report: OpenclawDaemonReport): void {
  console.log(`librainian openclaw-daemon ${report.action}`);
  console.log('================================');
  console.log(`Running: ${report.running ? 'yes' : 'no'}`);
  if (typeof report.pid === 'number') {
    console.log(`PID: ${report.pid}`);
  }
  console.log(`Workspace: ${report.workspace}`);
  console.log(`Config registered: ${report.configRegistered ? 'yes' : 'no'}`);
  console.log(`OpenClaw config: ${report.configPath}`);
  console.log(`State file: ${report.statePath}`);
  console.log(`Updated: ${report.updatedAt}`);
}

export async function openclawDaemonCommand(
  options: OpenclawDaemonCommandOptions,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      'openclaw-root': { type: 'string' },
      'state-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const action = toAction(positionals[0] ?? options.args[0]);
  const workspace = path.resolve(options.workspace);
  const openclawRoot = resolveHomeRelativePath(
    typeof values['openclaw-root'] === 'string' ? values['openclaw-root'] : undefined,
    path.join(os.homedir(), '.openclaw'),
  );
  const stateRoot = resolveHomeRelativePath(
    typeof values['state-root'] === 'string' ? values['state-root'] : undefined,
    path.join(os.homedir(), '.librainian', 'openclaw-daemon'),
  );
  const configPath = path.join(openclawRoot, 'config.yaml');
  const statePath = path.join(stateRoot, 'state.json');
  const jsonMode = Boolean(values.json);
  const now = new Date().toISOString();

  let configRegistered = false;
  const existingConfig = await readConfig(configPath);
  if (action === 'start') {
    const mergedConfig = ensureBackgroundServiceRegistration(existingConfig, workspace);
    await writeConfig(configPath, mergedConfig);
    configRegistered = hasLibrainianService(mergedConfig);
  } else {
    configRegistered = hasLibrainianService(existingConfig);
  }

  const prior = await readState(statePath);

  let nextState: OpenclawDaemonState;
  if (action === 'start') {
    nextState = {
      running: true,
      pid: process.pid,
      workspace,
      openclawRoot,
      configPath,
      statePath,
      startedAt: prior?.startedAt ?? now,
      updatedAt: now,
      lastCommand: action,
    };
    await writeState(statePath, nextState);
  } else if (action === 'stop') {
    nextState = {
      running: false,
      workspace: prior?.workspace ?? workspace,
      openclawRoot: prior?.openclawRoot ?? openclawRoot,
      configPath: prior?.configPath ?? configPath,
      statePath,
      startedAt: prior?.startedAt,
      stoppedAt: now,
      updatedAt: now,
      lastCommand: action,
    };
    await writeState(statePath, nextState);
  } else {
    nextState = prior ?? {
      running: false,
      workspace,
      openclawRoot,
      configPath,
      statePath,
      updatedAt: now,
      lastCommand: action,
    };
    if (!prior) {
      await writeState(statePath, nextState);
    } else {
      nextState = {
        ...prior,
        statePath,
        lastCommand: action,
        updatedAt: prior.updatedAt,
      };
    }
  }

  const report = toReport(nextState, configRegistered);
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printTextReport(report);
}
