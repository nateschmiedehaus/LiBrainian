/**
 * @fileoverview Basic hallucination detection heuristics for evaluation.
 */

export interface HallucinationDetectionInput {
  claims: string[];
  mustNotClaim?: string[];
}

export interface HallucinationDetectionResult {
  falseClaims: string[];
  hallucinationCount: number;
  hallucinationRate: number;
}

const OVERLAP_THRESHOLD_LONG = 0.75;
const OVERLAP_THRESHOLD_SHORT = 0.66;

export function detectHallucinations(
  input: HallucinationDetectionInput
): HallucinationDetectionResult {
  const mustNotClaim = input.mustNotClaim ?? [];
  if (mustNotClaim.length === 0) {
    return { falseClaims: [], hallucinationCount: 0, hallucinationRate: 0 };
  }

  const normalizedClaims = input.claims.map(normalize);
  const claimTokens = normalizedClaims.map(tokenize);
  const uniqueMustNot = uniqueNormalized(mustNotClaim);

  const falseClaims = uniqueMustNot.filter((mustNot) => {
    const mustTokens = tokenize(mustNot);
    for (let i = 0; i < normalizedClaims.length; i += 1) {
      const claim = normalizedClaims[i];
      if (claim.includes(mustNot)) {
        return true;
      }
      if (matchesByOverlap(mustTokens, claimTokens[i])) {
        return true;
      }
    }
    return false;
  });

  const hallucinationCount = falseClaims.length;
  const hallucinationRate = uniqueMustNot.length > 0
    ? hallucinationCount / uniqueMustNot.length
    : 0;

  return {
    falseClaims,
    hallucinationCount,
    hallucinationRate,
  };
}

function matchesByOverlap(mustTokens: string[], claimTokens: string[]): boolean {
  if (mustTokens.length < 3) return false;
  const overlap = tokenOverlap(mustTokens, claimTokens);
  const threshold = mustTokens.length <= 3 ? OVERLAP_THRESHOLD_SHORT : OVERLAP_THRESHOLD_LONG;
  return overlap >= threshold;
}

function tokenOverlap(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0) return 0;
  const bSet = new Set(bTokens);
  let overlapCount = 0;
  for (const token of aTokens) {
    if (bSet.has(token)) overlapCount += 1;
  }
  return overlapCount / aTokens.length;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  if (!value) return [];
  return value.split(' ').filter(Boolean);
}

function uniqueNormalized(values: string[]): string[] {
  const normalized = values.map(normalize).filter(Boolean);
  return Array.from(new Set(normalized));
}
