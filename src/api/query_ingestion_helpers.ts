import type { CommitRecord } from '../ingest/commit_indexer.js';
import type { OwnershipRecord } from '../ingest/ownership_indexer.js';
import type { AdrRecord } from '../ingest/adr_indexer.js';
import type { TestMapping as IngestTestMapping } from '../ingest/test_indexer.js';

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

export function countFindings(value: unknown): number {
  if (!isRecord(value)) return 0;
  const findings = Array.isArray(value.findings) ? value.findings.length : 0;
  return findings;
}

export function isTestPayload(value: unknown): value is { mappings: IngestTestMapping[] } {
  return isRecord(value) && Array.isArray(value.mappings);
}

export function isCommitPayload(value: unknown): value is CommitRecord {
  if (!isRecord(value)) return false;
  return typeof value.commitHash === 'string' && Array.isArray(value.filesChanged);
}

export function isOwnershipPayload(value: unknown): value is OwnershipRecord {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string'
    && typeof value.primaryOwner === 'string'
    && Array.isArray(value.contributors);
}

export function isAdrPayload(value: unknown): value is AdrRecord {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string' && typeof value.title === 'string';
}

export function compileCodeownerPattern(pattern: string): RegExp | null {
  let normalized = pattern.trim();
  if (!normalized || normalized.startsWith('#')) return null;
  if (normalized.startsWith('!')) normalized = normalized.slice(1);
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized.endsWith('/')) normalized = `${normalized}**`;
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const globbed = escaped
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '.');
  return new RegExp(`^${globbed}$`);
}
