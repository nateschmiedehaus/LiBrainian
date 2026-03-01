import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ts from 'typescript';

type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'namespace' | 'reexport' | 'default';

interface ExportEntry {
  name: string;
  kind: ExportKind;
  signature?: string;
  members: string[];
}

interface PackageSurface {
  packageName: string;
  rootPackage: string;
  version?: string;
  declarationFile: string;
  exports: Map<string, ExportEntry>;
}

interface FrameworkSignals {
  hasNextAppDir: boolean;
  hasNextPagesDir: boolean;
  nextVersion?: string;
  reactVersion?: string;
  expressVersion?: string;
  vueVersion?: string;
}

interface WorkspaceSurfaceCache {
  workspace: string;
  fingerprint: string;
  packageVersions: Record<string, string>;
  packageIndex: Map<string, PackageSurface>;
  frameworkSignals: FrameworkSignals;
}

export interface ValidateImportReferenceInput {
  packageName: string;
  importName: string;
  memberName?: string;
  context?: string;
}

export interface ValidateImportReferenceResult {
  valid: boolean;
  packageName: string;
  importName: string;
  memberName?: string;
  reason:
    | 'ok'
    | 'framework_mismatch'
    | 'package_not_found'
    | 'unknown_import'
    | 'unknown_member';
  suggestions: string[];
  packageVersion?: string;
  declarationFile?: string;
  frameworkContext?: {
    nextVersion?: string;
    hasNextAppDir: boolean;
    hasNextPagesDir: boolean;
  };
}

export interface ApiSurfaceIndexSnapshot {
  workspace: string;
  fingerprint: string;
  packageCount: number;
  packages: Array<{
    packageName: string;
    rootPackage: string;
    version?: string;
    declarationFile: string;
    exports: Array<{
      name: string;
      kind: ExportKind;
      signature?: string;
      members: string[];
    }>;
  }>;
  frameworks: FrameworkSignals;
}

const CACHE = new Map<string, WorkspaceSurfaceCache>();
const LOCK_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];
const MAX_SUGGESTIONS = 5;

function normalizeExportSignature(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(target: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(target, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return Boolean(modifiers?.some((modifier) => modifier.kind === kind));
}

function getDeclarationName(nameNode: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) return nameNode.text;
  if (ts.isComputedPropertyName(nameNode) && ts.isIdentifier(nameNode.expression)) return nameNode.expression.text;
  return null;
}

function collectMembers(node: ts.ClassDeclaration | ts.InterfaceDeclaration): string[] {
  const members = new Set<string>();
  for (const member of node.members) {
    if (!('name' in member)) continue;
    const name = getDeclarationName(member.name);
    if (name) members.add(name);
  }
  return Array.from(members).sort((a, b) => a.localeCompare(b));
}

function collectTypeLiteralMembers(members: ts.NodeArray<ts.TypeElement>): string[] {
  const names = new Set<string>();
  for (const member of members) {
    if (!('name' in member)) continue;
    const name = getDeclarationName(member.name);
    if (name) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function resolveTypeReferenceName(typeName: ts.EntityName): string {
  if (ts.isIdentifier(typeName)) return typeName.text;
  return typeName.right.text;
}

function resolveMembersFromTypeNode(
  typeNode: ts.TypeNode | undefined,
  namedTypeMembers: Map<string, string[]>,
): string[] {
  if (!typeNode) return [];
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveMembersFromTypeNode(typeNode.type, namedTypeMembers);
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    return collectTypeLiteralMembers(typeNode.members);
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = resolveTypeReferenceName(typeNode.typeName);
    return namedTypeMembers.get(name) ?? [];
  }
  if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
    const combined = new Set<string>();
    for (const child of typeNode.types) {
      for (const member of resolveMembersFromTypeNode(child, namedTypeMembers)) {
        combined.add(member);
      }
    }
    return Array.from(combined).sort((a, b) => a.localeCompare(b));
  }
  return [];
}

function buildNamedTypeMembers(statements: readonly ts.Statement[]): Map<string, string[]> {
  const namedTypeMembers = new Map<string, string[]>();
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      namedTypeMembers.set(statement.name.text, collectMembers(statement));
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      namedTypeMembers.set(statement.name.text, collectMembers(statement));
    }
  }
  for (const statement of statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    const members = resolveMembersFromTypeNode(statement.type, namedTypeMembers);
    if (members.length > 0) {
      namedTypeMembers.set(statement.name.text, members);
    }
  }
  return namedTypeMembers;
}

function buildVariableMembers(
  statements: readonly ts.Statement[],
  namedTypeMembers: Map<string, string[]>,
): Map<string, string[]> {
  const variableMembers = new Map<string, string[]>();
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const variableName = getDeclarationName(declaration.name);
      if (!variableName) continue;
      const members = resolveMembersFromTypeNode(declaration.type, namedTypeMembers);
      if (members.length > 0) {
        variableMembers.set(variableName, members);
      }
    }
  }
  return variableMembers;
}

function parseDeclarationExports(filePath: string, content: string): Map<string, ExportEntry> {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exportsMap = new Map<string, ExportEntry>();
  const namedTypeMembers = buildNamedTypeMembers(sourceFile.statements);
  const variableMembers = buildVariableMembers(sourceFile.statements, namedTypeMembers);
  const upsertExport = (entry: ExportEntry): void => {
    const existing = exportsMap.get(entry.name);
    if (!existing) {
      exportsMap.set(entry.name, entry);
      return;
    }
    const mergedMembers = new Set<string>([...existing.members, ...entry.members]);
    exportsMap.set(entry.name, {
      name: entry.name,
      kind: existing.kind,
      signature: existing.signature ?? entry.signature,
      members: Array.from(mergedMembers).sort((a, b) => a.localeCompare(b)),
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
      upsertExport({
        name: statement.name.text,
        kind: 'function',
        signature: normalizeExportSignature(sourceFile, statement),
        members: [],
      });
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        upsertExport({
          name: 'default',
          kind: 'default',
          signature: normalizeExportSignature(sourceFile, statement),
          members: [],
        });
      }
      continue;
    }

    if (ts.isClassDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
      upsertExport({
        name: statement.name.text,
        kind: 'class',
        signature: normalizeExportSignature(sourceFile, statement),
        members: collectMembers(statement),
      });
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        upsertExport({
          name: 'default',
          kind: 'default',
          signature: normalizeExportSignature(sourceFile, statement),
          members: collectMembers(statement),
        });
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      upsertExport({
        name: statement.name.text,
        kind: 'interface',
        signature: normalizeExportSignature(sourceFile, statement),
        members: collectMembers(statement),
      });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      upsertExport({
        name: statement.name.text,
        kind: 'type',
        signature: normalizeExportSignature(sourceFile, statement),
        members: [],
      });
      continue;
    }

    if (ts.isEnumDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      upsertExport({
        name: statement.name.text,
        kind: 'enum',
        signature: normalizeExportSignature(sourceFile, statement),
        members: [],
      });
      continue;
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        const variableName = getDeclarationName(declaration.name);
        if (!variableName) continue;
        upsertExport({
          name: variableName,
          kind: 'const',
          signature: normalizeExportSignature(sourceFile, statement),
          members: variableMembers.get(variableName) ?? [],
        });
      }
      continue;
    }

    if (ts.isModuleDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
      upsertExport({
        name: statement.name.text,
        kind: 'namespace',
        signature: normalizeExportSignature(sourceFile, statement),
        members: [],
      });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          upsertExport({
            name: element.name.text,
            kind: 'reexport',
            signature: normalizeExportSignature(sourceFile, statement),
            members: variableMembers.get(localName) ?? namedTypeMembers.get(localName) ?? [],
          });
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      const defaultMembers = ts.isIdentifier(statement.expression)
        ? variableMembers.get(statement.expression.text) ?? namedTypeMembers.get(statement.expression.text) ?? []
        : [];
      upsertExport({
        name: 'default',
        kind: 'default',
        signature: normalizeExportSignature(sourceFile, statement),
        members: defaultMembers,
      });
    }
  }

  return exportsMap;
}

function splitPackageSpecifier(specifier: string): { rootPackage: string; subpath?: string } {
  const trimmed = specifier.trim();
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    if (parts.length <= 2) return { rootPackage: trimmed };
    return {
      rootPackage: `${parts[0]}/${parts[1]}`,
      subpath: parts.slice(2).join('/'),
    };
  }
  const parts = trimmed.split('/');
  if (parts.length <= 1) return { rootPackage: trimmed };
  return { rootPackage: parts[0], subpath: parts.slice(1).join('/') };
}

function selectString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toDeclarationPath(specifier: string): string | undefined {
  const normalized = specifier.trim().replace(/^\.\//, '');
  if (!normalized) return undefined;
  if (normalized.endsWith('.d.ts')) return normalized;
  if (normalized.endsWith('.ts')) return normalized;
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return normalized.replace(/\.(?:mjs|cjs|js)$/, '.d.ts');
  }
  return undefined;
}

function resolveTypesPathFromExportTarget(target: unknown): string | undefined {
  if (typeof target === 'string') {
    return toDeclarationPath(target);
  }
  if (!target || typeof target !== 'object') return undefined;
  const record = target as Record<string, unknown>;
  const explicit =
    selectString(record.types) ??
    selectString(record.typings);
  if (explicit) return toDeclarationPath(explicit);

  const conditionOrder = ['import', 'require', 'default', 'node', 'browser'];
  for (const condition of conditionOrder) {
    const resolved = resolveTypesPathFromExportTarget(record[condition]);
    if (resolved) return resolved;
  }
  return undefined;
}

function resolveTypesEntryFromExports(exportsField: unknown, subpath?: string): string | undefined {
  if (typeof exportsField === 'string') {
    return subpath ? undefined : toDeclarationPath(exportsField);
  }
  if (!exportsField || typeof exportsField !== 'object') return undefined;
  const record = exportsField as Record<string, unknown>;

  if (subpath && subpath.length > 0) {
    const keyCandidates = [
      `./${subpath}`,
      `./${subpath}.js`,
      `./${subpath}.mjs`,
      `./${subpath}.cjs`,
      `./${subpath}/index`,
      `./${subpath}/index.js`,
    ];
    for (const key of keyCandidates) {
      const resolved = resolveTypesPathFromExportTarget(record[key]);
      if (resolved) return resolved;
    }
    return undefined;
  }

  const rootEntry = record['.'];
  const rootResolved = resolveTypesPathFromExportTarget(rootEntry);
  if (rootResolved) return rootResolved;
  return resolveTypesPathFromExportTarget(record);
}

async function resolveDeclarationFile(
  packageRoot: string,
  packageJson: Record<string, unknown> | null,
  subpath: string | undefined,
): Promise<string | null> {
  const candidates: string[] = [];
  if (subpath) {
    const subpathTypesEntry = resolveTypesEntryFromExports(packageJson?.exports, subpath);
    if (subpathTypesEntry) candidates.push(path.join(packageRoot, subpathTypesEntry));
    candidates.push(path.join(packageRoot, `${subpath}.d.ts`));
    candidates.push(path.join(packageRoot, subpath, 'index.d.ts'));
  } else {
    const typesEntry =
      selectString(packageJson?.types) ??
      selectString(packageJson?.typings) ??
      resolveTypesEntryFromExports(packageJson?.exports);
    if (typesEntry) candidates.push(path.join(packageRoot, typesEntry));
    candidates.push(path.join(packageRoot, 'index.d.ts'));
    candidates.push(path.join(packageRoot, 'dist', 'index.d.ts'));
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function readVersionMap(packageJson: Record<string, unknown> | null): Record<string, string> {
  const versionMap: Record<string, string> = {};
  if (!packageJson) return versionMap;
  const sections = ['dependencies', 'devDependencies', 'peerDependencies'];
  for (const section of sections) {
    const record = packageJson[section];
    if (!record || typeof record !== 'object') continue;
    for (const [name, version] of Object.entries(record as Record<string, unknown>)) {
      if (typeof version !== 'string') continue;
      versionMap[name] = version;
    }
  }
  return versionMap;
}

async function buildWorkspaceFingerprint(
  workspace: string,
  packageJsonPath: string,
  packageVersions: Record<string, string>,
): Promise<string> {
  const lockState: Array<{ file: string; mtimeMs: number; size: number }> = [];
  for (const lockFile of LOCK_FILES) {
    const target = path.join(workspace, lockFile);
    try {
      const stat = await fs.stat(target);
      lockState.push({ file: lockFile, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      continue;
    }
  }

  const packageStat = await fs.stat(packageJsonPath);
  const payload = {
    packageMtimeMs: packageStat.mtimeMs,
    packageSize: packageStat.size,
    packageVersions: Object.entries(packageVersions).sort(([a], [b]) => a.localeCompare(b)),
    lockState,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function detectFrameworkSignals(
  workspace: string,
  packageVersions: Record<string, string>,
): Promise<FrameworkSignals> {
  return {
    hasNextAppDir: await fileExists(path.join(workspace, 'app')),
    hasNextPagesDir: await fileExists(path.join(workspace, 'pages')),
    nextVersion: packageVersions.next,
    reactVersion: packageVersions.react,
    expressVersion: packageVersions.express,
    vueVersion: packageVersions.vue,
  };
}

async function indexSinglePackage(
  workspace: string,
  packageSpecifier: string,
  packageVersions: Record<string, string>,
): Promise<PackageSurface | null> {
  const { rootPackage, subpath } = splitPackageSpecifier(packageSpecifier);
  const packageRoot = path.join(workspace, 'node_modules', rootPackage);
  if (!(await fileExists(packageRoot))) return null;

  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = await readJson<Record<string, unknown>>(packageJsonPath);
  const declarationFile = await resolveDeclarationFile(packageRoot, packageJson, subpath);
  if (!declarationFile) return null;

  const raw = await fs.readFile(declarationFile, 'utf8');
  const exportsMap = parseDeclarationExports(declarationFile, raw);
  return {
    packageName: packageSpecifier,
    rootPackage,
    version: selectString(packageJson?.version) ?? packageVersions[rootPackage],
    declarationFile,
    exports: exportsMap,
  };
}

async function getOrBuildWorkspaceCache(workspacePath: string): Promise<WorkspaceSurfaceCache> {
  const workspace = path.resolve(workspacePath);
  const packageJsonPath = path.join(workspace, 'package.json');
  const packageJson = await readJson<Record<string, unknown>>(packageJsonPath);
  const packageVersions = readVersionMap(packageJson);
  const fingerprint = await buildWorkspaceFingerprint(workspace, packageJsonPath, packageVersions);
  const existing = CACHE.get(workspace);
  if (existing && existing.fingerprint === fingerprint) return existing;

  const packageIndex = new Map<string, PackageSurface>();
  const packageNames = Object.keys(packageVersions).sort((a, b) => a.localeCompare(b));
  for (const packageName of packageNames) {
    const indexed = await indexSinglePackage(workspace, packageName, packageVersions);
    if (!indexed) continue;
    packageIndex.set(packageName, indexed);
  }

  const frameworkSignals = await detectFrameworkSignals(workspace, packageVersions);
  const nextCache: WorkspaceSurfaceCache = {
    workspace,
    fingerprint,
    packageVersions,
    packageIndex,
    frameworkSignals,
  };
  CACHE.set(workspace, nextCache);
  return nextCache;
}

function levenshteinDistance(a: string, b: string): number {
  const source = a.toLowerCase();
  const target = b.toLowerCase();
  const matrix = Array.from({ length: source.length + 1 }, (_, row) =>
    Array.from({ length: target.length + 1 }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let row = 1; row <= source.length; row++) {
    for (let col = 1; col <= target.length; col++) {
      const cost = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }
  return matrix[source.length][target.length];
}

function rankSuggestions(target: string, candidates: string[]): string[] {
  return candidates
    .map((candidate) => {
      const distance = levenshteinDistance(target, candidate);
      const prefixBoost = candidate.toLowerCase().startsWith(target.toLowerCase()[0] ?? '') ? -0.25 : 0;
      return { candidate, score: distance + prefixBoost };
    })
    .sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate))
    .slice(0, MAX_SUGGESTIONS)
    .map((item) => item.candidate);
}

export function clearApiSurfaceIndexCache(workspace?: string): void {
  if (!workspace) {
    CACHE.clear();
    return;
  }
  CACHE.delete(path.resolve(workspace));
}

export async function buildApiSurfaceIndex(workspacePath: string): Promise<ApiSurfaceIndexSnapshot> {
  const cache = await getOrBuildWorkspaceCache(workspacePath);
  return {
    workspace: cache.workspace,
    fingerprint: cache.fingerprint,
    packageCount: cache.packageIndex.size,
    packages: Array.from(cache.packageIndex.values()).map((pkg) => ({
      packageName: pkg.packageName,
      rootPackage: pkg.rootPackage,
      version: pkg.version,
      declarationFile: pkg.declarationFile,
      exports: Array.from(pkg.exports.values()).map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        signature: entry.signature,
        members: [...entry.members],
      })),
    })),
    frameworks: cache.frameworkSignals,
  };
}

function isNextRouterMismatch(packageName: string, frameworks: FrameworkSignals): boolean {
  if (packageName !== 'next/router') return false;
  return frameworks.hasNextAppDir && !frameworks.hasNextPagesDir;
}

export async function validateImportReference(
  workspacePath: string,
  input: ValidateImportReferenceInput,
): Promise<ValidateImportReferenceResult> {
  const workspace = path.resolve(workspacePath);
  const packageName = input.packageName.trim();
  const importName = input.importName.trim();
  const memberName = input.memberName?.trim();
  const cache = await getOrBuildWorkspaceCache(workspace);

  if (isNextRouterMismatch(packageName, cache.frameworkSignals)) {
    return {
      valid: false,
      packageName,
      importName,
      memberName,
      reason: 'framework_mismatch',
      suggestions: ['next/navigation'],
      frameworkContext: {
        nextVersion: cache.frameworkSignals.nextVersion,
        hasNextAppDir: cache.frameworkSignals.hasNextAppDir,
        hasNextPagesDir: cache.frameworkSignals.hasNextPagesDir,
      },
    };
  }

  let packageSurface = cache.packageIndex.get(packageName);
  if (!packageSurface) {
    const indexedSurface = await indexSinglePackage(workspace, packageName, cache.packageVersions);
    if (indexedSurface) {
      packageSurface = indexedSurface;
      cache.packageIndex.set(packageName, indexedSurface);
    }
  }

  if (!packageSurface) {
    return {
      valid: false,
      packageName,
      importName,
      memberName,
      reason: 'package_not_found',
      suggestions: rankSuggestions(packageName, Array.from(cache.packageIndex.keys())),
    };
  }

  const exportEntry = packageSurface.exports.get(importName);
  if (!exportEntry) {
    return {
      valid: false,
      packageName,
      importName,
      memberName,
      reason: 'unknown_import',
      packageVersion: packageSurface.version,
      declarationFile: packageSurface.declarationFile,
      suggestions: rankSuggestions(importName, Array.from(packageSurface.exports.keys())),
    };
  }

  if (memberName && memberName.length > 0) {
    const members = exportEntry.members;
    if (!members.includes(memberName)) {
      return {
        valid: false,
        packageName,
        importName,
        memberName,
        reason: 'unknown_member',
        packageVersion: packageSurface.version,
        declarationFile: packageSurface.declarationFile,
        suggestions: rankSuggestions(memberName, members),
      };
    }
  }

  return {
    valid: true,
    packageName,
    importName,
    memberName,
    reason: 'ok',
    packageVersion: packageSurface.version,
    declarationFile: packageSurface.declarationFile,
    suggestions: [],
  };
}
