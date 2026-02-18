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

function parseArgs(argv) {
  let keep = false;
  let workspace = process.cwd();
  const separatorIndex = argv.indexOf('--');
  const scriptArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const cliArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  for (let index = 0; index < scriptArgs.length; index += 1) {
    const arg = scriptArgs[index];
    if (arg === '--keep') {
      keep = true;
      continue;
    }
    if (arg === '--workspace') {
      const next = scriptArgs[index + 1];
      if (!next) throw new Error('--workspace requires a value');
      workspace = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { keep, workspace, cliArgs };
}

async function main() {
  const repoRoot = process.cwd();
  const { keep, workspace, cliArgs } = parseArgs(process.argv.slice(2));
  const packagedName = run('npm', ['pack', '--silent'], { cwd: repoRoot }).split('\n').pop()?.trim();
  if (!packagedName) {
    throw new Error('npm pack did not return a tarball name');
  }

  const tarballPath = path.join(repoRoot, packagedName);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-dogfood-'));
  const sandboxDir = path.join(tmpRoot, 'sandbox');
  await fs.mkdir(sandboxDir, { recursive: true });
  await fs.writeFile(
    path.join(sandboxDir, 'package.json'),
    JSON.stringify({ name: 'librainian-dogfood', private: true, version: '0.0.0' }, null, 2),
    'utf8'
  );

  const commandArgs = cliArgs.length > 0
    ? [...cliArgs]
    : ['status', '--format', 'json'];

  if (!commandArgs.includes('--workspace')) {
    commandArgs.push('--workspace', workspace);
  }

  try {
    run('npm', ['install', '--no-save', tarballPath], { cwd: sandboxDir, stdio: 'inherit' });
    run(process.execPath, ['./node_modules/.bin/librainian', ...commandArgs], {
      cwd: sandboxDir,
      stdio: 'inherit',
    });

    if (keep) {
      console.log(`[dogfood] kept sandbox: ${sandboxDir}`);
    } else {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      console.log('[dogfood] sandbox removed');
    }
  } finally {
    await fs.rm(tarballPath, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('[dogfood] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
