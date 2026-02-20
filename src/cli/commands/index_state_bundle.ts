import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { LIBRARIAN_VERSION } from '../../index.js';
import { CliError } from '../errors.js';
import { emitJsonOutput } from '../json_output.js';

const INDEX_BUNDLE_FILES = ['librarian.sqlite', 'knowledge.db', 'evidence_ledger.db', 'hnsw.bin'] as const;
const SQL_PLACEHOLDER = '<workspace>';
const BUNDLE_SCHEMA_VERSION = 1;

interface IndexBundleManifestV1 {
  schemaVersion: 1;
  exportedAt: string;
  librarianVersion: string;
  workspacePlaceholder: string;
  gitHeadSha: string | null;
  files: string[];
  checksums: Record<string, string>;
}

export interface IndexStateBundleCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface SqliteColumnInfo {
  name: string;
  type: string;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isTextLikeColumn(typeName: string): boolean {
  const normalized = typeName.trim().toUpperCase();
  if (normalized.length === 0) return true;
  return /CHAR|CLOB|TEXT|VARCHAR|JSON/.test(normalized);
}

function getWorkspaceNeedles(workspaceRoot: string): string[] {
  const resolved = path.resolve(workspaceRoot);
  const posixStyle = resolved.replace(/\\/g, '/');
  const windowsStyle = resolved.replace(/\//g, '\\');
  const needles = new Set<string>([resolved, posixStyle, windowsStyle]);
  return Array.from(needles).filter((value) => value.length > 1).sort((a, b) => b.length - a.length);
}

function getPortableWorkspaceValue(workspaceRoot: string): string {
  return path.resolve(workspaceRoot).replace(/\\/g, '/');
}

function ensureTarAvailable(): void {
  const check = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new CliError(
      'System tar command is required for index export/import but is not available on PATH.',
      'INVALID_ARGUMENT',
    );
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

async function sqliteBackup(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await sourceDb.backup(destinationPath);
  } finally {
    sourceDb.close();
  }
}

function listTextColumns(db: Database.Database, tableName: string): SqliteColumnInfo[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteSqlString(tableName)})`).all() as Array<{ name: string; type?: string }>;
  return rows
    .map((row) => ({ name: row.name, type: String(row.type ?? '') }))
    .filter((row) => isTextLikeColumn(row.type));
}

function replaceTextInSqlite(dbPath: string, replacements: Array<{ from: string; to: string }>): number {
  if (replacements.length === 0) return 0;
  const db = new Database(dbPath);
  let totalChanges = 0;
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>;

    const run = db.transaction(() => {
      for (const table of tables) {
        const columns = listTextColumns(db, table.name);
        if (columns.length === 0) continue;
        const tableId = quoteIdentifier(table.name);
        for (const column of columns) {
          const columnId = quoteIdentifier(column.name);
          for (const replacement of replacements) {
            const statement = db.prepare(
              `UPDATE ${tableId}
               SET ${columnId} = replace(${columnId}, ?, ?)
               WHERE instr(${columnId}, ?) > 0`
            );
            const info = statement.run(replacement.from, replacement.to, replacement.from);
            totalChanges += info.changes;
          }
        }
      }
    });

    run();
  } finally {
    db.close();
  }
  return totalChanges;
}

function createManifest(input: {
  files: string[];
  checksums: Record<string, string>;
  workspacePlaceholder: string;
  gitHeadSha: string | null;
}): IndexBundleManifestV1 {
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    librarianVersion: LIBRARIAN_VERSION.string,
    workspacePlaceholder: input.workspacePlaceholder,
    gitHeadSha: input.gitHeadSha,
    files: [...input.files].sort(),
    checksums: { ...input.checksums },
  };
}

function resolveGitHeadSha(workspaceRoot: string): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const sha = String(result.stdout ?? '').trim();
  return sha.length > 0 ? sha : null;
}

async function createTarball(params: {
  stagingDir: string;
  outputPath: string;
  files: string[];
}): Promise<void> {
  const sortedFiles = [...params.files].sort();
  const epochSeconds = 0;
  for (const relative of sortedFiles) {
    const absolute = path.join(params.stagingDir, relative);
    await fs.utimes(absolute, epochSeconds, epochSeconds).catch(() => undefined);
  }

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
  const deterministicArgs = [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    params.outputPath,
    '-C',
    params.stagingDir,
    ...sortedFiles,
  ];
  let tar = spawnSync('tar', deterministicArgs, { encoding: 'utf8' });

  if (tar.status !== 0) {
    tar = spawnSync('tar', ['-czf', params.outputPath, '-C', params.stagingDir, ...sortedFiles], {
      encoding: 'utf8',
    });
  }

  if (tar.status !== 0) {
    const detail = String(tar.stderr ?? tar.stdout ?? '').trim();
    throw new CliError(
      `Failed to create tarball at ${params.outputPath}: ${detail || 'tar command failed'}`,
      'STORAGE_ERROR',
    );
  }
}

async function extractTarball(inputPath: string, outputDir: string): Promise<void> {
  const extract = spawnSync('tar', ['-xzf', inputPath, '-C', outputDir], { encoding: 'utf8' });
  if (extract.status !== 0) {
    const detail = String(extract.stderr ?? extract.stdout ?? '').trim();
    throw new CliError(
      `Failed to extract bundle ${inputPath}: ${detail || 'tar command failed'}`,
      'STORAGE_ERROR',
    );
  }
}

function parseMajorVersion(version: string): number | null {
  const majorText = version.split('.')[0];
  const major = Number.parseInt(majorText ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

async function readManifest(stagingDir: string): Promise<IndexBundleManifestV1> {
  const manifestPath = path.join(stagingDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<IndexBundleManifestV1>;
  if (parsed.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new CliError(
      `Unsupported bundle schema version ${String(parsed.schemaVersion)} (expected ${BUNDLE_SCHEMA_VERSION}).`,
      'INVALID_ARGUMENT',
    );
  }
  if (!Array.isArray(parsed.files) || parsed.files.some((file) => typeof file !== 'string')) {
    throw new CliError('Invalid bundle manifest: "files" must be a string array.', 'INVALID_ARGUMENT');
  }
  if (typeof parsed.workspacePlaceholder !== 'string' || parsed.workspacePlaceholder.length === 0) {
    throw new CliError('Invalid bundle manifest: missing workspace placeholder.', 'INVALID_ARGUMENT');
  }
  if (typeof parsed.librarianVersion !== 'string' || parsed.librarianVersion.length === 0) {
    throw new CliError('Invalid bundle manifest: missing Librarian version.', 'INVALID_ARGUMENT');
  }
  const major = parseMajorVersion(parsed.librarianVersion);
  if (major !== null && major !== LIBRARIAN_VERSION.major) {
    throw new CliError(
      `Bundle major version ${parsed.librarianVersion} is incompatible with current Librarian ${LIBRARIAN_VERSION.string}.`,
      'INVALID_ARGUMENT',
    );
  }
  return {
    schemaVersion: parsed.schemaVersion,
    exportedAt: String(parsed.exportedAt ?? ''),
    librarianVersion: parsed.librarianVersion,
    workspacePlaceholder: parsed.workspacePlaceholder,
    gitHeadSha: typeof parsed.gitHeadSha === 'string' ? parsed.gitHeadSha : null,
    files: parsed.files,
    checksums: typeof parsed.checksums === 'object' && parsed.checksums ? parsed.checksums : {},
  };
}

export async function exportIndexStateCommand(options: IndexStateBundleCommandOptions): Promise<void> {
  ensureTarAvailable();
  const workspaceRoot = path.resolve(options.workspace);
  const { values, positionals } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      output: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const positionalOutput = positionals[0];
  const outputPath = path.resolve(
    (typeof values.output === 'string' && values.output.length > 0)
      ? values.output
      : (typeof positionalOutput === 'string' && positionalOutput.length > 0)
        ? positionalOutput
        : path.join(workspaceRoot, '.librarian', 'exports', 'librarian-index.tar.gz')
  );
  const json = Boolean(values.json);
  const out = typeof values.out === 'string' ? values.out : undefined;

  const librarianDir = path.join(workspaceRoot, '.librarian');
  const entries = await fs.readdir(librarianDir).catch(() => {
    throw new CliError(
      `Index directory not found at ${librarianDir}. Run "librarian bootstrap" before export.`,
      'NOT_BOOTSTRAPPED',
    );
  });
  if (!entries.includes('librarian.sqlite')) {
    throw new CliError(
      `Missing ${path.join('.librarian', 'librarian.sqlite')}. Run "librarian bootstrap" before export.`,
      'NOT_BOOTSTRAPPED',
    );
  }

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-index-export-'));
  try {
    const filesToBundle: string[] = [];
    const checksums: Record<string, string> = {};
    const workspaceNeedles = getWorkspaceNeedles(workspaceRoot);
    const portableWorkspace = getPortableWorkspaceValue(workspaceRoot);

    for (const file of INDEX_BUNDLE_FILES) {
      const source = path.join(librarianDir, file);
      const exists = await fs.access(source).then(() => true).catch(() => false);
      if (!exists) continue;

      const staged = path.join(stagingDir, file);
      if (file.endsWith('.sqlite') || file.endsWith('.db')) {
        await sqliteBackup(source, staged);
        replaceTextInSqlite(
          staged,
          workspaceNeedles.map((needle) => ({ from: needle, to: SQL_PLACEHOLDER })),
        );
      } else {
        await fs.copyFile(source, staged);
      }

      filesToBundle.push(file);
      checksums[file] = await computeFileSha256(staged);
    }

    if (filesToBundle.length === 0) {
      throw new CliError('No index artifacts found to export.', 'INVALID_ARGUMENT');
    }

    const manifest = createManifest({
      files: filesToBundle,
      checksums,
      workspacePlaceholder: SQL_PLACEHOLDER,
      gitHeadSha: resolveGitHeadSha(workspaceRoot),
    });
    const manifestPath = path.join(stagingDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    filesToBundle.push('manifest.json');

    await createTarball({
      stagingDir,
      outputPath,
      files: filesToBundle,
    });

    const payload = {
      success: true,
      workspace: workspaceRoot,
      outputPath,
      files: manifest.files,
      librarianVersion: LIBRARIAN_VERSION.string,
      workspacePlaceholder: manifest.workspacePlaceholder,
      gitHeadSha: manifest.gitHeadSha,
      portableWorkspaceRoot: portableWorkspace,
    };

    if (json) {
      await emitJsonOutput(payload, out);
      return;
    }

    console.log('Index Export');
    console.log('============\n');
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Output: ${outputPath}`);
    console.log(`Files: ${manifest.files.join(', ')}`);
    console.log(`Workspace placeholder: ${manifest.workspacePlaceholder}`);
    console.log(`Git HEAD: ${manifest.gitHeadSha ?? 'unknown'}`);
    console.log();
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

export async function importIndexStateCommand(options: IndexStateBundleCommandOptions): Promise<void> {
  ensureTarAvailable();
  const workspaceRoot = path.resolve(options.workspace);
  const { values, positionals } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      input: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const positionalInput = positionals[0];
  const inputPath = path.resolve(
    (typeof values.input === 'string' && values.input.length > 0)
      ? values.input
      : (typeof positionalInput === 'string' && positionalInput.length > 0)
        ? positionalInput
        : ''
  );
  if (inputPath.length === 0) {
    throw new CliError('Missing bundle input path. Use --input <bundle.tar.gz>.', 'INVALID_ARGUMENT');
  }

  const json = Boolean(values.json);
  const out = typeof values.out === 'string' ? values.out : undefined;

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-index-import-'));
  try {
    await extractTarball(inputPath, stagingDir);
    const manifest = await readManifest(stagingDir);

    const missingFiles: string[] = [];
    for (const file of manifest.files) {
      const exists = await fs.access(path.join(stagingDir, file)).then(() => true).catch(() => false);
      if (!exists) missingFiles.push(file);
    }
    if (missingFiles.length > 0) {
      throw new CliError(`Bundle is missing required file(s): ${missingFiles.join(', ')}`, 'INVALID_ARGUMENT');
    }

    for (const [file, expectedChecksum] of Object.entries(manifest.checksums)) {
      const absolute = path.join(stagingDir, file);
      const exists = await fs.access(absolute).then(() => true).catch(() => false);
      if (!exists) continue;
      const actual = await computeFileSha256(absolute);
      if (actual !== expectedChecksum) {
        throw new CliError(`Checksum mismatch for ${file}. Bundle may be corrupted.`, 'INVALID_ARGUMENT');
      }
    }

    const targetDir = path.join(workspaceRoot, '.librarian');
    await fs.mkdir(targetDir, { recursive: true });

    const workspacePortable = getPortableWorkspaceValue(workspaceRoot);
    let sqliteRewrites = 0;
    for (const file of manifest.files) {
      const source = path.join(stagingDir, file);
      const destination = path.join(targetDir, file);
      await fs.copyFile(source, destination);
      if (file.endsWith('.sqlite') || file.endsWith('.db')) {
        sqliteRewrites += replaceTextInSqlite(destination, [
          { from: manifest.workspacePlaceholder, to: workspacePortable },
        ]);
      }
    }

    const currentHeadSha = resolveGitHeadSha(workspaceRoot);
    const headShaMatches = !manifest.gitHeadSha || !currentHeadSha
      ? null
      : manifest.gitHeadSha === currentHeadSha;

    const payload = {
      success: true,
      workspace: workspaceRoot,
      inputPath,
      importedFiles: manifest.files,
      bundleGitHeadSha: manifest.gitHeadSha,
      currentGitHeadSha: currentHeadSha,
      gitHeadMatches: headShaMatches,
      sqlitePathRewrites: sqliteRewrites,
      warning: headShaMatches === false
        ? `Bundle was exported at ${manifest.gitHeadSha}; current workspace is ${currentHeadSha}. Run "librarian update --since ${manifest.gitHeadSha}" to apply incremental changes.`
        : undefined,
    };

    if (json) {
      await emitJsonOutput(payload, out);
      return;
    }

    console.log('Index Import');
    console.log('============\n');
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Input: ${inputPath}`);
    console.log(`Imported files: ${manifest.files.join(', ')}`);
    if (headShaMatches === false && manifest.gitHeadSha && currentHeadSha) {
      console.log(`Warning: bundle git SHA (${manifest.gitHeadSha}) != current git SHA (${currentHeadSha}).`);
      console.log(`Run: librarian update --since ${manifest.gitHeadSha}`);
    }
    console.log();
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}
