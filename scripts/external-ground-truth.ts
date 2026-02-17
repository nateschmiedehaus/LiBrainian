import { parseArgs } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createASTFactExtractor } from '../src/evaluation/ast_fact_extractor.js';
import { createGroundTruthGenerator } from '../src/evaluation/ground_truth_generator.js';
import { exportStructuralGroundTruth } from '../src/evaluation/ground_truth_export.js';

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

async function countSourceFiles(repoRoot: string): Promise<number> {
  const files = await walkFiles(repoRoot);
  return files.length;
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
      maxRepos: { type: 'string' },
      version: { type: 'string' },
    },
    strict: false,
  });

  const reposRoot = values.reposRoot ?? path.join(process.cwd(), 'eval-corpus', 'external-repos');
  const manifestPath = values.manifest ?? path.join(reposRoot, 'manifest.json');
  const maxRepos = values.maxRepos ? Number(values.maxRepos) : undefined;
  const version = values.version ?? '0.1.0';

  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as ExternalRepoManifest;
  const repos = Array.isArray(manifest.repos) ? manifest.repos : [];
  const slice = typeof maxRepos === 'number' && maxRepos > 0 ? repos.slice(0, maxRepos) : repos;

  const extractor = createASTFactExtractor({ includeExtensions: Array.from(SOURCE_EXTENSIONS) });
  const generator = createGroundTruthGenerator(extractor);
  const linkRoot = await ensureSymlinkRoot(reposRoot);

  const results: Array<{ repo: string; queries: number; files: number; warnings?: string[] }> = [];

  for (const repo of slice) {
    const repoRoot = path.join(reposRoot, repo.name);
    await stat(repoRoot);
    const corpus = await generator.generateForRepo(repoRoot, repo.name);
    const fileCount = await countSourceFiles(repoRoot);
    const language = normalizeLanguage(repo.language);
    const exportResult = exportStructuralGroundTruth({
      corpus,
      repoMeta: {
        repoId: repo.name,
        name: repo.name,
        languages: language ? [language] : ['Unknown'],
        hasTests: repo.hasTests,
        fileCount,
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
    results.push({ repo: repo.name, queries: exportResult.queries.length, files: fileCount, warnings });
  }

  console.log(JSON.stringify({ repos: results.length, results }, null, 2));
}

await run();
