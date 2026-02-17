import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execa } from 'execa';
import { getLanguageFromPath } from '../utils/language.js';
import { getGrammarCacheRoot, getGrammarRequirePaths, getLibrarianPackageRoot } from '../utils/grammar_cache.js';
import { getTreeSitterLanguageConfigs } from '../agents/parsers/tree_sitter_parser.js';
import { getFileCategory, isExcluded } from '../universal_patterns.js';
import { detectPackageManager } from '../api/supply_chain_template.js';

const require = createRequire(import.meta.url);
const TS_MORPH_LANGUAGES = new Set(['typescript', 'javascript']);
const GRAMMAR_VERSION_OVERRIDES: Record<string, string> = {
  // 0.6.x frequently fails to build in modern Node toolchains due a stale tree-sitter-cli hook.
  'tree-sitter-swift': '0.7.1',
};

export interface LanguageScanResult {
  workspace: string;
  languageCounts: Record<string, number>;
  unknownExtensions: Record<string, number>;
  totalFiles: number;
  truncated: boolean;
  errors: string[];
}

export interface GrammarCoverage {
  workspace: string;
  languagesDetected: string[];
  languageCounts: Record<string, number>;
  unknownExtensions: Record<string, number>;
  supportedByTsMorph: string[];
  supportedByTreeSitter: string[];
  missingLanguageConfigs: string[];
  missingGrammarModules: string[];
  missingTreeSitterCore: boolean;
  totalFiles: number;
  truncated: boolean;
  errors: string[];
}

export interface GrammarInstallResult {
  attempted: boolean;
  success: boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | null;
  packages: string[];
  error?: string;
}

export interface GrammarInstallOptions {
  stdio?: 'inherit' | 'ignore';
}

export interface GrammarCoverageOptions {
  maxFiles?: number;
  resolveModule?: (moduleName: string) => boolean;
}

function prependPathSegment(existing: string | undefined, segment: string): string {
  if (!existing || existing.trim().length === 0) {
    return segment;
  }
  const parts = existing.split(path.delimiter).map((part) => part.trim()).filter(Boolean);
  if (parts.includes(segment)) {
    return existing;
  }
  return [segment, ...parts].join(path.delimiter);
}

function buildGrammarInstallEnv(cacheRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const tempRoot = path.join(cacheRoot, '.tmp');
  if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
  }
  env.TMPDIR = tempRoot;

  if (process.platform === 'darwin') {
    const sdkCandidates = [
      process.env.SDKROOT?.trim(),
      '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
      '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
    ].filter((candidate): candidate is string => Boolean(candidate && candidate.length > 0));
    const sdkRoot = sdkCandidates.find((candidate) => fs.existsSync(candidate));
    if (sdkRoot) {
      env.SDKROOT = sdkRoot;
      const cxxHeaders = path.join(sdkRoot, 'usr', 'include', 'c++', 'v1');
      if (fs.existsSync(cxxHeaders)) {
        env.CPLUS_INCLUDE_PATH = prependPathSegment(env.CPLUS_INCLUDE_PATH, cxxHeaders);
      }
    }
  }

  return env;
}

export async function scanWorkspaceLanguages(
  workspace: string,
  options: GrammarCoverageOptions = {}
): Promise<LanguageScanResult> {
  const languageCounts: Record<string, number> = {};
  const unknownExtensions: Record<string, number> = {};
  const errors: string[] = [];
  const maxFiles = options.maxFiles ?? 20000;
  let totalFiles = 0;
  let truncated = false;

  try {
    const stats = await fsp.stat(workspace);
    if (!stats.isDirectory()) {
      return { workspace, languageCounts, unknownExtensions, totalFiles, truncated, errors: ['workspace_not_directory'] };
    }
  } catch (error) {
    return { workspace, languageCounts, unknownExtensions, totalFiles, truncated, errors: [String(error)] };
  }

  const queue: string[] = [workspace];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      errors.push(String(error));
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(workspace, fullPath).replace(/\\/g, '/');
      if (!relative || isExcluded(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const category = getFileCategory(relative);
      if (category !== 'code' && category !== 'tests') continue;
      totalFiles += 1;
      if (totalFiles > maxFiles) {
        truncated = true;
        break;
      }
      const language = getLanguageFromPath(fullPath, 'unknown');
      if (language === 'unknown' || language === 'text') {
        const ext = path.extname(entry.name).toLowerCase() || 'unknown';
        unknownExtensions[ext] = (unknownExtensions[ext] ?? 0) + 1;
      } else {
        languageCounts[language] = (languageCounts[language] ?? 0) + 1;
      }
    }
    if (truncated) break;
  }

  return { workspace, languageCounts, unknownExtensions, totalFiles, truncated, errors };
}

export function assessGrammarCoverage(
  scan: LanguageScanResult,
  options: GrammarCoverageOptions = {}
): GrammarCoverage {
  const configs = getTreeSitterLanguageConfigs();
  const configByLanguage = new Map(configs.map((config) => [config.language, config]));
  const extraPaths = getGrammarRequirePaths();
  const resolveModule = options.resolveModule ?? ((moduleName: string) => {
    try {
      require.resolve(moduleName);
      return true;
    } catch {
      for (const extraPath of extraPaths) {
        try {
          require.resolve(moduleName, { paths: [extraPath] });
          return true;
        } catch {
          // keep trying
        }
      }
      return false;
    }
  });

  const languagesDetected = Object.keys(scan.languageCounts).sort();
  const supportedByTsMorph: string[] = [];
  const supportedByTreeSitter: string[] = [];
  const missingLanguageConfigs: string[] = [];
  const missingGrammarModules = new Set<string>();
  const treeSitterCoreAvailable = resolveModule('tree-sitter');

  for (const language of languagesDetected) {
    if (TS_MORPH_LANGUAGES.has(language)) {
      supportedByTsMorph.push(language);
      continue;
    }
    const config = configByLanguage.get(language);
    if (!config) {
      missingLanguageConfigs.push(language);
      continue;
    }
    if (!treeSitterCoreAvailable) {
      missingGrammarModules.add(config.grammarModule);
      continue;
    }
    if (!resolveModule(config.grammarModule)) {
      missingGrammarModules.add(config.grammarModule);
      continue;
    }
    supportedByTreeSitter.push(language);
  }

  return {
    workspace: scan.workspace,
    languagesDetected,
    languageCounts: scan.languageCounts,
    unknownExtensions: scan.unknownExtensions,
    supportedByTsMorph,
    supportedByTreeSitter,
    missingLanguageConfigs: missingLanguageConfigs.sort(),
    missingGrammarModules: Array.from(missingGrammarModules.values()).sort(),
    missingTreeSitterCore: !treeSitterCoreAvailable && (missingGrammarModules.size > 0 || supportedByTreeSitter.length > 0),
    totalFiles: scan.totalFiles,
    truncated: scan.truncated,
    errors: scan.errors,
  };
}

export function getMissingGrammarPackages(coverage: GrammarCoverage): string[] {
  const packages = new Set(coverage.missingGrammarModules);
  const requiresTreeSitter = coverage.languagesDetected.some((language) => !TS_MORPH_LANGUAGES.has(language));
  if (requiresTreeSitter && coverage.missingTreeSitterCore) {
    packages.add('tree-sitter');
  }
  return Array.from(packages.values()).sort();
}

export async function installMissingGrammars(
  workspace: string,
  coverage: GrammarCoverage,
  options: GrammarInstallOptions = {}
): Promise<GrammarInstallResult> {
  const packages = getMissingGrammarPackages(coverage);
  if (packages.length === 0) {
    return { attempted: false, success: true, packageManager: null, packages: [] };
  }

  // IMPORTANT: Do not mutate the target workspace's dependencies.
  // Install grammars into a Librarian-managed cache instead.
  void workspace;
  const cacheRoot = getGrammarCacheRoot();
  if (!fs.existsSync(cacheRoot)) {
    fs.mkdirSync(cacheRoot, { recursive: true });
  }

  // Prefer the versions pinned by the Librarian package (when available).
  const pinned: Record<string, string> = {};
  const pkgRoot = getLibrarianPackageRoot();
  if (pkgRoot) {
    try {
      const raw = fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { optionalDependencies?: Record<string, string> };
      if (parsed.optionalDependencies) {
        Object.assign(pinned, parsed.optionalDependencies);
      }
    } catch {
      // Best effort only.
    }
  }
  const specs = packages.map((pkg) => {
    const version = GRAMMAR_VERSION_OVERRIDES[pkg] ?? pinned[pkg];
    return version ? `${pkg}@${version}` : pkg;
  });

  // Use npm for cache installs (works even when workspace uses yarn/pnpm).
  const packageManager = 'npm' as const;
  const args = [
    'install',
    '--prefix',
    cacheRoot,
    '--no-save',
    '--legacy-peer-deps',
    ...specs,
  ];

  try {
    await execa(packageManager, args, {
      cwd: cacheRoot,
      stdio: options.stdio ?? 'inherit',
      env: buildGrammarInstallEnv(cacheRoot),
    });
    return { attempted: true, success: true, packageManager, packages: specs };
  } catch (error) {
    const details: string[] = [];
    if (error && typeof error === 'object') {
      const candidate = error as { shortMessage?: string; message?: string; stderr?: string };
      if (typeof candidate.shortMessage === 'string' && candidate.shortMessage.trim().length > 0) {
        details.push(candidate.shortMessage.trim());
      } else if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
        details.push(candidate.message.trim());
      }
      if (typeof candidate.stderr === 'string' && candidate.stderr.trim().length > 0) {
        const lines = candidate.stderr.trim().split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length > 0) {
          details.push(lines.slice(-3).join(' | '));
        }
      }
    }
    const message = details.length > 0 ? details.join(' :: ').slice(0, 1200) : String(error);
    return {
      attempted: true,
      success: false,
      packageManager,
      packages: specs,
      error: message,
    };
  }
}
