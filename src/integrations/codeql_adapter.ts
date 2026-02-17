import * as fs from 'fs/promises';
import { glob } from 'glob';
import { noResult } from '../api/empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';

export interface CodeqlFinding {
  ruleId: string;
  message: string;
  severity: string | null;
  location?: string;
}

export interface CodeqlScan {
  tool: 'codeql';
  findings: CodeqlFinding[];
  reportPaths: string[];
}

export interface CodeqlOptions {
  maxFileBytes?: number;
  globs?: string[];
}

const DEFAULT_GLOBS = [
  '**/codeql*.sarif',
  '**/codeql*.sarif.json',
  '**/codeql-results*.sarif',
  '**/codeql-results*.sarif.json',
];
const DEFAULT_MAX_BYTES = 512_000;

function parseSarif(content: string): CodeqlFinding[] {
  const findings: CodeqlFinding[] = [];
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
      const finding: CodeqlFinding = { ruleId, message, severity };
      if (location) finding.location = location;
      findings.push(finding);
    }
  }
  return findings;
}

export async function loadCodeqlFindings(workspace: string, options: CodeqlOptions = {}): Promise<CodeqlScan | null> {
  const globs = options.globs ?? DEFAULT_GLOBS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const files = await glob(globs, { cwd: workspace, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'], absolute: true });
  if (!files.length) return noResult();
  const findings: CodeqlFinding[] = [];
  const reportPaths: string[] = [];
  for (const filePath of files.slice(0, 3)) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > maxFileBytes) continue;
      const content = await fs.readFile(filePath, 'utf8');
      findings.push(...parseSarif(content));
      reportPaths.push(filePath);
    } catch {
      continue;
    }
  }
  return { tool: 'codeql', findings, reportPaths };
}
