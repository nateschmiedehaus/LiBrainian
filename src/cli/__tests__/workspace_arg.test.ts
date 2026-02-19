import { describe, it, expect } from 'vitest';
import { resolveWorkspaceArg } from '../workspace_arg.js';

describe('resolveWorkspaceArg', () => {
  it('uses positional workspace for eligible commands', () => {
    const result = resolveWorkspaceArg({
      command: 'bootstrap',
      commandArgs: ['/tmp/project', '--force'],
      rawArgs: ['bootstrap', '/tmp/project', '--force'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/tmp/project');
    expect(result.commandArgs).toEqual(['--force']);
  });

  it('does not override when --workspace is provided', () => {
    const result = resolveWorkspaceArg({
      command: 'bootstrap',
      commandArgs: ['/tmp/project'],
      rawArgs: ['bootstrap', '--workspace', '/explicit', '/tmp/project'],
      defaultWorkspace: '/explicit',
    });

    expect(result.workspace).toBe('/explicit');
    expect(result.commandArgs).toEqual(['/tmp/project']);
  });

  it('ignores positional args for commands with required positionals', () => {
    const result = resolveWorkspaceArg({
      command: 'query',
      commandArgs: ['find auth flow'],
      rawArgs: ['query', 'find auth flow'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/cwd');
    expect(result.commandArgs).toEqual(['find auth flow']);
  });

  it('ignores flag-like first args', () => {
    const result = resolveWorkspaceArg({
      command: 'status',
      commandArgs: ['--verbose'],
      rawArgs: ['status', '--verbose'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/cwd');
    expect(result.commandArgs).toEqual(['--verbose']);
  });

  it('supports positional workspace for publish-gate command', () => {
    const result = resolveWorkspaceArg({
      command: 'publish-gate',
      commandArgs: ['/tmp/project', '--json'],
      rawArgs: ['publish-gate', '/tmp/project', '--json'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/tmp/project');
    expect(result.commandArgs).toEqual(['--json']);
  });

  it('supports positional workspace for setup alias commands', () => {
    const result = resolveWorkspaceArg({
      command: 'setup',
      commandArgs: ['/tmp/project', '--depth', 'quick'],
      rawArgs: ['setup', '/tmp/project', '--depth', 'quick'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/tmp/project');
    expect(result.commandArgs).toEqual(['--depth', 'quick']);
  });

  it('supports positional workspace for check command', () => {
    const result = resolveWorkspaceArg({
      command: 'check',
      commandArgs: ['/tmp/project', '--diff', 'HEAD~1..HEAD'],
      rawArgs: ['check', '/tmp/project', '--diff', 'HEAD~1..HEAD'],
      defaultWorkspace: '/cwd',
    });

    expect(result.workspace).toBe('/tmp/project');
    expect(result.commandArgs).toEqual(['--diff', 'HEAD~1..HEAD']);
  });
});
