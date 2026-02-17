import * as fs from 'fs/promises';
import { glob } from 'glob';
import { noResult } from '../api/empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';

export interface JoernFinding {
  ruleId: string;
  message: string;
  severity: string | null;
  location?: string;
}

export interface JoernScan {
  tool: 'joern';
  findings: JoernFinding[];
  reportPaths: string[];
}

export interface JoernOptions {
  maxFileBytes?: number;
  globs?: string[];
}

const DEFAULT_GLOBS = ['**/joern*.json', '**/joern*.sarif', '**/joern*.sarif.json'];
const DEFAULT_MAX_BYTES = 512_000;

function parseSarif(content: string): JoernFinding[] {
  const findings: JoernFinding[] = [];
  const parsedResult = safeJsonParse<Record<string, unknown>>(content);
  if (!parsedResult.ok) return findings;
  const parsed = parsedResult.value;
  const runs = Array.isArray(parsed.runs) ? parsed.runs as Array<Record<string, unknown>> : [];
  for (const run of runs) {
    const results = Array.isArray(run.results) ? run.results as Array<Record<string, unknown>> : [];
    for (const result of results) {
      const ruleId = typeof result.ruleId === 'string'
        ? result.ruleId
        : (result.rule && typeof result.rule === 'object' && typeof (result.rule as { id?: unknown }).id === 'string')
          ? String((result.rule as { id?: unknown }).id)
          : 'unknown';
      const messageObj = result.message && typeof result.message === 'object'
        ? result.message as Record<string, unknown>
        : {};
      const message = typeof messageObj.text === 'string' ? messageObj.text : 'unknown';
      const severity = typeof result.level === 'string' ? result.level : null;
      const locationObj = Array.isArray(result.locations) && result.locations[0] && typeof result.locations[0] === 'object'
        ? result.locations[0] as Record<string, unknown>
        : null;
      const physical = locationObj && typeof locationObj.physicalLocation === 'object'
        ? locationObj.physicalLocation as Record<string, unknown>
        : null;
      const artifact = physical && typeof physical.artifactLocation === 'object'
        ? physical.artifactLocation as Record<string, unknown>
        : null;
      const location = artifact && typeof artifact.uri === 'string' ? artifact.uri : null;
      const finding: JoernFinding = { ruleId, message, severity };
      if (location) finding.location = location;
      findings.push(finding);
    }
  }
  return findings;
}

function parseGenericJson(parsed: Record<string, unknown>): JoernFinding[] {
  const findings: JoernFinding[] = [];
  const entries = Array.isArray(parsed.findings)
    ? parsed.findings as Array<Record<string, unknown>>
    : Array.isArray(parsed.results)
      ? parsed.results as Array<Record<string, unknown>>
      : [];
  for (const entry of entries) {
    const ruleId = typeof entry.ruleId === 'string' ? entry.ruleId : 'unknown';
    const message = typeof entry.message === 'string' ? entry.message : 'unknown';
    const severity = typeof entry.severity === 'string' ? entry.severity : null;
    const location = typeof entry.location === 'string' ? entry.location : null;
    const finding: JoernFinding = { ruleId, message, severity };
    if (location) finding.location = location;
    findings.push(finding);
  }
  return findings;
}

export async function loadJoernFindings(workspace: string, options: JoernOptions = {}): Promise<JoernScan | null> {
  const globs = options.globs ?? DEFAULT_GLOBS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const files = await glob(globs, { cwd: workspace, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'], absolute: true });
  if (!files.length) return noResult();
  const findings: JoernFinding[] = [];
  const reportPaths: string[] = [];
  for (const filePath of files.slice(0, 3)) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > maxFileBytes) continue;
      const content = await fs.readFile(filePath, 'utf8');
      if (filePath.endsWith('.sarif') || content.includes('"runs"')) {
        findings.push(...parseSarif(content));
      } else {
        const parsed = safeJsonParse<Record<string, unknown>>(content);
        if (parsed.ok) {
          findings.push(...parseGenericJson(parsed.value));
        }
      }
      reportPaths.push(filePath);
    } catch {
      continue;
    }
  }
  return { tool: 'joern', findings, reportPaths };
}
