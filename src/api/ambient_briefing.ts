import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { estimateTokens } from './token_budget.js';

const execFileAsync = promisify(execFile);

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_FILE_RE = /(^|\/)__tests__\/|\.test\.[a-z]+$|\.spec\.[a-z]+$/i;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.librarian', '.tmp']);

const TIER_BUDGETS = {
  micro: 200,
  standard: 500,
  deep: 2000,
} as const;

const TIER_LIMITS = {
  micro: { conventions: 2, dependsOn: 2, dependedOnBy: 2, recentChanges: 1, tests: 2, files: 120 },
  standard: { conventions: 4, dependsOn: 6, dependedOnBy: 6, recentChanges: 5, tests: 6, files: 500 },
  deep: { conventions: 8, dependsOn: 12, dependedOnBy: 12, recentChanges: 10, tests: 12, files: 1500 },
} as const;

export type AmbientBriefingTier = 'micro' | 'standard' | 'deep';

export interface AmbientBriefing {
  scope: string;
  tier: AmbientBriefingTier;
  tokenBudget: number;
  tokenCount: number;
  purpose: string;
  conventions: string[];
  dependencies: {
    dependsOn: string[];
    dependedOnBy: string[];
  };
  recentChanges: string[];
  testCoverage: {
    relatedTests: string[];
    sourceFileCount: number;
    testFileCount: number;
    coverageSignal: string;
  };
  markdown: string;
}

export interface GenerateAmbientBriefingInput {
  workspaceRoot: string;
  scopePath?: string;
  tier?: AmbientBriefingTier;
  maxTokens?: number;
}

function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

function normalizeTier(tier: AmbientBriefingTier | undefined): AmbientBriefingTier {
  if (!tier) return 'standard';
  return tier;
}

function stripExtension(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, '');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_FILE_RE.test(filePath) && !TEST_FILE_RE.test(filePath);
}

function isTestFile(filePath: string): boolean {
  return SOURCE_FILE_RE.test(filePath) && TEST_FILE_RE.test(filePath);
}

function parseImports(content: string): string[] {
  const imports: string[] = [];
  const staticImportRe = /from\s+['"]([^'"]+)['"]/g;
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const regex of [staticImportRe, dynamicImportRe, requireRe]) {
    for (let match = regex.exec(content); match !== null; match = regex.exec(content)) {
      if (match[1]) imports.push(match[1]);
    }
  }
  return imports;
}

async function walkFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  async function walk(currentPath: string): Promise<void> {
    if (files.length >= maxFiles) return;
    let stats;
    try {
      stats = await stat(currentPath);
    } catch {
      return;
    }
    if (stats.isDirectory()) {
      const base = path.basename(currentPath);
      if (IGNORED_DIRS.has(base)) return;
      const children = await readdir(currentPath);
      for (const child of children) {
        if (files.length >= maxFiles) break;
        await walk(path.join(currentPath, child));
      }
      return;
    }
    if (!stats.isFile()) return;
    const relative = toPosix(path.relative(root, currentPath));
    if (!SOURCE_FILE_RE.test(relative)) return;
    files.push(relative);
  }
  await walk(root);
  return uniqueSorted(files);
}

async function collectScopeFiles(
  workspaceRoot: string,
  scopePath: string,
  maxFiles: number,
): Promise<string[]> {
  const absoluteScope = path.resolve(workspaceRoot, scopePath);
  let scopeStats;
  try {
    scopeStats = await stat(absoluteScope);
  } catch {
    return [];
  }
  if (scopeStats.isFile()) {
    const relative = toPosix(path.relative(workspaceRoot, absoluteScope));
    return SOURCE_FILE_RE.test(relative) ? [relative] : [];
  }
  if (!scopeStats.isDirectory()) return [];
  const scoped = await walkFiles(absoluteScope, maxFiles);
  return scoped.map((filePath) => toPosix(path.join(toPosix(scopePath), filePath)));
}

function collectCandidateImportFragments(scopeFiles: string[]): string[] {
  const fragments = new Set<string>();
  for (const file of scopeFiles) {
    const noExt = stripExtension(file);
    const base = path.basename(noExt);
    if (base.length > 0) fragments.add(base);
    if (noExt.length > 0) fragments.add(noExt);
    const pathWithoutSrc = noExt.replace(/^src\//, '');
    if (pathWithoutSrc.length > 0) fragments.add(pathWithoutSrc);
  }
  return uniqueSorted(fragments);
}

function summarizePurpose(scope: string, sourceFiles: string[], exportCount: number): string {
  const normalizedScope = toPosix(scope);
  if (sourceFiles.length === 0) {
    return `No source files detected for ${normalizedScope}.`;
  }
  if (sourceFiles.length === 1) {
    return `${normalizedScope} centers around one source file with ${exportCount} detected export signatures.`;
  }
  return `${normalizedScope} spans ${sourceFiles.length} source files with ${exportCount} detected export signatures across the scope.`;
}

function inferConventions(
  scope: string,
  sourceFiles: string[],
  testFiles: string[],
  sampleContents: string[],
  tier: AmbientBriefingTier,
): string[] {
  const conventions: string[] = [];
  conventions.push(`Keep edits scoped to ${toPosix(scope)} and preserve existing module boundaries.`);
  if (sourceFiles.every((file) => file.endsWith('.ts') || file.endsWith('.tsx'))) {
    conventions.push('TypeScript-first patterns dominate this scope (prefer typed APIs over untyped shortcuts).');
  }
  if (testFiles.length > 0) {
    conventions.push(`Related tests exist (${testFiles.length}); update/add tests alongside behavior changes.`);
  }
  const combined = sampleContents.join('\n');
  if (/\bCliError\b|\bConstructionError\b|\bAppAuthError\b/.test(combined)) {
    conventions.push('Use existing typed error classes rather than introducing generic Error paths.');
  }
  if (/\basync\b/.test(combined)) {
    conventions.push('Async flows are common here; preserve await/error handling behavior when modifying control flow.');
  }
  return conventions.slice(0, TIER_LIMITS[tier].conventions);
}

async function readRecentChanges(
  workspaceRoot: string,
  scopePath: string,
  maxItems: number,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--date=short', '--pretty=format:%h %ad %s', '-n', String(maxItems), '--', scopePath],
      { cwd: workspaceRoot },
    );
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.slice(0, maxItems);
  } catch {
    return [];
  }
}

function buildCoverageSignal(sourceCount: number, testCount: number): string {
  if (sourceCount === 0) return 'No source files in scope.';
  const ratio = testCount / sourceCount;
  if (ratio >= 1) return `${testCount} related test files for ${sourceCount} source files (strong local coverage signal).`;
  if (ratio >= 0.5) return `${testCount} related test files for ${sourceCount} source files (moderate local coverage signal).`;
  if (testCount > 0) return `${testCount} related test files for ${sourceCount} source files (light local coverage signal).`;
  return `No related tests detected for ${sourceCount} source files.`;
}

function renderAmbientBriefingMarkdown(briefing: Omit<AmbientBriefing, 'tokenCount' | 'markdown'>): string {
  const dependsOnText = briefing.dependencies.dependsOn.length > 0
    ? briefing.dependencies.dependsOn.map((entry) => `- Depends on: \`${entry}\``).join('\n')
    : '- Depends on: none detected from import statements.';
  const dependedOnByText = briefing.dependencies.dependedOnBy.length > 0
    ? briefing.dependencies.dependedOnBy.map((entry) => `- Depended on by: \`${entry}\``).join('\n')
    : '- Depended on by: none detected in scanned workspace imports.';
  const recentChangesText = briefing.recentChanges.length > 0
    ? briefing.recentChanges.map((entry) => `- ${entry}`).join('\n')
    : '- No recent git commits found for this scope.';
  const testFilesText = briefing.testCoverage.relatedTests.length > 0
    ? briefing.testCoverage.relatedTests.map((entry) => `- \`${entry}\``).join('\n')
    : '- No related test files detected.';

  return [
    `# Ambient Briefing: ${briefing.scope}`,
    '',
    '## Module purpose',
    briefing.purpose,
    '',
    '## Active conventions',
    ...briefing.conventions.map((entry) => `- ${entry}`),
    '',
    '## Dependency context',
    dependsOnText,
    dependedOnByText,
    '',
    '## Recent changes',
    recentChangesText,
    '',
    '## Test coverage',
    `- ${briefing.testCoverage.coverageSignal}`,
    testFilesText,
  ].join('\n');
}

function trimToBudget(
  briefing: Omit<AmbientBriefing, 'tokenCount' | 'markdown'>,
  budget: number,
): AmbientBriefing {
  const mutable = {
    ...briefing,
    conventions: [...briefing.conventions],
    dependencies: {
      dependsOn: [...briefing.dependencies.dependsOn],
      dependedOnBy: [...briefing.dependencies.dependedOnBy],
    },
    recentChanges: [...briefing.recentChanges],
    testCoverage: {
      ...briefing.testCoverage,
      relatedTests: [...briefing.testCoverage.relatedTests],
    },
  };

  for (let i = 0; i < 80; i += 1) {
    const markdown = renderAmbientBriefingMarkdown(mutable);
    const tokenCount = estimateTokens(markdown);
    if (tokenCount <= budget) {
      return { ...mutable, tokenCount, markdown };
    }
    if (mutable.recentChanges.length > 0) {
      mutable.recentChanges.pop();
      continue;
    }
    if (mutable.dependencies.dependedOnBy.length > 0) {
      mutable.dependencies.dependedOnBy.pop();
      continue;
    }
    if (mutable.dependencies.dependsOn.length > 0) {
      mutable.dependencies.dependsOn.pop();
      continue;
    }
    if (mutable.testCoverage.relatedTests.length > 0) {
      mutable.testCoverage.relatedTests.pop();
      mutable.testCoverage.coverageSignal = buildCoverageSignal(
        mutable.testCoverage.sourceFileCount,
        mutable.testCoverage.relatedTests.length,
      );
      continue;
    }
    if (mutable.conventions.length > 1) {
      mutable.conventions.pop();
      continue;
    }
    if (mutable.purpose.length > 90) {
      mutable.purpose = `${mutable.purpose.slice(0, Math.max(80, Math.floor(mutable.purpose.length * 0.7))).trim()}...`;
      continue;
    }
    return { ...mutable, tokenCount, markdown };
  }

  const markdown = renderAmbientBriefingMarkdown(mutable);
  return { ...mutable, tokenCount: estimateTokens(markdown), markdown };
}

export function selectAmbientBriefingTierForQuery(
  depth: 'L0' | 'L1' | 'L2' | 'L3' | undefined,
  packCount: number,
): AmbientBriefingTier {
  if (depth === 'L0') return 'micro';
  if (depth === 'L3' || packCount >= 12) return 'deep';
  return 'standard';
}

export async function generateAmbientBriefing(
  input: GenerateAmbientBriefingInput,
): Promise<AmbientBriefing> {
  const tier = normalizeTier(input.tier);
  const limits = TIER_LIMITS[tier];
  const defaultBudget = TIER_BUDGETS[tier];
  const tokenBudget = input.maxTokens && Number.isFinite(input.maxTokens)
    ? Math.max(80, Math.min(4000, Math.trunc(input.maxTokens)))
    : defaultBudget;
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const rawScope = input.scopePath ?? '.';
  const scopePath = toPosix(path.relative(workspaceRoot, path.resolve(workspaceRoot, rawScope))) || '.';

  const scopeFilesRaw = await collectScopeFiles(workspaceRoot, rawScope, limits.files);
  const scopeFiles = scopeFilesRaw.filter((file) => SOURCE_FILE_RE.test(file));
  const sourceFiles = scopeFiles.filter((file) => isSourceFile(file));
  const scopeTests = scopeFiles.filter((file) => isTestFile(file));

  const workspaceFiles = await walkFiles(workspaceRoot, limits.files);
  const workspaceSourceFiles = workspaceFiles.filter((file) => isSourceFile(file));
  const workspaceTestFiles = workspaceFiles.filter((file) => isTestFile(file));

  const sampleContents: string[] = [];
  let exportCount = 0;
  const dependsOnImports: string[] = [];
  for (const file of sourceFiles.slice(0, 24)) {
    try {
      const content = await readFile(path.join(workspaceRoot, file), 'utf8');
      sampleContents.push(content.slice(0, 3000));
      exportCount += (content.match(/\bexport\s+(async\s+)?(function|const|class|type|interface)\b/g) ?? []).length;
      dependsOnImports.push(...parseImports(content));
    } catch {
      // Ignore per-file read failures and continue with partial evidence.
    }
  }

  const dependencyImportFragments = collectCandidateImportFragments(sourceFiles);
  const dependedOnBy: string[] = [];
  for (const file of workspaceSourceFiles.slice(0, limits.files)) {
    if (sourceFiles.includes(file)) continue;
    try {
      const content = await readFile(path.join(workspaceRoot, file), 'utf8');
      const isReferencingScope = dependencyImportFragments.some((fragment) => {
        if (!fragment || fragment.length < 3) return false;
        return content.includes(`'${fragment}'`)
          || content.includes(`"${fragment}"`)
          || content.includes(`/${fragment}'`)
          || content.includes(`/${fragment}"`);
      });
      if (isReferencingScope) dependedOnBy.push(file);
    } catch {
      // Ignore per-file read failures.
    }
  }

  const scopeBasenames = new Set(sourceFiles.map((file) => path.basename(stripExtension(file))));
  const relatedTests = uniqueSorted([
    ...scopeTests,
    ...workspaceTestFiles.filter((testFile) => {
      const normalized = stripExtension(path.basename(testFile)).toLowerCase();
      for (const base of scopeBasenames) {
        if (!base) continue;
        if (normalized.includes(base.toLowerCase())) return true;
      }
      const scopeDir = sourceFiles[0] ? path.dirname(sourceFiles[0]) : scopePath;
      return toPosix(testFile).startsWith(`${toPosix(scopeDir)}/`);
    }),
  ]);

  const conventions = inferConventions(scopePath, sourceFiles, relatedTests, sampleContents, tier);
  if (conventions.length === 0) {
    conventions.push('No strong local conventions inferred; mirror nearby files before introducing new patterns.');
  }

  const recentChanges = await readRecentChanges(workspaceRoot, scopePath, limits.recentChanges);
  const dependsOn = uniqueSorted(dependsOnImports)
    .filter((entry) => entry.length > 0)
    .slice(0, limits.dependsOn);
  const dependedOnByLimited = uniqueSorted(dependedOnBy).slice(0, limits.dependedOnBy);
  const relatedTestsLimited = relatedTests.slice(0, limits.tests);

  const base = {
    scope: scopePath,
    tier,
    tokenBudget,
    purpose: summarizePurpose(scopePath, sourceFiles, exportCount),
    conventions: conventions.slice(0, limits.conventions),
    dependencies: {
      dependsOn,
      dependedOnBy: dependedOnByLimited,
    },
    recentChanges,
    testCoverage: {
      relatedTests: relatedTestsLimited,
      sourceFileCount: sourceFiles.length,
      testFileCount: relatedTests.length,
      coverageSignal: buildCoverageSignal(sourceFiles.length, relatedTests.length),
    },
  };

  return trimToBudget(base, tokenBudget);
}
