/**
 * @fileoverview Unified Evidence Collector with Defeaters
 *
 * This module implements an epistemologically sound approach to knowledge:
 * - Every claim is backed by evidence
 * - Evidence has types, sources, and confidence levels
 * - Defeaters track what could invalidate knowledge
 * - Staleness detection identifies when knowledge needs refresh
 *
 * Based on:
 * - Argumentation theory (Pollock's defeaters)
 * - Epistemic logic (justified true belief)
 * - KDD 2025 Uncertainty Quantification survey
 */

import type {
  KnowledgeMeta,
  MetaConfidence,
  Evidence,
  EvidenceType,
  Defeater,
  DefeaterType,
  UncertaintyProfile,
  UncertaintyReducer,
} from '../universal_types.js';

import type { QualityExtraction } from './quality_extractor.js';
import type { SecurityExtraction } from './security_extractor.js';
import type { TestingExtraction } from './testing_extractor.js';
import type { HistoryExtraction, OwnershipExtraction } from './history_extractor.js';
import type { RationaleExtraction } from './rationale_extractor.js';
import type { TraceabilityExtraction } from './traceability_extractor.js';
import type { SemanticsExtraction } from './semantics.js';
import type { IdentityExtraction } from './identity.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EvidenceCollectionInput {
  entityId: string;
  entityName: string;
  filePath: string;
  contentHash: string;

  // All extraction results
  identity?: IdentityExtraction;
  semantics?: SemanticsExtraction;
  quality?: QualityExtraction;
  security?: SecurityExtraction;
  testing?: TestingExtraction;
  history?: HistoryExtraction;
  ownership?: OwnershipExtraction;
  rationale?: RationaleExtraction;
  traceability?: TraceabilityExtraction;

  // Context
  lastModified?: string;
  workspaceRoot?: string;
  generatedBy?: string;
}

export interface EvidenceCollectionResult {
  meta: KnowledgeMeta;
  evidenceBySection: Map<string, Evidence[]>;
  defeatersBySection: Map<string, Defeater[]>;
}

// Evidence weight configuration
const EVIDENCE_WEIGHTS: Record<EvidenceType, number> = {
  test: 0.95,       // Tests are strong evidence
  code: 0.85,       // Actual code is reliable
  commit: 0.75,     // Git history is factual
  comment: 0.60,    // Comments may be stale
  doc: 0.55,        // Docs may be outdated
  usage: 0.70,      // Runtime usage data
  inferred: 0.40,   // LLM inference is less certain
};

// Staleness thresholds (in days)
const STALENESS_THRESHOLDS = {
  critical: 7,     // Security, tests
  high: 30,        // Quality metrics
  medium: 90,      // Semantics, relationships
  low: 365,        // Identity, history
};

// ============================================================================
// CHANGE-BASED CONFIDENCE DECAY
// ============================================================================
//
// DESIGN PRINCIPLE: Confidence decays based on GRAPH CHANGES, not calendar time.
// Code doesn't become less reliable because 30 days passed - it becomes less
// reliable when its dependencies, callers, or co-modified files change.
//
// Decay triggers:
// 1. Direct change: File modified since indexed → needs full reindex
// 2. Dependency change: Import target modified → decay by edge strength
// 3. Caller/callee change: Call graph neighbor modified → small decay
// 4. Cochange partner: Historically co-modified file changed → decay by cochange strength

/**
 * Information about graph changes since an entity was indexed.
 * Used to compute change-based confidence decay.
 */
export interface ChangeContext {
  /** Whether this entity's file was modified since last indexed */
  directlyModified: boolean;

  /** Dependencies (imports) that changed since this entity was indexed */
  changedDependencies: Array<{
    targetId: string;
    edgeConfidence: number;  // Strength of the dependency edge
  }>;

  /** Callers/callees that changed since this entity was indexed */
  changedCallGraph: Array<{
    targetId: string;
    edgeConfidence: number;  // Strength of the call edge
  }>;

  /** Files that historically change together that were modified */
  changedCochangePartners: Array<{
    filePath: string;
    cochangeStrength: number;  // 0-1 based on historical co-modification
  }>;
}

/**
 * Compute change-based confidence decay.
 *
 * Unlike time-based decay, this only reduces confidence when actual
 * graph changes occur that could invalidate the knowledge.
 *
 * @param baseConfidence - The entity's confidence before decay
 * @param changes - Information about what changed in the graph
 * @returns Decayed confidence value
 */
export function calculateChangeBasedDecay(
  baseConfidence: number,
  changes: ChangeContext
): number {
  // Direct modification = full invalidation (needs reindex)
  if (changes.directlyModified) {
    return 0.10; // Minimum confidence - must be reindexed
  }

  let decayFactor = 1.0;

  // Dependency changes: strongest impact
  // If an imported module changes, our understanding may be outdated
  for (const dep of changes.changedDependencies) {
    // Decay proportional to edge confidence (stronger edge = more impact)
    // Each changed dependency reduces confidence by up to 15%
    const impact = dep.edgeConfidence * 0.15;
    decayFactor *= (1 - impact);
  }

  // Call graph changes: moderate impact
  // If callers/callees change, context may be outdated
  for (const edge of changes.changedCallGraph) {
    // Each changed caller/callee reduces confidence by up to 8%
    const impact = edge.edgeConfidence * 0.08;
    decayFactor *= (1 - impact);
  }

  // Cochange partners: weak but cumulative impact
  // Files that historically change together suggest coupling
  for (const partner of changes.changedCochangePartners) {
    // Each changed cochange partner reduces confidence by up to 5%
    const impact = partner.cochangeStrength * 0.05;
    decayFactor *= (1 - impact);
  }

  // Apply decay, but never below 10% of original
  const decayedConfidence = baseConfidence * decayFactor;
  const minConfidence = baseConfidence * 0.1;

  return Math.max(minConfidence, Math.min(baseConfidence, decayedConfidence));
}

/**
 * Build a ChangeContext from storage data.
 * This queries the graph to determine what has changed since indexing.
 *
 * @param entityId - The entity to check
 * @param lastIndexedAt - When the entity was last indexed
 * @param getModifiedSince - Function to get files modified since a timestamp
 * @param getDependencies - Function to get entity's dependencies
 * @param getCallGraphEdges - Function to get entity's call graph edges
 * @param getCochangePartners - Function to get cochange partners
 * @returns ChangeContext for decay calculation
 */
export async function buildChangeContext(
  entityId: string,
  entityPath: string,
  lastIndexedAt: Date,
  getModifiedSince: (since: Date) => Promise<Set<string>>,
  getDependencies: (entityId: string) => Promise<Array<{ targetId: string; targetPath: string; confidence: number }>>,
  getCallGraphEdges: (entityId: string) => Promise<Array<{ targetId: string; targetPath: string; confidence: number }>>,
  getCochangePartners: (filePath: string) => Promise<Array<{ filePath: string; strength: number }>>
): Promise<ChangeContext> {
  const modifiedFiles = await getModifiedSince(lastIndexedAt);

  // Check if this entity's file was directly modified
  const directlyModified = modifiedFiles.has(entityPath);

  // Check dependencies
  const dependencies = await getDependencies(entityId);
  const changedDependencies = dependencies
    .filter(dep => modifiedFiles.has(dep.targetPath))
    .map(dep => ({ targetId: dep.targetId, edgeConfidence: dep.confidence }));

  // Check call graph
  const callEdges = await getCallGraphEdges(entityId);
  const changedCallGraph = callEdges
    .filter(edge => modifiedFiles.has(edge.targetPath))
    .map(edge => ({ targetId: edge.targetId, edgeConfidence: edge.confidence }));

  // Check cochange partners
  const cochangePartners = await getCochangePartners(entityPath);
  const changedCochangePartners = cochangePartners
    .filter(partner => modifiedFiles.has(partner.filePath))
    .map(partner => ({ filePath: partner.filePath, cochangeStrength: partner.strength }));

  return {
    directlyModified,
    changedDependencies,
    changedCallGraph,
    changedCochangePartners,
  };
}

/**
 * @deprecated Use calculateChangeBasedDecay instead.
 * Time-based decay is incorrect - code doesn't get stale with calendar time,
 * it gets stale when the graph changes.
 *
 * This function is kept for backwards compatibility but should not be used.
 */
export function calculateStalenessDecay(
  generatedAt: string,
  sections: string[],
  currentConfidence: number
): number {
  // DEPRECATED: Prefer calculateChangeBasedDecay; this is a conservative fallback.
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) return currentConfidence;
  const ageMs = Date.now() - generatedAtMs;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return currentConfidence;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  let minDays = STALENESS_THRESHOLDS.low;
  for (const section of sections) {
    minDays = Math.min(minDays, STALENESS_THRESHOLDS[getSectionThreshold(section)]);
  }
  const window = Math.max(1, minDays * 6);
  const decayRatio = Math.min(1, Math.max(0, ageDays / window));
  const decay = Math.min(0.6, decayRatio * 0.4);
  const decayed = currentConfidence * (1 - decay);
  const minConfidence = Math.max(0.1, currentConfidence * 0.25);
  return Math.max(minConfidence, Math.min(currentConfidence, decayed));
}

function getSectionThreshold(section: string): keyof typeof STALENESS_THRESHOLDS {
  switch (section) {
    case 'security':
    case 'testing':
      return 'critical';
    case 'quality':
      return 'high';
    case 'semantics':
    case 'rationale':
    case 'relationships':
      return 'medium';
    default:
      return 'low';
  }
}

// ============================================================================
// MAIN COLLECTOR
// ============================================================================

/**
 * Collect and unify evidence from all extractors.
 * Build a complete epistemological profile of the knowledge.
 */
export function collectEvidence(input: EvidenceCollectionInput): EvidenceCollectionResult {
  const evidenceBySection = new Map<string, Evidence[]>();
  const defeatersBySection = new Map<string, Defeater[]>();
  const sectionConfidences: Record<string, number> = {};
  const llmEvidence: KnowledgeMeta['llmEvidence'] = {};

  // Collect evidence from each section
  if (input.identity) {
    const { evidence, defeaters } = collectIdentityEvidence(input);
    evidenceBySection.set('identity', evidence);
    defeatersBySection.set('identity', defeaters);
    sectionConfidences['identity'] = input.identity.confidence;
  }

  if (input.semantics) {
    const { evidence, defeaters } = collectSemanticsEvidence(input);
    evidenceBySection.set('semantics', evidence);
    defeatersBySection.set('semantics', defeaters);
    sectionConfidences['semantics'] = input.semantics.confidence;
    if (input.semantics.llmEvidence) {
      llmEvidence['semantics'] = input.semantics.llmEvidence;
    }
  }

  if (input.quality) {
    const { evidence, defeaters } = collectQualityEvidence(input);
    evidenceBySection.set('quality', evidence);
    defeatersBySection.set('quality', defeaters);
    sectionConfidences['quality'] = input.quality.confidence;
  }

  if (input.security) {
    const { evidence, defeaters } = collectSecurityEvidence(input);
    evidenceBySection.set('security', evidence);
    defeatersBySection.set('security', defeaters);
    sectionConfidences['security'] = input.security.confidence;
    if (input.security.llmEvidence) {
      llmEvidence['security'] = input.security.llmEvidence;
    }
  }

  if (input.testing) {
    const { evidence, defeaters } = collectTestingEvidence(input);
    evidenceBySection.set('testing', evidence);
    defeatersBySection.set('testing', defeaters);
    sectionConfidences['testing'] = input.testing.confidence;
  }

  if (input.history) {
    const { evidence, defeaters } = collectHistoryEvidence(input);
    evidenceBySection.set('history', evidence);
    defeatersBySection.set('history', defeaters);
    sectionConfidences['history'] = input.history.confidence;
  }

  if (input.ownership) {
    const { evidence, defeaters } = collectOwnershipEvidence(input);
    evidenceBySection.set('ownership', evidence);
    defeatersBySection.set('ownership', defeaters);
    sectionConfidences['ownership'] = input.ownership.confidence;
  }

  if (input.rationale) {
    const { evidence, defeaters } = collectRationaleEvidence(input);
    evidenceBySection.set('rationale', evidence);
    defeatersBySection.set('rationale', defeaters);
    sectionConfidences['rationale'] = input.rationale.confidence;
    if (input.rationale.llmEvidence) {
      llmEvidence['rationale'] = input.rationale.llmEvidence;
    }
  }

  if (input.traceability) {
    const { evidence, defeaters } = collectTraceabilityEvidence(input);
    evidenceBySection.set('traceability', evidence);
    defeatersBySection.set('traceability', defeaters);
    sectionConfidences['traceability'] = input.traceability.confidence;
  }

  // Combine all evidence
  const allEvidence = flattenEvidenceMap(evidenceBySection);
  const allDefeaters = flattenDefeaterMap(defeatersBySection);

  // Calculate overall confidence
  const confidence = calculateOverallConfidence(
    sectionConfidences,
    allEvidence,
    allDefeaters
  );

  // Determine validity period
  const validUntil = calculateValidUntil(input, allDefeaters);

  const meta: KnowledgeMeta = {
    confidence,
    evidence: allEvidence,
    generatedAt: new Date().toISOString(),
    generatedBy: input.generatedBy ?? 'librainian/evidence-collector-v1',
    llmEvidence,
    validUntil,
    defeaters: allDefeaters,
    lastValidated: new Date().toISOString(),
  };

  return {
    meta,
    evidenceBySection,
    defeatersBySection,
  };
}

// ============================================================================
// SECTION-SPECIFIC EVIDENCE COLLECTORS
// ============================================================================

interface SectionEvidence {
  evidence: Evidence[];
  defeaters: Defeater[];
}

function collectIdentityEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  // Identity is derived from code parsing - high confidence
  evidence.push({
    type: 'code',
    source: input.filePath,
    description: `Identity extracted from AST parsing of ${input.entityName}`,
    confidence: 0.95,
  });

  if (input.contentHash) {
    evidence.push({
      type: 'code',
      source: 'content-hash',
      description: `Content hash ${input.contentHash.slice(0, 8)} verifies file integrity`,
      confidence: 0.99,
    });
  }

  // Defeater: file rename or move would invalidate
  defeaters.push({
    type: 'code_change',
    description: 'File rename or move would invalidate location data',
  });

  return { evidence, defeaters };
}

function collectSemanticsEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const sem = input.semantics;
  if (!sem) return { evidence, defeaters };

  if (sem.llmEvidence) {
    evidence.push({
      type: 'inferred',
      source: `LLM:${sem.llmEvidence.provider}:${sem.llmEvidence.modelId}`,
      description: `Semantic understanding derived from LLM synthesis (promptDigest=${sem.llmEvidence.promptDigest.slice(0, 12)})`,
      confidence: sem.confidence,
    });
  } else {
    evidence.push({
      type: 'inferred',
      source: 'unverified_by_trace(llm_unavailable)',
      description: 'Semantic understanding requires LLM synthesis; no LLM evidence was recorded',
      confidence: 0,
    });
    defeaters.push({
      type: 'new_info',
      description: 'Missing LLM evidence: semantic understanding is unverified',
    });
  }

  // If there are JSDoc comments, that's additional evidence
  if (sem.semantics?.purpose?.summary && sem.semantics.purpose.summary.length > 20) {
    evidence.push({
      type: 'comment',
      source: 'JSDoc/comments',
      description: 'Purpose derived from documentation comments',
      confidence: 0.75,
    });
  }

  // Defeaters for semantics
  defeaters.push({
    type: 'code_change',
    description: 'Significant code changes would require re-analysis',
  });

  defeaters.push({
    type: 'contradiction',
    description: 'Runtime behavior contradicting documented purpose',
  });

  return { evidence, defeaters };
}

function collectQualityEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const qual = input.quality;
  if (!qual) return { evidence, defeaters };

  // Complexity metrics are computed directly from code
  evidence.push({
    type: 'code',
    source: 'static-analysis',
    description: 'Complexity metrics computed from AST analysis',
    confidence: 0.95,
  });

  // Code smells from pattern matching
  if (qual.quality?.smells && qual.quality.smells.length > 0) {
    evidence.push({
      type: 'code',
      source: 'pattern-detection',
      description: `${qual.quality.smells.length} code smells detected via pattern matching`,
      confidence: 0.85,
    });
  }

  // Defeaters
  defeaters.push({
    type: 'code_change',
    description: 'Any code modification changes quality metrics',
  });

  return { evidence, defeaters };
}

function collectSecurityEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const sec = input.security;
  if (!sec) return { evidence, defeaters };

  if (sec.llmEvidence) {
    evidence.push({
      type: 'inferred',
      source: `LLM:${sec.llmEvidence.provider}:${sec.llmEvidence.modelId}`,
      description: `Security analysis enhanced via LLM synthesis (promptDigest=${sec.llmEvidence.promptDigest.slice(0, 12)})`,
      confidence: Math.min(0.95, sec.confidence),
    });
  }

  // Vulnerability detection
  if (sec.security?.vulnerabilities && sec.security.vulnerabilities.length > 0) {
    evidence.push({
      type: 'code',
      source: 'security-scan',
      description: `${sec.security.vulnerabilities.length} potential vulnerabilities detected`,
      confidence: 0.80,
    });
  }

  // CWE/OWASP categorization
  if (sec.security?.cwe && sec.security.cwe.length > 0) {
    evidence.push({
      type: 'code',
      source: 'cwe-matching',
      description: `Matched ${sec.security.cwe.length} CWE patterns`,
      confidence: 0.75,
    });
  }

  // Risk score
  if (sec.security?.riskScore) {
    evidence.push({
      type: 'inferred',
      source: 'risk-calculation',
      description: `Computed risk score: ${sec.security.riskScore.overall}/10`,
      confidence: sec.confidence,
    });
  }

  // Critical defeaters for security
  defeaters.push({
    type: 'code_change',
    description: 'Any code change requires security re-assessment',
  });

  defeaters.push({
    type: 'new_info',
    description: 'New CVE disclosures may affect risk assessment',
  });

  return { evidence, defeaters };
}

function collectTestingEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const test = input.testing;
  if (!test) return { evidence, defeaters };

  // Linked tests
  if (test.testing?.tests && test.testing.tests.length > 0) {
    evidence.push({
      type: 'test',
      source: 'test-linkage',
      description: `Linked to ${test.testing.tests.length} test(s)`,
      confidence: 0.95,
    });
  }

  // Assertions
  if (test.testing?.assertions && test.testing.assertions.length > 0) {
    evidence.push({
      type: 'test',
      source: 'assertion-analysis',
      description: `${test.testing.assertions.length} assertions verify behavior`,
      confidence: 0.85,
    });
  }

  // Defeaters
  defeaters.push({
    type: 'test_failure',
    description: 'Test failures would invalidate confidence in behavior',
  });

  defeaters.push({
    type: 'code_change',
    description: 'Code changes may break existing tests',
  });

  return { evidence, defeaters };
}

function collectHistoryEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const hist = input.history;
  if (!hist) return { evidence, defeaters };

  // Git history is factual
  if (hist.history?.commits && hist.history.commits.length > 0) {
    evidence.push({
      type: 'commit',
      source: 'git-log',
      description: `${hist.history.commits.length} commits in history`,
      confidence: 0.99,
    });
  }

  // Created/lastModified
  if (hist.history?.created) {
    evidence.push({
      type: 'commit',
      source: 'git-log',
      description: `Created ${hist.history.created.at} by ${hist.history.created.by}`,
      confidence: 0.99,
    });
  }

  // Planned changes from TODOs
  if (hist.history?.plannedChanges && hist.history.plannedChanges.length > 0) {
    evidence.push({
      type: 'comment',
      source: 'todo-extraction',
      description: `${hist.history.plannedChanges.length} planned changes identified`,
      confidence: 0.70,
    });

    // Planned changes are a defeater for stability
    defeaters.push({
      type: 'new_info',
      description: `${hist.history.plannedChanges.length} planned changes may affect future behavior`,
    });
  }

  return { evidence, defeaters };
}

function collectOwnershipEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const own = input.ownership;
  if (!own) return { evidence, defeaters };

  // Ownership from git blame
  if (own.ownership?.expertise?.experts && own.ownership.expertise.experts.length > 0) {
    evidence.push({
      type: 'commit',
      source: 'git-blame',
      description: `${own.ownership.expertise.experts.length} experts identified via git blame`,
      confidence: 0.85,
    });
  }

  // CODEOWNERS
  if (own.ownership?.owner?.team) {
    evidence.push({
      type: 'code',
      source: 'CODEOWNERS',
      description: `Team ${own.ownership.owner.team} owns this code`,
      confidence: 0.95,
    });
  }

  // Tribal knowledge from comments
  if (own.ownership?.knowledge?.tribal && own.ownership.knowledge.tribal.length > 0) {
    evidence.push({
      type: 'comment',
      source: 'tribal-knowledge',
      description: `${own.ownership.knowledge.tribal.length} tribal knowledge items extracted`,
      confidence: 0.60,
    });
  }

  // Defeaters
  defeaters.push({
    type: 'new_info',
    description: 'Team reorganizations may change ownership',
  });

  return { evidence, defeaters };
}

function collectRationaleEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const rat = input.rationale;
  if (!rat) return { evidence, defeaters };

  if (rat.llmEvidence) {
    evidence.push({
      type: 'inferred',
      source: `LLM:${rat.llmEvidence.provider}:${rat.llmEvidence.modelId}`,
      description: `Rationale synthesized via LLM (promptDigest=${rat.llmEvidence.promptDigest.slice(0, 12)})`,
      confidence: Math.min(0.95, rat.confidence),
    });
  } else {
    evidence.push({
      type: 'inferred',
      source: 'unverified_by_trace(llm_unavailable)',
      description: 'Rationale claims require LLM synthesis; no LLM evidence was recorded',
      confidence: 0,
    });
    defeaters.push({
      type: 'new_info',
      description: 'Missing LLM evidence: rationale understanding is unverified',
    });
  }

  // ADRs are strong evidence
  if (rat.rationale?.decisions && rat.rationale.decisions.length > 0) {
    evidence.push({
      type: 'doc',
      source: 'ADRs',
      description: `${rat.rationale.decisions.length} architectural decisions documented`,
      confidence: 0.90,
    });
  }

  // Constraints from comments
  if (rat.rationale?.constraints && rat.rationale.constraints.length > 0) {
    evidence.push({
      type: 'comment',
      source: 'constraint-extraction',
      description: `${rat.rationale.constraints.length} constraints identified`,
      confidence: 0.70,
    });
  }

  // Assumptions
  if (rat.rationale?.assumptions && rat.rationale.assumptions.length > 0) {
    const validated = rat.rationale.assumptions.filter(a => a.validated).length;
    evidence.push({
      type: 'comment',
      source: 'assumption-extraction',
      description: `${rat.rationale.assumptions.length} assumptions (${validated} validated)`,
      confidence: 0.65,
    });

    // Unvalidated assumptions are defeaters
    const unvalidated = rat.rationale.assumptions.filter(a => !a.validated);
    if (unvalidated.length > 0) {
      defeaters.push({
        type: 'contradiction',
        description: `${unvalidated.length} unvalidated assumptions may be incorrect`,
      });
    }
  }

  // Accepted risks
  if (rat.rationale?.risks && rat.rationale.risks.length > 0) {
    const highRisks = rat.rationale.risks.filter(
      r => r.likelihood === 'high' || r.impact === 'high'
    );
    if (highRisks.length > 0) {
      defeaters.push({
        type: 'new_info',
        description: `${highRisks.length} high-severity risks may materialize`,
      });
    }
  }

  // Defeaters
  defeaters.push({
    type: 'new_info',
    description: 'ADRs may be superseded by new decisions',
  });

  return { evidence, defeaters };
}

function collectTraceabilityEvidence(input: EvidenceCollectionInput): SectionEvidence {
  const evidence: Evidence[] = [];
  const defeaters: Defeater[] = [];

  const trace = input.traceability;
  if (!trace) return { evidence, defeaters };

  // Requirements links
  if (trace.traceability?.requirements && trace.traceability.requirements.length > 0) {
    evidence.push({
      type: 'doc',
      source: 'requirement-linkage',
      description: `Linked to ${trace.traceability.requirements.length} requirement(s)`,
      confidence: 0.80,
    });
  }

  // Issue links
  if (trace.traceability?.issues && trace.traceability.issues.length > 0) {
    evidence.push({
      type: 'commit',
      source: 'issue-linkage',
      description: `Referenced by ${trace.traceability.issues.length} issue(s)`,
      confidence: 0.85,
    });
  }

  // Documentation
  if (trace.traceability?.documentation && trace.traceability.documentation.length > 0) {
    evidence.push({
      type: 'doc',
      source: 'doc-linkage',
      description: `Referenced in ${trace.traceability.documentation.length} doc(s)`,
      confidence: 0.75,
    });
  }

  // Incidents
  if (trace.traceability?.incidents && trace.traceability.incidents.length > 0) {
    evidence.push({
      type: 'usage',
      source: 'incident-linkage',
      description: `Associated with ${trace.traceability.incidents.length} incident(s)`,
      confidence: 0.90,
    });

    // Incidents are strong defeaters for reliability claims
    defeaters.push({
      type: 'contradiction',
      description: `${trace.traceability.incidents.length} past incident(s) indicate reliability issues`,
    });
  }

  return { evidence, defeaters };
}

// ============================================================================
// CONFIDENCE CALCULATION
// ============================================================================

function calculateOverallConfidence(
  sectionConfidences: Record<string, number>,
  allEvidence: Evidence[],
  allDefeaters: Defeater[]
): MetaConfidence {
  // ARCHITECTURAL REQUIREMENT (VISION): Use GEOMETRIC MEAN, not arithmetic mean.
  // Geometric mean properly models confidence compounding:
  // - If ANY section has 0 confidence, overall should approach 0
  // - Low confidence sections pull down overall multiplicatively
  // - Confidence = "how sure we are about ALL claims together"
  const sections = Object.entries(sectionConfidences);
  if (sections.length === 0) {
    return {
      overall: 0.3,
      bySection: {},
    };
  }

  // Calculate weighted geometric mean
  // Formula: exp(sum(w_i * ln(c_i)) / sum(w_i))
  let totalWeight = 0;
  let weightedLogSum = 0;

  for (const [section, confidence] of sections) {
    const weight = getSectionWeight(section);
    // Clamp confidence to avoid log(0), minimum 0.01
    const clampedConfidence = Math.max(0.01, Math.min(1.0, confidence));
    totalWeight += weight;
    weightedLogSum += weight * Math.log(clampedConfidence);
  }

  // Geometric mean: exp(weighted sum of logs / total weight)
  let overall = totalWeight > 0
    ? Math.exp(weightedLogSum / totalWeight)
    : 0.3;

  // Boost for strong evidence (small additive, as evidence validates claims)
  const strongEvidence = allEvidence.filter(e => e.confidence > 0.8);
  if (strongEvidence.length > 3) {
    // Multiplicative boost rather than additive
    overall = Math.min(overall * 1.1, 0.95);
  }

  // Penalty for defeaters (multiplicative to maintain geometric model)
  const criticalDefeaters = allDefeaters.filter(
    d => d.type === 'contradiction' || d.type === 'test_failure'
  );
  if (criticalDefeaters.length > 0) {
    // Each critical defeater reduces confidence by 20%
    const defeaterPenalty = Math.pow(0.8, criticalDefeaters.length);
    overall = Math.max(overall * defeaterPenalty, 0.1);
  }

  // Calculate uncertainty profile
  const uncertainty = calculateUncertaintyProfile(allEvidence, allDefeaters);

  return {
    overall: Math.max(0.1, Math.min(0.95, overall)), // Clamp to reasonable bounds
    bySection: sectionConfidences,
    uncertainty,
  };
}

function getSectionWeight(section: string): number {
  const weights: Record<string, number> = {
    identity: 0.8,
    semantics: 1.0,
    quality: 0.9,
    security: 1.0,
    testing: 1.0,
    history: 0.6,
    ownership: 0.5,
    rationale: 0.7,
    traceability: 0.6,
  };
  return weights[section] ?? 0.5;
}

function calculateUncertaintyProfile(
  evidence: Evidence[],
  defeaters: Defeater[]
): UncertaintyProfile {
  // Aleatoric uncertainty: inherent in code ambiguity
  // Higher if we have fewer concrete evidence types
  const concreteTypes: EvidenceType[] = ['test', 'code', 'commit'];
  const concreteEvidence = evidence.filter(e => concreteTypes.includes(e.type));
  const aleatoric = 1 - Math.min(concreteEvidence.length / 5, 1) * 0.8;

  // Epistemic uncertainty: from limited data
  // Higher if we have more inferred evidence vs direct
  const inferredEvidence = evidence.filter(e => e.type === 'inferred');
  const directEvidence = evidence.filter(e => e.type !== 'inferred');
  const epistemic =
    evidence.length > 0
      ? inferredEvidence.length / (inferredEvidence.length + directEvidence.length)
      : 0.5;

  // Reasoning uncertainty: from defeaters
  const reasoning = Math.min(defeaters.length * 0.1, 0.5);

  // What would reduce uncertainty
  const reducers: UncertaintyReducer[] = [];

  if (epistemic > 0.3) {
    reducers.push({
      action: 'more_tests',
      description: 'Add more tests to provide concrete evidence',
      expectedReduction: 0.2,
    });
  }

  if (aleatoric > 0.3) {
    reducers.push({
      action: 'documentation',
      description: 'Add documentation to clarify intent',
      expectedReduction: 0.15,
    });
  }

  if (defeaters.length > 2) {
    reducers.push({
      action: 'expert_review',
      description: 'Expert review to validate assumptions',
      expectedReduction: 0.25,
    });
  }

  return {
    aleatoric,
    epistemic,
    reasoning,
    reducibleBy: reducers,
  };
}

// ============================================================================
// VALIDITY AND STALENESS
// ============================================================================

function calculateValidUntil(
  input: EvidenceCollectionInput,
  defeaters: Defeater[]
): string | undefined {
  const now = new Date();

  // Determine the shortest validity period based on sections present
  let minDays = 365; // Default to 1 year

  if (input.security) {
    minDays = Math.min(minDays, STALENESS_THRESHOLDS.critical);
  }

  if (input.testing) {
    minDays = Math.min(minDays, STALENESS_THRESHOLDS.critical);
  }

  if (input.quality) {
    minDays = Math.min(minDays, STALENESS_THRESHOLDS.high);
  }

  if (input.semantics) {
    minDays = Math.min(minDays, STALENESS_THRESHOLDS.medium);
  }

  // More defeaters = shorter validity
  minDays = Math.max(minDays - defeaters.length * 5, 1);

  const validUntil = new Date(now.getTime() + minDays * 24 * 60 * 60 * 1000);
  return validUntil.toISOString();
}

// ============================================================================
// HELPERS
// ============================================================================

function flattenEvidenceMap(map: Map<string, Evidence[]>): Evidence[] {
  const all: Evidence[] = [];
  for (const evidence of map.values()) {
    all.push(...evidence);
  }
  return all;
}

function flattenDefeaterMap(map: Map<string, Defeater[]>): Defeater[] {
  const all: Defeater[] = [];
  const seen = new Set<string>();

  for (const defeaters of map.values()) {
    for (const d of defeaters) {
      const key = `${d.type}:${d.description}`;
      if (!seen.has(key)) {
        all.push(d);
        seen.add(key);
      }
    }
  }

  return all;
}

// ============================================================================
// VALIDATION AND INVALIDATION
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  stale: boolean;
  invalidatedBy?: Defeater[];
  needsRefresh: string[];
}

/**
 * Check if knowledge is still valid given current state.
 */
export function validateKnowledge(
  meta: KnowledgeMeta,
  currentHash?: string,
  originalHash?: string
): ValidationResult {
  const now = new Date();
  const result: ValidationResult = {
    valid: true,
    stale: false,
    needsRefresh: [],
  };

  // Check staleness
  if (meta.validUntil) {
    const validUntil = new Date(meta.validUntil);
    if (now > validUntil) {
      result.stale = true;
      result.needsRefresh.push('validity-expired');
    }
  }

  // Check content hash change
  if (currentHash && originalHash && currentHash !== originalHash) {
    result.valid = false;
    result.invalidatedBy = [
      {
        type: 'code_change',
        description: 'Content hash changed since knowledge was generated',
        detected: now.toISOString(),
      },
    ];
    result.needsRefresh.push('content-changed');
  }

  // Check for active defeaters
  const activeDefeaters = meta.defeaters.filter(d => {
    // In a full implementation, we'd check if the defeater condition is met
    // For now, we just track them as potential invalidators
    return d.detected !== undefined;
  });

  if (activeDefeaters.length > 0) {
    result.valid = false;
    result.invalidatedBy = activeDefeaters;
    for (const d of activeDefeaters) {
      result.needsRefresh.push(`defeater:${d.type}`);
    }
  }

  return result;
}

/**
 * Mark defeaters as detected (triggered).
 */
export function triggerDefeater(
  meta: KnowledgeMeta,
  defeaterType: DefeaterType,
  description: string
): KnowledgeMeta {
  const now = new Date().toISOString();

  return {
    ...meta,
    defeaters: meta.defeaters.map(d => {
      if (d.type === defeaterType && d.description.includes(description.slice(0, 20))) {
        return { ...d, detected: now };
      }
      return d;
    }),
  };
}

/**
 * Add a new defeater to the knowledge.
 */
export function addDefeater(
  meta: KnowledgeMeta,
  defeater: Defeater
): KnowledgeMeta {
  return {
    ...meta,
    defeaters: [...meta.defeaters, defeater],
  };
}
