import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface SandboxLifecycleInput {
  repoPath: string;
  mode?: 'copy' | 'reuse';
  sandboxRoot?: string;
  cleanupOnExit?: boolean;
}

export interface SandboxLifecycleOutput {
  sandboxPath: string;
  sourcePath: string;
  mode: 'copy' | 'reuse';
  created: boolean;
  cleanupOnExit: boolean;
}

export function createSandboxLifecycleConstruction(): Construction<
  SandboxLifecycleInput,
  SandboxLifecycleOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'sandbox-lifecycle',
    name: 'Sandbox Lifecycle',
    description: 'Creates/returns an isolated sandbox workspace for process execution.',
    async execute(input: SandboxLifecycleInput): Promise<SandboxLifecycleOutput> {
      const sourcePath = path.resolve(input.repoPath);
      const mode = input.mode ?? 'copy';
      const cleanupOnExit = input.cleanupOnExit !== false;

      if (mode === 'reuse') {
        return {
          sandboxPath: sourcePath,
          sourcePath,
          mode,
          created: false,
          cleanupOnExit: false,
        };
      }

      const sandboxRoot = input.sandboxRoot
        ? path.resolve(input.sandboxRoot)
        : path.join(os.tmpdir(), 'librainian-processes');
      await fs.mkdir(sandboxRoot, { recursive: true });
      const sandboxPath = await fs.mkdtemp(path.join(sandboxRoot, 'sandbox-'));
      await fs.cp(sourcePath, sandboxPath, {
        recursive: true,
        force: true,
      });

      return {
        sandboxPath,
        sourcePath,
        mode,
        created: true,
        cleanupOnExit,
      };
    },
  };
}
