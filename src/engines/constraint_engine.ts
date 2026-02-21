import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'yaml';
import type { LiBrainianStorage } from '../storage/types.js';
import { ArchitectureKnowledge } from '../knowledge/architecture.js';
import type {
  ProposedChange,
  FileChange,
  Constraint,
  ConstraintSource,
  ValidationResult,
  Violation,
  Warning,
  BatchValidationResult,
  Explanation,
  ExceptionResult,
  Boundary,
  InferredConstraint,
  DriftReport,
  ConstraintSuggestion,
} from './types.js';
import { globalEventBus, createEngineConstraintEvent } from '../events.js';

type ExplicitConstraintConfig = {
  constraints?: Array<{
    rule: string;
    scope?: string[];
    severity?: 'error' | 'warning' | 'info';
  }>;
};

type ExceptionEntry = { expiresAt: number; reason: string };

const DEFAULT_CONSTRAINT_FILE = '.librainian/constraints.yaml';
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export class ConstraintEngine {
  private readonly architecture: ArchitectureKnowledge;
  private explicitCache: { path: string; mtimeMs: number; constraints: Constraint[] } | null = null;
  private readonly exceptions = new Map<string, ExceptionEntry>();
  private readonly boundaryRules = new Map<string, { allowedDependencies: string[]; directories: string[] }>();
  private readonly suggestedConstraints = new Map<string, SuggestedConstraint>();

  constructor(
    private readonly storage: LiBrainianStorage,
    private readonly workspaceRoot: string,
  ) {
    this.architecture = new ArchitectureKnowledge(storage);
  }

  async getApplicableConstraints(scope: string[]): Promise<Constraint[]> {
    const explicit = await this.loadExplicitConstraints();
    const inferred = await this.inferConstraints();
    const suggested = Array.from(this.suggestedConstraints.values()).map((entry) => entry.constraint);
    const constraints = [...explicit, ...inferred.map((entry) => entry.constraint), ...suggested];
    return constraints.filter((constraint) => scope.some((file) => matchesScope(file, constraint.scope)));
  }

  async previewChange(change: ProposedChange): Promise<ValidationResult> {
    const before = change.before ?? '';
    const after = change.after ?? addImport(before, change.addImport);
    return this.validateChange(change.file, before, after);
  }

  async validateChange(file: string, before: string, after: string): Promise<ValidationResult> {
    const constraints = await this.getApplicableConstraints([file]);
    const violations: Violation[] = [];
    const warnings: Warning[] = [];
    const beforeImports = extractImports(before);
    const afterImports = extractImports(after);
    const newImports = afterImports.filter((item) => !beforeImports.includes(item));

    for (const constraint of constraints) {
      if (this.isExceptionActive(constraint.id, file)) continue;
      const suggested = this.suggestedConstraints.get(constraint.id);
      const result = suggested
        ? evaluateSuggestedConstraint(constraint, suggested.tokens, file, before, after)
        : evaluateConstraint(constraint, file, before, after, newImports, this.boundaryRules);
      if (!result) continue;
      if (constraint.severity === 'error') {
        violations.push(result);
      } else {
        warnings.push({
          constraint: result.constraint,
          location: result.location,
          explanation: result.explanation,
          confidence: result.confidence,
          suggestion: result.suggestion,
        });
      }
    }

    const blocking = violations.some((violation) => violation.constraint.severity === 'error');
    const proceedReason = blocking ? undefined : warnings.length > 0 ? 'Warnings present - proceed with caution.' : 'No constraint violations detected.';

    // Emit engine:constraint event
    void globalEventBus.emit(createEngineConstraintEvent(file, violations.length, warnings.length, blocking));

    return { violations, warnings, blocking, proceedReason };
  }

  async validateBatch(changes: FileChange[]): Promise<BatchValidationResult> {
    const results: Array<{ file: string; result: ValidationResult }> = [];
    let blocking = false;
    for (const change of changes) {
      const result = await this.validateChange(change.file, change.before, change.after);
      if (result.blocking) blocking = true;
      results.push({ file: change.file, result });
    }
    return {
      results,
      blocking,
      summary: blocking ? 'Blocking constraint violations detected.' : 'Batch validated with no blocking violations.',
    };
  }

  async explainConstraint(constraintId: string): Promise<Explanation> {
    const constraints = await this.getApplicableConstraints(['.']);
    const constraint = constraints.find((c) => c.id === constraintId);
    if (!constraint) {
      return {
        constraintId,
        reason: 'Constraint not found - may have been removed or expired.',
        source: { type: 'pattern' },
      };
    }
    return {
      constraintId,
      reason: constraint.rule,
      source: constraint.source,
    };
  }

  async requestException(violation: Violation, reason: string): Promise<ExceptionResult> {
    const expiresAt = Date.now() + DEFAULT_EXPIRY_MS;
    this.exceptions.set(exceptionKey(violation.constraint.id, violation.location.file), { expiresAt, reason });
    return {
      granted: true,
      reason,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getBoundaries(file: string): Promise<Boundary[]> {
    const layerResult = await this.architecture.query({ type: 'layers' });
    const boundaries: Boundary[] = [];
    for (const layer of layerResult.layers ?? []) {
      if (layer.modules.some((mod) => mod === file) || layer.directories.some((dir) => file.includes(dir))) {
        boundaries.push({
          layer: layer.name,
          directories: layer.directories,
          allowedDependencies: layer.allowedDependencies,
          violations: layer.violations,
        });
      }
    }
    return boundaries;
  }

  async inferConstraints(): Promise<InferredConstraint[]> {
    const inferred: InferredConstraint[] = [];
    const explicit = await this.loadExplicitConstraints();
    for (const constraint of explicit) {
      inferred.push({ constraint, examples: [] });
    }

    const layerResult = await this.architecture.query({ type: 'layers' });
    this.boundaryRules.clear();
    for (const layer of layerResult.layers ?? []) {
      const id = `boundary:${layer.name}`;
      const constraint: Constraint = {
        id,
        type: 'inferred',
        rule: `Layer ${layer.name} may only depend on ${layer.allowedDependencies.join(', ') || 'no external layers'}`,
        severity: 'error',
        scope: layer.directories.length > 0 ? layer.directories : ['**/*'],
        confidence: 0.8,
        source: { type: 'boundary', evidence: { conforming: Math.max(1, layer.modules.length), violating: layer.violations.length } },
      };
      this.boundaryRules.set(id, { allowedDependencies: layer.allowedDependencies, directories: layer.directories });
      inferred.push({ constraint, examples: layer.violations.slice(0, 3) });
    }

    inferred.push(...buildConsoleLogConstraints(this.workspaceRoot));
    inferred.push(...buildTestImportConstraints(this.workspaceRoot));

    return inferred;
  }

  async detectDrift(baseline: string): Promise<DriftReport> {
    const current = await this.loadExplicitConstraints();
    const snapshot = JSON.stringify(current.map((c) => ({ rule: c.rule, scope: c.scope, severity: c.severity })));
    if (snapshot === baseline) {
      return { changed: false, details: [] };
    }
    return {
      changed: true,
      details: ['Constraint definitions changed since baseline.'],
    };
  }

  suggestConstraint(suggestion: ConstraintSuggestion): void {
    const id = `suggested:${hashRule(suggestion.rule)}`;
    const tokens = extractConstraintTokens(suggestion.rule, suggestion.evidence);
    const constraint: Constraint = {
      id,
      type: 'historical',
      rule: suggestion.rule,
      severity: suggestion.confidence >= 0.85 ? 'error' : 'warning',
      scope: ['**'],
      confidence: Math.max(0.4, Math.min(0.95, suggestion.confidence)),
      source: {
        type: 'pattern',
        evidence: { conforming: Math.max(1, suggestion.evidence.length), violating: 0 },
      },
    };
    this.suggestedConstraints.set(id, { constraint, tokens, createdAt: Date.now() });
  }

  private async loadExplicitConstraints(): Promise<Constraint[]> {
    const filePath = path.join(this.workspaceRoot, DEFAULT_CONSTRAINT_FILE);
    try {
      const stat = await fs.stat(filePath);
      if (this.explicitCache && this.explicitCache.path === filePath && this.explicitCache.mtimeMs === stat.mtimeMs) {
        return this.explicitCache.constraints;
      }
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = yaml.parse(raw) as ExplicitConstraintConfig;
      const constraints = (parsed?.constraints ?? []).map((entry, index) =>
        toConstraint(`explicit:${index}`, entry.rule, entry.scope ?? ['**/*'], entry.severity ?? 'warning', { type: 'pattern', location: filePath })
      );
      this.explicitCache = { path: filePath, mtimeMs: stat.mtimeMs, constraints };
      return constraints;
    } catch {
      return [];
    }
  }

  private isExceptionActive(constraintId: string, file: string): boolean {
    const entry = this.exceptions.get(exceptionKey(constraintId, file));
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.exceptions.delete(exceptionKey(constraintId, file));
      return false;
    }
    return true;
  }
}

type SuggestedConstraint = {
  constraint: Constraint;
  tokens: string[];
  createdAt: number;
};

function toConstraint(id: string, rule: string, scope: string[], severity: Constraint['severity'], source: ConstraintSource): Constraint {
  return {
    id,
    type: 'explicit',
    rule,
    severity,
    scope,
    confidence: 0.9,
    source,
  };
}

function buildConsoleLogConstraints(workspaceRoot: string): InferredConstraint[] {
  const constraint: Constraint = {
    id: 'pattern:no-console-log',
    type: 'inferred',
    rule: 'No console.log in production code',
    severity: 'warning',
    scope: ['src/**', '!src/**/*.test.*', '!**/__tests__/**'],
    confidence: 0.6,
    source: { type: 'pattern', location: workspaceRoot },
  };
  return [{ constraint, examples: [] }];
}

function buildTestImportConstraints(workspaceRoot: string): InferredConstraint[] {
  const constraint: Constraint = {
    id: 'pattern:no-test-imports',
    type: 'inferred',
    rule: 'Production code should not import test files',
    severity: 'error',
    scope: ['src/**', '!**/*.test.*', '!**/*.spec.*'],
    confidence: 0.7,
    source: { type: 'pattern', location: workspaceRoot },
  };
  return [{ constraint, examples: [] }];
}

function evaluateConstraint(
  constraint: Constraint,
  file: string,
  before: string,
  after: string,
  newImports: string[],
  boundaryRules: Map<string, { allowedDependencies: string[]; directories: string[] }>,
): Violation | null {
  const rule = constraint.rule.toLowerCase();
  if (rule.includes('console.log')) {
    if (after.includes('console.log') && !before.includes('console.log')) {
      return buildViolation(
        constraint,
        file,
        'Introduced console.log in code',
        'Remove debug logging or guard it.',
        false,
        findLineNumber(after, 'console.log')
      );
    }
    return null;
  }

  if (rule.includes('import test')) {
    const violationImport = newImports.find((imp) => isTestImport(imp));
    if (violationImport) {
      return buildViolation(
        constraint,
        file,
        `Introduced test import ${violationImport}`,
        'Move test-only logic into test helpers.',
        false,
        findLineNumber(after, violationImport)
      );
    }
  }

  if (constraint.source.type === 'boundary') {
    const boundary = boundaryRules.get(constraint.id);
    if (!boundary) return null;
    const violationImport = newImports.find((imp) => violatesBoundary(file, imp, boundary));
    if (violationImport) {
      return buildViolation(
        constraint,
        file,
        `Import ${violationImport} violates layer boundary`,
        'Route dependency through allowed layer.',
        false,
        findLineNumber(after, violationImport)
      );
    }
  }

  return null;
}

function evaluateSuggestedConstraint(
  constraint: Constraint,
  tokens: string[],
  file: string,
  _before: string,
  after: string,
): Violation | null {
  if (!tokens.length) return null;
  const lowered = after.toLowerCase();
  const matches = tokens.some((token) => lowered.includes(token));
  if (matches) return null;
  return buildViolation(
    constraint,
    file,
    `Suggested constraint "${constraint.rule}" not satisfied`,
    `Consider applying the pattern: ${tokens.slice(0, 3).join(', ')}`,
    false,
    undefined
  );
}

function buildViolation(
  constraint: Constraint,
  file: string,
  explanation: string,
  suggestion: string,
  autoFixable: boolean,
  line?: number,
): Violation {
  return {
    constraint,
    location: { file, line },
    explanation,
    confidence: constraint.confidence,
    suggestion,
    autoFixable,
  };
}

function addImport(before: string, importPath?: string): string {
  if (!importPath) return before;
  return `${before}\nimport '${importPath}';\n`;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+[^'"]*['"]([^'"]+)['"]/g;
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function isTestImport(value: string): boolean {
  return value.includes('__tests__') || /\.(spec|test)\./.test(value);
}

function violatesBoundary(file: string, importPath: string, boundary: { allowedDependencies: string[]; directories: string[] }): boolean {
  const fileLayer = boundary.directories.find((dir) => file.includes(dir));
  const targetLayer = boundary.directories.find((dir) => importPath.includes(dir));
  if (!fileLayer || !targetLayer) return false;
  if (fileLayer === targetLayer) return false;
  return !boundary.allowedDependencies.includes(targetLayer);
}

function matchesScope(filePath: string, scope: string[]): boolean {
  let matched = false;
  for (const pattern of scope) {
    const isNegated = pattern.startsWith('!');
    const normalized = isNegated ? pattern.slice(1) : pattern;
    const regex = globToRegex(normalized);
    if (!regex.test(filePath)) continue;
    matched = !isNegated;
  }
  return matched;
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  // Escape regex special chars INCLUDING * and ? so we can then convert glob patterns
  const escaped = normalized.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
  const globbed = escaped
    .replace(/\\\*\\\*/g, '.*')      // ** matches any path
    .replace(/\\\*/g, '[^/]*')       // * matches within directory
    .replace(/\\\?/g, '[^/]');       // ? matches single char (not directory separator)
  return new RegExp(`^${globbed}$`);
}

function exceptionKey(constraintId: string, file: string): string {
  return `${constraintId}:${file}`;
}

function hashRule(rule: string): string {
  let hash = 0;
  for (let i = 0; i < rule.length; i += 1) {
    hash = ((hash << 5) - hash) + rule.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const CONSTRAINT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'use', 'uses', 'using', 'should', 'must', 'all',
  'no', 'not', 'only', 'for', 'with', 'into', 'from', 'on', 'in', 'at', 'by', 'is', 'are', 'be',
]);

function extractConstraintTokens(rule: string, evidence: string[]): string[] {
  const tokens = new Set<string>();
  const collect = (value: string) => {
    for (const token of value.split(/[^A-Za-z0-9_]+/)) {
      const normalized = token.trim().toLowerCase();
      if (!normalized || normalized.length < 3) continue;
      if (CONSTRAINT_STOP_WORDS.has(normalized)) continue;
      tokens.add(normalized);
    }
  };
  collect(rule);
  for (const entry of evidence) {
    collect(entry);
  }
  return Array.from(tokens.values());
}

function findLineNumber(content: string, needle: string): number | undefined {
  if (!content || !needle) return undefined;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) return index + 1;
  }
  return undefined;
}
