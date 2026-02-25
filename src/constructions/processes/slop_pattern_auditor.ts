import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction } from '../types.js';

export type SlopPatternCheck =
  | 'error_handling_mismatch'
  | 'validation_redundancy'
  | 'abstraction_mismatch'
  | 'comment_template_slop'
  | 'defensive_coding_excess'
  | 'naming_convention_drift'
  | 'import_pattern_mismatch';

export interface SlopAuditorInput {
  code: string;
  filePath: string;
  diffOnly?: boolean;
  checks?: SlopPatternCheck[];
  workspaceRoot?: string;
  sampleFileLimit?: number;
}

export interface ConventionExample {
  filePath: string;
  line: number;
  excerpt: string;
}

export interface SlopViolation {
  violationType: SlopPatternCheck;
  location: { line: number; column: number };
  codeSnippet: string;
  codepbaseConvention: string;
  conventionExamples: ConventionExample[];
  suggestedFix: string;
  severity: 'blocking' | 'warning' | 'style';
}

export interface InferredConvention {
  pattern: string;
  prevalence: string;
  examples: string[];
}

export interface SlopAuditorOutput {
  violations: SlopViolation[];
  agentSummary: string;
  structuralFitScore: number;
  inferredConventions: InferredConvention[];
}

interface IndexedExample extends ConventionExample {
  pattern: string;
}

interface ConventionState {
  readonly errorResultCount: number;
  readonly errorTryCatchCount: number;
  readonly retryWrapperCount: number;
  readonly retryHttpLayerCount: number;
  readonly namingCamelCount: number;
  readonly namingSnakeCount: number;
  readonly jsdocAverageWords: number;
  readonly exportedValidationCount: number;
  readonly privateValidationCount: number;
  readonly examples: IndexedExample[];
}

interface AuditableCode {
  text: string;
  lineMap: number[];
  lines: string[];
  lineStarts: number[];
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_CHECKS: readonly SlopPatternCheck[] = [
  'error_handling_mismatch',
  'validation_redundancy',
  'abstraction_mismatch',
  'comment_template_slop',
  'defensive_coding_excess',
  'naming_convention_drift',
  'import_pattern_mismatch',
];

const DEFAULT_SAMPLE_FILE_LIMIT = 180;
const MAX_EXAMPLES_PER_PATTERN = 5;

function normalizeChecks(checks?: SlopPatternCheck[]): Set<SlopPatternCheck> {
  if (!checks || checks.length === 0) {
    return new Set(DEFAULT_CHECKS);
  }
  return new Set(checks);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function buildLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineAt(lines: string[], line: number): string {
  const index = Math.max(0, line - 1);
  return (lines[index] ?? '').trim();
}

function lineFromOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(1, high + 1);
}

function locationFromOffset(auditable: AuditableCode, offset: number): { line: number; column: number; snippet: string } {
  const localLine = lineFromOffset(auditable.lineStarts, offset);
  const originalLine = auditable.lineMap[Math.max(0, localLine - 1)] ?? localLine;
  const lineStart = auditable.lineStarts[Math.max(0, localLine - 1)] ?? 0;
  const column = Math.max(1, offset - lineStart + 1);
  return {
    line: originalLine,
    column,
    snippet: lineAt(auditable.lines, localLine),
  };
}

function extractAuditableCode(code: string, diffOnly: boolean): AuditableCode {
  const sourceLines = code.split('\n');
  if (!diffOnly) {
    const text = sourceLines.join('\n');
    return {
      text,
      lineMap: sourceLines.map((_, index) => index + 1),
      lines: sourceLines,
      lineStarts: buildLineStarts(text),
    };
  }

  const selected: string[] = [];
  const lineMap: number[] = [];
  for (let i = 0; i < sourceLines.length; i += 1) {
    const line = sourceLines[i] ?? '';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      selected.push(line.slice(1));
      lineMap.push(i + 1);
    }
  }

  if (selected.length === 0) {
    const text = sourceLines.join('\n');
    return {
      text,
      lineMap: sourceLines.map((_, index) => index + 1),
      lines: sourceLines,
      lineStarts: buildLineStarts(text),
    };
  }

  const text = selected.join('\n');
  return {
    text,
    lineMap,
    lines: selected,
    lineStarts: buildLineStarts(text),
  };
}

async function collectSourceFiles(workspaceRoot: string, limit: number): Promise<string[]> {
  const output: string[] = [];
  const excludeDirectory = new Set([
    '.git',
    'node_modules',
    'dist',
    '.librarian',
    '.tmp',
    'coverage',
    'eval-corpus',
    'state',
  ]);

  async function walk(currentPath: string): Promise<void> {
    if (output.length >= limit) return;
    let currentStat;
    try {
      currentStat = await stat(currentPath);
    } catch {
      return;
    }
    if (currentStat.isDirectory()) {
      const base = path.basename(currentPath);
      if (excludeDirectory.has(base)) return;
      let entries: string[] = [];
      try {
        entries = await readdir(currentPath);
      } catch {
        return;
      }
      entries.sort((a, b) => a.localeCompare(b));
      for (const entry of entries) {
        await walk(path.join(currentPath, entry));
        if (output.length >= limit) return;
      }
      return;
    }
    if (!currentStat.isFile()) return;
    if (!SOURCE_EXTENSIONS.has(path.extname(currentPath))) return;
    output.push(currentPath);
  }

  await walk(workspaceRoot);
  return output;
}

function createPatternExamples(
  filePath: string,
  content: string,
  pattern: string,
  expression: RegExp,
  max: number,
): IndexedExample[] {
  const results: IndexedExample[] = [];
  const lines = content.split('\n');
  const starts = buildLineStarts(content);
  for (const match of content.matchAll(expression)) {
    const offset = match.index ?? 0;
    const line = lineFromOffset(starts, offset);
    results.push({
      pattern,
      filePath,
      line,
      excerpt: lineAt(lines, line),
    });
    if (results.length >= max) break;
  }
  return results;
}

async function inferConventions(workspaceRoot: string, sampleFileLimit: number): Promise<ConventionState> {
  const files = await collectSourceFiles(workspaceRoot, sampleFileLimit);
  let errorResultCount = 0;
  let errorTryCatchCount = 0;
  let retryWrapperCount = 0;
  let retryHttpLayerCount = 0;
  let namingCamelCount = 0;
  let namingSnakeCount = 0;
  let jsdocWordCount = 0;
  let jsdocCount = 0;
  let exportedValidationCount = 0;
  let privateValidationCount = 0;
  const examples: IndexedExample[] = [];

  for (const absolutePath of files) {
    let content = '';
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const filePath = normalizeRelativePath(path.relative(workspaceRoot, absolutePath));

    const resultMatches = content.match(/\bResult<|\bok\(|\berr\(/g) ?? [];
    const tryMatches = content.match(/\btry\s*\{/g) ?? [];
    const retryWrapperMatches = content.match(/\bRetryableOperation\b|\bwithRetry\s*\(/g) ?? [];
    const retryHttpMatches = content.match(/\b(fetchWithRetry|axiosRetry|httpClient|retryPolicy)\b/gi) ?? [];
    errorResultCount += resultMatches.length;
    errorTryCatchCount += tryMatches.length;
    retryWrapperCount += retryWrapperMatches.length;
    retryHttpLayerCount += retryHttpMatches.length;

    examples.push(
      ...createPatternExamples(filePath, content, 'error_result', /\bResult<|\bok\(|\berr\(/g, 1),
      ...createPatternExamples(filePath, content, 'error_try_catch', /\btry\s*\{/g, 1),
      ...createPatternExamples(filePath, content, 'retry_wrapper', /\bRetryableOperation\b|\bwithRetry\s*\(/g, 1),
      ...createPatternExamples(filePath, content, 'retry_http_layer', /\b(fetchWithRetry|axiosRetry|httpClient|retryPolicy)\b/gi, 1),
    );

    const jsdocBlocks = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
    for (const block of jsdocBlocks) {
      const words = (block.replace(/[*\/]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;
      jsdocWordCount += words;
      jsdocCount += 1;
    }

    const functionNames = Array.from(
      content.matchAll(
        /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(|\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/g,
      ),
    ).map((match) => match[1] ?? match[2]).filter((name): name is string => typeof name === 'string');

    for (const name of functionNames) {
      if (/[a-z0-9]+_[a-z0-9_]+/.test(name)) {
        namingSnakeCount += 1;
      } else if (/^[a-z][A-Za-z0-9]*$/.test(name)) {
        namingCamelCount += 1;
      }
    }

    exportedValidationCount += (content.match(/export\s+(?:async\s+)?function\s+[A-Za-z_]\w*\s*\([^)]*\)\s*{[\s\S]{0,240}?validateInput\(/g) ?? []).length;
    privateValidationCount += (content.match(/(?:^|\n)\s*(?:async\s+)?function\s+[A-Za-z_]\w*\s*\([^)]*\)\s*{[\s\S]{0,240}?validateInput\(/g) ?? []).length;
  }

  return {
    errorResultCount,
    errorTryCatchCount,
    retryWrapperCount,
    retryHttpLayerCount,
    namingCamelCount,
    namingSnakeCount,
    jsdocAverageWords: jsdocCount === 0 ? 0 : jsdocWordCount / jsdocCount,
    exportedValidationCount,
    privateValidationCount: Math.max(0, privateValidationCount - exportedValidationCount),
    examples,
  };
}

function selectExamples(examples: IndexedExample[], pattern: string): ConventionExample[] {
  return examples
    .filter((entry) => entry.pattern === pattern)
    .slice(0, MAX_EXAMPLES_PER_PATTERN)
    .map((entry) => ({
      filePath: entry.filePath,
      line: entry.line,
      excerpt: entry.excerpt,
    }));
}

function summarizeConventions(state: ConventionState): InferredConvention[] {
  const errorPreferred = state.errorResultCount >= state.errorTryCatchCount * 2 && state.errorResultCount >= 2
    ? 'result'
    : state.errorTryCatchCount >= state.errorResultCount * 2 && state.errorTryCatchCount >= 2
      ? 'try-catch'
      : 'mixed';

  const retryPreferred = state.retryWrapperCount >= state.retryHttpLayerCount * 2 && state.retryWrapperCount >= 2
    ? 'wrapper'
    : state.retryHttpLayerCount >= state.retryWrapperCount * 2 && state.retryHttpLayerCount >= 2
      ? 'http-layer'
      : 'mixed';

  const namingPreferred = state.namingCamelCount >= state.namingSnakeCount * 2 && state.namingCamelCount >= 3
    ? 'camelCase'
    : state.namingSnakeCount >= state.namingCamelCount * 2 && state.namingSnakeCount >= 3
      ? 'snake_case'
      : 'mixed';

  const commentStyle = state.jsdocAverageWords >= 40
    ? 'verbose'
    : state.jsdocAverageWords > 0 && state.jsdocAverageWords <= 20
      ? 'terse'
      : 'mixed';

  const validationBoundary = state.exportedValidationCount >= state.privateValidationCount * 2 && state.exportedValidationCount >= 2
    ? 'api-boundary'
    : state.privateValidationCount >= state.exportedValidationCount * 2 && state.privateValidationCount >= 2
      ? 'distributed'
      : 'mixed';

  return [
    {
      pattern: 'error_handling',
      prevalence: `preferred=${errorPreferred}; result=${state.errorResultCount}; tryCatch=${state.errorTryCatchCount}`,
      examples: selectExamples(state.examples, errorPreferred === 'try-catch' ? 'error_try_catch' : 'error_result')
        .map((entry) => `${entry.filePath}:${entry.line} ${entry.excerpt}`),
    },
    {
      pattern: 'retry_abstraction',
      prevalence: `preferred=${retryPreferred}; wrapper=${state.retryWrapperCount}; httpLayer=${state.retryHttpLayerCount}`,
      examples: selectExamples(state.examples, retryPreferred === 'wrapper' ? 'retry_wrapper' : 'retry_http_layer')
        .map((entry) => `${entry.filePath}:${entry.line} ${entry.excerpt}`),
    },
    {
      pattern: 'function_naming',
      prevalence: `preferred=${namingPreferred}; camelCase=${state.namingCamelCount}; snake_case=${state.namingSnakeCount}`,
      examples: [],
    },
    {
      pattern: 'comment_density',
      prevalence: `style=${commentStyle}; avgJsdocWords=${state.jsdocAverageWords.toFixed(1)}`,
      examples: [],
    },
    {
      pattern: 'validation_boundary',
      prevalence: `preferred=${validationBoundary}; exported=${state.exportedValidationCount}; private=${state.privateValidationCount}`,
      examples: [],
    },
  ];
}

function conventionValue(conventions: InferredConvention[], pattern: string): string {
  const entry = conventions.find((item) => item.pattern === pattern);
  if (!entry) return 'mixed';
  const match = /preferred=([^;]+)/.exec(entry.prevalence) ?? /style=([^;]+)/.exec(entry.prevalence);
  return match?.[1] ?? 'mixed';
}

function pushViolation(
  output: SlopViolation[],
  dedupe: Set<string>,
  violation: SlopViolation,
): void {
  const key = `${violation.violationType}|${violation.location.line}|${violation.codeSnippet}`;
  if (dedupe.has(key)) return;
  dedupe.add(key);
  output.push(violation);
}

function scanMatches(code: string, expression: RegExp): Array<{ index: number; text: string }> {
  const matches: Array<{ index: number; text: string }> = [];
  for (const match of code.matchAll(expression)) {
    matches.push({ index: match.index ?? 0, text: match[0] ?? '' });
  }
  return matches;
}

function collectViolationExamples(inferred: InferredConvention[], pattern: string): ConventionExample[] {
  const entry = inferred.find((item) => item.pattern === pattern);
  if (!entry) return [];
  return entry.examples.map((line) => {
    const [pathAndLine, ...excerptParts] = line.split(' ');
    const excerpt = excerptParts.join(' ').trim();
    const separator = pathAndLine.lastIndexOf(':');
    if (separator < 0) {
      return { filePath: pathAndLine, line: 1, excerpt };
    }
    const filePath = pathAndLine.slice(0, separator);
    const lineNum = Number(pathAndLine.slice(separator + 1));
    return {
      filePath,
      line: Number.isFinite(lineNum) ? lineNum : 1,
      excerpt,
    };
  });
}

function scoreFit(violations: SlopViolation[], checkCount: number): number {
  if (violations.length === 0) return 1;
  const penalty = violations.reduce((sum, violation) => {
    if (violation.severity === 'blocking') return sum + 0.35;
    if (violation.severity === 'warning') return sum + 0.2;
    return sum + 0.1;
  }, 0);
  return Math.max(0, Math.min(1, 1 - penalty / Math.max(1, checkCount)));
}

function summarizeFindings(violations: SlopViolation[], fitScore: number): string {
  if (violations.length === 0) {
    return `No structural mismatches found. Structural fit score ${(fitScore * 100).toFixed(1)}%.`;
  }
  const blocking = violations.filter((violation) => violation.severity === 'blocking').length;
  const warning = violations.filter((violation) => violation.severity === 'warning').length;
  const style = violations.filter((violation) => violation.severity === 'style').length;
  const top = violations[0];
  return `${violations.length} structural mismatch(es) found (blocking=${blocking}, warning=${warning}, style=${style}). Top issue: ${top?.violationType ?? 'n/a'} at line ${top?.location.line ?? 0}. Structural fit score ${(fitScore * 100).toFixed(1)}%.`;
}

async function analyzeSlopPatterns(input: SlopAuditorInput): Promise<SlopAuditorOutput> {
  if (!input.code || input.code.trim().length === 0) {
    throw new ConstructionError('slop-pattern-auditor requires non-empty code input', 'slop-pattern-auditor');
  }
  if (!input.filePath || input.filePath.trim().length === 0) {
    throw new ConstructionError('slop-pattern-auditor requires filePath', 'slop-pattern-auditor');
  }

  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const checks = normalizeChecks(input.checks);
  const sampleFileLimit = Math.max(20, Math.min(1200, input.sampleFileLimit ?? DEFAULT_SAMPLE_FILE_LIMIT));
  const auditable = extractAuditableCode(input.code, input.diffOnly ?? false);
  const conventionState = await inferConventions(workspaceRoot, sampleFileLimit);
  const inferredConventions = summarizeConventions(conventionState);
  const dedupe = new Set<string>();
  const violations: SlopViolation[] = [];

  const errorPreference = conventionValue(inferredConventions, 'error_handling');
  const retryPreference = conventionValue(inferredConventions, 'retry_abstraction');
  const namingPreference = conventionValue(inferredConventions, 'function_naming');
  const commentPreference = conventionValue(inferredConventions, 'comment_density');
  const validationPreference = conventionValue(inferredConventions, 'validation_boundary');

  if (checks.has('error_handling_mismatch')) {
    if (errorPreference === 'result') {
      for (const match of scanMatches(auditable.text, /\btry\s*\{/g)) {
        const location = locationFromOffset(auditable, match.index);
        pushViolation(violations, dedupe, {
          violationType: 'error_handling_mismatch',
          location: { line: location.line, column: location.column },
          codeSnippet: location.snippet,
          codepbaseConvention: 'Codebase convention is Result<T, E>-style error propagation.',
          conventionExamples: collectViolationExamples(inferredConventions, 'error_handling'),
          suggestedFix: 'Replace try/catch swallowing with Result<T, E> return handling and explicit error propagation.',
          severity: 'blocking',
        });
      }
    } else if (errorPreference === 'try-catch') {
      for (const match of scanMatches(auditable.text, /\bResult<|\bok\(|\berr\(/g)) {
        const location = locationFromOffset(auditable, match.index);
        pushViolation(violations, dedupe, {
          violationType: 'error_handling_mismatch',
          location: { line: location.line, column: location.column },
          codeSnippet: location.snippet,
          codepbaseConvention: 'Codebase convention is explicit try/catch with surfaced failures.',
          conventionExamples: collectViolationExamples(inferredConventions, 'error_handling'),
          suggestedFix: 'Align with prevailing try/catch shape and avoid introducing a separate Result abstraction in this module.',
          severity: 'warning',
        });
      }
    }
  }

  if (checks.has('abstraction_mismatch') && retryPreference === 'http-layer') {
    for (const match of scanMatches(auditable.text, /\bRetryableOperation\b|\bwithRetry\s*\(/g)) {
      const location = locationFromOffset(auditable, match.index);
      pushViolation(violations, dedupe, {
        violationType: 'abstraction_mismatch',
        location: { line: location.line, column: location.column },
        codeSnippet: location.snippet,
        codepbaseConvention: 'Codebase convention keeps retry logic at the HTTP/client boundary, not per-operation wrappers.',
        conventionExamples: collectViolationExamples(inferredConventions, 'retry_abstraction'),
        suggestedFix: 'Move retry semantics into the existing HTTP client layer and keep operation code direct.',
        severity: 'blocking',
      });
    }
  }

  if (checks.has('naming_convention_drift') && namingPreference === 'camelCase') {
    for (const match of scanMatches(
      auditable.text,
      /\b(?:function|const)\s+([a-z0-9]+_[a-z0-9_]+)\b/g,
    )) {
      const location = locationFromOffset(auditable, match.index);
      pushViolation(violations, dedupe, {
        violationType: 'naming_convention_drift',
        location: { line: location.line, column: location.column },
        codeSnippet: location.snippet,
        codepbaseConvention: 'Codebase convention favors camelCase function and variable names.',
        conventionExamples: collectViolationExamples(inferredConventions, 'function_naming'),
        suggestedFix: 'Rename identifiers to camelCase to match repository naming drift constraints.',
        severity: 'style',
      });
    }
  }

  if (checks.has('comment_template_slop')) {
    for (const match of scanMatches(auditable.text, /\/\*\*[\s\S]*?\*\//g)) {
      const block = match.text;
      const genericParamLines = (block.match(/@param\s+\w+\s*-\s*(the value to process|value to process|input value)/gi) ?? []).length;
      if (genericParamLines < 1) continue;
      if (commentPreference === 'terse' || genericParamLines >= 2) {
        const location = locationFromOffset(auditable, match.index);
        pushViolation(violations, dedupe, {
          violationType: 'comment_template_slop',
          location: { line: location.line, column: location.column },
          codeSnippet: location.snippet,
          codepbaseConvention: 'Codebase convention prefers concise comments with non-template intent signal.',
          conventionExamples: collectViolationExamples(inferredConventions, 'comment_density'),
          suggestedFix: 'Replace template JSDoc with concise behavior-focused notes, or remove if redundant.',
          severity: 'style',
        });
      }
    }
  }

  if (checks.has('validation_redundancy') && validationPreference === 'api-boundary') {
    for (const match of scanMatches(
      auditable.text,
      /(?:^|\n)\s*(?!export\s)(?:async\s+)?function\s+[A-Za-z_]\w*\s*\([^)]*\)\s*{[\s\S]{0,240}?validateInput\(/g,
    )) {
      const location = locationFromOffset(auditable, match.index);
      pushViolation(violations, dedupe, {
        violationType: 'validation_redundancy',
        location: { line: location.line, column: location.column },
        codeSnippet: location.snippet,
        codepbaseConvention: 'Codebase convention validates inputs at public boundaries, not inside private helpers.',
        conventionExamples: collectViolationExamples(inferredConventions, 'validation_boundary'),
        suggestedFix: 'Remove redundant private validation and rely on validated boundary contracts.',
        severity: 'warning',
      });
    }
  }

  if (checks.has('defensive_coding_excess')) {
    for (const match of scanMatches(auditable.text, /if\s*\(\s*!\w+\s*\)\s*(?:return|throw)\b/g)) {
      const location = locationFromOffset(auditable, match.index);
      pushViolation(violations, dedupe, {
        violationType: 'defensive_coding_excess',
        location: { line: location.line, column: location.column },
        codeSnippet: location.snippet,
        codepbaseConvention: 'Codebase convention expects contracts/types to carry non-null guarantees where possible.',
        conventionExamples: [],
        suggestedFix: 'Remove redundant defensive guard or move it to a typed boundary where nullability is introduced.',
        severity: 'style',
      });
    }
  }

  if (checks.has('import_pattern_mismatch') && retryPreference === 'http-layer') {
    for (const match of scanMatches(auditable.text, /import\s+[^;]*from\s+['"](axios|got|node-fetch)['"]/g)) {
      const location = locationFromOffset(auditable, match.index);
      pushViolation(violations, dedupe, {
        violationType: 'import_pattern_mismatch',
        location: { line: location.line, column: location.column },
        codeSnippet: location.snippet,
        codepbaseConvention: 'Codebase convention routes external HTTP usage through the shared client abstraction.',
        conventionExamples: collectViolationExamples(inferredConventions, 'retry_abstraction'),
        suggestedFix: 'Use the repository HTTP abstraction instead of introducing a direct import in this module.',
        severity: 'warning',
      });
    }
  }

  violations.sort((a, b) =>
    a.location.line - b.location.line
      || a.location.column - b.location.column
      || a.violationType.localeCompare(b.violationType));

  const structuralFitScore = scoreFit(violations, checks.size);
  const agentSummary = summarizeFindings(violations, structuralFitScore);
  return {
    violations,
    agentSummary,
    structuralFitScore,
    inferredConventions,
  };
}

export function createSlopPatternAuditorConstruction(): Construction<
  SlopAuditorInput,
  SlopAuditorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'slop-pattern-auditor',
    name: 'Slop Pattern Auditor',
    description: 'Detects structural convention mismatches between generated code and the repository’s empirical patterns.',
    async execute(input: SlopAuditorInput) {
      const output = await analyzeSlopPatterns(input);
      return ok<SlopAuditorOutput, ConstructionError>(output);
    },
  };
}
