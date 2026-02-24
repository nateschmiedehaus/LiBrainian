import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ConstructionError } from '../base/construction_base.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.librarian',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const QUALITY_BAR_VERSION = '1.0.0';
const MIN_CONVENTION_COUNT = 20;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
export const DEFAULT_QUALITY_BAR_CONSTITUTION_RELATIVE_PATH = path.join('.librarian', 'quality-bar-constitution.json');

export type ConventionCategory =
  | 'error_handling'
  | 'naming'
  | 'testing'
  | 'logging'
  | 'async'
  | 'types'
  | 'imports'
  | 'construction'
  | 'epistemics'
  | 'documentation';

export type ConventionLevel = 'MUST' | 'SHOULD' | 'MAY';
export type ConventionScope = 'global' | 'module' | 'function';
export type ConventionEnforcement = 'ci_block' | 'pr_comment' | 'advisory';

export interface QualityBarConvention {
  id: string;
  category: ConventionCategory;
  level: ConventionLevel;
  rule: string;
  evidence: {
    frequency: number;
    examples: string[];
    counterExamples: string[];
  };
  scope: ConventionScope;
  enforcementMechanism: ConventionEnforcement;
}

export interface AgenticCriterion {
  id: string;
  criterion: string;
  antiPattern: string;
  measurement: string;
}

export interface QualityBarConstitution {
  version: string;
  project: string;
  generatedAt: string;
  sourceFileCount: number;
  conventions: QualityBarConvention[];
  agenticCriteria: AgenticCriterion[];
}

export interface QualityBarConstitutionInput {
  workspace: string;
  outputPath?: string;
  forceRegenerate?: boolean;
  minConventionCount?: number;
}

export interface QualityBarConstitutionOutput {
  kind: 'QualityBarConstitution.v1';
  constitution: QualityBarConstitution;
  outputPath: string;
}

export interface TaskQualityNorm {
  id: string;
  category: ConventionCategory;
  level: ConventionLevel;
  rule: string;
  frequency: number;
  example: string;
  score: number;
}

export interface TaskQualityNormSelectionInput {
  constitution: QualityBarConstitution;
  filesToModify: string[];
  taskType?: string;
  domain?: string;
  minRules?: number;
  maxRules?: number;
}

export interface TaskQualityNormsInput {
  workspace: string;
  filesToModify: string[];
  taskType?: string;
  domain?: string;
  forceRegenerate?: boolean;
  outputPath?: string;
  minRules?: number;
  maxRules?: number;
}

export interface NormDepthEvaluation {
  withoutNorms: number;
  withNorms: number;
  improvement: number;
}

interface MinedFile {
  relativePath: string;
  normalizedPath: string;
  content: string;
  functionIds: string[];
  fileTokens: Set<string>;
}

interface ConventionTemplate {
  id: string;
  category: ConventionCategory;
  rule: string;
  scope: ConventionScope;
  matcher: (file: MinedFile) => boolean;
}

interface ConventionCacheEntry {
  loadedAtMs: number;
  outputPath: string;
  constitution: QualityBarConstitution;
}

const constitutionCache = new Map<string, ConventionCacheEntry>();

const CONVENTION_TEMPLATES: ConventionTemplate[] = [
  {
    id: 'QBC-001',
    category: 'types',
    rule: 'Type definitions SHOULD use explicit interfaces or type aliases for public contracts.',
    scope: 'module',
    matcher: (file) => /\bexport\s+(?:interface|type)\s+\w+/u.test(file.content),
  },
  {
    id: 'QBC-002',
    category: 'imports',
    rule: 'Type-only dependencies SHOULD use import type to preserve runtime cleanliness.',
    scope: 'module',
    matcher: (file) => /\bimport\s+type\s+/u.test(file.content),
  },
  {
    id: 'QBC-003',
    category: 'imports',
    rule: 'Node built-ins SHOULD use node: specifiers for unambiguous resolution.',
    scope: 'module',
    matcher: (file) => /from\s+['"]node:[^'"]+['"]/u.test(file.content),
  },
  {
    id: 'QBC-004',
    category: 'imports',
    rule: 'Relative imports SHOULD include explicit .js extensions in TypeScript output paths.',
    scope: 'module',
    matcher: (file) => /from\s+['"]\.[^'"]+\.js['"]/u.test(file.content),
  },
  {
    id: 'QBC-005',
    category: 'async',
    rule: 'Asynchronous control flow SHOULD use async/await for readability and predictable error propagation.',
    scope: 'function',
    matcher: (file) => /\basync\b/u.test(file.content) && /\bawait\b/u.test(file.content),
  },
  {
    id: 'QBC-006',
    category: 'error_handling',
    rule: 'Thrown failures SHOULD use Error objects to preserve stack and diagnostics.',
    scope: 'function',
    matcher: (file) => /throw\s+new\s+Error\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-007',
    category: 'error_handling',
    rule: 'Fallible operations SHOULD be wrapped in try/catch blocks near integration boundaries.',
    scope: 'function',
    matcher: (file) => /\btry\s*\{/u.test(file.content) && /\bcatch\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-008',
    category: 'error_handling',
    rule: 'Error serialization SHOULD normalize unknown values through getErrorMessage.',
    scope: 'function',
    matcher: (file) => /\bgetErrorMessage\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-009',
    category: 'logging',
    rule: 'Operational telemetry SHOULD use structured logInfo with stable bracketed tags.',
    scope: 'module',
    matcher: (file) => /\blogInfo\s*\(\s*['"]\[[^'"]+\]/u.test(file.content),
  },
  {
    id: 'QBC-010',
    category: 'logging',
    rule: 'Warnings SHOULD use logWarning with context payloads for triage.',
    scope: 'module',
    matcher: (file) => /\blogWarning\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-011',
    category: 'testing',
    rule: 'Unit and integration tests SHOULD be organized with describe blocks.',
    scope: 'module',
    matcher: (file) => /\bdescribe\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-012',
    category: 'testing',
    rule: 'Test cases SHOULD use explicit it blocks to communicate behavior.',
    scope: 'function',
    matcher: (file) => /\bit\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-013',
    category: 'testing',
    rule: 'Assertions SHOULD use expect with direct behavioral checks.',
    scope: 'function',
    matcher: (file) => /\bexpect\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-014',
    category: 'testing',
    rule: 'Lifecycle setup SHOULD use beforeEach where fixture reset is required.',
    scope: 'function',
    matcher: (file) => /\bbeforeEach\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-015',
    category: 'testing',
    rule: 'Lifecycle teardown SHOULD use afterEach for deterministic cleanup.',
    scope: 'function',
    matcher: (file) => /\bafterEach\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-016',
    category: 'testing',
    rule: 'Test doubles SHOULD use vi.mock for explicit dependency seams.',
    scope: 'module',
    matcher: (file) => /\bvi\.mock\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-017',
    category: 'construction',
    rule: 'Constructions SHOULD return typed ok() outcomes with explicit kinds.',
    scope: 'function',
    matcher: (file) => /\bok\s*<[^>]+>\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-018',
    category: 'construction',
    rule: 'Composable construction units SHOULD expose create*Construction factories.',
    scope: 'module',
    matcher: (file) => /\bcreate[A-Za-z0-9]+Construction\b/u.test(file.content),
  },
  {
    id: 'QBC-019',
    category: 'documentation',
    rule: 'Source modules SHOULD include fileoverview comments to preserve design intent.',
    scope: 'module',
    matcher: (file) => /@fileoverview/u.test(file.content),
  },
  {
    id: 'QBC-020',
    category: 'naming',
    rule: 'Factory and constructor helpers SHOULD use create* naming for discoverability.',
    scope: 'function',
    matcher: (file) => /\bcreate[A-Z][A-Za-z0-9_]*\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-021',
    category: 'epistemics',
    rule: 'Confidence-bearing APIs SHOULD explicitly track confidence values in output structures.',
    scope: 'module',
    matcher: (file) => /\bconfidence\b/u.test(file.content) && /\binterface\b/u.test(file.content),
  },
  {
    id: 'QBC-022',
    category: 'imports',
    rule: 'Path resolution SHOULD normalize user input with path.resolve before IO or git operations.',
    scope: 'function',
    matcher: (file) => /\bpath\.resolve\s*\(/u.test(file.content),
  },
  {
    id: 'QBC-023',
    category: 'async',
    rule: 'Filesystem interactions SHOULD use promise-based fs APIs for non-blocking behavior.',
    scope: 'module',
    matcher: (file) => /node:fs\/promises/u.test(file.content) || /\bfs\.promises\b/u.test(file.content),
  },
  {
    id: 'QBC-024',
    category: 'testing',
    rule: 'Test modules SHOULD use .test. naming for deterministic discovery.',
    scope: 'module',
    matcher: (file) => file.normalizedPath.includes('.test.'),
  },
];

const AGENTIC_CRITERIA: AgenticCriterion[] = [
  {
    id: 'QBC-A1',
    criterion: 'Changes include at least one concrete verification path tied to modified behavior.',
    antiPattern: 'Ship behavior changes with no explicit verification strategy.',
    measurement: 'Diff contains tests, gates, or deterministic checks mapped to touched modules.',
  },
  {
    id: 'QBC-A2',
    criterion: 'Error handling keeps user-visible messages actionable and single-line.',
    antiPattern: 'Surface raw stack traces or opaque failures in user workflows.',
    measurement: 'Failure text is normalized and contextualized with operator guidance.',
  },
  {
    id: 'QBC-A3',
    criterion: 'Task context should include project-specific quality norms before implementation.',
    antiPattern: 'Agent implements code from generic priors with no repository-specific guidance.',
    measurement: 'Pre-task context injects 3-5 task-relevant quality norms.',
  },
  {
    id: 'QBC-A4',
    criterion: 'Work should preserve deterministic outputs for repeatable tooling.',
    antiPattern: 'Non-deterministic ordering and unstable diagnostics.',
    measurement: 'Outputs and ranked selections are sorted with stable tie-breakers.',
  },
  {
    id: 'QBC-A5',
    criterion: 'Context confidence and evidence should be explicit for downstream decisions.',
    antiPattern: 'Unqualified claims without provenance or frequency support.',
    measurement: 'Norm entries include frequency, examples, and counterexamples.',
  },
];

function toSingleLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ').trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function toFrequency(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toConventionLevel(frequency: number): ConventionLevel {
  if (frequency > 0.9) return 'MUST';
  if (frequency > 0.7) return 'SHOULD';
  return 'MAY';
}

function toEnforcement(level: ConventionLevel): ConventionEnforcement {
  if (level === 'MUST') return 'ci_block';
  if (level === 'SHOULD') return 'pr_comment';
  return 'advisory';
}

function extractFunctionIds(relativePath: string, content: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu,
    /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/gu,
    /\bexport\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/gu,
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/gu,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const symbol = match[1];
      if (symbol) {
        ids.add(`${relativePath}#${symbol}`);
      }
    }
  }
  if (ids.size === 0) {
    ids.add(`file:${relativePath}`);
  }
  return [...ids];
}

function tokenizePath(value: string): Set<string> {
  return new Set(
    value
      .split(/[\/._-]+/u)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 3)
  );
}

async function collectSourceFiles(workspace: string): Promise<string[]> {
  const root = path.resolve(workspace);
  const discovered: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      discovered.push(absolute);
    }
  }
  discovered.sort((left, right) => left.localeCompare(right));
  return discovered;
}

async function mineFile(workspace: string, absolutePath: string): Promise<MinedFile> {
  const content = await fs.readFile(absolutePath, 'utf8');
  const relativePath = normalizePath(path.relative(workspace, absolutePath));
  return {
    relativePath,
    normalizedPath: relativePath.toLowerCase(),
    content,
    functionIds: extractFunctionIds(relativePath, content),
    fileTokens: tokenizePath(relativePath),
  };
}

function flattenExamples(files: MinedFile[], limit: number): string[] {
  const examples: string[] = [];
  for (const file of files) {
    for (const functionId of file.functionIds) {
      examples.push(functionId);
      if (examples.length >= limit) return examples;
    }
  }
  return examples;
}

function deriveAutoNamingConventions(
  files: MinedFile[],
  existingIds: Set<string>,
  minConventionCount: number
): QualityBarConvention[] {
  const conventions: QualityBarConvention[] = [];
  if (files.length === 0) return conventions;

  const declarationNames: string[] = [];
  for (const file of files) {
    for (const functionId of file.functionIds) {
      const separator = functionId.lastIndexOf('#');
      if (separator <= 0) continue;
      declarationNames.push(functionId.slice(separator + 1));
    }
  }
  if (declarationNames.length === 0) return conventions;

  const candidatePrefixes = ['create', 'get', 'set', 'is', 'has', 'build', 'run', 'load', 'resolve', 'parse', 'record', 'validate'];
  const totalNames = declarationNames.length;
  const availableSlots = Math.max(0, minConventionCount - existingIds.size);
  let sequence = 1;
  for (const prefix of candidatePrefixes) {
    if (conventions.length >= availableSlots) break;
    const matches = declarationNames.filter((name) => name.startsWith(prefix));
    if (matches.length < 3) continue;
    const frequency = toFrequency(matches.length / totalNames);
    const level = toConventionLevel(frequency);
    const id = `QBC-AUTO-${String(sequence).padStart(3, '0')}`;
    sequence += 1;
    if (existingIds.has(id)) continue;

    const matchFiles = files.filter((file) => file.functionIds.some((functionId) => functionId.endsWith(`#${prefix}`) || functionId.includes(`#${prefix}`)));
    const nonMatchFiles = files.filter((file) => !matchFiles.includes(file));

    conventions.push({
      id,
      category: 'naming',
      level,
      rule: `Naming SHOULD preserve semantic prefixes such as "${prefix}" for intent clarity.`,
      evidence: {
        frequency,
        examples: flattenExamples(matchFiles, 5),
        counterExamples: flattenExamples(nonMatchFiles, 5),
      },
      scope: 'function',
      enforcementMechanism: toEnforcement(level),
    });
  }
  return conventions;
}

function mineConventions(files: MinedFile[], minConventionCount: number): QualityBarConvention[] {
  const fileCount = files.length;
  if (fileCount === 0) return [];

  const conventions: QualityBarConvention[] = [];
  for (const template of CONVENTION_TEMPLATES) {
    const matchingFiles = files.filter((file) => template.matcher(file));
    if (matchingFiles.length === 0) continue;
    const nonMatchingFiles = files.filter((file) => !template.matcher(file));
    const frequency = toFrequency(matchingFiles.length / fileCount);
    const level = toConventionLevel(frequency);

    conventions.push({
      id: template.id,
      category: template.category,
      level,
      rule: template.rule,
      evidence: {
        frequency,
        examples: flattenExamples(matchingFiles, 5),
        counterExamples: flattenExamples(nonMatchingFiles, 5),
      },
      scope: template.scope,
      enforcementMechanism: toEnforcement(level),
    });
  }

  const existingIds = new Set(conventions.map((convention) => convention.id));
  const autoConventions = deriveAutoNamingConventions(files, existingIds, Math.max(minConventionCount, MIN_CONVENTION_COUNT));
  conventions.push(...autoConventions);

  conventions.sort((left, right) => {
    if (left.evidence.frequency !== right.evidence.frequency) {
      return right.evidence.frequency - left.evidence.frequency;
    }
    return left.id.localeCompare(right.id);
  });

  return conventions.slice(0, Math.max(minConventionCount, MIN_CONVENTION_COUNT));
}

function inferTaskCategories(taskType?: string, domain?: string, filesToModify: string[] = []): Set<ConventionCategory> {
  const categories = new Set<ConventionCategory>();
  const signal = `${taskType ?? ''} ${domain ?? ''} ${filesToModify.join(' ')}`.toLowerCase();
  if (/\btest|spec|vitest|assert|regression\b/u.test(signal)) categories.add('testing');
  if (/\blog|telemetry|trace|observability\b/u.test(signal)) categories.add('logging');
  if (/\berror|recover|fallback|exception\b/u.test(signal)) categories.add('error_handling');
  if (/\basync|await|concurrent|parallel\b/u.test(signal)) categories.add('async');
  if (/\btype|interface|schema|contract\b/u.test(signal)) categories.add('types');
  if (/\bimport|module|dependency\b/u.test(signal)) categories.add('imports');
  if (/\bconstruct|pipeline|gate|process\b/u.test(signal)) categories.add('construction');
  if (/\bconfidence|evidence|epistemic|truth\b/u.test(signal)) categories.add('epistemics');
  if (/\bdocs?|readme|guide\b/u.test(signal)) categories.add('documentation');
  if (/\bnaming|identifier|api\b/u.test(signal)) categories.add('naming');
  return categories;
}

function levelWeight(level: ConventionLevel): number {
  if (level === 'MUST') return 3;
  if (level === 'SHOULD') return 2;
  return 1;
}

export function selectQualityNormsForTask(input: TaskQualityNormSelectionInput): TaskQualityNorm[] {
  const minRules = Math.max(1, Math.min(5, input.minRules ?? 3));
  const maxRules = Math.max(minRules, Math.min(5, input.maxRules ?? 5));
  const taskTokens = new Set<string>();
  for (const filePath of input.filesToModify) {
    for (const token of tokenizePath(normalizePath(filePath))) {
      taskTokens.add(token);
    }
  }
  const categoryHints = inferTaskCategories(input.taskType, input.domain, input.filesToModify);

  const scored = input.constitution.conventions.map((convention) => {
    const evidenceBlob = `${convention.rule} ${convention.evidence.examples.join(' ')} ${convention.evidence.counterExamples.join(' ')}`.toLowerCase();
    let tokenOverlap = 0;
    for (const token of taskTokens) {
      if (evidenceBlob.includes(token)) tokenOverlap += 1;
    }
    const categoryBonus = categoryHints.has(convention.category) ? 1.5 : 0;
    const score = Number((levelWeight(convention.level) * 0.9 + tokenOverlap * 0.35 + categoryBonus + convention.evidence.frequency).toFixed(3));
    return {
      id: convention.id,
      category: convention.category,
      level: convention.level,
      rule: convention.rule,
      frequency: convention.evidence.frequency,
      example: convention.evidence.examples[0] ?? 'n/a',
      score,
    } as TaskQualityNorm;
  });

  scored.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    if (left.frequency !== right.frequency) return right.frequency - left.frequency;
    return left.id.localeCompare(right.id);
  });

  const selected = scored.slice(0, maxRules);
  if (selected.length >= minRules) return selected;
  return scored.slice(0, minRules);
}

export function evaluateNormGuidedDepth(intent: string, qualityNorms: TaskQualityNorm[]): NormDepthEvaluation {
  const intentSignal = Math.min(0.3, intent.trim().split(/\s+/u).filter(Boolean).length / 40);
  const withoutNorms = Number((0.25 + intentSignal).toFixed(3));
  const normsWeight = qualityNorms.reduce((sum, norm) => sum + (levelWeight(norm.level) * 0.05) + (norm.frequency * 0.04), 0);
  const categoryDiversity = new Set(qualityNorms.map((norm) => norm.category)).size * 0.03;
  const withNorms = Number(Math.min(1, withoutNorms + normsWeight + categoryDiversity).toFixed(3));
  return {
    withoutNorms,
    withNorms,
    improvement: Number((withNorms - withoutNorms).toFixed(3)),
  };
}

async function writeConstitution(outputPath: string, constitution: QualityBarConstitution): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(constitution, null, 2), 'utf8');
}

function maybeGetCachedConstitution(cacheKey: string, outputPath: string, forceRegenerate: boolean): QualityBarConstitution | null {
  if (forceRegenerate) return null;
  const cached = constitutionCache.get(cacheKey);
  if (!cached) return null;
  if (cached.outputPath !== outputPath) return null;
  if (Date.now() - cached.loadedAtMs > DEFAULT_CACHE_TTL_MS) return null;
  return cached.constitution;
}

async function loadConstitutionFromDisk(outputPath: string): Promise<QualityBarConstitution | null> {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<QualityBarConstitution>;
    if (!parsed || !Array.isArray(parsed.conventions) || !Array.isArray(parsed.agenticCriteria)) {
      return null;
    }
    const project = typeof parsed.project === 'string' ? parsed.project : 'unknown';
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date(0).toISOString();
    return {
      version: typeof parsed.version === 'string' ? parsed.version : QUALITY_BAR_VERSION,
      project,
      generatedAt,
      sourceFileCount: typeof parsed.sourceFileCount === 'number' ? parsed.sourceFileCount : 0,
      conventions: parsed.conventions as QualityBarConvention[],
      agenticCriteria: parsed.agenticCriteria as AgenticCriterion[],
    };
  } catch {
    return null;
  }
}

export function createQualityBarConstitutionConstruction(): Construction<
  QualityBarConstitutionInput,
  QualityBarConstitutionOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'QualityBarConstitutionConstruction',
    name: 'Quality Bar Constitution Construction',
    description: 'Mines codebase conventions into a machine-readable constitution and emits task-relevant quality norms.',
    async execute(input: QualityBarConstitutionInput) {
      try {
        const workspace = path.resolve(input.workspace);
        const outputPath = path.resolve(
          workspace,
          input.outputPath ?? DEFAULT_QUALITY_BAR_CONSTITUTION_RELATIVE_PATH
        );
        const minConventionCount = Math.max(input.minConventionCount ?? MIN_CONVENTION_COUNT, MIN_CONVENTION_COUNT);
        const cacheKey = workspace;
        const forceRegenerate = input.forceRegenerate === true;

        const cached = maybeGetCachedConstitution(cacheKey, outputPath, forceRegenerate);
        if (cached) {
          return ok<QualityBarConstitutionOutput, ConstructionError>({
            kind: 'QualityBarConstitution.v1',
            constitution: cached,
            outputPath,
          });
        }

        if (!forceRegenerate) {
          const fromDisk = await loadConstitutionFromDisk(outputPath);
          if (fromDisk) {
            constitutionCache.set(cacheKey, {
              loadedAtMs: Date.now(),
              outputPath,
              constitution: fromDisk,
            });
            return ok<QualityBarConstitutionOutput, ConstructionError>({
              kind: 'QualityBarConstitution.v1',
              constitution: fromDisk,
              outputPath,
            });
          }
        }

        const sourceFiles = await collectSourceFiles(workspace);
        const minedFiles = await Promise.all(sourceFiles.map((filePath) => mineFile(workspace, filePath)));
        const conventions = mineConventions(minedFiles, minConventionCount);
        const constitution: QualityBarConstitution = {
          version: QUALITY_BAR_VERSION,
          project: path.basename(workspace),
          generatedAt: new Date().toISOString(),
          sourceFileCount: minedFiles.length,
          conventions,
          agenticCriteria: AGENTIC_CRITERIA,
        };

        await writeConstitution(outputPath, constitution);
        constitutionCache.set(cacheKey, {
          loadedAtMs: Date.now(),
          outputPath,
          constitution,
        });

        return ok<QualityBarConstitutionOutput, ConstructionError>({
          kind: 'QualityBarConstitution.v1',
          constitution,
          outputPath,
        });
      } catch (error) {
        throw new ConstructionError(
          `Failed to build quality bar constitution: ${toSingleLine(error)}`,
          'QualityBarConstitutionConstruction',
          error instanceof Error ? error : undefined
        );
      }
    },
  };
}

export async function regenerateQualityBarConstitution(
  workspace: string,
  options: { outputPath?: string; minConventionCount?: number } = {}
): Promise<QualityBarConstitution> {
  const construction = createQualityBarConstitutionConstruction();
  const result = await construction.execute({
    workspace,
    outputPath: options.outputPath,
    minConventionCount: options.minConventionCount,
    forceRegenerate: true,
  });
  if (!result.ok) {
    throw new Error(`Quality constitution regeneration failed: ${toSingleLine(result.error)}`);
  }
  return result.value.constitution;
}

export async function getTaskQualityNorms(input: TaskQualityNormsInput): Promise<TaskQualityNorm[]> {
  const construction = createQualityBarConstitutionConstruction();
  const result = await construction.execute({
    workspace: input.workspace,
    outputPath: input.outputPath,
    forceRegenerate: input.forceRegenerate,
  });
  if (!result.ok) {
    throw new Error(`Failed to load constitution for task norms: ${toSingleLine(result.error)}`);
  }
  return selectQualityNormsForTask({
    constitution: result.value.constitution,
    filesToModify: input.filesToModify,
    taskType: input.taskType,
    domain: input.domain,
    minRules: input.minRules,
    maxRules: input.maxRules,
  });
}
