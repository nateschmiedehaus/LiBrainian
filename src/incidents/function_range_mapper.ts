import type { ParsedStackFrame } from './stack_frame_parser.js';

export interface IndexedFunctionRange {
  id: string;
  startLine: number;
  endLine: number;
}

export interface FunctionRangeMapperDeps {
  getFunctionsByPath(filePath: string): Promise<IndexedFunctionRange[]>;
}

export interface FrameFunctionMapping {
  frame: ParsedStackFrame;
  functionIds: string[];
}

export interface FunctionRangeMapper {
  mapFrames(frames: ParsedStackFrame[]): Promise<FrameFunctionMapping[]>;
}

export function createFunctionRangeMapper(deps: FunctionRangeMapperDeps): FunctionRangeMapper {
  return new DefaultFunctionRangeMapper(deps);
}

class DefaultFunctionRangeMapper implements FunctionRangeMapper {
  private readonly getFunctionsByPath: FunctionRangeMapperDeps['getFunctionsByPath'];
  private readonly functionCache = new Map<string, Promise<IndexedFunctionRange[]>>();

  constructor(deps: FunctionRangeMapperDeps) {
    this.getFunctionsByPath = deps.getFunctionsByPath;
  }

  async mapFrames(frames: ParsedStackFrame[]): Promise<FrameFunctionMapping[]> {
    const mappings: FrameFunctionMapping[] = [];

    for (const frame of frames) {
      const functions = await this.getCachedFunctions(frame.filePath);
      const functionIds = functions
        .filter((fn) => frame.line >= fn.startLine && frame.line <= fn.endLine)
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id))
        .map((fn) => fn.id);

      mappings.push({ frame, functionIds });
    }

    return mappings;
  }

  private async getCachedFunctions(filePath: string): Promise<IndexedFunctionRange[]> {
    const cached = this.functionCache.get(filePath);
    if (cached) return cached;

    const promise = this.getFunctionsByPath(filePath).then((functions) => normalizeFunctionRanges(functions));
    this.functionCache.set(filePath, promise);
    return promise;
  }
}

function normalizeFunctionRanges(functions: IndexedFunctionRange[]): IndexedFunctionRange[] {
  const byId = new Map<string, IndexedFunctionRange>();

  for (const fn of functions) {
    if (!fn || typeof fn.id !== 'string' || fn.id.length === 0) continue;

    const startLine = sanitizeLine(fn.startLine);
    const endLine = sanitizeLine(fn.endLine, startLine);
    byId.set(fn.id, {
      id: fn.id,
      startLine,
      endLine,
    });
  }

  return Array.from(byId.values()).sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id)
  );
}

function sanitizeLine(value: number, fallback?: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  if (fallback && Number.isFinite(fallback) && fallback > 0) return Math.trunc(fallback);
  return 1;
}
