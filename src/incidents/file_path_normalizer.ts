import * as path from 'node:path';

const NON_LOCAL_PREFIXES = ['node:', 'http://', 'https://'];

export function normalizeIncidentFilePath(filePath: string, workspaceRoot: string): string | null {
  const workspace = path.resolve(workspaceRoot);
  const trimmed = stripWrappingQuotes(filePath.trim());

  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (NON_LOCAL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null;
  }

  if (trimmed.startsWith('file://')) {
    try {
      return path.normalize(new URL(trimmed).pathname);
    } catch {
      return null;
    }
  }

  if (isWindowsAbsolutePath(trimmed)) {
    return path.win32.normalize(trimmed);
  }

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(workspace, trimmed);
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}
