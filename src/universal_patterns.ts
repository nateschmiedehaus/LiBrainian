/**
 * @fileoverview Universal File Patterns for Comprehensive Codebase Indexing
 *
 * PHILOSOPHY: Index EVERYTHING meaningful. Exclude ONLY truly binary/generated
 * content. A world-class knowledge system requires complete codebase consciousness.
 *
 * Tests are knowledge. Configs are knowledge. Scripts are knowledge.
 * Documentation is knowledge. Tests are knowledge. Config is knowledge.
 */

// ============================================================================
// FILE CATEGORY DEFINITIONS
// ============================================================================

export type FileCategory =
  | 'code'        // Source code files (full AST + embeddings)
  | 'docs'        // Documentation (markdown parsing + embeddings)
  | 'config'      // Configuration (structured parsing + embeddings)
  | 'scripts'     // Shell/build scripts (command extraction)
  | 'infra'       // Infrastructure as code
  | 'ci'          // CI/CD pipelines
  | 'schema'      // Database/API schemas
  | 'tests'       // Test files (NEVER EXCLUDE)
  | 'styles'      // Stylesheets
  | 'meta'        // Project metadata
  | 'data'        // Data files
  | 'unknown';    // Fallback

export interface FileCategoryConfig {
  patterns: string[];
  parser: 'ast' | 'markdown' | 'structured' | 'shell' | 'text';
  embeddings: boolean;
  priority: 'high' | 'medium' | 'low';
  description: string;
}

// ============================================================================
// UNIVERSAL FILE PATTERNS
// ============================================================================

/**
 * Comprehensive file patterns for EVERY meaningful file type.
 */
export const UNIVERSAL_FILE_PATTERNS: Record<FileCategory, FileCategoryConfig> = {
  // -------------------------------------------------------------------------
  // CODE - Full AST parsing + embeddings (highest priority)
  // -------------------------------------------------------------------------
  code: {
    patterns: [
      // JavaScript/TypeScript ecosystem
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.mjs', '**/*.cjs', '**/*.mts', '**/*.cts',

      // Systems languages
      '**/*.go', '**/*.rs', '**/*.c', '**/*.cpp', '**/*.cc',
      '**/*.h', '**/*.hpp', '**/*.hh',

      // JVM languages
      '**/*.java', '**/*.kt', '**/*.kts', '**/*.scala', '**/*.groovy',
      '**/*.clj', '**/*.cljs', '**/*.cljc',

      // Scripting languages
      '**/*.py', '**/*.pyi', '**/*.pyw',
      '**/*.rb', '**/*.rake',
      '**/*.php', '**/*.phtml',
      '**/*.pl', '**/*.pm', '**/*.t',
      '**/*.lua',

      // Functional languages
      '**/*.hs', '**/*.lhs', '**/*.ml', '**/*.mli',
      '**/*.fs', '**/*.fsx', '**/*.fsi',
      '**/*.ex', '**/*.exs', '**/*.erl', '**/*.hrl',

      // Mobile
      '**/*.swift', '**/*.m', '**/*.mm',
      '**/*.dart',

      // Other
      '**/*.r', '**/*.R', '**/*.rmd',
      '**/*.cs', '**/*.vb',
      '**/*.zig', '**/*.nim', '**/*.v',
      '**/*.wat',
    ],
    parser: 'ast',
    embeddings: true,
    priority: 'high',
    description: 'Source code - full semantic analysis',
  },

  // -------------------------------------------------------------------------
  // TESTS - NEVER EXCLUDE (tests are knowledge)
  // -------------------------------------------------------------------------
  tests: {
    patterns: [
      '**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/*.test.jsx',
      '**/*.spec.ts', '**/*.spec.tsx', '**/*.spec.js', '**/*.spec.jsx',
      '**/__tests__/**/*',
      '**/*.test.py', '**/*.spec.py', '**/test_*.py',
      '**/*_test.go', '**/*_test.rs',
      '**/test/**/*', '**/tests/**/*', '**/spec/**/*',
      '**/*.feature', // Cucumber/Gherkin
    ],
    parser: 'ast',
    embeddings: true,
    priority: 'high',
    description: 'Test files - critical for understanding behavior',
  },

  // -------------------------------------------------------------------------
  // DOCUMENTATION
  // -------------------------------------------------------------------------
  docs: {
    patterns: [
      '**/*.md', '**/*.mdx', '**/*.markdown',
      '**/*.txt', '**/*.text',
      '**/*.rst', '**/*.rest',
      '**/*.adoc', '**/*.asciidoc',
      '**/README*', '**/CHANGELOG*', '**/CONTRIBUTING*',
      '**/LICENSE*', '**/AUTHORS*', '**/HISTORY*',
      '**/docs/**/*', '**/documentation/**/*',
    ],
    parser: 'markdown',
    embeddings: true,
    priority: 'high',
    description: 'Documentation - human knowledge capture',
  },

  // -------------------------------------------------------------------------
  // CONFIGURATION
  // -------------------------------------------------------------------------
  config: {
    patterns: [
      // JSON/YAML/TOML
      '**/*.json', '**/*.json5', '**/*.jsonc',
      '**/*.yaml', '**/*.yml',
      '**/*.toml',
      '**/*.ini', '**/*.cfg', '**/*.conf',

      // Dotfiles
      '**/.*rc', '**/.*rc.js', '**/.*rc.json', '**/.*rc.yaml',
      '**/.eslintrc*', '**/.prettierrc*', '**/.babelrc*',
      '**/.editorconfig', '**/.gitattributes', '**/.gitignore',
      '**/.npmrc', '**/.nvmrc', '**/.node-version',
      '**/.env.example', '**/.env.template', '**/.env.sample',

      // Package managers
      '**/package.json', '**/tsconfig*.json', '**/jsconfig*.json',
      '**/pyproject.toml', '**/setup.py', '**/setup.cfg',
      '**/Cargo.toml', '**/go.mod', '**/go.sum',
      '**/Gemfile', '**/requirements*.txt', '**/Pipfile',
      '**/composer.json', '**/pom.xml', '**/build.gradle*',

      // Tool configs
      '**/vitest.config.*', '**/jest.config.*', '**/playwright.config.*',
      '**/webpack.config.*', '**/vite.config.*', '**/rollup.config.*',
      '**/tailwind.config.*', '**/postcss.config.*',
    ],
    parser: 'structured',
    embeddings: true,
    priority: 'medium',
    description: 'Configuration - project behavior definition',
  },

  // -------------------------------------------------------------------------
  // SCRIPTS
  // -------------------------------------------------------------------------
  scripts: {
    patterns: [
      '**/*.sh', '**/*.bash', '**/*.zsh', '**/*.fish',
      '**/*.ps1', '**/*.psm1', '**/*.psd1', '**/*.bat', '**/*.cmd',
      '**/Makefile', '**/makefile', '**/GNUmakefile',
      '**/Taskfile*', '**/Justfile', '**/justfile',
      '**/Rakefile', '**/Guardfile',
      '**/scripts/**/*',
    ],
    parser: 'shell',
    embeddings: true,
    priority: 'medium',
    description: 'Scripts - automation knowledge',
  },

  // -------------------------------------------------------------------------
  // INFRASTRUCTURE
  // -------------------------------------------------------------------------
  infra: {
    patterns: [
      '**/Dockerfile*', '**/docker-compose*.yml', '**/docker-compose*.yaml',
      '**/*.dockerfile',
      '**/Vagrantfile',
      '**/*.tf', '**/*.tfvars', '**/*.hcl',
      '**/helm/**/*.yaml', '**/helm/**/*.yml',
      '**/kubernetes/**/*.yaml', '**/kubernetes/**/*.yml',
      '**/k8s/**/*.yaml', '**/k8s/**/*.yml',
      '**/*.nomad',
      '**/ansible/**/*.yml', '**/ansible/**/*.yaml',
      '**/pulumi/**/*',
    ],
    parser: 'structured',
    embeddings: true,
    priority: 'medium',
    description: 'Infrastructure as code',
  },

  // -------------------------------------------------------------------------
  // CI/CD
  // -------------------------------------------------------------------------
  ci: {
    patterns: [
      '**/.github/**/*.yml', '**/.github/**/*.yaml',
      '**/.gitlab-ci.yml', '**/.gitlab-ci.yaml',
      '**/.circleci/**/*',
      '**/Jenkinsfile*', '**/*.jenkinsfile',
      '**/.travis.yml', '**/.travis.yaml',
      '**/azure-pipelines*.yml', '**/azure-pipelines*.yaml',
      '**/.buildkite/**/*',
      '**/bitbucket-pipelines.yml',
      '**/.drone.yml',
    ],
    parser: 'structured',
    embeddings: true,
    priority: 'medium',
    description: 'CI/CD pipelines',
  },

  // -------------------------------------------------------------------------
  // SCHEMAS
  // -------------------------------------------------------------------------
  schema: {
    patterns: [
      '**/*.sql',
      '**/*.graphql', '**/*.gql',
      '**/*.proto', '**/*.proto3',
      '**/*.prisma',
      '**/*.avsc', '**/*.avro',
      '**/*.thrift',
      '**/schema/**/*',
      '**/*.xsd', '**/*.dtd',
      '**/*.json-schema.json', '**/*.schema.json',
      '**/openapi*.yaml', '**/openapi*.yml', '**/openapi*.json',
      '**/swagger*.yaml', '**/swagger*.yml', '**/swagger*.json',
    ],
    parser: 'structured',
    embeddings: true,
    priority: 'high',
    description: 'Data/API schemas',
  },

  // -------------------------------------------------------------------------
  // STYLES
  // -------------------------------------------------------------------------
  styles: {
    patterns: [
      '**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/*.styl',
      '**/*.module.css', '**/*.module.scss',
    ],
    parser: 'text',
    embeddings: false,
    priority: 'low',
    description: 'Stylesheets',
  },

  // -------------------------------------------------------------------------
  // META
  // -------------------------------------------------------------------------
  meta: {
    patterns: [
      '**/CODEOWNERS', '**/.mailmap',
      '**/SECURITY.md', '**/SECURITY.txt',
      '**/FUNDING.yml',
      '**/.all-contributorsrc',
    ],
    parser: 'text',
    embeddings: false,
    priority: 'low',
    description: 'Project metadata',
  },

  // -------------------------------------------------------------------------
  // DATA
  // -------------------------------------------------------------------------
  data: {
    patterns: [
      '**/*.csv', '**/*.tsv',
      '**/*.xml',
      '**/fixtures/**/*.json', '**/fixtures/**/*.yaml',
      '**/seeds/**/*', '**/seed/**/*',
    ],
    parser: 'structured',
    embeddings: false,
    priority: 'low',
    description: 'Data files',
  },

  // -------------------------------------------------------------------------
  // UNKNOWN
  // -------------------------------------------------------------------------
  unknown: {
    patterns: [],
    parser: 'text',
    embeddings: false,
    priority: 'low',
    description: 'Unrecognized files',
  },
};

// ============================================================================
// EXCLUSIONS (Minimal - only truly useless content)
// ============================================================================

export const UNIVERSAL_EXCLUDES = [
  // Package managers (generated)
  '**/node_modules/**',
  '**/bower_components/**',

  // Build outputs
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/target/**',

  // Version control
  '**/.git/**',

  // Coverage/Reports
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/htmlcov/**',

  // Binary/Compiled
  '**/*.min.js', '**/*.min.css',
  '**/*.map',
  '**/*.pyc', '**/*.pyo', '**/__pycache__/**',
  '**/*.class',
  '**/*.o', '**/*.obj', '**/*.a', '**/*.lib',
  '**/*.so', '**/*.dylib', '**/*.dll',
  '**/*.exe', '**/*.bin',

  // Lock files (derived, not source)
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/composer.lock',

  // Media (binary)
  '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.ico',
  '**/*.svg', '**/*.webp', '**/*.bmp',
  '**/*.mp3', '**/*.mp4', '**/*.wav', '**/*.avi',
  '**/*.pdf', '**/*.doc', '**/*.docx', '**/*.xls', '**/*.xlsx',
  '**/*.zip', '**/*.tar', '**/*.gz', '**/*.rar',
  '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.eot',

  // Temp/Cache (only exclude clearly generated caches, not workspace roots)
  '**/.cache/**',

  // Eval corpus and external test fixtures (should not pollute query results)
  '**/eval-corpus/**',
  '**/external-repos/**',
];

const globCache = new Map<string, RegExp>();

function globToRegex(pattern: string): RegExp {
  // Validate that pattern doesn't contain placeholder strings
  // which would be incorrectly expanded - THROW to prevent silent failures
  if (pattern.includes('__GLOBSTAR__') || pattern.includes('__STAR__') || pattern.includes('__QMARK__')) {
    throw new Error(`[librarian] Pattern contains reserved placeholder (possible injection): ${pattern.slice(0, 50)}`);
  }
  const withPlaceholders = pattern
    .replace(/\\/g, '/')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '__STAR__')
    .replace(/\?/g, '__QMARK__');
  const escaped = withPlaceholders.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/__STAR__/g, '[^/]*')
    .replace(/__QMARK__/g, '[^/]');
  try {
    return new RegExp(`^${expanded}$`);
  } catch (error) {
    console.warn(`[librarian] Failed to compile glob pattern: ${pattern.slice(0, 50)}, error: ${error}`);
    // Return a regex that matches nothing for malformed patterns
    return /(?!)/;
  }
}

function matchesGlob(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.toLowerCase();
  const cached = globCache.get(normalizedPattern);
  if (cached) return cached.test(value);
  const regex = globToRegex(normalizedPattern);
  globCache.set(normalizedPattern, regex);
  return regex.test(value);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all include patterns as a flat array.
 */
export function getAllIncludePatterns(): string[] {
  const patterns: string[] = [];
  for (const config of Object.values(UNIVERSAL_FILE_PATTERNS)) {
    patterns.push(...config.patterns);
  }
  return patterns;
}

/**
 * Determine the category of a file based on its path.
 */
export function getFileCategory(path: string): FileCategory {
  // Tests first (more specific)
  if (/\.(test|spec)\.[^.]+$/.test(path) || path.includes('__tests__') || /test_[^/]+$/.test(path)) {
    return 'tests';
  }

  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const fileName = path.split('/').pop()?.toLowerCase() ?? '';

  // Code
  if ([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
    'py', 'pyi', 'pyw',
    'go', 'rs',
    'c', 'h', 'cpp', 'cc', 'hpp', 'hh',
    'java', 'kt', 'kts', 'scala', 'groovy',
    'clj', 'cljs', 'cljc',
    'rb', 'rake',
    'php', 'phtml',
    'pl', 'pm', 't',
    'lua',
    'hs', 'lhs', 'ml', 'mli',
    'fs', 'fsx', 'fsi',
    'ex', 'exs', 'erl', 'hrl',
    'swift', 'm', 'mm',
    'dart',
    'r', 'rmd',
    'cs', 'vb',
    'zig', 'nim', 'v',
    'wasm', 'wat',
  ].includes(ext)) {
    return 'code';
  }

  // Docs
  if (['md', 'mdx', 'txt', 'rst', 'adoc'].includes(ext) || fileName.startsWith('readme') || fileName.startsWith('changelog') || path.includes('/docs/') || path.includes('/documentation/')) {
    return 'docs';
  }

  // Config
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'cfg'].includes(ext) || /rc$/.test(fileName) || fileName.endsWith('config')) {
    return 'config';
  }

  // Scripts
  if (['sh', 'bash', 'zsh', 'ps1', 'bat'].includes(ext) || fileName.includes('makefile')) {
    return 'scripts';
  }

  // Infra
  if (path.includes('docker') || ext === 'tf' || path.includes('kubernetes') || path.includes('k8s')) {
    return 'infra';
  }

  // CI
  if (path.includes('.github') || path.includes('.gitlab') || path.includes('jenkins') || path.includes('.circleci')) {
    return 'ci';
  }

  // Schema
  if (['sql', 'graphql', 'gql', 'proto', 'prisma'].includes(ext)) {
    return 'schema';
  }

  // Styles
  if (['css', 'scss', 'sass', 'less'].includes(ext)) {
    return 'styles';
  }

  // Meta
  if (['codeowners', 'security.md', 'security.txt', 'funding.yml'].includes(fileName)) {
    return 'meta';
  }

  // Data
  if (['csv', 'tsv', 'xml'].includes(ext) || path.includes('fixtures') || path.includes('seeds') || path.includes('seed')) {
    return 'data';
  }

  return 'unknown';
}

/**
 * Check if a file should have embeddings generated.
 */
export function shouldGenerateEmbeddings(path: string): boolean {
  const category = getFileCategory(path);
  const config = UNIVERSAL_FILE_PATTERNS[category];
  return config?.embeddings ?? false;
}

/**
 * Check if a file matches any exclusion pattern.
 */
export function isExcluded(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();

  for (const pattern of UNIVERSAL_EXCLUDES) {
    if (matchesGlob(normalized, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the parser type for a file.
 */
export function getParserType(path: string): FileCategoryConfig['parser'] {
  const category = getFileCategory(path);
  return UNIVERSAL_FILE_PATTERNS[category]?.parser ?? 'text';
}

/**
 * Get the priority for indexing a file.
 */
export function getFilePriority(path: string): FileCategoryConfig['priority'] {
  const category = getFileCategory(path);
  return UNIVERSAL_FILE_PATTERNS[category]?.priority ?? 'low';
}

// ============================================================================
// CONVENIENCE EXPORTS (API Surface)
// ============================================================================

/**
 * All include patterns as a flat array.
 * Pre-computed for performance and simpler API.
 */
export const INCLUDE_PATTERNS = getAllIncludePatterns();

/**
 * All exclude patterns.
 * Alias for cleaner API surface.
 */
export const EXCLUDE_PATTERNS = UNIVERSAL_EXCLUDES;

/**
 * Check if a file should have embeddings generated.
 * Alias for shouldGenerateEmbeddings with cleaner name.
 */
export const shouldEmbed = shouldGenerateEmbeddings;
