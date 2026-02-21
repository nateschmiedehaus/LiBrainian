/**
 * @fileoverview Domain Registry with Adaptive Freshness
 *
 * Manages knowledge domains with:
 * 1. Built-in domains loaded from config
 * 2. Custom domains per-codebase
 * 3. Adaptive freshness based on access patterns
 * 4. Domain discovery from query patterns
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Result, Ok, Err, safeAsync, safeJsonParse, getResultErrorMessage } from '../../core/result.js';
import { ConfigurationError } from '../../core/errors.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DomainDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly extractors: string[];
  readonly defaultStalenessMs: number;
  readonly priority: number;
  readonly isBuiltIn: boolean;
  readonly isCustom: boolean;
  readonly isInferred: boolean;
}

export interface DomainConfig {
  id: string;
  name: string;
  description?: string;
  extractors?: string[];
  stalenessMs?: number;
  priority?: number;
}

interface AccessRecord {
  timestamps: number[];
  maxSize: number;
}

// ============================================================================
// BUILT-IN DOMAINS
// ============================================================================

const BUILT_IN_DOMAINS: DomainDefinition[] = [
  {
    id: 'identity',
    name: 'Identity',
    description: 'What is this entity? Name, path, type, language, framework',
    extractors: ['ast_indexer', 'framework_detector'],
    defaultStalenessMs: 0, // Always fresh
    priority: 100,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'semantics',
    name: 'Semantics',
    description: 'What does it do? Purpose, behavior, contracts, side effects',
    extractors: ['semantic_extractor', 'llm_summarizer'],
    defaultStalenessMs: 3600000, // 1 hour
    priority: 90,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'structure',
    name: 'Structure',
    description: 'How is it organized? Complexity, patterns, shape, size',
    extractors: ['ast_indexer', 'complexity_analyzer'],
    defaultStalenessMs: 0, // Always fresh
    priority: 85,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'relationships',
    name: 'Relationships',
    description: 'How does it connect? Dependencies, dependents, data flows',
    extractors: ['call_edge_extractor', 'import_analyzer'],
    defaultStalenessMs: 60000, // 1 minute
    priority: 80,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'history',
    name: 'History',
    description: 'How has it evolved? Age, change frequency, stability, authors',
    extractors: ['commit_indexer', 'git_analyzer'],
    defaultStalenessMs: 300000, // 5 minutes
    priority: 70,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'ownership',
    name: 'Ownership',
    description: 'Who is responsible? Team, experts, reviewers, SLA',
    extractors: ['ownership_indexer', 'codeowners_parser'],
    defaultStalenessMs: 86400000, // 1 day
    priority: 60,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'risk',
    name: 'Risk',
    description: 'What could go wrong? Complexity risk, change risk, security risk',
    extractors: ['risk_analyzer', 'complexity_analyzer'],
    defaultStalenessMs: 3600000, // 1 hour
    priority: 75,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'testing',
    name: 'Testing',
    description: 'How is it verified? Coverage, strategies, fixtures, mocks',
    extractors: ['test_indexer', 'coverage_analyzer'],
    defaultStalenessMs: 600000, // 10 minutes
    priority: 65,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'security',
    name: 'Security',
    description: 'What are the threats? Attack surface, sensitive data, auth boundaries',
    extractors: ['security_indexer', 'vulnerability_scanner'],
    defaultStalenessMs: 3600000, // 1 hour
    priority: 85,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'rationale',
    name: 'Rationale',
    description: 'Why does it exist? Design decisions, constraints, trade-offs',
    extractors: ['adr_indexer', 'comment_analyzer'],
    defaultStalenessMs: 86400000, // 1 day
    priority: 50,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'tribal',
    name: 'Tribal',
    description: "What's undocumented? Conventions, gotchas, tips, history",
    extractors: ['tribal_extractor', 'llm_analyzer'],
    defaultStalenessMs: 604800000, // 1 week
    priority: 40,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
  {
    id: 'quality',
    name: 'Quality',
    description: 'How healthy is it? Tech debt, code smells, improvement opportunities',
    extractors: ['quality_analyzer', 'lint_runner'],
    defaultStalenessMs: 86400000, // 1 day
    priority: 55,
    isBuiltIn: true,
    isCustom: false,
    isInferred: false,
  },
];

// ============================================================================
// DOMAIN REGISTRY
// ============================================================================

export class DomainRegistry {
  private domains = new Map<string, DomainDefinition>();
  private accessPatterns = new Map<string, AccessRecord>();
  private adaptiveStaleness = new Map<string, number>();
  private queryPatterns = new Map<string, { count: number; lastSeen: number; terms: Set<string> }>();

  constructor() {
    // Load built-in domains
    for (const domain of BUILT_IN_DOMAINS) {
      this.domains.set(domain.id, domain);
    }
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register a domain
   */
  register(domain: DomainDefinition): void {
    this.domains.set(domain.id, domain);
  }

  /**
   * Load custom domains from a codebase config file
   */
  async loadCodebaseDomains(repoRoot: string): Promise<Result<number, ConfigurationError>> {
    const configPath = path.join(repoRoot, '.librainian', 'domains.yaml');

    // Check if config exists
    const configResult = await safeAsync(() => fs.readFile(configPath, 'utf-8'));
    if (!configResult.ok) {
      // No config file is fine
      return Ok(0);
    }

    // Parse YAML (simple key: value format for now)
    const parseResult = this.parseSimpleYaml(configResult.value);
    if (!parseResult.ok) {
      const message = getResultErrorMessage(parseResult) || 'invalid domains.yaml';
      return Err(new ConfigurationError('domains.yaml', message));
    }

    const configs = parseResult.value;
    let loaded = 0;

    for (const config of configs) {
      const domain: DomainDefinition = {
        id: config.id,
        name: config.name,
        description: config.description ?? '',
        extractors: config.extractors ?? [],
        defaultStalenessMs: config.stalenessMs ?? 3600000,
        priority: config.priority ?? 50,
        isBuiltIn: false,
        isCustom: true,
        isInferred: false,
      };

      this.register(domain);
      loaded++;
    }

    return Ok(loaded);
  }

  /**
   * Simple YAML parser for domain configs
   */
  private parseSimpleYaml(content: string): Result<DomainConfig[], Error> {
    try {
      const configs: DomainConfig[] = [];
      let currentConfig: Partial<DomainConfig> | null = null;

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Check for list item start
        if (trimmed.startsWith('- id:')) {
          if (currentConfig && currentConfig.id) {
            configs.push(currentConfig as DomainConfig);
          }
          currentConfig = { id: trimmed.replace('- id:', '').trim() };
          continue;
        }

        if (currentConfig) {
          const match = trimmed.match(/^(\w+):\s*(.*)$/);
          if (match) {
            const [, key, value] = match;
            if (key === 'name') currentConfig.name = value;
            if (key === 'description') currentConfig.description = value;
            if (key === 'stalenessMs') currentConfig.stalenessMs = parseInt(value, 10);
            if (key === 'priority') currentConfig.priority = parseInt(value, 10);
          }
        }
      }

      // Don't forget the last config
      if (currentConfig && currentConfig.id) {
        configs.push(currentConfig as DomainConfig);
      }

      return Ok(configs);
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ============================================================================
  // ACCESS
  // ============================================================================

  /**
   * Get a domain by ID
   */
  get(id: string): DomainDefinition | undefined {
    return this.domains.get(id);
  }

  /**
   * Get all registered domains
   */
  getAll(): DomainDefinition[] {
    return Array.from(this.domains.values());
  }

  /**
   * Get domains sorted by priority
   */
  getByPriority(): DomainDefinition[] {
    return this.getAll().sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a domain exists
   */
  has(id: string): boolean {
    return this.domains.has(id);
  }

  // ============================================================================
  // ADAPTIVE FRESHNESS
  // ============================================================================

  /**
   * Record an access to a domain (for adaptive staleness)
   */
  recordAccess(domainId: string): void {
    let record = this.accessPatterns.get(domainId);
    if (!record) {
      record = { timestamps: [], maxSize: 1000 };
      this.accessPatterns.set(domainId, record);
    }

    record.timestamps.push(Date.now());

    // Keep only recent timestamps
    if (record.timestamps.length > record.maxSize) {
      record.timestamps = record.timestamps.slice(-record.maxSize);
    }
  }

  /**
   * Get effective staleness for a domain (adapts based on access patterns)
   */
  getEffectiveStaleness(domainId: string): number {
    const domain = this.domains.get(domainId);
    if (!domain) {
      return 3600000; // Default 1 hour
    }

    const base = domain.defaultStalenessMs;

    // If staleness is 0, it's always fresh - don't adapt
    if (base === 0) {
      return 0;
    }

    const record = this.accessPatterns.get(domainId);
    if (!record || record.timestamps.length < 10) {
      return base; // Not enough data to adapt
    }

    // Count recent accesses (last 5 minutes)
    const now = Date.now();
    const recentWindow = 300000; // 5 minutes
    const recentAccesses = record.timestamps.filter(t => now - t < recentWindow).length;

    // Adapt based on access frequency
    if (recentAccesses > 20) {
      // Very hot domain - reduce staleness to 25% of base (min 30 seconds)
      return Math.max(base / 4, 30000);
    }
    if (recentAccesses > 10) {
      // Hot domain - reduce staleness to 50% of base
      return Math.max(base / 2, 60000);
    }
    if (recentAccesses > 5) {
      // Warm domain - reduce staleness to 75% of base
      return Math.max(base * 0.75, 60000);
    }

    // Cool domain - use default
    return base;
  }

  /**
   * Get access statistics for a domain
   */
  getAccessStats(domainId: string): {
    totalAccesses: number;
    recentAccesses: number;
    effectiveStalenessMs: number;
  } {
    const record = this.accessPatterns.get(domainId);
    const now = Date.now();

    return {
      totalAccesses: record?.timestamps.length ?? 0,
      recentAccesses: record?.timestamps.filter(t => now - t < 300000).length ?? 0,
      effectiveStalenessMs: this.getEffectiveStaleness(domainId),
    };
  }

  // ============================================================================
  // DOMAIN DISCOVERY
  // ============================================================================

  /**
   * Record a query pattern (for domain discovery)
   */
  recordQueryPattern(queryTerms: string[], matchedDomains: string[]): void {
    // If query matched few domains, it might indicate a missing domain
    if (matchedDomains.length >= 2) {
      return; // Query was well-served
    }

    const patternKey = queryTerms.sort().join('|');
    let pattern = this.queryPatterns.get(patternKey);

    if (!pattern) {
      pattern = { count: 0, lastSeen: 0, terms: new Set(queryTerms) };
      this.queryPatterns.set(patternKey, pattern);
    }

    pattern.count++;
    pattern.lastSeen = Date.now();
  }

  /**
   * Discover potential new domains from query patterns
   */
  discoverDomains(): DomainDefinition[] {
    const discovered: DomainDefinition[] = [];
    const minCount = 5; // Require at least 5 queries
    const maxAge = 86400000; // Consider patterns from last 24 hours
    const now = Date.now();

    for (const [key, pattern] of this.queryPatterns) {
      // Skip if not frequent enough or too old
      if (pattern.count < minCount || now - pattern.lastSeen > maxAge) {
        continue;
      }

      // Check if any existing domain covers these terms
      const terms = Array.from(pattern.terms);
      const covered = this.getAll().some(d =>
        terms.some(t =>
          d.name.toLowerCase().includes(t.toLowerCase()) ||
          d.description.toLowerCase().includes(t.toLowerCase())
        )
      );

      if (!covered) {
        // Suggest a new domain
        const suggestedName = this.generateDomainName(terms);
        discovered.push({
          id: `inferred:${key.replace(/\|/g, '_').slice(0, 30)}`,
          name: suggestedName,
          description: `Auto-discovered domain for queries about: ${terms.join(', ')}`,
          extractors: [],
          defaultStalenessMs: 3600000,
          priority: 30,
          isBuiltIn: false,
          isCustom: false,
          isInferred: true,
        });
      }
    }

    return discovered;
  }

  /**
   * Generate a domain name from query terms
   */
  private generateDomainName(terms: string[]): string {
    // Take first meaningful term and capitalize
    const term = terms.find(t => t.length > 3) ?? terms[0];
    return term.charAt(0).toUpperCase() + term.slice(1);
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Export registry state for persistence
   */
  toJSON(): {
    customDomains: DomainDefinition[];
    accessPatterns: Record<string, number[]>;
  } {
    return {
      customDomains: this.getAll().filter(d => d.isCustom || d.isInferred),
      accessPatterns: Object.fromEntries(
        Array.from(this.accessPatterns.entries())
          .map(([k, v]) => [k, v.timestamps.slice(-100)])
      ),
    };
  }

  /**
   * Import registry state
   */
  fromJSON(data: {
    customDomains?: DomainDefinition[];
    accessPatterns?: Record<string, number[]>;
  }): void {
    // Load custom domains
    if (data.customDomains) {
      for (const domain of data.customDomains) {
        this.register(domain);
      }
    }

    // Load access patterns
    if (data.accessPatterns) {
      for (const [domainId, timestamps] of Object.entries(data.accessPatterns)) {
        this.accessPatterns.set(domainId, {
          timestamps,
          maxSize: 1000,
        });
      }
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const domainRegistry = new DomainRegistry();
