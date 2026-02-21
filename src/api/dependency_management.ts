/**
 * @fileoverview Dependency Management Support System for Agents
 *
 * Provides comprehensive dependency analysis capabilities:
 * - Direct and dev dependency tracking
 * - Transitive dependency resolution
 * - Unused dependency detection
 * - Duplicate dependency identification
 * - Outdated dependency checking
 * - Dependency issue detection (security, deprecated, unmaintained)
 * - Actionable recommendations
 *
 * Integrates with the query system to allow agents to ask:
 * - "analyze dependencies"
 * - "check for unused packages"
 * - "find outdated dependencies"
 * - "show dependency issues"
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { LiBrainianStorage, FileKnowledge } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Complete dependency analysis result.
 */
export interface DependencyAnalysis {
  direct: DependencyInfo[];
  dev: DependencyInfo[];
  transitive: TransitiveDep[];
  unused: string[];
  duplicates: DuplicateDep[];
  outdated: OutdatedDep[];
  issues: DependencyIssue[];
  recommendations: DependencyRecommendation[];
}

/**
 * Information about a single dependency.
 */
export interface DependencyInfo {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer' | 'optional';
  description?: string;
  usedIn: string[];  // Files that import this
  importCount: number;
  lastUpdated?: string;
  license?: string;
}

/**
 * Information about a transitive dependency.
 */
export interface TransitiveDep {
  name: string;
  version: string;
  requiredBy: string[];
  depth: number;
}

/**
 * Information about duplicate dependencies (multiple versions).
 */
export interface DuplicateDep {
  name: string;
  versions: string[];
  locations: string[];
  recommendation: string;
}

/**
 * Information about outdated dependencies.
 */
export interface OutdatedDep {
  name: string;
  current: string;
  latest: string;
  latestStable: string;
  updateType: 'major' | 'minor' | 'patch';
  breaking: boolean;
  changelog?: string;
}

/**
 * Issues found with dependencies.
 */
export interface DependencyIssue {
  type: 'security' | 'deprecated' | 'unmaintained' | 'license' | 'size';
  package: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  fix?: string;
}

/**
 * Recommendations for dependency management.
 */
export interface DependencyRecommendation {
  type: 'add' | 'remove' | 'upgrade' | 'replace';
  package: string;
  reason: string;
  command?: string;
}

// ============================================================================
// QUERY PATTERNS FOR DEPENDENCY MANAGEMENT
// ============================================================================

/**
 * Patterns that indicate a dependency management query.
 * Used to detect when an agent is asking about dependencies.
 */
export const DEPENDENCY_MANAGEMENT_PATTERNS = [
  /\banalyze\s+dep(?:s|endenc(?:y|ies))?\b/i,
  /\bcheck\s+(?:for\s+)?(?:unused|orphan(?:ed)?)\s+(?:packages?|dep(?:endenc(?:y|ies))?|modules?)\b/i,
  /\bfind\s+(?:unused|orphan(?:ed)?)\s+(?:packages?|dep(?:endenc(?:y|ies))?)\b/i,
  /\b(?:show|list|get)\s+(?:outdated|old)\s+(?:packages?|dep(?:endenc(?:y|ies))?)\b/i,
  /\b(?:dep(?:endenc(?:y|ies))?)\s+(?:analysis|audit|check|issues?|problems?)\b/i,
  /\bwhat\s+(?:packages?|dep(?:endenc(?:y|ies))?)\s+(?:are\s+)?(?:unused|outdated|duplicated?)\b/i,
  /\b(?:npm|yarn|pnpm)\s+(?:audit|outdated|unused)\b/i,
  /\bduplicate\s+(?:packages?|dep(?:endenc(?:y|ies))?)\b/i,
  /\b(?:security|vulnerability)\s+(?:check|scan|audit)\s+(?:for\s+)?(?:packages?|dep(?:endenc(?:y|ies))?)\b/i,
  /\bcheck\s+(?:package|dep(?:endenc(?:y|ies))?)\s+(?:security|vulnerabilit(?:y|ies))\b/i,
];

/**
 * Check if a query is asking about dependency management.
 */
export function isDependencyManagementQuery(intent: string): boolean {
  return DEPENDENCY_MANAGEMENT_PATTERNS.some(p => p.test(intent));
}

/**
 * Extract the specific dependency management action from a query.
 */
export function extractDependencyAction(
  intent: string
): 'analyze' | 'unused' | 'outdated' | 'duplicates' | 'issues' | 'all' {
  const lowerIntent = intent.toLowerCase();

  if (/unused|orphan/.test(lowerIntent)) {
    return 'unused';
  }
  if (/outdated|old|update/.test(lowerIntent)) {
    return 'outdated';
  }
  if (/duplicate/.test(lowerIntent)) {
    return 'duplicates';
  }
  if (/issue|problem|security|vulnerab/.test(lowerIntent)) {
    return 'issues';
  }
  if (/analyze|analysis|audit|check/.test(lowerIntent)) {
    return 'all';
  }

  return 'analyze';
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze project dependencies comprehensively.
 *
 * @param workspace - Path to the project workspace
 * @param storage - LiBrainian storage for file access
 * @returns Complete dependency analysis
 */
export async function analyzeDependencies(
  workspace: string,
  storage: LiBrainianStorage
): Promise<DependencyAnalysis> {
  const pkgPath = path.join(workspace, 'package.json');
  const lockPath = path.join(workspace, 'package-lock.json');

  // Read and parse package.json
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
  } catch {
    // Return empty analysis if no package.json
    return {
      direct: [],
      dev: [],
      transitive: [],
      unused: [],
      duplicates: [],
      outdated: [],
      issues: [],
      recommendations: [],
    };
  }

  // Analyze direct dependencies
  const direct = await analyzeDirect(pkg.dependencies ?? {}, storage, workspace, false);
  const dev = await analyzeDirect(pkg.devDependencies ?? {}, storage, workspace, true);

  // Find unused dependencies
  const unused = await findUnusedDependencies(storage, pkg, workspace);

  // Find duplicates (from lock file)
  const duplicates = await findDuplicates(lockPath);

  // Find transitive dependencies
  const transitive = await findTransitiveDependencies(lockPath, pkg);

  // Check for outdated
  const outdated = await checkOutdated(workspace);

  // Find issues
  const issues = await findDependencyIssues(pkg, outdated);

  // Generate recommendations
  const recommendations = generateRecommendations(unused, outdated, issues, duplicates);

  return {
    direct,
    dev,
    transitive,
    unused,
    duplicates,
    outdated,
    issues,
    recommendations,
  };
}

// ============================================================================
// DIRECT DEPENDENCY ANALYSIS
// ============================================================================

/**
 * Analyze direct dependencies and track their usage in the codebase.
 */
async function analyzeDirect(
  deps: Record<string, string>,
  storage: LiBrainianStorage,
  workspace: string,
  isDev: boolean
): Promise<DependencyInfo[]> {
  const result: DependencyInfo[] = [];

  // Get all files from storage
  const allFiles = await storage.getFiles();
  const fileContents = new Map<string, string>();

  for (const [name, version] of Object.entries(deps)) {
    // Count imports
    let importCount = 0;
    const usedIn: string[] = [];

    for (const file of allFiles) {
      // Skip non-code files
      if (!isCodeFile(file.path)) {
        continue;
      }

      let content = fileContents.get(file.path);
      if (!content) {
        try {
          const fullPath = path.isAbsolute(file.path)
            ? file.path
            : path.join(workspace, file.path);
          content = await fs.promises.readFile(fullPath, 'utf-8');
          fileContents.set(file.path, content);
        } catch {
          // File might not exist or be inaccessible
          content = '';
          fileContents.set(file.path, content);
        }
      }

      // Check for imports
      if (checkImport(content, name)) {
        importCount++;
        usedIn.push(file.path);
      }
    }

    result.push({
      name,
      version,
      type: isDev ? 'dev' : 'runtime',
      usedIn,
      importCount,
    });
  }

  return result.sort((a, b) => b.importCount - a.importCount);
}

/**
 * Check if a file is a code file that should be scanned for imports.
 */
function isCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext);
}

/**
 * Check if file content imports a specific package.
 */
function checkImport(content: string, packageName: string): boolean {
  // Escape special regex characters in package name
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const importPatterns = [
    // ES6 imports: import X from 'package' or import { X } from 'package'
    new RegExp(`from\\s+['"]${escapedName}(?:/[^'"]*)?['"]`, 'g'),
    // CommonJS require: require('package')
    new RegExp(`require\\s*\\(\\s*['"]${escapedName}(?:/[^'"]*)?['"]\\s*\\)`, 'g'),
    // Dynamic import: import('package')
    new RegExp(`import\\s*\\(\\s*['"]${escapedName}(?:/[^'"]*)?['"]\\s*\\)`, 'g'),
  ];

  return importPatterns.some(p => p.test(content));
}

// ============================================================================
// UNUSED DEPENDENCY DETECTION
// ============================================================================

/**
 * Find dependencies that appear to be unused in the codebase.
 */
async function findUnusedDependencies(
  storage: LiBrainianStorage,
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
  workspace: string
): Promise<string[]> {
  const unused: string[] = [];
  const allDeps = { ...(pkg.dependencies ?? {}) };  // Only check runtime deps

  // Get all files and concatenate content
  const allFiles = await storage.getFiles();
  const allContentParts: string[] = [];

  for (const file of allFiles) {
    if (!isCodeFile(file.path)) continue;
    try {
      // Read file content - resolve path relative to workspace
      const fullPath = path.isAbsolute(file.path)
        ? file.path
        : path.join(workspace, file.path);
      const content = await fs.promises.readFile(fullPath, 'utf-8').catch(() => '');
      allContentParts.push(content);
    } catch {
      // Ignore files that can't be read
    }
  }

  const allContent = allContentParts.join('\n');

  for (const dep of Object.keys(allDeps)) {
    // Skip common implicit dependencies that might not have direct imports
    if (isImplicitDependency(dep)) {
      continue;
    }

    // Check if imported anywhere
    if (!checkImport(allContent, dep)) {
      unused.push(dep);
    }
  }

  return unused;
}

/**
 * Check if a dependency is commonly implicit (no direct imports needed).
 */
function isImplicitDependency(name: string): boolean {
  const implicitPatterns = [
    /^typescript$/,
    /^@types\//,
    /^eslint/,
    /^prettier/,
    /^tslib$/,
    /^@babel\//,
    /^webpack/,
    /^vite$/,
    /^rollup/,
    /^esbuild$/,
    /^jest$/,
    /^vitest$/,
    /^mocha$/,
    /^ts-node$/,
    /^tsx$/,
  ];

  return implicitPatterns.some(p => p.test(name));
}

// ============================================================================
// DUPLICATE DEPENDENCY DETECTION
// ============================================================================

/**
 * Find packages with multiple versions installed (duplicates).
 */
async function findDuplicates(lockPath: string): Promise<DuplicateDep[]> {
  const duplicates: DuplicateDep[] = [];

  try {
    const rawContent = await fs.promises.readFile(lockPath, 'utf-8');
    if (typeof rawContent !== 'string') {
      return duplicates;
    }
    const lock = JSON.parse(rawContent);
    const packages = lock.packages ?? {};

    const versions = new Map<string, Set<string>>();
    const locations = new Map<string, string[]>();

    for (const [pkgPath, info] of Object.entries(packages)) {
      if (!pkgPath || pkgPath === '') continue;

      // Extract package name from path
      const name = extractPackageName(pkgPath);
      if (!name || !info) continue;

      const version = (info as { version?: string }).version;
      if (!version) continue;

      if (!versions.has(name)) {
        versions.set(name, new Set());
        locations.set(name, []);
      }

      versions.get(name)!.add(version);
      locations.get(name)!.push(pkgPath);
    }

    for (const [name, vers] of versions) {
      if (vers.size > 1) {
        duplicates.push({
          name,
          versions: Array.from(vers).sort(),
          locations: locations.get(name) ?? [],
          recommendation: `Consider deduplicating with \`npm dedupe\` or check for conflicting version requirements`,
        });
      }
    }
  } catch {
    // Lock file might not exist or be malformed
  }

  return duplicates;
}

/**
 * Extract package name from lock file path.
 */
function extractPackageName(pkgPath: string): string | undefined {
  // Remove node_modules prefix and extract name
  // e.g., "node_modules/lodash" -> "lodash"
  // e.g., "node_modules/@types/node" -> "@types/node"
  // e.g., "node_modules/a/node_modules/b" -> "b"

  // Handle paths that start with 'node_modules/' or contain '/node_modules/'
  // Split on 'node_modules/' to handle both cases
  const parts = pkgPath.split('node_modules/');
  // Get the last part after any 'node_modules/' segment
  const lastPart = parts[parts.length - 1];

  if (!lastPart) return undefined;

  // Handle scoped packages (e.g., "@types/node")
  if (lastPart.startsWith('@')) {
    const scopedParts = lastPart.split('/');
    if (scopedParts.length >= 2) {
      return `${scopedParts[0]}/${scopedParts[1]}`;
    }
  }

  // For non-scoped packages, take the first path segment
  return lastPart.split('/')[0] || undefined;
}

// ============================================================================
// TRANSITIVE DEPENDENCY ANALYSIS
// ============================================================================

/**
 * Find transitive dependencies and their depth.
 */
async function findTransitiveDependencies(
  lockPath: string,
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
): Promise<TransitiveDep[]> {
  const transitive: TransitiveDep[] = [];
  const directDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  try {
    const lock = JSON.parse(await fs.promises.readFile(lockPath, 'utf-8'));
    const packages = lock.packages ?? {};

    const depGraph = new Map<string, string[]>();

    // Build dependency graph
    for (const [pkgPath, info] of Object.entries(packages)) {
      if (!pkgPath || pkgPath === '') continue;

      const name = extractPackageName(pkgPath);
      if (!name) continue;

      const deps = (info as { dependencies?: Record<string, string> }).dependencies ?? {};
      depGraph.set(name, Object.keys(deps));
    }

    // Find transitive deps using BFS
    const visited = new Set<string>();
    const queue: Array<{ name: string; depth: number; requiredBy: string[] }> = [];

    for (const dep of directDeps) {
      queue.push({ name: dep, depth: 0, requiredBy: ['package.json'] });
    }

    while (queue.length > 0) {
      const { name, depth, requiredBy } = queue.shift()!;

      if (visited.has(name)) continue;
      visited.add(name);

      const deps = depGraph.get(name) ?? [];
      for (const childDep of deps) {
        if (!directDeps.has(childDep) && !visited.has(childDep)) {
          const existing = transitive.find(t => t.name === childDep);
          if (existing) {
            existing.requiredBy.push(name);
          } else {
            transitive.push({
              name: childDep,
              version: '', // Would need to look up from packages
              requiredBy: [name],
              depth: depth + 1,
            });
          }
          queue.push({ name: childDep, depth: depth + 1, requiredBy: [name] });
        }
      }
    }
  } catch {
    // Lock file might not exist or be malformed
  }

  return transitive.sort((a, b) => a.depth - b.depth);
}

// ============================================================================
// OUTDATED DEPENDENCY CHECKING
// ============================================================================

/**
 * Check for outdated dependencies using npm outdated.
 */
async function checkOutdated(workspace: string): Promise<OutdatedDep[]> {
  const outdated: OutdatedDep[] = [];

  try {
    // Run npm outdated --json
    const output = execSync('npm outdated --json 2>/dev/null || true', {
      cwd: workspace,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (output && output.trim()) {
      const data = JSON.parse(output);
      for (const [name, info] of Object.entries(data)) {
        const { current, wanted, latest } = info as {
          current?: string;
          wanted?: string;
          latest?: string;
        };

        if (!current || !latest) continue;

        const updateType = determineUpdateType(current, latest);

        outdated.push({
          name,
          current,
          latest,
          latestStable: wanted ?? latest,
          updateType,
          breaking: updateType === 'major',
        });
      }
    }
  } catch {
    // npm outdated might not be available or might fail
  }

  return outdated;
}

/**
 * Determine the type of update (major, minor, patch) between versions.
 */
function determineUpdateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
  const parseVersion = (v: string): number[] => {
    const cleaned = v.replace(/^[\^~>=<]/, '');
    return cleaned.split('.').map(n => parseInt(n, 10) || 0);
  };

  const [currMajor, currMinor] = parseVersion(current);
  const [latMajor, latMinor] = parseVersion(latest);

  if (latMajor > currMajor) return 'major';
  if (latMinor > currMinor) return 'minor';
  return 'patch';
}

// ============================================================================
// DEPENDENCY ISSUE DETECTION
// ============================================================================

/**
 * Find issues with dependencies (deprecated, security, etc.).
 */
async function findDependencyIssues(
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
  outdated: OutdatedDep[]
): Promise<DependencyIssue[]> {
  const issues: DependencyIssue[] = [];

  // Check for very old major versions
  for (const dep of outdated) {
    if (dep.updateType === 'major') {
      const parseVersion = (v: string): number => {
        return parseInt(v.replace(/^[\^~>=<]/, '').split('.')[0], 10) || 0;
      };

      const currMajor = parseVersion(dep.current);
      const latMajor = parseVersion(dep.latest);

      if (latMajor - currMajor >= 2) {
        issues.push({
          type: 'deprecated',
          package: dep.name,
          severity: latMajor - currMajor >= 3 ? 'high' : 'medium',
          description: `${dep.name} is ${latMajor - currMajor} major versions behind (${dep.current} -> ${dep.latest})`,
          fix: `npm install ${dep.name}@${dep.latest}`,
        });
      }
    }
  }

  // Check for known problematic packages
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  const problematic: Record<string, { issue: string; severity: DependencyIssue['severity']; alternative?: string }> = {
    'request': { issue: 'Deprecated - unmaintained since 2020', severity: 'high', alternative: 'node-fetch, axios, or undici' },
    'moment': { issue: 'Legacy - large bundle size', severity: 'low', alternative: 'date-fns, dayjs, or Temporal' },
    'lodash': { issue: 'Large bundle size - prefer tree-shakeable alternatives', severity: 'low', alternative: 'lodash-es for ESM or native methods' },
    'underscore': { issue: 'Legacy - unmaintained', severity: 'medium', alternative: 'lodash-es or native methods' },
    'left-pad': { issue: 'Unnecessary - use String.prototype.padStart()', severity: 'low' },
    'event-stream': { issue: 'Security - was compromised', severity: 'critical', alternative: 'Remove if unused' },
    'flatmap-stream': { issue: 'Security - malicious package', severity: 'critical', alternative: 'Remove immediately' },
    'ua-parser-js': { issue: 'Security - multiple CVEs', severity: 'high', alternative: 'Update to latest version' },
    'colors': { issue: 'Corrupted - maintainer sabotaged', severity: 'high', alternative: 'chalk, picocolors, or ansi-colors' },
    'faker': { issue: 'Corrupted - maintainer sabotaged', severity: 'high', alternative: '@faker-js/faker' },
  };

  for (const [dep, info] of Object.entries(problematic)) {
    if (allDeps[dep]) {
      issues.push({
        type: info.severity === 'critical' ? 'security' : 'deprecated',
        package: dep,
        severity: info.severity,
        description: `${dep}: ${info.issue}`,
        fix: info.alternative ? `Consider replacing with ${info.alternative}` : undefined,
      });
    }
  }

  return issues.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ============================================================================
// RECOMMENDATION GENERATION
// ============================================================================

/**
 * Generate actionable recommendations based on analysis.
 */
function generateRecommendations(
  unused: string[],
  outdated: OutdatedDep[],
  issues: DependencyIssue[],
  duplicates: DuplicateDep[]
): DependencyRecommendation[] {
  const recommendations: DependencyRecommendation[] = [];

  // Recommend removing unused dependencies
  for (const dep of unused) {
    recommendations.push({
      type: 'remove',
      package: dep,
      reason: 'Dependency appears to be unused in the codebase',
      command: `npm uninstall ${dep}`,
    });
  }

  // Recommend fixing critical issues first
  const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'high');
  for (const issue of criticalIssues) {
    recommendations.push({
      type: issue.type === 'deprecated' ? 'replace' : 'upgrade',
      package: issue.package,
      reason: issue.description,
      command: issue.fix,
    });
  }

  // Recommend safe updates (non-breaking)
  const safeUpdates = outdated.filter(d => d.updateType !== 'major');
  if (safeUpdates.length > 0) {
    recommendations.push({
      type: 'upgrade',
      package: safeUpdates.map(d => d.name).join(', '),
      reason: `${safeUpdates.length} package(s) have safe (non-breaking) updates available`,
      command: 'npm update',
    });
  }

  // Recommend deduplication if many duplicates
  if (duplicates.length >= 3) {
    recommendations.push({
      type: 'upgrade',
      package: 'all',
      reason: `${duplicates.length} packages have multiple versions installed, causing bloat`,
      command: 'npm dedupe',
    });
  }

  return recommendations;
}

// ============================================================================
// SUMMARY GENERATION
// ============================================================================

/**
 * Generate a human-readable summary for agents.
 */
export function summarizeDependencies(analysis: DependencyAnalysis): string {
  const lines: string[] = [
    `## Dependency Analysis Summary`,
    ``,
    `**Dependencies:** ${analysis.direct.length} runtime, ${analysis.dev.length} dev`,
  ];

  if (analysis.transitive.length > 0) {
    lines.push(`**Transitive:** ${analysis.transitive.length} packages`);
  }

  if (analysis.unused.length > 0) {
    lines.push(``);
    lines.push(`### Unused Dependencies (${analysis.unused.length})`);
    lines.push(`The following packages appear unused and can potentially be removed:`);
    for (const dep of analysis.unused.slice(0, 10)) {
      lines.push(`- \`${dep}\``);
    }
    if (analysis.unused.length > 10) {
      lines.push(`- ... and ${analysis.unused.length - 10} more`);
    }
  }

  if (analysis.outdated.length > 0) {
    const major = analysis.outdated.filter(d => d.updateType === 'major').length;
    const minor = analysis.outdated.filter(d => d.updateType === 'minor').length;
    const patch = analysis.outdated.filter(d => d.updateType === 'patch').length;

    lines.push(``);
    lines.push(`### Outdated Packages (${analysis.outdated.length})`);
    lines.push(`- Major updates: ${major} (breaking changes)`);
    lines.push(`- Minor updates: ${minor}`);
    lines.push(`- Patch updates: ${patch}`);
  }

  if (analysis.duplicates.length > 0) {
    lines.push(``);
    lines.push(`### Duplicate Packages (${analysis.duplicates.length})`);
    lines.push(`Multiple versions of the same package are installed:`);
    for (const dup of analysis.duplicates.slice(0, 5)) {
      lines.push(`- \`${dup.name}\`: ${dup.versions.join(', ')}`);
    }
    if (analysis.duplicates.length > 5) {
      lines.push(`- ... and ${analysis.duplicates.length - 5} more`);
    }
  }

  if (analysis.issues.length > 0) {
    const critical = analysis.issues.filter(i => i.severity === 'critical').length;
    const high = analysis.issues.filter(i => i.severity === 'high').length;

    lines.push(``);
    lines.push(`### Issues Found (${analysis.issues.length})`);
    if (critical > 0) {
      lines.push(`**CRITICAL:** ${critical} issue(s) require immediate attention`);
    }
    if (high > 0) {
      lines.push(`**HIGH:** ${high} issue(s) should be addressed soon`);
    }

    for (const issue of analysis.issues.filter(i => i.severity === 'critical' || i.severity === 'high')) {
      lines.push(`- **${issue.severity.toUpperCase()}** \`${issue.package}\`: ${issue.description}`);
      if (issue.fix) {
        lines.push(`  - Fix: ${issue.fix}`);
      }
    }
  }

  if (analysis.recommendations.length > 0) {
    lines.push(``);
    lines.push(`### Recommendations`);
    for (const rec of analysis.recommendations.slice(0, 5)) {
      lines.push(`1. **${rec.type.toUpperCase()}** \`${rec.package}\`: ${rec.reason}`);
      if (rec.command) {
        lines.push(`   \`\`\`bash`);
        lines.push(`   ${rec.command}`);
        lines.push(`   \`\`\``);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate a brief one-line summary.
 */
export function briefSummary(analysis: DependencyAnalysis): string {
  const parts: string[] = [
    `${analysis.direct.length + analysis.dev.length} deps`,
  ];

  if (analysis.unused.length > 0) {
    parts.push(`${analysis.unused.length} unused`);
  }
  if (analysis.outdated.length > 0) {
    const major = analysis.outdated.filter(d => d.breaking).length;
    parts.push(`${analysis.outdated.length} outdated (${major} major)`);
  }
  if (analysis.issues.length > 0) {
    parts.push(`${analysis.issues.length} issues`);
  }

  return parts.join(' | ');
}

// ============================================================================
// TOP DEPENDENCIES BY USAGE
// ============================================================================

/**
 * Get the most heavily used dependencies.
 */
export function getTopDependencies(analysis: DependencyAnalysis, limit: number = 10): DependencyInfo[] {
  const all = [...analysis.direct, ...analysis.dev];
  return all.sort((a, b) => b.importCount - a.importCount).slice(0, limit);
}

/**
 * Find dependencies that are only used in a few files.
 */
export function getLowUsageDependencies(analysis: DependencyAnalysis, threshold: number = 2): DependencyInfo[] {
  return analysis.direct.filter(d => d.importCount > 0 && d.importCount <= threshold);
}
