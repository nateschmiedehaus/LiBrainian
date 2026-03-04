import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { sha256Hex } from '../spine/hashes.js';
import type {
  ConventionCategory,
  ConventionRecord,
  ConventionRuleType,
  ConventionSource,
  LibrarianStorage,
} from '../storage/types.js';

export interface ConventionMiningOptions {
  workspace: string;
  storage: LibrarianStorage;
  now?: Date;
  maxFiles?: number;
}

export interface ConventionMiningReport {
  total: number;
  categories: Partial<Record<ConventionCategory, number>>;
  sources: Partial<Record<ConventionSource, number>>;
}

interface SourceFileInfo {
  relativePath: string;
  absolutePath: string;
  topLevel: string;
  content: string;
  imports: string[];
}

const SOURCE_GLOB = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js'];
const SOURCE_GLOB_IGNORE = [
  '**/__tests__/**',
  '**/*.d.ts',
  '**/dist/**',
  '**/node_modules/**',
  '**/coverage/**',
];

export async function rebuildConventionRegistry(options: ConventionMiningOptions): Promise<ConventionMiningReport> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const files = await collectSourceFiles(options.workspace, options.maxFiles);

  const mined = [
    ...detectImportPatterns(files, nowIso),
    ...detectMiddlewareChains(files, nowIso),
    ...detectFileNamingPatterns(files, nowIso),
    ...detectTestNamingPatterns(files, nowIso),
    ...detectDependencyDirectionPatterns(files, nowIso),
  ];
  const docConventions = await extractInstructionConventions(options.workspace, nowIso);

  await options.storage.deleteConventionsBySource('mined');
  await options.storage.deleteConventionsBySource('agents_md');
  if (mined.length > 0) {
    await options.storage.upsertConventions(mined);
  }
  if (docConventions.length > 0) {
    await options.storage.upsertConventions(docConventions);
  }

  const total = mined.length + docConventions.length;
  const categories: Partial<Record<ConventionCategory, number>> = {};
  for (const record of [...mined, ...docConventions]) {
    categories[record.category] = (categories[record.category] ?? 0) + 1;
  }
  return {
    total,
    categories,
    sources: {
      mined: mined.length,
      agents_md: docConventions.length,
    },
  };
}

async function collectSourceFiles(workspace: string, maxFiles?: number): Promise<SourceFileInfo[]> {
  const entries = await glob(SOURCE_GLOB, {
    cwd: workspace,
    ignore: SOURCE_GLOB_IGNORE,
    nodir: true,
    absolute: false,
  });
  const limited = typeof maxFiles === 'number' ? entries.slice(0, maxFiles) : entries;
  const files: SourceFileInfo[] = [];
  for (const relativePath of limited) {
    const absolutePath = path.join(workspace, relativePath);
    let content: string;
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    files.push({
      relativePath: normalizePosix(relativePath),
      absolutePath,
      topLevel: getTopLevel(relativePath),
      content,
      imports: extractImports(content),
    });
  }
  return files;
}

function detectImportPatterns(files: SourceFileInfo[], nowIso: string): ConventionRecord[] {
  const perDirTotals = new Map<string, number>();
  const perDirCounts = new Map<string, Map<string, { count: number; files: string[] }>>();

  for (const file of files) {
    if (!file.relativePath.startsWith('src/')) continue;
    const top = file.topLevel;
    if (!top) continue;
    perDirTotals.set(top, (perDirTotals.get(top) ?? 0) + 1);
    const dirMap = perDirCounts.get(top) ?? new Map();
    perDirCounts.set(top, dirMap);

    const seen = new Set<string>();
    for (const spec of file.imports) {
      const normalized = normalizeImportPath(file.relativePath, spec);
      if (!normalized) continue;
      seen.add(normalized);
    }
    for (const normalized of seen) {
      const stat = dirMap.get(normalized) ?? { count: 0, files: [] as string[] };
      stat.count++;
      if (stat.files.length < 10) {
        stat.files.push(file.relativePath);
      }
      dirMap.set(normalized, stat);
    }
  }

  const conventions: ConventionRecord[] = [];
  for (const [dir, stats] of perDirCounts) {
    const total = perDirTotals.get(dir) ?? 0;
    if (total < 8) continue;
    for (const [importPath, stat] of stats) {
      const ratio = stat.count / total;
      if (ratio < 0.25 || stat.count < 5) continue;
      conventions.push(createConventionRecord({
        name: `Common import in ${dir}`,
        category: 'import_pattern',
        ruleType: ratio >= 0.6 ? 'always' : 'prefer',
        pattern: {
          kind: 'import_presence',
          directories: [`src/${dir}`],
          importPath,
          minRatio: Number(ratio.toFixed(2)),
        },
        evidenceCount: stat.count,
        totalCount: total,
        confidence: Number(ratio.toFixed(2)),
        description: `${stat.count}/${total} ${dir} files import ${importPath}`,
        source: 'mined',
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
    }
  }
  return conventions;
}

function detectMiddlewareChains(files: SourceFileInfo[], nowIso: string): ConventionRecord[] {
  const apiFiles = files.filter((file) => file.relativePath.startsWith('src/api/') && !file.relativePath.includes('__tests__/'));
  const total = apiFiles.length;
  if (total < 10) return [];

  const counts = new Map<string, number>();
  for (const file of apiFiles) {
    const seen = new Set<string>();
    for (const spec of file.imports) {
      const normalized = normalizeImportPath(file.relativePath, spec);
      if (!normalized) continue;
      seen.add(normalized);
    }
    for (const normalized of seen) {
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  const ranked = Array.from(counts.entries())
    .filter(([, count]) => count / total >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (ranked.length === 0) return [];
  const required = ranked.map(([importPath, count]) => ({
    importPath,
    ratio: Number((count / total).toFixed(2)),
  }));
  const confidence = Math.min(...required.map((entry) => entry.ratio));
  return [
    createConventionRecord({
      name: 'API middleware imports',
      category: 'middleware',
      ruleType: confidence >= 0.5 ? 'always' : 'prefer',
      pattern: {
        kind: 'middleware_chain',
        directories: ['src/api'],
        importPaths: required.map((entry) => entry.importPath),
      },
      evidenceCount: Math.round(confidence * total),
      totalCount: total,
      confidence,
      description: `Top API files import ${required.map((entry) => entry.importPath).join(', ')}`,
      source: 'mined',
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  ];
}

function detectFileNamingPatterns(files: SourceFileInfo[], nowIso: string): ConventionRecord[] {
  const targetFiles = files.filter((file) =>
    file.relativePath.startsWith('src/constructions/processes/') && !file.relativePath.includes('__tests__/'));
  if (targetFiles.length < 5) return [];

  const counts: Record<'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case', number> = {
    camelCase: 0,
    PascalCase: 0,
    snake_case: 0,
    'kebab-case': 0,
  };
  for (const file of targetFiles) {
    const name = path.posix.basename(file.relativePath).replace(/\.[^.]+$/, '');
    counts[inferNameStyle(name)]++;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [style, count] = sorted[0];
  if (!count || count < 5) return [];
  const ratio = Number((count / targetFiles.length).toFixed(2));

  return [
    createConventionRecord({
      name: 'Process file naming style',
      category: 'naming',
      ruleType: ratio >= 0.7 ? 'always' : 'prefer',
      pattern: {
        kind: 'naming_style',
        appliesTo: 'file',
        style: style as 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case',
        directories: ['src/constructions/processes'],
      },
      evidenceCount: count,
      totalCount: targetFiles.length,
      confidence: ratio,
      description: `${count}/${targetFiles.length} process files use ${style}`,
      source: 'mined',
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  ];
}

function detectTestNamingPatterns(files: SourceFileInfo[], nowIso: string): ConventionRecord[] {
  const testFiles = files.filter((file) => file.relativePath.includes('__tests__/'));
  if (testFiles.length < 5) return [];

  const suffixCounts = new Map<string, number>();
  for (const file of testFiles) {
    const suffix = extractTestSuffix(file.relativePath);
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
  }
  const ranked = Array.from(suffixCounts.entries()).sort((a, b) => b[1] - a[1]);
  const [suffix, count] = ranked[0];
  const ratio = Number((count / testFiles.length).toFixed(2));
  if (count < 3) return [];

  return [
    createConventionRecord({
      name: 'Test file naming',
      category: 'file_structure',
      ruleType: ratio >= 0.6 ? 'always' : 'prefer',
      pattern: {
        kind: 'file_structure',
        testSuffix: suffix,
        colocated: false,
        directories: ['src'],
      },
      evidenceCount: count,
      totalCount: testFiles.length,
      confidence: ratio,
      description: `${count}/${testFiles.length} tests use ${suffix}`,
      source: 'mined',
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  ];
}

function detectDependencyDirectionPatterns(files: SourceFileInfo[], nowIso: string): ConventionRecord[] {
  const edges = new Map<string, number>();
  const layerTotals = new Map<string, number>();

  for (const file of files) {
    if (!file.relativePath.startsWith('src/')) continue;
    layerTotals.set(file.topLevel, (layerTotals.get(file.topLevel) ?? 0) + 1);
    for (const spec of file.imports) {
      const normalized = normalizeImportPath(file.relativePath, spec);
      if (!normalized || !normalized.startsWith('src/')) continue;
      const targetLayer = getTopLevel(normalized);
      if (!targetLayer) continue;
      const key = `${file.topLevel}->${targetLayer}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  const conventions: ConventionRecord[] = [];
  const layers = ['storage', 'adapters', 'api', 'cli', 'constructions', 'epistemics', 'integration', 'strategic'];
  for (const from of layers) {
    for (const to of layers) {
      if (from === to) continue;
      const forward = edges.get(`${from}->${to}`) ?? 0;
      const reverse = edges.get(`${to}->${from}`) ?? 0;
      if (forward === 0 && reverse === 0) continue;
      if (reverse > 0) continue;
      const total = layerTotals.get(to) ?? 0;
      if (total < 5) continue;
      conventions.push(createConventionRecord({
        name: `${to} layer avoids ${from}`,
        category: 'architecture',
        ruleType: 'never',
        pattern: {
          kind: 'dependency_direction',
          fromLayer: to,
          toLayer: from,
          relation: 'never',
        },
        evidenceCount: total,
        totalCount: total,
        confidence: 1,
        description: `${to} files never import ${from}`,
        source: 'mined',
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
    }
  }
  return conventions;
}

async function extractInstructionConventions(workspace: string, nowIso: string): Promise<ConventionRecord[]> {
  const targets = ['AGENTS.md', 'CLAUDE.md'];
  const conventions: ConventionRecord[] = [];
  for (const file of targets) {
    const absolute = path.join(workspace, file);
    let content: string;
    try {
      content = await fs.readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    let added = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) continue;
      const text = trimmed.slice(2).trim();
      if (text.length < 12) continue;
      const id = sha256Hex(`doc:${file}:${text}`);
      conventions.push(createConventionRecord({
        name: `Instruction: ${text.slice(0, 48)}`,
        category: 'documentation',
        ruleType: 'always',
        pattern: {
          kind: 'document_rule',
          keywords: text.split(/\s+/).slice(0, 12),
          sourceFile: file,
        },
        evidenceCount: 1,
        totalCount: 1,
        confidence: 1,
        description: text,
        source: 'agents_md',
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
      added++;
      if (added >= 12) break;
    }
  }
  return conventions;
}

function createConventionRecord(input: {
  name: string;
  category: ConventionCategory;
  ruleType: ConventionRuleType;
  pattern: ConventionRecord['pattern'];
  evidenceCount: number;
  totalCount: number;
  confidence: number;
  description: string;
  source: ConventionSource;
  createdAt: string;
  updatedAt: string;
}): ConventionRecord {
  return {
    id: sha256Hex(`${input.category}:${input.ruleType}:${JSON.stringify(input.pattern)}:${input.description}`),
    name: input.name,
    category: input.category,
    ruleType: input.ruleType,
    pattern: input.pattern,
    evidenceCount: input.evidenceCount,
    totalCount: input.totalCount,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    exceptions: [],
    source: input.source,
    description: input.description,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function normalizeImportPath(filePath: string, specifier: string): string | null {
  const normalizedSpecifier = normalizePosix(specifier);
  if (normalizedSpecifier.startsWith('.')) {
    const sourceDir = path.posix.dirname(normalizePosix(filePath));
    return path.posix.normalize(path.posix.join(sourceDir, normalizedSpecifier));
  }
  if (normalizedSpecifier.startsWith('src/')) {
    return path.posix.normalize(normalizedSpecifier);
  }
  return null;
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const importRegex = /import\s+(?:[\s\S]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  return Array.from(imports);
}

function normalizePosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function getTopLevel(relativePath: string): string {
  const normalized = normalizePosix(relativePath);
  const parts = normalized.split('/');
  if (parts[0] === 'src') {
    return parts[1] ?? 'src';
  }
  return parts[0];
}

function inferNameStyle(name: string): 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' {
  if (name.includes('-')) return 'kebab-case';
  if (name.includes('_')) return 'snake_case';
  if (name[0] === name[0]?.toUpperCase()) return 'PascalCase';
  return 'camelCase';
}

function extractTestSuffix(relativePath: string): string {
  const base = path.posix.basename(relativePath);
  const match = base.match(/(\.test\.[^.]+|\.spec\.[^.]+|_test\.[^.]+)$/i);
  return match ? match[1] : path.extname(base) || '.test.ts';
}
