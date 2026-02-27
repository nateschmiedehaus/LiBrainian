import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { Librarian } from '../../api/librarian.js';
import { LIBRARIAN_VERSION } from '../../index.js';
import {
  CONSTRUCTION_REGISTRY,
  getConstructionManifest,
  invokeConstruction,
  listConstructions,
} from '../../constructions/registry.js';
import type { ConstructionManifest, ConstructionSchema, ConstructionTrustTier } from '../../constructions/types.js';
import {
  validateManifest as validateConstructionManifest,
  type ManifestValidationIssue,
  type ManifestValidationOptions,
  type ManifestValidationResult,
} from '../../constructions/manifest.js';
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
      all: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      input: { type: 'string' },
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
    case 'run':
      await runRun({
        workspace,
        subcommandArgs,
        json,
        inputFlag: readStringArg(values.input),
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
    case 'submit':
      await runSubmit({
        workspace,
        subcommandArgs,
        json,
        manifestPathFlag: readStringArg(values.path),
        dryRun: Boolean(values['dry-run']),
      });
      return;
    default:
      throw createError(
        'INVALID_ARGUMENT',
        `Unknown constructions subcommand: ${subcommand}. Use list|search|describe|install|run|validate|submit.`,
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
  const showAll = Boolean(values.all);
  let availableOnly = showAll ? false : true;
  if (Boolean(values['available-only'])) {
    availableOnly = true;
  }
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
      const capabilityText = entry.requiredCapabilities.length > 0
        ? ` requires: ${entry.requiredCapabilities.join(', ')}`
        : '';
      console.log(`  ${entry.displayId}  ${entry.description} [${languagesText}]${capabilityText}`);
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
      installCommand: formatInstallCommand(entry.manifest),
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
  const installMode = resolveInstallMode(manifest);
  const installCommand = formatInstallCommand(manifest);

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
    installMode,
    installCommand,
    runCommand: `librarian constructions run ${manifest.id} --input '${JSON.stringify(exampleInput)}'`,
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
  const installMode = resolveInstallMode(manifest);

  if (installMode === 'unavailable') {
    throw createError(
      'INVALID_ARGUMENT',
      `Construction ${manifest.id} is discoverable but not executable/installable in this runtime.`,
      {
        recoveryHints: [
          'Run `librarian constructions list` to view executable constructions.',
          'Use `librarian constructions run <id> --input <json>` for built-in constructions.',
          'Use `librarian compose "<intent>"` for composition-based execution.',
        ],
      },
    );
  }

  if (!dryRun && installMode === 'npm') {
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
    installMode,
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

  if (installMode === 'builtin') {
    console.log(`Preparing ${manifest.id}...`);
    if (dryRun) {
      console.log('[ok] Dry run complete (built-in construction; no npm install required).');
    } else {
      console.log('[ok] Built-in construction is already available');
    }
  } else {
    console.log(`Installing ${packageSpec}...`);
    if (dryRun) {
      console.log('[ok] Dry run complete (npm install skipped).');
    } else {
      console.log('[ok] Package installed');
    }
  }
  console.log('[ok] Manifest validated');
  console.log(`[ok] Required capabilities available: ${manifest.requiredCapabilities.join(', ') || 'none'}`);
  console.log(`[ok] Construction registered: ${manifest.id}`);
}

async function runRun(params: {
  workspace: string;
  subcommandArgs: string[];
  json: boolean;
  inputFlag?: string;
}): Promise<void> {
  const { workspace, subcommandArgs, json, inputFlag } = params;
  const id = subcommandArgs[0];
  if (!id) {
    throw createError('INVALID_ARGUMENT', 'Construction id is required. Usage: librarian constructions run <id> --input \'{"key":"value"}\'');
  }
  const manifest = getConstructionManifest(id);
  if (!manifest) {
    throw createError('ENTITY_NOT_FOUND', `Unknown construction id: ${id}`);
  }
  if (manifest.available === false) {
    throw createError(
      'INVALID_ARGUMENT',
      `Construction ${manifest.id} is not executable in this runtime.`,
      {
        recoveryHints: [
          'Run `librarian constructions list` to see executable constructions.',
          'Run `librarian constructions list --all` to inspect discovery-only entries.',
          'Use `librarian compose "<intent>"` for composition workflows.',
        ],
      },
    );
  }
  const input = parseRunInput(inputFlag, subcommandArgs.slice(1));
  const inputValidation = validateRunInputAgainstSchema(manifest.inputSchema, input);
  if (!inputValidation.valid) {
    throw createError(
      'INVALID_ARGUMENT',
      `${inputValidation.message} Required fields: ${inputValidation.missingFields.join(', ')}`,
      {
        recoveryHints: [
          `Run \`librarian constructions describe ${manifest.id}\` for expected input schema.`,
          `Example input: ${buildSchemaExample(manifest.inputSchema)}`,
        ],
      },
    );
  }
  const missingRuntimeCapabilities = detectMissingRuntimeCapabilities(
    workspace,
    manifest.requiredCapabilities,
  );
  if (missingRuntimeCapabilities.length > 0) {
    throw createError(
      'INVALID_ARGUMENT',
      `Missing runtime capabilities: ${missingRuntimeCapabilities.join(', ')}`,
      {
        recoveryHints: missingRuntimeCapabilities.map((capability) =>
          runtimeCapabilityHint(capability)),
      },
    );
  }
  const librarian = new Librarian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: (process.env.LIBRARIAN_LLM_PROVIDER as 'claude' | 'codex') || 'claude',
    llmModelId: process.env.LIBRARIAN_LLM_MODEL,
  });
  await librarian.initialize();
  try {
    const output = await invokeConstruction(
      manifest.id,
      input,
      {
        deps: { librarian },
        signal: new AbortController().signal,
        sessionId: randomUUID(),
      },
    );
    const serializedOutput = serializeConstructionRunOutput(output);
    const payload = {
      command: 'run',
      success: true,
      id: manifest.id,
      input,
      output: serializedOutput,
    };
    if (json) {
      console.log(JSON.stringify(payload));
      return;
    }
    console.log(`Ran ${manifest.id}`);
    console.log(JSON.stringify(serializedOutput, null, 2));
  } finally {
    await librarian.shutdown();
  }
}

async function runValidate(params: {
  workspace: string;
  subcommandArgs: string[];
  json: boolean;
  manifestPathFlag?: string;
}): Promise<void> {
  const { workspace, subcommandArgs, json, manifestPathFlag } = params;
  const { manifestPath, parsed } = await readManifestFile(workspace, subcommandArgs[0] ?? manifestPathFlag ?? 'construction.manifest.json');

  const validation = validateManifest(parsed);
  const payload = {
    command: 'validate',
    manifestPath,
    currentVersion: LIBRARIAN_VERSION.string,
    valid: validation.valid,
    checks: validation.checks,
    issues: validation.issues,
    errors: serializeValidationIssues(validation.errors),
    warnings: serializeValidationIssues(validation.warnings),
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

async function runSubmit(params: {
  workspace: string;
  subcommandArgs: string[];
  json: boolean;
  manifestPathFlag?: string;
  dryRun: boolean;
}): Promise<void> {
  const {
    workspace,
    subcommandArgs,
    json,
    manifestPathFlag,
    dryRun,
  } = params;
  const { manifestPath, parsed } = await readManifestFile(workspace, subcommandArgs[0] ?? manifestPathFlag ?? 'construction.manifest.json');
  const validation = validateManifest(parsed);
  const manifestId = isRecord(parsed) ? readStringArg(parsed.id) : undefined;
  const outputPath = manifestId
    ? path.join(workspace, '.librainian', 'registry-submissions', sanitizePathSegment(manifestId), 'construction.manifest.json')
    : undefined;

  let accepted = validation.valid;
  if (accepted && !dryRun && outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }
  if (!manifestId) {
    accepted = false;
  }

  const payload = {
    command: 'submit',
    manifestPath,
    accepted,
    dryRun,
    submittedId: manifestId ?? null,
    submissionPath: outputPath ?? null,
    checks: validation.checks,
    issues: validation.issues,
    errors: serializeValidationIssues(validation.errors),
    warnings: serializeValidationIssues(validation.warnings),
  };

  if (json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`Submitting ${manifestPath}...`);
    for (const check of validation.checks) {
      console.log(`[${check.level}] ${check.name}: ${check.message}`);
    }
    if (accepted) {
      console.log(dryRun
        ? '\nSubmission accepted (dry-run).'
        : `\nSubmission accepted and staged at ${outputPath}.`);
    } else {
      console.log('\nSubmission rejected.');
    }
  }

  if (!accepted) {
    process.exitCode = 1;
  }
}

async function readManifestFile(
  workspace: string,
  inputPath: string,
): Promise<{ manifestPath: string; raw: string; parsed: unknown }> {
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
  return { manifestPath, raw, parsed };
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

type InstallMode = 'builtin' | 'npm' | 'unavailable';

function resolveInstallMode(manifest: ConstructionManifest): InstallMode {
  if (manifest.available === false) return 'unavailable';
  if (manifest.id.startsWith('librainian:')) return 'builtin';
  if (manifest.id.startsWith('@')) return 'npm';
  return manifest.scope === '@librainian' ? 'builtin' : 'npm';
}

function formatInstallCommand(manifest: ConstructionManifest): string {
  const mode = resolveInstallMode(manifest);
  if (mode === 'npm') {
    return `npm install ${toPackageName(manifest.id)}@${manifest.version}`;
  }
  return `librarian constructions install ${manifest.id}`;
}

function parseRunInput(inputFlag: string | undefined, positionalRemainder: string[]): unknown {
  if (inputFlag) {
    return coerceInputPayload(inputFlag);
  }
  if (positionalRemainder.length === 0) {
    return {};
  }
  return coerceInputPayload(positionalRemainder.join(' '));
}

function coerceInputPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { prompt: raw };
  }
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
  const capabilities = new Set<string>([
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
  for (const manifest of listConstructions()) {
    for (const capability of manifest.requiredCapabilities) {
      capabilities.add(capability);
    }
    const optionalCapabilities = (manifest as { optionalCapabilities?: unknown }).optionalCapabilities;
    if (Array.isArray(optionalCapabilities)) {
      for (const capability of optionalCapabilities) {
        capabilities.add(capability);
      }
    }
  }
  return capabilities;
}

function validateManifest(value: unknown): ManifestValidationResult {
  return validateConstructionManifest(value, buildManifestValidationOptions());
}

function buildManifestValidationOptions(): ManifestValidationOptions {
  return {
    registeredIds: new Set(listConstructions().map((manifest) => manifest.id)),
    knownCapabilities: getKnownCapabilities(),
    currentLibrarianVersion: LIBRARIAN_VERSION.string,
  };
}

function serializeValidationIssues(issues: ManifestValidationIssue[]): string[] {
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function validateRunInputAgainstSchema(
  schema: ConstructionSchema,
  input: unknown,
): { valid: true } | { valid: false; missingFields: string[]; message: string } {
  const required = schema.required ?? [];
  if (schema.type !== 'object' || required.length === 0) {
    return { valid: true };
  }
  if (!isRecord(input)) {
    return {
      valid: false,
      missingFields: required,
      message: 'Invalid construction input. Expected a JSON object.',
    };
  }
  const missingFields = required.filter((field) => input[field] === undefined);
  if (missingFields.length === 0) {
    return { valid: true };
  }
  return {
    valid: false,
    missingFields,
    message: 'Invalid construction input. Missing required field(s).',
  };
}

function buildSchemaExample(schema: ConstructionSchema): string {
  if (schema.type !== 'object') {
    return '{}';
  }
  const required = schema.required ?? [];
  if (required.length === 0) {
    return '{}';
  }
  const sample: Record<string, unknown> = {};
  for (const field of required) {
    const fieldSchema = schema.properties?.[field];
    sample[field] = sampleValueForType(fieldSchema?.type);
  }
  return JSON.stringify(sample);
}

function sampleValueForType(type: string | undefined): unknown {
  switch (type) {
    case 'array':
      return ['value'];
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'object':
      return {};
    default:
      return 'value';
  }
}

function detectMissingRuntimeCapabilities(
  workspace: string,
  requiredCapabilities: string[],
): string[] {
  const missing: string[] = [];
  for (const capability of requiredCapabilities) {
    if (capability === 'librainian-eval' && !hasWorkspacePackage(workspace, 'librainian-eval')) {
      missing.push(capability);
    }
  }
  return missing;
}

function hasWorkspacePackage(workspace: string, packageName: string): boolean {
  const requireFromWorkspace = createRequire(path.join(workspace, '__librainian_capability_probe__.js'));
  try {
    requireFromWorkspace.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function runtimeCapabilityHint(capability: string): string {
  if (capability === 'librainian-eval') {
    return 'Install optional dependency: `npm install librainian-eval`';
  }
  return `Provide runtime capability: ${capability}`;
}

function serializeConstructionRunOutput(output: unknown): unknown {
  if (!isRecord(output)) {
    return output;
  }
  if (!Object.prototype.hasOwnProperty.call(output, 'error')) {
    return output;
  }
  return {
    ...output,
    error: serializeErrorForOutput(output.error),
  };
}

function serializeErrorForOutput(error: unknown, depth = 0): unknown {
  if (depth >= 4) {
    return '[truncated]';
  }
  if (error instanceof Error) {
    const errorRecord = error as unknown as Record<string, unknown>;
    const serialized: Record<string, unknown> = {
      name: error.name || 'Error',
      message: normalizeErrorMessage(error),
    };
    for (const key of Object.keys(errorRecord)) {
      if (key === 'name' || key === 'message') continue;
      serialized[key] = serializeErrorForOutput(
        errorRecord[key],
        depth + 1,
      );
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && serialized.cause === undefined) {
      serialized.cause = serializeErrorForOutput(cause, depth + 1);
    }
    return serialized;
  }
  if (Array.isArray(error)) {
    return error.map((item) => serializeErrorForOutput(item, depth + 1));
  }
  if (!isRecord(error)) {
    return error;
  }
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    serialized[key] = serializeErrorForOutput(value, depth + 1);
  }
  return serialized;
}

function normalizeErrorMessage(error: Error): string {
  const message = error.message?.trim();
  if (message && message.length > 0) {
    return message;
  }
  const fallback = String(error);
  const prefix = `${error.name}: `;
  return fallback.startsWith(prefix) ? fallback.slice(prefix.length) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
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
