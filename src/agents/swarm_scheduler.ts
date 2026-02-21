import type { LiBrainianStorage } from '../storage/types.js';
import type { GraphEntityType, GraphMetricsEntry } from '../graphs/metrics.js';
import { prioritizeExploration } from '../api/exploration_policy.js';

type GraphMetricsStore = LiBrainianStorage & { getGraphMetrics?: (options?: { entityIds?: string[]; entityType?: GraphEntityType }) => Promise<GraphMetricsEntry[]> };

export class SwarmScheduler {
  constructor(private readonly storage: LiBrainianStorage) {}
  async prioritize(files: string[]): Promise<string[]> {
    const modules = await this.storage.getModules(); const moduleByPath = new Map(modules.map((mod) => [mod.path, mod]));
    const metricsStore = this.storage as GraphMetricsStore; const impactByModuleId = await loadModuleImpact(metricsStore, modules);
    const candidates = files.map((file) => {
      const module = moduleByPath.get(file); const impactScore = module ? impactByModuleId.get(module.id) : undefined;
      return { id: file, confidence: module?.confidence ?? 0.3, impactScore };
    });
    const decisions = prioritizeExploration(candidates); const scores = new Map(decisions.map((decision) => [decision.id, decision.score]));
    return files.slice().sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  }
}

async function loadModuleImpact(storage: GraphMetricsStore, modules: { id: string }[]): Promise<Map<string, number>> {
  if (!storage.getGraphMetrics || modules.length === 0) return new Map();
  const metrics = await storage.getGraphMetrics({ entityType: 'module', entityIds: modules.map((mod) => mod.id) });
  let maxPagerank = 0; for (const entry of metrics) if (entry.pagerank > maxPagerank) maxPagerank = entry.pagerank;
  if (maxPagerank <= 0) return new Map(metrics.map((entry) => [entry.entityId, 0]));
  return new Map(metrics.map((entry) => [entry.entityId, entry.pagerank / maxPagerank]));
}
