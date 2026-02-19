export type StackFrameFormat = 'node' | 'python' | 'raw';

export interface ParsedStackFrame {
  raw: string;
  format: StackFrameFormat;
  filePath: string;
  line: number;
  column?: number;
  functionName?: string;
}

const NODE_STACK_PATTERN = /^\s*at\s+(?:async\s+)?(?:(?<function>.+?)\s+\()?(?<file>(?:[A-Za-z]:)?[^():]+):(?<line>\d+):(?<column>\d+)\)?\s*$/;
const PYTHON_STACK_PATTERN = /^\s*File\s+"(?<file>.+?)",\s+line\s+(?<line>\d+),\s+in\s+(?<function>.+?)\s*$/;
const RAW_FILE_LINE_PATTERN = /^\s*(?<file>(?:[A-Za-z]:)?[^:\s].*?):(?<line>\d+)(?::(?<column>\d+))?\s*$/;

export function parseStackFrameLine(line: string): ParsedStackFrame | null {
  const nodeMatch = line.match(NODE_STACK_PATTERN);
  if (nodeMatch?.groups) {
    const lineNumber = toPositiveInt(nodeMatch.groups.line);
    const columnNumber = toPositiveInt(nodeMatch.groups.column);
    const filePath = nodeMatch.groups.file?.trim();

    if (!lineNumber || !columnNumber || !filePath) return null;

    const functionName = cleanOptional(nodeMatch.groups.function);
    return {
      raw: line,
      format: 'node',
      filePath,
      line: lineNumber,
      column: columnNumber,
      ...(functionName ? { functionName } : {}),
    };
  }

  const pythonMatch = line.match(PYTHON_STACK_PATTERN);
  if (pythonMatch?.groups) {
    const lineNumber = toPositiveInt(pythonMatch.groups.line);
    const filePath = pythonMatch.groups.file?.trim();
    if (!lineNumber || !filePath) return null;

    const functionName = cleanOptional(pythonMatch.groups.function);
    return {
      raw: line,
      format: 'python',
      filePath,
      line: lineNumber,
      ...(functionName ? { functionName } : {}),
    };
  }

  const rawMatch = line.match(RAW_FILE_LINE_PATTERN);
  if (rawMatch?.groups) {
    const lineNumber = toPositiveInt(rawMatch.groups.line);
    const filePath = rawMatch.groups.file?.trim();
    if (!lineNumber || !filePath) return null;

    const column = toPositiveInt(rawMatch.groups.column);
    return {
      raw: line,
      format: 'raw',
      filePath,
      line: lineNumber,
      ...(column ? { column } : {}),
    };
  }

  return null;
}

export function parseStackTrace(stackTrace: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];

  for (const line of stackTrace.split('\n')) {
    const parsed = parseStackFrameLine(line);
    if (parsed) {
      frames.push(parsed);
    }
  }

  return frames;
}

function toPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function cleanOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
