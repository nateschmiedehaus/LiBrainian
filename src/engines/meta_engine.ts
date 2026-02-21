import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, FunctionKnowledge, ModuleKnowledge } from '../types.js';
import { attributeFailure as sbflAttributeFailure } from '../integration/causal_attribution.js';
import type {
  QualifiedKnowledge,
  ProceedDecision,
  ConfidenceReport,
  RiskAssessment,
  BlindSpot,
  FailureHistory,
  Expert,
  TaskOutcome,
  TaskFailure,
  Attribution,
  ThresholdAlert,
} from './types.js';
import { globalEventBus, createEngineConfidenceEvent, createConfidenceUpdatedEvent } from '../events.js';

// DEPRECATED: CONFIDENCE_WEIGHTS no longer used - geometric mean replaced weighted arithmetic mean
// Kept for reference only; remove in future cleanup
// const CONFIDENCE_WEIGHTS = { freshness: 0.4, coverage: 0.3, reliability: 0.3 };

export class MetaKnowledgeEngine {
  private readonly outcomes: TaskOutcome[] = [];
  private readonly staleEntities = new Set<string>();
  private ingestionCache = new Map<string, Array<{ id: string; payload: unknown }>>();

  constructor(
    private readonly storage: LiBrainianStorage,
    private readonly workspaceRoot: string,
    private readonly reindex?: (scope: string[]) => Promise<void>,
  ) {}

  async qualify(entityIds: string[]): Promise<QualifiedKnowledge[]> {
    const version = await this.storage.getVersion();
    // Storage may return indexedAt as ISO string; ensure it's a Date object
    const rawIndexedAt = version?.indexedAt;
    const indexedAt = !rawIndexedAt ? new Date(0) : rawIndexedAt instanceof Date ? rawIndexedAt : new Date(rawIndexedAt as unknown as string);
    const results: QualifiedKnowledge[] = [];

    for (const entityId of entityIds) {
      const resolved = await resolveEntity(this.storage, entityId);
      const resolvedPath =
        resolved.type === 'function'
          ? resolved.entity.filePath
          : resolved.type === 'module'
            ? resolved.entity.path
            : resolved.type === 'context_pack'
              ? resolved.entity.relatedFiles[0] ?? null
              : null;
      const freshness = await buildFreshness(entityId, resolved, indexedAt);
      const isForcedStale = this.staleEntities.has(entityId) || (resolvedPath ? this.staleEntities.has(resolvedPath) : false);
      const adjustedFreshness = isForcedStale
        ? {
            ...freshness,
            modifiedSince: true,
            score: Math.min(freshness.score, 0.2),
          }
        : freshness;
      const coverage = await buildCoverage(this.storage, resolved);
      const reliability = await buildReliability(this.storage, resolved);
      const confidence = calculateConfidence(adjustedFreshness.score, coverage.score, reliability.score);

      // Emit engine:confidence event for each qualified entity
      void globalEventBus.emit(createEngineConfidenceEvent(
        entityId,
        resolved.type,
        confidence,
        0 // No delta since this is qualification, not update
      ));

      results.push({
        entityId,
        freshness: adjustedFreshness,
        coverage,
        reliability,
        confidence,
      });
    }

    return results;
  }

  async shouldProceed(scope: string[]): Promise<ProceedDecision> {
    const candidates = await resolveScopeEntities(this.storage, scope);
    if (candidates.length === 0) {
      return {
        proceed: false,
        blockers: [{ reason: 'No indexed entities for scope', resolution: 'reindex' }],
        confidence: 0.2,
      };
    }
    const qualified = await this.qualify(candidates);
    // VISION: Use geometric mean for confidence - represents combined certainty
    const avgConfidence = geometricMean(qualified.map((q) => q.confidence));
    const stale = qualified.filter((q) => q.freshness.modifiedSince || q.freshness.score < 0.3);

    if (stale.length > 0) {
      return {
        proceed: false,
        blockers: stale.map(() => ({ reason: 'Stale data', resolution: 'reindex', estimatedTime: 30_000 })),
        confidence: avgConfidence,
      };
    }

    const warnings = avgConfidence < 0.6 ? ['Low confidence in knowledge coverage'] : [];
    return {
      proceed: avgConfidence >= 0.4,
      warnings,
      confidence: avgConfidence,
    };
  }

  async getConfidence(scope: string[]): Promise<ConfidenceReport> {
    const candidates = await resolveScopeEntities(this.storage, scope);
    const qualified = await this.qualify(candidates);
    // VISION: Use geometric mean for overall confidence
    const overall = geometricMean(qualified.map((q) => q.confidence));
    // Dimensions use arithmetic mean as they're individual scores, not compounded certainty
    const dimensions = {
      freshness: average(qualified.map((q) => q.freshness.score)),
      coverage: average(qualified.map((q) => q.coverage.score)),
      reliability: average(qualified.map((q) => q.reliability.score)),
    };
    const breakdown = qualified.map((q) => ({
      file: q.entityId,
      confidence: q.confidence,
      issues: [
        q.freshness.modifiedSince ? 'stale data' : '',
        q.coverage.score < 0.5 ? 'low coverage' : '',
        q.reliability.score < 0.5 ? 'low reliability' : '',
      ].filter(Boolean),
    }));
    const recommendations: string[] = [];
    if (dimensions.freshness < 0.5) recommendations.push('Reindex stale areas to improve freshness.');
    if (dimensions.coverage < 0.5) recommendations.push('Increase coverage through indexing or documentation.');
    if (dimensions.reliability < 0.5) recommendations.push('Review failures and update confidence tracking.');
    return { overall, dimensions, breakdown, recommendations };
  }

  async assessRisk(scope: string[]): Promise<RiskAssessment> {
    const report = await this.getConfidence(scope);
    const score = 1 - report.overall;
    const level = score > 0.7 ? 'critical' : score > 0.5 ? 'high' : score > 0.3 ? 'medium' : 'low';
    return {
      level,
      score,
      factors: report.recommendations,
      mitigations: report.recommendations.length ? report.recommendations : ['Proceed with standard safeguards.'],
    };
  }

  async getBlindSpots(scope: string[]): Promise<BlindSpot[]> {
    const candidates = await resolveScopeEntities(this.storage, scope);
    if (candidates.length > 0) return [];
    return scope.map((area) => ({
      area,
      reason: 'No indexed entities for scope',
      risk: 'high',
      suggestion: 'Run librainian bootstrap or reindex this directory.',
    }));
  }

  async getPastFailures(intent: string): Promise<FailureHistory> {
    const failures = this.outcomes.filter((outcome) => !outcome.success && outcome.intent.includes(intent));
    return {
      failures: failures.map((failure) => ({ intent: failure.intent, reason: failure.reason ?? 'unknown', timestamp: failure.timestamp })),
      summary: failures.length ? `${failures.length} historical failures matched` : 'No matching failures recorded',
    };
  }

  async getExperts(scope: string[]): Promise<Expert[]> {
    const ownership = await this.getIngestionItems('ownership');
    const experts: Expert[] = [];
    for (const item of ownership) {
      const payload = item.payload as { path?: string; primaryOwner?: string; contributors?: string[]; expertiseScore?: Record<string, number> } | null;
      if (!payload?.path || !payload.primaryOwner) continue;
      if (!scope.some((entry) => payload.path?.includes(entry))) continue;
      const score = payload.expertiseScore?.[payload.primaryOwner] ?? 0.5;
      experts.push({
        id: payload.primaryOwner,
        name: payload.primaryOwner,
        scope: [payload.path],
        confidence: Math.min(0.95, Math.max(0.1, score)),
        reason: `Primary owner for ${payload.path}`,
      });
      for (const contributor of payload.contributors ?? []) {
        if (contributor === payload.primaryOwner) continue;
        const contributorScore = payload.expertiseScore?.[contributor] ?? 0.3;
        experts.push({
          id: contributor,
          name: contributor,
          scope: [payload.path],
          confidence: Math.min(0.9, Math.max(0.1, contributorScore)),
          reason: `Contributor to ${payload.path}`,
        });
      }
    }
    return experts;
  }

  recordOutcome(outcome: TaskOutcome): void {
    this.outcomes.push(outcome);
  }

  async attributeFailure(failure: TaskFailure): Promise<Attribution> {
    const attribution = await sbflAttributeFailure(
      this.storage,
      { success: false, failureReason: failure.failureReason, failureType: failure.failureType },
      { packIds: failure.packsUsed, affectedEntities: failure.packsUsed.map((id) => `context_pack:${id}`) }
    );
    return {
      knowledgeCaused: attribution.knowledgeCaused,
      confidence: attribution.confidence,
      evidence: attribution.evidence,
      suspiciousPacks: attribution.suspiciousPacks.map((pack) => ({ packId: pack.packId, score: pack.score })),
      recommendation: attribution.recommendation,
    };
  }

  markStale(entityIds: string[]): void {
    for (const id of entityIds) {
      this.staleEntities.add(id);
    }
  }

  async applyTimeDecay(): Promise<void> {
    await this.storage.applyTimeDecay(0.01);
  }

  async requestReindex(scope: string[]): Promise<{ jobId: string }> {
    if (this.reindex) {
      await this.reindex(scope);
    }
    return { jobId: randomUUID() };
  }

  async checkThresholds(): Promise<ThresholdAlert[]> {
    const alerts: ThresholdAlert[] = [];
    if (this.staleEntities.size > 0) {
      alerts.push({ kind: 'freshness', message: 'Stale entities detected', severity: 'medium' });
    }
    const stats = await this.storage.getStats();
    if (stats.averageConfidence < 0.4) {
      alerts.push({ kind: 'reliability', message: 'Average confidence below 0.4', severity: 'high' });
    }
    return alerts;
  }

  private async getIngestionItems(sourceType: string): Promise<Array<{ id: string; payload: unknown }>> {
    const cached = this.ingestionCache.get(sourceType);
    if (cached) return cached;
    const items = await this.storage.getIngestionItems({ sourceType, limit: 500 });
    const normalized = items.map((item) => ({ id: item.id, payload: item.payload }));
    this.ingestionCache.set(sourceType, normalized);
    return normalized;
  }
}

type ResolvedEntity =
  | { type: 'function'; entity: FunctionKnowledge }
  | { type: 'module'; entity: ModuleKnowledge }
  | { type: 'context_pack'; entity: ContextPack }
  | { type: 'unknown'; entity: null };

async function resolveEntity(storage: LiBrainianStorage, entityId: string): Promise<ResolvedEntity> {
  const fn = await storage.getFunction(entityId);
  if (fn) return { type: 'function', entity: fn };
  const mod = await storage.getModule(entityId);
  if (mod) return { type: 'module', entity: mod };
  const pack = await storage.getContextPack(entityId);
  if (pack) return { type: 'context_pack', entity: pack };
  return { type: 'unknown', entity: null };
}

async function buildFreshness(entityId: string, resolved: ResolvedEntity, indexedAt: Date): Promise<QualifiedKnowledge['freshness']> {
  let filePath: string | null = null;
  let entityIndexedAt = indexedAt;
  if (resolved.type === 'function') filePath = resolved.entity.filePath;
  if (resolved.type === 'module') filePath = resolved.entity.path;
  if (resolved.type === 'context_pack') {
    filePath = resolved.entity.relatedFiles[0] ?? null;
    // Storage may return indexedAt as ISO string; ensure it's a Date object
    const rawIndexedAt = resolved.entity.version.indexedAt;
    entityIndexedAt = rawIndexedAt instanceof Date ? rawIndexedAt : new Date(rawIndexedAt as unknown as string);
  }
  let modifiedSince = false;
  if (filePath) {
    try {
      const stat = await fs.stat(filePath);
      modifiedSince = stat.mtime.getTime() > entityIndexedAt.getTime();
    } catch {
      modifiedSince = false;
    }
  }
  const daysSinceIndex = Math.max(0, (Date.now() - entityIndexedAt.getTime()) / (1000 * 60 * 60 * 24));
  const score = modifiedSince ? 0.2 : Math.exp(-(daysSinceIndex / 7) * Math.LN2);
  return {
    indexedAt: entityIndexedAt,
    modifiedSince,
    commitsBehind: 0,
    score: Math.max(0, Math.min(1, score)),
  };
}

async function buildCoverage(storage: LiBrainianStorage, resolved: ResolvedEntity): Promise<QualifiedKnowledge['coverage']> {
  const hasEntities = resolved.type !== 'unknown';
  let hasRelationships = false;
  if (resolved.type === 'function' || resolved.type === 'module') {
    const edges = await storage.getGraphEdges({ fromIds: [resolved.entity.id] });
    hasRelationships = edges.length > 0;
  }
  const filePath =
    resolved.type === 'function'
      ? resolved.entity.filePath
      : resolved.type === 'module'
        ? resolved.entity.path
        : resolved.type === 'context_pack'
          ? resolved.entity.relatedFiles[0] ?? ''
          : '';
  const hasTestMapping = filePath ? await hasIngestionMatch(storage, 'tests', filePath) : false;
  const hasOwnership = filePath ? await hasIngestionMatch(storage, 'ownership', filePath) : false;
  const score = average([
    hasEntities ? 1 : 0,
    hasRelationships ? 1 : 0,
    hasTestMapping ? 1 : 0,
    hasOwnership ? 1 : 0,
  ]);
  return { hasEntities, hasRelationships, hasTestMapping, hasOwnership, score };
}

async function buildReliability(storage: LiBrainianStorage, resolved: ResolvedEntity): Promise<QualifiedKnowledge['reliability']> {
  let usageCount = 0;
  let successRate = 0.5;
  let lastFailure: Date | undefined;
  if (resolved.type === 'function') {
    usageCount = resolved.entity.accessCount;
    const successes = resolved.entity.outcomeHistory.successes;
    const failures = resolved.entity.outcomeHistory.failures;
    const total = successes + failures;
    successRate = total > 0 ? successes / total : 0.5;
  } else if (resolved.type === 'context_pack') {
    usageCount = resolved.entity.accessCount;
    const successes = resolved.entity.successCount;
    const failures = resolved.entity.failureCount;
    const total = successes + failures;
    successRate = total > 0 ? successes / total : 0.5;
    if (failures > 0 && resolved.entity.lastOutcome === 'failure') {
      lastFailure = resolved.entity.createdAt;
    }
  } else if (resolved.type === 'module') {
    const functions = await storage.getFunctions();
    const moduleFunctions = functions.filter((fn) => fn.filePath === resolved.entity.path);
    usageCount = moduleFunctions.reduce((sum, fn) => sum + fn.accessCount, 0);
    const successes = moduleFunctions.reduce((sum, fn) => sum + fn.outcomeHistory.successes, 0);
    const failures = moduleFunctions.reduce((sum, fn) => sum + fn.outcomeHistory.failures, 0);
    const total = successes + failures;
    successRate = total > 0 ? successes / total : resolved.entity.confidence;
  }
  const score = usageCount < 5 ? 0.5 : successRate;
  const trend = score > 0.7 ? 'improving' : score < 0.4 ? 'degrading' : 'stable';
  return {
    usageCount,
    successRate,
    lastFailure,
    trend,
    score: Math.max(0, Math.min(1, score)),
  };
}

async function resolveScopeEntities(storage: LiBrainianStorage, scope: string[]): Promise<string[]> {
  const modules = await storage.getModules();
  const matches = modules.filter((mod) => scope.some((entry) => mod.path.includes(entry)));
  return matches.map((mod) => mod.id);
}

/**
 * Calculate overall confidence using geometric mean (cube root of product).
 * Geometric mean strongly penalizes any weak dimension while allowing recovery.
 *
 * Floor: 0.01 (1%) minimum to prevent complete zeroing. Even stale knowledge
 * has some value - agents should know the knowledge exists but treat it with
 * extreme skepticism rather than having no knowledge at all.
 *
 * DESIGN: For world-class agent knowledge, "I know something uncertain" is
 * better than "I know nothing". The 1% floor enables agents to discover
 * context that needs refresh rather than being completely blind.
 */
function calculateConfidence(freshness: number, coverage: number, reliability: number): number {
  // Apply minimum floor to inputs to prevent single zero from tanking everything
  const flooredFreshness = Math.max(0.01, freshness);
  const flooredCoverage = Math.max(0.01, coverage);
  const flooredReliability = Math.max(0.01, reliability);
  return Math.cbrt(flooredFreshness * flooredCoverage * flooredReliability);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Calculate geometric mean of confidence values.
 * ARCHITECTURAL REQUIREMENT (VISION): Confidence should use geometric mean.
 *
 * Geometric mean properly models confidence compounding:
 * - If ANY value is 0, result approaches 0
 * - Low values pull down the result multiplicatively
 * - Represents "confidence in ALL claims together"
 */
function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;

  // Clamp values to avoid log(0)
  const clamped = values.map(v => Math.max(0.01, Math.min(1.0, v)));

  // Geometric mean = exp(sum of logs / n)
  const logSum = clamped.reduce((sum, value) => sum + Math.log(value), 0);
  return Math.exp(logSum / clamped.length);
}

async function hasIngestionMatch(storage: LiBrainianStorage, sourceType: string, filePath: string): Promise<boolean> {
  const items = await storage.getIngestionItems({ sourceType, limit: 200 });
  const needle = filePath.replace(/\\/g, '/');
  for (const item of items) {
    const payload = JSON.stringify(item.payload ?? {});
    if (payload.includes(needle)) return true;
  }
  return false;
}
