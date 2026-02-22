type GateTask = {
  status?: unknown;
  note?: unknown;
  verified?: unknown;
};

type GateSet = {
  tasks?: Record<string, GateTask>;
};

export type GateIntegrityFailureCode =
  | 'status_unverified'
  | 'evidence_manifest_missing'
  | 'verified_false';

export interface GateIntegrityFailure {
  taskId: string;
  code: GateIntegrityFailureCode;
  message: string;
}

const ALLOWED_UNSTARTED_STATUSES = new Set(['not_started', 'not_implemented']);

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

function noteContainsEvidenceManifestMissing(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.toLowerCase().includes('evidence_manifest_missing');
}

export function findGateIntegrityFailures(gates: GateSet): GateIntegrityFailure[] {
  const tasks = gates.tasks ?? {};
  const failures: GateIntegrityFailure[] = [];

  for (const [taskId, task] of Object.entries(tasks)) {
    const status = normalizeStatus(task?.status);
    const hasManifestMissingNote = noteContainsEvidenceManifestMissing(task?.note);
    const verifiedFalse = task?.verified === false;

    if (status === 'unverified') {
      failures.push({
        taskId,
        code: 'status_unverified',
        message: 'Gate task status is unverified. Use pass/fail/not_started/not_implemented.',
      });
    }

    if (hasManifestMissingNote) {
      failures.push({
        taskId,
        code: 'evidence_manifest_missing',
        message: 'Gate task note still references evidence_manifest_missing.',
      });
    }

    if (verifiedFalse && status && !ALLOWED_UNSTARTED_STATUSES.has(status)) {
      failures.push({
        taskId,
        code: 'verified_false',
        message: 'Gate task remains verified=false for an executed status.',
      });
    }
  }

  return failures;
}
