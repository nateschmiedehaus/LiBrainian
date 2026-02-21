/**
 * @fileoverview LiBrainian Knowledge System
 *
 * High-level knowledge queries that leverage existing infrastructure:
 * - graphs/ - PageRank, centrality, communities, embeddings
 * - storage/ - module and function knowledge
 *
 * This module provides semantic queries on top of the raw data.
 */

import type { LiBrainianStorage } from '../storage/types.js';
import { computeGraphMetrics, type GraphMetricsEntry } from '../graphs/metrics.js';
import { buildModuleGraphs } from './module_graph.js';
import { ArchitectureKnowledge } from './architecture.js';
import { ImpactKnowledge } from './impact.js';
import { QualityKnowledge } from './quality.js';
import { PatternKnowledge } from './patterns.js';
import { StructureKnowledge } from './structure.js';
import { EvolutionKnowledge } from './evolution.js';

// Re-export Universal Knowledge types (the unified schema)
export type {
  UniversalKnowledge,
  EntityKind,
  EntityLocation,
  Visibility,
  EntitySemantics,
  EntityContract,
  EntityRelationships,
  EntityQuality,
  EntitySecurity,
  EntityRuntime,
  EntityTesting,
  EntityHistory,
  EntityOwnership,
  EntityRationale,
  EntityContext,
  EntityTraceability,
  KnowledgeMeta,
} from './universal_types.js';
export { createEmptyKnowledge, KNOWLEDGE_QUESTION_MAP } from './universal_types.js';
export type {
  SectionType,
  IdentitySection,
  KnowledgeSection,
  SectionedKnowledge,
  SectionedKnowledgeOptions,
} from './sectioned_knowledge.js';
export {
  createSectionedKnowledge,
  createLazySectionedKnowledge,
  SECTION_TYPES,
} from './sectioned_knowledge.js';
export type {
  EvidenceClaim,
  EvidenceRecord,
  EvidenceStore,
  EvidenceContradiction,
  EvidenceValidation,
  EvidenceOutcome,
  EvidenceAgingConfig,
  EvidenceWeightConfig,
  ActiveEvidenceEngineConfig,
} from './evidence_system.js';
export { ActiveEvidenceEngine } from './evidence_system.js';
export {
  KnowledgeObjectRegistry,
  createKnowledgeObjectRegistry,
  DEFAULT_KNOWLEDGE_OBJECT_DEFINITIONS,
  REQUIRED_KNOWLEDGE_OBJECT_KINDS,
  type KnowledgeObject,
  type KnowledgeObjectBase,
  type KnowledgeObjectDefinition,
  type KnowledgeObjectKind,
  type KnowledgeInvalidationRule,
  type KnowledgeInvalidationMode,
  type KnowledgeInvalidationTrigger,
} from './registry.js';
export {
  ConstructionTemplateRegistry,
  createConstructionTemplateRegistry,
  DEFAULT_CONSTRUCTION_TEMPLATES,
  DEFAULT_TEMPLATE_IDS,
  type ConstructionTemplate,
  type ConstructionTemplateId,
  type IntentTemplateResolver,
  type TemplateIntentHints,
  type TemplateSelection,
} from './construction_templates.js';
export {
  buildUcTemplateMapping,
  resolveTemplatesForUc,
  type UcTemplateMappingResult,
} from './uc_template_mapping.js';

// Re-export Universal Knowledge generator
export {
  UniversalKnowledgeGenerator,
  createKnowledgeGenerator,
  type KnowledgeGeneratorConfig,
  type GenerationResult,
  type GenerationError,
} from './generator.js';

// Re-export field extractors
// NOTE: extractSemantics (heuristic-only) is NOT exported - use extractSemanticsWithLLM
export {
  extractIdentity,
  extractSemanticsWithLLM,
  extractQuality,
  type IdentityExtraction,
  type SemanticsExtraction,
  type QualityExtraction,
} from './extractors/index.js';

// Re-export specialized knowledge modules
export { ArchitectureKnowledge } from './architecture.js';
export type {
  ArchitectureQuery,
  ArchitectureResult,
  DependencyNode,
  ArchitecturalLayer,
  DependencyCycle,
  CouplingMetrics,
  CoreModule,
  ArchitectureViolation,
} from './architecture.js';

export { ImpactKnowledge } from './impact.js';
export type {
  ImpactQuery,
  ImpactResult,
  AffectedItem,
  TestImpact,
  RiskAssessment,
  RiskFactor,
} from './impact.js';

export { QualityKnowledge } from './quality.js';
export type {
  QualityQuery,
  QualityResult,
  ComplexityAnalysis,
  CodeSmell,
  TechnicalDebt,
  RefactoringCandidate,
  QualityScore,
} from './quality.js';

export { PatternKnowledge, T_PATTERN_REGISTRY } from './patterns.js';
export type {
  PatternQuery,
  PatternResult,
  DetectedPattern,
  DetectedAntiPattern,
  NamingConvention,
  PatternOccurrence,
  PatternLLMConfig,
  TPatternAnalysisResult,
} from './patterns.js';

// Re-export T-pattern utilities
export {
  analyzeAllTPatterns,
  analyzeT01FunctionByName,
  analyzeT02SemanticSearch,
  analyzeT03CallGraph,
  analyzeT04DependencyGraph,
  analyzeT05InterfaceImplementation,
  analyzeT06TestMapping,
  analyzeT07FunctionPurpose,
  analyzeT08ModuleArchitecture,
  analyzeT09DesignPatterns,
  analyzeT10ErrorHandling,
  analyzeT11DataFlow,
  analyzeT12SideEffects,
  analyzeT13UsageAnalysis,
  analyzeT14BreakingChanges,
  analyzeT15SimilarPatterns,
  analyzeT16FeatureLocation,
  analyzeT17TestGaps,
  analyzeT18Configuration,
  analyzeT19ErrorSource,
  analyzeT20RelatedBugs,
  analyzeT21RaceConditions,
  analyzeT22NullHazards,
  analyzeT23ExceptionPropagation,
  analyzeT24DeadCode,
  analyzeT28PerformanceAntiPatterns,
  analyzeT29CircularDependencies,
  type TPatternDefinition,
} from './t_patterns.js';

export { StructureKnowledge } from './structure.js';
export type {
  StructureQuery,
  StructureResult,
  OrganizationAnalysis,
  DirectoryInfo,
  EntryPoint,
  ExportAnalysis,
  FileTypeBreakdown,
} from './structure.js';

// Entry point detection
export {
  detectEntryPoints,
  isEntryPointQuery,
  scoreEntryPointForQuery,
  ENTRY_POINT_QUERY_PATTERNS,
} from './entry_point_detector.js';
export type {
  DetectedEntryPoint,
  EntryPointKind,
  EntryPointDetectionResult,
  EntryPointDetectionOptions,
} from './entry_point_detector.js';

export { EvolutionKnowledge } from './evolution.js';
export type {
  EvolutionQuery,
  EvolutionResult,
  FitnessMetrics,
  LearningInsight,
  OptimizationOpportunity,
  TaskOutcome,
} from './evolution.js';

// Re-export durability classification system
export {
  FileDurability,
  classifyDurability,
  isImmutablePath,
  shouldRevalidate,
  getRevalidationPriority,
  getRevalidationDecision,
  createEmptyStats,
  updateStats,
  calculateSkipPercentage,
  classifyBatch,
  DurabilityTracker,
  createDurabilityTracker,
  DEFAULT_DURABILITY_CONFIG,
  REVALIDATION_PRIORITY,
} from './durability.js';
export type {
  DurabilityConfig,
  DurabilityStats,
  RevalidationDecision,
  FileInfo,
  BatchClassificationResult,
} from './durability.js';

// Re-export code pattern library for agents
export {
  PatternLibrary,
  isCodePatternQuery,
  extractPatternCategory,
  handleCodePatternQuery,
  CODE_PATTERN_QUERY_PATTERNS,
} from './code_patterns.js';
export type {
  CodePattern,
  PatternCategory,
  PatternQueryResult,
  PatternLibraryBuildOptions,
} from './code_patterns.js';

import type { ArchitectureQuery, ArchitectureResult } from './architecture.js';
import type { ImpactQuery, ImpactResult } from './impact.js';
import type { QualityQuery, QualityResult } from './quality.js';
import type { PatternQuery, PatternResult } from './patterns.js';
import type { StructureQuery, StructureResult } from './structure.js';
import type { EvolutionQuery, EvolutionResult } from './evolution.js';

// ============================================================================
// UNIFIED KNOWLEDGE INTERFACE
// ============================================================================

export type KnowledgeCategory =
  | 'architecture'
  | 'impact'
  | 'quality'
  | 'patterns'
  | 'structure'
  | 'evolution';

export type KnowledgeQuery =
  | { category: 'architecture'; query: ArchitectureQuery }
  | { category: 'impact'; query: ImpactQuery }
  | { category: 'quality'; query: QualityQuery }
  | { category: 'patterns'; query: PatternQuery }
  | { category: 'structure'; query: StructureQuery }
  | { category: 'evolution'; query: EvolutionQuery };

export type KnowledgeResult =
  | ArchitectureResult
  | ImpactResult
  | QualityResult
  | PatternResult
  | StructureResult
  | EvolutionResult;

// ============================================================================
// KNOWLEDGE ENGINE
// ============================================================================

export class Knowledge {
  readonly architecture: ArchitectureKnowledge;
  readonly impact: ImpactKnowledge;
  readonly quality: QualityKnowledge;
  readonly patterns: PatternKnowledge;
  readonly structure: StructureKnowledge;
  readonly evolution: EvolutionKnowledge;

  constructor(private storage: LiBrainianStorage) {
    this.architecture = new ArchitectureKnowledge(storage);
    this.impact = new ImpactKnowledge(storage);
    this.quality = new QualityKnowledge(storage);
    this.patterns = new PatternKnowledge(storage);
    this.structure = new StructureKnowledge(storage);
    this.evolution = new EvolutionKnowledge(storage);
  }

  async query(q: KnowledgeQuery): Promise<KnowledgeResult> {
    switch (q.category) {
      case 'architecture':
        return this.architecture.query(q.query);
      case 'impact':
        return this.impact.query(q.query);
      case 'quality':
        return this.quality.query(q.query);
      case 'patterns':
        return this.patterns.query(q.query);
      case 'structure':
        return this.structure.query(q.query);
      case 'evolution':
        return this.evolution.query(q.query);
      default:
        return assertNever(q);
    }
  }

  /**
   * Get comprehensive codebase health report using graph metrics.
   */
  async getHealthReport(): Promise<{
    modules: number;
    functions: number;
    communities: number;
    bridges: number;
    coreModules: Array<{ path: string; score: number; reasons: string[] }>;
    qualityScore: number;
    graphMetrics: GraphMetricsEntry[];
  }> {
    const modules = await this.storage.getModules();
    const functions = await this.storage.getFunctions();
    const { graph } = buildModuleGraphs(modules);
    const { metrics, report } = computeGraphMetrics({ module: graph });

    const coreModules = metrics
      .sort((a, b) => (b.pagerank + b.betweenness) - (a.pagerank + a.betweenness))
      .slice(0, 10)
      .map((m) => ({
        path: m.entityId,
        score: Number(((m.pagerank + m.betweenness) * 100).toFixed(2)),
        reasons: [
          `pagerank ${(m.pagerank * 100).toFixed(2)}%`,
          `betweenness ${(m.betweenness * 100).toFixed(2)}%`,
          m.isBridge ? 'bridge module' : 'internal module',
        ],
      }));

    const avgBetweenness = metrics.reduce((sum, m) => sum + m.betweenness, 0) / (metrics.length || 1);
    const qualityScore = Math.round(Math.max(0, 100 - avgBetweenness * 120));

    return {
      modules: modules.length,
      functions: functions.length,
      communities: report.totals.communities,
      bridges: report.totals.bridges,
      coreModules,
      qualityScore,
      graphMetrics: metrics,
    };
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled knowledge category: ${JSON.stringify(value)}`);
}
