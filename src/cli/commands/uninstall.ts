import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import {
  INSTALL_MANIFEST_FILENAME,
  detectInstallDirectories,
  readInstallManifest,
} from '../../api/install_manifest.js';

export interface UninstallCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface UninstallReport {
  workspace: string;
  dryRun: boolean;
  keepIndex: boolean;
  manifestUsed: boolean;
  docsUpdated: string[];
  dependenciesRemoved: string[];
  packageJson: string | null;
  packageInstall: {
    attempted: boolean;
    skipped: boolean;
    command: string;
    success: boolean;
    error?: string;
  };
  directoriesRemoved: string[];
  warnings: string[];
  errors: string[];
}

const SECTION_START = '<!-- LIBRARIAN_DOCS_START -->';
const SECTION_END = '<!-- LIBRARIAN_DOCS_END -->';
const DEFAULT_DOC_FILES = [
  'AGENTS.md',
  'docs/AGENTS.md',
  'CLAUDE.md',
  'docs/CLAUDE.md',
  'CODEX.md',
  'docs/CODEX.md',
  '.github/AGENTS.md',
];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const PACKAGE_NAMES = ['librainian', 'librarian'] as const;

function toPosixRelative(workspace: string, value: string): string {
  const absolute = path.isAbsolute(value) ? value : path.join(workspace, value);
  return path.relative(workspace, absolute).split(path.sep).join('/');
}

function stripInjectedSections(content: string): { content: string; removedCount: number } {
  let next = content;
  let removedCount = 0;

  while (true) {
    const start = next.indexOf(SECTION_START);
    if (start === -1) break;
    const end = next.indexOf(SECTION_END, start);
    let removalStart = start;
    const separator = '\n\n---\n\n';
    if (removalStart >= separator.length && next.slice(removalStart - separator.length, removalStart) === separator) {
      removalStart -= separator.length;
    }
    let removalEnd = end === -1 ? next.length : end + SECTION_END.length;
    while (removalEnd < next.length && (next[removalEnd] === '\n' || next[removalEnd] === '\r')) {
      removalEnd += 1;
    }
    next = `${next.slice(0, removalStart)}${next.slice(removalEnd)}`;
    removedCount += 1;
  }

  return {
    content: next.replace(/\n{3,}/g, '\n\n'),
    removedCount,
  };
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function confirmUninstall(force: boolean): Promise<boolean> {
  if (force || truthy(process.env.LIBRARIAN_ASSUME_YES)) {
    return true;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Non-interactive uninstall requires --force (or global --yes).');
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question('This will remove LiBrainian artifacts from the workspace. Continue? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

export async function uninstallCommand(options: UninstallCommandOptions): Promise<void> {
  const workspace = path.resolve(options.workspace);
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      'dry-run': { type: 'boolean', default: false },
      'keep-index': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'no-install': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dryRun = values['dry-run'] as boolean;
  const keepIndex = values['keep-index'] as boolean;
  const force = values.force as boolean;
  const json = values.json as boolean;
  const noInstall = values['no-install'] as boolean;

  const report: UninstallReport = {
    workspace,
    dryRun,
    keepIndex,
    manifestUsed: false,
    docsUpdated: [],
    dependenciesRemoved: [],
    packageJson: null,
    packageInstall: {
      attempted: false,
      skipped: noInstall || dryRun,
      command: 'npm install',
      success: true,
    },
    directoriesRemoved: [],
    warnings: [],
    errors: [],
  };

  const proceed = dryRun ? true : await confirmUninstall(force);
  if (!proceed) {
    if (json) {
      console.log(JSON.stringify({ ...report, cancelled: true }, null, 2));
    } else {
      console.log('Uninstall cancelled.');
    }
    return;
  }

  const manifest = await readInstallManifest(workspace);
  report.manifestUsed = manifest !== null;

  const docsCandidates = new Set<string>();
  if (manifest) {
    for (const file of manifest.injected_docs_files) docsCandidates.add(file);
    for (const file of manifest.files_modified) {
      if (file.toLowerCase().endsWith('.md')) docsCandidates.add(file);
    }
  }
  for (const file of DEFAULT_DOC_FILES) {
    docsCandidates.add(file);
  }

  for (const candidate of docsCandidates) {
    const relative = toPosixRelative(workspace, candidate);
    const filePath = path.join(workspace, relative);
    if (!(await exists(filePath))) continue;
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const stripped = stripInjectedSections(content);
      if (stripped.removedCount === 0) continue;
      if (!dryRun) {
        await fs.writeFile(filePath, stripped.content, 'utf8');
      }
      report.docsUpdated.push(relative);
    } catch (error) {
      report.errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const packageJsonRelative = manifest?.package_json ?? (await exists(path.join(workspace, 'package.json')) ? 'package.json' : null);
  if (packageJsonRelative) {
    const packageJsonPath = path.join(workspace, packageJsonRelative);
    report.packageJson = packageJsonRelative;
    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      let mutated = false;

      for (const field of DEPENDENCY_FIELDS) {
        const section = parsed[field];
        if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
        const deps = section as Record<string, unknown>;
        for (const packageName of PACKAGE_NAMES) {
          if (typeof deps[packageName] === 'string') {
            delete deps[packageName];
            report.dependenciesRemoved.push(`${field}:${packageName}`);
            mutated = true;
          }
        }
      }

      if (mutated && !dryRun) {
        await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      }

      if (mutated && !dryRun && !noInstall) {
        report.packageInstall.attempted = true;
        const install = spawnSync('npm', ['install'], {
          cwd: path.dirname(packageJsonPath),
          encoding: 'utf8',
          stdio: 'pipe',
        });
        if (install.status !== 0) {
          report.packageInstall.success = false;
          const stderr = String(install.stderr ?? '').trim();
          const stdout = String(install.stdout ?? '').trim();
          report.packageInstall.error = [stdout, stderr].filter(Boolean).join('\n');
          report.errors.push(`npm install failed: ${report.packageInstall.error || `exit ${install.status ?? 'unknown'}`}`);
        }
      }
    } catch (error) {
      report.errors.push(`package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let directoryTargets = manifest?.directories_created ?? [];
  if (directoryTargets.length === 0) {
    directoryTargets = await detectInstallDirectories(workspace);
  }
  if (keepIndex) {
    directoryTargets = directoryTargets.filter((entry) => entry !== '.librarian');
  }

  for (const relative of Array.from(new Set(directoryTargets)).sort()) {
    const targetPath = path.resolve(workspace, relative);
    if (!targetPath.startsWith(workspace)) {
      report.warnings.push(`Skipped unsafe path outside workspace: ${relative}`);
      continue;
    }
    if (targetPath === workspace) {
      report.warnings.push(`Skipped unsafe workspace root removal target: ${relative}`);
      continue;
    }
    if (!(await exists(targetPath))) continue;
    try {
      if (!dryRun) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
      report.directoriesRemoved.push(relative);
    } catch (error) {
      report.errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestPath = path.join(workspace, INSTALL_MANIFEST_FILENAME);
  if (await exists(manifestPath)) {
    try {
      if (!dryRun) {
        await fs.rm(manifestPath, { force: true });
      }
    } catch (error) {
      report.errors.push(`${INSTALL_MANIFEST_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('LiBrainian Uninstall');
    console.log('====================\n');
    console.log(`Workspace: ${workspace}`);
    console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
    console.log(`Manifest: ${report.manifestUsed ? 'found' : 'not found (fallback scan)'}`);
    console.log(`Docs cleaned: ${report.docsUpdated.length}`);
    console.log(`Dependencies removed: ${report.dependenciesRemoved.length}`);
    console.log(`Directories removed: ${report.directoriesRemoved.length}`);
    if (keepIndex) {
      console.log('Index retained: yes (--keep-index)');
    }

    if (report.docsUpdated.length > 0) {
      console.log('\nUpdated docs:');
      for (const file of report.docsUpdated) {
        console.log(`  - ${file}`);
      }
    }
    if (report.dependenciesRemoved.length > 0) {
      console.log('\nDependency removals:');
      for (const dependency of report.dependenciesRemoved) {
        console.log(`  - ${dependency}`);
      }
    }
    if (report.directoriesRemoved.length > 0) {
      console.log('\nDirectories removed:');
      for (const dir of report.directoriesRemoved) {
        console.log(`  - ${dir}`);
      }
    }
    if (report.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of report.errors) {
        console.log(`  - ${error}`);
      }
    }
  }

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}
