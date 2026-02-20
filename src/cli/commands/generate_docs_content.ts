import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import { listToolSchemas, getToolJsonSchema, type JSONSchema, type JSONSchemaProperty } from '../../mcp/schema.js';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { safeJsonParse } from '../../utils/safe_json.js';

export type PromptDocKind = 'tools' | 'context' | 'rules';

export interface GeneratePromptDocsOptions {
  workspace: string;
  outputDir?: string;
  include?: PromptDocKind[];
  combined?: boolean;
  maxTokensPerFile?: number;
}

export interface GeneratePromptDocsResult {
  outputDir: string;
  generatedAt: string;
  include: PromptDocKind[];
  filesWritten: string[];
  tokenEstimates: Record<string, number>;
  combinedFile?: string;
}

interface PromptDocsSelectionConfig {
  tools?: boolean;
  context?: boolean;
  rules?: boolean;
}

const DOC_FILE_NAMES: Record<PromptDocKind, string> = {
  tools: 'LIBRAINIAN_TOOLS.md',
  context: 'LIBRAINIAN_CONTEXT.md',
  rules: 'LIBRAINIAN_RULES.md',
};

const DEFAULT_MAX_TOKENS = 1800;
const MAX_ALLOWED_TOKENS = 2000;
const SCAN_FILE_LIMIT = 12_000;
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  '.librainian',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

export async function generatePromptDocs(options: GeneratePromptDocsOptions): Promise<GeneratePromptDocsResult> {
  const workspace = path.resolve(options.workspace);
  const outputDir = path.resolve(options.outputDir ?? workspace);
  await fs.mkdir(outputDir, { recursive: true });

  const include = await resolveIncludedKinds(workspace, options.include);
  const tokenBudget = normalizeTokenBudget(options.maxTokensPerFile);
  const generatedAt = new Date().toISOString();

  const [contextFacts, indexHealth] = await Promise.all([
    collectWorkspaceFacts(workspace),
    collectIndexHealth(workspace),
  ]);

  const filesWritten: string[] = [];
  const tokenEstimates: Record<string, number> = {};

  for (const kind of include) {
    const fileName = DOC_FILE_NAMES[kind];
    const targetPath = path.join(outputDir, fileName);
    const markdown = renderDoc(kind, {
      workspace,
      generatedAt,
      contextFacts,
      indexHealth,
    });
    const bounded = enforceTokenBudget(markdown, tokenBudget);
    await fs.writeFile(targetPath, `${bounded}\n`, 'utf8');
    filesWritten.push(targetPath);
    tokenEstimates[fileName] = estimateTokens(bounded);
  }

  let combinedFile: string | undefined;
  if (options.combined) {
    const combinedPath = path.join(outputDir, 'LIBRAINIAN_PROMPT_DOCS.md');
    const combinedSections = include.map((kind) => {
      const body = renderDoc(kind, {
        workspace,
        generatedAt,
        contextFacts,
        indexHealth,
      });
      return `## ${kind.toUpperCase()}\n\n${body}`;
    });
    const combined = [`# LiBrainian Prompt Docs`, '', `Generated: ${generatedAt}`, '', ...combinedSections].join('\n');
    await fs.writeFile(combinedPath, `${combined}\n`, 'utf8');
    filesWritten.push(combinedPath);
    tokenEstimates[path.basename(combinedPath)] = estimateTokens(combined);
    combinedFile = combinedPath;
  }

  return {
    outputDir,
    generatedAt,
    include,
    filesWritten,
    tokenEstimates,
    combinedFile,
  };
}

function normalizeTokenBudget(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  const normalized = Math.floor(value as number);
  if (normalized <= 0) return DEFAULT_MAX_TOKENS;
  return Math.min(normalized, MAX_ALLOWED_TOKENS);
}

async function resolveIncludedKinds(
  workspace: string,
  explicitInclude?: PromptDocKind[]
): Promise<PromptDocKind[]> {
  if (explicitInclude && explicitInclude.length > 0) {
    return dedupeKinds(explicitInclude);
  }

  const config = await readPromptDocsSelectionConfig(workspace);
  const selection: PromptDocKind[] = [];
  const defaults: Record<PromptDocKind, boolean> = {
    tools: true,
    context: true,
    rules: true,
  };

  for (const kind of ['tools', 'context', 'rules'] as const) {
    const enabled = config[kind] ?? defaults[kind];
    if (enabled) selection.push(kind);
  }

  return selection.length > 0 ? selection : ['tools', 'context', 'rules'];
}

function dedupeKinds(kinds: PromptDocKind[]): PromptDocKind[] {
  const seen = new Set<PromptDocKind>();
  const normalized: PromptDocKind[] = [];
  for (const kind of kinds) {
    if (kind !== 'tools' && kind !== 'context' && kind !== 'rules') continue;
    if (seen.has(kind)) continue;
    seen.add(kind);
    normalized.push(kind);
  }
  return normalized;
}

async function readPromptDocsSelectionConfig(workspace: string): Promise<PromptDocsSelectionConfig> {
  const configPaths = [
    path.join(workspace, 'librainian.config.json'),
    path.join(workspace, '.librarian', 'config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = safeJsonParse<Record<string, unknown>>(raw);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;
      const record = parsed.value;
      const nested = (
        readRecord(record.promptDocs)
        ?? readRecord(record.prompt_docs)
        ?? readRecord(readRecord(record.docs)?.promptDocs)
        ?? readRecord(readRecord(record.docs)?.prompt_docs)
      );
      if (!nested) continue;
      return {
        tools: readBoolean(nested.tools),
        context: readBoolean(nested.context),
        rules: readBoolean(nested.rules),
      };
    } catch {
      // Optional config file.
    }
  }

  return {};
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

interface WorkspaceFacts {
  totalFilesScanned: number;
  languageCounts: Array<{ language: string; count: number }>;
  keyModules: Array<{ module: string; files: number }>;
  entryPoints: string[];
}

async function collectWorkspaceFacts(workspace: string): Promise<WorkspaceFacts> {
  const queue: string[] = ['.'];
  const languageCounts = new Map<string, number>();
  const moduleCounts = new Map<string, number>();
  const fileSet: string[] = [];

  while (queue.length > 0 && fileSet.length < SCAN_FILE_LIMIT) {
    const relativeDir = queue.shift() ?? '.';
    const absoluteDir = path.join(workspace, relativeDir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        if (entry.isDirectory()) continue;
      }
      const relativePath = relativeDir === '.'
        ? entry.name
        : path.posix.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        queue.push(relativePath);
        continue;
      }

      if (!entry.isFile()) continue;
      fileSet.push(relativePath);

      const extension = path.extname(entry.name).toLowerCase();
      const language = mapExtensionToLanguage(extension);
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);

      const module = detectModuleBucket(relativePath);
      moduleCounts.set(module, (moduleCounts.get(module) ?? 0) + 1);

      if (fileSet.length >= SCAN_FILE_LIMIT) {
        break;
      }
    }
  }

  const languageSummary = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language, count]) => ({ language, count }));

  const keyModules = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([module, files]) => ({ module, files }));

  const packageEntrypoints = await readPackageEntrypoints(workspace);
  const discoveredEntrypoints = findLikelyEntrypoints(fileSet);
  const entryPoints = dedupeStrings([...packageEntrypoints, ...discoveredEntrypoints]).slice(0, 10);

  return {
    totalFilesScanned: fileSet.length,
    languageCounts: languageSummary,
    keyModules,
    entryPoints,
  };
}

function mapExtensionToLanguage(extension: string): string {
  switch (extension) {
    case '.ts':
    case '.tsx':
      return 'TypeScript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'JavaScript';
    case '.py':
      return 'Python';
    case '.go':
      return 'Go';
    case '.rs':
      return 'Rust';
    case '.java':
      return 'Java';
    case '.kt':
      return 'Kotlin';
    case '.json':
      return 'JSON';
    case '.yml':
    case '.yaml':
      return 'YAML';
    case '.toml':
      return 'TOML';
    case '.md':
      return 'Markdown';
    default:
      return extension ? extension.slice(1).toUpperCase() : 'No Extension';
  }
}

function detectModuleBucket(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments[0] === 'src' && segments.length >= 2) {
    return `src/${segments[1]}`;
  }
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? '(root)';
}

async function readPackageEntrypoints(workspace: string): Promise<string[]> {
  const packagePath = path.join(workspace, 'package.json');
  try {
    const raw = await fs.readFile(packagePath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (!parsed.ok || !parsed.value) return [];

    const pkg = parsed.value;
    const entries: string[] = [];
    const main = typeof pkg.main === 'string' ? pkg.main : null;
    const moduleField = typeof pkg.module === 'string' ? pkg.module : null;
    const types = typeof pkg.types === 'string' ? pkg.types : null;
    const bin = pkg.bin;

    if (main) entries.push(main);
    if (moduleField) entries.push(moduleField);
    if (types) entries.push(types);

    if (typeof bin === 'string') {
      entries.push(bin);
    } else if (bin && typeof bin === 'object') {
      for (const value of Object.values(bin as Record<string, unknown>)) {
        if (typeof value === 'string') entries.push(value);
      }
    }

    return entries;
  } catch {
    return [];
  }
}

function findLikelyEntrypoints(files: string[]): string[] {
  const candidates = new Set<string>();
  const patterns = new Set([
    'index.ts',
    'index.js',
    'main.ts',
    'main.js',
    'app.ts',
    'app.js',
    'server.ts',
    'server.js',
    'src/index.ts',
    'src/main.ts',
    'src/app.ts',
    'src/server.ts',
    'src/cli/index.ts',
    'src/cli/index.js',
  ]);

  for (const file of files) {
    const normalized = file.split(path.sep).join('/');
    if (patterns.has(normalized)) {
      candidates.add(normalized);
      continue;
    }
    if (normalized.startsWith('bin/')) {
      candidates.add(normalized);
      continue;
    }
  }

  return [...candidates.values()].sort();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.split(path.sep).join('/');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

interface IndexHealthFacts {
  status: 'ready' | 'uninitialized';
  metadataVersion?: string;
  qualityTier?: string;
  totalFiles?: number;
  totalFunctions?: number;
  totalContextPacks?: number;
  totalEmbeddings?: number;
  cacheHitRate?: number;
  error?: string;
}

async function collectIndexHealth(workspace: string): Promise<IndexHealthFacts> {
  try {
    const dbPath = await resolveDbPath(workspace);
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    try {
      const [metadata, stats] = await Promise.all([
        storage.getMetadata(),
        storage.getStats(),
      ]);
      return {
        status: 'ready',
        metadataVersion: metadata?.version.string,
        qualityTier: String(metadata?.qualityTier ?? 'unknown'),
        totalFiles: metadata?.totalFiles,
        totalFunctions: stats.totalFunctions,
        totalContextPacks: stats.totalContextPacks,
        totalEmbeddings: stats.totalEmbeddings,
        cacheHitRate: stats.cacheHitRate,
      };
    } finally {
      await storage.close();
    }
  } catch (error) {
    return {
      status: 'uninitialized',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderDoc(
  kind: PromptDocKind,
  context: {
    workspace: string;
    generatedAt: string;
    contextFacts: WorkspaceFacts;
    indexHealth: IndexHealthFacts;
  }
): string {
  switch (kind) {
    case 'tools':
      return renderToolsDoc(context.generatedAt);
    case 'context':
      return renderContextDoc(context.workspace, context.generatedAt, context.contextFacts, context.indexHealth);
    case 'rules':
      return renderRulesDoc(context.generatedAt);
  }
}

function renderToolsDoc(generatedAt: string): string {
  const toolNames = listToolSchemas().sort((a, b) => a.localeCompare(b));
  const lines: string[] = [
    '# LiBrainian Tools',
    '',
    `Generated: ${generatedAt}`,
    `Total tools: ${toolNames.length}`,
    '',
    'This file is optimized for prompt injection: concise tool contracts and invocation sketches.',
    '',
  ];

  for (const toolName of toolNames) {
    const schema = getToolJsonSchema(toolName);
    const required = summarizeRequired(schema);
    const optionalCount = summarizeOptionalCount(schema);
    const example = buildExampleInvocation(toolName, schema);

    lines.push(`### \`${toolName}\``);
    lines.push(`- Inputs: required ${required}; optional ${optionalCount}.`);
    lines.push(`- Example: \`${example}\``);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function summarizeRequired(schema: JSONSchema | undefined): string {
  const required = schema?.required ?? [];
  if (required.length === 0) return 'none';
  if (required.length <= 4) return required.join(', ');
  return `${required.slice(0, 4).join(', ')} (+${required.length - 4} more)`;
}

function summarizeOptionalCount(schema: JSONSchema | undefined): number {
  const total = Object.keys(schema?.properties ?? {}).length;
  const required = schema?.required?.length ?? 0;
  return Math.max(0, total - required);
}

function buildExampleInvocation(toolName: string, schema: JSONSchema | undefined): string {
  const args: Record<string, unknown> = {};
  const required = schema?.required ?? [];
  const properties = schema?.properties ?? {};

  const fields = required.length > 0
    ? required.slice(0, 2)
    : Object.keys(properties).slice(0, 1);

  for (const field of fields) {
    args[field] = inferExampleValue(field, properties[field]);
  }

  return JSON.stringify({ tool: toolName, arguments: args });
}

function inferExampleValue(fieldName: string, property: JSONSchemaProperty | undefined): unknown {
  if (!property) return '<value>';
  if (property.enum && property.enum.length > 0) return property.enum[0];
  switch (property.type) {
    case 'string':
      if (fieldName.toLowerCase().includes('workspace')) return '/path/to/workspace';
      if (fieldName.toLowerCase().includes('id')) return 'example-id';
      return '<text>';
    case 'number':
      return 1;
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '<value>';
  }
}

function renderContextDoc(
  workspace: string,
  generatedAt: string,
  workspaceFacts: WorkspaceFacts,
  indexHealth: IndexHealthFacts
): string {
  const lines: string[] = [
    '# LiBrainian Context',
    '',
    `Generated: ${generatedAt}`,
    `Workspace: ${workspace}`,
    '',
    '## Language Distribution',
    '',
    ...(
      workspaceFacts.languageCounts.length > 0
        ? workspaceFacts.languageCounts.map((item) => `- ${item.language}: ${item.count} files`)
        : ['- No source files discovered in scan scope.']
    ),
    '',
    '## Key Modules',
    '',
    ...(
      workspaceFacts.keyModules.length > 0
        ? workspaceFacts.keyModules.map((item) => `- ${item.module}: ${item.files} files`)
        : ['- No module buckets discovered.']
    ),
    '',
    '## Entry Points',
    '',
    ...(
      workspaceFacts.entryPoints.length > 0
        ? workspaceFacts.entryPoints.map((entry) => `- ${entry}`)
        : ['- No explicit entrypoint candidates detected.']
    ),
    '',
    '## Index Health',
    '',
  ];

  if (indexHealth.status === 'ready') {
    lines.push('- Status: ready');
    lines.push(`- Quality tier: ${indexHealth.qualityTier ?? 'unknown'}`);
    lines.push(`- Indexed files: ${indexHealth.totalFiles ?? 'unknown'}`);
    lines.push(`- Functions: ${indexHealth.totalFunctions ?? 'unknown'}`);
    lines.push(`- Context packs: ${indexHealth.totalContextPacks ?? 'unknown'}`);
    lines.push(`- Embeddings: ${indexHealth.totalEmbeddings ?? 'unknown'}`);
    if (typeof indexHealth.cacheHitRate === 'number') {
      lines.push(`- Cache hit rate: ${(indexHealth.cacheHitRate * 100).toFixed(1)}%`);
    }
    if (indexHealth.metadataVersion) {
      lines.push(`- Metadata version: ${indexHealth.metadataVersion}`);
    }
  } else {
    lines.push('- Status: uninitialized');
    lines.push('- Suggested next step: `librainian bootstrap`');
    if (indexHealth.error) {
      lines.push(`- Note: ${indexHealth.error}`);
    }
  }

  lines.push('');
  lines.push(`Scanned files: ${workspaceFacts.totalFilesScanned}`);
  return lines.join('\n').trimEnd();
}

function renderRulesDoc(generatedAt: string): string {
  return [
    '# LiBrainian Rules',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Retrieval Discipline',
    '- Call `query` before cross-file edits, impact analysis, or unfamiliar debugging work.',
    '- Prefer `depth=L1` by default; escalate to `L2/L3` only when evidence is insufficient.',
    '- Use `intentType` explicitly for routing-sensitive tasks (`debug`, `impact`, `refactor`, `security`).',
    '',
    '## Confidence Interpretation',
    '- `definitive/high`: proceed with standard caution.',
    '- `medium`: verify via targeted reads/tests before write operations.',
    '- `low/uncertain`: request human review or gather additional evidence first.',
    '',
    '## Evidence Ledger Conventions',
    '- Treat `traceId/sessionId` as the canonical linkage for replay and audit.',
    '- Record tool outcomes with explicit success/failure and error payloads.',
    '- Do not claim verification without reproducible evidence or deterministic checks.',
    '',
    '## Failure Handling',
    '- If storage locks are detected, run `librainian doctor --heal` before resuming heavy retrieval.',
    '- If providers are unavailable, run `librainian check-providers` and degrade honestly.',
    '- Keep outputs explicit about uncertainty; never hide degraded behavior.',
  ].join('\n');
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function enforceTokenBudget(content: string, maxTokens: number): string {
  const tokens = estimateTokens(content);
  if (tokens <= maxTokens) {
    return content;
  }

  const maxChars = maxTokens * 4;
  const truncated = content.slice(0, Math.max(0, maxChars - 96)).trimEnd();
  return `${truncated}\n\n_Truncated to respect ${maxTokens} token budget._`;
}
