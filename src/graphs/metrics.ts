import * as fs from 'fs/promises';
import * as path from 'path';
import { computePageRank } from './pagerank.js';
import { computeBetweennessCentrality, computeClosenessCentrality, computeEigenvectorCentrality } from './centrality.js';
import { detectCommunities } from './communities.js';

export type GraphEntityType = 'function' | 'module';
type Graph = Map<string, Set<string>>;

export interface GraphMetricsEntry {
  entityId: string;
  entityType: GraphEntityType;
  pagerank: number;
  betweenness: number;
  closeness: number;
  eigenvector: number;
  communityId: number;
  isBridge: boolean;
  computedAt: string;
}

export interface GraphMetricsReportV1 {
  kind: 'GraphMetricsReport.v1';
  schema_version: 1;
  computed_at: string;
  totals: { nodes: number; edges: number; communities: number; bridges: number };
  graphs: Array<{ entity_type: GraphEntityType; nodes: number; edges: number; communities: number }>;
}

export function computeGraphMetrics(
  graphs: Partial<Record<GraphEntityType, Graph>>,
  computedAt = new Date().toISOString()
): { metrics: GraphMetricsEntry[]; report: GraphMetricsReportV1 } {
  const metrics: GraphMetricsEntry[] = []; const graphSummaries: GraphMetricsReportV1['graphs'] = [];
  let totalNodes = 0; let totalEdges = 0; let totalCommunities = 0; let totalBridges = 0;
  for (const entityType of Object.keys(graphs) as GraphEntityType[]) {
    const graph = graphs[entityType]; if (!graph || graph.size === 0) continue;
    const normalized = normalizeGraph(graph);
    const pagerank = computePageRank(normalized); const betweenness = computeBetweennessCentrality(normalized);
    const closeness = computeClosenessCentrality(normalized); const eigenvector = computeEigenvectorCentrality(normalized);
    const communities = detectCommunities(toUndirected(normalized)); const threshold = percentile(Array.from(betweenness.values()), 0.8);
    const communityCount = new Set(communities.values()).size; let bridges = 0; let edges = 0;
    for (const [node, neighbors] of normalized) edges += neighbors.size;
    for (const node of normalized.keys()) {
      const communityId = communities.get(node) ?? 0; const within = countWithinCommunity(node, normalized, communities, communityId);
      const degree = normalized.get(node)?.size ?? 0;
      const isBridge = (betweenness.get(node) ?? 0) >= threshold && (degree === 0 ? false : within < Math.max(1, Math.floor(degree / 2)));
      if (isBridge) bridges += 1;
      metrics.push({
        entityId: node,
        entityType,
        pagerank: pagerank.get(node) ?? 0,
        betweenness: betweenness.get(node) ?? 0,
        closeness: closeness.get(node) ?? 0,
        eigenvector: eigenvector.get(node) ?? 0,
        communityId,
        isBridge,
        computedAt,
      });
    }
    graphSummaries.push({ entity_type: entityType, nodes: normalized.size, edges, communities: communityCount });
    totalNodes += normalized.size; totalEdges += edges; totalCommunities += communityCount; totalBridges += bridges;
  }
  return {
    metrics,
    report: {
      kind: 'GraphMetricsReport.v1',
      schema_version: 1,
      computed_at: computedAt,
      totals: { nodes: totalNodes, edges: totalEdges, communities: totalCommunities, bridges: totalBridges },
      graphs: graphSummaries,
    },
  };
}

export async function writeGraphMetricsReport(workspaceRoot: string, report: GraphMetricsReportV1): Promise<string> {
  const timestamp = report.computed_at.replace(/[:.]/g, '-');
  const dir = path.join(workspaceRoot, 'state', 'audits', 'librainian', 'graphs', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'GraphMetricsReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}

function normalizeGraph(graph: Graph): Graph {
  const normalized: Graph = new Map();
  for (const node of collectNodes(graph)) normalized.set(node, new Set());
  for (const [node, neighbors] of graph) {
    const set = normalized.get(node) as Set<string>;
    for (const neighbor of neighbors) set.add(neighbor);
  }
  return normalized;
}

function collectNodes(graph: Graph): Set<string> {
  const nodes = new Set<string>(); for (const [node, neighbors] of graph) { nodes.add(node); for (const neighbor of neighbors) nodes.add(neighbor); }
  return nodes;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b); const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function countWithinCommunity(node: string, graph: Graph, communities: Map<string, number>, communityId: number): number {
  let count = 0;
  for (const neighbor of graph.get(node) ?? []) if ((communities.get(neighbor) ?? -1) === communityId) count += 1;
  return count;
}

function toUndirected(graph: Graph): Graph {
  const undirected: Graph = new Map();
  for (const node of collectNodes(graph)) undirected.set(node, new Set());
  for (const [node, neighbors] of graph) {
    const set = undirected.get(node) as Set<string>;
    for (const neighbor of neighbors) { set.add(neighbor); (undirected.get(neighbor) as Set<string>).add(node); }
  }
  return undirected;
}
