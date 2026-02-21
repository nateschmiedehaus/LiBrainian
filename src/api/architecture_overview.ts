/**
 * @fileoverview Architecture Overview Module
 *
 * Handles architecture-related queries like "architecture layers", "module structure",
 * "system architecture overview". Infers architecture layers from directory structure
 * and module dependencies when explicit architecture documentation is not available.
 */

import type { ContextPack, LibrarianVersion, ContextPackType, DirectoryKnowledge, GraphEdge } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';

// ============================================================================
// ARCHITECTURE QUERY DETECTION
// ============================================================================

/**
 * Patterns that indicate an ARCHITECTURE-LEVEL query about system structure.
 * These queries need information about layers, modules, and their relationships.
 * Examples: "architecture layers", "module structure", "system dependencies"
 */
export const ARCHITECTURE_QUERY_PATTERNS = [
  /\bhow\s+does\s+(?:this|the)\s+(?:project|codebase|system)\s+work\b/i,
  /\barchitecture\s+(layers?|structure|overview|diagram|map)\b/i,
  /\bmain\s+layers?\s+of\b/i,
  /\bsystem\s+architecture\b/i,
  /\bmodule\s+(dependencies|structure|organization|layout)\b/i,
  /\bseparation\s+of\s+concerns\b/i,
  /\blayer(s|ed)?\s+(structure|architecture|organization)\b/i,
  /\bhow\s+(is|are)\s+(the\s+)?(code|modules?|project)\s+organized\b/i,
  /\bcode\s+(organization|structure|layout)\b/i,
  /\bwhat\s+are\s+the\s+(main\s+)?(modules?|components?|layers?)\b/i,
  /\bdirectory\s+structure\b/i,
  /\bfolder\s+structure\b/i,
  /\bhigh[- ]?level\s+(structure|design|architecture)\b/i,
];

/**
 * Detects if a query is asking about architecture/system structure.
 */
export function isArchitectureQuery(intent: string): boolean {
  return ARCHITECTURE_QUERY_PATTERNS.some(pattern => pattern.test(intent));
}

// ============================================================================
// ARCHITECTURE LAYER INFERENCE
// ============================================================================

/**
 * Represents an inferred architecture layer.
 */
export interface ArchitectureLayer {
  /** Layer name */
  name: string;
  /** Layer type/category */
  type: 'interface' | 'application' | 'domain' | 'data' | 'infrastructure' | 'analysis' | 'utility' | 'other';
  /** Directories that belong to this layer */
  directories: string[];
  /** Key modules in this layer */
  modules: string[];
  /** Purpose description */
  purpose: string;
  /** Dependencies on other layers */
  dependsOn: string[];
}

/**
 * Layer type mappings based on common directory naming conventions.
 * Maps directory names/patterns to their likely architecture layer type.
 */
const LAYER_TYPE_MAPPINGS: Record<string, { type: ArchitectureLayer['type']; purpose: string }> = {
  // Interface layer - entry points and external APIs
  'cli': { type: 'interface', purpose: 'Command-line interface and user interaction' },
  'api': { type: 'application', purpose: 'Application layer handling requests and orchestrating domain logic' },
  'routes': { type: 'interface', purpose: 'HTTP routing and request handling' },
  'controllers': { type: 'interface', purpose: 'Request controllers and response handling' },
  'handlers': { type: 'interface', purpose: 'Event and request handlers' },
  'web': { type: 'interface', purpose: 'Web interface and presentation' },
  'views': { type: 'interface', purpose: 'View layer and presentation logic' },
  'ui': { type: 'interface', purpose: 'User interface components' },

  // Application layer - orchestration and use cases
  'services': { type: 'application', purpose: 'Application services and use case implementations' },
  'usecases': { type: 'application', purpose: 'Use case implementations' },
  'use-cases': { type: 'application', purpose: 'Use case implementations' },
  'application': { type: 'application', purpose: 'Application layer orchestration' },

  // Domain layer - business logic
  'domain': { type: 'domain', purpose: 'Domain models and business logic' },
  'models': { type: 'domain', purpose: 'Domain models and entities' },
  'entities': { type: 'domain', purpose: 'Domain entities' },
  'core': { type: 'domain', purpose: 'Core domain logic' },
  'knowledge': { type: 'domain', purpose: 'Knowledge domain and patterns' },
  'constructions': { type: 'domain', purpose: 'Domain constructions and compositions' },

  // Data layer - persistence
  'storage': { type: 'data', purpose: 'Data persistence and storage abstraction' },
  'database': { type: 'data', purpose: 'Database access and queries' },
  'repositories': { type: 'data', purpose: 'Repository pattern implementations' },
  'persistence': { type: 'data', purpose: 'Data persistence layer' },
  'data': { type: 'data', purpose: 'Data access layer' },

  // Infrastructure layer - external concerns
  'infrastructure': { type: 'infrastructure', purpose: 'Infrastructure concerns and external integrations' },
  'adapters': { type: 'infrastructure', purpose: 'Adapters for external systems' },
  'integrations': { type: 'infrastructure', purpose: 'External system integrations' },
  'providers': { type: 'infrastructure', purpose: 'Service providers and external APIs' },
  'config': { type: 'infrastructure', purpose: 'Configuration management' },

  // Analysis layer - metrics and insights
  'graphs': { type: 'analysis', purpose: 'Graph analysis and metrics computation' },
  'analysis': { type: 'analysis', purpose: 'Code analysis and metrics' },
  'metrics': { type: 'analysis', purpose: 'Metrics collection and reporting' },
  'evaluation': { type: 'analysis', purpose: 'Evaluation and quality assessment' },

  // Utility layer - shared utilities
  'utils': { type: 'utility', purpose: 'Shared utility functions' },
  'utilities': { type: 'utility', purpose: 'Shared utility functions' },
  'helpers': { type: 'utility', purpose: 'Helper functions and utilities' },
  'lib': { type: 'utility', purpose: 'Shared library code' },
  'common': { type: 'utility', purpose: 'Common shared code' },
  'shared': { type: 'utility', purpose: 'Shared code across modules' },
};

/**
 * Infers architecture layers from directory structure and dependencies.
 */
export async function inferArchitectureLayers(
  storage: LibrarianStorage,
  workspaceRoot: string
): Promise<ArchitectureLayer[]> {
  // Get top-level directories (depth 1 = direct children of src/)
  const directories = await storage.getDirectories({ maxDepth: 2, minDepth: 1 });

  // Get import edges to understand dependencies
  const importEdges = await storage.getGraphEdges({ edgeTypes: ['imports'] });

  // Build layer map from directories
  const layers = new Map<string, ArchitectureLayer>();

  for (const dir of directories) {
    const dirName = dir.name.toLowerCase();
    const mapping = LAYER_TYPE_MAPPINGS[dirName];

    if (mapping) {
      // Use predefined mapping
      const layer: ArchitectureLayer = {
        name: dir.name,
        type: mapping.type,
        directories: [dir.relativePath],
        modules: dir.mainFiles.filter(f => f.endsWith('.ts') || f.endsWith('.js')),
        purpose: dir.purpose || mapping.purpose,
        dependsOn: [],
      };
      layers.set(dir.name, layer);
    } else if (dir.role === 'layer') {
      // Directory explicitly marked as a layer
      const layer: ArchitectureLayer = {
        name: dir.name,
        type: 'other',
        directories: [dir.relativePath],
        modules: dir.mainFiles.filter(f => f.endsWith('.ts') || f.endsWith('.js')),
        purpose: dir.purpose || dir.description,
        dependsOn: [],
      };
      layers.set(dir.name, layer);
    } else if (dir.depth === 1 && dirName !== '__tests__' && dirName !== 'test' && dirName !== 'tests' && dirName !== 'node_modules' && dirName !== 'dist' && dirName !== 'build') {
      // Include other top-level directories that aren't tests or build artifacts
      const layer: ArchitectureLayer = {
        name: dir.name,
        type: 'other',
        directories: [dir.relativePath],
        modules: dir.mainFiles.filter(f => f.endsWith('.ts') || f.endsWith('.js')),
        purpose: dir.purpose || `${dir.name} module`,
        dependsOn: [],
      };
      layers.set(dir.name, layer);
    }
  }

  // Infer dependencies from import edges
  const layerDependencies = inferLayerDependencies(importEdges, layers);

  // Apply inferred dependencies
  for (const [layerName, deps] of Array.from(layerDependencies.entries())) {
    const layer = layers.get(layerName);
    if (layer) {
      layer.dependsOn = deps;
    }
  }

  // Sort layers by type (interface -> application -> domain -> data -> infrastructure -> analysis -> utility -> other)
  const typeOrder: Record<ArchitectureLayer['type'], number> = {
    'interface': 0,
    'application': 1,
    'domain': 2,
    'data': 3,
    'infrastructure': 4,
    'analysis': 5,
    'utility': 6,
    'other': 7,
  };

  return Array.from(layers.values()).sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
}

/**
 * Infers dependencies between layers from import edges.
 */
function inferLayerDependencies(
  edges: GraphEdge[],
  layers: Map<string, ArchitectureLayer>
): Map<string, string[]> {
  const dependencies = new Map<string, Set<string>>();

  // Initialize dependency sets for each layer
  for (const layerName of Array.from(layers.keys())) {
    dependencies.set(layerName, new Set());
  }

  for (const edge of edges) {
    // Extract layer from source and target paths
    const sourceLayer = extractLayerFromPath(edge.fromId);
    const targetLayer = extractLayerFromPath(edge.toId);

    if (sourceLayer && targetLayer && sourceLayer !== targetLayer) {
      const sourceDeps = dependencies.get(sourceLayer);
      if (sourceDeps && layers.has(targetLayer)) {
        sourceDeps.add(targetLayer);
      }
    }
  }

  // Convert Sets to arrays
  const result = new Map<string, string[]>();
  for (const [layer, deps] of Array.from(dependencies.entries())) {
    result.set(layer, Array.from(deps));
  }

  return result;
}

/**
 * Extracts the top-level layer name from a file path.
 */
function extractLayerFromPath(path: string): string | null {
  // Handle paths like "src/api/query.ts" -> "api"
  // or "api/query.ts" -> "api"
  const parts = path.split('/');

  // Skip 'src' if it's the first part
  const startIndex = parts[0] === 'src' ? 1 : 0;

  if (parts.length > startIndex) {
    return parts[startIndex];
  }

  return null;
}

// ============================================================================
// ARCHITECTURE OVERVIEW GENERATION
// ============================================================================

/**
 * Options for generating architecture overview.
 */
export interface ArchitectureOverviewOptions {
  /** Include dependency information */
  includeDependencies?: boolean;
  /** Maximum layers to include */
  maxLayers?: number;
}

/**
 * Generates a structured architecture overview context pack.
 */
export async function generateArchitectureOverview(
  storage: LibrarianStorage,
  workspaceRoot: string,
  version: LibrarianVersion,
  options: ArchitectureOverviewOptions = {}
): Promise<ContextPack> {
  const { includeDependencies = true, maxLayers = 10 } = options;

  // Infer architecture layers
  const layers = await inferArchitectureLayers(storage, workspaceRoot);
  const displayLayers = layers.slice(0, maxLayers);

  // Build summary
  const layerNames = displayLayers.map(l => l.name);
  const summary = displayLayers.length > 0
    ? `Architecture has ${displayLayers.length} main layers: ${layerNames.join(', ')}`
    : 'No architecture layers detected. Consider organizing code into layers like api/, storage/, domain/.';

  // Build key facts
  const keyFacts: string[] = [];

  // Add layer descriptions
  for (const layer of displayLayers) {
    const moduleList = layer.modules.slice(0, 3).join(', ');
    const moduleCount = layer.modules.length;
    const moduleInfo = moduleCount > 0
      ? ` (${moduleCount} modules: ${moduleList}${moduleCount > 3 ? '...' : ''})`
      : '';
    keyFacts.push(`${layer.name}/ [${layer.type}]: ${layer.purpose}${moduleInfo}`);
  }

  // Add dependency information
  if (includeDependencies) {
    const depsWithDependencies = displayLayers.filter(l => l.dependsOn.length > 0);
    if (depsWithDependencies.length > 0) {
      keyFacts.push('--- Layer Dependencies ---');
      for (const layer of depsWithDependencies.slice(0, 5)) {
        keyFacts.push(`${layer.name}/ depends on: ${layer.dependsOn.join(', ')}`);
      }
    }
  }

  // Calculate confidence based on how much structure was detected
  let confidence = 0.5; // Base confidence
  if (layers.length > 0) {
    confidence += 0.1 * Math.min(layers.length, 5); // Up to 0.5 for having layers

    // Bonus for having recognized layer types
    const recognizedLayers = layers.filter(l => l.type !== 'other').length;
    confidence += 0.05 * Math.min(recognizedLayers, 4); // Up to 0.2 for recognized types

    // Bonus for having dependencies mapped
    const layersWithDeps = layers.filter(l => l.dependsOn.length > 0).length;
    if (layersWithDeps > 0) {
      confidence += 0.1;
    }
  }
  confidence = Math.min(0.9, confidence); // Cap at 0.9

  return {
    packId: 'architecture:overview',
    packType: 'architecture_overview' as ContextPackType,
    targetId: 'architecture:layers',
    summary,
    keyFacts,
    codeSnippets: [],
    relatedFiles: displayLayers.flatMap(l => l.directories),
    confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: displayLayers.flatMap(l => l.directories.map(d => `${d}/*`)),
  };
}

// ============================================================================
// ARCHITECTURE QUERY HANDLER
// ============================================================================

/**
 * Handles an architecture query by generating structured architecture information.
 */
export async function handleArchitectureQuery(
  storage: LibrarianStorage,
  workspaceRoot: string,
  existingPacks: ContextPack[],
  version: LibrarianVersion
): Promise<ContextPack[]> {
  // Generate architecture overview
  const architecturePack = await generateArchitectureOverview(storage, workspaceRoot, version);

  // Prepend architecture pack to existing packs
  const result = [architecturePack, ...existingPacks];

  // Filter out low-confidence packs that might confuse the response
  return result.filter(pack => pack.confidence >= 0.3);
}
