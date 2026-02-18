/**
 * @fileoverview Architecture Analysis Primitive (tp_analyze_architecture)
 *
 * Analyze codebase architecture for violations and improvements.
 * Detects circular dependencies, large interfaces, coupling issues,
 * layer violations, and provides actionable suggestions.
 *
 * Based on self-improvement-primitives.md specification.
 */

import * as path from 'path';
import type { LibrarianStorage, ModuleKnowledge, FunctionKnowledge, GraphEdge } from '../../storage/types.js';
import { buildModuleGraphs, type ModuleGraph, type ModuleGraphBundle } from '../../knowledge/module_graph.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of an architecture analysis operation.
 */
export interface ArchitectureAnalysisResult {
  /** Analyzed modules with their metadata */
  modules: ModuleInfo[];
  /** Dependencies between modules */
  dependencies: DependencyInfo[];
  /** Detected dependency cycles */
  cycles: CycleInfo[];
  /** Layer violations detected */
  layerViolations: ViolationInfo[];
  /** Coupling metrics for the codebase */
  couplingMetrics: CouplingMetrics;
  /** Duration of the analysis in milliseconds */
  duration: number;
  /** Any errors encountered during analysis */
  errors: string[];
  /** Architecture suggestions */
  suggestions: ArchitectureSuggestion[];
}

/**
 * Information about a module in the codebase.
 */
export interface ModuleInfo {
  /** Module path */
  path: string;
  /** Module name (derived from path) */
  name: string;
  /** Number of exports */
  exportCount: number;
  /** Number of dependencies */
  dependencyCount: number;
  /** Number of dependents (reverse dependencies) */
  dependentCount: number;
  /** Inferred layer/category */
  layer?: string;
  /** Module complexity score (0-100) */
  complexity: number;
}

/**
 * Information about a dependency relationship.
 */
export interface DependencyInfo {
  /** Source module path */
  from: string;
  /** Target module path */
  to: string;
  /** Type of dependency */
  type: 'import' | 'call' | 'extends' | 'implements';
  /** Confidence in this dependency (0-1) */
  confidence: number;
  /** Whether this is a potential violation */
  isViolation: boolean;
  /** Reason for violation if any */
  violationReason?: string;
}

/**
 * Information about a dependency cycle.
 */
export interface CycleInfo {
  /** Modules involved in the cycle */
  modules: string[];
  /** Length of the cycle */
  length: number;
  /** Severity of the cycle */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Suggested break point */
  suggestedBreakPoint?: string;
}

/**
 * Information about a layer violation.
 */
export interface ViolationInfo {
  /** Type of violation */
  type: 'circular_deps' | 'large_interfaces' | 'unclear_responsibility' | 'dead_code' | 'coupling_analysis' | 'cohesion_analysis' | 'layer_violations';
  /** Severity of the violation */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Location (file or module path) */
  location: string;
  /** Description of the violation */
  description: string;
  /** Suggestion for fixing */
  suggestion: string;
  /** Affected entities */
  affectedEntities: string[];
}

/**
 * Coupling metrics for the codebase.
 */
export interface CouplingMetrics {
  /** Average afferent coupling (incoming dependencies) */
  averageAfferentCoupling: number;
  /** Average efferent coupling (outgoing dependencies) */
  averageEfferentCoupling: number;
  /** Instability metric (Ce / (Ca + Ce)) */
  averageInstability: number;
  /** Number of modules with high coupling */
  highCouplingCount: number;
  /** Most coupled modules */
  mostCoupled: Array<{ module: string; afferent: number; efferent: number }>;
}

/**
 * Architecture improvement suggestion.
 */
export interface ArchitectureSuggestion {
  /** Priority (higher = more important) */
  priority: number;
  /** Category of suggestion */
  category: 'refactoring' | 'decoupling' | 'layering' | 'cleanup';
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Affected files */
  affectedFiles: string[];
  /** Estimated effort */
  effort: 'trivial' | 'simple' | 'moderate' | 'complex';
}

/**
 * Options for the architecture analysis operation.
 */
export interface AnalyzeArchitectureOptions {
  /** Root directory of the codebase */
  rootDir: string;
  /** Expected layer hierarchy (e.g., ['api', 'core', 'storage', 'utils']) */
  expectedLayers?: string[];
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Architecture checks to perform */
  checks?: ArchitectureCheck[];
  /** Thresholds for violations */
  thresholds?: ArchitectureThresholds;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Types of architecture checks to perform.
 */
export type ArchitectureCheck =
  | 'circular_deps'
  | 'large_interfaces'
  | 'unclear_responsibility'
  | 'dead_code'
  | 'coupling_analysis'
  | 'cohesion_analysis'
  | 'layer_violations';

/**
 * Thresholds for architecture violations.
 */
export interface ArchitectureThresholds {
  /** Maximum number of exports before flagging as large interface */
  maxInterfaceMethods: number;
  /** Maximum lines of code per module */
  maxModuleSize: number;
  /** Maximum cyclomatic complexity */
  maxCyclomaticComplexity: number;
  /** Maximum afferent coupling */
  maxAfferentCoupling: number;
  /** Maximum efferent coupling */
  maxEfferentCoupling: number;
}

const DEFAULT_THRESHOLDS: ArchitectureThresholds = {
  maxInterfaceMethods: 20,
  maxModuleSize: 500,
  maxCyclomaticComplexity: 15,
  maxAfferentCoupling: 10,
  maxEfferentCoupling: 15,
};

const DEFAULT_CHECKS: ArchitectureCheck[] = [
  'circular_deps',
  'large_interfaces',
  'coupling_analysis',
  'layer_violations',
];

// ============================================================================
// LAYER INFERENCE
// ============================================================================

/**
 * Infer the layer of a module based on its path.
 */
function inferLayer(modulePath: string, expectedLayers?: string[]): string | undefined {
  const normalizedPath = modulePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  // Check against expected layers
  if (expectedLayers) {
    for (const layer of expectedLayers) {
      if (parts.some((p) => p.toLowerCase() === layer.toLowerCase())) {
        return layer;
      }
    }
  }

  // Common layer patterns
  const layerPatterns: Record<string, RegExp> = {
    api: /\/api\//i,
    core: /\/core\//i,
    storage: /\/(storage|db|database)\//i,
    utils: /\/(utils?|helpers?|lib)\//i,
    agents: /\/agents?\//i,
    cli: /\/cli\//i,
    config: /\/config\//i,
    types: /\/types?\//i,
    tests: /\/__tests__\//i,
  };

  for (const [layer, pattern] of Object.entries(layerPatterns)) {
    if (pattern.test(normalizedPath)) {
      return layer;
    }
  }

  return undefined;
}

// ============================================================================
// CYCLE DETECTION
// ============================================================================

/**
 * Detect cycles in the module dependency graph using Tarjan's algorithm.
 */
function detectCycles(graph: ModuleGraph): CycleInfo[] {
  const cycles: CycleInfo[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) ?? new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        const cycleNodes = path.slice(cycleStart);
        cycles.push({
          modules: [...cycleNodes],
          length: cycleNodes.length,
          severity: cycleNodes.length <= 2 ? 'critical' : cycleNodes.length <= 4 ? 'high' : 'medium',
          suggestedBreakPoint: findBestBreakPoint(cycleNodes, graph),
        });
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  // Deduplicate cycles (same cycle can be detected from different starting points)
  const uniqueCycles = deduplicateCycles(cycles);

  return uniqueCycles;
}

/**
 * Find the best point to break a cycle.
 */
function findBestBreakPoint(cycleNodes: string[], graph: ModuleGraph): string | undefined {
  // Find the node with the most outgoing edges in the cycle
  let bestNode: string | undefined;
  let maxOutgoing = 0;

  for (const node of cycleNodes) {
    const outgoing = graph.get(node)?.size ?? 0;
    if (outgoing > maxOutgoing) {
      maxOutgoing = outgoing;
      bestNode = node;
    }
  }

  return bestNode;
}

/**
 * Deduplicate detected cycles.
 */
function deduplicateCycles(cycles: CycleInfo[]): CycleInfo[] {
  const seen = new Set<string>();
  const unique: CycleInfo[] = [];

  for (const cycle of cycles) {
    // Create a canonical representation
    const sorted = [...cycle.modules].sort();
    const key = sorted.join('|');

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

// ============================================================================
// COUPLING ANALYSIS
// ============================================================================

/**
 * Compute coupling metrics for modules.
 */
function computeCouplingMetrics(
  graph: ModuleGraph,
  reverse: ModuleGraph,
  thresholds: ArchitectureThresholds
): CouplingMetrics {
  const metrics: CouplingMetrics = {
    averageAfferentCoupling: 0,
    averageEfferentCoupling: 0,
    averageInstability: 0,
    highCouplingCount: 0,
    mostCoupled: [],
  };

  const moduleMetrics: Array<{ module: string; afferent: number; efferent: number; instability: number }> = [];

  for (const [module, deps] of graph) {
    const efferent = deps.size; // Outgoing
    const afferent = reverse.get(module)?.size ?? 0; // Incoming

    const total = afferent + efferent;
    const instability = total > 0 ? efferent / total : 0;

    moduleMetrics.push({ module, afferent, efferent, instability });

    if (afferent > thresholds.maxAfferentCoupling || efferent > thresholds.maxEfferentCoupling) {
      metrics.highCouplingCount++;
    }
  }

  if (moduleMetrics.length > 0) {
    const totalAfferent = moduleMetrics.reduce((sum, m) => sum + m.afferent, 0);
    const totalEfferent = moduleMetrics.reduce((sum, m) => sum + m.efferent, 0);
    const totalInstability = moduleMetrics.reduce((sum, m) => sum + m.instability, 0);

    metrics.averageAfferentCoupling = totalAfferent / moduleMetrics.length;
    metrics.averageEfferentCoupling = totalEfferent / moduleMetrics.length;
    metrics.averageInstability = totalInstability / moduleMetrics.length;
  }

  // Find most coupled modules
  moduleMetrics.sort((a, b) => (b.afferent + b.efferent) - (a.afferent + a.efferent));
  metrics.mostCoupled = moduleMetrics.slice(0, 10).map((m) => ({
    module: m.module,
    afferent: m.afferent,
    efferent: m.efferent,
  }));

  return metrics;
}

// ============================================================================
// LAYER VIOLATION DETECTION
// ============================================================================

/**
 * Detect layer violations based on expected layer hierarchy.
 */
function detectLayerViolations(
  dependencies: DependencyInfo[],
  expectedLayers?: string[]
): ViolationInfo[] {
  const violations: ViolationInfo[] = [];

  if (!expectedLayers || expectedLayers.length === 0) {
    return violations;
  }

  // Build layer index (higher index = lower layer)
  const layerIndex = new Map<string, number>();
  for (let i = 0; i < expectedLayers.length; i++) {
    layerIndex.set(expectedLayers[i].toLowerCase(), i);
  }

  for (const dep of dependencies) {
    const fromLayer = inferLayer(dep.from, expectedLayers);
    const toLayer = inferLayer(dep.to, expectedLayers);

    if (fromLayer && toLayer) {
      const fromIdx = layerIndex.get(fromLayer.toLowerCase());
      const toIdx = layerIndex.get(toLayer.toLowerCase());

      if (fromIdx !== undefined && toIdx !== undefined && fromIdx > toIdx) {
        // Lower layer depending on higher layer - violation!
        violations.push({
          type: 'layer_violations',
          severity: 'high',
          location: dep.from,
          description: `Module in layer "${fromLayer}" depends on module in higher layer "${toLayer}"`,
          suggestion: `Extract interface or move shared code to a lower layer`,
          affectedEntities: [dep.from, dep.to],
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// LARGE INTERFACE DETECTION
// ============================================================================

/**
 * Detect modules with too many exports (large interfaces).
 */
function detectLargeInterfaces(
  modules: ModuleKnowledge[],
  thresholds: ArchitectureThresholds
): ViolationInfo[] {
  const violations: ViolationInfo[] = [];

  for (const mod of modules) {
    if (mod.exports.length > thresholds.maxInterfaceMethods) {
      violations.push({
        type: 'large_interfaces',
        severity: mod.exports.length > thresholds.maxInterfaceMethods * 2 ? 'high' : 'medium',
        location: mod.path,
        description: `Module has ${mod.exports.length} exports, exceeding threshold of ${thresholds.maxInterfaceMethods}`,
        suggestion: `Consider splitting into smaller, focused modules`,
        affectedEntities: [mod.path],
      });
    }
  }

  return violations;
}

// ============================================================================
// SUGGESTION GENERATION
// ============================================================================

/**
 * Generate architecture improvement suggestions.
 */
function generateSuggestions(
  cycles: CycleInfo[],
  violations: ViolationInfo[],
  couplingMetrics: CouplingMetrics
): ArchitectureSuggestion[] {
  const suggestions: ArchitectureSuggestion[] = [];

  // Suggest fixing critical cycles first
  for (const cycle of cycles.filter((c) => c.severity === 'critical' || c.severity === 'high')) {
    suggestions.push({
      priority: cycle.severity === 'critical' ? 100 : 80,
      category: 'decoupling',
      title: `Break circular dependency: ${cycle.modules.map((m) => path.basename(m)).join(' -> ')}`,
      description: `Circular dependency of length ${cycle.length} detected. Consider extracting shared abstractions or inverting dependencies.`,
      affectedFiles: cycle.modules,
      effort: cycle.length <= 2 ? 'moderate' : 'complex',
    });
  }

  // Suggest fixing layer violations
  for (const violation of violations.filter((v) => v.type === 'layer_violations')) {
    suggestions.push({
      priority: 70,
      category: 'layering',
      title: `Fix layer violation in ${path.basename(violation.location)}`,
      description: violation.description,
      affectedFiles: violation.affectedEntities,
      effort: 'moderate',
    });
  }

  // Suggest fixing large interfaces
  for (const violation of violations.filter((v) => v.type === 'large_interfaces')) {
    suggestions.push({
      priority: 50,
      category: 'refactoring',
      title: `Refactor large module: ${path.basename(violation.location)}`,
      description: violation.description,
      affectedFiles: violation.affectedEntities,
      effort: 'complex',
    });
  }

  // Suggest decoupling highly coupled modules
  for (const coupled of couplingMetrics.mostCoupled.slice(0, 3)) {
    if (coupled.afferent + coupled.efferent > 20) {
      suggestions.push({
        priority: 60,
        category: 'decoupling',
        title: `Reduce coupling in ${path.basename(coupled.module)}`,
        description: `Module has ${coupled.afferent} incoming and ${coupled.efferent} outgoing dependencies. Consider introducing interfaces or facades.`,
        affectedFiles: [coupled.module],
        effort: 'complex',
      });
    }
  }

  // Sort by priority
  suggestions.sort((a, b) => b.priority - a.priority);

  return suggestions;
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze codebase architecture for violations and improvements.
 *
 * This function:
 * 1. Analyzes module structure and dependencies
 * 2. Detects circular dependencies
 * 3. Identifies layer violations
 * 4. Computes coupling metrics
 * 5. Generates improvement suggestions
 *
 * @param options - Analysis configuration options
 * @returns Result of the architecture analysis
 *
 * @example
 * ```typescript
 * const result = await analyzeArchitecture({
 *   rootDir: '/path/to/repo',
 *   expectedLayers: ['api', 'core', 'storage', 'utils'],
 *   storage: myStorage,
 * });
 * console.log(`Found ${result.cycles.length} cycles and ${result.layerViolations.length} violations`);
 * ```
 */
export async function analyzeArchitecture(
  options: AnalyzeArchitectureOptions
): Promise<ArchitectureAnalysisResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    rootDir,
    expectedLayers,
    storage,
    checks = DEFAULT_CHECKS,
    thresholds = DEFAULT_THRESHOLDS,
    verbose = false,
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for analyzeArchitecture');
  }
  if (!storage) {
    throw new Error('storage is required for analyzeArchitecture');
  }

  // Fetch modules from storage
  let modules: ModuleKnowledge[] = [];
  try {
    modules = await storage.getModules();
  } catch (error) {
    errors.push(`Failed to fetch modules: ${getErrorMessage(error)}`);
  }

  if (verbose) {
    console.error(`[analyzeArchitecture] Analyzing ${modules.length} modules`);
  }

  // Build module graphs
  const graphBundle: ModuleGraphBundle = buildModuleGraphs(modules);
  const { graph, reverse, unresolved } = graphBundle;

  // Build module info
  const moduleInfos: ModuleInfo[] = modules.map((mod) => ({
    path: mod.path,
    name: path.basename(mod.path, path.extname(mod.path)),
    exportCount: mod.exports.length,
    dependencyCount: mod.dependencies.length,
    dependentCount: reverse.get(mod.path)?.size ?? 0,
    layer: inferLayer(mod.path, expectedLayers),
    complexity: Math.min(100, mod.exports.length * 2 + mod.dependencies.length * 3),
  }));

  // Build dependency info
  const dependencies: DependencyInfo[] = [];
  for (const [from, tos] of graph) {
    for (const to of tos) {
      dependencies.push({
        from,
        to,
        type: 'import',
        confidence: 1.0,
        isViolation: false,
      });
    }
  }

  // Perform checks
  const cycles: CycleInfo[] = [];
  const violations: ViolationInfo[] = [];

  if (checks.includes('circular_deps')) {
    const detectedCycles = detectCycles(graph);
    cycles.push(...detectedCycles);

    // Add cycle violations
    for (const cycle of detectedCycles) {
      violations.push({
        type: 'circular_deps',
        severity: cycle.severity,
        location: cycle.modules[0],
        description: `Circular dependency detected: ${cycle.modules.join(' -> ')} -> ${cycle.modules[0]}`,
        suggestion: cycle.suggestedBreakPoint
          ? `Consider breaking the cycle at ${path.basename(cycle.suggestedBreakPoint)}`
          : 'Consider extracting shared abstractions',
        affectedEntities: cycle.modules,
      });
    }
  }

  if (checks.includes('layer_violations')) {
    const layerViolations = detectLayerViolations(dependencies, expectedLayers);
    violations.push(...layerViolations);
  }

  if (checks.includes('large_interfaces')) {
    const largeInterfaceViolations = detectLargeInterfaces(modules, thresholds);
    violations.push(...largeInterfaceViolations);
  }

  // Compute coupling metrics
  const couplingMetrics = computeCouplingMetrics(graph, reverse, thresholds);

  if (checks.includes('coupling_analysis')) {
    // Add high coupling violations
    for (const coupled of couplingMetrics.mostCoupled) {
      if (coupled.afferent > thresholds.maxAfferentCoupling) {
        violations.push({
          type: 'coupling_analysis',
          severity: coupled.afferent > thresholds.maxAfferentCoupling * 2 ? 'high' : 'medium',
          location: coupled.module,
          description: `High afferent coupling: ${coupled.afferent} modules depend on this module`,
          suggestion: 'Consider splitting into smaller modules or introducing interfaces',
          affectedEntities: [coupled.module],
        });
      }

      if (coupled.efferent > thresholds.maxEfferentCoupling) {
        violations.push({
          type: 'coupling_analysis',
          severity: coupled.efferent > thresholds.maxEfferentCoupling * 2 ? 'high' : 'medium',
          location: coupled.module,
          description: `High efferent coupling: this module depends on ${coupled.efferent} other modules`,
          suggestion: 'Consider using dependency injection or facade pattern',
          affectedEntities: [coupled.module],
        });
      }
    }
  }

  // Add unresolved dependencies as warnings
  for (const { from, specifier } of unresolved) {
    errors.push(`Unresolved dependency in ${from}: ${specifier}`);
  }

  // Generate suggestions
  const suggestions = generateSuggestions(cycles, violations, couplingMetrics);

  return {
    modules: moduleInfos,
    dependencies,
    cycles,
    layerViolations: violations.filter((v) => v.type === 'layer_violations'),
    couplingMetrics,
    duration: Date.now() - startTime,
    errors,
    suggestions,
  };
}

/**
 * Create an architecture analysis primitive with bound options.
 */
export function createAnalyzeArchitecture(
  defaultOptions: Partial<AnalyzeArchitectureOptions>
): (options: Partial<AnalyzeArchitectureOptions> & { rootDir: string; storage: LibrarianStorage }) => Promise<ArchitectureAnalysisResult> {
  return async (options) => {
    return analyzeArchitecture({
      ...defaultOptions,
      ...options,
    });
  };
}
