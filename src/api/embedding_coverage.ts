export const SEMANTIC_EMBEDDING_COVERAGE_MIN_PCT = 80;

export interface EmbeddingCoverageSummary {
  totalFunctions: number;
  embeddedFunctions: number;
  coverageRatio: number;
  coveragePct: number;
  needsEmbeddingCount: number;
  total_functions: number;
  embedded_functions: number;
  coverage_pct: number;
  needs_embedding_count: number;
}

export function computeEmbeddingCoverage(totalFunctionsRaw: number, totalEmbeddingsRaw: number): EmbeddingCoverageSummary {
  const totalFunctions = sanitizeWholeNumber(totalFunctionsRaw);
  const embeddedFunctions = Math.min(sanitizeWholeNumber(totalEmbeddingsRaw), totalFunctions);
  const needsEmbeddingCount = Math.max(totalFunctions - embeddedFunctions, 0);
  const coverageRatio = totalFunctions > 0 ? embeddedFunctions / totalFunctions : 1;
  const coveragePct = Number((coverageRatio * 100).toFixed(1));

  return {
    totalFunctions,
    embeddedFunctions,
    coverageRatio,
    coveragePct,
    needsEmbeddingCount,
    total_functions: totalFunctions,
    embedded_functions: embeddedFunctions,
    coverage_pct: coveragePct,
    needs_embedding_count: needsEmbeddingCount,
  };
}

export function hasSufficientSemanticCoverage(
  coverage: EmbeddingCoverageSummary,
  minimumPct: number = SEMANTIC_EMBEDDING_COVERAGE_MIN_PCT
): boolean {
  if (coverage.totalFunctions <= 0) return true;
  return coverage.coveragePct >= minimumPct;
}

function sanitizeWholeNumber(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}
