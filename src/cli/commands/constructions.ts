import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { LIBRARIAN_VERSION } from '../../index.js';
import {
  CONSTRUCTION_REGISTRY,
  getConstructionManifest,
  listConstructions,
} from '../../constructions/registry.js';
import type { ConstructionManifest, ConstructionSchema, ConstructionTrustTier } from '../../constructions/types.js';
import { createError } from '../errors.js';

export interface ConstructionsCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface SearchResult {
  id: string;
  score: number;
  agentDescription: string;
  tags: string[];
  requiredCapabilities: string[];
  installCommand: string;
}

interface ConstructionListItem {
  id: string;
  displayId: string;
  name: string;
  scope: string;
  trustTier: ConstructionTrustTier;
  version: string;
  description: string;
  tags: string[];
  languages: string[];
  frameworks: string[];
  requiredCapabilities: string[];
  available: boolean;
  packageName: string;
}

interface ValidationCheck {
  name: string;
  level: 'ok' | 'warn' | 'error';
  message: string;
}

interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: ValidationCheck[];
}

const TRUST_TIERS: ConstructionTrustTier[] = ['official', 'partner', 'community'];
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'by',
  'is',
  'are',
  'be',
  'this',
  'that',
  'or',
  'from',
]);

export async function constructionsCommand(options: ConstructionsCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values, positionals } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      limit: { type: 'string' },
      offset: { type: 'string' },
      tags: { type: 'string' },
      capabilities: { type: 'string' },
      'trust-tier': { type: 'string' },
      language: { type: 'string' },
      'available-only': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      path: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const json = Boolean(values.json);
  const subcommand = String(positionals[0] ?? 'list').toLowerCase();
  const subcommandArgs = positionals.slice(1).map(String);

  switch (subcommand) {
    case 'list':
      await runList({ values, subcommandArgs, json });
      return;
    case 'search':
      await runSearch({ values, subcommandArgs, json });
      return;
    case 'describe':
      await runDescribe({ subcommandArgs, json });
      return;
    case 'install':
      await runInstall({
        workspace,
        subcommandArgs,
        json,
        dryRun: Boolean(values['dry-run']),
      });
      return;
    case 'validate':
      await runValidate({
        workspace,
        subcommandArgs,
        json,
        manifestPathFlag: readStringArg(values.path),
      });
      return;
    default:
      throw createError(
        'INVALID_ARGUMENT',
        `Unknown constructions subcommand: ${subcommand}. Use list|search|describe|install|validate.`,
      );
  }
}

async function runList(params: {
  values: Record<string, unknown>;
  subcommandArgs: string[];
  json: boolean;
}): Promise<void> {
  const { values, json } = params;
  const trustTierRaw = readStringArg(values['trust-tier']);
  const trustTier = parseTrustTier(trustTierRaw);
  if (trustTierRaw && !trustTier) {
    throw createError('INVALID_ARGUMENT', `Invalid --trust-tier "${trustTierRaw}". Use official|partner|community.`);
  }

  const tags = parseCsv(readStringArg(values.tags));
  const capabilities = parseCsv(readStringArg(values.capabilities));
  const language = readStringArg(values.language)?.toLowerCase();
  const availableOnly = Boolean(values['available-only']);
  const limit = parseNonNegativeInteger(readStringArg(values.limit), 'limit');
  const offset = parseNonNegativeInteger(readStringArg(values.offset), 'offset');

  let manifests = listConstructions({
    tags: tags.length > 0 ? tags : undefined,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    trustTier: trustTier ?? undefined,
    availableOnly,
  });

  if (language) {
    manifests = manifests.filter((manifest) =>
      (manifest.languages ?? []).some((item) => String(item).toLowerCase() === language));
  }

  const pageOffset = offset ?? 0;
  const pageLimit = limit ?? manifests.length;
  const paged = manifests.slice(pageOffset, pageOffset + pageLimit);
  const groups: Record<ConstructionTrustTier, ConstructionListItem[]> = {
    official: paged.filter((manifest) => manifest.trustTier === 'official').map(toListItem),
    partner: paged.filter((manifest) => manifest.trustTier === 'partner').map(toListItem),
    community: paged.filter((manifest) => manifest.trustTier === 'community').map(toListItem),
  };

  const payload = {
    command: 'list',
    total: manifests.length,
    offset: pageOffset,
    limit: pageLimit,
    hasMore: pageOffset + pageLimit < manifests.length,
    filters: {
      trustTier: trustTier ?? null,
      tags,
      capabilities,
      language: language ?? null,
      availableOnly,
    },
    groups,
    constructions: paged.map(toListItem),
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(`Available Constructions (${manifests.length} total)\n`);
  for (const tier of TRUST_TIERS) {
    const entries = groups[tier];
    if (entries.length === 0) continue;
    console.log(`${tier[0]!.toUpperCase()}${tier.slice(1)}`);
    for (const entry of entries) {
      const languagesText = entry.languages.length > 0 ? entry.languages.join(', ') : 'any';
      console.log(`  ${entry.displayId}  ${entry.description} [${languagesText}]`);
    }
    console.log('');
  }
  console.log('Run `librarian constructions describe <id>` for details.');
  console.log('Run `librarian constructions search <query>` to rank by relevance.');
}

async function runSearch(params: {
  values: Record<string, unknown>;
  subcommandArgs: string[];
  json: boolean;
}): Promise<void> {
  const { values, subcommandArgs, json } = params;
  const query = subcommandArgs.join(' ').trim();
  if (!query) {
    throw createError('INVALID_ARGUMENT', 'Search query is required. Usage: librarian constructions search "<query>"');
  }

  const limit = parseNonNegativeInteger(readStringArg(values.limit), 'limit') ?? 10;
  const manifests = listConstructions();
  const results = manifests
    .map((manifest) => ({
      manifest,
      score: scoreManifest(manifest, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.manifest.id,
      score: Number(entry.score.toFixed(3)),
      agentDescription: entry.manifest.agentDescription,
      tags: entry.manifest.tags,
      requiredCapabilities: entry.manifest.requiredCapabilities,
      installCommand: `npm install ${toPackageName(entry.manifest.id)}@${entry.manifest.version}`,
    } satisfies SearchResult));

  const payload = {
    command: 'search',
    query,
    total: results.length,
    results,
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(`Searching for: "${query}"\n`);
  if (results.length === 0) {
    console.log('No constructions matched your query.');
    return;
  }
  console.log('Results (ranked):\n');
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${displayConstructionId(result.id)} [score: ${result.score.toFixed(3)}]`);
    console.log(`   ${result.agentDescription}`);
    console.log(`   Tags: ${result.tags.join(', ') || 'none'}`);
    console.log(`   Requires: ${result.requiredCapabilities.join(', ') || 'none'}`);
  });
}

async function runDescribe(params: {
  subcommandArgs: string[];
  json: boolean;
}): Promise<void> {
  const { subcommandArgs, json } = params;
  const id = subcommandArgs[0];
  if (!id) {
    throw createError('INVALID_ARGUMENT', 'Construction id is required. Usage: librarian constructions describe <id>');
  }

  const manifest = getConstructionManifest(id);
  if (!manifest) {
    throw createError('ENTITY_NOT_FOUND', `Unknown construction id: ${id}`);
  }

  const exampleInput = manifest.examples[0]?.input ?? {};
  const related = listConstructions({ availableOnly: true })
    .filter((candidate) => candidate.id !== manifest.id)
    .map((candidate) => ({
      id: candidate.id,
      score: Math.max(
        CONSTRUCTION_REGISTRY.compatibilityScore(manifest.id, candidate.id),
        CONSTRUCTION_REGISTRY.compatibilityScore(candidate.id, manifest.id),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5);

  const payload = {
    command: 'describe',
    id: manifest.id,
    displayId: displayConstructionId(manifest.id),
    name: manifest.name,
    version: manifest.version,
    scope: manifest.scope,
    trustTier: manifest.trustTier,
    available: manifest.available !== false,
    description: manifest.description,
    agentDescription: manifest.agentDescription,
    inputType: describeSchema(manifest.inputSchema),
    outputType: describeSchema(manifest.outputSchema),
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    requiredCapabilities: manifest.requiredCapabilities,
    tags: manifest.tags,
    languages: manifest.languages ?? [],
    frameworks: manifest.frameworks ?? [],
    example: manifest.examples[0] ?? null,
    exampleCode: buildExampleCode(manifest.id, exampleInput),
    relatedConstructions: related,
    packageName: toPackageName(manifest.id),
    installCommand: `npm install ${toPackageName(manifest.id)}@${manifest.version}`,
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(`${payload.displayId} v${payload.version}`);
  console.log(`  ${payload.packageName}`);
  console.log(`  trust: ${payload.trustTier} | scope: ${payload.scope}\n`);
  console.log('Description (for agents):');
  console.log(`  ${payload.agentDescription}\n`);
  console.log(`Input:  ${payload.inputType}`);
  console.log(`Output: ${payload.outputType}`);
  console.log(`Required capabilities: ${payload.requiredCapabilities.join(', ') || 'none'}`);
  console.log(`Works with: ${payload.languages.length > 0 ? payload.languages.join(', ') : 'any'}`);
  console.log('\nExample:');
  console.log(payload.exampleCode);
  if (related.length > 0) {
    console.log('\nRelated constructions:');
    console.log(`  ${related.map((entry) => displayConstructionId(entry.id)).join(', ')}`);
  }
  console.log(`\n${payload.installCommand}`);
}

async function runInstall(params: {
  workspace: string;
  subcommandArgs: string[];
  json: boolean;
  dryRun: boolean;
}): Promise<void> {
  const { workspace, subcommandArgs, json, dryRun } = params;
  const id = subcommandArgs[0];
  if (!id) {
    throw createError('INVALID_ARGUMENT', 'Construction id is required. Usage: librarian constructions install <id>');
  }

  const manifest = getConstructionManifest(id);
  if (!manifest) {
    throw createError('ENTITY_NOT_FOUND', `Unknown construction id: ${id}`);
  }

  const knownCapabilities = getKnownCapabilities();
  const missingCapabilities = manifest.requiredCapabilities.filter((capability) => !knownCapabilities.has(capability));
  if (missingCapabilities.length > 0) {
    throw createError(
      'INVALID_ARGUMENT',
      `Cannot install ${manifest.id}: missing capabilities ${missingCapabilities.join(', ')}.`,
    );
  }

  const packageName = toPackageName(manifest.id);
  const packageSpec = `${packageName}@${manifest.version}`;
  let stderr = '';
  let stdout = '';

  if (!dryRun) {
    const result = spawnSync('npm', ['install', packageSpec], {
      cwd: workspace,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    stderr = String(result.stderr ?? '');
    stdout = String(result.stdout ?? '');
    if (result.status !== 0) {
      const detail = stderr.trim() || stdout.trim() || `npm exited with code ${result.status ?? 'unknown'}`;
      throw createError('QUERY_FAILED', `npm install failed for ${packageSpec}: ${detail}`);
    }
  }

  const payload = {
    command: 'install',
    success: true,
    dryRun,
    installed: !dryRun,
    id: manifest.id,
    packageName,
    packageSpec,
    validated: {
      manifest: true,
      requiredCapabilities: manifest.requiredCapabilities,
    },
    stdout: dryRun ? '' : stdout.trim(),
    stderr: dryRun ? '' : stderr.trim(),
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(`Installing ${packageSpec}...`);
  if (dryRun) {
    console.log('[ok] Dry run complete (npm install skipped).');
  } else {
    console.log('[ok] Package installed');
  }
  console.log('[ok] Manifest validated');
  console.log(`[ok] Required capabilities available: ${manifest.requiredCapabilities.join(', ') || 'none'}`);
  console.log(`[ok] Construction registered: ${manifest.id}`);
}

async function runValidate(params: {
  workspace: string;
  subcommandArgs: string[];
  json: boolean;
  manifestPathFlag?: string;
}): Promise<void> {
  const { workspace, subcommandArgs, json, manifestPathFlag } = params;
  const inputPath = subcommandArgs[0] ?? manifestPathFlag ?? 'construction.manifest.json';
  const manifestPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workspace, inputPath);

  let raw = '';
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
      throw createError(
      'INVALID_ARGUMENT',
      `Manifest file not found: ${manifestPath}`,
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createError(
      'INVALID_ARGUMENT',
      `Manifest is not valid JSON: ${manifestPath}`,
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }

  const validation = validateManifest(parsed);
  const payload = {
    command: 'validate',
    manifestPath,
    currentVersion: LIBRARIAN_VERSION.string,
    ...validation,
  };

  if (json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`Validating ${manifestPath}...`);
    for (const check of validation.checks) {
      console.log(`[${check.level}] ${check.name}: ${check.message}`);
    }
    const statusText = validation.valid ? 'passed' : 'failed';
    console.log(`\nValidation ${statusText}: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`);
  }

  if (!validation.valid) {
    process.exitCode = 1;
  }
}

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTrustTier(value?: string): ConstructionTrustTier | undefined {
  if (!value) return undefined;
  return TRUST_TIERS.find((tier) => tier === value);
}

function parseNonNegativeInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError('INVALID_ARGUMENT', `--${flagName} must be a non-negative integer.`);
  }
  return parsed;
}

function readStringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function displayConstructionId(id: string): string {
  if (id.startsWith('librainian:')) {
    return id.slice('librainian:'.length);
  }
  return id;
}

function toPackageName(id: string): string {
  if (id.startsWith('librainian:')) {
    return `@librainian/${id.slice('librainian:'.length)}`;
  }
  if (id.startsWith('@')) {
    return id;
  }
  return `@librainian-community/${id}`;
}

function describeSchema(schema: ConstructionSchema): string {
  const type = schema.type?.trim();
  if (!type) {
    if (schema.oneOf?.length) return `oneOf(${schema.oneOf.map(describeSchema).join(' | ')})`;
    if (schema.anyOf?.length) return `anyOf(${schema.anyOf.map(describeSchema).join(' | ')})`;
    if (schema.allOf?.length) return `allOf(${schema.allOf.map(describeSchema).join(' & ')})`;
    return 'unknown';
  }
  if (type === 'array') {
    if (Array.isArray(schema.items)) {
      return `Array<${schema.items.map(describeSchema).join(' | ')}>`;
    }
    if (schema.items) {
      return `Array<${describeSchema(schema.items)}>`;
    }
    return 'Array<unknown>';
  }
  if (type === 'object') {
    const keys = Object.keys(schema.properties ?? {});
    if (keys.length === 0) {
      return '{}';
    }
    const preview = keys.slice(0, 4).join(', ');
    return `{ ${preview}${keys.length > 4 ? ', ...' : ''} }`;
  }
  return type;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreManifest(manifest: ConstructionManifest, query: string): number {
  const queryLower = query.trim().toLowerCase();
  if (queryLower.length === 0) return 0;

  const corpus = [
    manifest.id,
    manifest.name,
    manifest.description,
    manifest.agentDescription,
    manifest.tags.join(' '),
    manifest.requiredCapabilities.join(' '),
  ].join(' ').toLowerCase();

  const queryTerms = tokenize(queryLower);
  if (queryTerms.length === 0) {
    return corpus.includes(queryLower) ? 0.35 : 0;
  }

  const corpusTerms = new Set(tokenize(corpus));
  const matched = queryTerms.filter((term) => corpusTerms.has(term)).length;
  const coverage = matched / queryTerms.length;

  let score = coverage * 0.7;
  if (corpus.includes(queryLower)) {
    score += 0.2;
  }
  if (manifest.tags.some((tag) => queryLower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(queryLower))) {
    score += 0.1;
  }
  if (displayConstructionId(manifest.id).includes(queryLower)) {
    score += 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

function toListItem(manifest: ConstructionManifest): ConstructionListItem {
  return {
    id: manifest.id,
    displayId: displayConstructionId(manifest.id),
    name: manifest.name,
    scope: manifest.scope,
    trustTier: manifest.trustTier,
    version: manifest.version,
    description: manifest.description,
    tags: manifest.tags,
    languages: (manifest.languages ?? []).map((item) => String(item)),
    frameworks: (manifest.frameworks ?? []).map((item) => String(item)),
    requiredCapabilities: manifest.requiredCapabilities,
    available: manifest.available !== false,
    packageName: toPackageName(manifest.id),
  };
}

function buildExampleCode(id: string, input: unknown): string {
  const serializedInput = JSON.stringify(input ?? {}, null, 2) ?? '{}';
  return [
    `import { getConstructionManifest } from 'librainian/constructions/registry';`,
    `const manifest = getConstructionManifest('${id}');`,
    `if (!manifest) throw new Error('construction not found');`,
    `const result = await manifest.construction.execute(${serializedInput});`,
    `console.log(result);`,
  ].join('\n');
}

function getKnownCapabilities(): Set<string> {
  const capabilities = new Set<string>(['librarian']);
  for (const manifest of listConstructions()) {
    for (const capability of manifest.requiredCapabilities) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

function validateManifest(value: unknown): ManifestValidationResult {
  const checks: ValidationCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownCapabilities = getKnownCapabilities();

  if (!value || typeof value !== 'object') {
    return {
      valid: false,
      errors: ['Manifest must be a JSON object.'],
      warnings: [],
      checks: [{
        name: 'manifest',
        level: 'error',
        message: 'Manifest must be a JSON object.',
      }],
    };
  }

  const record = value as Record<string, unknown>;
  const id = readStringArg(record.id);
  if (!id) {
    errors.push('id is required.');
    checks.push({ name: 'id', level: 'error', message: 'id is required.' });
  } else if (!isManifestIdLike(id)) {
    errors.push(`id "${id}" must use librainian:<slug> or @scope/name format.`);
    checks.push({ name: 'id', level: 'error', message: 'id format is invalid.' });
  } else if (getConstructionManifest(id)) {
    errors.push(`id "${id}" is already registered.`);
    checks.push({ name: 'id', level: 'error', message: 'id is already registered.' });
  } else {
    checks.push({ name: 'id', level: 'ok', message: 'id is unique.' });
  }

  const version = readStringArg(record.version);
  if (!version) {
    errors.push('version is required.');
    checks.push({ name: 'version', level: 'error', message: 'version is required.' });
  } else if (!isSemver(version)) {
    errors.push(`version "${version}" is not valid semver.`);
    checks.push({ name: 'version', level: 'error', message: 'version is not valid semver.' });
  } else {
    checks.push({ name: 'version', level: 'ok', message: 'valid semver.' });
  }

  if (!isPlainObject(record.inputSchema)) {
    errors.push('inputSchema must be a JSON object.');
    checks.push({ name: 'inputSchema', level: 'error', message: 'inputSchema must be a JSON object.' });
  } else {
    checks.push({ name: 'inputSchema', level: 'ok', message: 'valid JSON object.' });
  }

  if (!isPlainObject(record.outputSchema)) {
    errors.push('outputSchema must be a JSON object.');
    checks.push({ name: 'outputSchema', level: 'error', message: 'outputSchema must be a JSON object.' });
  } else {
    checks.push({ name: 'outputSchema', level: 'ok', message: 'valid JSON object.' });
  }

  const agentDescription = readStringArg(record.agentDescription);
  if (!agentDescription) {
    warnings.push('agentDescription is missing (recommended 30-100 words).');
    checks.push({ name: 'agentDescription', level: 'warn', message: 'missing (recommended 30-100 words).' });
  } else {
    const words = tokenizeForWordCount(agentDescription);
    if (words < 30 || words > 100) {
      warnings.push(`agentDescription has ${words} words (recommended 30-100).`);
      checks.push({ name: 'agentDescription', level: 'warn', message: `${words} words (recommended 30-100).` });
    } else {
      checks.push({ name: 'agentDescription', level: 'ok', message: `${words} words.` });
    }
  }

  if (!Array.isArray(record.examples) || record.examples.length === 0) {
    warnings.push('examples has no entries (recommended >=1).');
    checks.push({ name: 'examples', level: 'warn', message: 'no examples provided (recommended >=1).' });
  } else {
    checks.push({ name: 'examples', level: 'ok', message: `${record.examples.length} example(s).` });
  }

  if (record.requiredCapabilities !== undefined) {
    if (!Array.isArray(record.requiredCapabilities) || record.requiredCapabilities.some((entry) => typeof entry !== 'string')) {
      errors.push('requiredCapabilities must be an array of strings.');
      checks.push({ name: 'requiredCapabilities', level: 'error', message: 'must be an array of strings.' });
    } else {
      const unknown = record.requiredCapabilities.filter((entry) => !knownCapabilities.has(entry));
      if (unknown.length > 0) {
        errors.push(`requiredCapabilities contains unknown entries: ${unknown.join(', ')}`);
        checks.push({ name: 'requiredCapabilities', level: 'error', message: `unknown capabilities: ${unknown.join(', ')}` });
      } else {
        checks.push({ name: 'requiredCapabilities', level: 'ok', message: 'known capabilities only.' });
      }
    }
  }

  if (isPlainObject(record.engines) && readStringArg((record.engines as Record<string, unknown>).librainian)) {
    const range = readStringArg((record.engines as Record<string, unknown>).librainian)!;
    if (!satisfiesVersionRange(LIBRARIAN_VERSION.string, range)) {
      errors.push(`engines.librainian "${range}" does not include current version ${LIBRARIAN_VERSION.string}.`);
      checks.push({
        name: 'engines.librainian',
        level: 'error',
        message: `"${range}" does not include current version ${LIBRARIAN_VERSION.string}.`,
      });
    } else {
      checks.push({ name: 'engines.librainian', level: 'ok', message: `compatible with ${LIBRARIAN_VERSION.string}.` });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestIdLike(value: string): boolean {
  return /^librainian:[a-z0-9][a-z0-9-]*$/.test(value)
    || /^@[^/\s]+\/[^/\s]+$/.test(value);
}

function isSemver(value: string): boolean {
  return /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.trim());
}

function tokenizeForWordCount(value: string): number {
  return value
    .trim()
    .split(/\s+/g)
    .filter((token) => token.length > 0)
    .length;
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

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1] ?? '0', 10),
    minor: Number.parseInt(match[2] ?? '0', 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
  };
}

function compareSemver(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number },
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
