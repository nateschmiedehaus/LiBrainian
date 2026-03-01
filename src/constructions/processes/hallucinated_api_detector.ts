import * as fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { validateImportReference } from '../../runtime/api_surface_index.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

interface ValidateImportReferenceResult {
  valid: boolean;
  packageName: string;
  importName: string;
  memberName?: string;
  reason?: string;
  suggestions: string[];
}

export interface APIDetectorInput {
  generatedCode: string;
  projectRoot: string;
  packagesToCheck?: string[];
}

export interface HallucinatedCall {
  callSite: string;
  location: { line: number; column: number };
  package: string;
  installedVersion: string;
  status: 'verified' | 'not_found' | 'removed_in_version' | 'wrong_signature' | 'unverifiable';
  removedInVersion?: string;
  replacement?: string;
  confidence: number;
}

export interface APIDetectorOutput {
  calls: HallucinatedCall[];
  hallucinatedCount: number;
  unverifiableCount: number;
  agentSummary: string;
  hasBlockingIssues: boolean;
}

interface ImportBinding {
  packageName: string;
  importName: string;
}

interface MethodCallCandidate {
  callSite: string;
  location: { line: number; column: number };
  packageName: string;
  importName: string;
  memberName: string;
  anyLikeType: boolean;
  signatureIssue: boolean;
}

interface RemovedMethodHint {
  removedInVersion: string;
  replacement: string;
}

const REMOVED_METHOD_HINTS: Record<string, Record<string, Record<string, RemovedMethodHint>>> = {
  'express-validator': {
    ValidationChain: {
      escape: {
        removedInVersion: '7.0.0',
        replacement: 'use .customSanitizer()',
      },
    },
  },
};

const SIGNATURE_DIAGNOSTIC_CODES = new Set<number>([2554, 2555, 2556, 2769]);

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/gu, '/');
}

function splitPackageSpecifier(specifier: string): { rootPackage: string } {
  const trimmed = specifier.trim();
  if (!trimmed.includes('/')) {
    return { rootPackage: trimmed };
  }
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    return { rootPackage: parts.length >= 2 ? `${parts[0]}/${parts[1]}` : trimmed };
  }
  return { rootPackage: trimmed.split('/')[0] ?? trimmed };
}

function packageFromNodeModulesPath(filePath: string): string | null {
  const normalized = normalizePathSeparators(filePath);
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  const after = normalized.slice(index + marker.length);
  const segments = after.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  if (segments[0]?.startsWith('@') && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? null;
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isSemverAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseSemver(version);
  const parsedMinimum = parseSemver(minimum);
  if (!parsedVersion || !parsedMinimum) return false;
  for (let i = 0; i < 3; i += 1) {
    const left = parsedVersion[i] ?? 0;
    const right = parsedMinimum[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function normalizePackagesFilter(packagesToCheck?: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const value of packagesToCheck ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
    normalized.add(splitPackageSpecifier(trimmed).rootPackage);
  }
  return normalized;
}

function shouldCheckPackage(packageName: string, packageFilter: Set<string>): boolean {
  if (packageFilter.size === 0) return true;
  const rootPackage = splitPackageSpecifier(packageName).rootPackage;
  return packageFilter.has(packageName) || packageFilter.has(rootPackage);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function findRootIdentifier(expression: ts.Expression): string | null {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return current.text;
  }
  if (ts.isAwaitExpression(current)) {
    return findRootIdentifier(current.expression);
  }
  if (ts.isCallExpression(current)) {
    return findRootIdentifier(current.expression);
  }
  if (ts.isPropertyAccessExpression(current)) {
    return findRootIdentifier(current.expression);
  }
  return null;
}

function resolveTypeName(type: ts.Type, checker: ts.TypeChecker): string | null {
  const aliasName = type.aliasSymbol?.getName();
  if (aliasName && aliasName !== '__type') return aliasName;
  const symbolName = type.getSymbol()?.getName();
  if (symbolName && symbolName !== '__type') return symbolName;
  const rendered = checker.typeToString(type);
  const match = rendered.match(/^([A-Za-z_][A-Za-z0-9_]*)/u);
  return match ? match[1] : null;
}

function collectTypeDeclarations(type: ts.Type): ts.Declaration[] {
  const declarations: ts.Declaration[] = [];
  const symbol = type.getSymbol();
  if (symbol?.declarations) {
    declarations.push(...symbol.declarations);
  }
  const alias = type.aliasSymbol;
  if (alias?.declarations) {
    declarations.push(...alias.declarations);
  }
  if (type.isUnionOrIntersection()) {
    for (const child of type.types) {
      declarations.push(...collectTypeDeclarations(child));
    }
  }
  return declarations;
}

function resolvePackageFromType(type: ts.Type): string | null {
  const declarations = collectTypeDeclarations(type);
  for (const declaration of declarations) {
    const fromPath = packageFromNodeModulesPath(declaration.getSourceFile().fileName);
    if (fromPath) return fromPath;
  }
  return null;
}

function isAnyLikeType(type: ts.Type): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
  if (type.isUnionOrIntersection()) {
    return type.types.some((child) => isAnyLikeType(child));
  }
  return false;
}

function collectImportBindings(sourceFile: ts.SourceFile, packageFilter: Set<string>): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const packageName = statement.moduleSpecifier.text.trim();
    if (!shouldCheckPackage(packageName, packageFilter)) continue;
    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name) {
      bindings.set(clause.name.text, { packageName, importName: 'default' });
    }

    if (!clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, { packageName, importName: '*' });
      continue;
    }
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const localName = element.name.text;
        const importName = element.propertyName?.text ?? element.name.text;
        bindings.set(localName, { packageName, importName });
      }
    }
  }
  return bindings;
}

function collectMethodCalls(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  imports: Map<string, ImportBinding>,
  packageFilter: Set<string>,
  signatureDiagnostics: readonly ts.Diagnostic[],
): MethodCallCandidate[] {
  const results: MethodCallCandidate[] = [];

  const signatureIssueAtNode = (node: ts.CallExpression): boolean => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    return signatureDiagnostics.some((diagnostic) => {
      if (diagnostic.start === undefined) return false;
      return diagnostic.start >= start && diagnostic.start < end;
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const propertyAccess = node.expression;
      const methodName = propertyAccess.name.text;
      const ownerExpression = propertyAccess.expression;
      const rootIdentifier = findRootIdentifier(ownerExpression);
      const importBinding = rootIdentifier ? imports.get(rootIdentifier) : undefined;
      const ownerType = checker.getTypeAtLocation(ownerExpression);
      const packageFromType = resolvePackageFromType(ownerType);
      const packageName = importBinding?.packageName ?? packageFromType;

      if (packageName && shouldCheckPackage(packageName, packageFilter)) {
        const importName =
          resolveTypeName(ownerType, checker) ??
          importBinding?.importName ??
          'default';
        const locationRaw = sourceFile.getLineAndCharacterOfPosition(propertyAccess.name.getStart(sourceFile));
        const rawCallSite = `${propertyAccess.getText(sourceFile)}()`;
        results.push({
          callSite: rawCallSite.length > 220 ? `${rawCallSite.slice(0, 217)}...` : rawCallSite,
          location: { line: locationRaw.line + 1, column: locationRaw.character + 1 },
          packageName,
          importName,
          memberName: methodName,
          anyLikeType: isAnyLikeType(ownerType),
          signatureIssue: signatureIssueAtNode(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results.sort((left, right) => {
    if (left.location.line !== right.location.line) return left.location.line - right.location.line;
    return left.location.column - right.location.column;
  });
}

async function readInstalledVersion(
  projectRoot: string,
  packageName: string,
  cache: Map<string, string>,
): Promise<string> {
  const rootPackage = splitPackageSpecifier(packageName).rootPackage;
  const cached = cache.get(rootPackage);
  if (cached) return cached;

  const packageJsonPath = path.join(projectRoot, 'node_modules', ...rootPackage.split('/'), 'package.json');
  try {
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    const version = typeof parsed.version === 'string' && parsed.version.trim().length > 0
      ? parsed.version.trim()
      : 'unknown';
    cache.set(rootPackage, version);
    return version;
  } catch {
    cache.set(rootPackage, 'unknown');
    return 'unknown';
  }
}

function findRemovedMethodHint(
  packageName: string,
  importName: string,
  memberName: string,
  installedVersion: string,
): RemovedMethodHint | null {
  const rootPackage = splitPackageSpecifier(packageName).rootPackage;
  const packageHints = REMOVED_METHOD_HINTS[packageName] ?? REMOVED_METHOD_HINTS[rootPackage];
  if (!packageHints) return null;
  const typeHints = packageHints[importName];
  if (!typeHints) return null;
  const hint = typeHints[memberName];
  if (!hint) return null;
  if (!isSemverAtLeast(installedVersion, hint.removedInVersion)) return null;
  return hint;
}

function toHallucinatedStatus(
  validation: ValidateImportReferenceResult,
  signatureIssue: boolean,
  packageName: string,
  importName: string,
  memberName: string,
  installedVersion: string,
): {
  status: HallucinatedCall['status'];
  confidence: number;
  removedInVersion?: string;
  replacement?: string;
} {
  if (validation.reason === 'ok') {
    if (signatureIssue) {
      return { status: 'wrong_signature', confidence: 0.95 };
    }
    return { status: 'verified', confidence: 1 };
  }

  if (validation.reason === 'unknown_member') {
    const removedHint = findRemovedMethodHint(packageName, importName, memberName, installedVersion);
    if (removedHint) {
      return {
        status: 'removed_in_version',
        confidence: 0.99,
        removedInVersion: removedHint.removedInVersion,
        replacement: removedHint.replacement,
      };
    }
    return { status: 'not_found', confidence: 0.95 };
  }

  if (validation.reason === 'framework_mismatch') {
    return { status: 'not_found', confidence: 0.95 };
  }

  return { status: 'unverifiable', confidence: 0 };
}

function buildAgentSummary(calls: HallucinatedCall[]): string {
  const verified = calls.filter((entry) => entry.status === 'verified').length;
  const hallucinated = calls.filter((entry) =>
    entry.status === 'not_found' || entry.status === 'removed_in_version' || entry.status === 'wrong_signature').length;
  const unverifiable = calls.filter((entry) => entry.status === 'unverifiable').length;

  if (calls.length === 0) {
    return 'No static package-member callsites were detected for verification.';
  }

  const removed = calls.filter((entry) => entry.status === 'removed_in_version');
  const removedHint = removed.length > 0 ? ` Removed-in-version calls: ${removed.length}.` : '';
  return `Validated ${calls.length} package callsite(s): ${verified} verified, ${hallucinated} blocking, ${unverifiable} unverifiable.${removedHint}`;
}

export function createHallucinatedApiDetectorConstruction(): Construction<
  APIDetectorInput,
  APIDetectorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'hallucinated-api-detector',
    name: 'Hallucinated API Detector',
    description: 'Detects generated calls to package APIs that do not exist in the installed package version.',
    async execute(input: APIDetectorInput) {
      const generatedCode = input.generatedCode?.trim();
      const projectRoot = input.projectRoot?.trim();
      if (!generatedCode) {
        throw new ConstructionError(
          'generatedCode is required and must be non-empty.',
          'hallucinated-api-detector',
        );
      }
      if (!projectRoot) {
        throw new ConstructionError(
          'projectRoot is required and must be non-empty.',
          'hallucinated-api-detector',
        );
      }

      const resolvedProjectRoot = path.resolve(projectRoot);
      const packageFilter = normalizePackagesFilter(input.packagesToCheck);
      const virtualFile = path.join(
        resolvedProjectRoot,
        '.librarian',
        '__generated__',
        '__hallucinated_api_detector__.ts',
      );

      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
      };
      const baseHost = ts.createCompilerHost(compilerOptions, true);
      const host: ts.CompilerHost = {
        ...baseHost,
        getCurrentDirectory: () => resolvedProjectRoot,
        fileExists: (fileName) => {
          if (path.resolve(fileName) === path.resolve(virtualFile)) return true;
          return baseHost.fileExists(fileName);
        },
        readFile: (fileName) => {
          if (path.resolve(fileName) === path.resolve(virtualFile)) return generatedCode;
          return baseHost.readFile(fileName);
        },
        getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
          if (path.resolve(fileName) === path.resolve(virtualFile)) {
            return ts.createSourceFile(fileName, generatedCode, languageVersion, true, ts.ScriptKind.TS);
          }
          return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
        },
      };

      const program = ts.createProgram({
        rootNames: [virtualFile],
        options: compilerOptions,
        host,
      });
      const sourceFile = program.getSourceFile(virtualFile);
      if (!sourceFile) {
        throw new ConstructionError(
          'Unable to parse generatedCode into a TypeScript source file.',
          'hallucinated-api-detector',
        );
      }

      const checker = program.getTypeChecker();
      const diagnostics = program.getSemanticDiagnostics(sourceFile)
        .filter((diagnostic) => SIGNATURE_DIAGNOSTIC_CODES.has(diagnostic.code));
      const imports = collectImportBindings(sourceFile, packageFilter);
      const candidates = collectMethodCalls(sourceFile, checker, imports, packageFilter, diagnostics);
      const validationCache = new Map<string, ValidateImportReferenceResult>();
      const versionCache = new Map<string, string>();
      const calls: HallucinatedCall[] = [];

      for (const candidate of candidates) {
        const installedVersion = await readInstalledVersion(
          resolvedProjectRoot,
          candidate.packageName,
          versionCache,
        );

        if (candidate.anyLikeType) {
          calls.push({
            callSite: candidate.callSite,
            location: candidate.location,
            package: candidate.packageName,
            installedVersion,
            status: 'unverifiable',
            confidence: 0,
          });
          continue;
        }

        const cacheKey = `${candidate.packageName}\u0000${candidate.importName}\u0000${candidate.memberName}`;
        let validation = validationCache.get(cacheKey);
        if (!validation) {
          try {
            validation = await validateImportReference(resolvedProjectRoot, {
              packageName: candidate.packageName,
              importName: candidate.importName,
              memberName: candidate.memberName,
            });
          } catch {
            validation = {
              valid: false,
              packageName: candidate.packageName,
              importName: candidate.importName,
              memberName: candidate.memberName,
              reason: 'package_not_found',
              suggestions: [],
            };
          }
          validationCache.set(cacheKey, validation);
        }

        const normalized = toHallucinatedStatus(
          validation,
          candidate.signatureIssue,
          candidate.packageName,
          candidate.importName,
          candidate.memberName,
          installedVersion,
        );

        calls.push({
          callSite: candidate.callSite,
          location: candidate.location,
          package: candidate.packageName,
          installedVersion,
          status: normalized.status,
          removedInVersion: normalized.removedInVersion,
          replacement: normalized.replacement,
          confidence: normalized.confidence,
        });
      }

      const hallucinatedCount = calls.filter((entry) =>
        entry.status === 'not_found' ||
        entry.status === 'removed_in_version' ||
        entry.status === 'wrong_signature').length;
      const unverifiableCount = calls.filter((entry) => entry.status === 'unverifiable').length;
      const hasBlockingIssues = hallucinatedCount > 0;

      return ok<APIDetectorOutput, ConstructionError>({
        calls,
        hallucinatedCount,
        unverifiableCount,
        agentSummary: buildAgentSummary(calls),
        hasBlockingIssues,
      });
    },
  };
}
