/**
 * @fileoverview Synthesis metric utilities for evaluation runner.
 */

import type { CitationInput } from './citation_accuracy.js';
import { detectHallucinations } from './hallucination.js';

export type SynthesisCategory =
  | 'structural'
  | 'behavioral'
  | 'architectural'
  | 'impact'
  | 'security';

export interface SynthesisMetricInput {
  answer: string;
  claims?: string[];
  citations?: CitationInput[];
  mustIncludeFacts?: string[];
  mustNotClaim?: string[];
  summary?: string;
  acceptableVariations?: string[];
  category?: SynthesisCategory;
  citationVerification?: {
    verifiedCitations: number;
    verifiableCitations: number;
  };
}

export interface SynthesisMetricResult {
  claims: string[];
  factPrecision: number;
  factRecall: number;
  summaryAccuracy: number;
  consistencyScore: number;
  hallucinationCount: number;
  hallucinationRate: number;
  groundingRate: number;
  fabricationRate: number | null;
  missingFacts: string[];
  falseClaims: string[];
  structuralAccuracy?: number;
  behavioralAccuracy?: number;
}

export function computeSynthesisMetrics(input: SynthesisMetricInput): SynthesisMetricResult {
  const claims = resolveClaims(input.claims, input.answer);
  const normalizedClaims = claims.map(normalize);
  const normalizedFacts = uniqueNormalized(input.mustIncludeFacts);

  const matchedFacts = normalizedFacts.filter((fact) =>
    normalizedClaims.some((claim) => claim.includes(fact))
  );
  const missingFacts = (input.mustIncludeFacts ?? []).filter(
    (fact) => !matchedFacts.includes(normalize(fact))
  );

  const claimMatches = normalizedClaims.filter((claim) =>
    normalizedFacts.some((fact) => claim.includes(fact))
  );

  const hallucinationResult = detectHallucinations({
    claims,
    mustNotClaim: input.mustNotClaim,
  });

  const factRecall = normalizedFacts.length > 0 ? matchedFacts.length / normalizedFacts.length : 1;
  const factPrecision = normalizedClaims.length > 0
    ? claimMatches.length / normalizedClaims.length
    : normalizedFacts.length === 0
      ? 1
      : 0;

  const summaryAccuracy = computeSummaryAccuracy({
    answer: input.answer,
    summary: input.summary,
    acceptableVariations: input.acceptableVariations,
    fallback: factRecall,
  });
  const consistencyScore = summaryAccuracy;

  const hallucinationCount = hallucinationResult.hallucinationCount;
  const hallucinationRate = hallucinationResult.hallucinationRate;

  const groundingRate = computeGroundingRate({
    claims,
    citations: input.citations ?? [],
  });

  const fabricationRate = computeFabricationRate(input.citationVerification);
  const accuracyByCategory = computeCategoryAccuracy(input.category, {
    factRecall,
    summaryAccuracy,
  });

  return {
    claims,
    factPrecision,
    factRecall,
    summaryAccuracy,
    consistencyScore,
    hallucinationCount,
    hallucinationRate,
    groundingRate,
    fabricationRate,
    missingFacts,
    falseClaims: hallucinationResult.falseClaims.map((fact) => fact.trim()),
    ...accuracyByCategory,
  };
}

function resolveClaims(claims: string[] | undefined, answer: string): string[] {
  if (claims && claims.length > 0) return claims;
  return splitClaims(answer);
}

function computeSummaryAccuracy(options: {
  answer: string;
  summary?: string;
  acceptableVariations?: string[];
  fallback: number;
}): number {
  const normalizedAnswer = normalize(options.answer);
  const targets = [options.summary, ...(options.acceptableVariations ?? [])].filter(
    (value): value is string => Boolean(value)
  );

  if (targets.length === 0) return options.fallback;

  const match = targets.some((target) => normalizedAnswer.includes(normalize(target)));
  return match ? 1 : options.fallback;
}

function computeGroundingRate(options: { claims: string[]; citations: CitationInput[] }): number {
  const { claims, citations } = options;
  if (!claims || claims.length === 0) return 0;
  const uniqueCitations = new Set(citations.map(normalizeCitationToken).filter(Boolean));
  return clamp(uniqueCitations.size / claims.length);
}

function computeFabricationRate(
  verification?: { verifiedCitations: number; verifiableCitations: number }
): number | null {
  if (!verification) return null;
  if (verification.verifiableCitations <= 0) return null;
  const invalid = verification.verifiableCitations - verification.verifiedCitations;
  return clamp(invalid / verification.verifiableCitations);
}

function computeCategoryAccuracy(
  category: SynthesisCategory | undefined,
  metrics: { factRecall: number; summaryAccuracy: number }
): { structuralAccuracy?: number; behavioralAccuracy?: number } {
  if (category === 'structural') {
    return { structuralAccuracy: metrics.factRecall };
  }
  if (category === 'behavioral') {
    return { behavioralAccuracy: metrics.summaryAccuracy };
  }
  return {};
}

function splitClaims(answer: string): string[] {
  return answer
    .split(/\.|;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCitationToken(citation: CitationInput): string {
  if (typeof citation === 'string') return citation.trim();
  if (!citation) return '';
  if (citation.refId) return citation.refId.trim();
  if (citation.file && citation.line) return `${citation.file}:${citation.line}`;
  if (citation.file) return citation.file.trim();
  return '';
}

function uniqueNormalized(values?: string[]): string[] {
  if (!values) return [];
  const normalized = values
    .map((value) => normalize(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
