import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { clampMemoryConfidence } from './entry.js';

export interface AnnotatedClaimInput {
  claim: string;
  evidenceId: string;
  confidence: number;
}

export interface AnnotationWriteResult {
  written: number;
  skipped: number;
  lineRanges: Record<string, [number, number]>;
}

export interface StaleReplacementInput {
  claim: string;
  evidenceId: string;
  confidence: number;
}

export interface MarkStaleInput {
  evidenceId: string;
  reason: string;
  replacement?: StaleReplacementInput;
}

export interface MarkStaleResult {
  updated: number;
  replacementsWritten: number;
}

function normalizeClaim(claim: string): string {
  return claim.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatConfidence(confidence: number): string {
  return clampMemoryConfidence(confidence).toFixed(2);
}

function parseClaimFromLine(line: string): string | null {
  const match = line.match(/^\s*-\s+(.*?)(\s+<!--.*)?$/);
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

function extractAnnotation(line: string): { evidenceId: string; confidence: number } | null {
  const match = line.match(/<!--\s*librainian:([A-Za-z0-9_-]+):confidence=([0-9]*\.?[0-9]+)\s*-->/);
  if (!match) return null;
  const confidence = Number.parseFloat(match[2]);
  return {
    evidenceId: match[1],
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

function hasStaleMarker(line: string, evidenceId: string): boolean {
  return line.includes(`STALE:${evidenceId}`);
}

async function readMemoryFile(memoryFilePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(memoryFilePath, 'utf8');
    return raw.replace(/\r\n/g, '\n').split('\n');
  } catch {
    return [
      '# MEMORY',
      '',
      '## LiBrainian Memory Bridge',
      '',
    ];
  }
}

async function writeMemoryFile(memoryFilePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(memoryFilePath), { recursive: true });
  const content = `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  await fs.writeFile(memoryFilePath, content, 'utf8');
}

export async function appendAnnotatedClaims(
  memoryFilePath: string,
  claims: AnnotatedClaimInput[],
): Promise<AnnotationWriteResult> {
  const lines = await readMemoryFile(memoryFilePath);
  const existingByClaim = new Map<string, number>();

  for (const line of lines) {
    const claim = parseClaimFromLine(line);
    const annotation = extractAnnotation(line);
    if (!claim || !annotation) continue;
    if (line.includes('<!-- STALE:')) continue;
    const key = normalizeClaim(claim);
    const prior = existingByClaim.get(key) ?? 0;
    if (annotation.confidence > prior) {
      existingByClaim.set(key, annotation.confidence);
    }
  }

  const lineRanges: Record<string, [number, number]> = {};
  let written = 0;
  let skipped = 0;

  for (const item of claims) {
    const normalized = normalizeClaim(item.claim);
    const incomingConfidence = clampMemoryConfidence(item.confidence);
    const existingConfidence = existingByClaim.get(normalized);
    if (typeof existingConfidence === 'number' && existingConfidence >= incomingConfidence) {
      skipped += 1;
      continue;
    }

    const line = `- ${item.claim.trim()} <!-- librainian:${item.evidenceId}:confidence=${formatConfidence(incomingConfidence)} -->`;
    lines.push(line);
    const lineNumber = lines.length;
    lineRanges[item.evidenceId] = [lineNumber, lineNumber];
    existingByClaim.set(normalized, incomingConfidence);
    written += 1;
  }

  await writeMemoryFile(memoryFilePath, lines);
  return { written, skipped, lineRanges };
}

export async function markEvidenceEntriesStale(
  memoryFilePath: string,
  inputs: MarkStaleInput[],
): Promise<MarkStaleResult> {
  const lines = await readMemoryFile(memoryFilePath);
  const existingEvidenceIds = new Set<string>();
  for (const line of lines) {
    const annotation = extractAnnotation(line);
    if (annotation) existingEvidenceIds.add(annotation.evidenceId);
  }

  let updated = 0;
  let replacementsWritten = 0;
  const updatedAt = new Date().toISOString().slice(0, 10);

  for (const input of inputs) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.includes(`librainian:${input.evidenceId}:`)) continue;
      if (hasStaleMarker(line, input.evidenceId)) break;

      const reason = input.reason.replace(/"/g, '\'');
      lines[index] = `${line} <!-- STALE:${input.evidenceId} reason="${reason}" updated=${updatedAt} -->`;
      updated += 1;

      if (input.replacement && !existingEvidenceIds.has(input.replacement.evidenceId)) {
        const replacementLine = `- ${input.replacement.claim.trim()} <!-- librainian:${input.replacement.evidenceId}:confidence=${formatConfidence(input.replacement.confidence)} -->`;
        lines.splice(index + 1, 0, replacementLine);
        existingEvidenceIds.add(input.replacement.evidenceId);
        replacementsWritten += 1;
      }
      break;
    }
  }

  await writeMemoryFile(memoryFilePath, lines);
  return { updated, replacementsWritten };
}
