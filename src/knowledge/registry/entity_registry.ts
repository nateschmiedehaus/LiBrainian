/**
 * @fileoverview Entity Registry with Pattern-Based Discovery
 *
 * Manages entity types with:
 * 1. Built-in types (file, function, class, etc.)
 * 2. Custom types from codebase config
 * 3. Pattern-based discovery of new types
 * 4. Co-change clustering for emergent entities
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Result, Ok, Err, safeAsync, getResultErrorMessage } from '../../core/result.js';
import { ConfigurationError } from '../../core/errors.js';
import { EntityType } from '../../core/contracts.js';

// ============================================================================
// TYPES
// ============================================================================

export type PatternType = 'directory' | 'naming' | 'import' | 'co-change' | 'semantic';

export interface EntityPattern {
  type: PatternType;
  pattern: string | RegExp;
  confidence: number;
}

export interface EntityTypeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parent?: string;
  readonly patterns: EntityPattern[];
  readonly isBuiltIn: boolean;
  readonly isDiscovered: boolean;
}

export interface FileInfo {
  path: string;
  name: string;
  directory: string;
  extension: string;
}

export interface DiscoveredEntity {
  id: string;
  type: string;
  name: string;
  files: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface NamingPattern {
  suffix: string;
  matches: string[];
  confidence: number;
}

interface CoChangeCluster {
  id: string;
  files: string[];
  cohesion: number;
  suggestedName: string;
}

// ============================================================================
// BUILT-IN ENTITY TYPES
// ============================================================================

const BUILT_IN_ENTITY_TYPES: EntityTypeDefinition[] = [
  // Explicit code entities
  {
    id: 'file',
    name: 'File',
    description: 'Source code file',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'function',
    name: 'Function',
    description: 'Function or method definition',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'class',
    name: 'Class',
    description: 'Class definition',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'method',
    name: 'Method',
    description: 'Method of a class',
    parent: 'class',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'interface',
    name: 'Interface',
    description: 'Interface definition',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'type',
    name: 'Type',
    description: 'Type alias definition',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'variable',
    name: 'Variable',
    description: 'Variable or constant declaration',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },

  // Structural entities
  {
    id: 'directory',
    name: 'Directory',
    description: 'Directory in the file system',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'module',
    name: 'Module',
    description: 'Module (directory with index/entry file)',
    patterns: [
      { type: 'directory', pattern: '**/*/index.ts', confidence: 0.9 },
      { type: 'directory', pattern: '**/*/index.js', confidence: 0.9 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'package',
    name: 'Package',
    description: 'Package (directory with package.json)',
    patterns: [
      { type: 'directory', pattern: '**/*/package.json', confidence: 0.95 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },

  // Emergent entities
  {
    id: 'component',
    name: 'Component',
    description: 'UI or service component',
    patterns: [
      { type: 'naming', pattern: /\.component\.(ts|tsx|js|jsx)$/i, confidence: 0.9 },
      { type: 'naming', pattern: /Component\.(ts|tsx|js|jsx)$/i, confidence: 0.85 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'service',
    name: 'Service',
    description: 'Service class or module',
    patterns: [
      { type: 'naming', pattern: /\.service\.(ts|js)$/i, confidence: 0.9 },
      { type: 'naming', pattern: /Service\.(ts|js)$/i, confidence: 0.85 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'controller',
    name: 'Controller',
    description: 'Controller class or module',
    patterns: [
      { type: 'naming', pattern: /\.controller\.(ts|js)$/i, confidence: 0.9 },
      { type: 'naming', pattern: /Controller\.(ts|js)$/i, confidence: 0.85 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'repository',
    name: 'Repository',
    description: 'Repository class or module',
    patterns: [
      { type: 'naming', pattern: /\.repository\.(ts|js)$/i, confidence: 0.9 },
      { type: 'naming', pattern: /Repository\.(ts|js)$/i, confidence: 0.85 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'test',
    name: 'Test',
    description: 'Test file',
    patterns: [
      { type: 'naming', pattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/i, confidence: 0.95 },
      { type: 'directory', pattern: '**/__tests__/**', confidence: 0.9 },
    ],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'subsystem',
    name: 'Subsystem',
    description: 'Group of related modules',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'system',
    name: 'System',
    description: 'Major functional area',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'layer',
    name: 'Layer',
    description: 'Architectural layer',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'domain',
    name: 'Domain',
    description: 'Business domain',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'feature',
    name: 'Feature',
    description: 'User-facing feature',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'workflow',
    name: 'Workflow',
    description: 'Business process',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'boundary',
    name: 'Boundary',
    description: 'Module boundary',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'hotspot',
    name: 'Hotspot',
    description: 'High-change area',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
  {
    id: 'debt_cluster',
    name: 'Debt Cluster',
    description: 'Tech debt concentration',
    patterns: [],
    isBuiltIn: true,
    isDiscovered: false,
  },
];

// ============================================================================
// ENTITY REGISTRY
// ============================================================================

export class EntityRegistry {
  private types = new Map<string, EntityTypeDefinition>();
  private discoveredEntities = new Map<string, DiscoveredEntity[]>();

  constructor() {
    // Load built-in types
    for (const type of BUILT_IN_ENTITY_TYPES) {
      this.types.set(type.id, type);
    }
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register an entity type
   */
  register(type: EntityTypeDefinition): void {
    this.types.set(type.id, type);
  }

  /**
   * Load custom entity types from codebase config
   */
  async loadCodebaseEntityTypes(repoRoot: string): Promise<Result<number, ConfigurationError>> {
    const configPath = path.join(repoRoot, '.librainian', 'entities.yaml');

    const configResult = await safeAsync(() => fs.readFile(configPath, 'utf-8'));
    if (!configResult.ok) {
      return Ok(0); // No config is fine
    }

    const parseResult = this.parseEntityConfig(configResult.value);
    if (!parseResult.ok) {
      const message = getResultErrorMessage(parseResult) || 'invalid entities.yaml';
      return Err(new ConfigurationError('entities.yaml', message));
    }

    let loaded = 0;
    for (const type of parseResult.value) {
      this.register(type);
      loaded++;
    }

    return Ok(loaded);
  }

  /**
   * Parse entity config YAML
   */
  private parseEntityConfig(content: string): Result<EntityTypeDefinition[], Error> {
    // Mutable builder type for constructing EntityTypeDefinition incrementally
    type EntityBuilder = {
      id?: string;
      name?: string;
      description?: string;
      parent?: string;
      patterns: EntityPattern[];
      isBuiltIn: boolean;
      isDiscovered: boolean;
    };

    try {
      const types: EntityTypeDefinition[] = [];
      let current: EntityBuilder | null = null;

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('- id:')) {
          if (current && current.id && current.name && current.description) {
            types.push({
              id: current.id,
              name: current.name,
              description: current.description,
              parent: current.parent,
              patterns: current.patterns,
              isBuiltIn: current.isBuiltIn,
              isDiscovered: current.isDiscovered,
            });
          }
          current = {
            id: trimmed.replace('- id:', '').trim(),
            patterns: [],
            isBuiltIn: false,
            isDiscovered: false,
          };
          continue;
        }

        if (current) {
          const match = trimmed.match(/^(\w+):\s*(.*)$/);
          if (match) {
            const [, key, value] = match;
            if (key === 'name') current.name = value;
            if (key === 'description') current.description = value;
            if (key === 'parent') current.parent = value;
          }
        }
      }

      if (current && current.id && current.name && current.description) {
        types.push({
          id: current.id,
          name: current.name,
          description: current.description,
          parent: current.parent,
          patterns: current.patterns,
          isBuiltIn: current.isBuiltIn,
          isDiscovered: current.isDiscovered,
        });
      }

      return Ok(types);
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ============================================================================
  // ACCESS
  // ============================================================================

  /**
   * Get an entity type by ID
   */
  get(id: string): EntityTypeDefinition | undefined {
    return this.types.get(id);
  }

  /**
   * Get all registered entity types
   */
  getAll(): EntityTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * Check if an entity type exists
   */
  has(id: string): boolean {
    return this.types.has(id);
  }

  /**
   * Get discovered entities of a type
   */
  getDiscoveredEntities(type: string): DiscoveredEntity[] {
    return this.discoveredEntities.get(type) ?? [];
  }

  // ============================================================================
  // ENTITY CLASSIFICATION
  // ============================================================================

  /**
   * Classify a file to its entity types based on patterns
   */
  classifyFile(file: FileInfo): Array<{ typeId: string; confidence: number }> {
    const matches: Array<{ typeId: string; confidence: number }> = [];

    for (const [typeId, type] of this.types) {
      for (const pattern of type.patterns) {
        if (this.matchesPattern(file, pattern)) {
          matches.push({ typeId, confidence: pattern.confidence });
          break; // One match per type is enough
        }
      }
    }

    // Sort by confidence
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check if a file matches a pattern
   */
  private matchesPattern(file: FileInfo, pattern: EntityPattern): boolean {
    const p = pattern.pattern;

    if (pattern.type === 'naming') {
      if (typeof p === 'string') {
        return file.path.endsWith(p) || file.name.endsWith(p);
      }
      if (p instanceof RegExp) {
        return p.test(file.path) || p.test(file.name);
      }
    }

    if (pattern.type === 'directory') {
      if (typeof p === 'string') {
        // Simple glob matching
        const globPattern = p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
        return new RegExp(globPattern).test(file.path);
      }
    }

    return false;
  }

  // ============================================================================
  // ENTITY DISCOVERY
  // ============================================================================

  /**
   * Discover new entity types from file patterns
   */
  discoverEntityTypes(files: FileInfo[]): EntityTypeDefinition[] {
    const discovered: EntityTypeDefinition[] = [];

    // 1. Find naming patterns
    const namingPatterns = this.findNamingPatterns(files);
    for (const pattern of namingPatterns) {
      if (pattern.matches.length >= 3 && pattern.confidence > 0.7) {
        // Check if this pattern is already covered
        const covered = Array.from(this.types.values()).some(t =>
          t.patterns.some(p =>
            p.type === 'naming' &&
            typeof p.pattern === 'string' &&
            p.pattern.includes(pattern.suffix)
          )
        );

        if (!covered) {
          discovered.push({
            id: `discovered:${pattern.suffix}`,
            name: this.suffixToName(pattern.suffix),
            description: `Auto-discovered from naming pattern: *.${pattern.suffix}.*`,
            patterns: [{
              type: 'naming',
              pattern: new RegExp(`\\.${pattern.suffix}\\.(ts|js|tsx|jsx)$`, 'i'),
              confidence: pattern.confidence,
            }],
            isBuiltIn: false,
            isDiscovered: true,
          });
        }
      }
    }

    return discovered;
  }

  /**
   * Find consistent naming patterns in files
   */
  private findNamingPatterns(files: FileInfo[]): NamingPattern[] {
    const suffixCounts = new Map<string, string[]>();

    for (const file of files) {
      // Match patterns like: name.suffix.ts, nameSuffix.ts
      const match = file.name.match(/\.([a-z]+)\.(ts|js|tsx|jsx)$/i);
      if (match) {
        const suffix = match[1].toLowerCase();
        const arr = suffixCounts.get(suffix) ?? [];
        arr.push(file.path);
        suffixCounts.set(suffix, arr);
      }
    }

    return Array.from(suffixCounts.entries())
      .filter(([_, files]) => files.length >= 3)
      .map(([suffix, matches]) => ({
        suffix,
        matches,
        confidence: Math.min(matches.length / 10, 0.95),
      }));
  }

  /**
   * Discover entities from co-change clusters
   */
  async discoverFromCoChange(
    clusters: CoChangeCluster[]
  ): Promise<DiscoveredEntity[]> {
    const discovered: DiscoveredEntity[] = [];

    for (const cluster of clusters) {
      if (cluster.files.length >= 3 && cluster.cohesion > 0.5) {
        discovered.push({
          id: `subsystem:${cluster.id}`,
          type: 'subsystem',
          name: cluster.suggestedName,
          files: cluster.files,
          confidence: cluster.cohesion,
          metadata: { discoveredFrom: 'co-change' },
        });
      }
    }

    // Store discovered entities
    const existing = this.discoveredEntities.get('subsystem') ?? [];
    this.discoveredEntities.set('subsystem', [...existing, ...discovered]);

    return discovered;
  }

  /**
   * Convert a suffix to a readable name
   */
  private suffixToName(suffix: string): string {
    return suffix.charAt(0).toUpperCase() + suffix.slice(1);
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Export registry state
   */
  toJSON(): {
    customTypes: EntityTypeDefinition[];
    discoveredEntities: Record<string, DiscoveredEntity[]>;
  } {
    return {
      customTypes: this.getAll().filter(t => !t.isBuiltIn),
      discoveredEntities: Object.fromEntries(this.discoveredEntities),
    };
  }

  /**
   * Import registry state
   */
  fromJSON(data: {
    customTypes?: EntityTypeDefinition[];
    discoveredEntities?: Record<string, DiscoveredEntity[]>;
  }): void {
    if (data.customTypes) {
      for (const type of data.customTypes) {
        this.register(type);
      }
    }

    if (data.discoveredEntities) {
      for (const [type, entities] of Object.entries(data.discoveredEntities)) {
        this.discoveredEntities.set(type, entities);
      }
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const entityRegistry = new EntityRegistry();
