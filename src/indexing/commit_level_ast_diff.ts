import { createHash } from 'node:crypto';

export interface FunctionFingerprint {
  name: string;
  bodyHash: string;
}

export interface FunctionRename {
  from: string;
  to: string;
}

const JS_TS_PATTERNS: Array<RegExp> = [
  /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g,
  /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]*?)\}/g,
];

const PY_PATTERN = /^[ \t]*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*:[ \t]*\n((?:[ \t]+.*(?:\n|$))*)/gm;
const GO_PATTERN = /func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:\([^)]*\)\s*)?\{([\s\S]*?)\}/g;

function normalizeFunctionBody(body: string): string {
  return body
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashBody(body: string): string {
  return createHash('sha1').update(body).digest('hex');
}

export function extractFunctionFingerprints(source: string, filePath?: string): FunctionFingerprint[] {
  const lowered = (filePath ?? '').toLowerCase();
  const fingerprints: FunctionFingerprint[] = [];
  const patterns = lowered.endsWith('.py')
    ? [PY_PATTERN]
    : lowered.endsWith('.go')
      ? [GO_PATTERN]
      : JS_TS_PATTERNS;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1]?.trim();
      const body = normalizeFunctionBody(match[2] ?? '');
      if (!name || body.length === 0) continue;
      fingerprints.push({
        name,
        bodyHash: hashBody(body),
      });
    }
  }

  return fingerprints;
}

export function detectFunctionRenames(
  beforeSource: string,
  afterSource: string,
  filePath?: string,
): FunctionRename[] {
  const before = extractFunctionFingerprints(beforeSource, filePath);
  const after = extractFunctionFingerprints(afterSource, filePath);
  if (before.length === 0 || after.length === 0) return [];

  const beforeByHash = new Map<string, string[]>();
  const afterByHash = new Map<string, string[]>();
  for (const entry of before) {
    const list = beforeByHash.get(entry.bodyHash) ?? [];
    list.push(entry.name);
    beforeByHash.set(entry.bodyHash, list);
  }
  for (const entry of after) {
    const list = afterByHash.get(entry.bodyHash) ?? [];
    list.push(entry.name);
    afterByHash.set(entry.bodyHash, list);
  }

  const renames: FunctionRename[] = [];
  for (const [bodyHash, beforeNames] of beforeByHash.entries()) {
    const afterNames = afterByHash.get(bodyHash);
    if (!afterNames || beforeNames.length === 0 || afterNames.length === 0) continue;

    const beforeOnly = beforeNames.filter((name) => !afterNames.includes(name));
    const afterOnly = afterNames.filter((name) => !beforeNames.includes(name));
    const pairs = Math.min(beforeOnly.length, afterOnly.length);
    for (let i = 0; i < pairs; i++) {
      const from = beforeOnly[i];
      const to = afterOnly[i];
      if (!from || !to || from === to) continue;
      renames.push({ from, to });
    }
  }

  return renames;
}
