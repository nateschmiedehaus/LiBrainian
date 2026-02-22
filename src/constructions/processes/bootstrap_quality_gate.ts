import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLiBrainian } from '../../api/librarian.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface BootstrapQualityFixture {
  name: string;
  repoPath: string;
  expectedFileCount?: number;
  language: 'typescript' | 'python' | 'c';
}

export interface BootstrapQualityGateInput {
  fixtures?: BootstrapQualityFixture[];
  timeoutMs?: number;
}

export interface BootstrapQualityFixtureResult {
  name: string;
  language: BootstrapQualityFixture['language'];
  workspace: string;
  expectedFileCount: number;
  indexedFileCount: number;
  embeddingChecks: {
    checked: number;
    missing: number;
    zeroNorm: number;
  };
  callGraphEdgeCount: number;
  queryPackCount: number;
  bootstrapped: boolean;
  pass: boolean;
  findings: string[];
  durationMs: number;
}

export interface BootstrapQualityGateOutput {
  kind: 'BootstrapQualityGateResult.v1';
  pass: boolean;
  fixtures: BootstrapQualityFixtureResult[];
  findings: string[];
  durationMs: number;
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.c', '.h',
]);

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.librarian' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTENSIONS.has(ext)) {
        files.push(absolute);
      }
    }
  }
  return files;
}

async function createDefaultCFixture(repoRoot: string): Promise<{ fixture: BootstrapQualityFixture; cleanupPath: string }> {
  const parent = path.join(repoRoot, '.librarian', 'tmp');
  await fs.mkdir(parent, { recursive: true });
  const cRoot = await fs.mkdtemp(path.join(parent, 'bootstrap-gate-c-'));
  await fs.mkdir(path.join(cRoot, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(cRoot, 'src', 'main.c'),
    [
      '#include "math.h"',
      '',
      'int main(void) {',
      '  return add(1, 2);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(cRoot, 'src', 'math.c'),
    [
      '#include "math.h"',
      '',
      'int add(int a, int b) {',
      '  return a + b;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(cRoot, 'src', 'math.h'), 'int add(int a, int b);\n', 'utf8');

  return {
    fixture: {
      name: 'small-c',
      language: 'c',
      repoPath: cRoot,
    },
    cleanupPath: cRoot,
  };
}

async function defaultFixtures(repoRoot: string): Promise<{ fixtures: BootstrapQualityFixture[]; cleanupPaths: string[] }> {
  const cFixture = await createDefaultCFixture(repoRoot);
  return {
    fixtures: [
      {
        name: 'small-typescript',
        language: 'typescript',
        repoPath: path.join(repoRoot, 'eval-corpus/repos/small-typescript'),
      },
      {
        name: 'medium-python',
        language: 'python',
        repoPath: path.join(repoRoot, 'eval-corpus/repos/medium-python'),
      },
      cFixture.fixture,
    ],
    cleanupPaths: [cFixture.cleanupPath],
  };
}

function embeddingNorm(embedding: Float32Array | null): number {
  if (!embedding) return 0;
  let normSq = 0;
  for (let i = 0; i < embedding.length; i += 1) {
    const value = embedding[i] ?? 0;
    normSq += value * value;
  }
  return Math.sqrt(normSq);
}

async function validateEmbeddings(storage: LiBrainianStorage): Promise<BootstrapQualityFixtureResult['embeddingChecks']> {
  const modules = await storage.getModules();
  let checked = 0;
  let missing = 0;
  let zeroNorm = 0;

  for (const mod of modules) {
    const embedding = await storage.getEmbedding(mod.id);
    checked += 1;
    if (!embedding) {
      missing += 1;
      continue;
    }
    if (embeddingNorm(embedding) <= 0) {
      zeroNorm += 1;
    }
  }

  return { checked, missing, zeroNorm };
}

async function runFixtureValidation(
  fixture: BootstrapQualityFixture,
  repoRoot: string,
): Promise<BootstrapQualityFixtureResult> {
  const startedAt = Date.now();
  const findings: string[] = [];
  const expectedFileCount =
    fixture.expectedFileCount ??
    (await collectSourceFiles(fixture.repoPath)).length;
  const tempRoot = path.join(repoRoot, '.librarian', 'tmp');
  await fs.mkdir(tempRoot, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(tempRoot, `bootstrap-gate-${fixture.name}-`));

  await fs.cp(fixture.repoPath, workspace, { recursive: true });

  let bootstrapped = false;
  let indexedFileCount = 0;
  let embeddingChecks: BootstrapQualityFixtureResult['embeddingChecks'] = { checked: 0, missing: 0, zeroNorm: 0 };
  let callGraphEdgeCount = 0;
  let queryPackCount = 0;

  const librarian = await createLiBrainian({
    workspace,
    autoBootstrap: true,
    autoWatch: false,
    skipEmbeddings: false,
  });

  try {
    const status = await librarian.getStatus();
    bootstrapped = status.bootstrapped;
    if (!status.bootstrapped) {
      findings.push('bootstrap failed: status.bootstrapped=false');
    }

    const storage = librarian.getStorage();
    if (!storage) {
      findings.push('storage unavailable after bootstrap');
    } else {
      const files = await storage.getFiles();
      indexedFileCount = files.length;
      if (indexedFileCount !== expectedFileCount) {
        findings.push(`indexed files mismatch: expected ${expectedFileCount}, got ${indexedFileCount}`);
      }

      embeddingChecks = await validateEmbeddings(storage);
      if (embeddingChecks.checked === 0) {
        findings.push('no module embeddings checked');
      }
      if (embeddingChecks.missing > 0) {
        findings.push(`missing embeddings: ${embeddingChecks.missing}`);
      }
      if (embeddingChecks.zeroNorm > 0) {
        findings.push(`zero-norm embeddings: ${embeddingChecks.zeroNorm}`);
      }

      const graphEdges = await storage.getGraphEdges({ limit: 25 });
      callGraphEdgeCount = graphEdges.length;
      if (callGraphEdgeCount === 0) {
        findings.push('call graph has zero edges');
      }
    }

    const query = await librarian.queryOptional({
      intent: 'Find key entry points and main execution flow',
      depth: 'L1',
      llmRequirement: 'disabled',
      deterministic: true,
      timeoutMs: 30_000,
    });
    queryPackCount = query.packs.length;
    if (query.packs.length === 0) {
      findings.push('query returned zero context packs');
    }
  } catch (error) {
    findings.push(`validation error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await librarian.shutdown();
    await fs.rm(workspace, { recursive: true, force: true });
  }

  return {
    name: fixture.name,
    language: fixture.language,
    workspace,
    expectedFileCount,
    indexedFileCount,
    embeddingChecks,
    callGraphEdgeCount,
    queryPackCount,
    bootstrapped,
    pass: findings.length === 0,
    findings,
    durationMs: Date.now() - startedAt,
  };
}

export function createBootstrapQualityGateConstruction(): Construction<
  BootstrapQualityGateInput,
  BootstrapQualityGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'bootstrap-quality-gate',
    name: 'Bootstrap Quality Gate',
    description: 'Bootstraps fixture repos and validates indexing, embeddings, call graph, and queryability.',
    async execute(input: BootstrapQualityGateInput = {}) {
      const startedAt = Date.now();
      const repoRoot = process.cwd();
      const resolvedDefaults = input.fixtures ? null : await defaultFixtures(repoRoot);
      const fixtures = input.fixtures ?? resolvedDefaults?.fixtures ?? [];
      const results: BootstrapQualityFixtureResult[] = [];
      const findings: string[] = [];

      try {
        for (const fixture of fixtures) {
          const result = await runFixtureValidation(fixture, repoRoot);
          results.push(result);
          if (!result.pass) {
            findings.push(`${fixture.name}: ${result.findings.join('; ')}`);
          }
        }
      } finally {
        if (resolvedDefaults) {
          for (const cleanupPath of resolvedDefaults.cleanupPaths) {
            await fs.rm(cleanupPath, { recursive: true, force: true });
          }
        }
      }

      return ok<BootstrapQualityGateOutput, ConstructionError>({
        kind: 'BootstrapQualityGateResult.v1',
        pass: findings.length === 0,
        fixtures: results,
        findings,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}
