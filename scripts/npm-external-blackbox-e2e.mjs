#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
  });

  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return result.stdout?.trim() ?? '';
}

async function main() {
  const root = process.cwd();
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const packageName = String(packageJson.name ?? '').trim();
  const expectedVersion = String(packageJson.version ?? '').trim();
  if (!packageName || !expectedVersion) {
    throw new Error('package.json must include name and version');
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-npm-e2e-'));
  const externalWorkspace = path.join(tmpRoot, 'external-workspace');
  const fixtureWorkspace = path.join(tmpRoot, 'fixture-workspace');
  await fs.mkdir(externalWorkspace, { recursive: true });
  await fs.mkdir(path.join(fixtureWorkspace, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(externalWorkspace, 'package.json'),
    JSON.stringify({ name: 'librainian-e2e-external', private: true, version: '0.0.0' }, null, 2)
  );
  await fs.writeFile(
    path.join(fixtureWorkspace, 'src', 'index.ts'),
    'export function answer(): number { return 42; }\n'
  );

  try {
    run('npm', ['install', '--no-save', `${packageName}@latest`], { cwd: externalWorkspace });
    const installedPackageJsonPath = path.join(externalWorkspace, 'node_modules', packageName, 'package.json');
    const installedPackageJson = JSON.parse(await fs.readFile(installedPackageJsonPath, 'utf8'));
    const installedVersion = String(installedPackageJson.version ?? '').trim();
    if (installedVersion !== expectedVersion) {
      throw new Error(`Expected installed ${packageName} version ${expectedVersion}, received ${installedVersion}`);
    }

    const bin = installedPackageJson.bin;
    const binMap = typeof bin === 'string'
      ? { librainian: bin, librarian: bin }
      : (bin ?? {});
    const librainianBin = typeof binMap.librainian === 'string' ? binMap.librainian : null;
    if (!librainianBin) {
      throw new Error(`Installed ${packageName} package is missing librainian CLI bin`);
    }

    run(process.execPath, [path.join(externalWorkspace, 'node_modules', packageName, librainianBin), '--version'], {
      cwd: externalWorkspace,
    });

    const runtimeScript = `
      import { initializeLibrarian } from '${packageName}';
      import path from 'node:path';
      const workspace = process.argv[1];
      const session = await initializeLibrarian(workspace, {
        silent: true,
        skipLlm: true,
        skipWatcher: true,
        skipHealing: true,
      });
      const context = await session.query('Where is answer defined?');
      if (!context || typeof context !== 'object' || !('packIds' in context)) {
        throw new Error('Unexpected context shape from initializeLibrarian().query()');
      }
      if (typeof session.shutdown === 'function') {
        await session.shutdown();
      }
    `;

    run(
      process.execPath,
      ['--input-type=module', '-e', runtimeScript, fixtureWorkspace],
      {
        cwd: externalWorkspace,
        env: {
          LIBRARIAN_TEST_MODE: 'unit',
        },
      }
    );

    console.log(`[test:e2e:reality] ok (${packageName}@${installedVersion})`);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('[test:e2e:reality] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
