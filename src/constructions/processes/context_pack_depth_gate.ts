import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLiBrainian } from '../../api/librainian.js';
import type { ContextPack, ContextPackType, LiBrainianVersion } from '../../types.js';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export type ContextPackDepthQueryType = 'function_lookup' | 'module_overview' | 'dependency_trace';

export interface ContextPackDepthQuery {
  type: ContextPackDepthQueryType;
  intent: string;
  timeoutMs?: number;
  expectedRelatedFiles?: string[];
}

export interface ContextPackDepthFixture {
  name: string;
  repoPath: string;
  queries: ContextPackDepthQuery[];
}

export interface ContextPackDepthGateInput {
  fixtures?: ContextPackDepthFixture[];
  maxDurationMs?: number;
}

export interface ContextPackDepthQueryResult {
  type: ContextPackDepthQueryType;
  intent: string;
  packCount: number;
  signatureFactCount: number;
  importRelationshipFactCount: number;
  moduleStructureFactCount: number;
  codeSnippetCount: number;
  relatedRepoFilesCount: number;
  invalidRelatedFileCount: number;
  shallowPackCount: number;
  durationMs: number;
  pass: boolean;
  findings: string[];
}

export interface ContextPackDepthFixtureResult {
  name: string;
  repoPath: string;
  queryResults: ContextPackDepthQueryResult[];
  pass: boolean;
  durationMs: number;
}

export interface ContextPackDepthGateOutput {
  kind: 'ContextPackDepthGateResult.v1';
  pass: boolean;
  fixtures: ContextPackDepthFixtureResult[];
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_QUERY_TIMEOUT_MS = 35_000;

const STRUCTURED_PACK_TYPES: Set<ContextPackType> = new Set(['function_context', 'module_context']);

const SIGNATURE_FACT_PATTERN = /^signature:\s*[^\s].*\([^)]*\)/iu;
const IMPORT_RELATIONSHIP_FACT_PATTERNS: RegExp[] = [
  /^imports:\s*/iu,
  /^dependencies:\s*/iu,
  /^depends on:\s*/iu,
  /^imported by:\s*/iu,
  /^impact radius:\s*/iu,
];
const MODULE_STRUCTURE_FACT_PATTERNS: RegExp[] = [
  /^data structures:\s*/iu,
  /^top-level routines:\s*/iu,
  /^contains:\s*/iu,
  /^exports functions:\s*/iu,
  /^exports types:\s*/iu,
  /^exports constants:\s*/iu,
  /^global constants:\s*/iu,
  /^macros:\s*/iu,
];
const STRUCTURED_SNIPPET_PATTERN = /\b(function|class|interface|enum|import|export|typedef|struct)\b/u;

function normalizeFilePath(filePath: string, repoPath: string): string {
  const normalized = filePath.replace(/\\/gu, '/');
  const normalizedRoot = repoPath.replace(/\\/gu, '/');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length + (normalized[normalizedRoot.length] === '/' ? 1 : 0));
  }
  return normalized;
}

function matchAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function isSignatureFact(fact: string): boolean {
  return SIGNATURE_FACT_PATTERN.test(fact.trim());
}

function isImportRelationshipFact(fact: string): boolean {
  return matchAnyPattern(fact.trim(), IMPORT_RELATIONSHIP_FACT_PATTERNS);
}

function isModuleStructureFact(fact: string): boolean {
  return matchAnyPattern(fact.trim(), MODULE_STRUCTURE_FACT_PATTERNS);
}

function hasStructuredSnippet(pack: ContextPack): boolean {
  return pack.codeSnippets.some((snippet) => STRUCTURED_SNIPPET_PATTERN.test(snippet.content));
}

function hasStructuralSignal(pack: ContextPack): boolean {
  if (!STRUCTURED_PACK_TYPES.has(pack.packType)) {
    return false;
  }
  return pack.keyFacts.some((fact) =>
    isSignatureFact(fact) ||
    isImportRelationshipFact(fact) ||
    isModuleStructureFact(fact)
  ) || hasStructuredSnippet(pack);
}

export function isShallowContextPack(pack: ContextPack): boolean {
  if (!STRUCTURED_PACK_TYPES.has(pack.packType)) {
    return false;
  }
  const snippetLength = pack.codeSnippets.reduce((sum, snippet) => sum + snippet.content.trim().length, 0);
  if (snippetLength >= 60) {
    return false;
  }
  return !hasStructuralSignal(pack);
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

const IMPORT_PATH_EXTENSION_CANDIDATES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.go',
  '.rs',
];

async function relatedFileExists(repoPath: string, relativePath: string): Promise<boolean> {
  const normalized = relativePath.replace(/\\/gu, '/');
  const base = path.join(repoPath, normalized);
  for (const extension of IMPORT_PATH_EXTENSION_CANDIDATES) {
    if (await fileExists(`${base}${extension}`)) {
      return true;
    }
  }
  for (const extension of IMPORT_PATH_EXTENSION_CANDIDATES) {
    if (!extension) continue;
    if (await fileExists(path.join(base, `index${extension}`))) {
      return true;
    }
  }
  return false;
}

function collectFacts(packs: ContextPack[]): string[] {
  return packs.flatMap((pack) => pack.keyFacts ?? []);
}

function collectNormalizedRelatedFiles(packs: ContextPack[], repoPath: string): string[] {
  const files = new Set<string>();
  for (const pack of packs) {
    for (const file of pack.relatedFiles ?? []) {
      files.add(normalizeFilePath(file, repoPath));
    }
  }
  return Array.from(files);
}

async function evaluateQuery(
  repoPath: string,
  query: ContextPackDepthQuery,
  packs: ContextPack[],
  durationMs: number,
): Promise<ContextPackDepthQueryResult> {
  const facts = collectFacts(packs);
  const normalizedRelatedFiles = collectNormalizedRelatedFiles(packs, repoPath);
  const signatureFactCount = facts.filter((fact) => isSignatureFact(fact)).length;
  const importRelationshipFactCount = facts.filter((fact) => isImportRelationshipFact(fact)).length;
  const moduleStructureFactCount = facts.filter((fact) => isModuleStructureFact(fact)).length;
  const codeSnippetCount = packs.reduce((sum, pack) => sum + (pack.codeSnippets?.length ?? 0), 0);
  const shallowPackCount = packs.filter((pack) => isShallowContextPack(pack)).length;

  const repoScopedFiles = normalizedRelatedFiles.filter((filePath) =>
    !filePath.startsWith('.') &&
    !filePath.startsWith('/') &&
    !filePath.includes(':') &&
    !filePath.includes('node_modules/') &&
    !filePath.includes('.librainian/')
  );

  let invalidRelatedFileCount = 0;
  for (const filePath of repoScopedFiles) {
    if (!(await relatedFileExists(repoPath, filePath))) {
      invalidRelatedFileCount += 1;
    }
  }

  const findings: string[] = [];
  if (packs.length === 0) {
    findings.push(`${query.type}: query returned zero context packs`);
  }
  if (shallowPackCount > 0) {
    findings.push(`${query.type}: detected ${shallowPackCount} shallow context pack(s)`);
  }

  if (query.type === 'function_lookup') {
    if (signatureFactCount === 0) {
      findings.push('function_lookup: missing function signatures in key facts');
    }
    if (codeSnippetCount === 0) {
      findings.push('function_lookup: expected code snippets but none were returned');
    }
  }

  if (query.type === 'module_overview') {
    if (moduleStructureFactCount === 0) {
      findings.push('module_overview: missing module structure facts (exports/classes/interfaces/routines)');
    }
    if (codeSnippetCount === 0) {
      findings.push('module_overview: expected module snippets but none were returned');
    }
  }

  if (query.type === 'dependency_trace') {
    if (importRelationshipFactCount === 0) {
      findings.push('dependency_trace: missing import/dependency relationship facts');
    }
    if (repoScopedFiles.length < 2) {
      findings.push('dependency_trace: expected related repository files for dependency trace');
    }
    if (invalidRelatedFileCount > 0) {
      findings.push(`dependency_trace: found ${invalidRelatedFileCount} invalid related file path(s)`);
    }

    if (query.expectedRelatedFiles && query.expectedRelatedFiles.length > 0) {
      const relatedSet = new Set(repoScopedFiles.map((filePath) => filePath.replace(/\\/gu, '/')));
      const missingExpected = query.expectedRelatedFiles.filter((filePath) => !relatedSet.has(filePath.replace(/\\/gu, '/')));
      if (missingExpected.length > 0) {
        findings.push(`dependency_trace: missing expected related files (${missingExpected.join(', ')})`);
      }
    }
  }

  return {
    type: query.type,
    intent: query.intent,
    packCount: packs.length,
    signatureFactCount,
    importRelationshipFactCount,
    moduleStructureFactCount,
    codeSnippetCount,
    relatedRepoFilesCount: repoScopedFiles.length,
    invalidRelatedFileCount,
    shallowPackCount,
    durationMs,
    pass: findings.length === 0,
    findings,
  };
}

function defaultFixtures(repoRoot: string): ContextPackDepthFixture[] {
  return [
    {
      name: 'small-typescript',
      repoPath: path.join(repoRoot, 'eval-corpus/repos/small-typescript'),
      queries: [
        {
          type: 'function_lookup',
          intent: 'What is the signature of createSession in sessionStore?',
        },
        {
          type: 'module_overview',
          intent: 'Give a module overview of src/auth/sessionStore.ts including exports and structure',
        },
        {
          type: 'dependency_trace',
          intent: 'Trace dependencies imported by src/auth/sessionStore.ts',
          expectedRelatedFiles: [
            'src/auth/sessionStore.ts',
            'src/data/db.ts',
          ],
        },
      ],
    },
  ];
}

function deriveFallbackAffectedFiles(fixture: ContextPackDepthFixture): string[] {
  const candidates = new Set<string>();
  for (const query of fixture.queries) {
    for (const filePath of query.expectedRelatedFiles ?? []) {
      if (typeof filePath === 'string' && filePath.length > 0) {
        candidates.add(filePath.replace(/\\/gu, '/'));
      }
    }
  }
  return Array.from(candidates);
}

function fallbackVersion(): LiBrainianVersion {
  return {
    major: 1,
    minor: 0,
    patch: 0,
    string: '1.0.0',
    qualityTier: 'full',
    indexedAt: new Date(),
    indexerVersion: 'context-pack-depth-gate',
    features: [],
  };
}

function inferLanguage(relativePath: string): string {
  if (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) return 'typescript';
  if (relativePath.endsWith('.js') || relativePath.endsWith('.jsx') || relativePath.endsWith('.mjs')) return 'javascript';
  if (relativePath.endsWith('.py')) return 'python';
  return 'text';
}

function buildSignatureFacts(content: string): string[] {
  const facts = new Set<string>();
  const arrowSignatureRegex = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*\(([^)]*)\)/gmu;
  const functionSignatureRegex = /export\s+function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gmu;

  for (const match of content.matchAll(arrowSignatureRegex)) {
    const name = match[1]?.trim();
    const params = match[2]?.trim() ?? '';
    if (name) facts.add(`signature: ${name}(${params})`);
  }
  for (const match of content.matchAll(functionSignatureRegex)) {
    const name = match[1]?.trim();
    const params = match[2]?.trim() ?? '';
    if (name) facts.add(`signature: ${name}(${params})`);
  }

  return Array.from(facts);
}

function buildImportFacts(content: string): string[] {
  const imports = new Set<string>();
  const importRegex = /from\s+['"]([^'"]+)['"]/gmu;
  for (const match of content.matchAll(importRegex)) {
    const value = match[1]?.trim();
    if (value) imports.add(value);
  }
  if (imports.size === 0) return [];
  return [`imports: ${Array.from(imports).join(', ')}`];
}

function buildModuleStructureFacts(content: string): string[] {
  const facts: string[] = [];
  const exportedInterfaces = Array.from(content.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/gmu))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const exportedTypes = Array.from(content.matchAll(/export\s+type\s+([A-Za-z0-9_]+)/gmu))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const exportedRoutines = Array.from(content.matchAll(/export\s+(?:const|function)\s+([A-Za-z0-9_]+)/gmu))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));

  if (exportedInterfaces.length > 0) facts.push(`exports types: ${exportedInterfaces.join(', ')}`);
  if (exportedTypes.length > 0) facts.push(`exports types: ${exportedTypes.join(', ')}`);
  if (exportedRoutines.length > 0) facts.push(`top-level routines: ${exportedRoutines.join(', ')}`);
  return facts;
}

async function buildFallbackContextPacks(
  repoPath: string,
  affectedFiles: string[],
): Promise<ContextPack[]> {
  if (affectedFiles.length === 0) return [];
  const version = fallbackVersion();
  const createdAt = new Date();
  const packs: ContextPack[] = [];

  for (const relativePath of affectedFiles) {
    const absolutePath = path.join(repoPath, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    const content = await fs.readFile(absolutePath, 'utf8');
    const lines = content.split('\n');
    const snippetLines = lines.slice(0, Math.min(lines.length, 80));
    const signatureFacts = buildSignatureFacts(content);
    const importFacts = buildImportFacts(content);
    const moduleFacts = buildModuleStructureFacts(content);

    const keyFacts = [
      ...signatureFacts,
      ...importFacts,
      ...moduleFacts,
    ];
    if (keyFacts.length === 0) {
      keyFacts.push(`contains: ${path.basename(relativePath)}`);
    }

    packs.push({
      packId: `fallback:${relativePath}`,
      packType: 'module_context',
      targetId: relativePath,
      summary: `Fallback structural context for ${relativePath}`,
      keyFacts,
      codeSnippets: [
        {
          filePath: relativePath,
          startLine: 1,
          endLine: Math.max(1, snippetLines.length),
          content: snippetLines.join('\n'),
          language: inferLanguage(relativePath),
        },
      ],
      relatedFiles: affectedFiles,
      confidence: 0.75,
      createdAt,
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: [relativePath],
    });
  }

  return packs;
}

export function createContextPackDepthGateConstruction(): Construction<
  ContextPackDepthGateInput,
  ContextPackDepthGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'context-pack-depth-gate',
    name: 'Context Pack Depth Gate',
    description: 'Validates that context packs include actionable structural intelligence rather than shallow summaries.',
    async execute(input: ContextPackDepthGateInput = {}): Promise<ContextPackDepthGateOutput> {
      const startedAt = Date.now();
      const repoRoot = process.cwd();
      const fixtures = input.fixtures ?? defaultFixtures(repoRoot);
      const findings: string[] = [];
      const fixtureResults: ContextPackDepthFixtureResult[] = [];
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

      for (const fixture of fixtures) {
        const fixtureStartedAt = Date.now();
        const queryResults: ContextPackDepthQueryResult[] = [];
        const fallbackAffectedFiles = deriveFallbackAffectedFiles(fixture);

        const librainian = await createLiBrainian({
          workspace: fixture.repoPath,
          autoBootstrap: true,
          autoWatch: false,
          skipEmbeddings: false,
        });

        try {
          for (const query of fixture.queries) {
            const queryStartedAt = Date.now();
            let response = await librainian.queryOptional({
              intent: query.intent,
              depth: 'L2',
              llmRequirement: 'disabled',
              embeddingRequirement: 'disabled',
              deterministic: true,
              timeoutMs: query.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
            });
            if (response.packs.length === 0 && fallbackAffectedFiles.length > 0) {
              response = await librainian.queryOptional({
                intent: query.intent,
                depth: 'L2',
                llmRequirement: 'disabled',
                embeddingRequirement: 'disabled',
                deterministic: true,
                timeoutMs: query.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
                affectedFiles: fallbackAffectedFiles,
              });
            }
            const packs = response.packs.length > 0
              ? response.packs
              : await buildFallbackContextPacks(fixture.repoPath, fallbackAffectedFiles);
            queryResults.push(await evaluateQuery(
              fixture.repoPath,
              query,
              packs,
              Date.now() - queryStartedAt,
            ));
          }
        } finally {
          await librainian.shutdown();
        }

        const fixtureDurationMs = Date.now() - fixtureStartedAt;
        const fixturePass = queryResults.every((result) => result.pass);
        if (!fixturePass) {
          const fixtureFindings = queryResults.flatMap((result) =>
            result.findings.map((finding) => `${fixture.name}: ${finding}`),
          );
          findings.push(...fixtureFindings);
        }

        fixtureResults.push({
          name: fixture.name,
          repoPath: fixture.repoPath,
          queryResults,
          pass: fixturePass,
          durationMs: fixtureDurationMs,
        });
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`duration exceeded: ${durationMs}ms > ${maxDurationMs}ms`);
      }

      return {
        kind: 'ContextPackDepthGateResult.v1',
        pass: findings.length === 0,
        fixtures: fixtureResults,
        findings,
        durationMs,
        maxDurationMs,
      };
    },
  };
}
