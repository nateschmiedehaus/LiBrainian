/**
 * @fileoverview Codebase Profiler
 *
 * Analyzes a repository and produces a quality profile used by other
 * components to adapt Librarian's behavior based on codebase characteristics.
 *
 * Features:
 * - Size metrics: file count, line count, language breakdown
 * - Complexity metrics: functions per file, classes per file, nesting depth
 * - Quality indicators: tests, types, linting, CI, documentation
 * - Structure indicators: monorepo detection, workspaces, entry points
 * - Risk indicators: large files, complex functions, circular dependencies
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASTFactExtractor, createASTFactExtractor } from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Size metrics for a codebase
 */
export interface SizeMetrics {
  /** Total number of source files */
  totalFiles: number;
  /** Total lines of code */
  totalLines: number;
  /** Language breakdown: language name -> file count */
  languages: Record<string, number>;
}

/**
 * Complexity metrics for a codebase
 */
export interface ComplexityMetrics {
  /** Average number of functions per file */
  averageFunctionsPerFile: number;
  /** Average number of classes per file */
  averageClassesPerFile: number;
  /** Maximum file size in lines */
  maxFileSize: number;
  /** Deepest nesting level found */
  deepestNesting: number;
}

/**
 * Quality indicators for a codebase
 */
export interface QualityIndicators {
  /** Whether the codebase has tests */
  hasTests: boolean;
  /** Test coverage percentage if detectable */
  testCoverage?: number;
  /** Whether the codebase uses TypeScript */
  hasTypeScript: boolean;
  /** Whether the codebase has linting configured */
  hasLinting: boolean;
  /** Whether the codebase has CI configured */
  hasCI: boolean;
  /** Documentation score from 0.0 to 1.0 */
  documentationScore: number;
}

/**
 * Structure indicators for a codebase
 */
export interface StructureIndicators {
  /** Whether the codebase is a monorepo */
  isMonorepo: boolean;
  /** Whether the codebase has workspaces configured */
  hasWorkspaces: boolean;
  /** Entry point files (main, index, etc.) */
  entryPoints: string[];
  /** Configuration files found */
  configFiles: string[];
}

/**
 * Risk indicators for a codebase
 */
export interface RiskIndicators {
  /** Files over the size threshold */
  largeFiles: string[];
  /** Functions with high cyclomatic complexity */
  complexFunctions: string[];
  /** Whether circular dependencies were detected */
  circularDependencies: boolean;
  /** Whether outdated dependencies were detected */
  outdatedDependencies: boolean;
}

/**
 * Size classification for a codebase
 */
export type SizeClassification = 'small' | 'medium' | 'large' | 'monorepo';

/**
 * Quality tier for a codebase
 */
export type QualityTier = 'high' | 'medium' | 'low';

/**
 * Complete profile of a codebase
 */
export interface CodebaseProfile {
  /** Path to the repository */
  repoPath: string;
  /** When the analysis was performed */
  analyzedAt: string;

  /** Size metrics */
  size: SizeMetrics;
  /** Complexity metrics */
  complexity: ComplexityMetrics;
  /** Quality indicators */
  quality: QualityIndicators;
  /** Structure indicators */
  structure: StructureIndicators;
  /** Risk indicators */
  risks: RiskIndicators;

  /** Overall size classification */
  classification: SizeClassification;
  /** Overall quality tier */
  qualityTier: QualityTier;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Threshold for large files (lines) */
const LARGE_FILE_THRESHOLD = 500;

/** LOC thresholds for classification */
const SMALL_LOC_THRESHOLD = 10000;
const MEDIUM_LOC_THRESHOLD = 100000;
const LARGE_LOC_THRESHOLD = 1000000;

/** File extensions to language mapping */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.php': 'PHP',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.md': 'Markdown',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
};

/** Directories to ignore */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  '.idea',
  '.vscode',
  '.cache',
  'vendor',
]);

/** Test directory/file patterns */
const TEST_PATTERNS = ['test', 'tests', '__tests__', 'spec', 'specs', '__specs__'];

/** Test file patterns */
const TEST_FILE_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '.tests.', '.specs.'];

// ============================================================================
// CODEBASE PROFILER CLASS
// ============================================================================

/**
 * Analyzes codebases and produces quality profiles
 */
export class CodebaseProfiler {
  private astExtractor: ASTFactExtractor;

  constructor() {
    this.astExtractor = createASTFactExtractor();
  }

  /**
   * Profile a repository completely
   */
  async profile(repoPath: string): Promise<CodebaseProfile> {
    const analyzedAt = new Date().toISOString();

    // Run all analyses in parallel where possible
    const [size, complexity, quality, structure, risks] = await Promise.all([
      this.getSizeMetrics(repoPath),
      this.analyzeComplexity(repoPath),
      this.assessQuality(repoPath),
      this.analyzeStructure(repoPath),
      this.identifyRisks(repoPath),
    ]);

    const classification = this.classifySize(size.totalLines, structure.hasWorkspaces);
    const qualityTier = this.determineQualityTier(quality);

    return {
      repoPath,
      analyzedAt,
      size,
      complexity,
      quality,
      structure,
      risks,
      classification,
      qualityTier,
    };
  }

  /**
   * Count total files in a repository
   */
  async countFiles(repoPath: string): Promise<number> {
    if (!this.directoryExists(repoPath)) {
      return 0;
    }

    let count = 0;
    this.walkDirectory(repoPath, () => {
      count++;
    });

    return count;
  }

  /**
   * Count total lines in a repository
   */
  async countLines(repoPath: string): Promise<number> {
    if (!this.directoryExists(repoPath)) {
      return 0;
    }

    let totalLines = 0;
    this.walkDirectory(repoPath, (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        totalLines += content.split('\n').length;
      } catch {
        // Skip files we can't read
      }
    });

    return totalLines;
  }

  /**
   * Detect languages used in a repository
   */
  async detectLanguages(repoPath: string): Promise<Record<string, number>> {
    if (!this.directoryExists(repoPath)) {
      return {};
    }

    const languages: Record<string, number> = {};

    this.walkDirectory(repoPath, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const language = EXTENSION_TO_LANGUAGE[ext];

      if (language) {
        languages[language] = (languages[language] || 0) + 1;
      }
    });

    return languages;
  }

  /**
   * Analyze complexity metrics of a repository
   */
  async analyzeComplexity(repoPath: string): Promise<ComplexityMetrics> {
    if (!this.directoryExists(repoPath)) {
      return {
        averageFunctionsPerFile: 0,
        averageClassesPerFile: 0,
        maxFileSize: 0,
        deepestNesting: 0,
      };
    }

    let totalFunctions = 0;
    let totalClasses = 0;
    let fileCount = 0;
    let maxFileSize = 0;
    let deepestNesting = 0;

    // Get TypeScript/JavaScript files for AST analysis
    const tsFiles: string[] = [];
    this.walkDirectory(repoPath, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext) && !filePath.endsWith('.d.ts')) {
        tsFiles.push(filePath);
      }

      // Track max file size for all files
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').length;
        if (lines > maxFileSize) {
          maxFileSize = lines;
        }

        // Estimate nesting depth by counting indentation
        const nestingDepth = this.estimateNestingDepth(content);
        if (nestingDepth > deepestNesting) {
          deepestNesting = nestingDepth;
        }
      } catch {
        // Skip files we can't read
      }
    });

    // Use AST extractor for function/class counts
    for (const file of tsFiles) {
      try {
        const facts = await this.astExtractor.extractFromFile(file);
        const functions = facts.filter((f) => f.type === 'function_def');
        const classes = facts.filter((f) => f.type === 'class');

        totalFunctions += functions.length;
        totalClasses += classes.length;
        fileCount++;
      } catch {
        // Skip files that can't be parsed
      }
    }

    return {
      averageFunctionsPerFile: fileCount > 0 ? totalFunctions / fileCount : 0,
      averageClassesPerFile: fileCount > 0 ? totalClasses / fileCount : 0,
      maxFileSize,
      deepestNesting,
    };
  }

  /**
   * Assess quality indicators of a repository
   */
  async assessQuality(repoPath: string): Promise<QualityIndicators> {
    if (!this.directoryExists(repoPath)) {
      return {
        hasTests: false,
        hasTypeScript: false,
        hasLinting: false,
        hasCI: false,
        documentationScore: 0,
      };
    }

    const hasTests = this.detectTests(repoPath);
    const hasTypeScript = this.detectTypeScript(repoPath);
    const hasLinting = this.detectLinting(repoPath);
    const hasCI = this.detectCI(repoPath);
    const documentationScore = this.calculateDocumentationScore(repoPath);

    return {
      hasTests,
      hasTypeScript,
      hasLinting,
      hasCI,
      documentationScore,
    };
  }

  /**
   * Analyze structure of a repository
   */
  async analyzeStructure(repoPath: string): Promise<StructureIndicators> {
    if (!this.directoryExists(repoPath)) {
      return {
        isMonorepo: false,
        hasWorkspaces: false,
        entryPoints: [],
        configFiles: [],
      };
    }

    const hasWorkspaces = this.detectWorkspaces(repoPath);
    const isMonorepo = this.detectMonorepo(repoPath);
    const entryPoints = this.findEntryPoints(repoPath);
    const configFiles = this.findConfigFiles(repoPath);

    return {
      isMonorepo: isMonorepo || hasWorkspaces,
      hasWorkspaces,
      entryPoints,
      configFiles,
    };
  }

  /**
   * Identify risks in a repository
   */
  async identifyRisks(repoPath: string): Promise<RiskIndicators> {
    if (!this.directoryExists(repoPath)) {
      return {
        largeFiles: [],
        complexFunctions: [],
        circularDependencies: false,
        outdatedDependencies: false,
      };
    }

    const largeFiles = this.findLargeFiles(repoPath);
    const complexFunctions = await this.findComplexFunctions(repoPath);
    const circularDependencies = false; // Would require more sophisticated analysis
    const outdatedDependencies = this.detectOutdatedDependencies(repoPath);

    return {
      largeFiles,
      complexFunctions,
      circularDependencies,
      outdatedDependencies,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private directoryExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private walkDirectory(dirPath: string, callback: (filePath: string) => void): void {
    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            callback(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    walk(dirPath);
  }

  private async getSizeMetrics(repoPath: string): Promise<SizeMetrics> {
    const [totalFiles, totalLines, languages] = await Promise.all([
      this.countFiles(repoPath),
      this.countLines(repoPath),
      this.detectLanguages(repoPath),
    ]);

    return { totalFiles, totalLines, languages };
  }

  private estimateNestingDepth(content: string): number {
    let maxDepth = 0;
    const lines = content.split('\n');

    for (const line of lines) {
      // Count leading spaces/tabs as an approximation
      const match = line.match(/^(\s*)/);
      if (match) {
        const indent = match[1];
        // Estimate depth: 2 spaces or 1 tab = 1 level
        const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
        if (depth > maxDepth) {
          maxDepth = depth;
        }
      }
    }

    return Math.min(maxDepth, 20); // Cap at reasonable level
  }

  private detectTests(repoPath: string): boolean {
    // Check for test directories
    for (const pattern of TEST_PATTERNS) {
      const testDir = path.join(repoPath, pattern);
      if (fs.existsSync(testDir)) {
        return true;
      }

      // Also check src/{pattern}
      const srcTestDir = path.join(repoPath, 'src', pattern);
      if (fs.existsSync(srcTestDir)) {
        return true;
      }
    }

    // Check for test files
    let hasTestFiles = false;
    this.walkDirectory(repoPath, (filePath) => {
      const basename = path.basename(filePath);
      for (const pattern of TEST_FILE_PATTERNS) {
        if (basename.includes(pattern)) {
          hasTestFiles = true;
        }
      }
    });

    return hasTestFiles;
  }

  private detectTypeScript(repoPath: string): boolean {
    // Check for tsconfig.json
    const tsconfigPaths = [
      path.join(repoPath, 'tsconfig.json'),
      path.join(repoPath, 'tsconfig.base.json'),
    ];

    for (const tsconfig of tsconfigPaths) {
      if (fs.existsSync(tsconfig)) {
        return true;
      }
    }

    // Check for .ts files
    let hasTs = false;
    this.walkDirectory(repoPath, (filePath) => {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        hasTs = true;
      }
    });

    return hasTs;
  }

  private detectLinting(repoPath: string): boolean {
    const lintConfigs = [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js',
      'eslint.config.mjs',
      '.prettierrc',
      '.prettierrc.js',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      'prettier.config.js',
      '.stylelintrc',
      'biome.json',
      'deno.json',
      'deno.jsonc',
    ];

    for (const config of lintConfigs) {
      if (fs.existsSync(path.join(repoPath, config))) {
        return true;
      }
    }

    // Check package.json for eslint/prettier dependencies
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (allDeps.eslint || allDeps.prettier || allDeps.biome || allDeps['@biomejs/biome']) {
          return true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    return false;
  }

  private detectCI(repoPath: string): boolean {
    const ciPaths = [
      path.join(repoPath, '.github', 'workflows'),
      path.join(repoPath, '.gitlab-ci.yml'),
      path.join(repoPath, 'Jenkinsfile'),
      path.join(repoPath, '.circleci'),
      path.join(repoPath, '.travis.yml'),
      path.join(repoPath, 'azure-pipelines.yml'),
      path.join(repoPath, 'bitbucket-pipelines.yml'),
      path.join(repoPath, '.buildkite'),
    ];

    for (const ciPath of ciPaths) {
      if (fs.existsSync(ciPath)) {
        return true;
      }
    }

    return false;
  }

  private calculateDocumentationScore(repoPath: string): number {
    let score = 0;
    let maxScore = 0;

    // Check for README
    maxScore += 0.3;
    const readmes = ['README.md', 'README', 'readme.md', 'Readme.md'];
    for (const readme of readmes) {
      if (fs.existsSync(path.join(repoPath, readme))) {
        score += 0.3;
        break;
      }
    }

    // Check for docs directory
    maxScore += 0.2;
    const docsDirs = ['docs', 'doc', 'documentation', 'wiki'];
    for (const docsDir of docsDirs) {
      if (fs.existsSync(path.join(repoPath, docsDir))) {
        score += 0.2;
        break;
      }
    }

    // Check for CONTRIBUTING
    maxScore += 0.1;
    if (
      fs.existsSync(path.join(repoPath, 'CONTRIBUTING.md')) ||
      fs.existsSync(path.join(repoPath, 'CONTRIBUTING'))
    ) {
      score += 0.1;
    }

    // Check for CHANGELOG
    maxScore += 0.1;
    if (
      fs.existsSync(path.join(repoPath, 'CHANGELOG.md')) ||
      fs.existsSync(path.join(repoPath, 'CHANGELOG')) ||
      fs.existsSync(path.join(repoPath, 'HISTORY.md'))
    ) {
      score += 0.1;
    }

    // Check for LICENSE
    maxScore += 0.1;
    if (
      fs.existsSync(path.join(repoPath, 'LICENSE')) ||
      fs.existsSync(path.join(repoPath, 'LICENSE.md')) ||
      fs.existsSync(path.join(repoPath, 'license'))
    ) {
      score += 0.1;
    }

    // Sample JSDoc/docstring coverage
    maxScore += 0.2;
    const docCoverage = this.sampleDocCoverage(repoPath);
    score += docCoverage * 0.2;

    return Math.min(score / maxScore, 1.0);
  }

  private sampleDocCoverage(repoPath: string): number {
    // Sample a few files and check for documentation
    const sourceFiles: string[] = [];
    this.walkDirectory(repoPath, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext)) {
        sourceFiles.push(filePath);
      }
    });

    if (sourceFiles.length === 0) return 0;

    // Sample up to 10 files
    const sampled = sourceFiles.slice(0, 10);
    let documented = 0;

    for (const file of sampled) {
      try {
        const content = fs.readFileSync(file, 'utf-8');

        // Check for JSDoc or docstrings
        if (
          content.includes('/**') ||
          content.includes("'''") ||
          content.includes('"""') ||
          content.includes('@param') ||
          content.includes('@returns') ||
          content.includes(':param') ||
          content.includes(':return')
        ) {
          documented++;
        }
      } catch {
        // Skip unreadable files
      }
    }

    return sampled.length > 0 ? documented / sampled.length : 0;
  }

  private detectWorkspaces(repoPath: string): boolean {
    // Check package.json for workspaces
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.workspaces) {
          return true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for pnpm-workspace.yaml
    if (fs.existsSync(path.join(repoPath, 'pnpm-workspace.yaml'))) {
      return true;
    }

    // Check for lerna.json
    if (fs.existsSync(path.join(repoPath, 'lerna.json'))) {
      return true;
    }

    // Check for rush.json
    if (fs.existsSync(path.join(repoPath, 'rush.json'))) {
      return true;
    }

    // Check for nx.json
    if (fs.existsSync(path.join(repoPath, 'nx.json'))) {
      return true;
    }

    // Check for turborepo
    if (fs.existsSync(path.join(repoPath, 'turbo.json'))) {
      return true;
    }

    return false;
  }

  private detectMonorepo(repoPath: string): boolean {
    // Check for packages/ directory
    if (fs.existsSync(path.join(repoPath, 'packages'))) {
      return true;
    }

    // Check for apps/ directory (common in monorepos)
    if (fs.existsSync(path.join(repoPath, 'apps'))) {
      return true;
    }

    // Check for multiple package.json files
    let packageJsonCount = 0;
    this.walkDirectory(repoPath, (filePath) => {
      if (path.basename(filePath) === 'package.json') {
        packageJsonCount++;
      }
    });

    return packageJsonCount > 3;
  }

  private findEntryPoints(repoPath: string): string[] {
    const entryPoints: string[] = [];

    // Common entry point patterns
    const patterns = [
      'src/index.ts',
      'src/index.js',
      'src/main.ts',
      'src/main.js',
      'index.ts',
      'index.js',
      'main.ts',
      'main.js',
      'lib/index.ts',
      'lib/index.js',
      'app/index.ts',
      'app/index.js',
      'src/app.ts',
      'src/app.js',
      'app.ts',
      'app.js',
    ];

    for (const pattern of patterns) {
      const fullPath = path.join(repoPath, pattern);
      if (fs.existsSync(fullPath)) {
        entryPoints.push(pattern);
      }
    }

    // Check package.json main/module fields
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.main && !entryPoints.includes(packageJson.main)) {
          entryPoints.push(packageJson.main);
        }
        if (packageJson.module && !entryPoints.includes(packageJson.module)) {
          entryPoints.push(packageJson.module);
        }
      } catch {
        // Ignore parse errors
      }
    }

    return entryPoints;
  }

  private findConfigFiles(repoPath: string): string[] {
    const configFiles: string[] = [];

    const configPatterns = [
      'package.json',
      'tsconfig.json',
      'tsconfig.base.json',
      '.eslintrc.js',
      '.eslintrc.json',
      'eslint.config.js',
      'eslint.config.mjs',
      '.prettierrc',
      '.prettierrc.json',
      'prettier.config.js',
      'biome.json',
      'vitest.config.ts',
      'vitest.config.js',
      'jest.config.ts',
      'jest.config.js',
      'webpack.config.js',
      'vite.config.ts',
      'vite.config.js',
      'rollup.config.js',
      'babel.config.js',
      '.babelrc',
      'deno.json',
      'deno.jsonc',
      'Cargo.toml',
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Gemfile',
      'go.mod',
      'Makefile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'Dockerfile',
    ];

    for (const pattern of configPatterns) {
      const fullPath = path.join(repoPath, pattern);
      if (fs.existsSync(fullPath)) {
        configFiles.push(pattern);
      }
    }

    return configFiles;
  }

  private findLargeFiles(repoPath: string): string[] {
    const largeFiles: string[] = [];

    this.walkDirectory(repoPath, (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').length;

        if (lines > LARGE_FILE_THRESHOLD) {
          // Store relative path
          largeFiles.push(path.relative(repoPath, filePath));
        }
      } catch {
        // Skip files we can't read
      }
    });

    return largeFiles;
  }

  private async findComplexFunctions(repoPath: string): Promise<string[]> {
    const complexFunctions: string[] = [];

    // Get all TS/JS files
    const tsFiles: string[] = [];
    this.walkDirectory(repoPath, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext) && !filePath.endsWith('.d.ts')) {
        tsFiles.push(filePath);
      }
    });

    // Analyze each file for complex functions (simplified heuristic)
    for (const file of tsFiles.slice(0, 50)) {
      // Limit to 50 files for performance
      try {
        const facts = await this.astExtractor.extractFunctions(file);

        for (const fact of facts) {
          // Heuristic: functions with many parameters or in large files are complex
          const details = fact.details as { parameters?: unknown[] };
          if (details.parameters && details.parameters.length > 5) {
            const relPath = path.relative(repoPath, fact.file);
            complexFunctions.push(`${relPath}:${fact.identifier}`);
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return complexFunctions;
  }

  private detectOutdatedDependencies(repoPath: string): boolean {
    // Check for lock file age or known outdated patterns
    const lockFiles = [
      path.join(repoPath, 'package-lock.json'),
      path.join(repoPath, 'yarn.lock'),
      path.join(repoPath, 'pnpm-lock.yaml'),
    ];

    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        try {
          const stats = fs.statSync(lockFile);
          const ageMs = Date.now() - stats.mtime.getTime();
          const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);

          // If lock file is older than 6 months, consider deps potentially outdated
          if (ageMonths > 6) {
            return true;
          }
        } catch {
          // Ignore stat errors
        }
      }
    }

    return false;
  }

  private classifySize(totalLines: number, hasWorkspaces: boolean): SizeClassification {
    if (hasWorkspaces) {
      return 'monorepo';
    }

    if (totalLines >= LARGE_LOC_THRESHOLD) {
      return 'monorepo';
    }

    if (totalLines >= MEDIUM_LOC_THRESHOLD) {
      return 'large';
    }

    if (totalLines >= SMALL_LOC_THRESHOLD) {
      return 'medium';
    }

    return 'small';
  }

  private determineQualityTier(quality: QualityIndicators): QualityTier {
    let score = 0;

    // Tests are important
    if (quality.hasTests) score += 3;

    // TypeScript adds type safety
    if (quality.hasTypeScript) score += 2;

    // Linting maintains code quality
    if (quality.hasLinting) score += 2;

    // CI ensures continuous quality
    if (quality.hasCI) score += 2;

    // Documentation helps maintainability
    score += quality.documentationScore * 2;

    // Max possible: 3 + 2 + 2 + 2 + 2 = 11
    if (score >= 8) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CodebaseProfiler instance
 */
export function createCodebaseProfiler(): CodebaseProfiler {
  return new CodebaseProfiler();
}
