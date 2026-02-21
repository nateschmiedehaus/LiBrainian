/**
 * @fileoverview Architecture Knowledge System
 *
 * Provides deep understanding of codebase architecture:
 * - Dependency graphs and analysis
 * - Layer detection and boundary enforcement
 * - Circular dependency detection
 * - Coupling metrics
 * - Core module identification
 */
import type { LiBrainianStorage, ModuleKnowledge } from '../storage/types.js';
import { computePageRank } from '../graphs/pagerank.js';
import { computeBetweennessCentrality } from '../graphs/centrality.js';
import { buildModuleGraphs, resolveTargetModule } from './module_graph.js';
// ============================================================================
// TYPES
// ============================================================================

export interface ArchitectureQuery {
  type:
    | 'dependencies'    // What does X depend on?
    | 'dependents'      // What depends on X?
    | 'layers'          // What architectural layers exist?
    | 'cycles'          // Are there circular dependencies?
    | 'coupling'        // How coupled are modules?
    | 'core_modules'    // What are the most critical modules?
    | 'boundaries'      // What are the module boundaries?
    | 'violations';     // What architectural violations exist?

  target?: string;      // File or module path
  depth?: number;       // Traversal depth (default: 3)
}

export interface ArchitectureResult {
  query: ArchitectureQuery;
  dependencies?: DependencyNode[];
  layers?: ArchitecturalLayer[];
  cycles?: DependencyCycle[];
  coupling?: CouplingMetrics;
  coreModules?: CoreModule[];
  violations?: ArchitectureViolation[];
  summary: string;
  recommendations: string[];
}

export interface DependencyNode {
  path: string;
  type: 'direct' | 'transitive';
  depth: number;
  exports: string[];
  importedSymbols?: string[];
}

export interface ArchitecturalLayer {
  name: string;
  directories: string[];
  modules: string[];
  allowedDependencies: string[];  // Layers this can depend on
  violations: string[];           // Modules violating layer rules
}

export interface DependencyCycle {
  nodes: string[];
  severity: 'warning' | 'error';
  suggestion: string;
}

export interface CouplingMetrics {
  afferentCoupling: Map<string, number>;   // Incoming dependencies
  efferentCoupling: Map<string, number>;   // Outgoing dependencies
  instability: Map<string, number>;        // Efferent / (Afferent + Efferent)
  abstractness: Map<string, number>;       // Abstract types / Total types
  mostCoupled: Array<{ path: string; score: number }>;
}

export interface CoreModule {
  path: string;
  dependentCount: number;
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface ArchitectureViolation {
  type: 'cycle' | 'layer_violation' | 'boundary_violation' | 'coupling_threshold';
  source: string;
  target?: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}
// ============================================================================
// ARCHITECTURE KNOWLEDGE
// ============================================================================

export class ArchitectureKnowledge {
  constructor(private storage: LiBrainianStorage) {}

  async query(q: ArchitectureQuery): Promise<ArchitectureResult> {
    switch (q.type) {
      case 'dependencies':
        return this.analyzeDependencies(q.target, q.depth ?? 3);
      case 'dependents':
        return this.analyzeDependents(q.target, q.depth ?? 3);
      case 'layers':
        return this.detectLayers();
      case 'cycles':
        return this.detectCycles();
      case 'coupling':
        return this.analyzeCoupling();
      case 'core_modules':
        return this.identifyCoreModules();
      case 'boundaries':
        return this.analyzeBoundaries();
      case 'violations':
        return this.findViolations();
      default:
        return { query: q, summary: 'Unknown query type', recommendations: [] };
    }
  }

  private async analyzeDependencies(target: string | undefined, maxDepth: number): Promise<ArchitectureResult> {
    const modules = await this.storage.getModules();
    const targetModule = target ? resolveTargetModule(modules, target) : null;
    const { graph } = buildModuleGraphs(modules);

    if (target && !targetModule) {
      return {
        query: { type: 'dependencies', target },
        dependencies: [],
        summary: 'Module not found',
        recommendations: ['Verify the module path and rerun dependency analysis.'],
      };
    }

    const dependencies: DependencyNode[] = [];
    const visited = new Set<string>();

    const traverse = (path: string, depth: number) => {
      if (depth > maxDepth || visited.has(path)) return;
      visited.add(path);
      for (const dep of graph.get(path) ?? []) {
        const depModule = modules.find((m) => m.path === dep);
        dependencies.push({
          path: dep,
          type: depth === 1 ? 'direct' : 'transitive',
          depth,
          exports: depModule?.exports ?? [],
        });
        traverse(dep, depth + 1);
      }
    };

    if (targetModule) traverse(targetModule.path, 1);
    else modules.slice(0, 50).forEach((mod) => traverse(mod.path, 1));

    const directCount = dependencies.filter(d => d.type === 'direct').length;
    const transitiveCount = dependencies.filter(d => d.type === 'transitive').length;
    const recommendations: string[] = [];
    if (directCount > 12) {
      recommendations.push('Consider splitting the module or extracting shared utilities to reduce direct dependencies.');
    }
    if (transitiveCount > directCount * 2 && transitiveCount > 10) {
      recommendations.push('Reduce transitive dependency depth by introducing stable boundaries or interfaces.');
    }

    return {
      query: { type: 'dependencies', target, depth: maxDepth },
      dependencies,
      summary: `${directCount} direct, ${transitiveCount} transitive dependencies`,
      recommendations,
    };
  }

  private async analyzeDependents(target: string | undefined, maxDepth: number): Promise<ArchitectureResult> {
    if (!target) {
      return {
        query: { type: 'dependents' },
        dependencies: [],
        summary: 'No target specified',
        recommendations: ['Provide a module path to analyze dependent impact.'],
      };
    }

    const modules = await this.storage.getModules();
    const targetModule = resolveTargetModule(modules, target);
    if (!targetModule) {
      return {
        query: { type: 'dependents', target },
        dependencies: [],
        summary: 'Module not found',
        recommendations: ['Verify the module path and rerun dependent analysis.'],
      };
    }
    const { reverse } = buildModuleGraphs(modules);
    const dependencies: DependencyNode[] = [];
    const visited = new Set<string>([targetModule.path]);
    const queue: Array<{ path: string; depth: number }> = [{ path: targetModule.path, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift() as { path: string; depth: number };
      if (current.depth >= maxDepth) continue;
      for (const dep of reverse.get(current.path) ?? []) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        const mod = modules.find((candidate) => candidate.path === dep);
        dependencies.push({
          path: dep,
          type: current.depth === 0 ? 'direct' : 'transitive',
          depth: current.depth + 1,
          exports: mod?.exports ?? [],
        });
        queue.push({ path: dep, depth: current.depth + 1 });
      }
    }

    const recommendations: string[] = [];
    if (dependencies.length > 12) {
      recommendations.push('Treat this module as a stable API and gate changes with targeted regression tests.');
    }
    if (dependencies.length === 0) {
      recommendations.push('This module appears isolated; consider consolidating or deprecating if unused.');
    }

    return {
      query: { type: 'dependents', target, depth: maxDepth },
      dependencies,
      summary: `${dependencies.length} modules depend on ${target}`,
      recommendations,
    };
  }

  private async detectLayers(): Promise<ArchitectureResult> {
    const modules = await this.storage.getModules();
    const layers: ArchitecturalLayer[] = [];
    const dirModules = new Map<string, string[]>();

    // Group modules by top-level directory
    for (const mod of modules) {
      const parts = mod.path.split('/');
      const topDir = parts.length >= 2 ? parts[1] : parts[0];
      if (!dirModules.has(topDir)) dirModules.set(topDir, []);
      dirModules.get(topDir)!.push(mod.path);
    }

    // Infer layers from directory structure
    const layerPatterns: Record<string, { priority: number; allowedDeps: string[] }> = {
      bin: { priority: 1, allowedDeps: ['*'] },
      api: { priority: 2, allowedDeps: ['service', 'lib', 'utils', 'types'] },
      service: { priority: 3, allowedDeps: ['lib', 'utils', 'types', 'storage'] },
      lib: { priority: 4, allowedDeps: ['utils', 'types'] },
      utils: { priority: 5, allowedDeps: ['types'] },
      types: { priority: 6, allowedDeps: [] },
    };

    for (const [dir, mods] of dirModules) {
      const pattern = layerPatterns[dir];
      layers.push({
        name: dir,
        directories: [dir],
        modules: mods,
        allowedDependencies: pattern?.allowedDeps ?? ['*'],
        violations: [],
      });
    }

    // Detect violations
    for (const layer of layers) {
      if (layer.allowedDependencies.includes('*')) continue;

      for (const modPath of layer.modules) {
        const mod = modules.find(m => m.path === modPath);
        if (!mod) continue;

        for (const dep of mod.dependencies) {
          const depDir = dep.split('/')[1];
          if (depDir && !layer.allowedDependencies.includes(depDir) && depDir !== layer.name) {
            layer.violations.push(`${modPath} -> ${dep}`);
          }
        }
      }
    }

    const violationCount = layers.reduce((sum, layer) => sum + layer.violations.length, 0);
    const recommendations: string[] = [];
    if (violationCount > 0) {
      recommendations.push('Address layer violations by introducing interfaces or moving misplaced imports.');
    }
    if (layers.length > 6) {
      recommendations.push('Consider consolidating layers to reduce architectural complexity.');
    }

    return {
      query: { type: 'layers' },
      layers,
      summary: `${layers.length} architectural layers detected, ${violationCount} violations`,
      recommendations,
    };
  }

  private async detectCycles(): Promise<ArchitectureResult> {
    const modules = await this.storage.getModules();
    const cycles: DependencyCycle[] = [];
    const { graph } = buildModuleGraphs(modules);
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    let cursor = 0;

    const strongConnect = (node: string) => {
      index.set(node, cursor);
      lowlink.set(node, cursor);
      cursor += 1;
      stack.push(node);
      onStack.add(node);

      for (const neighbor of graph.get(node) ?? []) {
        if (!index.has(neighbor)) {
          strongConnect(neighbor);
          lowlink.set(node, Math.min(lowlink.get(node) ?? 0, lowlink.get(neighbor) ?? 0));
        } else if (onStack.has(neighbor)) {
          lowlink.set(node, Math.min(lowlink.get(node) ?? 0, index.get(neighbor) ?? 0));
        }
      }

      if ((lowlink.get(node) ?? 0) === (index.get(node) ?? 0)) {
        const component: string[] = [];
        let current: string | undefined;
        do {
          current = stack.pop();
          if (current) {
            onStack.delete(current);
            component.push(current);
          }
        } while (current && current !== node);

        if (component.length > 1) {
          cycles.push({
            nodes: component,
            severity: component.length <= 2 ? 'error' : 'warning',
            suggestion: 'Break cycle by extracting shared code or using dependency inversion',
          });
        } else if (component.length === 1) {
          const only = component[0] as string;
          if ((graph.get(only) ?? new Set()).has(only)) {
            cycles.push({
              nodes: [only],
              severity: 'warning',
              suggestion: 'Remove self-referential dependency',
            });
          }
        }
      }
    };

    for (const node of graph.keys()) {
      if (!index.has(node)) strongConnect(node);
    }

    const recommendations: string[] = [];
    if (cycles.length > 0) {
      recommendations.push('Break dependency cycles by extracting shared code or introducing interfaces.');
    }

    return {
      query: { type: 'cycles' },
      cycles: cycles.slice(0, 20), // Limit to 20 cycles
      summary: cycles.length === 0 ? 'No circular dependencies detected' : `${cycles.length} circular dependencies found`,
      recommendations,
    };
  }

  private async analyzeCoupling(): Promise<ArchitectureResult> {
    const modules = await this.storage.getModules();
    const { graph, reverse } = buildModuleGraphs(modules);
    const afferent = new Map<string, number>();  // Incoming
    const efferent = new Map<string, number>();  // Outgoing
    const abstractness = new Map<string, number>();

    for (const mod of modules) {
      const outgoing = graph.get(mod.path)?.size ?? 0;
      const incoming = reverse.get(mod.path)?.size ?? 0;
      efferent.set(mod.path, outgoing);
      afferent.set(mod.path, incoming);
      abstractness.set(mod.path, estimateAbstractness(mod.exports));
    }

    const instability = new Map<string, number>();
    for (const mod of modules) {
      const ca = afferent.get(mod.path) ?? 0;
      const ce = efferent.get(mod.path) ?? 0;
      instability.set(mod.path, ca + ce > 0 ? ce / (ca + ce) : 0);
    }

    const mostCoupled = [...afferent.entries()]
      .map(([path, score]) => ({ path, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const recommendations: string[] = [];
    const worst = mostCoupled[0];
    if (worst && worst.score > 15) {
      recommendations.push(`Reduce coupling around ${worst.path} by splitting responsibilities or layering APIs.`);
    }
    if (modules.length > 0 && mostCoupled.length === 0) {
      recommendations.push('Coupling appears low; keep dependencies stable as the codebase grows.');
    }

    return {
      query: { type: 'coupling' },
      coupling: {
        afferentCoupling: afferent,
        efferentCoupling: efferent,
        instability,
        abstractness,
        mostCoupled,
      },
      summary: `Most coupled: ${mostCoupled[0]?.path ?? 'none'} (${mostCoupled[0]?.score ?? 0} dependents)`,
      recommendations,
    };
  }

  private async identifyCoreModules(): Promise<ArchitectureResult> {
    const modules = await this.storage.getModules();
    const { graph, reverse } = buildModuleGraphs(modules);
    const pagerank = computePageRank(graph);
    const betweenness = computeBetweennessCentrality(graph);
    const coreModules: CoreModule[] = modules
      .map((mod) => {
        const dependentCount = reverse.get(mod.path)?.size ?? 0;
        const score = pagerank.get(mod.path) ?? 0;
        const bridge = betweenness.get(mod.path) ?? 0;
        const combined = score + bridge;
        const risk: CoreModule['risk'] =
          combined > 0.2 || dependentCount > 20
            ? 'critical'
            : combined > 0.12 || dependentCount > 12
            ? 'high'
            : combined > 0.06 || dependentCount > 6
            ? 'medium'
            : 'low';
        return {
          path: mod.path,
          dependentCount,
          reason: `PageRank ${(score * 100).toFixed(1)}%, betweenness ${(bridge * 100).toFixed(1)}%`,
          risk,
        };
      })
      .sort((a, b) => {
        const scoreA = (pagerank.get(a.path) ?? 0) + (betweenness.get(a.path) ?? 0);
        const scoreB = (pagerank.get(b.path) ?? 0) + (betweenness.get(b.path) ?? 0);
        return scoreB - scoreA;
      })
      .slice(0, 15);

    const highRisk = coreModules.filter(m => m.risk === 'critical' || m.risk === 'high');
    const recommendations: string[] = [];
    if (highRisk.length > 0) {
      recommendations.push('Protect core modules with stricter review and higher test coverage.');
    }
    if (coreModules.length === 0) {
      recommendations.push('No core modules detected; ensure indexing has completed.');
    }

    return {
      query: { type: 'core_modules' },
      coreModules,
      summary: `${highRisk.length} high-risk core modules`,
      recommendations,
    };
  }

  private async analyzeBoundaries(): Promise<ArchitectureResult> {
    const layerResult = await this.detectLayers();
    const violations = this.collectBoundaryViolations(layerResult.layers ?? []);
    return {
      query: { type: 'boundaries' },
      layers: layerResult.layers,
      violations,
      summary: `${layerResult.summary}${violations.length > 0 ? `, ${violations.length} boundary violations` : ''}`,
      recommendations: violations.length > 0
        ? ['Reinforce boundary rules by relocating imports or introducing interfaces at layer boundaries.']
        : [],
    };
  }

  private async findViolations(): Promise<ArchitectureResult> {
    const violations: ArchitectureViolation[] = [];

    // Check for cycles
    const cycleResult = await this.detectCycles();
    for (const cycle of cycleResult.cycles ?? []) {
      violations.push({
        type: 'cycle',
        source: cycle.nodes[0],
        target: cycle.nodes[1],
        message: `Circular dependency: ${cycle.nodes.join(' -> ')}`,
        severity: cycle.severity === 'error' ? 'error' : 'warning',
      });
    }

    // Check layer violations
    const layerResult = await this.detectLayers();
    for (const layer of layerResult.layers ?? []) {
      for (const violation of layer.violations) {
        violations.push({
          type: 'layer_violation',
          source: violation.split(' -> ')[0],
          target: violation.split(' -> ')[1],
          message: `Layer violation in ${layer.name}: ${violation}`,
          severity: 'warning',
        });
      }
    }

    for (const violation of this.collectBoundaryViolations(layerResult.layers ?? [])) {
      violations.push(violation);
    }

    // Check coupling thresholds
    const couplingResult = await this.analyzeCoupling();
    for (const { path, score } of couplingResult.coupling?.mostCoupled ?? []) {
      if (score > 15) {
        violations.push({
          type: 'coupling_threshold',
          source: path,
          message: `High coupling: ${score} modules depend on ${path}`,
          severity: score > 25 ? 'error' : 'warning',
        });
      }
    }

    const recommendations: string[] = [];
    if (violations.some(v => v.severity === 'error')) {
      recommendations.push('Prioritize fixing error-level violations before expanding architecture.');
    }
    if (violations.length === 0) {
      recommendations.push('Architecture looks clean; keep monitoring dependency health as modules grow.');
    }

    return {
      query: { type: 'violations' },
      violations,
      summary: `${violations.filter(v => v.severity === 'error').length} errors, ${violations.filter(v => v.severity === 'warning').length} warnings`,
      recommendations,
    };
  }

  private collectBoundaryViolations(layers: ArchitecturalLayer[]): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const layerOrder = new Map<string, number>();
    const ranked = ['bin', 'api', 'service', 'lib', 'utils', 'types', 'storage', 'integration'];
    ranked.forEach((name, index) => layerOrder.set(name, index));

    for (const layer of layers) {
      const layerRank = layerOrder.get(layer.name);
      if (layerRank === undefined) continue;
      for (const violation of layer.violations) {
        const [source, target] = violation.split(' -> ');
        const targetLayer = target?.split('/')[1];
        const targetRank = targetLayer ? layerOrder.get(targetLayer) : undefined;
        if (targetRank !== undefined && targetRank < layerRank) {
          violations.push({
            type: 'boundary_violation',
            source,
            target,
            message: `Layer ${layer.name} depends on higher-level ${targetLayer}`,
            severity: targetRank + 1 < layerRank ? 'error' : 'warning',
          });
        }
      }
    }

    return violations;
  }
}

function estimateAbstractness(exportsList: string[]): number {
  if (exportsList.length === 0) return 0;
  const abstractTokens = ['type', 'interface', 'props', 'config', 'schema', 'options', 'spec'];
  const abstractCount = exportsList.filter((exp) =>
    abstractTokens.some((token) => exp.toLowerCase().includes(token))
  ).length;
  return Math.round((abstractCount / exportsList.length) * 100) / 100;
}
