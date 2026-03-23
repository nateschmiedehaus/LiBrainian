import { parseArgs } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createASTFactExtractor } from '../src/evaluation/ast_fact_extractor.js';
import {
  createGroundTruthGenerator,
  type GroundTruthCoverage,
  type StructuralGroundTruthCorpus,
  type StructuralGroundTruthQuery,
} from '../src/evaluation/ground_truth_generator.js';
import { exportStructuralGroundTruth } from '../src/evaluation/ground_truth_export.js';

// Diagnostic-only generator for external eval ground truth.
// The output supports internal gating and refresh workflows, but it is not
// release evidence while placeholder lexical evaluation remains in use.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  '.librarian-eval',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '.pytest_cache',
]);

// Keep ground-truth generation bounded and memory-stable by focusing on common "code" extensions.
// This avoids indexing large volumes of config/markup files that don't produce useful AST facts.
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.pyw',
  '.go',
  '.rs',
  '.java',
  '.kt', '.kts',
  '.c', '.h',
  '.cc', '.cpp', '.cxx',
  '.hpp', '.hxx', '.hh',
  '.cs',
  '.rb', '.rake', '.gemspec',
  '.php', '.phtml',
  '.swift',
  '.scala', '.sc',
  '.dart',
  '.lua',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
].map((ext) => ext.toLowerCase()));

interface ExternalRepoEntry {
  name: string;
  language?: string;
  hasTests?: boolean;
  verifiedAt?: string;
}

interface ExternalRepoManifest {
  repos?: ExternalRepoEntry[];
}

function normalizeLanguage(value?: string): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'typescript' || lower === 'ts') return 'TypeScript';
  if (lower === 'javascript' || lower === 'js') return 'JavaScript';
  if (lower === 'python' || lower === 'py') return 'Python';
  if (lower === 'go' || lower === 'golang') return 'Go';
  if (lower === 'rust' || lower === 'rs') return 'Rust';
  if (lower === 'java') return 'Java';
  if (lower === 'kotlin' || lower === 'kt') return 'Kotlin';
  return value;
}

async function walkFiles(root: string, relative = ''): Promise<string[]> {
  const dirPath = path.join(root, relative);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      files.push(...await walkFiles(root, nextRelative));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (SOURCE_EXTENSIONS.has(ext)) {
      files.push(path.join(relative, entry.name));
    }
  }
  return files;
}

function dedupeQueries(queries: StructuralGroundTruthQuery[]): StructuralGroundTruthQuery[] {
  const seen = new Set<string>();
  const deduped: StructuralGroundTruthQuery[] = [];
  for (const query of queries) {
    if (seen.has(query.id)) continue;
    seen.add(query.id);
    deduped.push(query);
  }
  return deduped;
}

function computeCoverage(facts: Array<{ type: string }>): GroundTruthCoverage {
  return {
    functions: facts.filter((fact) => fact.type === 'function_def').length,
    classes: facts.filter((fact) => fact.type === 'class').length,
    imports: facts.filter((fact) => fact.type === 'import').length,
    exports: facts.filter((fact) => fact.type === 'export').length,
  };
}

async function generateBoundedCorpusForRepo(
  repoRoot: string,
  repoName: string,
  maxSourceFilesPerRepo: number,
  maxQueriesPerRepo: number
): Promise<{ corpus: StructuralGroundTruthCorpus; sampledFileCount: number }> {
  const extractor = createASTFactExtractor({ includeExtensions: Array.from(SOURCE_EXTENSIONS) });
  const generator = createGroundTruthGenerator(extractor);
  const selectedFiles = await walkFiles(repoRoot, '', maxSourceFilesPerRepo);
  const facts: Awaited<ReturnType<typeof extractor.extractFromFile>> = [];

  for (const relativeFile of selectedFiles) {
    const absoluteFile = path.join(repoRoot, relativeFile);
    const extracted = await extractor.extractFromFile(absoluteFile);
    if (extracted.length > 0) {
      facts.push(...extracted);
    }
  }

  if (facts.length === 0) {
    return {
      corpus: {
        repoName,
        repoPath: repoRoot,
        generatedAt: new Date().toISOString(),
        queries: [],
        factCount: 0,
        coverage: { functions: 0, classes: 0, imports: 0, exports: 0 },
      },
      sampledFileCount: selectedFiles.length,
    };
  }

  const primaryQueries = [
    ...generator.generateFunctionQueries(facts),
    ...generator.generateImportQueries(facts),
    ...generator.generateClassQueries(facts),
    ...generator.generateCallGraphQueries(facts),
  ];
  const reservedUnanswerableCount = Math.max(1, Math.ceil(maxQueriesPerRepo * 0.2));
  const unanswerableQueries = generator.generateUnanswerableQueries(facts, {
    targetCount: reservedUnanswerableCount,
  });
  const primaryBudget = Math.max(0, maxQueriesPerRepo - unanswerableQueries.length);
  const queries = dedupeQueries([
    ...unanswerableQueries,
    ...primaryQueries.slice(0, primaryBudget),
  ]);

  return {
    corpus: {
      repoName,
      repoPath: repoRoot,
      generatedAt: new Date().toISOString(),
      queries,
      factCount: facts.length,
      coverage: computeCoverage(facts),
    },
    sampledFileCount: selectedFiles.length,
  };
}

async function ensureSymlinkRoot(reposRoot: string): Promise<string> {
  const linkRoot = path.join(reposRoot, 'repos');
  await mkdir(linkRoot, { recursive: true });
  return linkRoot;
}

async function ensureSymlink(target: string, linkPath: string): Promise<void> {
  try {
    const existing = await stat(linkPath);
    if (existing.isDirectory()) return;
  } catch {
    // no-op
  }
  try {
    await symlink(target, linkPath, 'dir');
  } catch {
    // Best-effort: ignore symlink failures (e.g., unsupported FS)
  }
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      reposRoot: { type: 'string' },
      manifest: { type: 'string' },
      repoNames: { type: 'string' },
      maxRepos: { type: 'string' },
      maxSourceFilesPerRepo: { type: 'string' },
      maxQueriesPerRepo: { type: 'string' },
      version: { type: 'string' },
    },
    strict: false,
  });

  const reposRoot = values.reposRoot ?? path.join(process.cwd(), 'eval-corpus', 'external-repos');
  const manifestPath = values.manifest ?? path.join(reposRoot, 'manifest.json');
  const maxRepos = values.maxRepos ? Number(values.maxRepos) : undefined;
  const maxSourceFilesPerRepo = values.maxSourceFilesPerRepo ? Number(values.maxSourceFilesPerRepo) : 50;
  const maxQueriesPerRepo = values.maxQueriesPerRepo ? Number(values.maxQueriesPerRepo) : 50;
  const version = values.version ?? '0.1.0';

  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as ExternalRepoManifest;
  const repos = Array.isArray(manifest.repos) ? manifest.repos : [];
  const requestedNames = values.repoNames
    ? values.repoNames.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const filteredRepos = requestedNames.length > 0
    ? repos.filter((repo) => requestedNames.includes(repo.name))
    : repos;
  const slice = typeof maxRepos === 'number' && maxRepos > 0 ? filteredRepos.slice(0, maxRepos) : filteredRepos;
  const linkRoot = await ensureSymlinkRoot(reposRoot);

  const results: Array<{ repo: string; queries: number; files: number; warnings?: string[] }> = [];

  for (const repo of slice) {
    const repoRoot = path.join(reposRoot, repo.name);
    await stat(repoRoot);
    const { corpus, sampledFileCount } = await generateBoundedCorpusForRepo(
      repoRoot,
      repo.name,
      maxSourceFilesPerRepo,
      maxQueriesPerRepo
    );
    const language = normalizeLanguage(repo.language);
    const exportResult = exportStructuralGroundTruth({
      corpus,
      repoMeta: {
        repoId: repo.name,
        name: repo.name,
        languages: language ? [language] : ['Unknown'],
        hasTests: repo.hasTests,
        fileCount: sampledFileCount,
      },
      version,
      verifiedBy: 'librarian:external-ground-truth',
      lastVerified: repo.verifiedAt,
    });

    const evalRoot = path.join(repoRoot, '.librarian-eval');
    await mkdir(evalRoot, { recursive: true });
    await writeFile(
      path.join(evalRoot, 'manifest.json'),
      `${JSON.stringify(exportResult.manifest, null, 2)}\n`,
      'utf8'
    );
    await writeFile(
      path.join(evalRoot, 'ground-truth.json'),
      `${JSON.stringify({ version: exportResult.version, repoId: exportResult.repoId, queries: exportResult.queries }, null, 2)}\n`,
      'utf8'
    );

    await ensureSymlink(repoRoot, path.join(linkRoot, repo.name));
    const warnings = exportResult.queries.length === 0
      ? ['no_ground_truth_generated']
      : undefined;
    results.push({ repo: repo.name, queries: exportResult.queries.length, files: sampledFileCount, warnings });
  }

  console.log(JSON.stringify({ repos: results.length, results }, null, 2));
}

await run();
