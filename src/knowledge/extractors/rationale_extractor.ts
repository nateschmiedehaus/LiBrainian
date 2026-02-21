/**
 * @fileoverview Rationale Knowledge Extractor
 *
 * Extracts design rationale and decision context from multiple sources:
 * - Architectural Decision Records (ADRs)
 * - Code comments (constraints, assumptions, tradeoffs)
 * - Commit messages (why changes were made)
 * - PR comments and discussions
 *
 * This extractor answers questions about WHY code exists and WHY
 * it was designed the way it was - critical for maintenance and evolution.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  EntityRationale,
  ArchitecturalDecision,
  RationaleConstraint,
  ConstraintType,
  Tradeoff,
  ConsideredAlternative,
  Assumption,
  AcceptedRisk,
  RiskLevel,
  DecisionStatus,
} from '../universal_types.js';
import type { AdrRecord } from '../../ingest/adr_indexer.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLiBrainianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';
import {
  type ArgumentEdge,
  type ArgumentEdgeType,
  type ArgumentEntityType,
  createArgumentEdge,
} from '../../storage/types.js';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface RationaleExtraction {
  rationale: EntityRationale;
  confidence: number;
  llmEvidence?: LlmEvidence;
  /**
   * Argument edges derived from rationale extraction.
   *
   * These edges capture the argumentative relationships between decisions,
   * constraints, alternatives, assumptions, and evidence. Based on the
   * Toulmin-IBIS hybrid argumentation model.
   *
   * Edge types generated:
   * - decision → evidence: 'supports' (evidence supports the decision)
   * - decision → constraint: 'qualifies' (constraint limits decision scope)
   * - decision → alternative (rejected): 'contradicts' (mutually exclusive)
   * - decision → assumption: 'warrants' (assumption warrants the decision)
   * - decision → previous_decision: 'supersedes' (if replacing)
   * - decision → dependency: 'depends_on_decision' (requires another decision)
   *
   * @see docs/research/ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
   */
  argumentEdges?: ArgumentEdge[];
}

export interface RationaleInput {
  filePath: string;
  workspaceRoot: string;
  content?: string;
  entityName?: string;
  startLine?: number;
  endLine?: number;

  // Pre-indexed data
  adrs?: AdrRecord[];
  commits?: CommitInfo[];
}

export interface CommitInfo {
  hash: string;
  message: string;
  body?: string;
  author: string;
  date: string;
}

// ============================================================================
// PATTERN DEFINITIONS
// ============================================================================

// Patterns for extracting constraints from comments
const CONSTRAINT_PATTERNS: Array<{
  pattern: RegExp;
  type: ConstraintType;
  sourcePrefix: string;
}> = [
  // Technical constraints
  {
    pattern: /(?:CONSTRAINT|LIMITATION|RESTRICTION|MUST|REQUIRED):\s*([^\n]+)/gi,
    type: 'technical',
    sourcePrefix: 'Code comment',
  },
  {
    pattern: /@constraint\s+([^\n@]+)/gi,
    type: 'technical',
    sourcePrefix: 'JSDoc @constraint',
  },
  {
    pattern: /(?:due\s+to|because\s+of|limited\s+by)\s+(?:the\s+)?(\w+(?:\s+\w+){0,10}(?:API|library|framework|limitation|constraint|requirement))/gi,
    type: 'technical',
    sourcePrefix: 'Inferred from',
  },
  // Performance constraints
  {
    pattern: /(?:PERFORMANCE|PERF):\s*([^\n]+)/gi,
    type: 'technical',
    sourcePrefix: 'Performance constraint',
  },
  {
    pattern: /O\(([^)]+)\)\s+(?:required|constraint|limit)/gi,
    type: 'technical',
    sourcePrefix: 'Complexity constraint',
  },
  // Business constraints
  {
    pattern: /(?:BUSINESS\s+RULE|POLICY):\s*([^\n]+)/gi,
    type: 'business',
    sourcePrefix: 'Business rule',
  },
  {
    pattern: /(?:per\s+|according\s+to\s+)?(?:the\s+)?(?:business|product|stakeholder)\s+(?:requirement|decision|rule)[:\s]+([^\n]+)/gi,
    type: 'business',
    sourcePrefix: 'Business requirement',
  },
  // Regulatory constraints
  {
    pattern: /(?:GDPR|HIPAA|SOC2|PCI|COMPLIANCE|REGULATION):\s*([^\n]+)/gi,
    type: 'regulatory',
    sourcePrefix: 'Compliance requirement',
  },
  {
    pattern: /(?:for\s+|to\s+)?(?:compliance|regulatory|legal)\s+(?:reason|requirement)[:\s]*([^\n]+)/gi,
    type: 'regulatory',
    sourcePrefix: 'Regulatory',
  },
  // Resource constraints
  {
    pattern: /(?:RESOURCE|MEMORY|TIME|BUDGET)(?:\s+LIMIT)?:\s*([^\n]+)/gi,
    type: 'resource',
    sourcePrefix: 'Resource constraint',
  },
];

// Patterns for extracting tradeoffs
const TRADEOFF_PATTERNS: Array<{
  pattern: RegExp;
  gainedGroup: number;
  sacrificedGroup: number;
}> = [
  // "X over Y" pattern
  {
    pattern: /(?:chose|prefer|prioritize[ds]?)\s+(\w+(?:\s+\w+){0,5})\s+over\s+(\w+(?:\s+\w+){0,5})/gi,
    gainedGroup: 1,
    sacrificedGroup: 2,
  },
  // "X at the cost of Y" pattern
  {
    pattern: /(\w+(?:\s+\w+){0,5})\s+at\s+the\s+(?:cost|expense)\s+of\s+(\w+(?:\s+\w+){0,5})/gi,
    gainedGroup: 1,
    sacrificedGroup: 2,
  },
  // "sacrificed X for Y" pattern
  {
    pattern: /(?:sacrificed?|traded?)\s+(\w+(?:\s+\w+){0,5})\s+for\s+(\w+(?:\s+\w+){0,5})/gi,
    gainedGroup: 2,
    sacrificedGroup: 1,
  },
  // TRADEOFF explicit annotation
  {
    pattern: /TRADEOFF:\s*(\w+(?:\s+\w+){0,5})\s+(?:vs|versus|over)\s+(\w+(?:\s+\w+){0,5})/gi,
    gainedGroup: 1,
    sacrificedGroup: 2,
  },
];

// Patterns for extracting alternatives
const ALTERNATIVE_PATTERNS: RegExp[] = [
  // "Instead of X, we Y because Z"
  /instead\s+of\s+(?:using\s+)?([^,]+),\s+(?:we\s+)?(?:use[d]?|chose|went\s+with)\s+[^.]+because\s+([^.]+)/gi,
  // "Considered X but Y"
  /considered\s+([^,]+),?\s+but\s+([^.]+)/gi,
  // "Could have used X but Y"
  /could\s+have\s+(?:used|done)\s+([^,]+),?\s+but\s+([^.]+)/gi,
  // "Alternative: X (rejected because Y)"
  /alternative:?\s*([^(]+)\s*\(rejected\s+(?:because\s+)?([^)]+)\)/gi,
  // "@alternative annotation"
  /@alternative\s+([^\n@]+)/gi,
];

// Patterns for extracting assumptions
const ASSUMPTION_PATTERNS: RegExp[] = [
  // Explicit ASSUMPTION or ASSUMES
  /(?:ASSUMPTION|ASSUMES?):\s*([^\n]+)/gi,
  // @assume or @assumption annotation
  /@(?:assume|assumption)\s+([^\n@]+)/gi,
  // "This assumes X"
  /this\s+(?:code\s+)?(?:assumes?|relies\s+on|requires|expects)\s+(?:that\s+)?([^.]+)/gi,
  // "Assuming X"
  /assuming\s+(?:that\s+)?([^,.\n]+)/gi,
  // "We assume X"
  /we\s+(?:can\s+)?assume\s+(?:that\s+)?([^.]+)/gi,
];

// Patterns for extracting accepted risks
const RISK_PATTERNS: Array<{
  pattern: RegExp;
  defaultLikelihood: RiskLevel;
  defaultImpact: RiskLevel;
}> = [
  // RISK annotation
  {
    pattern: /(?:RISK|WARNING|DANGER):\s*([^\n]+)/gi,
    defaultLikelihood: 'medium',
    defaultImpact: 'medium',
  },
  // @risk annotation
  {
    pattern: /@risk\s+([^\n@]+)/gi,
    defaultLikelihood: 'medium',
    defaultImpact: 'medium',
  },
  // "Known risk: X"
  {
    pattern: /known\s+(?:issue|risk|problem):\s*([^\n]+)/gi,
    defaultLikelihood: 'high',
    defaultImpact: 'medium',
  },
  // "May cause X" (lower severity)
  {
    pattern: /may\s+(?:cause|result\s+in|lead\s+to)\s+([^\n.]+)/gi,
    defaultLikelihood: 'low',
    defaultImpact: 'low',
  },
  // "Could fail if X"
  {
    pattern: /(?:could|might|will)\s+fail\s+(?:if|when)\s+([^\n.]+)/gi,
    defaultLikelihood: 'medium',
    defaultImpact: 'high',
  },
];

// ============================================================================
// MAIN EXTRACTOR
// ============================================================================

/**
 * Extract rationale knowledge for a code entity.
 *
 * Sources:
 * 1. ADRs related to the file
 * 2. Code comments containing rationale patterns
 * 3. Commit messages explaining why changes were made
 */
export async function extractRationaleSignals(input: RationaleInput): Promise<RationaleExtraction> {
  const content = input.content ?? '';

  // Extract from each source
  const decisions = extractDecisions(input.adrs, input.filePath);
  const constraints = extractConstraints(content);
  const tradeoffs = extractTradeoffs(content, input.commits);
  const alternatives = extractAlternatives(content, input.commits);
  const assumptions = extractAssumptions(content);
  const risks = extractRisks(content);

  // Try to get more context from commit messages
  let commits = input.commits;
  if (!commits || commits.length === 0) {
    commits = await fetchRecentCommits(input.filePath, input.workspaceRoot);
    // Extract additional rationale from commits
    const commitTradeoffs = extractTradeoffsFromCommits(commits);
    const commitAlternatives = extractAlternativesFromCommits(commits);

    tradeoffs.push(...commitTradeoffs);
    alternatives.push(...commitAlternatives);
  }

  // Calculate confidence based on evidence
  const hasAdrs = decisions.length > 0;
  const hasConstraints = constraints.length > 0;
  const hasTradeoffs = tradeoffs.length > 0;
  const hasAssumptions = assumptions.length > 0;

  let confidence = 0.3; // Base confidence
  if (hasAdrs) confidence += 0.3;
  if (hasConstraints) confidence += 0.1;
  if (hasTradeoffs) confidence += 0.1;
  if (hasAssumptions) confidence += 0.1;
  if (content.length > 0) confidence += 0.1;

  // Build the rationale object
  const rationale: EntityRationale = {
    decisions,
    constraints,
    tradeoffs: deduplicateTradeoffs(tradeoffs),
    alternatives: deduplicateAlternatives(alternatives),
    assumptions: deduplicateAssumptions(assumptions),
    risks,
  };

  // Generate argument edges from the extracted rationale
  const argumentEdges = generateArgumentEdges(rationale, {
    entityIdPrefix: input.entityName || 'rationale',
    filePath: input.filePath,
  });

  return {
    rationale,
    confidence: Math.min(confidence, 1.0),
    argumentEdges: argumentEdges.length > 0 ? argumentEdges : undefined,
  };
}

/**
 * Extract rationale knowledge for a code entity.
 *
 * @deprecated Always throws. Per VISION architecture, rationale claims require LLM synthesis.
 * Use extractRationaleWithLLM() for all production use.
 */
export async function extractRationale(_input: RationaleInput): Promise<RationaleExtraction> {
  throw new Error(
    'unverified_by_trace(rationale_llm_required): extractRationale() is forbidden. ' +
    'Rationale claims require LLM synthesis. Use extractRationaleWithLLM() instead.'
  );
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Convert ADR records to ArchitecturalDecision format.
 */
function extractDecisions(
  adrs: AdrRecord[] | undefined,
  filePath: string
): ArchitecturalDecision[] {
  if (!adrs || adrs.length === 0) return [];

  return adrs
    .filter(adr => {
      // Only include ADRs that are relevant to this file
      const isRelevant =
        adr.relatedFiles.some(f => filePath.includes(f) || f.includes(filePath)) ||
        adr.context.includes(filePath) ||
        adr.decision.includes(filePath);
      return isRelevant;
    })
    .map((adr, index) => {
      // Extract ID from path or generate one
      const idMatch = adr.path.match(/(\d+)/);
      const id = idMatch ? `ADR-${idMatch[1].padStart(3, '0')}` : `ADR-${index + 1}`;

      return {
        id,
        title: adr.title,
        status: normalizeStatus(adr.status),
        context: adr.context,
        decision: adr.decision,
        consequences: adr.consequences,
        supersededBy: undefined, // Would need cross-reference
      };
    });
}

function normalizeStatus(status: string | null): DecisionStatus {
  if (!status) return 'accepted';
  const lower = status.toLowerCase();
  if (lower.includes('proposed') || lower.includes('draft')) return 'proposed';
  if (lower.includes('deprecated')) return 'deprecated';
  if (lower.includes('superseded') || lower.includes('replaced')) return 'superseded';
  return 'accepted';
}

/**
 * Extract constraints from code comments.
 */
function extractConstraints(content: string): RationaleConstraint[] {
  const constraints: RationaleConstraint[] = [];

  for (const { pattern, type, sourcePrefix } of CONSTRAINT_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const description = (match[1] ?? '').trim();
      if (description.length > 10 && description.length < 500) {
        constraints.push({
          type,
          description,
          source: sourcePrefix,
        });
      }
    }
  }

  return constraints;
}

/**
 * Extract tradeoffs from code comments.
 */
function extractTradeoffs(content: string, commits?: CommitInfo[]): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];

  for (const { pattern, gainedGroup, sacrificedGroup } of TRADEOFF_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const gained = (match[gainedGroup] ?? '').trim();
      const sacrificed = (match[sacrificedGroup] ?? '').trim();
      if (gained.length > 2 && sacrificed.length > 2) {
        tradeoffs.push({
          gained,
          sacrificed,
          rationale: `Found in code: "${match[0].trim()}"`,
        });
      }
    }
  }

  return tradeoffs;
}

function extractTradeoffsFromCommits(commits: CommitInfo[]): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];

  for (const commit of commits) {
    const text = `${commit.message} ${commit.body ?? ''}`;
    for (const { pattern, gainedGroup, sacrificedGroup } of TRADEOFF_PATTERNS) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const gained = (match[gainedGroup] ?? '').trim();
        const sacrificed = (match[sacrificedGroup] ?? '').trim();
        if (gained.length > 2 && sacrificed.length > 2) {
          tradeoffs.push({
            gained,
            sacrificed,
            rationale: `From commit ${commit.hash.slice(0, 7)}: "${commit.message}"`,
          });
        }
      }
    }
  }

  return tradeoffs;
}

/**
 * Extract considered alternatives from code comments.
 */
function extractAlternatives(content: string, commits?: CommitInfo[]): ConsideredAlternative[] {
  const alternatives: ConsideredAlternative[] = [];

  for (const pattern of ALTERNATIVE_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const approach = (match[1] ?? '').trim();
      const rejected = (match[2] ?? match[1] ?? '').trim();

      if (approach.length > 2 && approach.length < 200) {
        alternatives.push({
          approach,
          rejected: rejected.length > 2 ? rejected : 'Not specified',
          source: 'Code comment',
        });
      }
    }
  }

  return alternatives;
}

function extractAlternativesFromCommits(commits: CommitInfo[]): ConsideredAlternative[] {
  const alternatives: ConsideredAlternative[] = [];

  for (const commit of commits) {
    const text = `${commit.message} ${commit.body ?? ''}`;
    for (const pattern of ALTERNATIVE_PATTERNS) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const approach = (match[1] ?? '').trim();
        const rejected = (match[2] ?? match[1] ?? '').trim();

        if (approach.length > 2 && approach.length < 200) {
          alternatives.push({
            approach,
            rejected: rejected.length > 2 ? rejected : 'Not specified',
            source: `Commit ${commit.hash.slice(0, 7)}`,
          });
        }
      }
    }
  }

  return alternatives;
}

/**
 * Extract assumptions from code comments.
 */
function extractAssumptions(content: string): Assumption[] {
  const assumptions: Assumption[] = [];
  const seen = new Set<string>();

  for (const pattern of ASSUMPTION_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const assumption = (match[1] ?? '').trim();

      // Skip if too short, too long, or duplicate
      if (assumption.length < 10 || assumption.length > 300) continue;

      const normalized = assumption.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Try to determine if validated
      const isValidated = checkIfValidated(content, assumption);

      assumptions.push({
        assumption,
        validated: isValidated,
        evidence: isValidated ? 'Referenced in tests or assertions' : undefined,
      });
    }
  }

  return assumptions;
}

function checkIfValidated(content: string, assumption: string): boolean {
  // Check if the assumption is referenced in test-like patterns
  const keywords = assumption
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 3);

  if (keywords.length === 0) return false;

  // Look for test patterns mentioning these keywords
  const testPatterns = [
    /test\s*\(/gi,
    /expect\s*\(/gi,
    /assert/gi,
    /verify/gi,
  ];

  for (const keyword of keywords) {
    const keywordPattern = new RegExp(keyword, 'i');
    for (const testPattern of testPatterns) {
      // Simple heuristic: if keyword appears near test pattern
      if (keywordPattern.test(content) && testPattern.test(content)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract accepted risks from code comments.
 */
function extractRisks(content: string): AcceptedRisk[] {
  const risks: AcceptedRisk[] = [];
  const seen = new Set<string>();

  for (const { pattern, defaultLikelihood, defaultImpact } of RISK_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const risk = (match[1] ?? '').trim();

      // Skip if too short, too long, or duplicate
      if (risk.length < 10 || risk.length > 300) continue;

      const normalized = risk.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Try to extract mitigation if mentioned
      const mitigation = extractMitigation(content, risk);

      // Adjust likelihood/impact based on keywords
      const { likelihood, impact } = adjustRiskLevels(risk, defaultLikelihood, defaultImpact);

      risks.push({
        risk,
        likelihood,
        impact,
        mitigation,
        acceptedBy: undefined, // Would need git blame
      });
    }
  }

  return risks;
}

function extractMitigation(content: string, risk: string): string | undefined {
  // Look for mitigation patterns near the risk
  const riskIndex = content.toLowerCase().indexOf(risk.toLowerCase());
  if (riskIndex === -1) return undefined;

  // Check next 200 chars for mitigation patterns
  const context = content.slice(riskIndex, riskIndex + 500);
  const mitigationMatch = context.match(
    /(?:mitigat(?:ed?|ion)|workaround|prevent(?:ed|ion)?|handl(?:ed?|ing)|catch(?:es)?|fallback):\s*([^\n.]+)/i
  );

  return mitigationMatch?.[1]?.trim();
}

function adjustRiskLevels(
  risk: string,
  defaultLikelihood: RiskLevel,
  defaultImpact: RiskLevel
): { likelihood: RiskLevel; impact: RiskLevel } {
  const lower = risk.toLowerCase();

  let likelihood = defaultLikelihood;
  let impact = defaultImpact;

  // Adjust likelihood
  if (/rare|unlikely|edge\s*case/i.test(lower)) likelihood = 'low';
  if (/likely|common|frequent/i.test(lower)) likelihood = 'high';

  // Adjust impact
  if (/minor|small|low/i.test(lower)) impact = 'low';
  if (/critical|severe|crash|data\s*loss|security/i.test(lower)) impact = 'high';

  return { likelihood, impact };
}

// ============================================================================
// GIT INTEGRATION
// ============================================================================

async function fetchRecentCommits(
  filePath: string,
  workspaceRoot: string
): Promise<CommitInfo[]> {
  try {
    const relativePath = filePath.replace(workspaceRoot + '/', '');
    const { stdout } = await execAsync(
      `git log --format="%H|%an|%aI|%s|%b" -n 20 -- "${relativePath}"`,
      { cwd: workspaceRoot, timeout: 10000 }
    );

    return stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [hash, author, date, message, ...bodyParts] = line.split('|');
        return {
          hash: hash ?? '',
          author: author ?? 'unknown',
          date: date ?? new Date().toISOString(),
          message: message ?? '',
          body: bodyParts.join('|').trim() || undefined,
        };
      });
  } catch {
    return [];
  }
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

function deduplicateTradeoffs(tradeoffs: Tradeoff[]): Tradeoff[] {
  const seen = new Set<string>();
  return tradeoffs.filter(t => {
    const key = `${t.gained.toLowerCase()}|${t.sacrificed.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateAlternatives(alternatives: ConsideredAlternative[]): ConsideredAlternative[] {
  const seen = new Set<string>();
  return alternatives.filter(a => {
    const key = a.approach.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateAssumptions(assumptions: Assumption[]): Assumption[] {
  const seen = new Set<string>();
  return assumptions.filter(a => {
    const key = a.assumption.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// ARGUMENT EDGE GENERATION
// Based on: docs/research/ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
// ============================================================================

/**
 * Options for generating argument edges from rationale.
 */
export interface ArgumentEdgeGenerationOptions {
  /** Entity ID prefix for generated node IDs (default: 'rationale') */
  entityIdPrefix?: string;
  /** File path for context in edge metadata */
  filePath?: string;
  /** Include edges with confidence below threshold (default: 0.5) */
  minConfidence?: number;
}

/**
 * Generate argument edges from extracted rationale.
 *
 * This function converts the flat rationale structure (decisions, constraints,
 * alternatives, etc.) into a graph of argumentative relationships.
 *
 * Edge generation rules:
 * 1. Evidence → Decision: 'supports' (evidence supports the decision)
 * 2. Constraint → Decision: 'qualifies' (constraint limits decision scope)
 * 3. Decision → Alternative: 'contradicts' (mutually exclusive approaches)
 * 4. Assumption → Decision: 'warrants' (assumption justifies the decision)
 * 5. New Decision → Old Decision: 'supersedes' (if replacing)
 * 6. Decision → Dependency: 'depends_on_decision' (requires another decision)
 * 7. Risk → Decision: 'rebuts' (risk provides defeating condition)
 * 8. Tradeoff → Decision: 'qualifies' (tradeoff limits applicability)
 *
 * @param rationale - The extracted EntityRationale
 * @param options - Generation options
 * @returns Array of ArgumentEdge entries
 *
 * @example
 * ```typescript
 * const extraction = await extractRationaleSignals(input);
 * const edges = generateArgumentEdges(extraction.rationale, {
 *   entityIdPrefix: 'my-service',
 *   filePath: 'src/service.ts',
 * });
 * // Returns edges like:
 * // { sourceId: 'constraint:latency-req', targetId: 'ADR-001', type: 'qualifies', ... }
 * ```
 */
export function generateArgumentEdges(
  rationale: EntityRationale,
  options: ArgumentEdgeGenerationOptions = {}
): ArgumentEdge[] {
  const {
    entityIdPrefix = 'rationale',
    filePath,
    minConfidence = 0.5,
  } = options;

  const edges: ArgumentEdge[] = [];
  const now = new Date().toISOString();

  // Helper to create entity IDs
  const makeId = (type: string, name: string): string => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);
    return `${entityIdPrefix}:${type}:${slug}`;
  };

  // Helper to create edge ID
  const makeEdgeId = (source: string, target: string, edgeType: string): string => {
    return `edge:${edgeType}:${source.slice(-20)}->${target.slice(-20)}`;
  };

  // Process each decision
  for (const decision of rationale.decisions) {
    const decisionId = decision.id || makeId('decision', decision.title);

    // 1. Constraints qualify decisions
    for (const constraint of rationale.constraints) {
      const constraintId = makeId('constraint', constraint.description);
      const confidence = constraintTypeToConfidence(constraint.type);

      if (confidence >= minConfidence) {
        edges.push(
          createArgumentEdge({
            id: makeEdgeId(constraintId, decisionId, 'qualifies'),
            sourceId: constraintId,
            targetId: decisionId,
            sourceType: 'constraint' as ArgumentEntityType,
            targetType: 'decision' as ArgumentEntityType,
            type: 'qualifies' as ArgumentEdgeType,
            weight: confidence,
            confidence,
            metadata: {
              qualifierCondition: constraint.description,
              extractedFrom: 'adr',
              ...(filePath && { filePath }),
            },
            computedAt: now,
          })
        );
      }
    }

    // 2. Alternatives contradict decisions
    for (const alternative of rationale.alternatives) {
      const alternativeId = makeId('alternative', alternative.approach);
      const confidence = 0.9; // High confidence for explicit rejection

      edges.push(
        createArgumentEdge({
          id: makeEdgeId(decisionId, alternativeId, 'contradicts'),
          sourceId: decisionId,
          targetId: alternativeId,
          sourceType: 'decision' as ArgumentEntityType,
          targetType: 'alternative' as ArgumentEntityType,
          type: 'contradicts' as ArgumentEdgeType,
          weight: 1.0, // Contradictions are binary
          confidence,
          metadata: {
            reason: alternative.rejected,
            extractedFrom: alternative.source === 'LLM-inferred' ? 'llm_inference' : 'adr',
            ...(filePath && { filePath }),
          },
          computedAt: now,
        })
      );
    }

    // 3. Assumptions warrant decisions
    for (const assumption of rationale.assumptions) {
      const assumptionId = makeId('assumption', assumption.assumption);
      const confidence = assumption.validated ? 0.9 : 0.6;

      if (confidence >= minConfidence) {
        edges.push(
          createArgumentEdge({
            id: makeEdgeId(assumptionId, decisionId, 'warrants'),
            sourceId: assumptionId,
            targetId: decisionId,
            sourceType: 'assumption' as ArgumentEntityType,
            targetType: 'decision' as ArgumentEntityType,
            type: 'warrants' as ArgumentEdgeType,
            weight: 1.0, // Warrants are binary (apply or don't)
            confidence,
            metadata: {
              warrantSource: assumption.evidence,
              ruleType: assumption.validated ? 'strict' : 'defeasible',
              extractedFrom: 'adr',
              ...(filePath && { filePath }),
            },
            computedAt: now,
          })
        );
      }
    }

    // 4. Supersession edges (decision supersedes previous decision)
    if (decision.supersededBy) {
      edges.push(
        createArgumentEdge({
          id: makeEdgeId(decision.supersededBy, decisionId, 'supersedes'),
          sourceId: decision.supersededBy,
          targetId: decisionId,
          sourceType: 'decision' as ArgumentEntityType,
          targetType: 'decision' as ArgumentEntityType,
          type: 'supersedes' as ArgumentEdgeType,
          weight: 1.0, // Supersession is binary
          confidence: 0.95,
          metadata: {
            supersessionReason: `${decision.title} superseded`,
            extractedFrom: 'adr',
            ...(filePath && { filePath }),
          },
          computedAt: now,
        })
      );
    }

    // 5. Risks rebut decisions (provide defeating conditions)
    for (const risk of rationale.risks) {
      const riskId = makeId('risk', risk.risk);
      const confidence = riskLevelToConfidence(risk.likelihood, risk.impact);

      if (confidence >= minConfidence) {
        edges.push(
          createArgumentEdge({
            id: makeEdgeId(riskId, decisionId, 'rebuts'),
            sourceId: riskId,
            targetId: decisionId,
            sourceType: 'risk' as ArgumentEntityType,
            targetType: 'decision' as ArgumentEntityType,
            type: 'rebuts' as ArgumentEdgeType,
            weight: 1.0, // Rebuttals are binary when active
            confidence,
            metadata: {
              rebuttalCondition: risk.risk,
              ruleType: 'defeasible',
              extractedFrom: risk.mitigation ? 'adr' : 'llm_inference',
              ...(risk.mitigation && { mitigation: risk.mitigation }),
              ...(filePath && { filePath }),
            },
            computedAt: now,
          })
        );
      }
    }

    // 6. Tradeoffs qualify decisions
    for (const tradeoff of rationale.tradeoffs) {
      const tradeoffId = makeId('tradeoff', `${tradeoff.gained}-over-${tradeoff.sacrificed}`);

      edges.push(
        createArgumentEdge({
          id: makeEdgeId(tradeoffId, decisionId, 'qualifies'),
          sourceId: tradeoffId,
          targetId: decisionId,
          sourceType: 'tradeoff' as ArgumentEntityType,
          targetType: 'decision' as ArgumentEntityType,
          type: 'qualifies' as ArgumentEdgeType,
          weight: 0.8,
          confidence: 0.85,
          metadata: {
            qualifierCondition: `Prioritized ${tradeoff.gained} over ${tradeoff.sacrificed}`,
            strength: 0.8,
            extractedFrom: tradeoff.rationale.includes('LLM') ? 'llm_inference' : 'comment',
            ...(filePath && { filePath }),
          },
          computedAt: now,
        })
      );
    }
  }

  // 7. Evidence supports decisions (from context/consequences in ADR)
  // For decisions with consequences, create implicit evidence edges
  for (const decision of rationale.decisions) {
    if (decision.consequences && decision.consequences.length > 20) {
      const decisionId = decision.id || makeId('decision', decision.title);
      const evidenceId = makeId('evidence', `consequences-${decision.id || decision.title}`);

      edges.push(
        createArgumentEdge({
          id: makeEdgeId(evidenceId, decisionId, 'supports'),
          sourceId: evidenceId,
          targetId: decisionId,
          sourceType: 'evidence' as ArgumentEntityType,
          targetType: 'decision' as ArgumentEntityType,
          type: 'supports' as ArgumentEdgeType,
          weight: 0.7,
          confidence: 0.75,
          metadata: {
            evidenceRefs: [decision.consequences.slice(0, 200)],
            extractedFrom: 'adr',
            ...(filePath && { filePath }),
          },
          computedAt: now,
        })
      );
    }
  }

  // 8. Decision dependency edges (inter-ADR dependencies)
  // Look for references to other ADRs in decision context
  for (const decision of rationale.decisions) {
    const decisionId = decision.id || makeId('decision', decision.title);
    const adrRefs = extractAdrReferences(decision.context + ' ' + decision.decision);

    for (const refId of adrRefs) {
      if (refId !== decision.id) {
        edges.push(
          createArgumentEdge({
            id: makeEdgeId(decisionId, refId, 'depends_on_decision'),
            sourceId: decisionId,
            targetId: refId,
            sourceType: 'decision' as ArgumentEntityType,
            targetType: 'decision' as ArgumentEntityType,
            type: 'depends_on_decision' as ArgumentEdgeType,
            weight: 0.8,
            confidence: 0.7,
            metadata: {
              extractedFrom: 'adr',
              ...(filePath && { filePath }),
            },
            computedAt: now,
          })
        );
      }
    }
  }

  return edges;
}

/**
 * Extract ADR references from text (e.g., "ADR-001", "ADR 5", "ADR#12").
 */
function extractAdrReferences(text: string): string[] {
  const pattern = /ADR[-\s#]?(\d{1,4})/gi;
  const matches = text.matchAll(pattern);
  const refs: string[] = [];

  for (const match of matches) {
    const num = match[1];
    refs.push(`ADR-${num.padStart(3, '0')}`);
  }

  return [...new Set(refs)];
}

/**
 * Convert constraint type to confidence score.
 */
function constraintTypeToConfidence(type: ConstraintType): number {
  switch (type) {
    case 'regulatory':
      return 0.95; // Regulatory constraints are highly certain
    case 'technical':
      return 0.85; // Technical constraints are usually well-defined
    case 'business':
      return 0.75; // Business constraints may be more fluid
    case 'resource':
      return 0.7; // Resource constraints can change
    default:
      return 0.6;
  }
}

/**
 * Convert risk levels to confidence score for rebuttal edge.
 */
function riskLevelToConfidence(likelihood: RiskLevel, impact: RiskLevel): number {
  const likelihoodScore = { high: 0.9, medium: 0.6, low: 0.3 }[likelihood];
  const impactScore = { high: 0.9, medium: 0.6, low: 0.3 }[impact];

  // Combined confidence: higher if both likelihood and impact are significant
  return Math.min(0.95, (likelihoodScore + impactScore) / 2 + 0.2);
}

// ============================================================================
// LLM-ENHANCED EXTRACTION
// ============================================================================

export interface LLMRationaleConfig {
  provider: 'claude' | 'codex';
  modelId?: string;
  /** Governor context for token tracking and budget enforcement */
  governor?: import('../../api/governor_context.js').GovernorContext;
}

/**
 * Enhanced rationale extraction using LLM for deeper analysis.
 *
 * The LLM can identify implicit tradeoffs, unstated assumptions,
 * and design decisions that aren't explicitly documented.
 */
export async function extractRationaleWithLLM(
  input: RationaleInput,
  config: LLMRationaleConfig
): Promise<RationaleExtraction> {
  // First get the heuristic extraction as base data (ADRs, commits, patterns)
  const heuristic = await extractRationaleSignals(input);

  // ARCHITECTURAL REQUIREMENT: LLM synthesis is MANDATORY for rationale claims.
  // Heuristic extraction provides structured data (ADRs, commits) but semantic
  // claims about "why" require LLM synthesis. Silent fallback is forbidden.
  if (!input.content) {
    throw new Error(
      'unverified_by_trace(rationale_llm_required): Content is required for rationale extraction. ' +
      'Rationale claims require LLM synthesis - heuristic-only mode is not permitted per VISION architecture.'
    );
  }

  try {
    const llmService = resolveLlmServiceAdapter();

    const truncatedContent = input.content.slice(0, 6000);

    const prompt = `Analyze this code for design rationale. Identify:
1. Design decisions (explicit or implicit)
2. Constraints that shaped the implementation
3. Tradeoffs made (what was prioritized vs sacrificed)
4. Alternatives that might have been considered
5. Assumptions the code makes
6. Risks in the current approach

Code from ${input.filePath}:
\`\`\`
${truncatedContent}
\`\`\`

Already identified (don't repeat):
- Constraints: ${heuristic.rationale.constraints.map(c => c.description).join(', ') || 'none'}
- Tradeoffs: ${heuristic.rationale.tradeoffs.map(t => `${t.gained} over ${t.sacrificed}`).join(', ') || 'none'}

Respond in JSON:
{
  "constraints": [{"type": "technical|business|regulatory|resource", "description": "...", "source": "inferred"}],
  "tradeoffs": [{"gained": "...", "sacrificed": "...", "rationale": "..."}],
  "alternatives": [{"approach": "...", "rejected": "why not chosen"}],
  "assumptions": [{"assumption": "...", "validated": false}],
  "risks": [{"risk": "...", "likelihood": "low|medium|high", "impact": "low|medium|high"}]
}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content:
          'You are a software architect analyzing code for design rationale. ' +
          'Focus on WHY decisions were made, not WHAT the code does. ' +
          'Only report confident findings, not speculation.',
      },
      { role: 'user', content: prompt },
    ];

    const modelId = config.modelId
      ?? resolveLiBrainianModelId(config.provider)
      ?? 'claude-haiku-4-5-20241022';
    const llmEvidence = await buildLlmEvidence({
      provider: config.provider,
      modelId,
      messages,
    });

    const response = await llmService.chat({
      provider: config.provider,
      modelId,
      messages,
      maxTokens: 1000,
      governorContext: config.governor,
    });

    const parsed = parseRationaleResponse(response.content);

    // Merge LLM findings with heuristic
    const mergedRationale: EntityRationale = {
      decisions: heuristic.rationale.decisions,
      constraints: [
        ...heuristic.rationale.constraints,
        ...parsed.constraints.map(c => ({
          ...c,
          source: `LLM-inferred: ${c.source}`,
        })),
      ],
      tradeoffs: deduplicateTradeoffs([
        ...heuristic.rationale.tradeoffs,
        ...parsed.tradeoffs,
      ]),
      alternatives: deduplicateAlternatives([
        ...heuristic.rationale.alternatives,
        ...parsed.alternatives,
      ]),
      assumptions: deduplicateAssumptions([
        ...heuristic.rationale.assumptions,
        ...parsed.assumptions,
      ]),
      risks: [...heuristic.rationale.risks, ...parsed.risks],
    };

    // Generate argument edges from merged rationale
    // Combine heuristic edges with edges from LLM-enhanced rationale
    const heuristicEdges = heuristic.argumentEdges ?? [];
    const llmEdges = generateArgumentEdges(mergedRationale, {
      entityIdPrefix: input.entityName || 'rationale-llm',
      filePath: input.filePath,
    });

    // Deduplicate edges by ID
    const edgeMap = new Map<string, ArgumentEdge>();
    for (const edge of [...heuristicEdges, ...llmEdges]) {
      if (!edgeMap.has(edge.id)) {
        edgeMap.set(edge.id, edge);
      }
    }
    const argumentEdges = Array.from(edgeMap.values());

    return {
      rationale: mergedRationale,
      confidence: Math.min(heuristic.confidence + 0.2, 0.95),
      llmEvidence,
      argumentEdges: argumentEdges.length > 0 ? argumentEdges : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = message.includes('unverified_by_trace')
      ? message
      : `unverified_by_trace(rationale_extraction_failed): ${message}`;
    throw new Error(prefix);
  }
}

interface ParsedRationale {
  constraints: RationaleConstraint[];
  tradeoffs: Tradeoff[];
  alternatives: ConsideredAlternative[];
  assumptions: Assumption[];
  risks: AcceptedRisk[];
}

function parseRationaleResponse(response: string): ParsedRationale {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('no JSON found in rationale response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ParsedRationale>;

    return {
      constraints: validateConstraints(parsed.constraints ?? []),
      tradeoffs: validateTradeoffs(parsed.tradeoffs ?? []),
      alternatives: validateAlternatives(parsed.alternatives ?? []),
      assumptions: validateAssumptions(parsed.assumptions ?? []),
      risks: validateRisks(parsed.risks ?? []),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unverified_by_trace(provider_invalid_output): ${message}`);
  }
}

function emptyParsedRationale(): ParsedRationale {
  return {
    constraints: [],
    tradeoffs: [],
    alternatives: [],
    assumptions: [],
    risks: [],
  };
}

function validateConstraints(items: unknown[]): RationaleConstraint[] {
  return items
    .filter(
      (c): c is { type: string; description: string; source?: string } =>
        typeof c === 'object' &&
        c !== null &&
        'type' in c &&
        'description' in c &&
        typeof (c as Record<string, unknown>).description === 'string'
    )
    .map(c => ({
      type: isConstraintType(c.type) ? c.type : 'technical',
      description: c.description,
      source: c.source ?? 'LLM-inferred',
    }));
}

function isConstraintType(value: unknown): value is ConstraintType {
  return (
    typeof value === 'string' &&
    ['technical', 'business', 'regulatory', 'resource'].includes(value)
  );
}

function validateTradeoffs(items: unknown[]): Tradeoff[] {
  return items
    .filter(
      (t): t is { gained: string; sacrificed: string; rationale?: string } =>
        typeof t === 'object' &&
        t !== null &&
        'gained' in t &&
        'sacrificed' in t &&
        typeof (t as Record<string, unknown>).gained === 'string' &&
        typeof (t as Record<string, unknown>).sacrificed === 'string'
    )
    .map(t => ({
      gained: t.gained,
      sacrificed: t.sacrificed,
      rationale: t.rationale ?? 'LLM-inferred',
    }));
}

function validateAlternatives(items: unknown[]): ConsideredAlternative[] {
  return items
    .filter(
      (a): a is { approach: string; rejected: string; source?: string } =>
        typeof a === 'object' &&
        a !== null &&
        'approach' in a &&
        'rejected' in a &&
        typeof (a as Record<string, unknown>).approach === 'string'
    )
    .map(a => ({
      approach: a.approach,
      rejected: a.rejected,
      source: a.source ?? 'LLM-inferred',
    }));
}

function validateAssumptions(items: unknown[]): Assumption[] {
  return items
    .filter(
      (a): a is { assumption: string; validated?: boolean; evidence?: string } =>
        typeof a === 'object' &&
        a !== null &&
        'assumption' in a &&
        typeof (a as Record<string, unknown>).assumption === 'string'
    )
    .map(a => ({
      assumption: a.assumption,
      validated: a.validated ?? false,
      evidence: a.evidence,
    }));
}

function validateRisks(items: unknown[]): AcceptedRisk[] {
  return items
    .filter(
      (r): r is { risk: string; likelihood?: string; impact?: string; mitigation?: string } =>
        typeof r === 'object' &&
        r !== null &&
        'risk' in r &&
        typeof (r as Record<string, unknown>).risk === 'string'
    )
    .map(r => ({
      risk: r.risk,
      likelihood: isRiskLevel(r.likelihood) ? r.likelihood : 'medium',
      impact: isRiskLevel(r.impact) ? r.impact : 'medium',
      mitigation: r.mitigation,
      acceptedBy: undefined,
    }));
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && ['high', 'medium', 'low'].includes(value);
}
