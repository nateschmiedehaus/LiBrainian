/**
 * @fileoverview Citation accuracy scoring for eval harness.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePathNode, isAbsolute } from 'node:path';

export interface EvidenceLocation {
  startLine: number;
  endLine?: number;
}

export interface CitationEvidenceRef {
  refId: string;
  path?: string;
  location?: EvidenceLocation;
}

export type CitationInput =
  | string
  | {
    refId?: string;
    file?: string;
    line?: number;
    endLine?: number;
    identifier?: string;
  };

export interface CitationAccuracyInput {
  citations?: CitationInput[];
  evidenceRefs: CitationEvidenceRef[];
  repoRoot?: string;
}

export interface CitationAccuracyResult {
  accuracy: number;
  validCitations: number;
  totalCitations: number;
  verifiableCitations: number;
  unverifiableCitations: number;
  invalidCitations: string[];
}

interface ParsedCitation {
  raw: string;
  path?: string;
  line?: number;
  endLine?: number;
  identifier?: string;
}

export function computeCitationAccuracy(
  input: CitationAccuracyInput
): CitationAccuracyResult {
  const citations = (input.citations ?? []).filter((citation) => {
    if (typeof citation === 'string') {
      return citation.trim().length > 0;
    }
    if (!citation) return false;
    return Boolean(citation.refId || citation.file);
  });

  const totalCitations = citations.length;
  if (totalCitations === 0) {
    return {
      accuracy: 0,
      validCitations: 0,
      totalCitations: 0,
      verifiableCitations: 0,
      unverifiableCitations: 0,
      invalidCitations: [],
    };
  }

  const refIdSet = new Set(input.evidenceRefs.map((ref) => ref.refId));
  const evidenceByPath = buildEvidenceByPath(input.evidenceRefs);

  let validCitations = 0;
  let verifiableCitations = 0;
  let unverifiableCitations = 0;
  const invalidCitations: string[] = [];

  const repoRoot = input.repoRoot?.trim();
  const fileLineCache = new Map<string, string[]>();

  for (const citation of citations) {
    const resolved = resolveCitation(citation, refIdSet, evidenceByPath);

    if (!repoRoot || !resolved?.path || (!resolved.line && !resolved.identifier)) {
      unverifiableCitations += 1;
      continue;
    }

    verifiableCitations += 1;
    const file = resolvePath(repoRoot, resolved.path);
    const verified = verifyCitationAgainstFilesystem(file, resolved.line, resolved.identifier, fileLineCache);

    if (verified) {
      validCitations += 1;
    } else {
      invalidCitations.push(typeof citation === 'string' ? citation : JSON.stringify(citation));
    }
  }

  const accuracy = verifiableCitations > 0 ? validCitations / verifiableCitations : 0;

  return {
    accuracy,
    validCitations,
    totalCitations,
    verifiableCitations,
    unverifiableCitations,
    invalidCitations,
  };
}

function resolveCitation(
  citation: CitationInput,
  refIdSet: Set<string>,
  evidenceByPath: Map<string, CitationEvidenceRef[]>
): ParsedCitation | null {
  if (typeof citation === 'string') {
    const trimmed = citation.trim();
    if (!trimmed) return null;
    if (refIdSet.has(trimmed)) {
      return resolveEvidenceRef(trimmed, evidenceByPath);
    }

    const parsed = parseCitationString(trimmed);
    if (!parsed.path) return null;
    return parsed;
  }

  if (!citation) return null;
  if (citation.refId && refIdSet.has(citation.refId)) {
    return resolveEvidenceRef(citation.refId, evidenceByPath);
  }

  const file = citation.file?.trim();
  if (!file) return null;

  return {
    raw: file,
    path: file,
    line: citation.line,
    endLine: citation.endLine,
    identifier: citation.identifier,
  };
}

function resolveEvidenceRef(
  refId: string,
  evidenceByPath: Map<string, CitationEvidenceRef[]>
): ParsedCitation | null {
  for (const refs of evidenceByPath.values()) {
    for (const ref of refs) {
      if (ref.refId !== refId || !ref.path) continue;
      const line = ref.location?.startLine;
      return {
        raw: refId,
        path: ref.path,
        line,
        endLine: ref.location?.endLine,
      };
    }
  }
  return null;
}

function buildEvidenceByPath(
  evidenceRefs: CitationEvidenceRef[]
): Map<string, CitationEvidenceRef[]> {
  const map = new Map<string, CitationEvidenceRef[]>();

  for (const ref of evidenceRefs) {
    if (!ref.path) continue;
    const normalized = normalizePath(ref.path);
    const bucket = map.get(normalized);
    if (bucket) {
      bucket.push(ref);
    } else {
      map.set(normalized, [ref]);
    }
  }

  return map;
}

function parseCitationString(value: string): ParsedCitation {
  const raw = value.trim();
  if (!raw) return { raw };

  const hashMatch = raw.match(/^(.*)#L(\d+)(?:-L?(\d+))?$/);
  if (hashMatch) {
    return {
      raw,
      path: hashMatch[1].trim(),
      line: parseLine(hashMatch[2]),
      endLine: parseLine(hashMatch[3]),
    };
  }

  const rangeMatch = raw.match(/^(.*):(\d+)-(\d+)$/);
  if (rangeMatch) {
    return {
      raw,
      path: rangeMatch[1].trim(),
      line: parseLine(rangeMatch[2]),
      endLine: parseLine(rangeMatch[3]),
    };
  }

  const lineColumnMatch = raw.match(/^(.*):(\d+):(\d+)$/);
  if (lineColumnMatch) {
    return {
      raw,
      path: lineColumnMatch[1].trim(),
      line: parseLine(lineColumnMatch[2]),
    };
  }

  const lineMatch = raw.match(/^(.*):(\d+)$/);
  if (lineMatch) {
    return {
      raw,
      path: lineMatch[1].trim(),
      line: parseLine(lineMatch[2]),
    };
  }

  return {
    raw,
    path: raw,
  };
}

function parseLine(value?: string): number | undefined {
  if (!value) return undefined;
  const line = Number.parseInt(value, 10);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function resolvePath(repoRoot: string, citationPath: string): string {
  if (!citationPath) return repoRoot;
  const normalized = citationPath.replace(/\\/g, '/');
  if (isAbsolute(normalized)) {
    return normalized;
  }
  return resolvePathNode(repoRoot, normalized);
}

function verifyCitationAgainstFilesystem(
  filePath: string,
  line: number | undefined,
  identifier: string | undefined,
  cache: Map<string, string[]>
): boolean {
  if (!existsSync(filePath)) return false;

  const lines = getCachedLines(filePath, cache);
  if (lines.length === 0) return false;

  if (line !== undefined) {
    if (line <= 0 || line > lines.length) return false;
    const lineText = lines[line - 1] ?? '';
    if (!lineText.trim() && !identifier) return false;
  }

  if (!identifier) {
    return true;
  }

  const matchLines: number[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (lines[idx]?.includes(identifier)) {
      matchLines.push(idx + 1);
    }
  }
  if (matchLines.length === 0) return false;

  if (line === undefined) return true;

  const tolerance = 15;
  return matchLines.some((matchLine) => Math.abs(matchLine - line) <= tolerance);
}

function getCachedLines(filePath: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(filePath);
  if (cached) return cached;
  try {
    const contents = readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    cache.set(filePath, lines);
    return lines;
  } catch {
    cache.set(filePath, []);
    return [];
  }
}
