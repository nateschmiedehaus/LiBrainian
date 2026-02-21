/**
 * @fileoverview Entry Point Detection for LiBrainian
 *
 * Identifies application entry points through multiple strategies:
 * 1. Package.json fields: main, bin, exports
 * 2. Dependency tree roots: modules imported by nothing
 * 3. Factory patterns: createX, makeX, buildX exported functions
 *
 * Entry points are indexed as a special knowledge type to ensure
 * queries about "entry points", "main", "start" return accurate results.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ModuleKnowledge, FunctionKnowledge } from '../types.js';
import { safeJsonParse } from '../utils/safe_json.js';

// ============================================================================
// TYPES
// ============================================================================

export type EntryPointKind =
  | 'package_main'      // package.json "main" field
  | 'package_bin'       // package.json "bin" field
  | 'package_exports'   // package.json "exports" field
  | 'dependency_root'   // Module not imported by any other module
  | 'factory_function'  // createX, makeX, buildX pattern
  | 'index_module'      // index.ts/js file
  | 'cli_entry'         // bin/ directory or shebang files
  | 'summary';          // Summary record (aggregates all entry points)

export interface DetectedEntryPoint {
  /** Unique identifier for this entry point */
  id: string;

  /** Kind of entry point */
  kind: EntryPointKind;

  /** File path (absolute) */
  path: string;

  /** Relative path from workspace root */
  relativePath: string;

  /** Human-readable name */
  name: string;

  /** Description of what this entry point does */
  description: string;

  /** Exported symbols (for factory functions) */
  exports: string[];

  /** Confidence score (0-1) */
  confidence: number;

  /** Number of modules that depend on this (for roots) */
  dependentCount: number;

  /** Source of detection */
  source: 'package_json' | 'dependency_analysis' | 'pattern_detection' | 'summary';
}

export interface EntryPointDetectionResult {
  /** All detected entry points */
  entryPoints: DetectedEntryPoint[];

  /** Counts by kind */
  countsByKind: Record<EntryPointKind, number>;

  /** Detection metadata */
  metadata: {
    packageJsonFound: boolean;
    totalModulesAnalyzed: number;
    totalFunctionsAnalyzed: number;
    detectionDurationMs: number;
  };
}

export interface EntryPointDetectionOptions {
  /** Workspace root directory */
  workspace: string;

  /** All indexed modules */
  modules: ModuleKnowledge[];

  /** All indexed functions */
  functions: FunctionKnowledge[];

  /** Whether to include index files as entry points */
  includeIndexFiles?: boolean;

  /** Whether to include CLI entries from bin/ */
  includeCliEntries?: boolean;

  /** Minimum confidence for factory function detection */
  factoryConfidenceThreshold?: number;
}

// ============================================================================
// FACTORY FUNCTION PATTERNS
// ============================================================================

/**
 * Patterns that indicate a factory function - these are primary entry points
 * for programmatic API usage.
 */
const FACTORY_PATTERNS = [
  /^create[A-Z]/,      // createLiBrainian, createStorage, createApp
  /^make[A-Z]/,        // makeStore, makeConfig
  /^build[A-Z]/,       // buildContext, buildQuery
  /^init[A-Z]/,        // initializeApp, initConfig
  /^setup[A-Z]/,       // setupRouter, setupMiddleware
  /^new[A-Z]/,         // newInstance (rare but valid)
  /^get[A-Z].*(?:Instance|Factory|Builder)$/i,  // getAppInstance, getServiceFactory
];

/**
 * Common factory function names that are almost certainly entry points
 */
const WELL_KNOWN_FACTORIES = new Set([
  'createApp',
  'createServer',
  'createClient',
  'createStore',
  'createRouter',
  'createContext',
  'createLiBrainian',
  'makeApp',
  'makeStore',
  'buildApp',
  'initialize',
  'bootstrap',
  'main',
  'run',
  'start',
  'launch',
]);

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Main entry point detection function.
 * Combines multiple detection strategies to identify all entry points.
 */
export async function detectEntryPoints(
  options: EntryPointDetectionOptions
): Promise<EntryPointDetectionResult> {
  const startTime = Date.now();
  const entryPoints: DetectedEntryPoint[] = [];
  const includeIndexFiles = options.includeIndexFiles ?? true;
  const includeCliEntries = options.includeCliEntries ?? true;
  const factoryThreshold = options.factoryConfidenceThreshold ?? 0.6;

  let packageJsonFound = false;

  // Strategy 1: Package.json analysis
  const packageEntryPoints = await detectPackageJsonEntryPoints(options.workspace);
  packageJsonFound = packageEntryPoints.length > 0;
  entryPoints.push(...packageEntryPoints);

  // Strategy 2: Dependency tree root detection
  const rootModules = detectDependencyRoots(options.modules);
  entryPoints.push(...rootModules);

  // Strategy 3: Factory function detection
  const factoryFunctions = detectFactoryFunctions(
    options.functions,
    options.modules,
    factoryThreshold
  );
  entryPoints.push(...factoryFunctions);

  // Strategy 4: Index file detection (optional)
  if (includeIndexFiles) {
    const indexModules = detectIndexModules(options.modules, options.workspace);
    // Only add if not already detected with same kind
    for (const idx of indexModules) {
      if (!entryPoints.some(ep => ep.path === idx.path && ep.kind === idx.kind)) {
        entryPoints.push(idx);
      }
    }
  }

  // Strategy 5: CLI entry detection (optional)
  if (includeCliEntries) {
    const cliEntries = detectCliEntries(options.modules, options.workspace);
    for (const cli of cliEntries) {
      if (!entryPoints.some(ep => ep.path === cli.path && ep.kind === cli.kind)) {
        entryPoints.push(cli);
      }
    }
  }

  // Deduplicate by path (keep highest confidence)
  const deduped = deduplicateEntryPoints(entryPoints);

  // Sort by confidence (highest first)
  deduped.sort((a, b) => b.confidence - a.confidence);

  // Count by kind
  const countsByKind = {} as Record<EntryPointKind, number>;
  for (const ep of deduped) {
    countsByKind[ep.kind] = (countsByKind[ep.kind] ?? 0) + 1;
  }

  return {
    entryPoints: deduped,
    countsByKind,
    metadata: {
      packageJsonFound,
      totalModulesAnalyzed: options.modules.length,
      totalFunctionsAnalyzed: options.functions.length,
      detectionDurationMs: Date.now() - startTime,
    },
  };
}

/**
 * Detect entry points from package.json fields.
 */
async function detectPackageJsonEntryPoints(
  workspace: string
): Promise<DetectedEntryPoint[]> {
  const entryPoints: DetectedEntryPoint[] = [];
  const packageJsonPath = path.join(workspace, 'package.json');

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const parsed = safeJsonParse<Record<string, unknown>>(content);
    if (!parsed.ok) return entryPoints;

    const pkg = parsed.value;

    // Main field
    if (typeof pkg.main === 'string' && pkg.main) {
      const mainPath = resolveEntryPath(workspace, pkg.main);
      entryPoints.push({
        id: `pkg_main:${mainPath}`,
        kind: 'package_main',
        path: mainPath,
        relativePath: pkg.main,
        name: path.basename(pkg.main, path.extname(pkg.main)),
        description: `Main entry point for package "${pkg.name ?? 'unknown'}"`,
        exports: [],
        confidence: 1.0,  // Highest confidence - explicitly declared
        dependentCount: 0,
        source: 'package_json',
      });
    }

    // Bin field (can be string or object)
    if (pkg.bin) {
      if (typeof pkg.bin === 'string') {
        const binPath = resolveEntryPath(workspace, pkg.bin);
        entryPoints.push({
          id: `pkg_bin:${binPath}`,
          kind: 'package_bin',
          path: binPath,
          relativePath: pkg.bin,
          name: typeof pkg.name === 'string' ? pkg.name : path.basename(pkg.bin),
          description: `CLI binary entry point`,
          exports: [],
          confidence: 1.0,
          dependentCount: 0,
          source: 'package_json',
        });
      } else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
        for (const [binName, binFile] of Object.entries(pkg.bin)) {
          if (typeof binFile === 'string') {
            const binPath = resolveEntryPath(workspace, binFile);
            entryPoints.push({
              id: `pkg_bin:${binPath}`,
              kind: 'package_bin',
              path: binPath,
              relativePath: binFile,
              name: binName,
              description: `CLI binary "${binName}"`,
              exports: [],
              confidence: 1.0,
              dependentCount: 0,
              source: 'package_json',
            });
          }
        }
      }
    }

    // Exports field (complex, handle common patterns)
    if (pkg.exports) {
      const exportEntries = parseExportsField(pkg.exports, workspace);
      entryPoints.push(...exportEntries);
    }
  } catch {
    // No package.json or read error - not an error condition
  }

  return entryPoints;
}

/**
 * Parse the complex package.json exports field.
 */
function parseExportsField(
  exports: unknown,
  workspace: string
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];

  if (typeof exports === 'string') {
    // Simple string export
    const exportPath = resolveEntryPath(workspace, exports);
    entryPoints.push({
      id: `pkg_exports:${exportPath}`,
      kind: 'package_exports',
      path: exportPath,
      relativePath: exports,
      name: 'default',
      description: 'Package default export',
      exports: [],
      confidence: 1.0,
      dependentCount: 0,
      source: 'package_json',
    });
  } else if (typeof exports === 'object' && exports !== null) {
    // Object export map
    for (const [key, value] of Object.entries(exports)) {
      let resolvedPath: string | null = null;

      if (typeof value === 'string') {
        resolvedPath = value;
      } else if (typeof value === 'object' && value !== null) {
        // Handle conditional exports - prefer 'default' or 'import'
        const conditional = value as Record<string, unknown>;
        resolvedPath =
          (typeof conditional.default === 'string' && conditional.default) ||
          (typeof conditional.import === 'string' && conditional.import) ||
          (typeof conditional.require === 'string' && conditional.require) ||
          null;
      }

      if (resolvedPath) {
        const fullPath = resolveEntryPath(workspace, resolvedPath);
        entryPoints.push({
          id: `pkg_exports:${fullPath}`,
          kind: 'package_exports',
          path: fullPath,
          relativePath: resolvedPath,
          name: key === '.' ? 'default' : key.replace(/^\.\//, ''),
          description: `Package export "${key}"`,
          exports: [],
          confidence: 0.95,  // Slightly lower than main for sub-exports
          dependentCount: 0,
          source: 'package_json',
        });
      }
    }
  }

  return entryPoints;
}

/**
 * Detect modules that are roots of the dependency tree
 * (not imported by any other module).
 */
function detectDependencyRoots(
  modules: ModuleKnowledge[]
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];

  // Build set of all imported modules
  const importedPaths = new Set<string>();
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      // Normalize the dependency path
      importedPaths.add(dep);
      // Also try with common extensions
      importedPaths.add(dep.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ''));
    }
  }

  // Find modules not in the imported set
  for (const mod of modules) {
    const normalizedPath = mod.path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

    if (!importedPaths.has(mod.path) && !importedPaths.has(normalizedPath)) {
      // This module is a root - not imported by anything

      // Calculate how many modules depend on this (if any via indirect imports)
      const dependentCount = countDependents(mod.path, modules);

      // Higher confidence for modules with more exports and dependencies
      const hasExports = mod.exports.length > 0;
      const hasDependencies = mod.dependencies.length > 0;
      let confidence = 0.7;  // Base confidence for roots

      if (hasExports && hasDependencies) {
        confidence = 0.85;  // Looks like a real module
      } else if (!hasExports && !hasDependencies) {
        confidence = 0.5;  // Might be a stub or orphan
      }

      entryPoints.push({
        id: `dep_root:${mod.path}`,
        kind: 'dependency_root',
        path: mod.path,
        relativePath: extractRelativePath(mod.path),
        name: path.basename(mod.path, path.extname(mod.path)),
        description: `Root module - not imported by other modules. ${
          hasExports ? `Exports: ${mod.exports.slice(0, 3).join(', ')}` : 'No exports.'
        }`,
        exports: mod.exports,
        confidence,
        dependentCount,
        source: 'dependency_analysis',
      });
    }
  }

  return entryPoints;
}

/**
 * Detect factory functions that serve as programmatic entry points.
 */
function detectFactoryFunctions(
  functions: FunctionKnowledge[],
  modules: ModuleKnowledge[],
  confidenceThreshold: number
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];

  // Build map of module exports for cross-reference
  const exportedFunctions = new Set<string>();
  for (const mod of modules) {
    for (const exp of mod.exports) {
      exportedFunctions.add(exp);
    }
  }

  for (const fn of functions) {
    const isFactory = isFactoryFunction(fn.name);
    const isExported = exportedFunctions.has(fn.name);

    if (!isFactory) continue;

    // Calculate confidence based on multiple factors
    let confidence = 0.6;  // Base for any factory pattern match

    // Boost for being exported
    if (isExported) confidence += 0.2;

    // Boost for well-known names
    if (WELL_KNOWN_FACTORIES.has(fn.name)) confidence += 0.15;

    // Boost for having a meaningful purpose description
    if (fn.purpose && fn.purpose.length > 20) confidence += 0.05;

    // Cap at 0.95 (never 1.0 for pattern detection)
    confidence = Math.min(0.95, confidence);

    if (confidence < confidenceThreshold) continue;

    entryPoints.push({
      id: `factory:${fn.id}`,
      kind: 'factory_function',
      path: fn.filePath,
      relativePath: extractRelativePath(fn.filePath),
      name: fn.name,
      description: fn.purpose || `Factory function ${fn.name} - creates and returns instances`,
      exports: isExported ? [fn.name] : [],
      confidence,
      dependentCount: 0,
      source: 'pattern_detection',
    });
  }

  return entryPoints;
}

/**
 * Detect index.ts/index.js files as entry points.
 */
function detectIndexModules(
  modules: ModuleKnowledge[],
  workspace: string
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];

  for (const mod of modules) {
    const basename = path.basename(mod.path);
    const isIndex = /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(basename);

    if (!isIndex) continue;

    // Calculate confidence based on depth and exports
    const depth = mod.path.split(path.sep).length;
    let confidence = 0.5;  // Base for index files

    // Top-level index files are more important
    if (depth <= 3) confidence += 0.25;

    // Index files with exports are more significant
    if (mod.exports.length > 0) confidence += 0.15;

    // Index files in src/ are typically entry points
    if (mod.path.includes('/src/') || mod.path.includes('\\src\\')) {
      confidence += 0.1;
    }

    entryPoints.push({
      id: `index:${mod.path}`,
      kind: 'index_module',
      path: mod.path,
      relativePath: extractRelativePath(mod.path),
      name: path.dirname(mod.path).split(path.sep).pop() ?? 'index',
      description: `Index module for ${path.dirname(extractRelativePath(mod.path))}. ${
        mod.exports.length > 0
          ? `Exports: ${mod.exports.slice(0, 5).join(', ')}`
          : 'Re-exports from directory.'
      }`,
      exports: mod.exports,
      confidence: Math.min(0.9, confidence),
      dependentCount: 0,
      source: 'pattern_detection',
    });
  }

  return entryPoints;
}

/**
 * Detect CLI entry points from bin/ directory.
 */
function detectCliEntries(
  modules: ModuleKnowledge[],
  workspace: string
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];

  for (const mod of modules) {
    const inBinDir = mod.path.includes('/bin/') || mod.path.includes('\\bin\\');
    const isCli = inBinDir || mod.path.includes('/cli/') || mod.path.includes('\\cli\\');

    if (!isCli) continue;

    entryPoints.push({
      id: `cli:${mod.path}`,
      kind: 'cli_entry',
      path: mod.path,
      relativePath: extractRelativePath(mod.path),
      name: path.basename(mod.path, path.extname(mod.path)),
      description: `CLI entry point. ${mod.purpose || ''}`.trim(),
      exports: mod.exports,
      confidence: 0.85,  // High confidence for bin/cli directories
      dependentCount: 0,
      source: 'pattern_detection',
    });
  }

  return entryPoints;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isFactoryFunction(name: string): boolean {
  // Check well-known names first
  if (WELL_KNOWN_FACTORIES.has(name)) return true;

  // Check patterns
  return FACTORY_PATTERNS.some(pattern => pattern.test(name));
}

function resolveEntryPath(workspace: string, entryPath: string): string {
  // Handle relative paths
  let resolved = entryPath;
  if (!path.isAbsolute(entryPath)) {
    resolved = path.join(workspace, entryPath);
  }

  // Try to resolve with common extensions if no extension present
  const ext = path.extname(resolved);
  if (!ext) {
    // In practice, we just return the path as-is; the caller will match
    // against actual files
    return resolved;
  }

  return resolved;
}

function extractRelativePath(absolutePath: string): string {
  // Simple extraction - remove common prefixes
  const markers = ['/src/', '\\src\\', '/lib/', '\\lib\\'];
  for (const marker of markers) {
    const idx = absolutePath.indexOf(marker);
    if (idx !== -1) {
      return absolutePath.slice(idx + 1);
    }
  }
  // Fallback: return last 3 path segments
  const parts = absolutePath.split(path.sep);
  return parts.slice(-3).join('/');
}

function countDependents(modulePath: string, modules: ModuleKnowledge[]): number {
  let count = 0;
  const normalizedPath = modulePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');

  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      if (dep === modulePath || dep.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') === normalizedPath) {
        count++;
        break;
      }
    }
  }

  return count;
}

function deduplicateEntryPoints(entryPoints: DetectedEntryPoint[]): DetectedEntryPoint[] {
  // Deduplicate by path AND kind - a file can be both index_module and factory_function
  const byPathAndKind = new Map<string, DetectedEntryPoint>();

  for (const ep of entryPoints) {
    const key = `${ep.path}::${ep.kind}`;
    const existing = byPathAndKind.get(key);
    if (!existing || ep.confidence > existing.confidence) {
      byPathAndKind.set(key, ep);
    }
  }

  return Array.from(byPathAndKind.values());
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Keywords that indicate a query is about entry points.
 */
export const ENTRY_POINT_QUERY_PATTERNS = [
  /\bentry\s*point/i,
  /\bmain\s*(file|module|entry)?/i,  // Match "main" alone or "main file/module/entry"
  /\bstart(ing)?\s*point/i,
  /\bbootstrap/i,
  /\binitialize?/i,
  /\bwhere\b.*\bstart/i,  // "where do I start", "where to start", etc.
  /\bhow\s+to\s+(use|start|run)/i,
  /\bAPI\s*(entry|main)/i,
  /\bcli\s*(entry|command)/i,
  /\bbin(ary)?\s*(entry)?/i,
  /\bfactory\s*(function)?/i,
  /\bcreate[A-Z]\w+/,  // Specific factory function lookups
  /\bmake[A-Z]\w+/,
  /\bprimary\s*(export|entry)/i,  // "primary export"
  /\bpackage\.json\s*(main|entry|exports)/i,  // "package.json main"
  /\broot\s*(module|entry)/i,  // "root module"
  /\bindex\s*(file|module)?/i,  // "index file"
];

/**
 * Check if a query is asking about entry points.
 */
export function isEntryPointQuery(intent: string): boolean {
  return ENTRY_POINT_QUERY_PATTERNS.some(pattern => pattern.test(intent));
}

/**
 * Calculate relevance score for an entry point given a query.
 * Returns a score that may exceed 1.0 to allow ranking comparisons
 * even when base confidence is already at maximum.
 */
export function scoreEntryPointForQuery(
  entryPoint: DetectedEntryPoint,
  queryIntent: string
): number {
  const intentLower = queryIntent.toLowerCase();
  let boost = 0;

  // Boost for specific mentions
  if (intentLower.includes(entryPoint.name.toLowerCase())) {
    boost += 0.3;
  }

  // Boost by kind relevance
  if (intentLower.includes('cli') && entryPoint.kind === 'cli_entry') {
    boost += 0.25;
  }
  if (intentLower.includes('main') && entryPoint.kind === 'package_main') {
    boost += 0.25;
  }
  if (intentLower.includes('factory') && entryPoint.kind === 'factory_function') {
    boost += 0.25;
  }
  if (intentLower.includes('api') && entryPoint.kind === 'package_exports') {
    boost += 0.2;
  }
  if (intentLower.includes('entry') && entryPoint.kind === 'package_main') {
    boost += 0.1;
  }

  // Return boosted score - allow exceeding 1.0 for ranking purposes
  return entryPoint.confidence + boost;
}
