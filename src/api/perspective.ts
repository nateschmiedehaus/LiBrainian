/**
 * @fileoverview Perspective-to-T-Pattern Mapping
 *
 * Maps query perspectives to relevant T-patterns for multi-view retrieval.
 * Research basis: docs/research/MULTI-PERSPECTIVE-VIEWS-RESEARCH.md
 *
 * Perspectives allow agents to request context from specific viewpoints:
 * - navigation: Focus on locating files/symbols/callers quickly
 * - debugging: Focus on error handling, call paths, test failures
 * - security: Focus on auth flows, input validation, secrets
 * - performance: Focus on complexity, async patterns, I/O
 * - architecture: Focus on dependencies, patterns, coupling
 * - modification: Focus on usage, breaking changes, similar patterns
 * - testing: Focus on coverage, gaps, assertions
 * - understanding: Focus on purpose, documentation, relationships
 */

import type { Perspective } from '../types.js';
import type { EmbeddableEntityType } from '../storage/types.js';
import type { SignalType } from '../query/multi_signal_scorer.js';

// ============================================================================
// PERSPECTIVE CONFIGURATION
// ============================================================================

/**
 * Configuration for a query perspective.
 * Defines which T-patterns to boost, entity type weights, and signal adjustments.
 */
export interface PerspectiveConfig {
  /** Perspective identifier */
  id: Perspective;

  /** Human-readable description */
  description: string;

  /** T-pattern IDs relevant to this perspective */
  tPatternIds: string[];

  /** T-pattern categories to boost */
  tPatternCategories: Array<'navigation' | 'understanding' | 'modification' | 'bug_investigation' | 'hard_scenarios'>;

  /** Entity type relevance weights (higher = more relevant) */
  entityTypeWeights: Record<EmbeddableEntityType, number>;

  /** Signal weight modifiers (multiplied with base weights) */
  signalModifiers: Partial<Record<SignalType, number>>;

  /** Keywords that boost results matching this perspective */
  boostKeywords: string[];

  /** Keywords that penalize results (opposite perspective) */
  penaltyKeywords: string[];

  /** Focus prompt for synthesis (when LLM is available) */
  focusPrompt: string;
}

// ============================================================================
// PERSPECTIVE CONFIGURATIONS
// ============================================================================

/**
 * Navigation perspective: Focus on finding code locations and relationships quickly.
 * Maps to navigation-heavy T-patterns.
 */
const NAVIGATION_PERSPECTIVE: PerspectiveConfig = {
  id: 'navigation',
  description: 'Code navigation and location discovery',
  tPatternIds: ['T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-16'],
  tPatternCategories: ['navigation'],
  entityTypeWeights: {
    function: 1.0,
    module: 1.0,
    document: 0.6,
  },
  signalModifiers: {
    semantic: 1.1,
    keyword: 1.2,
    structural: 1.4,
    dependency: 1.3,
    domain: 1.0,
    history: 0.8,
    risk: 0.5,
    test: 0.7,
  },
  boostKeywords: [
    'where', 'find', 'locate', 'file', 'module', 'path', 'entry', 'entrypoint',
    'import', 'export', 'caller', 'callers', 'reference', 'references', 'uses',
    'navigation',
  ],
  penaltyKeywords: [],
  focusPrompt: 'Focus on pinpointing where relevant code lives, how it is connected, and the fastest path to navigate it.',
};

/**
 * Debugging perspective: Focus on bug investigation patterns.
 * Maps to T-19 to T-24.
 */
const DEBUGGING_PERSPECTIVE: PerspectiveConfig = {
  id: 'debugging',
  description: 'Bug investigation and error diagnosis',
  tPatternIds: ['T-19', 'T-20', 'T-21', 'T-22', 'T-23', 'T-24', 'T-03', 'T-10', 'T-06'],
  tPatternCategories: ['bug_investigation', 'navigation'],
  entityTypeWeights: {
    function: 1.0,
    module: 0.7,
    document: 0.3,
  },
  signalModifiers: {
    semantic: 1.0,
    history: 1.3, // Boost co-change history (bugs cluster)
    risk: 1.5,    // Boost high-risk code
    test: 1.2,    // Test coverage matters for bugs
    recency: 1.2, // Recent changes often cause bugs
  },
  boostKeywords: [
    'error', 'bug', 'fix', 'exception', 'fail', 'crash', 'null', 'undefined',
    'race', 'deadlock', 'leak', 'timeout', 'retry', 'catch', 'throw', 'trace',
  ],
  penaltyKeywords: ['test', 'mock', 'stub', 'fixture', 'spec'],
  focusPrompt: 'Focus on error handling paths, exception propagation, and potential failure modes.',
};

/**
 * Security perspective: Focus on security vulnerability patterns.
 * Maps to T-27.
 */
const SECURITY_PERSPECTIVE: PerspectiveConfig = {
  id: 'security',
  description: 'Security vulnerability and trust boundary analysis',
  tPatternIds: ['T-27', 'T-10', 'T-11', 'T-12'],
  tPatternCategories: ['hard_scenarios', 'understanding'],
  entityTypeWeights: {
    function: 1.0,
    module: 0.8,
    document: 0.5, // Compliance docs can be relevant
  },
  signalModifiers: {
    semantic: 1.0,
    risk: 2.0,       // Strongly boost risky code
    domain: 1.3,     // Security domain relevance
    ownership: 0.8,  // Less important for security
    test: 0.9,
  },
  boostKeywords: [
    'auth', 'authentication', 'authorization', 'password', 'token', 'jwt',
    'secret', 'credential', 'encrypt', 'decrypt', 'hash', 'salt', 'validate',
    'sanitize', 'escape', 'inject', 'xss', 'csrf', 'sql', 'input', 'trust',
    'permission', 'role', 'access', 'session', 'cookie', 'https', 'tls',
  ],
  penaltyKeywords: ['test', 'mock', 'stub', 'example', 'demo'],
  focusPrompt: 'Focus on security implications, attack vectors, trust boundaries, and authentication/authorization flows.',
};

/**
 * Performance perspective: Focus on performance anti-patterns.
 * Maps to T-28.
 */
const PERFORMANCE_PERSPECTIVE: PerspectiveConfig = {
  id: 'performance',
  description: 'Performance optimization and anti-pattern detection',
  tPatternIds: ['T-28', 'T-12', 'T-11', 'T-21'],
  tPatternCategories: ['hard_scenarios', 'understanding'],
  entityTypeWeights: {
    function: 1.0,
    module: 0.6,
    document: 0.2,
  },
  signalModifiers: {
    semantic: 1.0,
    history: 1.2,    // Hotspots matter for perf
    risk: 1.3,       // High-risk often means high-impact
    structural: 1.2, // Proximity in hot paths
    test: 0.7,       // Less relevant for perf
  },
  boostKeywords: [
    'async', 'await', 'promise', 'loop', 'iterate', 'cache', 'memo',
    'batch', 'bulk', 'query', 'database', 'network', 'io', 'stream',
    'buffer', 'pool', 'concurrent', 'parallel', 'blocking', 'bottleneck',
    'latency', 'throughput', 'memory', 'allocation', 'garbage', 'leak',
  ],
  penaltyKeywords: ['test', 'mock', 'stub', 'fixture'],
  focusPrompt: 'Focus on performance bottlenecks, I/O patterns, caching opportunities, and algorithmic complexity.',
};

/**
 * Architecture perspective: Focus on design patterns and structure.
 * Maps to T-07, T-08, T-09, T-29.
 */
const ARCHITECTURE_PERSPECTIVE: PerspectiveConfig = {
  id: 'architecture',
  description: 'Architectural patterns, dependencies, and design decisions',
  tPatternIds: ['T-07', 'T-08', 'T-09', 'T-29', 'T-04', 'T-03'],
  tPatternCategories: ['understanding', 'hard_scenarios', 'navigation'],
  entityTypeWeights: {
    module: 1.0,  // Modules most relevant for architecture
    function: 0.6,
    document: 0.7, // ADRs and design docs
  },
  signalModifiers: {
    semantic: 1.0,
    structural: 1.5, // File/module structure very important
    dependency: 1.5, // Dependency graph critical
    domain: 1.2,     // Bounded contexts
    ownership: 1.1,  // Team boundaries
    risk: 0.8,
    test: 0.6,
  },
  boostKeywords: [
    'module', 'layer', 'boundary', 'interface', 'abstract', 'factory',
    'singleton', 'dependency', 'inject', 'import', 'export', 'api',
    'facade', 'adapter', 'proxy', 'decorator', 'pattern', 'architecture',
    'domain', 'service', 'repository', 'controller', 'model', 'view',
    'type', 'definition', 'contract', 'schema', 'protocol', 'types.ts',
  ],
  penaltyKeywords: ['test', 'mock', 'stub', 'spec', 'fixture'],
  focusPrompt: 'Focus on module boundaries, dependency relationships, design patterns, and architectural decisions.',
};

/**
 * Modification perspective: Focus on code change support.
 * Maps to T-13 to T-18.
 */
const MODIFICATION_PERSPECTIVE: PerspectiveConfig = {
  id: 'modification',
  description: 'Code modification, refactoring, and feature addition',
  tPatternIds: ['T-13', 'T-14', 'T-15', 'T-16', 'T-17', 'T-18'],
  tPatternCategories: ['modification'],
  entityTypeWeights: {
    function: 1.0,
    module: 0.8,
    document: 0.4,
  },
  signalModifiers: {
    semantic: 1.2,   // Find similar patterns
    structural: 1.2, // Nearby code matters
    dependency: 1.3, // What depends on this?
    history: 1.2,    // What changes together?
    test: 1.3,       // Test coverage for refactoring
    risk: 1.0,
  },
  boostKeywords: [
    'usage', 'caller', 'reference', 'import', 'depend', 'impact',
    'breaking', 'change', 'refactor', 'rename', 'move', 'extract',
    'similar', 'pattern', 'convention', 'style', 'config', 'setting',
  ],
  penaltyKeywords: [],
  focusPrompt: 'Focus on code usages, breaking change impact, similar patterns, and modification safety.',
};

/**
 * Testing perspective: Focus on test coverage and gaps.
 * Maps to T-06, T-17.
 */
const TESTING_PERSPECTIVE: PerspectiveConfig = {
  id: 'testing',
  description: 'Test coverage, gaps, and quality assurance',
  tPatternIds: ['T-06', 'T-17', 'T-05'],
  tPatternCategories: ['navigation', 'modification'],
  entityTypeWeights: {
    function: 1.0,
    module: 0.7,
    document: 0.3,
  },
  signalModifiers: {
    semantic: 1.0,
    test: 2.0,       // Test coverage is primary signal
    structural: 1.2, // Test files near source
    history: 1.1,    // What tests changed together
    risk: 1.3,       // High-risk needs tests
    dependency: 0.8,
  },
  boostKeywords: [
    'test', 'spec', 'describe', 'it', 'expect', 'assert', 'mock',
    'stub', 'spy', 'fixture', 'coverage', 'edge', 'case', 'boundary',
    'integration', 'unit', 'e2e', 'snapshot', 'regression',
  ],
  penaltyKeywords: [],
  focusPrompt: 'Focus on test coverage gaps, edge cases, assertion patterns, and testing strategy.',
};

/**
 * Understanding perspective: Focus on code comprehension.
 * Maps to T-01 to T-12.
 */
const UNDERSTANDING_PERSPECTIVE: PerspectiveConfig = {
  id: 'understanding',
  description: 'Code navigation and comprehension',
  tPatternIds: ['T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-07', 'T-08', 'T-09', 'T-10', 'T-11', 'T-12'],
  tPatternCategories: ['navigation', 'understanding'],
  entityTypeWeights: {
    document: 0.9,  // Documentation very valuable
    function: 1.0,
    module: 0.9,
  },
  signalModifiers: {
    semantic: 1.3,   // Semantic search key for understanding
    keyword: 1.2,    // Term matching helps
    domain: 1.2,     // Domain concepts
    structural: 1.0,
    dependency: 1.0,
    history: 0.7,
    risk: 0.5,
    test: 0.6,
  },
  boostKeywords: [
    'what', 'how', 'why', 'explain', 'purpose', 'overview', 'guide',
    'documentation', 'readme', 'tutorial', 'example', 'usage', 'api',
    'concept', 'introduction', 'getting started', 'architecture',
  ],
  penaltyKeywords: [],
  focusPrompt: 'Focus on clear explanations, code purpose, relationships, and conceptual understanding.',
};

// ============================================================================
// PERSPECTIVE REGISTRY
// ============================================================================

/**
 * Registry of all perspective configurations indexed by perspective ID.
 */
export const PERSPECTIVE_CONFIGS: Readonly<Record<Perspective, PerspectiveConfig>> = {
  navigation: NAVIGATION_PERSPECTIVE,
  debugging: DEBUGGING_PERSPECTIVE,
  security: SECURITY_PERSPECTIVE,
  performance: PERFORMANCE_PERSPECTIVE,
  architecture: ARCHITECTURE_PERSPECTIVE,
  modification: MODIFICATION_PERSPECTIVE,
  testing: TESTING_PERSPECTIVE,
  understanding: UNDERSTANDING_PERSPECTIVE,
};

/**
 * Get the configuration for a specific perspective.
 */
export function getPerspectiveConfig(perspective: Perspective): PerspectiveConfig {
  return PERSPECTIVE_CONFIGS[perspective];
}

// ============================================================================
// TASK TYPE TO PERSPECTIVE MAPPING
// ============================================================================

/**
 * Maps task types to their default perspectives.
 * When a query has a taskType but no explicit perspective, we infer the perspective.
 */
export const TASK_TYPE_TO_PERSPECTIVE: Readonly<Record<string, Perspective>> = {
  // Direct mappings
  'code_navigation': 'navigation',
  'security_audit': 'security',
  'debugging': 'debugging',
  'performance_audit': 'performance',
  'architecture_review': 'architecture',
  'code_review': 'modification',
  'test_coverage': 'testing',

  // Analysis task mappings
  'premortem': 'architecture',
  'complexity_audit': 'architecture',
  'integration_risk': 'modification',
  'slop_detection': 'modification',
};

/**
 * Infer perspective from query parameters.
 * Explicit perspective takes precedence over taskType inference.
 */
export function inferPerspective(query: {
  perspective?: Perspective;
  taskType?: string;
}): Perspective | undefined {
  // Explicit perspective takes precedence
  if (query.perspective) {
    return query.perspective;
  }

  // Infer from taskType
  if (query.taskType && query.taskType in TASK_TYPE_TO_PERSPECTIVE) {
    return TASK_TYPE_TO_PERSPECTIVE[query.taskType];
  }

  return undefined;
}

// ============================================================================
// PERSPECTIVE-AWARE SCORING
// ============================================================================

/**
 * Apply perspective-based weight modifications to signal weights.
 * Returns modified weights that emphasize signals relevant to the perspective.
 */
export function applyPerspectiveWeights(
  baseWeights: Record<SignalType, number>,
  perspective: Perspective
): Record<SignalType, number> {
  const config = getPerspectiveConfig(perspective);
  const modifiedWeights = { ...baseWeights };

  // Apply signal modifiers
  for (const [signal, modifier] of Object.entries(config.signalModifiers)) {
    const signalKey = signal as SignalType;
    if (signalKey in modifiedWeights) {
      modifiedWeights[signalKey] *= modifier;
    }
  }

  // Normalize weights to sum to approximately 1
  const total = Object.values(modifiedWeights).reduce((sum, w) => sum + w, 0);
  if (total > 0) {
    for (const key of Object.keys(modifiedWeights) as SignalType[]) {
      modifiedWeights[key] /= total;
    }
  }

  return modifiedWeights;
}

/**
 * Calculate a perspective boost score for a text string.
 * Higher score means the text is more relevant to the perspective.
 */
export function calculatePerspectiveBoost(
  text: string,
  perspective: Perspective
): number {
  const config = getPerspectiveConfig(perspective);
  const lowerText = text.toLowerCase();

  let boostCount = 0;
  let penaltyCount = 0;

  // Count boost keyword matches
  for (const keyword of config.boostKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      boostCount++;
    }
  }

  // Count penalty keyword matches
  for (const keyword of config.penaltyKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      penaltyCount++;
    }
  }

  // Calculate boost factor: 1.0 base, +0.05 per boost, -0.03 per penalty
  const boost = 1.0 + (boostCount * 0.05) - (penaltyCount * 0.03);

  // Clamp to reasonable range [0.7, 1.5]
  return Math.max(0.7, Math.min(1.5, boost));
}

/**
 * Get entity type weight for a perspective.
 */
export function getEntityTypeWeight(
  entityType: EmbeddableEntityType,
  perspective: Perspective
): number {
  const config = getPerspectiveConfig(perspective);
  return config.entityTypeWeights[entityType] ?? 0.5;
}

/**
 * Check if a T-pattern is relevant to a perspective.
 */
export function isTPatternRelevant(
  tPatternId: string,
  perspective: Perspective
): boolean {
  const config = getPerspectiveConfig(perspective);
  return config.tPatternIds.includes(tPatternId);
}

/**
 * Get all T-pattern IDs relevant to a perspective.
 */
export function getRelevantTPatterns(perspective: Perspective): string[] {
  const config = getPerspectiveConfig(perspective);
  return [...config.tPatternIds];
}
