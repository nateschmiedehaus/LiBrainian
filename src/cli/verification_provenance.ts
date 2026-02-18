import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface VerificationProvenanceReport {
  status: 'verified' | 'unverified' | 'unavailable';
  evidenceGeneratedAt: string | null;
  statusUnverifiedMarkers: number;
  gatesTotalTasks: number;
  gatesUnverifiedTasks: number;
  evidencePrerequisitesSatisfied: boolean;
  notes: string[];
}

interface GateTaskRecord {
  status?: string;
  verified?: boolean;
  note?: string;
}

function countUnverifiedMarkers(content: string): number {
  const matches = content.match(/unverified(?:_by_trace)?\s*\(/gi);
  return matches ? matches.length : 0;
}

function parseEvidenceGeneratedAt(statusContent: string): string | null {
  const match = statusContent.match(/Generated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\s]+)/i);
  return match?.[1] ?? null;
}

function countUnverifiedGateTasks(tasks: Record<string, GateTaskRecord> | undefined): {
  total: number;
  unverified: number;
} {
  if (!tasks || typeof tasks !== 'object') {
    return { total: 0, unverified: 0 };
  }

  let total = 0;
  let unverified = 0;
  for (const task of Object.values(tasks)) {
    total += 1;
    const status = typeof task.status === 'string' ? task.status.toLowerCase().trim() : '';
    const note = typeof task.note === 'string' ? task.note.toLowerCase() : '';
    const verified = task.verified;
    const isUnverified = verified === false || status === 'unverified' || note.includes('unverified');
    if (isUnverified) {
      unverified += 1;
    }
  }

  return { total, unverified };
}

export async function collectVerificationProvenance(workspaceRoot: string): Promise<VerificationProvenanceReport> {
  const notes: string[] = [];
  const statusPath = path.join(workspaceRoot, 'docs', 'LiBrainian', 'STATUS.md');
  const gatesPath = path.join(workspaceRoot, 'docs', 'LiBrainian', 'GATES.json');

  let statusContent = '';
  try {
    statusContent = await fs.readFile(statusPath, 'utf8');
  } catch {
    notes.push('STATUS.md not found or unreadable.');
  }

  let gatesParsed: { tasks?: Record<string, GateTaskRecord> } | null = null;
  try {
    const gatesRaw = await fs.readFile(gatesPath, 'utf8');
    gatesParsed = JSON.parse(gatesRaw) as { tasks?: Record<string, GateTaskRecord> };
  } catch {
    notes.push('GATES.json not found, unreadable, or invalid JSON.');
  }

  const statusUnverifiedMarkers = statusContent ? countUnverifiedMarkers(statusContent) : 0;
  const evidenceGeneratedAt = statusContent ? parseEvidenceGeneratedAt(statusContent) : null;
  const gateCounts = countUnverifiedGateTasks(gatesParsed?.tasks);

  const hasSourceData = Boolean(statusContent) && gateCounts.total > 0;
  const evidencePrerequisitesSatisfied = hasSourceData
    && statusUnverifiedMarkers === 0
    && gateCounts.unverified === 0;

  const status: VerificationProvenanceReport['status'] = !hasSourceData
    ? 'unavailable'
    : (evidencePrerequisitesSatisfied ? 'verified' : 'unverified');

  return {
    status,
    evidenceGeneratedAt,
    statusUnverifiedMarkers,
    gatesTotalTasks: gateCounts.total,
    gatesUnverifiedTasks: gateCounts.unverified,
    evidencePrerequisitesSatisfied,
    notes,
  };
}
