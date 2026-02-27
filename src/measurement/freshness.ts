/**
 * @fileoverview Freshness and Staleness Model
 *
 * PHILOSOPHICAL ALIGNMENT (UNDERSTANDING_LAYER.md §Freshness and Staleness):
 * Knowledge is time-sensitive; stale knowledge is a defeater.
 * Different domains decay at different rates based on their half-life.
 *
 * FRESHNESS DECAY FORMULA:
 * freshness = 0.5^(age/halfLife)
 *
 * STALENESS RULES:
 * 1. Absolute Staleness: now - generatedAt > maxStaleness
 * 2. Relative Staleness: source mtime > generatedAt
 * 3. Dependency Staleness: any dependency stale → propagate with penalty
 *
 * Schema: FreshnessReport.v1 per docs/archive/SCHEMAS.md
 */

import type { Defeater } from '../knowledge/universal_types.js';

// ============================================================================
// DOMAIN CONFIGURATION (per UNDERSTANDING_LAYER.md)
// ============================================================================

/**
 * Knowledge domain with freshness characteristics.
 */
export type FreshnessDomain =
  | 'identity'
  | 'structure'
  | 'relationships'
  | 'semantics'
  | 'history'
  | 'testing'
  | 'risk'
  | 'quality'
  | 'tribal';

/**
 * Domain freshness configuration per UNDERSTANDING_LAYER.md.
 */
export interface DomainFreshnessConfig {
  /** Max time before knowledge is considered stale (in ms). 0 = always fresh */
  maxStalenessMs: number;
  /** Half-life for exponential decay (in ms). null = no decay */
  halfLifeMs: number | null;
  /** What triggers refresh for this domain */
  refreshTrigger: string;
}

/**
 * Freshness configuration per domain, from UNDERSTANDING_LAYER.md.
 *
 * | Domain        | Max Staleness    | Half-Life     | Refresh Trigger          |
 * |---------------|------------------|---------------|--------------------------|
 * | Identity      | 0 (always fresh) | N/A           | file system change       |
 * | Structure     | 0 (always fresh) | N/A           | file content change      |
 * | Relationships | 1 minute         | 30 seconds    | import/export change     |
 * | Semantics     | 1 hour           | 30 minutes    | significant code change  |
 * | History       | 5 minutes        | 2.5 minutes   | new commit               |
 * | Testing       | 10 minutes       | 5 minutes     | test file change         |
 * | Risk          | 1 hour           | 30 minutes    | dependency/code change   |
 * | Quality       | 1 day            | 12 hours      | periodic reassessment    |
 * | Tribal        | 1 week           | 3.5 days      | manual/inferred update   |
 */
export const DOMAIN_FRESHNESS_CONFIG: Record<FreshnessDomain, DomainFreshnessConfig> = {
  identity: {
    maxStalenessMs: 0, // Always require refresh on change
    halfLifeMs: null,  // No decay - binary fresh/stale
    refreshTrigger: 'file system change',
  },
  structure: {
    maxStalenessMs: 0, // Always require refresh on change
    halfLifeMs: null,  // No decay - binary fresh/stale
    refreshTrigger: 'file content change',
  },
  relationships: {
    maxStalenessMs: 60 * 1000,         // 1 minute
    halfLifeMs: 30 * 1000,             // 30 seconds
    refreshTrigger: 'import/export change',
  },
  semantics: {
    maxStalenessMs: 60 * 60 * 1000,    // 1 hour
    halfLifeMs: 30 * 60 * 1000,        // 30 minutes
    refreshTrigger: 'significant code change',
  },
  history: {
    maxStalenessMs: 5 * 60 * 1000,     // 5 minutes
    halfLifeMs: 2.5 * 60 * 1000,       // 2.5 minutes
    refreshTrigger: 'new commit',
  },
  testing: {
    maxStalenessMs: 10 * 60 * 1000,    // 10 minutes
    halfLifeMs: 5 * 60 * 1000,         // 5 minutes
    refreshTrigger: 'test file change',
  },
  risk: {
    maxStalenessMs: 60 * 60 * 1000,    // 1 hour
    halfLifeMs: 30 * 60 * 1000,        // 30 minutes
    refreshTrigger: 'dependency/code change',
  },
  quality: {
    maxStalenessMs: 24 * 60 * 60 * 1000,  // 1 day
    halfLifeMs: 12 * 60 * 60 * 1000,      // 12 hours
    refreshTrigger: 'periodic reassessment',
  },
  tribal: {
    maxStalenessMs: 7 * 24 * 60 * 60 * 1000,   // 1 week
    halfLifeMs: 3.5 * 24 * 60 * 60 * 1000,    // 3.5 days
    refreshTrigger: 'manual/inferred update',
  },
};

// ============================================================================
// FRESHNESS COMPUTATION
// ============================================================================

/**
 * Compute freshness score using half-life exponential decay.
 *
 * Formula: freshness = 0.5^(age/halfLife)
 *
 * @example
 * // Semantics with 30-minute half-life
 * // After 30 min: 50% fresh
 * // After 60 min: 25% fresh
 * // After 90 min: 12.5% fresh
 */
export function computeFreshness(
  generatedAt: Date,
  now: Date,
  halfLifeMs: number | null
): number {
  if (halfLifeMs === null) {
    // No decay - binary fresh/stale
    return 1.0;
  }

  const ageMs = now.getTime() - generatedAt.getTime();

  if (ageMs <= 0) {
    return 1.0;
  }

  // Exponential decay: f(t) = 0.5^(t/halfLife)
  const freshness = Math.pow(0.5, ageMs / halfLifeMs);

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, freshness));
}

/**
 * Compute domain-specific freshness.
 */
export function computeDomainFreshness(
  domain: FreshnessDomain,
  generatedAt: Date,
  now?: Date
): number {
  const config = DOMAIN_FRESHNESS_CONFIG[domain];
  const currentTime = now ?? new Date();
  return computeFreshness(generatedAt, currentTime, config.halfLifeMs);
}

// ============================================================================
// STALENESS DETECTION
// ============================================================================

export interface StalenessCheckInput {
  /** Domain of the knowledge */
  domain: FreshnessDomain;
  /** When the knowledge was generated */
  generatedAt: Date;
  /** Current time (default: now) */
  now?: Date;
  /** Source file modification time (for relative staleness) */
  sourceMtime?: Date;
  /** Dependency freshness scores (for dependency staleness) */
  dependencyFreshness?: number[];
}

export interface StalenessCheckResult {
  /** Is the knowledge stale? */
  isStale: boolean;
  /** Type of staleness detected */
  stalenessType: 'absolute' | 'relative' | 'dependency' | 'none';
  /** Computed freshness score [0, 1] */
  freshness: number;
  /** Age in milliseconds */
  ageMs: number;
  /** How long until knowledge becomes stale (ms), null if already stale */
  timeUntilStale: number | null;
  /** Reason for staleness if stale */
  reason?: string;
}

/**
 * Check if knowledge is stale using the three staleness rules.
 *
 * Rules from UNDERSTANDING_LAYER.md:
 * 1. Absolute Staleness: now - generatedAt > maxStaleness
 * 2. Relative Staleness: source mtime > generatedAt
 * 3. Dependency Staleness: any dependency stale → propagate with penalty
 */
export function checkStaleness(input: StalenessCheckInput): StalenessCheckResult {
  const { domain, generatedAt, sourceMtime, dependencyFreshness } = input;
  const now = input.now ?? new Date();
  const config = DOMAIN_FRESHNESS_CONFIG[domain];

  const ageMs = now.getTime() - generatedAt.getTime();
  const freshness = computeFreshness(generatedAt, now, config.halfLifeMs);

  // Rule 2: Relative Staleness (check first - most immediate)
  if (sourceMtime && sourceMtime.getTime() > generatedAt.getTime()) {
    return {
      isStale: true,
      stalenessType: 'relative',
      freshness: 0, // Stale knowledge has 0 freshness
      ageMs,
      timeUntilStale: null,
      reason: `Source modified at ${sourceMtime.toISOString()} after knowledge generated at ${generatedAt.toISOString()}`,
    };
  }

  // Rule 1: Absolute Staleness
  if (config.maxStalenessMs > 0 && ageMs > config.maxStalenessMs) {
    return {
      isStale: true,
      stalenessType: 'absolute',
      freshness,
      ageMs,
      timeUntilStale: null,
      reason: `Knowledge age (${formatDuration(ageMs)}) exceeds ${domain} threshold (${formatDuration(config.maxStalenessMs)})`,
    };
  }

  // Rule 3: Dependency Staleness
  if (dependencyFreshness && dependencyFreshness.length > 0) {
    const minDepFreshness = Math.min(...dependencyFreshness);
    // If any dependency has < 50% freshness, propagate staleness
    if (minDepFreshness < 0.5) {
      return {
        isStale: true,
        stalenessType: 'dependency',
        freshness: Math.min(freshness, minDepFreshness * 0.8), // Penalty for dependency staleness
        ageMs,
        timeUntilStale: null,
        reason: `Dependency staleness detected (min freshness: ${(minDepFreshness * 100).toFixed(1)}%)`,
      };
    }
  }

  // Not stale
  const timeUntilStale = config.maxStalenessMs > 0
    ? config.maxStalenessMs - ageMs
    : null;

  return {
    isStale: false,
    stalenessType: 'none',
    freshness,
    ageMs,
    timeUntilStale,
  };
}

// ============================================================================
// STALENESS DEFEATERS
// ============================================================================

/**
 * Create a staleness defeater per UNDERSTANDING_LAYER.md spec.
 *
 * Note: Using 'new_info' as DefeaterType since 'stale_data' is not in the type system.
 * This is semantically accurate as staleness represents new information (time passage)
 * that affects knowledge validity.
 */
export function createStalenessDefeater(
  stalenessResult: StalenessCheckResult,
  domain: FreshnessDomain,
  entityId?: string
): Defeater {
  const config = DOMAIN_FRESHNESS_CONFIG[domain];
  const severity = stalenessResult.ageMs > config.maxStalenessMs * 2 ? 'high' : 'medium';

  return {
    // Using 'new_info' since 'stale_data' is not in DefeaterType
    // Staleness is semantically "new information" (time has passed)
    type: 'new_info',
    description: stalenessResult.reason ??
      `Knowledge for ${entityId ?? 'entity'} is stale (${domain}: ${formatDuration(stalenessResult.ageMs)} old, threshold: ${formatDuration(config.maxStalenessMs)})`,
    detected: new Date().toISOString(),
  };
}

// ============================================================================
// FRESHNESS REPORT
// ============================================================================

/**
 * FreshnessReport.v1 - Report on knowledge freshness state.
 */
export interface FreshnessReport {
  kind: 'FreshnessReport.v1';
  schemaVersion: 1;

  /** ISO 8601 timestamp */
  generatedAt: string;
  /** Scope of the freshness check */
  entityId: string;

  /** Domain freshness scores */
  byDomain: Record<FreshnessDomain, DomainFreshnessEntry>;

  /** Overall freshness (weighted average) */
  overallFreshness: number;

  /** Items that need refresh, ordered by priority */
  refreshQueue: RefreshQueueEntry[];

  /** Staleness defeaters that should be activated */
  stalenessDefeaters: Defeater[];
}

export interface DomainFreshnessEntry {
  domain: FreshnessDomain;
  freshness: number;
  isStale: boolean;
  stalenessType: 'absolute' | 'relative' | 'dependency' | 'none';
  ageMs: number;
  timeUntilStale: number | null;
}

export interface RefreshQueueEntry {
  entityId: string;
  domain: FreshnessDomain;
  priority: 'blocking' | 'high' | 'normal' | 'low';
  reason: string;
  freshness: number;
}

// ============================================================================
// REFRESH PRIORITY
// ============================================================================

/**
 * Determine refresh priority per UNDERSTANDING_LAYER.md:
 * 1. Active query dependency (blocking)
 * 2. Staleness severity (most stale first)
 * 3. Access frequency (hot paths first)
 * 4. Confidence impact (low confidence first)
 */
export function computeRefreshPriority(
  stalenessResult: StalenessCheckResult,
  options: {
    isQueryDependency?: boolean;
    accessFrequency?: number; // 0-1, higher = more accessed
    confidenceImpact?: number; // How much this affects overall confidence
  } = {}
): RefreshQueueEntry['priority'] {
  const { isQueryDependency, accessFrequency = 0.5, confidenceImpact = 0.5 } = options;

  // Rule 1: Active query dependency is always blocking
  if (isQueryDependency) {
    return 'blocking';
  }

  // Rule 2-4: Compute score based on staleness, access, confidence
  const stalenessScore = 1 - stalenessResult.freshness; // Higher = more stale
  const accessScore = accessFrequency;
  const confidenceScore = confidenceImpact;

  const combinedScore = (stalenessScore * 0.5) + (accessScore * 0.3) + (confidenceScore * 0.2);

  if (combinedScore > 0.7) return 'high';
  if (combinedScore > 0.4) return 'normal';
  return 'low';
}

// ============================================================================
// BATCH FRESHNESS CHECK
// ============================================================================

export interface BatchFreshnessInput {
  entityId: string;
  entries: Array<{
    domain: FreshnessDomain;
    generatedAt: Date;
    sourceMtime?: Date;
    dependencyFreshness?: number[];
  }>;
}

/**
 * Compute freshness report for an entity across all domains.
 */
export function computeFreshnessReport(input: BatchFreshnessInput): FreshnessReport {
  const now = new Date();
  const byDomain: Record<FreshnessDomain, DomainFreshnessEntry> = {} as any;
  const refreshQueue: RefreshQueueEntry[] = [];
  const stalenessDefeaters: Defeater[] = [];

  let totalFreshness = 0;
  let domainCount = 0;

  for (const entry of input.entries) {
    const result = checkStaleness({
      domain: entry.domain,
      generatedAt: entry.generatedAt,
      now,
      sourceMtime: entry.sourceMtime,
      dependencyFreshness: entry.dependencyFreshness,
    });

    byDomain[entry.domain] = {
      domain: entry.domain,
      freshness: result.freshness,
      isStale: result.isStale,
      stalenessType: result.stalenessType,
      ageMs: result.ageMs,
      timeUntilStale: result.timeUntilStale,
    };

    totalFreshness += result.freshness;
    domainCount++;

    // Add to refresh queue if stale
    if (result.isStale) {
      const priority = computeRefreshPriority(result);
      refreshQueue.push({
        entityId: input.entityId,
        domain: entry.domain,
        priority,
        reason: result.reason ?? `${entry.domain} knowledge is stale`,
        freshness: result.freshness,
      });

      // Create staleness defeater
      stalenessDefeaters.push(
        createStalenessDefeater(result, entry.domain, input.entityId)
      );
    }
  }

  // Sort refresh queue by priority
  const priorityOrder: Record<RefreshQueueEntry['priority'], number> = {
    blocking: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  refreshQueue.sort((a, b) => {
    const orderDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (orderDiff !== 0) return orderDiff;
    // Within same priority, most stale first
    return a.freshness - b.freshness;
  });

  return {
    kind: 'FreshnessReport.v1',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    entityId: input.entityId,
    byDomain,
    overallFreshness: domainCount > 0 ? totalFreshness / domainCount : 1.0,
    refreshQueue,
    stalenessDefeaters,
  };
}

// ============================================================================
// TYPE GUARD
// ============================================================================

export function isFreshnessReport(value: unknown): value is FreshnessReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.kind === 'FreshnessReport.v1' && r.schemaVersion === 1;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format duration in human-readable form.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}min`;
  if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
  return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
}

/**
 * Get domain from section name (maps evidence_collector sections to domains).
 */
export function sectionToDomain(section: string): FreshnessDomain {
  const mapping: Record<string, FreshnessDomain> = {
    identity: 'identity',
    structure: 'structure',
    relationships: 'relationships',
    semantics: 'semantics',
    history: 'history',
    testing: 'testing',
    security: 'risk', // Security maps to risk domain
    risk: 'risk',
    quality: 'quality',
    ownership: 'tribal', // Ownership is tribal knowledge
    rationale: 'tribal', // Rationale is tribal knowledge
    traceability: 'semantics', // Traceability maps to semantics
    api: 'relationships', // API knowledge is relationship-like
  };

  return mapping[section] ?? 'quality'; // Default to quality (medium decay)
}
