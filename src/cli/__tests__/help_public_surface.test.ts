import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = path.join(process.cwd(), 'src', 'cli', 'index.ts');
const packageJsonPath = path.join(process.cwd(), 'package.json');

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

describe('public help surface', () => {
  it('keeps top-level help focused and duplicate-free', () => {
    const help = getCommandHelp('main');
    expect(help).toContain('CORE COMMANDS:');
    expect(help).toContain('INTEGRATION AND AUTOMATION:');
    expect(help).toContain('MAINTAINER-ONLY COMMANDS:');
    expect(help.match(/^\s+export\s+/gm) ?? []).toHaveLength(1);
    expect(help.match(/^\s+import\s+/gm) ?? []).toHaveLength(1);
    expect(help).not.toContain('feedback <token>');
    expect(help).not.toContain('inspect <module>');
    expect(help).not.toContain('confidence <entity>');
    expect(help).not.toContain('validate <file>');
    expect(help).not.toContain('repair              ');
    expect(help).not.toContain('evolve              ');
    expect(help).not.toContain('publish-gate        ');
    expect(help).not.toContain('live-fire           ');
    expect(help).not.toContain('check               ');
    expect(help).not.toContain('install-openclaw-skill');
    expect(help).not.toContain('openclaw-daemon');
    expect(help).not.toContain('memory-bridge');
  });

  it('routes <command> --help to command-specific help', () => {
    const result = runCli(['quickstart', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('librainian quickstart');
    expect(result.stdout).toContain('Quickstart fails closed when semantic embeddings are unavailable');
    expect(result.stdout).not.toContain('--update-agent-docs');
    expect(result.stdout).not.toContain('CORE COMMANDS:');
  });

  it('keeps maintainer-only bootstrap mutation flags out of public help', () => {
    const result = runCli(['bootstrap', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('librainian bootstrap');
    expect(result.stdout).not.toContain('--update-agent-docs');
    expect(result.stdout).not.toContain('--no-claude-md');
  });

  it('prints the package version from package.json', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`librainian ${pkg.version}`);
  });

  it('does not expose removed help-only commands as real commands', () => {
    const result = runCli(['help', 'repair']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unknown command: repair');
  });

  it('hides maintainer-only commands from public help by default', () => {
    const result = runCli(['help', 'publish-gate']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Command unavailable in the public release surface: publish-gate');
  });

  it('hides unstable advanced commands from the public help surface', () => {
    const result = runCli(['help', 'check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Command unavailable in the public release surface: check');
  });

  it('hides internal maintenance commands from command help by default', () => {
    const result = runCli(['help', 'stats']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Command unavailable in the public release surface: stats');
  });

  it('hides deferred OpenClaw commands from public command help by default', () => {
    const result = runCli(['help', 'install-openclaw-skill']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unknown command: install-openclaw-skill');
    expect(result.stdout).not.toContain('Install the official OpenClaw LiBrainian skill');
  });

  it('does not advertise removed OpenClaw daemon commands in public help', () => {
    const result = runCli(['help', 'openclaw-daemon']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unknown command: openclaw-daemon');
    expect(result.stdout).not.toContain('Manage OpenClaw daemon registration');
  });

  it('blocks init scaffolding flags on the public CLI surface', () => {
    const result = runCli(['init', '--construction', 'SafeRefactorAdvisor', '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Init scaffolding flags are unavailable in the public release surface');
  });

  it('blocks maintainer-only bootstrap doc mutation flags on the public CLI surface', () => {
    const result = runCli(['bootstrap', '--update-agent-docs']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Bootstrap agent-doc mutation flags are unavailable in the public release surface');
  });
});
