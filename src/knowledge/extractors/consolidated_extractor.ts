/**
 * @fileoverview Consolidated Entity Extractor
 *
 * P0-4 EFFICIENCY: Combines semantics, security, and rationale extraction
 * into a single LLM call, reducing 3 calls to 1 (~65% token savings).
 *
 * This extractor produces the same output structure as the individual
 * extractors but with a single round-trip, improving latency and cost.
 *
 * Token budget:
 * - Previous: semantics (1500) + security (1000) + rationale (1000) = 3500
 * - Consolidated: 2500 tokens (saves ~1000 tokens per entity)
 */

import type { EntitySemantics, EntitySecurity, EntityRationale } from '../universal_types.js';
import type { SemanticsExtraction } from './semantics.js';
import type { SecurityExtraction } from './security_extractor.js';
import type { RationaleExtraction } from './rationale_extractor.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';
import { extractSecurity as extractSecurityStatic } from './security_extractor.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConsolidatedInput {
  name: string;
  signature?: string;
  content?: string;
  docstring?: string;
  filePath: string;
  existingPurpose?: string;
  workspaceRoot?: string;
}

export interface ConsolidatedConfig {
  llmProvider: 'claude' | 'codex';
  llmModelId?: string;
  governor?: import('../../api/governor_context.js').GovernorContext;
}

export interface ConsolidatedExtraction {
  semantics: SemanticsExtraction;
  security: SecurityExtraction;
  rationale: RationaleExtraction;
  llmEvidence: LlmEvidence;
  tokensSaved: number;
}

// ============================================================================
// CONSOLIDATED PROMPT
// ============================================================================

const CONSOLIDATED_SYSTEM_PROMPT = `You are a code analysis expert. Analyze code entities to extract:
1. SEMANTICS: Purpose, domain concepts, how it works
2. SECURITY: Vulnerabilities, risks, controls
3. RATIONALE: Design decisions, constraints, tradeoffs

Return a single JSON object with all three sections. Be precise and evidence-based.`;

function buildConsolidatedPrompt(input: ConsolidatedInput, staticSecurity: SecurityExtraction): string {
  const codePart = input.content
    ? `\n\nCode:\n\`\`\`\n${input.content.slice(0, 3000)}\n\`\`\``
    : '';

  const signaturePart = input.signature
    ? `\nSignature: ${input.signature}`
    : '';

  const docPart = input.docstring
    ? `\nDocumentation: ${input.docstring}`
    : '';

  const staticRisk = staticSecurity.security.riskScore
    ? `${staticSecurity.security.riskScore.overall}/10`
    : 'not analyzed';

  return `Analyze this code entity:

File: ${input.filePath}
Name: ${input.name}${signaturePart}${docPart}${codePart}

Static security analysis found:
- Vulnerabilities: ${staticSecurity.security.vulnerabilities.map(v => v.id).join(', ') || 'none'}
- Risk score: ${staticRisk}

Return JSON with this structure:
{
  "semantics": {
    "purpose": {
      "summary": "One sentence (max 160 chars) explaining what this does",
      "explanation": "Detailed explanation (1-3 sentences)",
      "problemSolved": "What problem this addresses",
      "valueProp": "What breaks or is missing without this"
    },
    "domain": {
      "concepts": ["domain terms used"],
      "boundedContext": "DDD bounded context if applicable",
      "businessRules": ["encoded business logic"]
    },
    "intent": {
      "primaryUseCase": "Main usage scenario",
      "secondaryUseCases": ["other valid uses"],
      "antiUseCases": ["what NOT to use this for"]
    },
    "mechanism": {
      "explanation": "How it works in plain English",
      "algorithm": "Named algorithm if applicable",
      "approach": "Implementation approach",
      "patterns": ["design patterns used"]
    },
    "complexity": {
      "time": "Big-O time complexity",
      "space": "Big-O space complexity",
      "cognitive": "trivial|simple|moderate|complex|very_complex"
    }
  },
  "security": {
    "additionalVulnerabilities": [{"id": "CWE-XXX", "description": "..."}],
    "threatInsights": ["..."],
    "recommendations": ["..."]
  },
  "rationale": {
    "constraints": [{"type": "technical|business|regulatory|resource", "description": "...", "source": "inferred"}],
    "tradeoffs": [{"gained": "...", "sacrificed": "...", "rationale": "..."}],
    "alternatives": [{"approach": "...", "rejected": "why not chosen"}],
    "assumptions": [{"assumption": "...", "validated": false}],
    "risks": [{"risk": "...", "likelihood": "low|medium|high", "impact": "low|medium|high"}]
  }
}`;
}

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Extract semantics, security, and rationale in a single LLM call.
 * Saves ~1000 tokens per entity compared to 3 separate calls.
 */
export async function extractConsolidated(
  input: ConsolidatedInput,
  config: ConsolidatedConfig
): Promise<ConsolidatedExtraction> {
  const llmService = resolveLlmServiceAdapter();

  // Get static security analysis first (doesn't require LLM)
  const staticSecurity = extractSecurityStatic({
    name: input.name,
    content: input.content,
    signature: input.signature,
    filePath: input.filePath,
  });

  const prompt = buildConsolidatedPrompt(input, staticSecurity);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: CONSOLIDATED_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  const modelId = config.llmModelId
    || resolveLibrarianModelId(config.llmProvider)
    || 'claude-haiku-4-5-20241022';

  const llmEvidence = await buildLlmEvidence({
    provider: config.llmProvider,
    modelId,
    messages,
  });

  try {
    const response = await llmService.chat({
      provider: config.llmProvider,
      modelId,
      messages,
      maxTokens: 2500, // vs 3500 total for 3 separate calls
      governorContext: config.governor,
    });

    const parsed = parseConsolidatedResponse(response.content, input, staticSecurity);

    return {
      semantics: parsed.semantics,
      security: parsed.security,
      rationale: parsed.rationale,
      llmEvidence,
      tokensSaved: 1000, // Approximate savings vs 3 calls
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = message.includes('unverified_by_trace')
      ? message
      : `unverified_by_trace(consolidated_extraction_failed): ${message}`;
    throw new Error(prefix);
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseConsolidatedResponse(
  response: string,
  input: ConsolidatedInput,
  staticSecurity: SecurityExtraction
): {
  semantics: SemanticsExtraction;
  security: SecurityExtraction;
  rationale: RationaleExtraction;
} {
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
  const jsonStr = jsonMatch[1] || response;

  let parsed: {
    semantics?: {
      purpose?: { summary?: string; explanation?: string; problemSolved?: string; valueProp?: string };
      domain?: { concepts?: string[]; boundedContext?: string; businessRules?: string[] };
      intent?: { primaryUseCase?: string; secondaryUseCases?: string[]; antiUseCases?: string[] };
      mechanism?: { explanation?: string; algorithm?: string; approach?: string; patterns?: string[] };
      complexity?: { time?: string; space?: string; cognitive?: string };
    };
    security?: {
      additionalVulnerabilities?: Array<{ id: string; description: string }>;
      threatInsights?: string[];
      recommendations?: string[];
    };
    rationale?: {
      constraints?: Array<{ type: string; description: string; source: string }>;
      tradeoffs?: Array<{ gained: string; sacrificed: string; rationale: string }>;
      alternatives?: Array<{ approach: string; rejected: string }>;
      assumptions?: Array<{ assumption: string; validated: boolean }>;
      risks?: Array<{ risk: string; likelihood: string; impact: string }>;
    };
  };

  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error(
      `unverified_by_trace(consolidated_parse_failed): Could not parse LLM response as JSON. ` +
      `Response: ${response.slice(0, 200)}...`
    );
  }

  // Build semantics result
  const semantics: SemanticsExtraction = {
    semantics: buildSemantics(parsed.semantics, input),
    confidence: calculateSemanticsConfidence(parsed.semantics),
  };

  // Build security result (merge with static analysis)
  const security: SecurityExtraction = mergeSecurityResults(staticSecurity, parsed.security);

  // Build rationale result
  const rationale: RationaleExtraction = {
    rationale: buildRationale(parsed.rationale),
    confidence: calculateRationaleConfidence(parsed.rationale),
  };

  return { semantics, security, rationale };
}

function buildSemantics(
  data: {
    purpose?: { summary?: string; explanation?: string; problemSolved?: string; valueProp?: string };
    domain?: { concepts?: string[]; boundedContext?: string; businessRules?: string[] };
    intent?: { primaryUseCase?: string; secondaryUseCases?: string[]; antiUseCases?: string[] };
    mechanism?: { explanation?: string; algorithm?: string; approach?: string; patterns?: string[] };
    complexity?: { time?: string; space?: string; cognitive?: string };
  } | undefined,
  input: ConsolidatedInput
): EntitySemantics {
  const purpose = data?.purpose;
  const domain = data?.domain;
  const intent = data?.intent;
  const mechanism = data?.mechanism;
  const complexity = data?.complexity;

  return {
    purpose: {
      summary: purpose?.summary || input.existingPurpose || `${input.name} function`,
      explanation: purpose?.explanation || '',
      problemSolved: purpose?.problemSolved || '',
      valueProp: purpose?.valueProp || '',
    },
    domain: {
      concepts: domain?.concepts || [],
      boundedContext: domain?.boundedContext,
      businessRules: domain?.businessRules || [],
    },
    intent: {
      primaryUseCase: intent?.primaryUseCase || '',
      secondaryUseCases: intent?.secondaryUseCases || [],
      antiUseCases: intent?.antiUseCases || [],
    },
    mechanism: {
      explanation: mechanism?.explanation || '',
      algorithm: mechanism?.algorithm,
      steps: [],
      approach: mechanism?.approach || 'Not determined',
      approachRationale: '',
      patterns: mechanism?.patterns || [],
      dataStructures: [],
      stateManagement: undefined,
    },
    complexity: {
      time: complexity?.time || 'O(?)',
      space: complexity?.space || 'O(?)',
      cognitive: normalizeCognitive(complexity?.cognitive),
    },
  };
}

function normalizeCognitive(value: string | undefined): 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex' {
  if (!value) return 'moderate';
  const lower = value.toLowerCase();
  if (lower.includes('trivial')) return 'trivial';
  if (lower.includes('simple')) return 'simple';
  if (lower.includes('complex') && lower.includes('very')) return 'very_complex';
  if (lower.includes('complex')) return 'complex';
  return 'moderate';
}

function calculateSemanticsConfidence(data: unknown): number {
  if (!data || typeof data !== 'object') return 0.3;
  const obj = data as Record<string, unknown>;

  let score = 0.5;
  if (obj.purpose && typeof obj.purpose === 'object') {
    const purpose = obj.purpose as Record<string, unknown>;
    if (purpose.summary && typeof purpose.summary === 'string' && purpose.summary.length > 10) score += 0.15;
    if (purpose.explanation && typeof purpose.explanation === 'string') score += 0.1;
  }
  if (obj.mechanism && typeof obj.mechanism === 'object') {
    const mechanism = obj.mechanism as Record<string, unknown>;
    if (mechanism.explanation) score += 0.1;
  }
  if (obj.domain && typeof obj.domain === 'object') {
    const domain = obj.domain as Record<string, unknown>;
    if (Array.isArray(domain.concepts) && domain.concepts.length > 0) score += 0.1;
  }

  return Math.min(0.95, score);
}

function mergeSecurityResults(
  staticResult: SecurityExtraction,
  llmResult: {
    additionalVulnerabilities?: Array<{ id: string; description: string }>;
    threatInsights?: string[];
    recommendations?: string[];
  } | undefined
): SecurityExtraction {
  const security = { ...staticResult.security };

  if (llmResult?.additionalVulnerabilities) {
    for (const vuln of llmResult.additionalVulnerabilities) {
      if (!security.vulnerabilities.some(v => v.id === vuln.id)) {
        security.vulnerabilities.push({
          id: vuln.id,
          description: vuln.description,
          severity: 'medium',
          cwe: vuln.id,
          remediation: 'Review and address this vulnerability',
        });
      }
    }
  }

  // Update risk score if LLM found additional issues
  if (
    llmResult?.additionalVulnerabilities &&
    llmResult.additionalVulnerabilities.length > 0 &&
    security.riskScore
  ) {
    security.riskScore.overall = Math.min(10, security.riskScore.overall + llmResult.additionalVulnerabilities.length);
  }

  return {
    security,
    confidence: staticResult.confidence + (llmResult ? 0.1 : 0),
  };
}

function buildRationale(
  data: {
    constraints?: Array<{ type: string; description: string; source: string }>;
    tradeoffs?: Array<{ gained: string; sacrificed: string; rationale: string }>;
    alternatives?: Array<{ approach: string; rejected: string }>;
    assumptions?: Array<{ assumption: string; validated: boolean }>;
    risks?: Array<{ risk: string; likelihood: string; impact: string }>;
  } | undefined
): EntityRationale {
  return {
    decisions: [],
    constraints: (data?.constraints || []).map(c => ({
      type: normalizeConstraintType(c.type),
      description: c.description,
      source: c.source || 'llm-inferred',
    })),
    tradeoffs: (data?.tradeoffs || []).map(t => ({
      gained: t.gained,
      sacrificed: t.sacrificed,
      rationale: t.rationale || '',
    })),
    alternatives: (data?.alternatives || []).map(a => ({
      approach: a.approach,
      rejected: a.rejected,
    })),
    assumptions: (data?.assumptions || []).map(a => ({
      assumption: a.assumption,
      validated: a.validated || false,
      validatedBy: undefined,
    })),
    risks: (data?.risks || []).map(r => ({
      risk: r.risk,
      likelihood: normalizeRiskLevel(r.likelihood),
      impact: normalizeRiskLevel(r.impact),
      mitigation: undefined,
    })),
  };
}

function normalizeConstraintType(type: string): 'technical' | 'business' | 'regulatory' | 'resource' {
  const lower = (type || '').toLowerCase();
  if (lower.includes('business')) return 'business';
  if (lower.includes('regulatory') || lower.includes('compliance')) return 'regulatory';
  if (lower.includes('resource')) return 'resource';
  return 'technical';
}

function normalizeRiskLevel(level: string): 'low' | 'medium' | 'high' {
  const lower = (level || '').toLowerCase();
  if (lower.includes('high')) return 'high';
  if (lower.includes('low')) return 'low';
  return 'medium';
}

function calculateRationaleConfidence(data: unknown): number {
  if (!data || typeof data !== 'object') return 0.3;
  const obj = data as Record<string, unknown>;

  let score = 0.4;
  if (Array.isArray(obj.constraints) && obj.constraints.length > 0) score += 0.15;
  if (Array.isArray(obj.tradeoffs) && obj.tradeoffs.length > 0) score += 0.15;
  if (Array.isArray(obj.assumptions) && obj.assumptions.length > 0) score += 0.1;
  if (Array.isArray(obj.risks) && obj.risks.length > 0) score += 0.1;

  return Math.min(0.9, score);
}
