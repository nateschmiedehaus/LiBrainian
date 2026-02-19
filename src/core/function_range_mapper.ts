import * as path from 'node:path';
import { parseUnifiedDiff } from '../ingest/diff_indexer.js';
import type { LibrarianStorage } from '../storage/types.js';

export type FunctionId = string;

export type FileLineRange = {
  filePath: string;
  startLine: number;
  endLine: number;
};

export type RangeSource =
  | { type: 'git-diff'; diff: string }
  | { type: 'git-blame'; filePath: string }
  | { type: 'stack-trace'; raw: string }
  | { type: 'pr-diff'; patch: string }
  | { type: 'explicit'; ranges: FileLineRange[] };

export type ResolvedRange = {
  range: FileLineRange;
  functionIds: FunctionId[];
  confidence: number;
};

export interface FunctionRangeMapper {
  resolve(source: RangeSource): Promise<ResolvedRange[]>;
}

export interface FunctionRangeMapperDeps {
  storage: Pick<LibrarianStorage, 'getFunctionsByPath'>;
  workspaceRoot: string;
}

type IndexedFunction = {
  id: FunctionId;
  startLine: number;
  endLine: number;
};

type IntervalNode = {
  center: number;
  crossingByStart: IndexedFunction[];
  crossingByEnd: IndexedFunction[];
  left: IntervalNode | null;
  right: IntervalNode | null;
};

type FileIntervalIndex = {
  tree: IntervalNode | null;
  byId: Map<FunctionId, IndexedFunction>;
  allIds: FunctionId[];
};

type ParsedStackFrame = {
  filePath: string;
  line: number;
};

const SOURCE_CONFIDENCE: Record<RangeSource['type'], number> = {
  explicit: 0.98,
  'git-diff': 0.92,
  'pr-diff': 0.92,
  'stack-trace': 0.88,
  'git-blame': 0.85,
};

const STACK_TRACE_PATTERNS: RegExp[] = [
  /^\s*at\s+(?:async\s+)?(?:[\w$.<>\[\]]+\s+\()?(?<file>[^:)]+):(?<line>\d+):\d+\)?$/,
  /^\s*File\s+"(?<file>[^"]+)",\s+line\s+(?<line>\d+),\s+in\s+.+$/,
  /^(?<file>.+?):(?<line>\d+)(?::\d+)?$/,
];

export function createFunctionRangeMapper(deps: FunctionRangeMapperDeps): FunctionRangeMapper {
  return new DefaultFunctionRangeMapper(deps);
}

class DefaultFunctionRangeMapper implements FunctionRangeMapper {
  private readonly workspaceRoot: string;
  private readonly storage: Pick<LibrarianStorage, 'getFunctionsByPath'>;
  private readonly indexCache = new Map<string, Promise<FileIntervalIndex>>();

  constructor(deps: FunctionRangeMapperDeps) {
    this.workspaceRoot = path.resolve(deps.workspaceRoot);
    this.storage = deps.storage;
  }

  async resolve(source: RangeSource): Promise<ResolvedRange[]> {
    const ranges = this.parseSource(source);
    const resolved: ResolvedRange[] = [];

    for (const range of ranges) {
      const functionIds = await this.resolveRange(range);
      resolved.push({
        range,
        functionIds,
        confidence: functionIds.length > 0 ? SOURCE_CONFIDENCE[source.type] : 0,
      });
    }

    return resolved;
  }

  private parseSource(source: RangeSource): FileLineRange[] {
    switch (source.type) {
      case 'explicit':
        return source.ranges.map((range) => ({
          filePath: this.normalizeFilePath(range.filePath),
          startLine: sanitizeLine(range.startLine),
          endLine: sanitizeLine(range.endLine, range.startLine),
        }));
      case 'git-diff':
        return this.parseDiffRanges(source.diff);
      case 'pr-diff':
        return this.parseDiffRanges(source.patch);
      case 'git-blame':
        return [{
          filePath: this.normalizeFilePath(source.filePath),
          startLine: 1,
          endLine: Number.MAX_SAFE_INTEGER,
        }];
      case 'stack-trace':
        return this.parseStackTraceRanges(source.raw);
      default:
        return [];
    }
  }

  private parseDiffRanges(diff: string): FileLineRange[] {
    const parsed = parseUnifiedDiff(diff);
    const ranges: FileLineRange[] = [];
    for (const fileDiff of parsed) {
      const filePath = this.normalizeFilePath(fileDiff.filePath);
      for (const hunk of fileDiff.hunks) {
        const startLine = sanitizeLine(hunk.startLine);
        const hunkLength = Math.max(1, Math.trunc(hunk.length));
        const endLine = Math.max(startLine, startLine + hunkLength - 1);
        ranges.push({ filePath, startLine, endLine });
      }
    }
    return ranges;
  }

  private parseStackTraceRanges(raw: string): FileLineRange[] {
    const ranges: FileLineRange[] = [];
    for (const line of raw.split('\n')) {
      const frame = this.parseStackFrame(line);
      if (!frame) continue;
      ranges.push({
        filePath: this.normalizeFilePath(frame.filePath),
        startLine: frame.line,
        endLine: frame.line,
      });
    }
    return ranges;
  }

  private parseStackFrame(line: string): ParsedStackFrame | null {
    for (const pattern of STACK_TRACE_PATTERNS) {
      const match = line.match(pattern);
      const filePath = match?.groups?.file?.trim();
      const lineRaw = match?.groups?.line;
      if (!filePath || !lineRaw) continue;
      if (isNonLocalTraceFile(filePath)) continue;
      const lineNumber = Number.parseInt(lineRaw, 10);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      return { filePath, line: lineNumber };
    }
    return null;
  }

  private normalizeFilePath(filePath: string): string {
    const trimmed = filePath.trim().replace(/^["']|["']$/g, '');
    if (!trimmed) return this.workspaceRoot;
    if (trimmed.startsWith('file://')) {
      try {
        return path.normalize(new URL(trimmed).pathname);
      } catch {
        return path.normalize(trimmed.replace(/^file:\/\//, ''));
      }
    }
    if (path.isAbsolute(trimmed)) {
      return path.normalize(trimmed);
    }
    return path.resolve(this.workspaceRoot, trimmed);
  }

  private async resolveRange(range: FileLineRange): Promise<FunctionId[]> {
    const index = await this.getFileIndex(range.filePath);
    if (!index.tree || index.allIds.length === 0) {
      return [];
    }

    const overlapping = new Set<FunctionId>();
    queryIntervalTree(index.tree, range.startLine, range.endLine, overlapping);

    if (overlapping.size === 0) return [];
    return Array.from(overlapping)
      .map((id) => index.byId.get(id))
      .filter((fn): fn is IndexedFunction => Boolean(fn))
      .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id))
      .map((fn) => fn.id);
  }

  private async getFileIndex(filePath: string): Promise<FileIntervalIndex> {
    const cached = this.indexCache.get(filePath);
    if (cached) return cached;

    const promise = this.buildFileIndex(filePath);
    this.indexCache.set(filePath, promise);
    return promise;
  }

  private async buildFileIndex(filePath: string): Promise<FileIntervalIndex> {
    const functions = await this.storage.getFunctionsByPath(filePath);
    const normalized: IndexedFunction[] = functions
      .filter((fn) => typeof fn.id === 'string' && Number.isFinite(fn.startLine) && Number.isFinite(fn.endLine))
      .map((fn) => ({
        id: fn.id,
        startLine: sanitizeLine(fn.startLine),
        endLine: sanitizeLine(fn.endLine, fn.startLine),
      }));

    const byId = new Map<FunctionId, IndexedFunction>();
    for (const fn of normalized) {
      byId.set(fn.id, fn);
    }
    const values = Array.from(byId.values());
    return {
      tree: buildIntervalTree(values),
      byId,
      allIds: values.map((entry) => entry.id),
    };
  }
}

function buildIntervalTree(intervals: IndexedFunction[]): IntervalNode | null {
  if (intervals.length === 0) return null;

  const points: number[] = [];
  for (const interval of intervals) {
    points.push(interval.startLine, interval.endLine);
  }
  points.sort((a, b) => a - b);
  const center = points[Math.floor(points.length / 2)] ?? intervals[0]!.startLine;

  const left: IndexedFunction[] = [];
  const right: IndexedFunction[] = [];
  const crossing: IndexedFunction[] = [];

  for (const interval of intervals) {
    if (interval.endLine < center) {
      left.push(interval);
    } else if (interval.startLine > center) {
      right.push(interval);
    } else {
      crossing.push(interval);
    }
  }

  return {
    center,
    crossingByStart: crossing.slice().sort((a, b) => a.startLine - b.startLine),
    crossingByEnd: crossing.slice().sort((a, b) => b.endLine - a.endLine),
    left: buildIntervalTree(left),
    right: buildIntervalTree(right),
  };
}

function queryIntervalTree(node: IntervalNode | null, start: number, end: number, found: Set<FunctionId>): void {
  if (!node) return;

  if (end < node.center) {
    for (const interval of node.crossingByStart) {
      if (interval.startLine > end) break;
      if (interval.endLine >= start) {
        found.add(interval.id);
      }
    }
    queryIntervalTree(node.left, start, end, found);
    return;
  }

  if (start > node.center) {
    for (const interval of node.crossingByEnd) {
      if (interval.endLine < start) break;
      if (interval.startLine <= end) {
        found.add(interval.id);
      }
    }
    queryIntervalTree(node.right, start, end, found);
    return;
  }

  for (const interval of node.crossingByStart) {
    found.add(interval.id);
  }
  queryIntervalTree(node.left, start, end, found);
  queryIntervalTree(node.right, start, end, found);
}

function sanitizeLine(value: number, fallback?: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  if (fallback && Number.isFinite(fallback) && fallback > 0) return Math.trunc(fallback);
  return 1;
}

function isNonLocalTraceFile(filePath: string): boolean {
  const normalized = filePath.trim().toLowerCase();
  return normalized.startsWith('node:') || normalized.startsWith('http://') || normalized.startsWith('https://');
}
