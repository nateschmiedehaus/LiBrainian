/**
 * @fileoverview Template Registry for Construction Templates
 *
 * Provides a single interface for template dispatch as specified in
 * docs/librarian/specs/core/construction-templates.md Section 2.
 *
 * This registry implements the "elegance mechanism" that prevents
 * "one-off handler creep" by mapping use cases to a small set of
 * reusable construction programs.
 */

import type { ContextPack } from '../types.js';
import type { AdequacyReport } from './difficulty_detectors.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type { KnowledgeObjectKind } from '../knowledge/registry.js';
import { createDeltaMapTemplate } from './delta_map_template.js';
import { createSupplyChainTemplate } from './supply_chain_template.js';
import { createInfraMapTemplate } from './infra_map_template.js';
import { createReproAndBisectTemplate } from './repro_bisect_template.js';
import { createUncertaintyReductionTemplate } from './uncertainty_reduction_template.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Output envelope specification for a template.
 * All templates must declare their output structure.
 */
export interface OutputEnvelopeSpec {
  packTypes: string[];
  requiresAdequacy: boolean;
  requiresVerificationPlan: boolean;
}

/**
 * Context provided to template execution.
 */
export interface TemplateContext {
  intent: string;
  workspace?: string;
  affectedFiles?: string[];
  depth?: 'shallow' | 'medium' | 'deep';
  tokenBudget?: number;
  timeBudgetMs?: number;
  ucHints?: string[];
}

/**
 * Evidence record for template selection.
 * Per spec requirement: "Template selection must be observable via evidence"
 */
export interface TemplateSelectionEvidence {
  templateId: string;
  selectedAt: string;
  reason: string;
  intentKeywords?: string[];
  ucMatch?: string;
  domainMatch?: string;
}

/**
 * Result from template execution.
 */
export interface TemplateResult {
  success: boolean;
  packs: ContextPack[];
  adequacy: AdequacyReport | null;
  verificationPlan: VerificationPlan | null;
  disclosures: string[];
  traceId: string;
  evidence: TemplateSelectionEvidence[];
}

/**
 * Construction template definition.
 * A named, reusable "program skeleton" that declares knowledge requirements
 * and produces agent-consumable outputs.
 */
export interface ConstructionTemplate {
  /** Template ID (e.g., 'T1', 'T2', etc.) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this template does */
  description: string;
  /** UC IDs this template handles */
  supportedUcs: string[];
  /** Maps needed (e.g., 'CallGraph', 'TestMap') */
  requiredMaps: string[];
  /** Optional maps that enhance the template */
  optionalMaps: string[];
  /** Required knowledge objects (RepoFacts/Maps/Claims/Packs/Episodes/Outcomes) */
  requiredObjects: KnowledgeObjectKind[];
  /** Optional knowledge objects */
  optionalObjects?: KnowledgeObjectKind[];
  /** Required artifacts (work objects, adequacy reports, etc.) */
  requiredArtifacts?: string[];
  /** Required adapters/capabilities */
  requiredCapabilities?: string[];
  /** Output envelope specification */
  outputEnvelope: OutputEnvelopeSpec;
  /** Execute the template with given context */
  execute(context: TemplateContext): Promise<TemplateResult>;
}

/**
 * Hints for intent-based template matching.
 */
export interface IntentHints {
  affectedFiles?: string[];
  depth?: 'shallow' | 'medium' | 'deep';
  tokenBudget?: number;
}

/**
 * Ranked template result from intent matching.
 */
export interface RankedTemplate {
  template: ConstructionTemplate;
  score: number;
  reasoning: string;
}

/**
 * Summary information about a template.
 */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  supportedUcs: string[];
  requiredMaps: string[];
  optionalMaps: string[];
  requiredObjects: KnowledgeObjectKind[];
  optionalObjects?: KnowledgeObjectKind[];
  requiredArtifacts?: string[];
  requiredCapabilities?: string[];
}

/**
 * Template registry interface.
 * Single entrypoint for template operations as required by spec.
 */
export interface TemplateRegistry {
  /** Get a specific template by ID */
  getConstructionTemplate(templateId: string): ConstructionTemplate | null;

  /** Get templates that can handle a use case */
  templatesForUc(ucId: string): ConstructionTemplate[];

  /** Get templates matching an intent with optional hints */
  templatesForIntent(intent: string, hints?: IntentHints): RankedTemplate[];

  /** Register a new template */
  register(template: ConstructionTemplate): void;

  /** List all registered templates */
  listTemplates(): TemplateInfo[];
}

// ============================================================================
// DOMAIN TO TEMPLATE MAPPING (from spec Section 6.1)
// ============================================================================

/**
 * Domain -> default templates mapping from spec Section 6.1.
 * This is the mechanical default so every UC is satisfiable by >= 1 template.
 */
export const DOMAIN_TO_TEMPLATES: Record<string, string[]> = {
  'API': ['T3'],
  'Agentic': ['T3', 'T4', 'T11'],
  'Architecture': ['T1'],
  'Behavior': ['T3', 'T4'],
  'Build/Test': ['T4', 'T5'],
  'Compliance': ['T10', 'T4'],
  'Config': ['T3'],
  'Data': ['T1', 'T4'],
  'Documentation': ['T1'],
  'Edge': ['T12'],
  'Impact': ['T2', 'T4', 'T5'],
  'Knowledge': ['T1', 'T12'],
  'Language': ['T1'],
  'Multi-Repo': ['T1', 'T2'],
  'Navigation': ['T3'],
  'Orientation': ['T1'],
  'Ownership': ['T1', 'T4'],
  'Performance': ['T4'],
  'Product': ['T1', 'T12'],
  'Project': ['T1', 'T12'],
  'Refactor': ['T3', 'T4'],
  'Release': ['T2', 'T4'],
  'Reliability': ['T4', 'T9'],
  'Runtime': ['T1', 'T8'],
  'Security': ['T4', 'T7'],
  'Synthesis': ['T12'],
};

/**
 * UC ID ranges to domains (from USE_CASE_MATRIX.md).
 * Used to infer domain from UC ID for template lookup.
 */
const UC_DOMAIN_RANGES: Array<{ start: number; end: number; domain: string }> = [
  { start: 1, end: 10, domain: 'Orientation' },
  { start: 11, end: 20, domain: 'Architecture' },
  { start: 21, end: 30, domain: 'Ownership' },
  { start: 31, end: 40, domain: 'Navigation' },
  { start: 41, end: 50, domain: 'Impact' },
  { start: 51, end: 60, domain: 'Behavior' },
  { start: 61, end: 70, domain: 'Data' },
  { start: 71, end: 80, domain: 'Build/Test' },
  { start: 81, end: 90, domain: 'Runtime' },
  { start: 91, end: 100, domain: 'Performance' },
  { start: 101, end: 110, domain: 'Security' },
  { start: 111, end: 120, domain: 'Compliance' },
  { start: 121, end: 130, domain: 'Config' },
  { start: 131, end: 140, domain: 'Refactor' },
  { start: 141, end: 150, domain: 'API' },
  { start: 151, end: 160, domain: 'Release' },
  { start: 161, end: 170, domain: 'Reliability' },
  { start: 171, end: 180, domain: 'Language' },
  { start: 181, end: 190, domain: 'Multi-Repo' },
  { start: 191, end: 200, domain: 'Product' },
  { start: 201, end: 210, domain: 'Project' },
  { start: 211, end: 220, domain: 'Agentic' },
  { start: 221, end: 230, domain: 'Documentation' },
  { start: 231, end: 240, domain: 'Knowledge' },
  { start: 241, end: 250, domain: 'Edge' },
  { start: 251, end: 260, domain: 'Synthesis' },
];

/**
 * Get domain from UC ID using UC_DOMAIN_RANGES.
 */
export function getDomainForUcId(ucId: string): string | null {
  const match = ucId.match(/^UC-?(\d+)$/);
  if (!match) {
    return null;
  }

  const ucNumber = parseInt(match[1], 10);
  for (const range of UC_DOMAIN_RANGES) {
    if (ucNumber >= range.start && ucNumber <= range.end) {
      return range.domain;
    }
  }

  return null;
}

// ============================================================================
// KEYWORD MATCHING FOR INTENT
// ============================================================================

/**
 * Keywords associated with each template for intent matching.
 */
const TEMPLATE_KEYWORDS: Record<string, string[]> = {
  'T1': [
    'repo', 'repository', 'map', 'structure', 'overview', 'inventory',
    'files', 'modules', 'architecture', 'orientation', 'navigate',
    'codebase', 'layout', 'organization', 'symbol', 'directory',
  ],
  'T2': [
    'change', 'changed', 'delta', 'diff', 'commit', 'modification',
    'update', 'recent', 'since', 'last', 'history', 'evolution',
  ],
  'T3': [
    'edit', 'context', 'modify', 'patch', 'fix', 'implement',
    'minimal', 'smallest', 'sufficient', 'scope', 'change',
  ],
  'T4': [
    'verify', 'verification', 'validate', 'check', 'safe', 'safety',
    'done', 'definition', 'complete', 'risk', 'impact', 'plan',
  ],
  'T5': [
    'test', 'tests', 'testing', 'select', 'impacted', 'run',
    'which', 'coverage', 'suite', 'regression',
  ],
  'T6': [
    'repro', 'reproduce', 'bisect', 'regression', 'localize',
    'find', 'bug', 'cause', 'minimize', 'script',
  ],
  'T7': [
    'supply', 'chain', 'dependency', 'sbom', 'license', 'provenance',
    'security', 'vulnerability', 'audit', 'package',
  ],
  'T8': [
    'infra', 'infrastructure', 'kubernetes', 'k8s', 'container',
    'docker', 'terraform', 'iac', 'deploy', 'service', 'build',
  ],
  'T9': [
    'observability', 'runbook', 'alert', 'metric', 'trace', 'log',
    'monitor', 'signal', 'instrumentation', 'ops',
  ],
  'T10': [
    'compliance', 'evidence', 'control', 'audit', 'policy',
    'regulation', 'requirement', 'certification', 'soc', 'gdpr',
  ],
  'T11': [
    'multi', 'agent', 'conflict', 'merge', 'coordinate', 'concurrent',
    'parallel', 'state', 'synchronize', 'collaboration',
  ],
  'T12': [
    'uncertain', 'uncertainty', 'question', 'gap', 'unknown',
    'next', 'reduce', 'clarify', 'what', 'why', 'how',
  ],
};

// ============================================================================
// STUB TEMPLATE FACTORY
// ============================================================================

function createStubExecute(templateId: string): (ctx: TemplateContext) => Promise<TemplateResult> {
  return async (ctx: TemplateContext): Promise<TemplateResult> => {
    const now = new Date().toISOString();
    return {
      success: true,
      packs: [],
      adequacy: null,
      verificationPlan: null,
      disclosures: [`stub_template(${templateId}): implementation pending`],
      traceId: `trace_${templateId}_${Date.now()}`,
      evidence: [{
        templateId,
        selectedAt: now,
        reason: `Stub execution for ${templateId}`,
      }],
    };
  };
}

// ============================================================================
// PRE-REGISTERED TEMPLATES (T1-T12)
// ============================================================================

function createDefaultTemplates(): ConstructionTemplate[] {
  return [
    // T1: RepoMap (token-budgeted repo-scale orientation)
    {
      id: 'T1',
      name: 'RepoMap',
      description: 'Provide a compact map of repo structure and key symbols that fits a specified token budget.',
      supportedUcs: ['UC-001', 'UC-002', 'UC-003', 'UC-010', 'UC-011'],
      requiredMaps: ['RepoMap', 'SymbolMap', 'ModuleMap'],
      optionalMaps: ['OwnerMap'],
      requiredObjects: ['repo_fact', 'map', 'pack'],
      outputEnvelope: {
        packTypes: ['RepoMapPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: false,
      },
      execute: createStubExecute('T1'),
    },
    // T2: DeltaMap (what changed since last run and why it matters)
    // Uses the real implementation from delta_map_template.ts
    createDeltaMapTemplate(),
    // T3: EditContext (smallest sufficient context for a patch)
    {
      id: 'T3',
      name: 'EditContext',
      description: 'Provide the smallest sufficient context for editing code.',
      supportedUcs: ['UC-031', 'UC-032', 'UC-033', 'UC-034'],
      requiredMaps: ['CallGraph', 'ImportGraph'],
      optionalMaps: ['TestMap', 'OwnerMap'],
      requiredObjects: ['map', 'pack'],
      outputEnvelope: {
        packTypes: ['EditContextPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: true,
      },
      execute: createStubExecute('T3'),
    },
    // T4: VerificationPlan (Definition-of-Done + work objects)
    {
      id: 'T4',
      name: 'VerificationPlan',
      description: 'Generate Definition-of-Done and work objects for verification.',
      supportedUcs: ['UC-042', 'UC-044', 'UC-046'],
      requiredMaps: ['ImpactMap', 'RiskMap', 'TestMap', 'OwnerMap'],
      optionalMaps: [],
      requiredObjects: ['map', 'pack'],
      requiredArtifacts: ['work_objects'],
      outputEnvelope: {
        packTypes: ['VerificationPlanPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: true,
      },
      execute: createStubExecute('T4'),
    },
    // T5: TestSelection (impacted tests + uncertainty disclosure)
    {
      id: 'T5',
      name: 'TestSelection',
      description: 'Select impacted tests with uncertainty disclosure.',
      supportedUcs: ['UC-035', 'UC-042'],
      requiredMaps: ['TestMap', 'DepMap', 'ImpactMap'],
      optionalMaps: [],
      requiredObjects: ['map', 'pack'],
      outputEnvelope: {
        packTypes: ['TestSelectionPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: false,
      },
      execute: createStubExecute('T5'),
    },
    // T6: ReproAndBisect (repro scripts + minimization + regression localization)
    // Uses the real implementation from repro_bisect_template.ts
    createReproAndBisectTemplate(),
    // T7: SupplyChain (SBOM + dependency risk + license/provenance evidence)
    createSupplyChainTemplate(),
    // T8: InfraMap (k8s/IaC/container/build graph to services/owners/risk)
    // Uses the real implementation from infra_map_template.ts
    createInfraMapTemplate(),
    // T9: ObservabilityRunbooks (signals -> runbooks + instrumentation plans)
    {
      id: 'T9',
      name: 'ObservabilityRunbooks',
      description: 'Map signals to runbooks and generate instrumentation plans.',
      supportedUcs: ['UC-161', 'UC-162'],
      requiredMaps: ['ObsMap', 'RunbookMap'],
      optionalMaps: [],
      requiredObjects: ['map', 'pack'],
      outputEnvelope: {
        packTypes: ['ObservabilityPack', 'InstrumentationPlanPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: true,
      },
      execute: createStubExecute('T9'),
    },
    // T10: ComplianceEvidence (controls -> evidence packs)
    {
      id: 'T10',
      name: 'ComplianceEvidence',
      description: 'Map controls to evidence packs for compliance.',
      supportedUcs: ['UC-111', 'UC-112'],
      requiredMaps: ['ComplianceMap'],
      optionalMaps: ['OwnerMap', 'AuditMap'],
      requiredObjects: ['map', 'pack'],
      outputEnvelope: {
        packTypes: ['ComplianceEvidencePack'],
        requiresAdequacy: true,
        requiresVerificationPlan: true,
      },
      execute: createStubExecute('T10'),
    },
    // T11: MultiAgentState (conflict-aware merge + explicit conflict objects)
    {
      id: 'T11',
      name: 'MultiAgentState',
      description: 'Handle multi-agent state with conflict-aware merge.',
      supportedUcs: ['UC-211', 'UC-212'],
      requiredMaps: [],
      optionalMaps: ['ChangeMap', 'OwnerMap'],
      requiredObjects: ['claim', 'pack'],
      requiredArtifacts: ['work_objects'],
      outputEnvelope: {
        packTypes: ['ConflictPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: false,
      },
      execute: createStubExecute('T11'),
    },
    // T12: UncertaintyReduction (next-best question and gap closure)
    createUncertaintyReductionTemplate(),
  ];
}

// ============================================================================
// TEMPLATE REGISTRY IMPLEMENTATION
// ============================================================================

class TemplateRegistryImpl implements TemplateRegistry {
  private templates = new Map<string, ConstructionTemplate>();

  constructor() {
    // Pre-register default templates T1-T12
    for (const template of createDefaultTemplates()) {
      this.templates.set(template.id, template);
    }
  }

  getConstructionTemplate(templateId: string): ConstructionTemplate | null {
    return this.templates.get(templateId) ?? null;
  }

  templatesForUc(ucId: string): ConstructionTemplate[] {
    const result: ConstructionTemplate[] = [];

    // First, check templates that explicitly support this UC
    for (const template of this.templates.values()) {
      if (template.supportedUcs.includes(ucId)) {
        result.push(template);
      }
    }

    // Then, add domain-based defaults
    const domain = getDomainForUcId(ucId);
    if (domain) {
      const domainTemplateIds = DOMAIN_TO_TEMPLATES[domain] ?? [];
      for (const templateId of domainTemplateIds) {
        const template = this.templates.get(templateId);
        if (template && !result.includes(template)) {
          result.push(template);
        }
      }
    }

    return result;
  }

  templatesForIntent(intent: string, hints?: IntentHints): RankedTemplate[] {
    const ranked: RankedTemplate[] = [];
    const intentLower = intent.toLowerCase();
    const intentWords = new Set(intentLower.split(/\s+/));

    for (const template of this.templates.values()) {
      const keywords = TEMPLATE_KEYWORDS[template.id] ?? [];
      let score = 0;
      const matchedKeywords: string[] = [];

      // Score based on keyword matches
      for (const keyword of keywords) {
        if (intentLower.includes(keyword)) {
          score += 1;
          matchedKeywords.push(keyword);
        }
        // Bonus for exact word match
        if (intentWords.has(keyword)) {
          score += 0.5;
        }
      }

      // Apply hints
      if (hints) {
        // Depth hint
        if (hints.depth === 'deep') {
          if (['T1', 'T4', 'T7'].includes(template.id)) {
            score += 0.5;
          }
        } else if (hints.depth === 'shallow') {
          if (['T3', 'T12'].includes(template.id)) {
            score += 0.5;
          }
        }

        // Affected files hint boosts T3 EditContext
        if (hints.affectedFiles && hints.affectedFiles.length > 0) {
          if (template.id === 'T3') {
            score += 1;
          }
        }

        // Token budget hint favors compact templates
        if (hints.tokenBudget !== undefined && hints.tokenBudget < 2000) {
          if (['T1', 'T3'].includes(template.id)) {
            score += 0.3;
          }
        }
      }

      if (score > 0) {
        const reasoning = matchedKeywords.length > 0
          ? `Matched keywords: ${matchedKeywords.join(', ')}`
          : `Score: ${score.toFixed(2)} based on hints`;
        ranked.push({ template, score, reasoning });
      }
    }

    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    return ranked;
  }

  register(template: ConstructionTemplate): void {
    this.templates.set(template.id, template);
  }

  listTemplates(): TemplateInfo[] {
    const list: TemplateInfo[] = [];
    for (const template of this.templates.values()) {
      list.push({
        id: template.id,
        name: template.name,
        description: template.description,
        supportedUcs: template.supportedUcs.slice(),
        requiredMaps: template.requiredMaps.slice(),
        optionalMaps: template.optionalMaps.slice(),
        requiredObjects: template.requiredObjects.slice(),
        optionalObjects: template.optionalObjects ? template.optionalObjects.slice() : undefined,
        requiredArtifacts: template.requiredArtifacts ? template.requiredArtifacts.slice() : undefined,
        requiredCapabilities: template.requiredCapabilities ? template.requiredCapabilities.slice() : undefined,
      });
    }
    return list;
  }

}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new template registry with pre-registered T1-T12 templates.
 */
export function createTemplateRegistry(): TemplateRegistry {
  return new TemplateRegistryImpl();
}

/**
 * Default singleton registry instance.
 */
let defaultRegistry: TemplateRegistry | null = null;

/**
 * Get the default template registry singleton.
 */
export function getDefaultTemplateRegistry(): TemplateRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createTemplateRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (useful for testing).
 */
export function resetDefaultTemplateRegistry(): void {
  defaultRegistry = null;
}
