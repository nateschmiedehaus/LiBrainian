/**
 * @fileoverview Impact Analysis Knowledge System
 *
 * Answers critical questions about change impact:
 * - What breaks if X changes?
 * - What tests need to run?
 * - What's the blast radius?
 * - How risky is this change?
 */

import type { LiBrainianStorage } from '../storage/types.js';
import { computeGraphMetrics } from '../graphs/metrics.js';
import { buildModuleGraphs, resolveTargetModule } from './module_graph.js';
import { calculateModuleComplexity } from './quality_metrics.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ImpactQuery {
  type:
    | 'change_impact'     // What is affected if X changes?
    | 'blast_radius'      // How far does a change propagate?
    | 'test_impact'       // What tests need to run?
    | 'risk_assessment'   // How risky is this change?
    | 'safe_changes'      // What can change safely?
    | 'breaking_changes'; // What would be a breaking change?

  target: string;
  changeType?: 'modify' | 'delete' | 'rename' | 'move';
  depth?: number;
}

export interface ImpactResult {
  query: ImpactQuery;
  affected?: AffectedItem[];
  tests?: TestImpact[];
  risk?: RiskAssessment;
  summary: string;
  recommendations: string[];
}

export interface AffectedItem {
  path: string;
  type: 'direct' | 'transitive';
  relationship: 'imports' | 'exports' | 'calls' | 'extends' | 'implements';
  confidence: number;
  reason: string;
}

export interface TestImpact {
  testFile: string;
  reason: string;
  priority: 'must_run' | 'should_run' | 'optional';
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: RiskFactor[];
  mitigations: string[];
}

export interface RiskFactor {
  name: string;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

// ============================================================================
// IMPACT KNOWLEDGE
// ============================================================================

export class ImpactKnowledge {
  constructor(private storage: LiBrainianStorage) {}

  async query(q: ImpactQuery): Promise<ImpactResult> {
    switch (q.type) {
      case 'change_impact':
        return this.analyzeChangeImpact(q);
      case 'blast_radius':
        return this.analyzeBlastRadius(q);
      case 'test_impact':
        return this.analyzeTestImpact(q);
      case 'risk_assessment':
        return this.assessRisk(q);
      case 'safe_changes':
        return this.findSafeChanges(q);
      case 'breaking_changes':
        return this.identifyBreakingChanges(q);
      default:
        return { query: q, summary: 'Unknown query type', recommendations: [] };
    }
  }

  private async analyzeChangeImpact(query: ImpactQuery): Promise<ImpactResult> {
    const modules = await this.storage.getModules();
    const targetModule = resolveTargetModule(modules, query.target);
    if (!targetModule) {
      return { query, affected: [], summary: `Module not found: ${query.target}`, recommendations: [] };
    }

    const { reverse } = buildModuleGraphs(modules);
    const maxDepth = query.depth ?? 3;
    const affected: AffectedItem[] = [];
    const visited = new Set<string>([targetModule.path]);
    const queue: Array<{ path: string; depth: number }> = [{ path: targetModule.path, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift() as { path: string; depth: number };
      if (current.depth >= maxDepth) continue;
      for (const dependent of reverse.get(current.path) ?? []) {
        if (visited.has(dependent)) continue;
        visited.add(dependent);
        const isDirect = current.depth === 0;
        affected.push({
          path: dependent,
          type: isDirect ? 'direct' : 'transitive',
          relationship: 'imports',
          confidence: isDirect ? 0.95 : 0.7,
          reason: isDirect
            ? `Directly imports ${targetModule.path}`
            : `Transitively depends on ${targetModule.path}`,
        });
        queue.push({ path: dependent, depth: current.depth + 1 });
      }
    }

    const recommendations: string[] = [];
    if (affected.length > 10) {
      recommendations.push('Consider incremental rollout due to wide impact');
    }
    if (affected.length > 20) {
      recommendations.push('High-impact change - ensure comprehensive testing');
    }

    return {
      query,
      affected,
      summary: `${affected.length} files would be affected by changes to ${query.target}`,
      recommendations,
    };
  }

  private async analyzeBlastRadius(query: ImpactQuery): Promise<ImpactResult> {
    const impactResult = await this.analyzeChangeImpact(query);
    const affected = impactResult.affected ?? [];
    const modules = await this.storage.getModules();
    const { graph } = buildModuleGraphs(modules);
    const { metrics } = computeGraphMetrics({ module: graph });
    const targetModule = resolveTargetModule(modules, query.target);
    const targetMetrics = targetModule ? metrics.find((m) => m.entityId === targetModule.path) : undefined;

    const directCount = affected.filter(a => a.type === 'direct').length;
    const transitiveCount = affected.filter(a => a.type === 'transitive').length;
    const blastPercentage = modules.length > 0 ? (affected.length / modules.length) * 100 : 0;
    const centralityScore = (targetMetrics?.pagerank ?? 0) + (targetMetrics?.betweenness ?? 0);

    let riskLevel: RiskAssessment['level'] = 'low';
    if (blastPercentage > 30 || centralityScore > 0.2) riskLevel = 'critical';
    else if (blastPercentage > 15 || centralityScore > 0.12) riskLevel = 'high';
    else if (blastPercentage > 5 || centralityScore > 0.05) riskLevel = 'medium';

    const risk: RiskAssessment = {
      level: riskLevel,
      score: Math.round(blastPercentage),
      factors: [
        {
          name: 'Direct dependents',
          impact: directCount > 10 ? 'high' : directCount > 5 ? 'medium' : 'low',
          description: `${directCount} files directly import this module`,
        },
        {
          name: 'Transitive dependents',
          impact: transitiveCount > 20 ? 'high' : transitiveCount > 10 ? 'medium' : 'low',
          description: `${transitiveCount} files transitively depend on this module`,
        },
        {
          name: 'Blast radius',
          impact: riskLevel === 'critical' ? 'high' : riskLevel === 'high' ? 'high' : riskLevel === 'medium' ? 'medium' : 'low',
          description: `${blastPercentage.toFixed(1)}% of codebase affected`,
        },
        {
          name: 'Centrality',
          impact: centralityScore > 0.15 ? 'high' : centralityScore > 0.08 ? 'medium' : 'low',
          description: `PageRank ${(targetMetrics?.pagerank ?? 0).toFixed(3)}, betweenness ${(targetMetrics?.betweenness ?? 0).toFixed(3)}`,
        },
      ],
      mitigations: [
        'Add comprehensive tests before changing',
        'Consider feature flags for gradual rollout',
        'Review with team members who own affected code',
      ],
    };

    return {
      query,
      affected,
      risk,
      summary: `Blast radius: ${affected.length} files (${blastPercentage.toFixed(1)}% of codebase)`,
      recommendations: riskLevel === 'critical' || riskLevel === 'high'
        ? ['This change has high blast radius - proceed with caution']
        : [],
    };
  }

  private async analyzeTestImpact(query: ImpactQuery): Promise<ImpactResult> {
    const impactResult = await this.analyzeChangeImpact(query);
    const affected = impactResult.affected ?? [];
    const modules = await this.storage.getModules();
    const targetModule = resolveTargetModule(modules, query.target);

    const tests: TestImpact[] = [];
    const targetName = targetModule?.path.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '');

    // Find tests for the target itself
    const directTests = modules.filter(m =>
      (m.path.includes('.test.') || m.path.includes('.spec.') || m.path.includes('__tests__')) &&
      targetName && m.path.toLowerCase().includes(targetName.toLowerCase())
    );

    for (const test of directTests) {
      tests.push({
        testFile: test.path,
        reason: `Tests ${query.target} directly`,
        priority: 'must_run',
      });
    }

    // Find tests for affected files
    for (const affectedItem of affected.filter(a => a.type === 'direct')) {
      const affectedName = affectedItem.path.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '');
      const relatedTests = modules.filter(m =>
        (m.path.includes('.test.') || m.path.includes('.spec.')) &&
        affectedName && m.path.toLowerCase().includes(affectedName.toLowerCase())
      );

      for (const test of relatedTests) {
        if (!tests.some(t => t.testFile === test.path)) {
          tests.push({
            testFile: test.path,
            reason: `Tests affected file ${affectedItem.path}`,
            priority: 'should_run',
          });
        }
      }
    }

    // Tests that directly depend on the target or affected modules
    for (const item of affected) {
      if (item.path.includes('.test.') || item.path.includes('.spec.') || item.path.includes('__tests__')) {
        if (!tests.some((t) => t.testFile === item.path)) {
          tests.push({
            testFile: item.path,
            reason: `Depends on ${targetModule?.path ?? query.target}`,
            priority: item.type === 'direct' ? 'must_run' : 'should_run',
          });
        }
      }
    }

    // Integration/E2E tests
    const integrationTests = modules.filter((m) => m.path.includes('integration') || m.path.includes('e2e'));

    for (const test of integrationTests.slice(0, 5)) {
      if (!tests.some(t => t.testFile === test.path)) {
        tests.push({
          testFile: test.path,
          reason: 'Integration test may be affected',
          priority: 'optional',
        });
      }
    }

    const mustRun = tests.filter(t => t.priority === 'must_run').length;
    const shouldRun = tests.filter(t => t.priority === 'should_run').length;

    return {
      query,
      tests,
      summary: `${mustRun} must run, ${shouldRun} should run`,
      recommendations: tests.length === 0
        ? ['No tests found for this module - consider adding tests before changing']
        : [],
    };
  }

  private async assessRisk(query: ImpactQuery): Promise<ImpactResult> {
    const blastResult = await this.analyzeBlastRadius(query);
    const testResult = await this.analyzeTestImpact(query);
    const modules = await this.storage.getModules();
    const functions = await this.storage.getFunctions();
    const targetModule = resolveTargetModule(modules, query.target);
    const { graph } = buildModuleGraphs(modules);
    const { metrics } = computeGraphMetrics({ module: graph });
    const targetMetrics = targetModule ? metrics.find((m) => m.entityId === targetModule.path) : undefined;

    const factors: RiskFactor[] = [...(blastResult.risk?.factors ?? [])];

    // Test coverage factor
    const mustRunTests = testResult.tests?.filter(t => t.priority === 'must_run').length ?? 0;
    factors.push({
      name: 'Test coverage',
      impact: mustRunTests === 0 ? 'high' : mustRunTests < 3 ? 'medium' : 'low',
      description: `${mustRunTests} direct tests exist`,
    });

    // Entry point factor
    const isEntryPoint = query.target.includes('/bin/') || query.target.endsWith('/index.ts');
    if (isEntryPoint) {
      factors.push({
        name: 'Entry point',
        impact: 'high',
        description: 'Changes to entry points affect system startup',
      });
    }

    // Public API factor
    if (targetModule && targetModule.exports.length > 0) {
      factors.push({
        name: 'Public API',
        impact: targetModule.exports.length > 10 ? 'high' : targetModule.exports.length > 5 ? 'medium' : 'low',
        description: `Exports ${targetModule.exports.length} symbols`,
      });
    }

    if (query.changeType) {
      factors.push({
        name: 'Change type',
        impact: query.changeType === 'delete' ? 'high' : query.changeType === 'rename' || query.changeType === 'move' ? 'medium' : 'low',
        description: `Planned change: ${query.changeType}`,
      });
    }

    if (targetModule) {
      const moduleComplexity = calculateModuleComplexity(functions, targetModule.path);
      factors.push({
        name: 'Complexity',
        impact: moduleComplexity.averageComplexity > 12 ? 'high' : moduleComplexity.averageComplexity > 8 ? 'medium' : 'low',
        description: `Average complexity ${moduleComplexity.averageComplexity.toFixed(1)} across ${moduleComplexity.functionCount} functions`,
      });
    }

    const centralityScore = (targetMetrics?.pagerank ?? 0) + (targetMetrics?.betweenness ?? 0);
    factors.push({
      name: 'Centrality',
      impact: centralityScore > 0.15 ? 'high' : centralityScore > 0.08 ? 'medium' : 'low',
      description: `Graph centrality ${(centralityScore * 100).toFixed(1)}%`,
    });

    // Calculate overall risk
    const highFactors = factors.filter(f => f.impact === 'high').length;
    const mediumFactors = factors.filter(f => f.impact === 'medium').length;
    const score = Math.min(100, highFactors * 25 + mediumFactors * 10);

    let level: RiskAssessment['level'] = 'low';
    if (score > 70) level = 'critical';
    else if (score > 50) level = 'high';
    else if (score > 25) level = 'medium';

    return {
      query,
      affected: blastResult.affected,
      tests: testResult.tests,
      risk: {
        level,
        score,
        factors,
        mitigations: [
          mustRunTests === 0 ? 'Add tests before changing' : 'Run existing tests',
          level === 'high' || level === 'critical' ? 'Consider incremental changes' : 'Standard review process',
          'Verify behavior in development environment',
        ],
      },
      summary: `Risk level: ${level} (score: ${score}/100)`,
      recommendations: level === 'critical'
        ? ['High-risk change - ensure thorough testing and review']
        : level === 'high'
        ? ['Elevated risk - verify tests pass before merging']
        : [],
    };
  }

  private async findSafeChanges(query: ImpactQuery): Promise<ImpactResult> {
    const modules = await this.storage.getModules();
    const affected: AffectedItem[] = [];
    const { reverse, graph } = buildModuleGraphs(modules);
    const { metrics } = computeGraphMetrics({ module: graph });

    // Find modules with no dependents (leaf modules)
    for (const mod of modules) {
      const count = reverse.get(mod.path)?.size ?? 0;
      const metric = metrics.find((m) => m.entityId === mod.path);
      const centrality = (metric?.pagerank ?? 0) + (metric?.betweenness ?? 0);
      if (count === 0 && centrality < 0.03 && !mod.path.includes('/bin/') && !mod.path.endsWith('/index.ts')) {
        affected.push({
          path: mod.path,
          type: 'direct',
          relationship: 'imports',
          confidence: 0.95,
          reason: 'No dependents and low centrality',
        });
      }
    }

    // Test files are always safe
    for (const mod of modules) {
      if (mod.path.includes('.test.') || mod.path.includes('.spec.') || mod.path.includes('__tests__')) {
        if (!affected.some(a => a.path === mod.path)) {
          affected.push({
            path: mod.path,
            type: 'direct',
            relationship: 'imports',
            confidence: 1.0,
            reason: 'Test file - changes only affect test behavior',
          });
        }
      }
    }

    return {
      query,
      affected: affected.slice(0, 30),
      summary: `${affected.length} modules can be changed with minimal risk`,
      recommendations: [],
    };
  }

  private async identifyBreakingChanges(query: ImpactQuery): Promise<ImpactResult> {
    const modules = await this.storage.getModules();
    const targetModule = modules.find(m => m.path.includes(query.target));

    if (!targetModule) {
      return { query, summary: `Module not found: ${query.target}`, recommendations: [] };
    }

    const factors: RiskFactor[] = [];

    // Exported symbols that would break on removal
    for (const exp of targetModule.exports.slice(0, 10)) {
      factors.push({
        name: `Removing export: ${exp}`,
        impact: 'high',
        description: 'Any code importing this symbol will break',
      });
    }

    if (targetModule.exports.length > 10) {
      factors.push({
        name: `...and ${targetModule.exports.length - 10} more exports`,
        impact: 'high',
        description: 'Additional exported symbols',
      });
    }

    factors.push({
      name: 'Changing function signatures',
      impact: 'high',
      description: 'Callers will need to update their code',
    });

    factors.push({
      name: 'Changing type definitions',
      impact: 'medium',
      description: 'Type-dependent code may fail to compile',
    });

    return {
      query,
      risk: {
        level: 'high',
        score: 75,
        factors,
        mitigations: [
          'Add deprecation warnings before removing exports',
          'Provide migration path for signature changes',
          'Version the API if breaking changes are necessary',
        ],
      },
      summary: `${factors.length} potential breaking changes identified`,
      recommendations: [
        'Consider backwards compatibility',
        'Communicate breaking changes clearly',
        'Update dependent code before removing exports',
      ],
    };
  }
}
