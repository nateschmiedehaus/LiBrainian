import { buildModuleGraphs, resolveTargetModule } from '../knowledge/module_graph.js';
import { ImpactKnowledge } from '../knowledge/impact.js';
import type { LibrarianStorage, KnowledgeGraphEdge, ModuleKnowledge } from '../storage/types.js';

export interface ChangeImpactToolInput {
  target: string;
  depth?: number;
  maxResults?: number;
  changeType?: 'modify' | 'delete' | 'rename' | 'move';
}

export interface ChangeImpactEntry {
  file: string;
  depth: number;
  direct: boolean;
  relationship: 'imports';
  impactScore: number;
  confidence: number;
  reason: string;
  reasonFlags: string[];
  testCoversChanged: boolean;
  coChangeWeight: number;
}

export interface ChangeImpactReport {
  success: boolean;
  target: string;
  resolvedTarget?: string;
  depth: number;
  impacted: ChangeImpactEntry[];
  summary: {
    totalImpacted: number;
    directCount: number;
    transitiveCount: number;
    testsFlagged: number;
    maxImpactScore: number;
    durationMs: number;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    riskScore?: number;
  };
  error?: string;
}

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 200;

export async function computeChangeImpactReport(
  storage: LibrarianStorage,
  input: ChangeImpactToolInput
): Promise<ChangeImpactReport> {
  const started = Date.now();
  const depth = normalizeDepth(input.depth);
  const maxResults = normalizeMaxResults(input.maxResults);

  try {
    const modules = await storage.getModules();
    const targetModule = resolveTargetModule(modules, input.target);

    if (!targetModule) {
      return {
        success: false,
        target: input.target,
        depth,
        impacted: [],
        summary: {
          totalImpacted: 0,
          directCount: 0,
          transitiveCount: 0,
          testsFlagged: 0,
          maxImpactScore: 0,
          durationMs: Date.now() - started,
        },
        error: `Target not found: ${input.target}`,
      };
    }

    const depthMap = computeDependentDepths(modules, targetModule.path, depth);
    const coChangeWeights = await loadCoChangeWeights(storage, targetModule.path);

    const impactKnowledge = new ImpactKnowledge(storage);
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' | undefined;
    let riskScore: number | undefined;
    try {
      const risk = await impactKnowledge.query({
        type: 'risk_assessment',
        target: targetModule.path,
        depth,
        changeType: input.changeType,
      });
      riskLevel = risk.risk?.level;
      riskScore = risk.risk?.score;
    } catch {
      // Do not fail impact analysis if optional risk scoring dependencies are unavailable.
      riskLevel = undefined;
      riskScore = undefined;
    }

    const entries: ChangeImpactEntry[] = [];
    for (const [file, fileDepth] of depthMap.entries()) {
      const direct = fileDepth === 1;
      const isTest = isTestFile(file);
      const coChangeWeight = coChangeWeights.get(file) ?? 0;
      const reasonFlags: string[] = [direct ? 'direct_dependency' : 'transitive_dependency'];
      if (isTest) reasonFlags.push('test_covers_changed');
      if (coChangeWeight > 0) reasonFlags.push('co_changed');

      const impactScore = scoreImpact({
        depth: fileDepth,
        direct,
        test: isTest,
        coChangeWeight,
      });

      entries.push({
        file,
        depth: fileDepth,
        direct,
        relationship: 'imports',
        impactScore,
        confidence: direct ? 0.95 : 0.7,
        reason: direct
          ? `Directly imports ${targetModule.path}`
          : `Transitively depends on ${targetModule.path}`,
        reasonFlags,
        testCoversChanged: isTest,
        coChangeWeight,
      });
    }

    entries.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (b.impactScore !== a.impactScore) return b.impactScore - a.impactScore;
      return a.file.localeCompare(b.file);
    });

    const trimmed = entries.slice(0, maxResults);

    return {
      success: true,
      target: input.target,
      resolvedTarget: targetModule.path,
      depth,
      impacted: trimmed,
      summary: {
        totalImpacted: trimmed.length,
        directCount: trimmed.filter((entry) => entry.direct).length,
        transitiveCount: trimmed.filter((entry) => !entry.direct).length,
        testsFlagged: trimmed.filter((entry) => entry.testCoversChanged).length,
        maxImpactScore: trimmed.length > 0 ? Math.max(...trimmed.map((entry) => entry.impactScore)) : 0,
        durationMs: Date.now() - started,
        riskLevel,
        riskScore,
      },
    };
  } catch (error) {
    return {
      success: false,
      target: input.target,
      depth,
      impacted: [],
      summary: {
        totalImpacted: 0,
        directCount: 0,
        transitiveCount: 0,
        testsFlagged: 0,
        maxImpactScore: 0,
        durationMs: Date.now() - started,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeDepth(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DEPTH;
  return Math.max(1, Math.min(MAX_DEPTH, Math.floor(value)));
}

function normalizeMaxResults(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function computeDependentDepths(
  modules: ModuleKnowledge[],
  targetPath: string,
  maxDepth: number
): Map<string, number> {
  const { reverse } = buildModuleGraphs(modules);
  const depthByPath = new Map<string, number>();
  const queue: Array<{ path: string; depth: number }> = [{ path: targetPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= maxDepth) continue;

    for (const dependentPath of reverse.get(current.path) ?? []) {
      const nextDepth = current.depth + 1;
      const knownDepth = depthByPath.get(dependentPath);
      if (knownDepth !== undefined && knownDepth <= nextDepth) continue;
      depthByPath.set(dependentPath, nextDepth);
      queue.push({ path: dependentPath, depth: nextDepth });
    }
  }

  return depthByPath;
}

async function loadCoChangeWeights(
  storage: LibrarianStorage,
  targetPath: string
): Promise<Map<string, number>> {
  const weights = new Map<string, number>();
  const [outbound, inbound] = await Promise.all([
    storage.getKnowledgeEdges({ edgeType: 'co_changed', sourceId: targetPath, limit: 5000 }),
    storage.getKnowledgeEdges({ edgeType: 'co_changed', targetId: targetPath, limit: 5000 }),
  ]);

  for (const edge of [...outbound, ...inbound]) {
    addCoChangeWeight(weights, edge, targetPath);
  }

  return weights;
}

function addCoChangeWeight(weights: Map<string, number>, edge: KnowledgeGraphEdge, targetPath: string): void {
  const counterpart = edge.sourceId === targetPath ? edge.targetId : edge.sourceId;
  const prior = weights.get(counterpart) ?? 0;
  if (edge.weight > prior) {
    weights.set(counterpart, edge.weight);
  }
}

function isTestFile(filePath: string): boolean {
  return /(?:\.test\.|\.spec\.|__tests__|\/tests\/)/i.test(filePath);
}

function scoreImpact(input: {
  depth: number;
  direct: boolean;
  test: boolean;
  coChangeWeight: number;
}): number {
  const depthDecay = input.direct ? 1 : Math.max(0.25, 1 / (input.depth + 0.5));
  const testBoost = input.test ? 0.12 : 0;
  const coChangeBoost = Math.min(0.35, Math.max(0, input.coChangeWeight) * 0.35);
  const raw = depthDecay + testBoost + coChangeBoost;
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))));
}
