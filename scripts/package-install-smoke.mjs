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

function runAllowFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: false,
  });

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function assertNoModuleResolutionCrash(result, commandLabel) {
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (
    /ERR_MODULE_NOT_FOUND/.test(combined)
    || /Cannot find module/.test(combined)
    || /Cannot find package/.test(combined)
  ) {
    throw new Error(
      `${commandLabel} hit module-resolution crash after package install:\n${combined}`
    );
  }
}

function parsePackOutput(rawOutput) {
  const output = rawOutput.trim();
  if (!output) {
    throw new Error('npm pack returned empty output');
  }

  try {
    return JSON.parse(output);
  } catch {
    // Lifecycle hooks can write plain text before npm's JSON payload.
    const firstArray = output.indexOf('[');
    const firstObject = output.indexOf('{');
    const startCandidates = [firstArray, firstObject].filter((index) => index >= 0);
    if (startCandidates.length === 0) {
      throw new Error(`Unable to locate JSON payload in npm pack output:\n${output}`);
    }
    const start = Math.min(...startCandidates);
    const endArray = output.lastIndexOf(']');
    const endObject = output.lastIndexOf('}');
    const end = Math.max(endArray, endObject);
    if (end < start) {
      throw new Error(`Unable to locate JSON terminator in npm pack output:\n${output}`);
    }
    return JSON.parse(output.slice(start, end + 1).trim());
  }
}

async function main() {
  const repoRoot = process.cwd();
  const cliEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');
  try {
    await fs.access(cliEntry);
  } catch {
    run('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }

  const rawPackOutput = run('npm', ['pack', '--json', '--silent'], { cwd: repoRoot });
  const parsedPackOutput = parsePackOutput(rawPackOutput);
  const packedName = Array.isArray(parsedPackOutput)
    ? parsedPackOutput[0]?.filename
    : undefined;
  if (!packedName) {
    throw new Error('npm pack did not produce a tarball name');
  }

  const tarballPath = path.join(repoRoot, packedName);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-pack-smoke-'));
  const sandboxDir = path.join(tmpRoot, 'sandbox');
  const workspaceDir = path.join(tmpRoot, 'workspace');
  await fs.mkdir(sandboxDir, { recursive: true });
  await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(sandboxDir, 'package.json'),
    JSON.stringify({ name: 'librainian-smoke', private: true, version: '0.0.0' }, null, 2)
  );
  await fs.writeFile(path.join(workspaceDir, 'src', 'index.ts'), 'export const smoke = true;\n');

  try {
    run('npm', ['install', '--no-save', tarballPath], { cwd: sandboxDir });
    const installedPackageJsonPath = path.join(sandboxDir, 'node_modules', 'librainian', 'package.json');
    const installedPackageJson = JSON.parse(await fs.readFile(installedPackageJsonPath, 'utf8'));
    const bin = installedPackageJson?.bin;
    const binMap = typeof bin === 'string'
      ? { librainian: bin, librarian: bin }
      : (bin ?? {});
    const librainianBin = typeof binMap.librainian === 'string' ? binMap.librainian : null;
    const librarianBin = typeof binMap.librarian === 'string' ? binMap.librarian : null;

    if (!librainianBin || !librarianBin) {
      throw new Error('Installed package is missing expected bin entries for librainian/librarian.');
    }

    const librainianEntry = path.join(sandboxDir, 'node_modules', 'librainian', librainianBin);
    const librarianEntry = path.join(sandboxDir, 'node_modules', 'librainian', librarianBin);

    run(
      process.execPath,
      [librainianEntry, '--version'],
      { cwd: sandboxDir },
    );
    run(
      process.execPath,
      [librarianEntry, '--version'],
      { cwd: sandboxDir },
    );

    const statusResult = runAllowFailure(
      process.execPath,
      [librainianEntry, 'status', '--json'],
      { cwd: workspaceDir },
    );
    assertNoModuleResolutionCrash(statusResult, 'librainian status --json');

    const queryResult = runAllowFailure(
      process.execPath,
      [librainianEntry, 'query', 'smoke check', '--json', '--no-bootstrap', '--no-synthesis'],
      { cwd: workspaceDir },
    );
    assertNoModuleResolutionCrash(queryResult, 'librainian query "smoke check" --json --no-bootstrap --no-synthesis');

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
