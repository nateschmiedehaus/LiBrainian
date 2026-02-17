import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkspaceResolution {
  original: string;
  workspace: string;
  changed: boolean;
  reason?: string;
  confidence?: number;
  marker?: string;
  sourceFileCount: number;
  candidateFileCount?: number;
}

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'CMakeLists.txt',
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.rs', '.java',
  '.kt', '.kts', '.cs', '.rb',
  '.php', '.swift', '.m', '.mm',
]);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '.turbo',
  '.pytest_cache',
  '.venv',
  'venv',
]);

function findMarker(dir: string): string | null {
  for (const marker of PROJECT_MARKERS) {
    try {
      if (fs.existsSync(path.join(dir, marker))) {
        return marker;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function countSourceFiles(dir: string, maxDepth: number, limit: number, depth = 0): number {
  if (depth > maxDepth) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (entry.isDirectory()) {
        count += countSourceFiles(path.join(dir, entry.name), maxDepth, limit, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.has(ext)) {
          count += 1;
        }
      }
      if (count >= limit) {
        return count;
      }
    }
  } catch {
    return count;
  }
  return count;
}

export function resolveWorkspaceRoot(
  workspaceRoot: string,
  options: { maxDepthUp?: number; fileDepth?: number; limit?: number } = {}
): WorkspaceResolution {
  const original = path.resolve(workspaceRoot);
  const maxDepthUp = options.maxDepthUp ?? 4;
  const fileDepth = options.fileDepth ?? 3;
  const limit = options.limit ?? 200;
  const sourceFileCount = countSourceFiles(original, fileDepth, limit);
  const marker = findMarker(original);

  if (sourceFileCount > 0) {
    return {
      original,
      workspace: original,
      changed: false,
      sourceFileCount,
      marker: marker ?? undefined,
    };
  }

  if (marker) {
    return {
      original,
      workspace: original,
      changed: false,
      sourceFileCount,
      marker,
      reason: 'marker_found_no_sources',
    };
  }

  let current = original;
  for (let depth = 0; depth < maxDepthUp; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    const candidateMarker = findMarker(current);
    const candidateFileCount = countSourceFiles(current, fileDepth, limit);
    if (candidateMarker && candidateFileCount > 0) {
      return {
        original,
        workspace: current,
        changed: true,
        reason: `marker:${candidateMarker}`,
        confidence: candidateMarker === '.git' ? 0.9 : 0.75,
        marker: candidateMarker,
        sourceFileCount,
        candidateFileCount,
      };
    }
  }

  return {
    original,
    workspace: original,
    changed: false,
    sourceFileCount,
    reason: 'no_candidate',
  };
}
