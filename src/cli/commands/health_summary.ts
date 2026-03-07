export type HealthCheckStatus = 'OK' | 'WARNING' | 'ERROR';

export interface HealthCheck {
  name: string;
  status: HealthCheckStatus;
  message: string;
  suggestion?: string;
}

export interface SharedHealthSummary {
  status: HealthCheckStatus;
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
  };
  checks: HealthCheck[];
  generatedAt: string;
}

const READINESS_CHECK_NAMES = new Set([
  'Database Path Resolution',
  'Database Access',
  'Bootstrap Status',
  'Index Freshness',
  'Watch Freshness',
  'Lock File Staleness',
  'Functions/Embeddings Correlation',
  'Cross-DB Consistency',
  'Modules Indexed',
  'Context Packs Health',
  'Knowledge Confidence',
  'Embedding Provider',
  'LLM Provider',
]);

export function summarizeSharedHealthChecks(
  checks: HealthCheck[],
  options: { generatedAt?: string; includePassingChecks?: boolean } = {},
): SharedHealthSummary {
  const readinessChecks = checks.filter((check) => READINESS_CHECK_NAMES.has(check.name));
  const summary = {
    total: readinessChecks.length,
    ok: 0,
    warnings: 0,
    errors: 0,
  };

  for (const check of readinessChecks) {
    if (check.status === 'ERROR') summary.errors += 1;
    else if (check.status === 'WARNING') summary.warnings += 1;
    else summary.ok += 1;
  }

  const filteredChecks = options.includePassingChecks
    ? readinessChecks
    : readinessChecks.filter((check) => check.status !== 'OK');

  return {
    status: summary.errors > 0 ? 'ERROR' : (summary.warnings > 0 ? 'WARNING' : 'OK'),
    summary,
    checks: filteredChecks,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}
