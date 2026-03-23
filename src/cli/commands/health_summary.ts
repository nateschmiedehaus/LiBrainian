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

export type StorageRuntimeFailureKind =
  | 'busy_lock'
  | 'recovery_failed'
  | 'rollback_failed'
  | 'unavailable';

export interface StorageRuntimeFailure {
  kind: StorageRuntimeFailureKind;
  rawMessage: string;
  displayMessage: string;
}

export function classifyStorageRuntimeFailure(error: unknown): StorageRuntimeFailure {
  const rawMessage = error instanceof Error
    ? error.message
    : String(error ?? 'Unknown error');
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('storage_transaction_rollback_failed')) {
    return {
      kind: 'rollback_failed',
      rawMessage,
      displayMessage: stripStorageErrorPrefix(rawMessage, 'storage_transaction_rollback_failed'),
    };
  }

  if (normalized.includes('storage_recovery_failed')) {
    return {
      kind: 'recovery_failed',
      rawMessage,
      displayMessage: stripStorageErrorPrefix(rawMessage, 'storage_recovery_failed'),
    };
  }

  if (
    normalized.includes('storage_locked')
    || normalized.includes('database is locked')
    || normalized.includes('sqlite_busy')
    || normalized.includes('busy')
  ) {
    return {
      kind: 'busy_lock',
      rawMessage,
      displayMessage: stripStorageErrorPrefix(rawMessage, 'storage_locked'),
    };
  }

  return {
    kind: 'unavailable',
    rawMessage,
    displayMessage: stripLegacyTracePrefix(rawMessage),
  };
}

function stripStorageErrorPrefix(message: string, code: string): string {
  const withoutLegacyPrefix = stripLegacyTracePrefix(message);
  const prefix = `${code}:`;
  if (withoutLegacyPrefix.toLowerCase().startsWith(prefix.toLowerCase())) {
    return withoutLegacyPrefix.slice(prefix.length).trim();
  }
  return withoutLegacyPrefix.trim();
}

function stripLegacyTracePrefix(message: string): string {
  return message.replace(/^unverified_by_trace:/iu, '').trim();
}

export function summarizeSharedHealthChecks(
  checks: HealthCheck[],
  options: { generatedAt?: string; includePassingChecks?: boolean } = {},
): SharedHealthSummary {
  const summary = {
    total: checks.length,
    ok: 0,
    warnings: 0,
    errors: 0,
  };

  for (const check of checks) {
    if (check.status === 'ERROR') summary.errors += 1;
    else if (check.status === 'WARNING') summary.warnings += 1;
    else summary.ok += 1;
  }

  const filteredChecks = options.includePassingChecks
    ? checks
    : checks.filter((check) => check.status !== 'OK');

  return {
    status: summary.errors > 0 ? 'ERROR' : (summary.warnings > 0 ? 'WARNING' : 'OK'),
    summary,
    checks: filteredChecks,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}
