import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const INSTALL_MANIFEST_FILENAME = '.librainian-manifest.json';

export interface LibrainianInstallManifest {
  kind: 'LibrainianInstallManifest.v1';
  schema_version: 1;
  generated_at: string;
  package_version: string;
  workspace: string;
  bootstrap_mode: 'fast' | 'full';
  files_modified: string[];
  files_created: string[];
  directories_created: string[];
  package_json: string | null;
  injected_docs_files: string[];
}

export interface InstallManifestWriteInput {
  workspaceRoot: string;
  packageVersion: string;
  bootstrapMode: 'fast' | 'full';
  filesModified?: string[];
  filesCreated?: string[];
  directoriesCreated?: string[];
  docsUpdatedFiles?: string[];
  packageJsonPath?: string | null;
  generatedAt?: string;
}

export interface InstallManifestWriteResult {
  path: string;
  manifest: LibrainianInstallManifest;
}

const DEFAULT_INSTALL_DIRS = [
  '.librarian',
  'state',
  path.join('apps', 'web', 'state'),
] as const;

function toPosixRelative(workspaceRoot: string, targetPath: string): string {
  const relative = path.relative(workspaceRoot, targetPath).split(path.sep).join('/');
  return relative.replace(/^\.\/+/, '');
}

function normalizeRelativeEntries(workspaceRoot: string, values: string[]): string[] {
  const entries = values
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      const absolute = path.isAbsolute(value) ? value : path.join(workspaceRoot, value);
      return toPosixRelative(workspaceRoot, absolute);
    })
    .filter((value) => value.length > 0 && value !== '.');
  return Array.from(new Set(entries)).sort();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function detectInstallDirectories(
  workspaceRoot: string,
  candidates: readonly string[] = DEFAULT_INSTALL_DIRS,
): Promise<string[]> {
  const matches: string[] = [];
  const normalizedWorkspace = path.resolve(workspaceRoot);
  for (const candidate of candidates) {
    const absolute = path.resolve(normalizedWorkspace, candidate);
    if (!absolute.startsWith(normalizedWorkspace)) continue;
    if (await pathExists(absolute)) {
      matches.push(toPosixRelative(normalizedWorkspace, absolute));
    }
  }
  return Array.from(new Set(matches)).sort();
}

async function resolveWorkspacePackageJson(workspaceRoot: string): Promise<string | null> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (await pathExists(packageJsonPath)) {
    return 'package.json';
  }
  return null;
}

export async function writeInstallManifest(input: InstallManifestWriteInput): Promise<InstallManifestWriteResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const docsUpdatedFiles = normalizeRelativeEntries(workspaceRoot, input.docsUpdatedFiles ?? []);
  const filesModified = normalizeRelativeEntries(
    workspaceRoot,
    [...(input.filesModified ?? []), ...docsUpdatedFiles],
  );
  const filesCreated = normalizeRelativeEntries(workspaceRoot, input.filesCreated ?? []);
  const directoriesCreated = input.directoriesCreated
    ? normalizeRelativeEntries(workspaceRoot, input.directoriesCreated)
    : await detectInstallDirectories(workspaceRoot);
  const packageJson = input.packageJsonPath === undefined
    ? await resolveWorkspacePackageJson(workspaceRoot)
    : (input.packageJsonPath ? normalizeRelativeEntries(workspaceRoot, [input.packageJsonPath])[0] ?? null : null);

  const manifest: LibrainianInstallManifest = {
    kind: 'LibrainianInstallManifest.v1',
    schema_version: 1,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    package_version: input.packageVersion,
    workspace: workspaceRoot,
    bootstrap_mode: input.bootstrapMode,
    files_modified: filesModified,
    files_created: filesCreated,
    directories_created: directoriesCreated,
    package_json: packageJson,
    injected_docs_files: docsUpdatedFiles,
  };

  const manifestPath = path.join(workspaceRoot, INSTALL_MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    path: manifestPath,
    manifest,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export async function readInstallManifest(workspaceRoot: string): Promise<LibrainianInstallManifest | null> {
  const manifestPath = path.join(path.resolve(workspaceRoot), INSTALL_MANIFEST_FILENAME);
  if (!(await pathExists(manifestPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.kind !== 'LibrainianInstallManifest.v1') return null;
    if (parsed.schema_version !== 1) return null;
    if (typeof parsed.generated_at !== 'string') return null;
    if (typeof parsed.package_version !== 'string') return null;
    if (typeof parsed.workspace !== 'string') return null;
    if (parsed.bootstrap_mode !== 'fast' && parsed.bootstrap_mode !== 'full') return null;
    if (!isStringArray(parsed.files_modified)) return null;
    if (!isStringArray(parsed.files_created)) return null;
    if (!isStringArray(parsed.directories_created)) return null;
    if (!(typeof parsed.package_json === 'string' || parsed.package_json === null)) return null;
    if (!isStringArray(parsed.injected_docs_files)) return null;
    return {
      kind: 'LibrainianInstallManifest.v1',
      schema_version: 1,
      generated_at: parsed.generated_at,
      package_version: parsed.package_version,
      workspace: parsed.workspace,
      bootstrap_mode: parsed.bootstrap_mode,
      files_modified: parsed.files_modified,
      files_created: parsed.files_created,
      directories_created: parsed.directories_created,
      package_json: parsed.package_json,
      injected_docs_files: parsed.injected_docs_files,
    };
  } catch {
    return null;
  }
}
