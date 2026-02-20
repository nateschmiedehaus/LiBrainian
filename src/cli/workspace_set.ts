import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { resolveDbPath } from './db_path.js';

export interface WorkspaceSetPackageInput {
  name?: string;
  path: string;
  dependsOn?: string[];
  include?: string[];
  exclude?: string[];
}

export interface WorkspaceSetConfigInput {
  root?: string;
  packages: Array<string | WorkspaceSetPackageInput>;
  shared?: {
    crossPackageGraph?: boolean;
    sharedDb?: string;
  };
}

export interface ResolvedWorkspaceSetPackage {
  name: string;
  path: string;
  relativePath: string;
  packageName?: string;
  dependsOn: string[];
  include?: string[];
  exclude?: string[];
}

export interface ResolvedWorkspaceSetConfig {
  configPath: string;
  root: string;
  packages: ResolvedWorkspaceSetPackage[];
  shared: {
    crossPackageGraph: boolean;
    sharedDb?: string;
  };
}

export type WorkspaceSetEdgeReason = 'explicit_depends_on' | 'package_json_dependency';

export interface WorkspaceSetDependencyEdge {
  from: string;
  to: string;
  reason: WorkspaceSetEdgeReason;
}

export interface WorkspaceSetDependencyGraph {
  edges: WorkspaceSetDependencyEdge[];
}

export type WorkspaceSetPackageStatus = 'ready' | 'stale' | 'failed' | 'missing';

export interface WorkspaceSetPackageState {
  name: string;
  path: string;
  dbPath: string;
  status: WorkspaceSetPackageStatus;
  error?: string;
}

export interface WorkspaceSetState {
  kind: 'WorkspaceSetState.v1';
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  configPath: string;
  sharedDb?: string;
  packages: WorkspaceSetPackageState[];
  graph: WorkspaceSetDependencyGraph;
}

interface PackageJsonLike {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/');
}

function toRelativeOrThrow(root: string, candidate: string, field: string): string {
  const absolute = path.resolve(candidate);
  const relative = normalizeSlash(path.relative(root, absolute));
  if (!relative || relative === '.' || relative.startsWith('..')) {
    throw new Error(`Workspace-set ${field} must be inside root: ${candidate}`);
  }
  return relative;
}

function sanitizeName(value: string): string {
  return normalizeSlash(value.trim()).replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/+$/, '');
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

async function readPackageJson(workspace: string): Promise<PackageJsonLike | null> {
  const filePath = path.join(workspace, 'package.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonLike;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadWorkspaceSetConfig(configPath: string, cwd?: string): Promise<ResolvedWorkspaceSetConfig> {
  const configAbsolute = path.resolve(cwd ?? process.cwd(), configPath);
  const raw = await fs.readFile(configAbsolute, 'utf8');
  const parsed = JSON.parse(raw) as WorkspaceSetConfigInput;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid workspace-set file: ${configAbsolute}`);
  }

  const configDir = path.dirname(configAbsolute);
  const root = path.resolve(configDir, parsed.root?.trim() || '.');

  if (!Array.isArray(parsed.packages) || parsed.packages.length === 0) {
    throw new Error('workspace-set requires a non-empty packages array');
  }

  const packages: ResolvedWorkspaceSetPackage[] = [];
  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();

  for (const entry of parsed.packages) {
    const normalized = typeof entry === 'string'
      ? { path: entry, name: entry }
      : entry;
    if (!normalized || typeof normalized !== 'object' || typeof normalized.path !== 'string') {
      throw new Error('workspace-set package entries must be strings or objects with path');
    }

    const relativeInput = sanitizeName(normalized.path);
    if (!relativeInput) {
      throw new Error('workspace-set package path cannot be empty');
    }

    const absolutePath = path.resolve(root, relativeInput);
    const relativePath = toRelativeOrThrow(root, absolutePath, 'package.path');
    const declaredName = sanitizeName(normalized.name ?? relativePath);
    const packageName = declaredName || relativePath;

    if (seenNames.has(packageName)) {
      throw new Error(`workspace-set package name must be unique: ${packageName}`);
    }
    if (seenPaths.has(relativePath)) {
      throw new Error(`workspace-set package path must be unique: ${relativePath}`);
    }

    if (!(await fileExists(absolutePath))) {
      throw new Error(`workspace-set package path does not exist: ${relativePath}`);
    }

    const pkgJson = await readPackageJson(absolutePath);
    packages.push({
      name: packageName,
      path: absolutePath,
      relativePath,
      packageName: typeof pkgJson?.name === 'string' ? pkgJson.name : undefined,
      dependsOn: sanitizeStringArray(normalized.dependsOn) ?? [],
      include: sanitizeStringArray(normalized.include),
      exclude: sanitizeStringArray(normalized.exclude),
    });

    seenNames.add(packageName);
    seenPaths.add(relativePath);
  }

  const sharedDbInput = parsed.shared?.sharedDb?.trim();
  const crossPackageGraph = parsed.shared?.crossPackageGraph !== false;
  const sharedDb = crossPackageGraph
    ? path.resolve(root, sharedDbInput && sharedDbInput.length > 0 ? sharedDbInput : '.librarian/cross_package.db')
    : undefined;

  for (const pkg of packages) {
    for (const dep of pkg.dependsOn) {
      if (!seenNames.has(dep)) {
        throw new Error(`workspace-set package "${pkg.name}" dependsOn unknown package "${dep}"`);
      }
    }
  }

  return {
    configPath: configAbsolute,
    root,
    packages,
    shared: {
      crossPackageGraph,
      sharedDb,
    },
  };
}

export async function buildWorkspaceSetDependencyGraph(
  config: ResolvedWorkspaceSetConfig
): Promise<WorkspaceSetDependencyGraph> {
  const packageNameToWorkspace = new Map<string, string>();
  for (const pkg of config.packages) {
    if (pkg.packageName && !packageNameToWorkspace.has(pkg.packageName)) {
      packageNameToWorkspace.set(pkg.packageName, pkg.name);
    }
  }

  const edgeKeys = new Set<string>();
  const edges: WorkspaceSetDependencyEdge[] = [];
  const addEdge = (edge: WorkspaceSetDependencyEdge): void => {
    const key = `${edge.from}::${edge.to}::${edge.reason}`;
    if (edge.from === edge.to || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const pkg of config.packages) {
    for (const dep of pkg.dependsOn) {
      addEdge({ from: pkg.name, to: dep, reason: 'explicit_depends_on' });
    }

    const pkgJson = await readPackageJson(pkg.path);
    if (!pkgJson) continue;
    const depNames = new Set<string>([
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.devDependencies ?? {}),
      ...Object.keys(pkgJson.peerDependencies ?? {}),
      ...Object.keys(pkgJson.optionalDependencies ?? {}),
    ]);
    for (const depName of depNames) {
      const workspaceDep = packageNameToWorkspace.get(depName);
      if (!workspaceDep) continue;
      addEdge({ from: pkg.name, to: workspaceDep, reason: 'package_json_dependency' });
    }
  }

  edges.sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;
    return a.reason.localeCompare(b.reason);
  });

  return { edges };
}

export async function persistWorkspaceSetGraphDb(
  config: ResolvedWorkspaceSetConfig,
  graph: WorkspaceSetDependencyGraph
): Promise<string | undefined> {
  const dbPath = config.shared.sharedDb;
  if (!dbPath || !config.shared.crossPackageGraph) {
    return undefined;
  }

  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_packages (
        name TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        package_name TEXT
      );
      CREATE TABLE IF NOT EXISTS cross_package_edges (
        from_package TEXT NOT NULL,
        to_package TEXT NOT NULL,
        reason TEXT NOT NULL,
        UNIQUE(from_package, to_package, reason)
      );
      DELETE FROM workspace_packages;
      DELETE FROM cross_package_edges;
    `);

    const insertPackage = db.prepare(
      'INSERT INTO workspace_packages(name, workspace_path, package_name) VALUES (?, ?, ?)'
    );
    for (const pkg of config.packages) {
      insertPackage.run(pkg.name, pkg.path, pkg.packageName ?? null);
    }

    const insertEdge = db.prepare(
      'INSERT INTO cross_package_edges(from_package, to_package, reason) VALUES (?, ?, ?)'
    );
    for (const edge of graph.edges) {
      insertEdge.run(edge.from, edge.to, edge.reason);
    }
  } finally {
    db.close();
  }

  return dbPath;
}

function workspaceSetStatePath(root: string): string {
  return path.join(root, '.librarian', 'workspace_set_state.json');
}

function isWorkspaceSetState(value: unknown): value is WorkspaceSetState {
  if (!value || typeof value !== 'object') return false;
  const cast = value as Partial<WorkspaceSetState>;
  return cast.kind === 'WorkspaceSetState.v1'
    && cast.schemaVersion === 1
    && typeof cast.generatedAt === 'string'
    && typeof cast.root === 'string'
    && typeof cast.configPath === 'string'
    && Array.isArray(cast.packages)
    && Boolean(cast.graph && Array.isArray(cast.graph.edges));
}

export async function writeWorkspaceSetState(root: string, state: WorkspaceSetState): Promise<string> {
  const filePath = workspaceSetStatePath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return filePath;
}

export async function readWorkspaceSetState(root: string): Promise<WorkspaceSetState | null> {
  const filePath = workspaceSetStatePath(root);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isWorkspaceSetState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function buildWorkspaceSetPackageState(
  packages: ResolvedWorkspaceSetConfig['packages']
): Promise<WorkspaceSetPackageState[]> {
  const states: WorkspaceSetPackageState[] = [];
  for (const pkg of packages) {
    const dbPath = await resolveDbPath(pkg.path);
    const status: WorkspaceSetPackageStatus = await fileExists(dbPath) ? 'ready' : 'missing';
    states.push({
      name: pkg.name,
      path: pkg.path,
      dbPath,
      status,
    });
  }
  return states;
}
