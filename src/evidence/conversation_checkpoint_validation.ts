type UnknownObject = Record<string, unknown>;

const CHECKPOINT_COMMENT_RE = /<!--\s*checkpoint\b([\s\S]*?)-->/gi;
const HEADER_KEY_RE = /^(?<key>[a-z0-9_]+)\s*:\s*(?<value>.*)$/i;

export interface ParsedConversationCheckpoint {
  raw: string;
  date: string;
  dateMs: number;
  gatesReconcileSha: string;
  claimedStatus: string;
}

export interface CheckpointValidationFailure {
  code: string;
  message: string;
}

export interface CheckpointValidationReport {
  ok: boolean;
  checkpoint?: ParsedConversationCheckpoint;
  failures: CheckpointValidationFailure[];
}

export interface ValidateConversationCheckpointOptions {
  conversationInsightsMarkdown: string;
  gatesJson: UnknownObject;
  latestReconcileSha: string | null;
  latestReconcileDate: string | null;
}

const PASSED_CLAIM_VALUES = new Set(['pass', 'passes', 'passed', 'true', 'ok', 'okay']);
const FAIL_STATUS = 'fail';

function normalizeLineValue(value: string): string {
  return value.trim().toLowerCase();
}

function toObject(value: unknown): UnknownObject {
  return typeof value === 'object' && value !== null ? (value as UnknownObject) : {};
}

function toRecords(value: unknown): Record<string, UnknownObject> {
  if (!value || typeof value !== 'object') return {};
  const output: Record<string, UnknownObject> = {};
  for (const [taskId, task] of Object.entries(value as Record<string, unknown>)) {
    output[taskId] = toObject(task);
  }
  return output;
}

function normalizeTaskStatus(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function parseCheckpointBlock(block: string): ParsedConversationCheckpoint | null {
  const lines = block.split('\n');
  const fields = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const match = HEADER_KEY_RE.exec(trimmed);
    HEADER_KEY_RE.lastIndex = 0;
    if (!match?.groups) continue;
    const key = normalizeLineValue(match.groups.key);
    const value = match.groups.value.trim();
    if (!value) continue;
    fields.set(key, value);
  }

  const date = fields.get('date');
  const gatesReconcileSha = fields.get('gates_reconcile_sha');
  const claimedStatus = fields.get('claimed_status');
  if (!date || !gatesReconcileSha || !claimedStatus) return null;
  const dateMs = Date.parse(date);
  if (!Number.isFinite(dateMs)) return null;

  return {
    raw: block,
    date,
    dateMs,
    gatesReconcileSha,
    claimedStatus,
  };
}

export function parseConversationCheckpointHeaders(markdown: string): ParsedConversationCheckpoint[] {
  const headers: ParsedConversationCheckpoint[] = [];
  for (const match of markdown.matchAll(CHECKPOINT_COMMENT_RE)) {
    const block = match[1];
    const header = parseCheckpointBlock(block);
    if (header) {
      headers.push(header);
    }
  }
  return headers;
}

export function getLatestConversationCheckpoint(markdown: string): ParsedConversationCheckpoint | null {
  const headers = parseConversationCheckpointHeaders(markdown);
  if (headers.length === 0) return null;

  return headers.reduce((latest, current) => {
    if (!latest || current.dateMs > latest.dateMs) return current;
    return latest;
  });
}

function isPassedClaim(value: string): boolean {
  return PASSED_CLAIM_VALUES.has(normalizeLineValue(value));
}

function addFailure(
  failures: CheckpointValidationFailure[],
  code: string,
  message: string,
): void {
  failures.push({ code, message });
}

export function validateConversationCheckpoint(
  input: ValidateConversationCheckpointOptions,
): CheckpointValidationReport {
  const failures: CheckpointValidationFailure[] = [];
  const checkpoint = getLatestConversationCheckpoint(input.conversationInsightsMarkdown);
  if (!checkpoint) {
    return {
      ok: false,
      failures: [{
        code: 'missing_checkpoint_header',
        message: 'No machine-readable checkpoint header found in conversation insights.',
      }],
    };
  }

  if (!checkpoint.gatesReconcileSha || checkpoint.gatesReconcileSha.length < 6) {
    addFailure(failures, 'invalid_checkpoint_sha', 'Checkpoint is missing a valid gates_reconcile_sha field.');
  }

  if (!checkpoint.claimedStatus) {
    addFailure(failures, 'invalid_checkpoint_status', 'Checkpoint is missing a valid claimed_status field.');
  }

  if (!input.latestReconcileSha) {
    addFailure(failures, 'missing_reconcile_reference', 'Could not resolve latest evidence:reconcile commit SHA.');
  } else if (checkpoint.gatesReconcileSha !== input.latestReconcileSha) {
    addFailure(
      failures,
      'checkpoint_reconcile_sha_mismatch',
      `Checkpoint sha (${checkpoint.gatesReconcileSha}) does not match latest evidence:reconcile commit (${input.latestReconcileSha}).`,
    );
  }

  if (input.latestReconcileDate) {
    const reconcileDateMs = Date.parse(input.latestReconcileDate);
    if (!Number.isFinite(reconcileDateMs)) {
      addFailure(
        failures,
        'invalid_reconcile_date',
        'Latest evidence:reconcile commit date is invalid.',
      );
    } else if (checkpoint.dateMs < reconcileDateMs) {
      addFailure(
        failures,
        'checkpoint_stale',
        `Checkpoint date (${checkpoint.date}) is older than latest evidence:reconcile (${input.latestReconcileDate}).`,
      );
    }
  }

  if (isPassedClaim(checkpoint.claimedStatus)) {
    const gatesTasks = toRecords(toObject(input.gatesJson).tasks);
    const gatesSummary = toObject(toObject(input.gatesJson).summary);

    for (const [taskId, task] of Object.entries(gatesTasks)) {
      const status = normalizeTaskStatus(task.status);
      const verified = task.verified === true || task.verified === false ? task.verified : undefined;

      if (status === FAIL_STATUS || verified === false) {
        addFailure(
          failures,
          `checkpoint_gates_failed_${taskId}`,
          `Task "${taskId}" is not a passing checkpoint-compatible state (status=${String(status || 'unknown')}, verified=${String(verified)})`,
        );
      }
    }

    for (const [layer, counts] of Object.entries(gatesSummary)) {
      if (!counts || typeof counts !== 'object') continue;
      for (const [status, rawCount] of Object.entries(counts as UnknownObject)) {
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count <= 0 || normalizeTaskStatus(status) !== FAIL_STATUS) continue;
        addFailure(
          failures,
          `checkpoint_summary_fail_${layer}_${normalizeTaskStatus(status)}`,
          `GATES summary layer "${layer}" reports ${count} item(s) with status "${status}".`,
        );
      }
    }
  }

  return {
    ok: failures.length === 0,
    checkpoint,
    failures,
  };
}
