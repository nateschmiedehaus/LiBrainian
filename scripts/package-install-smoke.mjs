import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
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
  const repoRoot = process.cwd();
  const packedName = run('npm', ['pack', '--silent'], { cwd: repoRoot }).split('\n').pop()?.trim();
  if (!packedName) {
    throw new Error('npm pack did not produce a tarball name');
  }

  const tarballPath = path.join(repoRoot, packedName);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-pack-smoke-'));
  const sandboxDir = path.join(tmpRoot, 'sandbox');
  await fs.mkdir(sandboxDir, { recursive: true });
  await fs.writeFile(
    path.join(sandboxDir, 'package.json'),
    JSON.stringify({ name: 'librainian-smoke', private: true, version: '0.0.0' }, null, 2)
  );

  try {
    run('npm', ['install', '--no-save', tarballPath], { cwd: sandboxDir });
    run('npx', ['--no-install', 'librainian', '--version'], { cwd: sandboxDir });
    run('npx', ['--no-install', 'librarian', '--version'], { cwd: sandboxDir });
    run(
      process.execPath,
      ['--input-type=module', '-e', 'import("librainian").then(() => process.exit(0)).catch(() => process.exit(1));'],
      { cwd: sandboxDir }
    );
    console.log(`[package:install-smoke] ok (${packedName})`);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tarballPath, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('[package:install-smoke] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
