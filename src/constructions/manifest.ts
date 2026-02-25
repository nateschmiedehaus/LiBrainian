import type { ConstructionSchema } from './types.js';

export type JSONSchema = ConstructionSchema;
export type ManifestScope = '@librainian' | '@librainian-community' | `@${string}`;
export type ManifestTrustTier = 'official' | 'partner' | 'community';

export type ManifestCapabilityId =
  | 'librarian'
  | 'query'
  | 'symbol-search'
  | 'debug-analysis'
  | 'impact-analysis'
  | 'quality-analysis'
  | 'security-analysis'
  | 'architecture-analysis'
  | 'call-graph'
  | 'import-graph'
  | 'vector-search'
  | 'contract-storage'
  | 'evidence-ledger'
  | 'git-history'
  | 'construction-cloud'
  | 'embedding-search'
  | 'function-semantics'
  | 'graph-metrics'
  | (string & {});

export interface ConstructionExample {
  title: string;
  input: unknown;
  output: unknown;
  description: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
}

export interface ConstructionManifest {
  id: string;
  scope: ManifestScope;
  version: string;
  author: string;
  license: string;
  description: string;
  agentDescription: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requiredCapabilities: ManifestCapabilityId[];
  optionalCapabilities: ManifestCapabilityId[];
  engines: { librainian: string };
  tags: string[];
  languages?: string[];
  frameworks?: string[];
  trustTier: ManifestTrustTier;
  testedOn: string[];
  examples: ConstructionExample[];
  changelog: ChangelogEntry[];
}

export interface ManifestValidationIssue {
  code:
    | 'type'
    | 'required'
    | 'format'
    | 'range'
    | 'duplicate'
    | 'semantic'
    | 'compatibility';
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ManifestValidationCheck {
  name: string;
  level: 'ok' | 'warn' | 'error';
  message: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  issues: ManifestValidationIssue[];
  errors: ManifestValidationIssue[];
  warnings: ManifestValidationIssue[];
  checks: ManifestValidationCheck[];
}

export interface ManifestValidationOptions {
  registeredIds?: ReadonlySet<string>;
  knownCapabilities?: ReadonlySet<string>;
  currentLibrarianVersion?: string;
}

const DEFAULT_KNOWN_CAPABILITIES = new Set<string>([
  'librarian',
  'query',
  'symbol-search',
  'debug-analysis',
  'impact-analysis',
  'quality-analysis',
  'security-analysis',
  'architecture-analysis',
  'call-graph',
  'import-graph',
  'vector-search',
  'contract-storage',
  'evidence-ledger',
  'git-history',
  'construction-cloud',
  'embedding-search',
  'function-semantics',
  'graph-metrics',
]);

const TRUST_TIERS = new Set<ManifestTrustTier>(['official', 'partner', 'community']);

export function validateManifest(
  manifest: unknown,
  options: ManifestValidationOptions = {},
): ManifestValidationResult {
  const checks: ManifestValidationCheck[] = [];
  const issues: ManifestValidationIssue[] = [];
  const knownCapabilities = options.knownCapabilities ?? DEFAULT_KNOWN_CAPABILITIES;
  const registeredIds = options.registeredIds ?? new Set<string>();

  if (!isRecord(manifest)) {
    const issue: ManifestValidationIssue = {
      code: 'type',
      path: '$',
      message: 'Manifest must be a JSON object.',
      severity: 'error',
    };
    return {
      valid: false,
      issues: [issue],
      errors: [issue],
      warnings: [],
      checks: [{ name: 'manifest', level: 'error', message: issue.message }],
    };
  }

  const id = readString(manifest.id);
  if (!id) {
    pushIssue(issues, checks, 'required', '$.id', 'id is required.', 'error');
  } else if (!isManifestId(id)) {
    pushIssue(issues, checks, 'format', '$.id', 'id must use librainian:<slug> or @scope/name format.', 'error');
  } else if (registeredIds.has(id)) {
    pushIssue(issues, checks, 'duplicate', '$.id', `id "${id}" is already registered.`, 'error');
  } else {
    checks.push({ name: 'id', level: 'ok', message: 'id is valid and available.' });
  }

  const scope = readString(manifest.scope);
  if (!scope) {
    pushIssue(issues, checks, 'required', '$.scope', 'scope is required.', 'error');
  } else if (!scope.startsWith('@') || !scope.includes('/')) {
    pushIssue(issues, checks, 'format', '$.scope', 'scope must look like @scope/name-space.', 'error');
  } else {
    checks.push({ name: 'scope', level: 'ok', message: 'scope is valid.' });
  }

  const version = readString(manifest.version);
  if (!version) {
    pushIssue(issues, checks, 'required', '$.version', 'version is required.', 'error');
  } else if (!isSemver(version)) {
    pushIssue(issues, checks, 'format', '$.version', `version "${version}" is not valid semver.`, 'error');
  } else {
    checks.push({ name: 'version', level: 'ok', message: 'version is valid semver.' });
  }

  validateRequiredString(manifest, 'author', issues, checks);
  validateRequiredString(manifest, 'license', issues, checks);
  validateRequiredString(manifest, 'description', issues, checks);

  const trustTier = readString(manifest.trustTier);
  if (!trustTier) {
    pushIssue(issues, checks, 'required', '$.trustTier', 'trustTier is required.', 'error');
  } else if (!TRUST_TIERS.has(trustTier as ManifestTrustTier)) {
    pushIssue(issues, checks, 'format', '$.trustTier', 'trustTier must be official|partner|community.', 'error');
  } else {
    checks.push({ name: 'trustTier', level: 'ok', message: `${trustTier}.` });
  }

  if (!isRecord(manifest.inputSchema)) {
    pushIssue(issues, checks, 'type', '$.inputSchema', 'inputSchema must be a JSON object.', 'error');
  } else {
    checks.push({ name: 'inputSchema', level: 'ok', message: 'input schema object provided.' });
  }

  if (!isRecord(manifest.outputSchema)) {
    pushIssue(issues, checks, 'type', '$.outputSchema', 'outputSchema must be a JSON object.', 'error');
  } else {
    checks.push({ name: 'outputSchema', level: 'ok', message: 'output schema object provided.' });
  }

  validateCapabilities(
    manifest,
    'requiredCapabilities',
    knownCapabilities,
    true,
    issues,
    checks,
  );
  validateCapabilities(
    manifest,
    'optionalCapabilities',
    knownCapabilities,
    false,
    issues,
    checks,
  );

  if (!isRecord(manifest.engines) || !readString(manifest.engines.librainian)) {
    pushIssue(issues, checks, 'required', '$.engines.librainian', 'engines.librainian is required.', 'error');
  } else {
    const range = readString(manifest.engines.librainian)!;
    const current = options.currentLibrarianVersion;
    if (current && !satisfiesVersionRange(current, range)) {
      pushIssue(
        issues,
        checks,
        'compatibility',
        '$.engines.librainian',
        `engines.librainian "${range}" does not include current runtime version ${current}.`,
        'error',
      );
    } else {
      checks.push({ name: 'engines.librainian', level: 'ok', message: `compatible range ${range}.` });
    }
  }

  validateStringArray(manifest, 'tags', true, issues, checks);
  validateStringArray(manifest, 'testedOn', true, issues, checks);
  validateStringArray(manifest, 'languages', false, issues, checks);
  validateStringArray(manifest, 'frameworks', false, issues, checks);

  if (!Array.isArray(manifest.examples) || manifest.examples.length === 0) {
    pushIssue(issues, checks, 'required', '$.examples', 'examples must include at least one example.', 'error');
  } else {
    let hasExampleError = false;
    manifest.examples.forEach((entry, index) => {
      if (!isRecord(entry)) {
        hasExampleError = true;
        pushIssue(issues, checks, 'type', `$.examples[${index}]`, 'example must be an object.', 'error');
        return;
      }
      if (!readString(entry.title)) {
        hasExampleError = true;
        pushIssue(issues, checks, 'required', `$.examples[${index}].title`, 'title is required.', 'error');
      }
      if (!readString(entry.description)) {
        hasExampleError = true;
        pushIssue(issues, checks, 'required', `$.examples[${index}].description`, 'description is required.', 'error');
      }
      if (!Object.prototype.hasOwnProperty.call(entry, 'input')) {
        hasExampleError = true;
        pushIssue(issues, checks, 'required', `$.examples[${index}].input`, 'input is required.', 'error');
      }
      if (!Object.prototype.hasOwnProperty.call(entry, 'output')) {
        hasExampleError = true;
        pushIssue(issues, checks, 'required', `$.examples[${index}].output`, 'output is required.', 'error');
      }
    });
    if (!hasExampleError) {
      checks.push({ name: 'examples', level: 'ok', message: `${manifest.examples.length} example(s) provided.` });
    }
  }

  if (!Array.isArray(manifest.changelog) || manifest.changelog.length === 0) {
    pushIssue(issues, checks, 'required', '$.changelog', 'changelog must include at least one entry.', 'error');
  } else {
    let hasChangelogError = false;
    manifest.changelog.forEach((entry, index) => {
      if (!isRecord(entry)) {
        hasChangelogError = true;
        pushIssue(issues, checks, 'type', `$.changelog[${index}]`, 'changelog entry must be an object.', 'error');
        return;
      }
      const itemVersion = readString(entry.version);
      const itemDate = readString(entry.date);
      const itemSummary = readString(entry.summary);
      if (!itemVersion || !isSemver(itemVersion)) {
        hasChangelogError = true;
        pushIssue(issues, checks, 'format', `$.changelog[${index}].version`, 'changelog version must be semver.', 'error');
      }
      if (!itemDate || !isIsoDate(itemDate)) {
        hasChangelogError = true;
        pushIssue(issues, checks, 'format', `$.changelog[${index}].date`, 'changelog date must be YYYY-MM-DD.', 'error');
      }
      if (!itemSummary) {
        hasChangelogError = true;
        pushIssue(issues, checks, 'required', `$.changelog[${index}].summary`, 'changelog summary is required.', 'error');
      }
    });
    if (!hasChangelogError) {
      checks.push({ name: 'changelog', level: 'ok', message: `${manifest.changelog.length} entry(ies) provided.` });
    }
  }

  const agentDescription = readString(manifest.agentDescription);
  if (!agentDescription) {
    pushIssue(issues, checks, 'required', '$.agentDescription', 'agentDescription is required.', 'error');
  } else {
    if (agentDescription.length < 100) {
      pushIssue(
        issues,
        checks,
        'range',
        '$.agentDescription',
        `agentDescription must be at least 100 characters (got ${agentDescription.length}).`,
        'error',
      );
    }
    const analysis = analyzeAgentDescription(agentDescription);
    if (!analysis.hasWhenToUseStatement) {
      pushIssue(
        issues,
        checks,
        'semantic',
        '$.agentDescription',
        'agentDescription must include at least one explicit when-to-use sentence.',
        'error',
      );
    }
    if (!analysis.hasLimitationStatement) {
      pushIssue(
        issues,
        checks,
        'semantic',
        '$.agentDescription',
        'agentDescription must include at least one explicit limitation sentence.',
        'error',
      );
    }
    if (analysis.hasWhenToUseStatement && analysis.hasLimitationStatement && agentDescription.length >= 100) {
      checks.push({ name: 'agentDescription', level: 'ok', message: 'routing and limitation structure detected.' });
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    checks,
  };
}

export function compatibilityScore(
  manifestA: Pick<ConstructionManifest, 'outputSchema'>,
  manifestB: Pick<ConstructionManifest, 'inputSchema'>,
): number {
  return scoreSchemaCompatibility(manifestA.outputSchema, manifestB.inputSchema);
}

function analyzeAgentDescription(value: string): { hasWhenToUseStatement: boolean; hasLimitationStatement: boolean } {
  const sentences = value
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const hasWhenToUseStatement = sentences.some((sentence) =>
    sentence.length >= 20
    && (
      /^\s*(use|invoke|run|apply)\b/i.test(sentence)
      || /\b(if|when|before|after|whenever)\b/i.test(sentence)
    ));

  const hasLimitationStatement = sentences.some((sentence) =>
    sentence.length >= 20
    && /\b(cannot|can't|does not|doesn't|will not|won't|limited to|requires)\b/i.test(sentence));

  return {
    hasWhenToUseStatement,
    hasLimitationStatement,
  };
}

function validateRequiredString(
  record: Record<string, unknown>,
  field: string,
  issues: ManifestValidationIssue[],
  checks: ManifestValidationCheck[],
): void {
  const value = readString(record[field]);
  if (!value) {
    pushIssue(issues, checks, 'required', `$.${field}`, `${field} is required.`, 'error');
    return;
  }
  checks.push({ name: field, level: 'ok', message: `${field} is present.` });
}

function validateCapabilities(
  record: Record<string, unknown>,
  field: 'requiredCapabilities' | 'optionalCapabilities',
  knownCapabilities: ReadonlySet<string>,
  required: boolean,
  issues: ManifestValidationIssue[],
  checks: ManifestValidationCheck[],
): void {
  const value = record[field];
  if (!Array.isArray(value)) {
    if (required) {
      pushIssue(issues, checks, 'required', `$.${field}`, `${field} must be an array of capability IDs.`, 'error');
    } else if (value !== undefined) {
      pushIssue(issues, checks, 'type', `$.${field}`, `${field} must be an array of capability IDs.`, 'error');
    }
    return;
  }

  const nonStrings = value.filter((item) => typeof item !== 'string');
  if (nonStrings.length > 0) {
    pushIssue(issues, checks, 'type', `$.${field}`, `${field} must contain only strings.`, 'error');
    return;
  }

  const normalized = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  const duplicates = findDuplicates(normalized);
  if (duplicates.length > 0) {
    pushIssue(issues, checks, 'duplicate', `$.${field}`, `${field} contains duplicates: ${duplicates.join(', ')}`, 'error');
  }

  const unknown = normalized.filter((entry) => !knownCapabilities.has(entry));
  if (unknown.length > 0) {
    pushIssue(issues, checks, 'format', `$.${field}`, `${field} contains unknown capabilities: ${unknown.join(', ')}`, 'error');
  } else {
    checks.push({ name: field, level: 'ok', message: `${normalized.length} capability(ies).` });
  }
}

function validateStringArray(
  record: Record<string, unknown>,
  field: string,
  required: boolean,
  issues: ManifestValidationIssue[],
  checks: ManifestValidationCheck[],
): void {
  const value = record[field];
  if (!Array.isArray(value)) {
    if (required) {
      pushIssue(issues, checks, 'required', `$.${field}`, `${field} must be an array of strings.`, 'error');
    }
    return;
  }
  if (value.some((entry) => typeof entry !== 'string' || String(entry).trim().length === 0)) {
    pushIssue(issues, checks, 'type', `$.${field}`, `${field} must contain non-empty strings.`, 'error');
    return;
  }
  checks.push({ name: field, level: 'ok', message: `${value.length} item(s).` });
}

function pushIssue(
  issues: ManifestValidationIssue[],
  checks: ManifestValidationCheck[],
  code: ManifestValidationIssue['code'],
  path: string,
  message: string,
  severity: ManifestValidationIssue['severity'],
): void {
  issues.push({ code, path, message, severity });
  checks.push({
    name: path.replace(/^\$\./, ''),
    level: severity === 'error' ? 'error' : 'warn',
    message,
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestId(value: string): boolean {
  return /^librainian:[a-z0-9][a-z0-9-]*$/.test(value)
    || /^@[^/\s]+\/[^/\s]+$/.test(value);
}

function isSemver(value: string): boolean {
  return /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.trim());
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      if (!duplicates.includes(value)) {
        duplicates.push(value);
      }
      continue;
    }
    seen.add(value);
  }
  return duplicates;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(input: string): Semver | null {
  const match = input.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function satisfiesVersionRange(currentVersion: string, range: string): boolean {
  const current = parseSemver(currentVersion);
  if (!current) return false;
  const normalized = range.trim();
  if (normalized.length === 0) return true;

  if (normalized.startsWith('>=')) {
    const minimum = parseSemver(normalized.slice(2).trim());
    if (!minimum) return false;
    return compareSemver(current, minimum) >= 0;
  }
  if (normalized.startsWith('^')) {
    const base = parseSemver(normalized.slice(1).trim());
    if (!base) return false;
    return current.major === base.major && compareSemver(current, base) >= 0;
  }
  const exact = parseSemver(normalized);
  if (!exact) return false;
  return compareSemver(current, exact) === 0;
}

function scoreSchemaCompatibility(outputSchema: JSONSchema, inputSchema: JSONSchema): number {
  const outputType = outputSchema.type;
  const inputType = inputSchema.type;

  if (!inputType && !outputType) {
    return 0.75;
  }
  if (!inputType || !outputType) {
    return 0.5;
  }
  if (outputType !== inputType) {
    return 0;
  }

  if (inputType === 'object') {
    const outputProps = outputSchema.properties ?? {};
    const inputProps = inputSchema.properties ?? {};
    const inputRequired = new Set(inputSchema.required ?? []);
    const inputKeys = Object.keys(inputProps);

    if (inputKeys.length === 0) {
      return 1;
    }

    let score = 0;
    for (const key of inputKeys) {
      if (!(key in outputProps)) {
        if (inputRequired.has(key)) {
          return 0;
        }
        continue;
      }
      score += scoreSchemaCompatibility(
        outputProps[key] ?? {},
        inputProps[key] ?? {},
      );
    }
    return Math.max(0, Math.min(1, score / inputKeys.length));
  }

  if (inputType === 'array') {
    if (!inputSchema.items || !outputSchema.items) {
      return 0.75;
    }
    if (Array.isArray(inputSchema.items) || Array.isArray(outputSchema.items)) {
      return 0.5;
    }
    return scoreSchemaCompatibility(outputSchema.items, inputSchema.items);
  }

  const inputEnum = inputSchema.enum;
  const outputEnum = outputSchema.enum;
  if (Array.isArray(inputEnum) && Array.isArray(outputEnum) && inputEnum.length > 0) {
    const outputSet = new Set(outputEnum);
    const overlap = inputEnum.filter((entry) => outputSet.has(entry)).length;
    return overlap / inputEnum.length;
  }

  return 1;
}
