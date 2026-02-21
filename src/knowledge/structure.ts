/**
 * @fileoverview Structure Knowledge System
 *
 * Analyzes codebase organization and structure:
 * - Directory organization
 * - Module relationships
 * - File type distribution
 * - Entry points
 * - Export structure
 */

import type { LiBrainianStorage, ModuleKnowledge } from '../storage/types.js';
import { computeGraphMetrics } from '../graphs/metrics.js';
import { buildModuleGraphs } from './module_graph.js';

// ============================================================================
// TYPES
// ============================================================================

export interface StructureQuery {
  type:
    | 'organization'    // Overall file organization
    | 'directories'     // Directory structure
    | 'modules'         // Module relationships
    | 'entry_points'    // Entry points to the system
    | 'exports'         // Export structure
    | 'file_types'      // File type distribution
    | 'depth';          // Nesting depth analysis

  target?: string;
}

export interface StructureResult {
  query: StructureQuery;
  organization?: OrganizationAnalysis;
  directories?: DirectoryInfo[];
  entryPoints?: EntryPoint[];
  exports?: ExportAnalysis;
  fileTypes?: FileTypeBreakdown;
  summary: string;
  recommendations: string[];
}

export interface OrganizationAnalysis {
  style: 'layered' | 'feature-based' | 'hybrid' | 'flat';
  topLevelDirs: string[];
  moduleCount: number;
  avgModulesPerDir: number;
  maxDepth: number;
}

export interface DirectoryInfo {
  path: string;
  moduleCount: number;
  exportCount: number;
  children: string[];
  purpose?: string;
}

export interface EntryPoint {
  path: string;
  type: 'bin' | 'index' | 'main' | 'api';
  exports: string[];
  dependents: number;
  importanceScore?: number;
}

export interface ExportAnalysis {
  totalExports: number;
  avgExportsPerModule: number;
  publicModules: string[];
  internalModules: string[];
  reExports: string[];
}

export interface FileTypeBreakdown {
  byExtension: Record<string, number>;
  byCategory: Record<string, number>;
  testPercentage: number;
  docPercentage: number;
}

// ============================================================================
// STRUCTURE KNOWLEDGE
// ============================================================================

export class StructureKnowledge {
  constructor(private storage: LiBrainianStorage) {}

  async query(q: StructureQuery): Promise<StructureResult> {
    switch (q.type) {
      case 'organization':
        return this.analyzeOrganization(q);
      case 'directories':
        return this.analyzeDirectories(q);
      case 'modules':
        return this.analyzeModules(q);
      case 'entry_points':
        return this.findEntryPoints(q);
      case 'exports':
        return this.analyzeExports(q);
      case 'file_types':
        return this.analyzeFileTypes(q);
      case 'depth':
        return this.analyzeDepth(q);
      default:
        return { query: q, summary: 'Unknown query type', recommendations: [] };
    }
  }

  private async analyzeOrganization(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();

    // Get top-level directories
    const topLevelDirs = new Set<string>();
    const depthCounts = new Map<number, number>();

    for (const mod of modules) {
      const parts = mod.path.split('/');
      if (parts.length >= 2) {
        topLevelDirs.add(parts[1]);
      }
      const depth = parts.length - 1;
      depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
    }

    // Determine organization style
    const knownLayers = ['api', 'service', 'lib', 'utils', 'types', 'storage', 'bin'];
    const knownFeatures = ['auth', 'user', 'payment', 'dashboard', 'admin'];
    const hasLayers = knownLayers.filter(l => topLevelDirs.has(l)).length >= 3;
    const hasFeatures = knownFeatures.filter(f => topLevelDirs.has(f)).length >= 2;

    let style: OrganizationAnalysis['style'] = 'flat';
    if (hasLayers && hasFeatures) style = 'hybrid';
    else if (hasLayers) style = 'layered';
    else if (hasFeatures) style = 'feature-based';

    const maxDepth = Math.max(...depthCounts.keys());
    const avgModulesPerDir = modules.length / topLevelDirs.size;

    return {
      query,
      organization: {
        style,
        topLevelDirs: [...topLevelDirs],
        moduleCount: modules.length,
        avgModulesPerDir: Math.round(avgModulesPerDir * 10) / 10,
        maxDepth,
      },
      summary: `${style} organization with ${topLevelDirs.size} top-level directories`,
      recommendations: style === 'flat' && modules.length > 20
        ? ['Consider organizing code into layers or features']
        : [],
    };
  }

  private async analyzeDirectories(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();
    const dirInfo = new Map<string, DirectoryInfo>();

    for (const mod of modules) {
      const parts = mod.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        if (!dirInfo.has(dirPath)) {
          dirInfo.set(dirPath, {
            path: dirPath,
            moduleCount: 0,
            exportCount: 0,
            children: [],
          });
        }
        const info = dirInfo.get(dirPath)!;
        if (i === parts.length - 1) {
          info.moduleCount++;
          info.exportCount += mod.exports.length;
        }
      }
    }

    // Build parent-child relationships
    for (const [path, info] of dirInfo) {
      const parts = path.split('/');
      if (parts.length > 2) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = dirInfo.get(parentPath);
        if (parent && !parent.children.includes(path)) {
          parent.children.push(path);
        }
      }
    }

    // Infer purposes
    for (const [path, info] of dirInfo) {
      const name = path.split('/').pop()?.toLowerCase() ?? '';
      if (name === 'bin') info.purpose = 'CLI entry points';
      else if (name === 'api') info.purpose = 'API endpoints';
      else if (name === 'types') info.purpose = 'Type definitions';
      else if (name === 'utils') info.purpose = 'Utility functions';
      else if (name.includes('test')) info.purpose = 'Tests';
    }

    const directories = [...dirInfo.values()]
      .filter(d => d.moduleCount > 0)
      .sort((a, b) => b.moduleCount - a.moduleCount);

    return {
      query,
      directories: directories.slice(0, 20),
      summary: `${directories.length} directories with modules`,
      recommendations: [],
    };
  }

  private async analyzeModules(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();
    const { graph } = buildModuleGraphs(modules);
    const { report } = computeGraphMetrics({ module: graph });

    // Count dependencies and dependents
    const dependentCounts = new Map<string, number>();
    for (const mod of modules) {
      for (const dep of mod.dependencies) {
        dependentCounts.set(dep, (dependentCounts.get(dep) ?? 0) + 1);
      }
    }

    const directories: DirectoryInfo[] = [];
    const dirModules = new Map<string, ModuleKnowledge[]>();

    for (const mod of modules) {
      const parts = mod.path.split('/');
      const dir = parts.slice(0, -1).join('/');
      if (!dirModules.has(dir)) dirModules.set(dir, []);
      dirModules.get(dir)!.push(mod);
    }

    for (const [dir, mods] of dirModules) {
      directories.push({
        path: dir,
        moduleCount: mods.length,
        exportCount: mods.reduce((sum, m) => sum + m.exports.length, 0),
        children: mods.map(m => m.path),
      });
    }

    return {
      query,
      directories: directories.sort((a, b) => b.moduleCount - a.moduleCount).slice(0, 15),
      summary: `${modules.length} modules in ${dirModules.size} directories across ${report.totals.communities} communities`,
      recommendations: report.totals.communities > 5
        ? ['Module graph is fragmented; consider consolidating related directories']
        : [],
    };
  }

  private async findEntryPoints(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();
    const entryPoints: EntryPoint[] = [];
    const { graph } = buildModuleGraphs(modules);
    const { metrics } = computeGraphMetrics({ module: graph });
    const metricMap = new Map(metrics.map((metric) => [metric.entityId, metric]));

    // Count dependents for each module
    const dependentCounts = new Map<string, number>();
    for (const mod of modules) {
      for (const dep of mod.dependencies) {
        dependentCounts.set(dep, (dependentCounts.get(dep) ?? 0) + 1);
      }
    }

    for (const mod of modules) {
      let type: EntryPoint['type'] | null = null;

      if (mod.path.includes('/bin/')) type = 'bin';
      else if (mod.path.endsWith('/index.ts') || mod.path.endsWith('/index.js')) type = 'index';
      else if (mod.path.includes('/api/')) type = 'api';
      else if (mod.path.endsWith('/main.ts') || mod.path.endsWith('/main.js')) type = 'main';

      if (type) {
        entryPoints.push({
          path: mod.path,
          type,
          exports: mod.exports,
          dependents: dependentCounts.get(mod.path) ?? 0,
          importanceScore: (metricMap.get(mod.path)?.pagerank ?? 0) +
            (metricMap.get(mod.path)?.betweenness ?? 0),
        });
      }
    }

    entryPoints.sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0));

    return {
      query,
      entryPoints: entryPoints.slice(0, 20),
      summary: `${entryPoints.length} entry points found`,
      recommendations: entryPoints.filter(e => e.type === 'bin').length === 0
        ? ['No CLI entry points found in /bin']
        : [],
    };
  }

  private async analyzeExports(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();
    const functions = await this.storage.getFunctions();

    let totalExports = 0;
    const publicModules: string[] = [];
    const internalModules: string[] = [];
    const reExports: string[] = [];

    for (const mod of modules) {
      totalExports += mod.exports.length;

      // Determine if public (index files, API) or internal
      if (mod.path.endsWith('/index.ts') || mod.path.includes('/api/')) {
        publicModules.push(mod.path);
      } else if (mod.exports.length === 0 || mod.path.includes('internal')) {
        internalModules.push(mod.path);
      }

      // Check for re-exports (modules that mostly re-export from others)
      const functionCount = functions.filter((fn) => fn.filePath === mod.path).length;
      if (functionCount === 0 && mod.exports.length > 0 && mod.dependencies.length > 0) {
        reExports.push(mod.path);
      }
    }

    const avgExports = modules.length > 0 ? totalExports / modules.length : 0;

    return {
      query,
      exports: {
        totalExports,
        avgExportsPerModule: Math.round(avgExports * 10) / 10,
        publicModules: publicModules.slice(0, 10),
        internalModules: internalModules.slice(0, 10),
        reExports,
      },
      summary: `${totalExports} total exports, ${Math.round(avgExports)} avg per module`,
      recommendations: avgExports > 15
        ? ['Average exports per module is high - consider splitting modules']
        : [],
    };
  }

  private async analyzeFileTypes(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();

    const byExtension: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let testCount = 0;
    let docCount = 0;

    for (const mod of modules) {
      // Extension
      const ext = mod.path.split('.').pop() ?? 'unknown';
      byExtension[ext] = (byExtension[ext] ?? 0) + 1;

      // Category
      if (mod.path.includes('.test.') || mod.path.includes('.spec.') || mod.path.includes('__tests__')) {
        byCategory['test'] = (byCategory['test'] ?? 0) + 1;
        testCount++;
      } else if (mod.path.endsWith('.md')) {
        byCategory['docs'] = (byCategory['docs'] ?? 0) + 1;
        docCount++;
      } else if (mod.path.includes('/types/') || mod.path.endsWith('.d.ts')) {
        byCategory['types'] = (byCategory['types'] ?? 0) + 1;
      } else {
        byCategory['source'] = (byCategory['source'] ?? 0) + 1;
      }
    }

    return {
      query,
      fileTypes: {
        byExtension,
        byCategory,
        testPercentage: modules.length > 0 ? Math.round((testCount / modules.length) * 100) : 0,
        docPercentage: modules.length > 0 ? Math.round((docCount / modules.length) * 100) : 0,
      },
      summary: `${Object.keys(byExtension).length} file types`,
      recommendations: [],
    };
  }

  private async analyzeDepth(query: StructureQuery): Promise<StructureResult> {
    const modules = await this.storage.getModules();

    const depthCounts = new Map<number, number>();
    let maxDepth = 0;
    let deepestPath = '';

    for (const mod of modules) {
      const depth = mod.path.split('/').length - 1;
      depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
      if (depth > maxDepth) {
        maxDepth = depth;
        deepestPath = mod.path;
      }
    }

    const directories: DirectoryInfo[] = [...depthCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => ({
        path: `Depth ${depth}`,
        moduleCount: count,
        exportCount: 0,
        children: [],
      }));

    return {
      query,
      directories,
      summary: `Max depth: ${maxDepth} (${deepestPath})`,
      recommendations: maxDepth > 6
        ? ['Directory nesting is deep - consider flattening structure']
        : [],
    };
  }
}
