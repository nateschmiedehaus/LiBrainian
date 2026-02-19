import * as fs from 'fs/promises';
import * as path from 'path';
import { computeCanonRef, computeEnvironmentRef } from '../spine/refs.js';
export type RedactionType = 'api_key' | 'password' | 'token' | 'aws_key' | 'private_key';
export interface RedactionCounts { total: number; by_type: Record<RedactionType, number>; }
export interface RedactionResult { text: string; counts: RedactionCounts; }
export interface SnippetMinimizationConfig { maxChars?: number; contextLines?: number; }
export interface SnippetMinimizationResult { text: string; truncated: boolean; originalLength: number; }
export interface RedactionAuditReportV1 { kind: 'RedactionAuditReport.v1'; schema_version: 1; created_at: string; canon: Awaited<ReturnType<typeof computeCanonRef>>; environment: ReturnType<typeof computeEnvironmentRef>; workspace: string; redactions: RedactionCounts; }
const REDACTION_PATTERNS: Array<{ type: RedactionType; regex: RegExp }> = [{ type: 'api_key', regex: /api[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi }, { type: 'password', regex: /password\s*[:=]\s*['"][^'"]+['"]/gi }, { type: 'token', regex: /token\s*[:=]\s*['"][A-Za-z0-9+/=]{20,}['"]|gh[pousr]_[A-Za-z0-9]{20,}/gi }, { type: 'aws_key', regex: /AKIA[0-9A-Z]{16}/g }, { type: 'private_key', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g }];
export const DEFAULT_SNIPPET_LIMITS = { maxChars: 2000, contextLines: 5 };
const SNIPPET_GAP_MARKER = '... [snip] ...';
const resolveAuditDir = (workspaceRoot: string): string => path.join(workspaceRoot, 'state', 'audits', 'librarian', 'redaction');
export const createEmptyRedactionCounts = (): RedactionCounts => ({ total: 0, by_type: { api_key: 0, password: 0, token: 0, aws_key: 0, private_key: 0 } });
export function mergeRedactionCounts(base: RedactionCounts, extra: RedactionCounts): RedactionCounts {
  const merged = createEmptyRedactionCounts(); for (const key of Object.keys(merged.by_type) as RedactionType[]) merged.by_type[key] = (base.by_type[key] || 0) + (extra.by_type[key] || 0);
  merged.total = Object.values(merged.by_type).reduce((sum, value) => sum + value, 0); return merged;
}
export function redactText(text: string): RedactionResult {
  let redacted = text;
  let counts = createEmptyRedactionCounts();
  for (const pattern of REDACTION_PATTERNS) {
    let matches = 0;
    redacted = redacted.replace(pattern.regex, () => {
      matches += 1;
      return `[REDACTED:${pattern.type}]`;
    });
    if (matches > 0) {
      const by_type = { api_key: 0, password: 0, token: 0, aws_key: 0, private_key: 0, [pattern.type]: matches } as Record<RedactionType, number>;
      counts = mergeRedactionCounts(counts, { total: matches, by_type });
    }
  }
  return { text: redacted, counts };
}
export function minimizeSnippet(snippet: string, config: SnippetMinimizationConfig = {}): SnippetMinimizationResult {
  const maxChars = config.maxChars ?? DEFAULT_SNIPPET_LIMITS.maxChars, contextLines = config.contextLines ?? DEFAULT_SNIPPET_LIMITS.contextLines;
  if (snippet.length <= maxChars) return { text: snippet, truncated: false, originalLength: snippet.length };
  const lines = snippet.split('\n');
  if (lines.length <= contextLines * 2) return { text: snippet.slice(0, maxChars), truncated: true, originalLength: snippet.length };
  const head = lines.slice(0, contextLines);
  const tail = lines.slice(-contextLines);
  let candidate = [...head, SNIPPET_GAP_MARKER, ...tail].join('\n');
  if (candidate.length > maxChars) {
    const maxForSides = Math.max(1, maxChars - SNIPPET_GAP_MARKER.length - 2);
    const sideBudget = Math.max(1, Math.floor(maxForSides / 2));
    const trimmedHead = clampLines(head, sideBudget);
    const trimmedTail = clampLines(tail, sideBudget);
    candidate = [...trimmedHead, SNIPPET_GAP_MARKER, ...trimmedTail].join('\n');
  }
  if (candidate.length > maxChars) candidate = candidate.slice(0, maxChars);
  return { text: candidate, truncated: true, originalLength: snippet.length };
}
export async function createRedactionAuditReport(workspaceRoot: string, counts: RedactionCounts): Promise<RedactionAuditReportV1> {
  return { kind: 'RedactionAuditReport.v1', schema_version: 1, created_at: new Date().toISOString(), canon: await computeCanonRef(workspaceRoot), environment: computeEnvironmentRef(), workspace: workspaceRoot, redactions: counts };
}
export async function writeRedactionAuditReport(workspaceRoot: string, report: RedactionAuditReportV1): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(resolveAuditDir(workspaceRoot), timestamp);
  const reportPath = path.join(dir, 'RedactionAuditReport.v1.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}
function clampLines(lines: string[], maxTotalChars: number): string[] {
  if (lines.length === 0) return lines;
  const available = Math.max(0, maxTotalChars - Math.max(0, lines.length - 1));
  const perLineMax = Math.max(1, Math.floor(available / lines.length));
  return lines.map((line) => (line.length > perLineMax ? line.slice(0, perLineMax) : line));
}
