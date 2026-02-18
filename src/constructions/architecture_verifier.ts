/**
 * @fileoverview Architecture Verifier Construction
 *
 * A composed construction that validates architecture by combining:
 * - Constraint engine for rule validation
 * - Dependency graph for layer verification
 * - Quality gates for compliance checking
 *
 * Composes:
 * - Query API for codebase understanding
 * - Constraint Engine for rule enforcement
 * - Knowledge Graph for dependency analysis
 * - Confidence System for uncertainty quantification
 */

import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DependencyCycle {
  nodes: string[];
  type: 'direct' | 'indirect';
  length: number;
}

export interface ArchitectureLayer {
  /** Layer name */
  name: string;
  /** Glob patterns for files in this layer */
  patterns: string[];
  /** Layers this layer can depend on */
  allowedDependencies: string[];
}

export interface ArchitectureBoundary {
  /** Boundary name */
  name: string;
  /** Description of the boundary */
  description: string;
  /** Files inside the boundary */
  inside: string[];
  /** Files outside the boundary */
  outside: string[];
}

export interface ArchitectureRule {
  /** Rule identifier */
  id: string;
  /** Rule description */
  description: string;
  /** Rule type */
  type: 'no-circular' | 'layer-dependency' | 'boundary' | 'naming' | 'custom';
  /** Rule severity */
  severity: 'error' | 'warning' | 'info';
}

export interface ArchitectureSpec {
  /** Layer definitions */
  layers: ArchitectureLayer[];
  /** Boundary definitions */
  boundaries: ArchitectureBoundary[];
  /** Rules to enforce */
  rules: ArchitectureRule[];
}

export interface ArchitectureViolation {
  /** Rule that was violated */
  rule: ArchitectureRule;
  /** File where violation occurred */
  file: string;
  /** Line number if applicable */
  line?: number;
  /** Description of the violation */
  description: string;
  /** Suggestion for fixing */
  suggestion?: string;
  /** Related files involved in the violation */
  relatedFiles: string[];
}

export interface ComplianceScore {
  /** Overall compliance percentage (0-100) */
  overall: number;
  /** Per-layer compliance */
  byLayer: Record<string, number>;
  /** Per-rule compliance */
  byRule: Record<string, number>;
}

export interface VerificationReport {
  /** Original specification */
  spec: ArchitectureSpec;

  /** Violations found */
  violations: ArchitectureViolation[];

  /** Compliance scores */
  compliance: ComplianceScore;

  /** Number of files checked */
  filesChecked: number;

  /** Number of rules applied */
  rulesApplied: number;

  /** Confidence in the verification */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Verification timing */
  verificationTimeMs: number;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class ArchitectureVerifier {
  private librarian: Librarian;

  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  /**
   * Verify architecture compliance.
   */
  async verify(spec: ArchitectureSpec): Promise<VerificationReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];
    const violations: ArchitectureViolation[] = [];
    const filesChecked = new Set<string>();

    // Step 1: Verify layer dependencies
    const layerViolations = await this.verifyLayerDependencies(spec.layers, filesChecked);
    violations.push(...layerViolations);
    evidenceRefs.push(`layer_check:${layerViolations.length}_violations`);

    // Step 2: Verify boundary constraints
    const boundaryViolations = await this.verifyBoundaries(spec.boundaries, filesChecked);
    violations.push(...boundaryViolations);
    evidenceRefs.push(`boundary_check:${boundaryViolations.length}_violations`);

    // Step 3: Apply custom rules
    const ruleViolations = await this.applyRules(spec.rules, filesChecked);
    violations.push(...ruleViolations);
    evidenceRefs.push(`rule_check:${ruleViolations.length}_violations`);

    // Compute compliance scores
    const compliance = this.computeCompliance(spec, violations, filesChecked.size);
    evidenceRefs.push(`compliance:${compliance.overall.toFixed(1)}%`);

    // Compute confidence
    const confidence = this.computeConfidence(violations, filesChecked.size, spec);

    return {
      spec,
      violations,
      compliance,
      filesChecked: filesChecked.size,
      rulesApplied: spec.rules.length,
      confidence,
      evidenceRefs,
      verificationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Step 1: Verify layer dependencies.
   */
  private async verifyLayerDependencies(
    layers: ArchitectureLayer[],
    filesChecked: Set<string>
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    for (const layer of layers) {
      // Query for files in this layer
      const queryResult = await this.librarian.queryOptional({
        intent: `Find all imports and dependencies in files matching: ${layer.patterns.join(', ')}`,
        depth: 'L2',
        taskType: 'understand',
        perspective: 'architecture',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs) {
          // Track files checked
          for (const file of pack.relatedFiles || []) {
            filesChecked.add(file);
          }

          // Check for disallowed dependencies
          const disallowedViolations = this.checkLayerDependencies(pack, layer, layers);
          violations.push(...disallowedViolations);
        }
      }
    }

    return violations;
  }

  /**
   * Check a pack for layer dependency violations.
   */
  private checkLayerDependencies(
    pack: ContextPack,
    sourceLayer: ArchitectureLayer,
    allLayers: ArchitectureLayer[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const sourceFile = pack.relatedFiles?.[0] || 'unknown';

    // Check if source file matches the layer
    if (!this.matchesPatterns(sourceFile, sourceLayer.patterns)) {
      return violations;
    }

    // Look for import statements in code snippets
    if (pack.codeSnippets) {
      for (const snippet of pack.codeSnippets) {
        const imports = this.extractImports(snippet.content);

        for (const importPath of imports) {
          // Find which layer the import belongs to
          const targetLayer = allLayers.find(l =>
            l.patterns.some(p => importPath.includes(p.replace('*', '').replace('**/', '')))
          );

          if (targetLayer && !sourceLayer.allowedDependencies.includes(targetLayer.name)) {
            violations.push({
              rule: {
                id: `layer-dep-${sourceLayer.name}-to-${targetLayer.name}`,
                description: `Layer ${sourceLayer.name} should not depend on ${targetLayer.name}`,
                type: 'layer-dependency',
                severity: 'error',
              },
              file: sourceFile,
              line: snippet.startLine,
              description: `Disallowed dependency: ${sourceLayer.name} -> ${targetLayer.name}`,
              suggestion: `Move the dependency to an allowed layer or refactor to avoid it`,
              relatedFiles: [importPath],
            });
          }
        }
      }
    }

    return violations;
  }

  /**
   * Extract import paths from code.
   */
  private extractImports(code: string): string[] {
    const imports: string[] = [];

    // Match ES6 imports
    const es6Matches = code.matchAll(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of es6Matches) {
      imports.push(match[1]);
    }

    // Match CommonJS requires
    const cjsMatches = code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of cjsMatches) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * Check if a file matches patterns.
   */
  private matchesPatterns(file: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Simple glob matching
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\//g, '\\/');
      return new RegExp(regex).test(file);
    });
  }

  /**
   * Step 2: Verify boundary constraints.
   */
  private async verifyBoundaries(
    boundaries: ArchitectureBoundary[],
    filesChecked: Set<string>
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    for (const boundary of boundaries) {
      // Query for cross-boundary references
      const queryResult = await this.librarian.queryOptional({
        intent: `Find dependencies between files: [${boundary.inside.join(', ')}] and [${boundary.outside.join(', ')}]`,
        depth: 'L2',
        taskType: 'understand',
        perspective: 'architecture',
      });

      if (queryResult.packs) {
        for (const pack of queryResult.packs) {
          for (const file of pack.relatedFiles || []) {
            filesChecked.add(file);
          }

          // Check for boundary crossings
          const crossings = this.checkBoundaryCrossings(pack, boundary);
          violations.push(...crossings);
        }
      }
    }

    return violations;
  }

  /**
   * Check for boundary crossing violations.
   */
  private checkBoundaryCrossings(
    pack: ContextPack,
    boundary: ArchitectureBoundary
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const sourceFile = pack.relatedFiles?.[0] || 'unknown';

    const isInside = boundary.inside.some(p => sourceFile.includes(p));
    const isOutside = boundary.outside.some(p => sourceFile.includes(p));

    if (!isInside && !isOutside) {
      return violations;
    }

    // Look for cross-boundary imports
    if (pack.codeSnippets) {
      for (const snippet of pack.codeSnippets) {
        const imports = this.extractImports(snippet.content);

        for (const importPath of imports) {
          const importIsInside = boundary.inside.some(p => importPath.includes(p));
          const importIsOutside = boundary.outside.some(p => importPath.includes(p));

          if ((isInside && importIsOutside) || (isOutside && importIsInside)) {
            violations.push({
              rule: {
                id: `boundary-${boundary.name}`,
                description: boundary.description,
                type: 'boundary',
                severity: 'warning',
              },
              file: sourceFile,
              line: snippet.startLine,
              description: `Boundary crossing: ${boundary.name}`,
              suggestion: `Consider using an interface or adapter to cross this boundary`,
              relatedFiles: [importPath],
            });
          }
        }
      }
    }

    return violations;
  }

  /**
   * Step 3: Apply custom rules.
   */
  private async applyRules(
    rules: ArchitectureRule[],
    filesChecked: Set<string>
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    for (const rule of rules) {
      switch (rule.type) {
        case 'no-circular':
          const circularViolations = await this.checkCircularDependencies(rule, filesChecked);
          violations.push(...circularViolations);
          break;

        case 'naming':
          const namingViolations = await this.checkNamingConventions(rule, filesChecked);
          violations.push(...namingViolations);
          break;

        case 'custom':
          // Custom rules would need more specific implementation
          break;
      }
    }

    return violations;
  }

  /**
   * Check for circular dependencies using full DFS-based cycle detection.
   * Detects cycles of any length, not just 2-node cycles.
   */
  private async checkCircularDependencies(
    rule: ArchitectureRule,
    filesChecked: Set<string>
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    const queryResult = await this.librarian.queryOptional({
      intent: 'Find circular import dependencies in the codebase',
      depth: 'L3',
      taskType: 'understand',
      perspective: 'architecture',
    });

    if (queryResult.packs) {
      // Build dependency graph from packs
      const dependencies = new Map<string, string[]>();
      const fileToLineMap = new Map<string, number>();

      for (const pack of queryResult.packs) {
        for (const file of pack.relatedFiles || []) {
          filesChecked.add(file);
        }

        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            const imports = this.extractImports(snippet.content);
            const sourceFile = pack.relatedFiles?.[0] || 'unknown';

            // Store line number for violation reporting
            if (!fileToLineMap.has(sourceFile)) {
              fileToLineMap.set(sourceFile, snippet.startLine || 0);
            }

            // Build dependency list for this file
            const existingDeps = dependencies.get(sourceFile) || [];
            dependencies.set(sourceFile, [...existingDeps, ...imports]);
          }
        }
      }

      // Detect all cycles using DFS
      const cycles = detectAllCycles(dependencies);

      // Convert cycles to violations
      for (const cycle of cycles) {
        const cycleDescription = cycle.nodes.join(' -> ');
        const sourceFile = cycle.nodes[0];

        violations.push({
          rule,
          file: sourceFile,
          line: fileToLineMap.get(sourceFile),
          description: `Circular dependency detected (${cycle.type}, length ${cycle.length}): ${cycleDescription}`,
          suggestion: cycle.length === 1
            ? 'Break the direct cycle by extracting shared code into a third module'
            : `Break the ${cycle.length}-node cycle by refactoring to remove one of the dependencies in the chain`,
          relatedFiles: cycle.nodes.slice(1, -1), // Exclude first (source) and last (duplicate of first)
        });
      }

      // Also find SCCs for additional insight
      const sccs = findStronglyConnectedComponents(dependencies);
      for (const scc of sccs) {
        if (scc.length > 2) {
          // Report large SCCs as they indicate complex dependency tangles
          violations.push({
            rule,
            file: scc[0],
            description: `Strongly connected component with ${scc.length} nodes indicates complex circular dependencies: ${scc.join(', ')}`,
            suggestion: 'Consider restructuring these modules to reduce coupling',
            relatedFiles: scc.slice(1),
          });
        }
      }
    }

    return violations;
  }

  /**
   * Check naming conventions.
   */
  private async checkNamingConventions(
    rule: ArchitectureRule,
    filesChecked: Set<string>
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    const queryResult = await this.librarian.queryOptional({
      intent: 'Find all exported functions and classes with their names',
      depth: 'L2',
      taskType: 'understand',
      perspective: 'architecture',
    });

    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        for (const file of pack.relatedFiles || []) {
          filesChecked.add(file);
        }

        // Check naming patterns
        if (pack.targetId) {
          const name = pack.targetId;

          // Check for common naming issues
          if (name.startsWith('_') && !name.startsWith('__')) {
            violations.push({
              rule,
              file: pack.relatedFiles?.[0] || 'unknown',
              description: `Unusual naming: ${name} starts with underscore`,
              suggestion: `Use conventional naming without leading underscore for public APIs`,
              relatedFiles: [],
            });
          }
        }
      }
    }

    return violations;
  }

  /**
   * Compute compliance scores.
   */
  private computeCompliance(
    spec: ArchitectureSpec,
    violations: ArchitectureViolation[],
    filesChecked: number
  ): ComplianceScore {
    // Calculate overall compliance
    const maxViolationsPerFile = 2; // Expected max violations per file
    const expectedViolations = filesChecked * maxViolationsPerFile;
    const overall = Math.max(0, 100 - (violations.length / Math.max(1, expectedViolations)) * 100);

    // Calculate per-layer compliance
    const byLayer: Record<string, number> = {};
    for (const layer of spec.layers) {
      const layerViolations = violations.filter(v =>
        v.rule.type === 'layer-dependency' && v.rule.id.includes(layer.name)
      );
      byLayer[layer.name] = Math.max(0, 100 - layerViolations.length * 20);
    }

    // Calculate per-rule compliance
    const byRule: Record<string, number> = {};
    for (const rule of spec.rules) {
      const ruleViolations = violations.filter(v => v.rule.id === rule.id);
      byRule[rule.id] = Math.max(0, 100 - ruleViolations.length * 25);
    }

    return {
      overall: Math.round(overall),
      byLayer,
      byRule,
    };
  }

  /**
   * Compute confidence in the verification.
   */
  private computeConfidence(
    violations: ArchitectureViolation[],
    filesChecked: number,
    spec: ArchitectureSpec
  ): ConfidenceValue {
    if (filesChecked === 0) {
      return {
        type: 'absent' as const,
        reason: 'insufficient_data' as const,
      };
    }

    const specComplexity = spec.layers.length + spec.boundaries.length + spec.rules.length;

    if (specComplexity === 0) {
      return {
        type: 'bounded' as const,
        low: 0.3,
        high: 0.7,
        basis: 'theoretical' as const,
        citation: 'Empty architecture spec provides limited verification value',
      };
    }

    // More files and rules checked = higher confidence
    const coverageScore = Math.min(1, filesChecked / 50); // Normalize by expected file count
    const ruleScore = Math.min(1, specComplexity / 10);
    const confidenceValue = Math.min(0.9, (coverageScore + ruleScore) / 2 + 0.3);

    return {
      type: 'measured' as const,
      value: confidenceValue,
      measurement: {
        datasetId: 'architecture_verification',
        sampleSize: filesChecked,
        accuracy: 1 - (violations.length / Math.max(1, filesChecked * specComplexity)),
        confidenceInterval: [
          Math.max(0, confidenceValue - 0.15),
          Math.min(1, confidenceValue + 0.1),
        ] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createArchitectureVerifier(librarian: Librarian): ArchitectureVerifier {
  return new ArchitectureVerifier(librarian);
}

// ============================================================================
// CYCLE DETECTION ALGORITHMS
// ============================================================================

/**
 * Detect all cycles in a dependency graph using DFS.
 * Finds cycles of any length, not just 2-node cycles.
 */
export function detectAllCycles(
  dependencies: Map<string, string[]>
): DependencyCycle[] {
  const cycles: DependencyCycle[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    pathStack.push(node);

    const deps = dependencies.get(node) || [];

    for (const dep of deps) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (recursionStack.has(dep)) {
        // Found a cycle - extract it
        const cycleStart = pathStack.indexOf(dep);
        const cycleNodes = pathStack.slice(cycleStart);
        cycleNodes.push(dep); // Close the cycle

        // Avoid duplicate cycles (same nodes, different starting point)
        const normalized = normalizeCycle(cycleNodes);
        const cycleLength = cycleNodes.length - 1; // -1 because last node repeats first
        if (!cycles.some(c => normalizeCycle(c.nodes).join('\u2192') === normalized.join('\u2192'))) {
          cycles.push({
            nodes: cycleNodes,
            type: cycleLength <= 2 ? 'direct' : 'indirect',
            length: cycleLength,
          });
        }
      }
    }

    pathStack.pop();
    recursionStack.delete(node);
  }

  // Run DFS from all nodes to find all cycles
  for (const node of dependencies.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Normalize a cycle to its lexicographically smallest rotation.
 * This ensures the same cycle detected from different starting points
 * is recognized as identical.
 */
function normalizeCycle(nodes: string[]): string[] {
  // Find the lexicographically smallest rotation
  const cycle = nodes.slice(0, -1); // Remove the repeated last node
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) {
      minIdx = i;
    }
  }
  const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
  rotated.push(rotated[0]); // Add closing node back
  return rotated;
}

/**
 * Find strongly connected components using Tarjan's algorithm.
 * SCCs with more than one node indicate cyclic dependencies.
 */
export function findStronglyConnectedComponents(
  dependencies: Map<string, string[]>
): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let currentIndex = 0;

  function strongConnect(node: string): void {
    index.set(node, currentIndex);
    lowlink.set(node, currentIndex);
    currentIndex++;
    stack.push(node);
    onStack.add(node);

    for (const dep of dependencies.get(node) || []) {
      if (!index.has(dep)) {
        strongConnect(dep);
        lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(dep)!));
      } else if (onStack.has(dep)) {
        lowlink.set(node, Math.min(lowlink.get(node)!, index.get(dep)!));
      }
    }

    if (lowlink.get(node) === index.get(node)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== node);

      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const node of dependencies.keys()) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}

// ============================================================================
// AUTO-DISCOVERY OF ARCHITECTURE LAYERS
// ============================================================================

/**
 * A discovered architecture layer with confidence score.
 */
export interface DiscoveredLayer {
  /** Layer name (api, services, domain, etc.) */
  name: string;
  /** Pattern that matched */
  pattern: string;
  /** Files belonging to this layer */
  files: string[];
  /** Confidence score (0-1) based on number of files */
  confidence: number;
}

/**
 * Common architecture layer patterns used for auto-discovery.
 */
export const LAYER_PATTERNS = [
  { name: 'api', patterns: ['src/api', 'api/', 'routes/', 'controllers/', 'handlers/'] },
  { name: 'services', patterns: ['src/services', 'services/', 'service/'] },
  { name: 'domain', patterns: ['src/domain', 'domain/', 'models/', 'entities/'] },
  { name: 'infrastructure', patterns: ['src/infrastructure', 'infrastructure/', 'infra/'] },
  { name: 'storage', patterns: ['src/storage', 'storage/', 'db/', 'database/', 'repositories/'] },
  { name: 'ui', patterns: ['src/components', 'components/', 'views/', 'pages/', 'screens/'] },
  { name: 'utils', patterns: ['src/utils', 'utils/', 'helpers/', 'lib/', 'common/'] },
  { name: 'config', patterns: ['src/config', 'config/', 'settings/'] },
  { name: 'tests', patterns: ['__tests__/', 'test/', 'tests/', 'spec/'] },
] as const;

/**
 * Auto-discover architecture layers from a list of files.
 *
 * Scans the file paths and identifies common architectural patterns,
 * returning discovered layers with confidence scores based on the
 * number of matching files.
 *
 * @param files - Array of file paths to analyze
 * @returns Array of discovered layers with files and confidence scores
 *
 * @example
 * ```typescript
 * const files = ['src/api/users.ts', 'src/api/auth.ts', 'src/services/user-service.ts'];
 * const layers = await discoverArchitectureLayers(files);
 * // Returns:
 * // [
 * //   { name: 'api', pattern: 'src/api', files: ['src/api/users.ts', 'src/api/auth.ts'], confidence: 0.4 },
 * //   { name: 'services', pattern: 'src/services', files: ['src/services/user-service.ts'], confidence: 0.2 }
 * // ]
 * ```
 */
export async function discoverArchitectureLayers(
  files: string[]
): Promise<DiscoveredLayer[]> {
  const discovered: DiscoveredLayer[] = [];

  for (const layer of LAYER_PATTERNS) {
    const matchingFiles = files.filter(f =>
      layer.patterns.some(p => f.includes(p))
    );

    if (matchingFiles.length > 0) {
      discovered.push({
        name: layer.name,
        pattern: layer.patterns.find(p => matchingFiles.some(f => f.includes(p))) || layer.patterns[0],
        files: matchingFiles,
        confidence: Math.min(1, matchingFiles.length / 5), // More files = higher confidence
      });
    }
  }

  return discovered;
}

/**
 * Convert discovered layers to ArchitectureSpec format.
 *
 * Creates an ArchitectureSpec from auto-discovered layers, with
 * a default layered dependency structure (higher layers depend on lower).
 *
 * @param discoveredLayers - Layers discovered by discoverArchitectureLayers
 * @returns Architecture specification ready for verification
 */
export function discoveredLayersToSpec(discoveredLayers: DiscoveredLayer[]): ArchitectureSpec {
  // Default layered architecture: api -> services -> domain, utils allowed everywhere
  const layerOrder = ['api', 'services', 'domain', 'infrastructure', 'storage', 'utils', 'config'];

  const layers: ArchitectureLayer[] = discoveredLayers.map(dl => {
    const layerIdx = layerOrder.indexOf(dl.name);
    // Each layer can depend on layers below it in the hierarchy
    const allowedDeps = layerIdx >= 0
      ? layerOrder.slice(layerIdx + 1).filter(l => discoveredLayers.some(d => d.name === l))
      : ['utils', 'config']; // Default: only utils and config

    // Utils and config can be used by everyone
    if (!allowedDeps.includes('utils') && discoveredLayers.some(d => d.name === 'utils')) {
      allowedDeps.push('utils');
    }
    if (!allowedDeps.includes('config') && discoveredLayers.some(d => d.name === 'config')) {
      allowedDeps.push('config');
    }

    return {
      name: dl.name,
      patterns: [`${dl.pattern}/**`],
      allowedDependencies: allowedDeps,
    };
  });

  return {
    layers,
    boundaries: [],
    rules: [
      {
        id: 'no-circular',
        description: 'No circular dependencies between layers',
        type: 'no-circular',
        severity: 'error',
      },
    ],
  };
}

// ============================================================================
// VISUALIZATION OUTPUT (DOT FORMAT)
// ============================================================================

/**
 * Options for DOT graph generation.
 */
export interface DOTGenerationOptions {
  /** Graph title */
  title?: string;
  /** Use clusters for layers */
  useClusters?: boolean;
  /** Show edge labels */
  showEdgeLabels?: boolean;
  /** Node color scheme */
  colorScheme?: 'default' | 'traffic' | 'mono';
}

/**
 * Generate a DOT (Graphviz) representation of dependencies.
 *
 * Creates a DOT format string that can be rendered using Graphviz
 * tools (dot, neato, etc.) to visualize the dependency graph.
 * Violations are highlighted in red.
 *
 * @param dependencies - Map of source -> targets
 * @param violations - Optional array of violations to highlight
 * @param options - Optional generation options
 * @returns DOT format string
 *
 * @example
 * ```typescript
 * const deps = new Map([
 *   ['api', ['services']],
 *   ['services', ['domain']],
 *   ['domain', []]
 * ]);
 * const violations = [{ source: 'domain', target: 'api', rule: 'no-upward-deps' }];
 * const dot = generateDependencyDOT(deps, violations);
 * // Render with: dot -Tpng -o graph.png
 * ```
 */
export function generateDependencyDOT(
  dependencies: Map<string, string[]>,
  violations?: Array<{ source: string; target: string; rule: string }>,
  options: DOTGenerationOptions = {}
): string {
  const { title = 'Dependencies', colorScheme = 'default' } = options;

  const lines: string[] = [`digraph "${title}" {`];
  lines.push('  rankdir=TB;');
  lines.push('  node [shape=box, style="rounded,filled"];');
  lines.push('  edge [fontsize=10];');
  lines.push('');

  // Collect all nodes
  const allNodes = new Set<string>();
  for (const [source, targets] of dependencies) {
    allNodes.add(source);
    targets.forEach(t => allNodes.add(t));
  }

  // Color scheme
  const fillColor = colorScheme === 'mono' ? '#f0f0f0' : '#e8f4f8';
  const violationNodeColor = colorScheme === 'traffic' ? '#ffcccc' : '#ffe0e0';

  // Find nodes involved in violations
  const violationNodes = new Set<string>();
  if (violations) {
    for (const v of violations) {
      violationNodes.add(v.source);
      violationNodes.add(v.target);
    }
  }

  // Add nodes
  for (const node of allNodes) {
    const sanitized = sanitizeDOTId(node);
    const label = node.split('/').pop() || node; // Use filename as label
    const color = violationNodes.has(node) ? violationNodeColor : fillColor;
    lines.push(`  ${sanitized} [label="${label}", fillcolor="${color}"];`);
  }

  lines.push('');

  // Add edges
  for (const [source, targets] of dependencies) {
    const sourceId = sanitizeDOTId(source);
    for (const target of targets) {
      const targetId = sanitizeDOTId(target);
      const isViolation = violations?.some(v => v.source === source && v.target === target);

      if (isViolation) {
        const violation = violations!.find(v => v.source === source && v.target === target);
        lines.push(`  ${sourceId} -> ${targetId} [color=red, penwidth=2, label="${violation!.rule}"];`);
      } else {
        lines.push(`  ${sourceId} -> ${targetId};`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate a DOT representation with layer clusters.
 *
 * Groups nodes by their layer for better visualization of
 * architectural boundaries.
 *
 * @param dependencies - Map of source -> targets
 * @param layers - Layer assignments for files
 * @param violations - Optional violations to highlight
 * @returns DOT format string with clusters
 */
export function generateLayeredDOT(
  dependencies: Map<string, string[]>,
  layers: DiscoveredLayer[],
  violations?: Array<{ source: string; target: string; rule: string }>
): string {
  const lines: string[] = ['digraph LayeredArchitecture {'];
  lines.push('  rankdir=TB;');
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#e8f4f8"];');
  lines.push('  compound=true;');
  lines.push('');

  // Create a map of file -> layer
  const fileToLayer = new Map<string, string>();
  for (const layer of layers) {
    for (const file of layer.files) {
      fileToLayer.set(file, layer.name);
    }
  }

  // Group files by layer
  const layerGroups = new Map<string, string[]>();
  for (const [source, targets] of dependencies) {
    const layer = fileToLayer.get(source) || 'unknown';
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, []);
    }
    layerGroups.get(layer)!.push(source);

    for (const target of targets) {
      const targetLayer = fileToLayer.get(target) || 'unknown';
      if (!layerGroups.has(targetLayer)) {
        layerGroups.set(targetLayer, []);
      }
      if (!layerGroups.get(targetLayer)!.includes(target)) {
        layerGroups.get(targetLayer)!.push(target);
      }
    }
  }

  // Layer colors
  const layerColors: Record<string, string> = {
    api: '#ffecb3',
    services: '#c8e6c9',
    domain: '#bbdefb',
    infrastructure: '#d7ccc8',
    storage: '#f8bbd9',
    ui: '#e1bee7',
    utils: '#f5f5f5',
    config: '#cfd8dc',
    tests: '#ffe0b2',
    unknown: '#f5f5f5',
  };

  // Create subgraphs for each layer
  for (const [layer, files] of layerGroups) {
    const color = layerColors[layer] || '#f5f5f5';
    lines.push(`  subgraph cluster_${layer} {`);
    lines.push(`    label="${layer.toUpperCase()}";`);
    lines.push(`    style=filled;`);
    lines.push(`    color="${color}";`);
    lines.push('');

    for (const file of files) {
      const sanitized = sanitizeDOTId(file);
      const label = file.split('/').pop() || file;
      lines.push(`    ${sanitized} [label="${label}"];`);
    }

    lines.push('  }');
    lines.push('');
  }

  // Add edges
  for (const [source, targets] of dependencies) {
    const sourceId = sanitizeDOTId(source);
    for (const target of targets) {
      const targetId = sanitizeDOTId(target);
      const isViolation = violations?.some(v => v.source === source && v.target === target);

      if (isViolation) {
        lines.push(`  ${sourceId} -> ${targetId} [color=red, penwidth=2];`);
      } else {
        lines.push(`  ${sourceId} -> ${targetId};`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Sanitize a string to be a valid DOT identifier.
 */
function sanitizeDOTId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============================================================================
// COUPLING/COHESION METRICS (Robert C. Martin's Package Metrics)
// ============================================================================

/**
 * Package metrics following Robert C. Martin's principles.
 *
 * These metrics help evaluate package design quality:
 * - Stability: How resistant to change (stable packages are hard to change)
 * - Abstractness: Ratio of abstracts to concretes
 * - Distance from Main Sequence: Balance between stability and abstractness
 */
export interface PackageMetrics {
  /** Package/directory name */
  name: string;
  /** Afferent coupling (Ca): incoming dependencies - how many depend on this */
  ca: number;
  /** Efferent coupling (Ce): outgoing dependencies - how many this depends on */
  ce: number;
  /** Instability (I = Ce / (Ca + Ce)): 0 = stable, 1 = unstable */
  instability: number;
  /** Abstractness (A = abstracts / total): 0 = concrete, 1 = abstract */
  abstractness: number;
  /** Distance from main sequence (D = |A + I - 1|): 0 = ideal, 1 = worst */
  distance: number;
  /** Cohesion: internal connections / possible connections */
  cohesion: number;
  /** Number of abstract types (interfaces, abstract classes) */
  abstractCount: number;
  /** Number of concrete types */
  concreteCount: number;
  /** Files in the package */
  files: string[];
}

/**
 * Storage interface subset needed for package metrics calculation.
 */
export interface PackageMetricsStorage {
  getFiles(options?: { limit?: number }): Promise<Array<{ path: string }>>;
  getFunctionsByPath(filePath: string): Promise<Array<{
    id: string;
    name: string;
    kind?: string;
  }>>;
  getGraphEdges(options?: {
    sourceFiles?: string[];
    edgeTypes?: string[];
  }): Promise<Array<{
    fromId: string;
    toId: string;
    fromFile?: string;
    toFile?: string;
  }>>;
}

/**
 * Calculate Robert C. Martin's package metrics for a directory.
 *
 * Analyzes a package/directory to compute:
 * - Ca (Afferent Coupling): Number of external packages that depend on this one
 * - Ce (Efferent Coupling): Number of external packages this one depends on
 * - I (Instability): Ce / (Ca + Ce), where 0 is maximally stable
 * - A (Abstractness): Abstract types / Total types
 * - D (Distance from Main Sequence): |A + I - 1|
 * - Cohesion: Internal connections / Possible internal connections
 *
 * @param storage - Storage interface for querying symbols and edges
 * @param packageDir - Directory path to analyze
 * @returns Package metrics object
 *
 * @example
 * ```typescript
 * const metrics = await calculatePackageMetrics(storage, 'src/services');
 * console.log(`Instability: ${metrics.instability}`); // 0.6
 * console.log(`Distance from ideal: ${metrics.distance}`); // 0.2
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Software_package_metrics
 */
export async function calculatePackageMetrics(
  storage: PackageMetricsStorage,
  packageDir: string
): Promise<PackageMetrics> {
  const packageName = packageDir.split('/').pop() || packageDir;

  // Get all files in the package directory
  const allFiles = await storage.getFiles({ limit: 10000 });
  const packageFiles = allFiles
    .filter(f => f.path.startsWith(packageDir))
    .map(f => f.path);

  if (packageFiles.length === 0) {
    return {
      name: packageName,
      ca: 0,
      ce: 0,
      instability: 0,
      abstractness: 0,
      distance: 1,
      cohesion: 1,
      abstractCount: 0,
      concreteCount: 0,
      files: [],
    };
  }

  // Get all symbols and their dependencies
  let abstracts = 0;
  let concretes = 0;
  const internalSymbols = new Set<string>();
  const internalDeps = new Set<string>();
  const externalDeps = new Set<string>();
  const incomingDeps = new Set<string>();

  for (const filePath of packageFiles) {
    const symbols = await storage.getFunctionsByPath(filePath);

    for (const symbol of symbols) {
      internalSymbols.add(symbol.id);

      // Count abstract vs concrete based on kind
      if (symbol.kind === 'interface' || symbol.kind === 'type' || symbol.kind === 'abstract') {
        abstracts++;
      } else {
        concretes++;
      }
    }

    // Get edges from this file
    const edges = await storage.getGraphEdges({
      sourceFiles: [filePath],
      edgeTypes: ['imports', 'calls', 'extends', 'implements']
    });

    for (const edge of edges) {
      const targetFile = edge.toFile || '';
      if (targetFile.startsWith(packageDir)) {
        // Internal dependency
        internalDeps.add(`${edge.fromId}->${edge.toId}`);
      } else if (targetFile && !targetFile.includes('node_modules')) {
        // External dependency (not node_modules)
        externalDeps.add(targetFile);
      }
    }
  }

  // Get incoming dependencies (files outside that depend on this package)
  const externalFiles = allFiles
    .filter(f => !f.path.startsWith(packageDir))
    .map(f => f.path);

  for (const extFile of externalFiles.slice(0, 100)) { // Limit for performance
    const edges = await storage.getGraphEdges({
      sourceFiles: [extFile],
      edgeTypes: ['imports', 'calls', 'extends', 'implements']
    });

    for (const edge of edges) {
      const targetFile = edge.toFile || '';
      if (targetFile.startsWith(packageDir)) {
        incomingDeps.add(extFile);
        break;
      }
    }
  }

  // Calculate metrics
  const ca = incomingDeps.size;
  const ce = externalDeps.size;
  const total = abstracts + concretes;

  const instability = ca + ce > 0 ? ce / (ca + ce) : 0;
  const abstractness = total > 0 ? abstracts / total : 0;
  const distance = Math.abs(abstractness + instability - 1);

  // Cohesion: internal dependencies / max possible
  const maxPossible = internalSymbols.size * (internalSymbols.size - 1);
  const cohesion = maxPossible > 0 ? Math.min(1, internalDeps.size / maxPossible) : 1;

  return {
    name: packageName,
    ca,
    ce,
    instability,
    abstractness,
    distance,
    cohesion,
    abstractCount: abstracts,
    concreteCount: concretes,
    files: packageFiles,
  };
}

/**
 * Calculate metrics for all packages in a project.
 *
 * @param storage - Storage interface
 * @param rootDir - Root directory to scan
 * @param depth - How deep to look for packages (default: 2)
 * @returns Array of package metrics
 */
export async function calculateAllPackageMetrics(
  storage: PackageMetricsStorage,
  rootDir: string = 'src',
  depth: number = 2
): Promise<PackageMetrics[]> {
  const allFiles = await storage.getFiles({ limit: 10000 });

  // Find unique directories at the specified depth
  const directories = new Set<string>();
  for (const file of allFiles) {
    const parts = file.path.split('/');
    const rootIdx = parts.indexOf(rootDir.split('/').pop() || rootDir);

    if (rootIdx >= 0 && parts.length > rootIdx + depth) {
      const dir = parts.slice(0, rootIdx + depth + 1).join('/');
      directories.add(dir);
    }
  }

  // Calculate metrics for each directory
  const results: PackageMetrics[] = [];
  for (const dir of directories) {
    const metrics = await calculatePackageMetrics(storage, dir);
    if (metrics.files.length > 0) {
      results.push(metrics);
    }
  }

  return results;
}

/**
 * Evaluate package health based on metrics.
 *
 * @param metrics - Package metrics to evaluate
 * @returns Health assessment with issues and suggestions
 */
export function evaluatePackageHealth(metrics: PackageMetrics): {
  health: 'healthy' | 'warning' | 'critical';
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Zone of Pain: Stable + Concrete (distance > 0.7 with low abstractness)
  if (metrics.distance > 0.7 && metrics.abstractness < 0.3 && metrics.instability < 0.3) {
    issues.push('Package is in the "Zone of Pain": stable but too concrete');
    suggestions.push('Add interfaces/abstractions to increase flexibility');
  }

  // Zone of Uselessness: Unstable + Abstract (distance > 0.7 with high abstractness)
  if (metrics.distance > 0.7 && metrics.abstractness > 0.7 && metrics.instability > 0.7) {
    issues.push('Package is in the "Zone of Uselessness": abstract but unstable');
    suggestions.push('Either add implementations or stabilize by reducing outgoing dependencies');
  }

  // Low cohesion
  if (metrics.cohesion < 0.1 && metrics.files.length > 3) {
    issues.push('Low cohesion: components within package are loosely related');
    suggestions.push('Consider splitting into smaller, more focused packages');
  }

  // High coupling
  if (metrics.ce > 10) {
    issues.push(`High efferent coupling: depends on ${metrics.ce} external packages`);
    suggestions.push('Consider reducing dependencies or adding abstraction layers');
  }

  const health = issues.length === 0 ? 'healthy'
    : issues.length <= 2 ? 'warning'
    : 'critical';

  return { health, issues, suggestions };
}

// ============================================================================
// SECRET DETECTION (Entropy-Based)
// ============================================================================

/**
 * A detected potential secret in code.
 */
export interface DetectedSecret {
  /** Truncated value (for safety) */
  value: string;
  /** Shannon entropy of the string */
  entropy: number;
  /** Line number where found */
  line: number;
  /** Type of secret detected */
  type: SecretType;
  /** Confidence that this is a real secret (0-1) */
  confidence: number;
}

/**
 * Types of secrets that can be detected.
 */
export type SecretType =
  | 'api_key'
  | 'aws_key'
  | 'github_token'
  | 'slack_token'
  | 'generic_secret'
  | 'private_key'
  | 'password'
  | 'base64_secret'
  | 'hex_secret';

/**
 * Known secret patterns with their characteristics.
 */
const SECRET_PATTERNS: Array<{
  type: SecretType;
  pattern: RegExp;
  minEntropy: number;
  confidence: number;
}> = [
  // AWS Keys
  { type: 'aws_key', pattern: /^AKIA[A-Z0-9]{16}$/, minEntropy: 3.5, confidence: 0.95 },
  // GitHub tokens
  { type: 'github_token', pattern: /^gh[pous]_[A-Za-z0-9]{36,}$/, minEntropy: 4.0, confidence: 0.95 },
  // Slack tokens
  { type: 'slack_token', pattern: /^xox[baprs]-[A-Za-z0-9-]+$/, minEntropy: 4.0, confidence: 0.90 },
  // Generic API keys (with optional environment suffix like live_, test_)
  { type: 'api_key', pattern: /^(sk_|pk_|api_|key_)(live_|test_|prod_)?[A-Za-z0-9]{16,}$/i, minEntropy: 4.0, confidence: 0.85 },
  // Base64-like secrets (long)
  { type: 'base64_secret', pattern: /^[A-Za-z0-9+/=]{40,}$/, minEntropy: 4.5, confidence: 0.70 },
  // Hex strings (likely hashes or keys)
  { type: 'hex_secret', pattern: /^[A-Fa-f0-9]{32,}$/, minEntropy: 3.8, confidence: 0.65 },
  // Private key markers
  { type: 'private_key', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, minEntropy: 0, confidence: 0.99 },
  // Password assignments
  { type: 'password', pattern: /^[A-Za-z0-9!@#$%^&*()]{12,}$/, minEntropy: 3.5, confidence: 0.50 },
];

/**
 * Calculate Shannon entropy of a string.
 *
 * Higher entropy indicates more randomness, which is characteristic
 * of secrets, keys, and tokens.
 *
 * @param str - String to analyze
 * @returns Entropy value (bits per character)
 *
 * @example
 * ```typescript
 * calculateEntropy('password123'); // ~2.8 (low entropy)
 * calculateEntropy('aB3$kL9@mN2#'); // ~4.2 (high entropy)
 * ```
 */
export function calculateEntropy(str: string): number {
  if (str.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if a string looks like a secret based on patterns.
 *
 * @param value - String to check
 * @returns Type of secret if matched, null otherwise
 */
export function classifySecret(value: string): { type: SecretType; confidence: number } | null {
  for (const { type, pattern, minEntropy, confidence } of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      const entropy = calculateEntropy(value);
      if (entropy >= minEntropy) {
        return { type, confidence };
      }
    }
  }
  return null;
}

/**
 * Detect high-entropy strings that may be secrets.
 *
 * Scans code for string literals and identifies potential secrets
 * based on:
 * - Shannon entropy (randomness measure)
 * - Known secret patterns (API keys, tokens, etc.)
 * - String length and character distribution
 *
 * @param code - Source code to scan
 * @param options - Detection options
 * @returns Array of detected potential secrets
 *
 * @example
 * ```typescript
 * const code = `
 *   const apiKey = "sk_liveX_abc123xyz789def456";
 *   const password = "secret123";
 * `;
 * const secrets = detectHighEntropyStrings(code);
 * // Returns: [{ value: 'sk_liveX_abc123xyz...', entropy: 4.2, line: 2, type: 'api_key' }]
 * ```
 */
export function detectHighEntropyStrings(
  code: string,
  options: {
    minLength?: number;
    maxLength?: number;
    entropyThreshold?: number;
  } = {}
): DetectedSecret[] {
  const {
    minLength = 16,
    maxLength = 100,
    entropyThreshold = 4.0
  } = options;

  const secrets: DetectedSecret[] = [];
  const lines = code.split('\n');

  // Patterns for string literals (single, double, and backtick quotes)
  const stringPatterns = [
    /(['"`])([^'"`\n\\]|\\.){16,100}\1/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
      continue;
    }

    for (const pattern of stringPatterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(line)) !== null) {
        const fullMatch = match[0];
        // Extract the string content (without quotes)
        const value = fullMatch.slice(1, -1);

        if (value.length < minLength || value.length > maxLength) {
          continue;
        }

        const entropy = calculateEntropy(value);

        // Check against known patterns first
        const classified = classifySecret(value);
        if (classified) {
          secrets.push({
            value: value.slice(0, 20) + '...',
            entropy,
            line: i + 1,
            type: classified.type,
            confidence: classified.confidence,
          });
          continue;
        }

        // High entropy check for generic secrets
        if (entropy > entropyThreshold && looksLikeSecret(value)) {
          secrets.push({
            value: value.slice(0, 20) + '...',
            entropy,
            line: i + 1,
            type: 'generic_secret',
            confidence: Math.min(0.9, (entropy - 3.5) / 2), // Scale confidence by entropy
          });
        }
      }
    }
  }

  return secrets;
}

/**
 * Additional heuristics to check if a string looks like a secret.
 */
function looksLikeSecret(value: string): boolean {
  // Skip obvious non-secrets
  if (value.includes(' ') || value.includes('\t')) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  if (value.startsWith('/') && value.includes('.')) return false; // File paths
  if (/^\d+$/.test(value)) return false; // Pure numbers

  // Common secret indicators
  const secretIndicators = [
    // Contains mixed case, numbers, and special chars
    /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value),
    // Has known prefix
    /^(sk_|pk_|api_|key_|token_|secret_|auth_)/i.test(value),
    // Looks like base64
    /^[A-Za-z0-9+/=]{32,}$/.test(value),
    // Looks like hex
    /^[A-Fa-f0-9]{32,}$/.test(value),
  ];

  return secretIndicators.some(Boolean);
}

/**
 * Scan multiple files for secrets.
 *
 * @param files - Map of file path to content
 * @returns Array of secrets with file information
 */
export function scanFilesForSecrets(
  files: Map<string, string>
): Array<DetectedSecret & { file: string }> {
  const allSecrets: Array<DetectedSecret & { file: string }> = [];

  for (const [filePath, content] of files) {
    // Skip binary files, node_modules, etc.
    if (filePath.includes('node_modules/')) continue;
    if (filePath.endsWith('.min.js') || filePath.endsWith('.bundle.js')) continue;

    const secrets = detectHighEntropyStrings(content);
    for (const secret of secrets) {
      allSecrets.push({ ...secret, file: filePath });
    }
  }

  return allSecrets;
}

/**
 * Generate a security report from detected secrets.
 *
 * @param secrets - Detected secrets
 * @returns Formatted report
 */
export function generateSecretReport(
  secrets: Array<DetectedSecret & { file: string }>
): string {
  if (secrets.length === 0) {
    return 'No potential secrets detected.';
  }

  const lines: string[] = [
    '# Secret Detection Report',
    '',
    `Found ${secrets.length} potential secret(s):`,
    '',
  ];

  // Group by type
  const byType = new Map<SecretType, Array<DetectedSecret & { file: string }>>();
  for (const secret of secrets) {
    if (!byType.has(secret.type)) {
      byType.set(secret.type, []);
    }
    byType.get(secret.type)!.push(secret);
  }

  for (const [type, typeSecrets] of byType) {
    lines.push(`## ${type.toUpperCase()} (${typeSecrets.length})`);
    lines.push('');

    for (const secret of typeSecrets) {
      lines.push(`- **${secret.file}:${secret.line}**`);
      lines.push(`  - Value: \`${secret.value}\``);
      lines.push(`  - Entropy: ${secret.entropy.toFixed(2)}`);
      lines.push(`  - Confidence: ${(secret.confidence * 100).toFixed(0)}%`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('**Recommendations:**');
  lines.push('- Review each finding manually');
  lines.push('- Move secrets to environment variables or secret management');
  lines.push('- Add detected patterns to `.gitignore` or pre-commit hooks');

  return lines.join('\n');
}
