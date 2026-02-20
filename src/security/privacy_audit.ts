import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface PrivacyAuditEvent {
  ts: string;
  op: 'embed' | 'synthesize' | 'provider_check' | 'query' | 'bootstrap' | string;
  files: string[];
  model: string;
  local: boolean;
  contentSent: boolean;
  status?: 'allowed' | 'blocked';
  note?: string;
}

export interface PrivacyReportSummary {
  logPath: string;
  totalEvents: number;
  blockedEvents: number;
  externalContentSentEvents: number;
  localOnlyEvents: number;
  operations: Record<string, number>;
  models: Record<string, number>;
  since: string | null;
  until: string | null;
}

const PRIVACY_AUDIT_RELATIVE_PATH = path.join('.librarian', 'audit', 'privacy.log');

export function resolvePrivacyAuditLogPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PRIVACY_AUDIT_RELATIVE_PATH);
}

export async function appendPrivacyAuditEvent(
  workspaceRoot: string,
  event: PrivacyAuditEvent,
): Promise<void> {
  const targetPath = resolvePrivacyAuditLogPath(workspaceRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.appendFile(targetPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function parseAuditLine(line: string): PrivacyAuditEvent | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as Partial<PrivacyAuditEvent>;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.ts !== 'string' || typeof value.op !== 'string') return null;
    const files = Array.isArray(value.files)
      ? value.files.filter((file): file is string => typeof file === 'string' && file.length > 0)
      : [];
    return {
      ts: value.ts,
      op: value.op,
      files,
      model: typeof value.model === 'string' ? value.model : 'unknown',
      local: Boolean(value.local),
      contentSent: Boolean(value.contentSent),
      status: value.status === 'blocked' ? 'blocked' : 'allowed',
      note: typeof value.note === 'string' ? value.note : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function generatePrivacyReport(
  workspaceRoot: string,
  options: { since?: string } = {},
): Promise<PrivacyReportSummary> {
  const logPath = resolvePrivacyAuditLogPath(workspaceRoot);
  let raw = '';
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    return {
      logPath,
      totalEvents: 0,
      blockedEvents: 0,
      externalContentSentEvents: 0,
      localOnlyEvents: 0,
      operations: {},
      models: {},
      since: null,
      until: null,
    };
  }

  const since = options.since ? normalizeTimestamp(options.since) : null;
  const sinceMs = since ? Date.parse(since) : null;
  const operations = new Map<string, number>();
  const models = new Map<string, number>();
  let totalEvents = 0;
  let blockedEvents = 0;
  let externalContentSentEvents = 0;
  let localOnlyEvents = 0;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const event = parseAuditLine(line);
    if (!event) continue;
    const eventTs = normalizeTimestamp(event.ts);
    if (!eventTs) continue;
    const eventMs = Date.parse(eventTs);
    if (sinceMs !== null && Number.isFinite(eventMs) && eventMs < sinceMs) continue;

    totalEvents += 1;
    operations.set(event.op, (operations.get(event.op) ?? 0) + 1);
    models.set(event.model, (models.get(event.model) ?? 0) + 1);
    if (event.status === 'blocked') blockedEvents += 1;
    if (event.contentSent && !event.local) externalContentSentEvents += 1;
    if (event.local && !event.contentSent) localOnlyEvents += 1;
    if (!earliest || eventTs < earliest) earliest = eventTs;
    if (!latest || eventTs > latest) latest = eventTs;
  }

  return {
    logPath,
    totalEvents,
    blockedEvents,
    externalContentSentEvents,
    localOnlyEvents,
    operations: Object.fromEntries(Array.from(operations.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
    models: Object.fromEntries(Array.from(models.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
    since: earliest,
    until: latest,
  };
}
