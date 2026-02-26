import path from 'node:path';
import { promises as fs } from 'node:fs';
import { glob } from 'glob';
import type { LibrarianQuery } from '../types.js';
import { safeJsonParse } from '../utils/safe_json.js';

const workspacePackageRootsCache = new Map<string, string[]>();

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeToWorkspaceRelative(workspaceRoot: string, candidate: string): string | null {
  const normalized = normalizePath(candidate.trim());
  if (!normalized) return null;
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspaceRoot, candidate);
  const relative = normalizePath(path.relative(workspaceRoot, resolved));
  if (!relative || relative === '.' || relative.startsWith('..')) return null;
  return relative;
}

function normalizeLanguageFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function hasSearchFilter(filter: LibrarianQuery['filter'] | undefined): boolean {
  if (!filter) return false;
  return Boolean(
    filter.pathPrefix
    || filter.language
    || typeof filter.isExported === 'boolean'
    || typeof filter.isPure === 'boolean'
    || filter.excludeTests
    || typeof filter.maxFileSizeBytes === 'number'
  );
}

function normalizeSearchFilter(
  filter: LibrarianQuery['filter'] | undefined,
  workspaceRoot: string,
): NonNullable<LibrarianQuery['filter']> {
  const pathPrefix = normalizePathPrefix(filter?.pathPrefix, workspaceRoot);
  const language = normalizeLanguageFilter(filter?.language);
  const maxFileSizeBytes = typeof filter?.maxFileSizeBytes === 'number' && Number.isFinite(filter.maxFileSizeBytes) && filter.maxFileSizeBytes > 0
    ? Math.floor(filter.maxFileSizeBytes)
    : undefined;
  return {
    pathPrefix,
    language,
    isExported: typeof filter?.isExported === 'boolean' ? filter.isExported : undefined,
    isPure: typeof filter?.isPure === 'boolean' ? filter.isPure : undefined,
    excludeTests: filter?.excludeTests === true ? true : undefined,
    maxFileSizeBytes,
  };
}

function normalizePathPrefix(prefix: string | undefined, workspaceRoot: string): string | undefined {
  if (!prefix) return undefined;
  const relative = normalizeToWorkspaceRelative(workspaceRoot, prefix);
  if (!relative) return undefined;
  return ensureTrailingSlash(relative);
}

function normalizeAffectedFilesForWorkspace(
  affectedFiles: string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0) return undefined;
  const normalized = new Set<string>();
  for (const file of affectedFiles) {
    if (typeof file !== 'string') continue;
    const trimmed = file.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return normalized.size > 0 ? Array.from(normalized) : undefined;
}

function normalizeSingleFileHint(
  filePath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (!filePath) return undefined;
  const trimmed = filePath.trim();
  if (!trimmed) return undefined;
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
}

async function derivePathPrefixFromWorkingFile(
  workspaceRoot: string,
  workingFile: string,
): Promise<string | undefined> {
  const absoluteFile = path.resolve(workingFile);
  const relativeFile = normalizePath(path.relative(workspaceRoot, absoluteFile));
  if (!relativeFile || relativeFile.startsWith('..')) return undefined;

  const packageRoots = await resolveWorkspacePackageRoots(workspaceRoot);
  const matched = packageRoots
    .filter((root) => relativeFile === root || relativeFile.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (matched) {
    return ensureTrailingSlash(matched);
  }

  const nearestPackageRoot = await findNearestPackageRoot(workspaceRoot, absoluteFile);
  if (!nearestPackageRoot) return undefined;
  const relativeRoot = normalizePath(path.relative(workspaceRoot, nearestPackageRoot));
  if (!relativeRoot || relativeRoot === '.' || relativeRoot.startsWith('..')) return undefined;
  return ensureTrailingSlash(relativeRoot);
}

async function resolveWorkspacePackageRoots(workspaceRoot: string): Promise<string[]> {
  const cached = workspacePackageRootsCache.get(workspaceRoot);
  if (cached) return cached;

  const patterns = await loadWorkspacePatterns(workspaceRoot);
  if (patterns.length === 0) {
    workspacePackageRootsCache.set(workspaceRoot, []);
    return [];
  }

  const roots = new Set<string>();
  for (const pattern of patterns) {
    const normalized = normalizePath(pattern).replace(/\/+$/, '');
    if (!normalized) continue;
    const globPattern = normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`;
    const matches = await glob(globPattern, {
      cwd: workspaceRoot,
      absolute: false,
      nodir: true,
      follow: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/.librarian/**'],
    });
    for (const match of matches) {
      const relative = normalizePath(path.posix.dirname(match));
      if (relative && relative !== '.') {
        roots.add(relative);
      }
    }
  }

  const resolved = Array.from(roots).sort((a, b) => a.localeCompare(b));
  workspacePackageRootsCache.set(workspaceRoot, resolved);
  return resolved;
}

async function loadWorkspacePatterns(workspaceRoot: string): Promise<string[]> {
  const patterns = new Set<string>();
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  try {
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed.ok && parsed.value) {
      const workspaces = parsed.value.workspaces;
      for (const pattern of parseWorkspacePatterns(workspaces)) {
        patterns.add(pattern);
      }
    }
  } catch {
    // Optional workspace metadata.
  }

  const pnpmWorkspacePath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  try {
    const raw = await fs.readFile(pnpmWorkspacePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) continue;
      const pattern = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
      if (pattern.length > 0) {
        patterns.add(pattern);
      }
    }
  } catch {
    // Optional workspace metadata.
  }

  return Array.from(patterns);
}

function parseWorkspacePatterns(workspaces: unknown): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (workspaces && typeof workspaces === 'object') {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  }
  return [];
}

async function findNearestPackageRoot(workspaceRoot: string, filePath: string): Promise<string | undefined> {
  let current = path.dirname(filePath);
  const normalizedWorkspace = path.resolve(workspaceRoot);
  while (current.startsWith(normalizedWorkspace)) {
    if (current === normalizedWorkspace) return undefined;
    try {
      await fs.access(path.join(current, 'package.json'));
      return current;
    } catch {
      // Keep traversing toward workspace root.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export async function normalizeQueryScope(
  query: LibrarianQuery,
  workspaceRoot: string,
): Promise<{ query: LibrarianQuery; disclosures: string[] }> {
  const disclosures: string[] = [];
  const affectedFiles = normalizeAffectedFilesForWorkspace(query.affectedFiles);
  const workingFile = normalizeSingleFileHint(query.workingFile, workspaceRoot);
  const explicitScopePrefix = normalizePathPrefix(query.scope, workspaceRoot);
  const filter = normalizeSearchFilter(query.filter, workspaceRoot);
  let nextFilter = filter;

  if (!nextFilter.pathPrefix && explicitScopePrefix) {
    nextFilter = { ...nextFilter, pathPrefix: explicitScopePrefix };
    disclosures.push(`scope_explicit: ${explicitScopePrefix}`);
  }

  if (!nextFilter.pathPrefix && workingFile) {
    const derived = await derivePathPrefixFromWorkingFile(workspaceRoot, workingFile);
    if (derived) {
      nextFilter = { ...nextFilter, pathPrefix: derived };
      disclosures.push(`scope_auto_detected: ${derived} (from workingFile)`);
    }
  }

  const hasFilter = hasSearchFilter(nextFilter);
  return {
    query: {
      ...query,
      affectedFiles,
      workingFile,
      filter: hasFilter ? nextFilter : undefined,
    },
    disclosures,
  };
}

export function expandPathCandidates(filePath: string, workspaceRoot: string): string[] {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) return [];
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const normalizedAbsolute = normalizePath(absolute);
  const candidates = new Set<string>([absolute, normalizedAbsolute]);
  const relative = normalizePath(path.relative(workspaceRoot, absolute));
  if (relative && relative !== '.' && !relative.startsWith('..')) {
    candidates.add(relative);
    candidates.add(`./${relative}`);
  }
  return Array.from(candidates);
}

export function toRelativePath(workspace: string | undefined, filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!workspace) return normalized;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath);
  const relative = normalizePath(path.relative(workspace, absolute));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return normalized;
}

export function resolveWorkspacePath(workspace: string | undefined, filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!workspace) return normalized;
  if (path.isAbsolute(filePath)) return normalized;
  return normalizePath(path.join(workspace, filePath));
}
