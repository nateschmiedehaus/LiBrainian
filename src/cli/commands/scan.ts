import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { createEmptyRedactionCounts, type RedactionAuditReportV1 } from '../../api/redaction.js';
import { CliError } from '../errors.js';

export interface ScanCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type ScanSecretsReport = {
  kind: 'SecretsScanReport.v1';
  schema_version: 1;
  created_at: string;
  workspace: string;
  reportFound: boolean;
  sourceReport: { path: string; created_at: string } | null;
  redactions: RedactionAuditReportV1['redactions'];
};

const REDACTION_AUDIT_ROOT = path.join('state', 'audits', 'librarian', 'redaction');

export async function scanCommand(options: ScanCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      secrets: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      format: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (!values.secrets) {
    throw new CliError('Use --secrets to run secret redaction scan reporting.', 'INVALID_ARGUMENT');
  }

  const format = values.json || values.format === 'json' ? 'json' : 'text';
  const workspaceRoot = path.resolve(workspace);
  const latest = await readLatestRedactionReport(workspaceRoot);

  const payload: ScanSecretsReport = {
    kind: 'SecretsScanReport.v1',
    schema_version: 1,
    created_at: new Date().toISOString(),
    workspace: workspaceRoot,
    reportFound: Boolean(latest),
    sourceReport: latest
      ? {
          path: latest.path,
          created_at: latest.report.created_at,
        }
      : null,
    redactions: latest?.report.redactions ?? createEmptyRedactionCounts(),
  };

  if (format === 'json') {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log('Secrets Scan');
  console.log('============\n');
  console.log(`Workspace: ${workspaceRoot}`);
  if (payload.reportFound && payload.sourceReport) {
    console.log(`Source report: ${path.relative(workspaceRoot, payload.sourceReport.path)}`);
    console.log(`Report created: ${payload.sourceReport.created_at}`);
  } else {
    console.log('Source report: none found');
    console.log('Run librarian bootstrap/index to generate redaction audit artifacts.');
  }
  console.log(`\nTotal redactions: ${payload.redactions.total}`);
  for (const [type, count] of Object.entries(payload.redactions.by_type)) {
    console.log(`  ${type}: ${count}`);
  }
}

async function readLatestRedactionReport(workspaceRoot: string): Promise<{ path: string; report: RedactionAuditReportV1 } | null> {
  const auditRoot = path.join(workspaceRoot, REDACTION_AUDIT_ROOT);
  let entries: string[];
  try {
    entries = await fs.readdir(auditRoot);
  } catch {
    return null;
  }

  let latest: { path: string; report: RedactionAuditReportV1; createdAtMs: number } | null = null;
  for (const entry of entries) {
    const reportPath = path.join(auditRoot, entry, 'RedactionAuditReport.v1.json');
    let raw: string;
    try {
      raw = await fs.readFile(reportPath, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isRedactionAuditReport(parsed)) continue;
    const createdAtMs = Date.parse(parsed.created_at);
    if (Number.isNaN(createdAtMs)) continue;
    if (!latest || createdAtMs > latest.createdAtMs) {
      latest = { path: reportPath, report: parsed, createdAtMs };
    }
  }

  return latest ? { path: latest.path, report: latest.report } : null;
}

function isRedactionAuditReport(value: unknown): value is RedactionAuditReportV1 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'RedactionAuditReport.v1') return false;
  if (typeof record.created_at !== 'string') return false;
  if (!record.redactions || typeof record.redactions !== 'object') return false;
  const redactions = record.redactions as Record<string, unknown>;
  if (typeof redactions.total !== 'number') return false;
  if (!redactions.by_type || typeof redactions.by_type !== 'object') return false;
  return true;
}
