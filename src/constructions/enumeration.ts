/**
 * @fileoverview Enumeration Construction for Complete Entity Listing
 *
 * Provides exhaustive enumeration of codebase entities by category.
 * Unlike semantic search (top-k), this returns COMPLETE lists.
 *
 * Use cases:
 * - "List all CLI commands" -> Returns ALL 23 commands, not 4 semantic matches
 * - "How many test files exist?" -> Returns 417+ test files with full list
 * - "Enumerate all interfaces" -> Returns every interface from symbol table
 *
 * This module extends the partial enumeration capability in exhaustive_graph_query.ts
 * to handle general entity categories, not just dependency relationships.
 *
 * @example
 * ```typescript
 * const intent = detectEnumerationIntent("list all CLI commands");
 * // { isEnumeration: true, category: 'cli_command', queryType: 'list' }
 *
 * const result = await enumerateByCategory(storage, 'cli_command', workspace);
 * // Returns all 23 CLI command files with metadata
 * ```
 */

import { glob } from 'glob';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { LibrarianStorage } from '../storage/types.js';
import { createSymbolStorage } from '../storage/symbol_storage.js';

const DEFAULT_ENDPOINT_SCAN_MAX_FILES = 1000;
const DEFAULT_ENDPOINT_SCAN_MAX_FILES_TEST = 200;
const DEFAULT_ENDPOINT_SCAN_BUDGET_MS = 15000;
const DEFAULT_ENDPOINT_SCAN_BUDGET_MS_TEST = 5000;
const DEFAULT_ENDPOINT_CACHE_TTL_MS = 2 * 60 * 1000;

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUnitTestMode(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.LIBRARIAN_TEST_MODE === 'unit';
}

function getEndpointScanSettings(): {
  maxFiles: number;
  timeBudgetMs: number;
  cacheTtlMs: number;
  cacheEnabled: boolean;
} {
  const isUnit = isUnitTestMode();
  const maxFiles = Math.max(
    1,
    readEnvNumber(
      'LIBRARIAN_ENDPOINT_MAX_FILES',
      isUnit ? DEFAULT_ENDPOINT_SCAN_MAX_FILES_TEST : DEFAULT_ENDPOINT_SCAN_MAX_FILES
    )
  );
  const timeBudgetRaw = readEnvNumber(
    'LIBRARIAN_ENDPOINT_SCAN_BUDGET_MS',
    isUnit ? DEFAULT_ENDPOINT_SCAN_BUDGET_MS_TEST : DEFAULT_ENDPOINT_SCAN_BUDGET_MS
  );
  const timeBudgetMs = timeBudgetRaw <= 0 ? Number.POSITIVE_INFINITY : timeBudgetRaw;
  const cacheTtlMs = Math.max(0, readEnvNumber('LIBRARIAN_ENDPOINT_CACHE_TTL_MS', DEFAULT_ENDPOINT_CACHE_TTL_MS));
  const cacheEnabled = process.env.LIBRARIAN_ENDPOINT_CACHE_DISABLED !== '1' && cacheTtlMs > 0;
  return { maxFiles, timeBudgetMs, cacheTtlMs, cacheEnabled };
}

// ============================================================================
// PAGINATION & OPTIONS TYPES
// ============================================================================

/**
 * Options for paginated enumeration queries.
 */
export interface EnumerationOptions {
  /** Starting offset (0-indexed) */
  offset?: number;
  /** Maximum number of items to return */
  limit?: number;
  /** Field to sort by */
  sortBy?: 'name' | 'file' | 'line';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated result wrapper for enumeration queries.
 */
export interface PaginatedResult<T> {
  /** Items in the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current offset */
  offset: number;
  /** Current limit */
  limit: number;
  /** Whether more items exist beyond this page */
  hasMore: boolean;
}

// ============================================================================
// FRAMEWORK DETECTION TYPES
// ============================================================================

/**
 * Supported framework types for detection.
 * Named EnumerationFramework to avoid conflicts with auto_selector.Framework.
 */
export type EnumerationFramework =
  // Frontend frameworks
  | 'react'
  | 'vue'
  | 'angular'
  | 'svelte'
  // Backend frameworks
  | 'express'
  | 'nestjs'
  | 'fastify'
  | 'koa'
  | 'hapi'
  // Meta-frameworks
  | 'next'
  | 'nuxt'
  | 'gatsby'
  // Desktop
  | 'electron'
  // Unknown
  | 'unknown';

// ============================================================================
// FILTER OPTIONS TYPES
// ============================================================================

/**
 * Filter options for sub-category enumeration.
 * Allows filtering by visibility, modifiers, decorators, and location.
 */
export interface FilterOptions {
  /** Filter by export status */
  exported?: boolean;
  /** Filter by visibility modifier */
  visibility?: 'public' | 'private' | 'protected' | 'all';
  /** Filter by async modifier */
  isAsync?: boolean;
  /** Filter by static modifier */
  isStatic?: boolean;
  /** Filter by presence of decorators */
  hasDecorators?: boolean;
  /** Filter by specific decorator name */
  decoratorName?: string;
  /** Filter by exact file path */
  inFile?: string;
  /** Filter by directory prefix */
  inDirectory?: string;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported entity categories for enumeration.
 * Each category has a specific enumerator implementation.
 */
export type EnumerationCategory =
  | 'cli_command'      // CLI command files (src/cli/commands/*.ts)
  | 'test_file'        // Test files (**/*.test.ts, **/*.spec.ts)
  | 'interface'        // TypeScript interfaces
  | 'class'            // TypeScript/JavaScript classes
  | 'type_alias'       // TypeScript type aliases
  | 'function'         // Exported functions
  | 'config'           // Configuration files (*.config.ts, *.json)
  | 'endpoint'         // API endpoints
  | 'component'        // React/Vue/Svelte components
  | 'hook'             // React hooks (use*.ts)
  | 'constant'         // Exported constants
  | 'enum'             // TypeScript enums
  | 'module'           // Module files
  | 'documentation';   // Documentation files (*.md)

/**
 * Query types that trigger enumeration.
 */
export type EnumerationQueryType =
  | 'list'      // "list all X"
  | 'enumerate' // "enumerate X"
  | 'count'     // "how many X"
  | 'show_all'  // "show all X"
  | 'find_all'; // "find all X"

/**
 * Result of detecting enumeration intent from a query.
 */
export interface EnumerationIntent {
  /** Whether this query is an enumeration request */
  isEnumeration: boolean;
  /** The detected category to enumerate */
  category: EnumerationCategory | null;
  /** The type of enumeration query */
  queryType: EnumerationQueryType | null;
  /** Confidence in this classification (0-1) */
  confidence: number;
  /** The matched pattern if any */
  matchedPattern: string | null;
  /** Additional filter terms from the query */
  filters: string[];
}

/**
 * A single enumerated entity.
 */
export interface EnumeratedEntity {
  /** Unique identifier (file path or entity ID) */
  id: string;
  /** Display name */
  name: string;
  /** Full file path */
  filePath: string;
  /** Entity category */
  category: EnumerationCategory;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Line number if applicable */
  line?: number;
  /** Short description if available */
  description?: string;
}

type EndpointCacheEntry = { at: number; entities: EnumeratedEntity[] };
const endpointCache = new Map<string, EndpointCacheEntry>();

/**
 * Result of an enumeration query.
 */
export interface EnumerationResult {
  /** The category that was enumerated */
  category: EnumerationCategory;
  /** Total count of entities found */
  totalCount: number;
  /** All enumerated entities (COMPLETE list) */
  entities: EnumeratedEntity[];
  /** Entities grouped by directory */
  byDirectory: Map<string, EnumeratedEntity[]>;
  /** Query duration in milliseconds */
  durationMs: number;
  /** Human-readable explanation */
  explanation: string;
  /** Whether the results were truncated */
  truncated: boolean;
  /** Max entities limit if truncated */
  maxLimit?: number;
}

// ============================================================================
// INTENT DETECTION PATTERNS
// ============================================================================

/**
 * Category detection patterns mapping query terms to categories.
 */
const CATEGORY_PATTERNS: Array<{
  patterns: RegExp[];
  category: EnumerationCategory;
  aliases: string[];
}> = [
  {
    category: 'cli_command',
    aliases: ['cli command', 'command', 'cli', 'subcommand'],
    patterns: [
      /\bcli\s*commands?\b/i,
      /\bcommands?\b(?!\s*line)/i, // Avoid "command line"
      /\bsubcommands?\b/i,
    ],
  },
  {
    category: 'test_file',
    aliases: ['test file', 'test', 'spec', 'unit test', 'tests'],
    patterns: [
      /\btest\s*files?\b/i,
      /\btests?\b/i,
      /\bspec\s*files?\b/i,
      /\bunit\s*tests?\b/i,
    ],
  },
  {
    category: 'interface',
    aliases: ['interface', 'interfaces', 'type interface'],
    patterns: [
      /\binterfaces?\b/i,
      /\btype\s+interfaces?\b/i,
    ],
  },
  {
    category: 'class',
    aliases: ['class', 'classes'],
    patterns: [
      /\bclasses?\b/i,
    ],
  },
  {
    category: 'type_alias',
    aliases: ['type alias', 'type', 'types'],
    patterns: [
      /\btype\s*alias(?:es)?\b/i,
      /\btypes?\b(?!\s*(?:interface|script))/i,
    ],
  },
  {
    category: 'function',
    aliases: ['function', 'functions', 'method', 'methods'],
    patterns: [
      /\bfunctions?\b/i,
      /\bmethods?\b/i,
      /\bexported\s+functions?\b/i,
    ],
  },
  {
    category: 'config',
    aliases: ['config', 'configuration', 'config file'],
    patterns: [
      /\bconfig(?:uration)?\s*files?\b/i,
      /\bconfigs?\b/i,
      /\bsettings?\b/i,
    ],
  },
  {
    category: 'endpoint',
    aliases: ['endpoint', 'api endpoint', 'route', 'api'],
    patterns: [
      /\bendpoints?\b/i,
      /\bapi\s*endpoints?\b/i,
      /\broutes?\b/i,
      /\bapi\s*routes?\b/i,
    ],
  },
  {
    category: 'component',
    aliases: ['component', 'react component', 'vue component'],
    patterns: [
      /\bcomponents?\b/i,
      /\breact\s*components?\b/i,
      /\bvue\s*components?\b/i,
      /\bui\s*components?\b/i,
    ],
  },
  {
    category: 'hook',
    aliases: ['hook', 'react hook', 'custom hook'],
    patterns: [
      /\bhooks?\b/i,
      /\breact\s*hooks?\b/i,
      /\bcustom\s*hooks?\b/i,
    ],
  },
  {
    category: 'constant',
    aliases: ['constant', 'constants', 'const'],
    patterns: [
      /\bconstants?\b/i,
      /\bexported\s+constants?\b/i,
    ],
  },
  {
    category: 'enum',
    aliases: ['enum', 'enums', 'enumeration'],
    patterns: [
      /\benums?\b/i,
      /\benumerations?\b/i,
    ],
  },
  {
    category: 'module',
    aliases: ['module', 'modules'],
    patterns: [
      /\bmodules?\b/i,
    ],
  },
  {
    category: 'documentation',
    aliases: ['documentation', 'docs', 'doc file', 'readme'],
    patterns: [
      /\bdocumentation\b/i,
      /\bdocs?\b/i,
      /\bmarkdown\s*files?\b/i,
      /\breadme\b/i,
    ],
  },
];

/**
 * Query type detection patterns.
 */
const QUERY_TYPE_PATTERNS: Array<{
  patterns: RegExp[];
  queryType: EnumerationQueryType;
}> = [
  {
    queryType: 'list',
    patterns: [
      /\blist\s+(all\s+)?/i,
      /\bshow\s+(me\s+)?(a\s+)?list\b/i,
    ],
  },
  {
    queryType: 'enumerate',
    patterns: [
      /\benumerate\s+(all\s+)?/i,
    ],
  },
  {
    queryType: 'count',
    patterns: [
      /\bhow\s+many\b/i,
      /\bcount\s+(of\s+|all\s+)?/i,
      /\btotal\s+(number\s+of|count)/i,
      /\bnumber\s+of\b/i,
    ],
  },
  {
    queryType: 'show_all',
    patterns: [
      /\bshow\s+(me\s+)?all\b/i,
      /\bdisplay\s+all\b/i,
    ],
  },
  {
    queryType: 'find_all',
    patterns: [
      /\bfind\s+all\b/i,
      /\bget\s+all\b/i,
      /\bfetch\s+all\b/i,
    ],
  },
];

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Detect if a query is an enumeration request and extract the category.
 *
 * @param query - The user's query string
 * @returns Parsed enumeration intent
 *
 * @example
 * ```typescript
 * const intent = detectEnumerationIntent("list all CLI commands");
 * // { isEnumeration: true, category: 'cli_command', queryType: 'list', confidence: 0.95 }
 *
 * const intent2 = detectEnumerationIntent("how many test files");
 * // { isEnumeration: true, category: 'test_file', queryType: 'count', confidence: 0.9 }
 * ```
 */
export function detectEnumerationIntent(query: string): EnumerationIntent {
  if (!query || typeof query !== 'string') {
    return {
      isEnumeration: false,
      category: null,
      queryType: null,
      confidence: 0,
      matchedPattern: null,
      filters: [],
    };
  }

  const trimmedQuery = query.trim().toLowerCase();

  // First, detect query type
  let detectedQueryType: EnumerationQueryType | null = null;
  let queryTypeConfidence = 0;
  let queryTypePattern: string | null = null;

  for (const { patterns, queryType } of QUERY_TYPE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmedQuery)) {
        detectedQueryType = queryType;
        queryTypeConfidence = 0.8;
        queryTypePattern = pattern.source;
        break;
      }
    }
    if (detectedQueryType) break;
  }

  // Then, detect category
  let detectedCategory: EnumerationCategory | null = null;
  let categoryConfidence = 0;
  let categoryPattern: string | null = null;

  for (const { patterns, category } of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmedQuery)) {
        detectedCategory = category;
        categoryConfidence = 0.85;
        categoryPattern = pattern.source;
        break;
      }
    }
    if (detectedCategory) break;
  }

  // Extract potential filters (words after the category that might filter results)
  const filters: string[] = [];
  if (detectedCategory) {
    // Look for filter phrases like "in src/", "containing X", "matching Y"
    const filterPatterns = [
      /\bin\s+([^\s]+)/i,
      /\bcontaining\s+([^\s]+)/i,
      /\bmatching\s+([^\s]+)/i,
      /\bwith\s+([^\s]+)/i,
      /\bnamed\s+([^\s]+)/i,
    ];
    for (const fp of filterPatterns) {
      const match = trimmedQuery.match(fp);
      if (match && match[1]) {
        filters.push(match[1]);
      }
    }
  }

  // Both query type and category must be detected for a high-confidence enumeration
  const isEnumeration = detectedQueryType !== null && detectedCategory !== null;
  const overallConfidence = isEnumeration
    ? Math.min(queryTypeConfidence, categoryConfidence)
    : 0;

  return {
    isEnumeration,
    category: detectedCategory,
    queryType: detectedQueryType,
    confidence: overallConfidence,
    matchedPattern: categoryPattern || queryTypePattern,
    filters,
  };
}

/**
 * Check if a query should use enumeration mode instead of semantic search.
 *
 * @param query - The user's query string
 * @returns True if enumeration mode should be used
 */
export function shouldUseEnumerationMode(query: string): boolean {
  const intent = detectEnumerationIntent(query);
  return intent.isEnumeration && intent.confidence >= 0.7;
}

// ============================================================================
// CATEGORY-SPECIFIC ENUMERATORS
// ============================================================================

/**
 * Maximum entities to return in a single enumeration.
 * Safety limit to prevent OOM on massive codebases.
 */
const MAX_ENUMERATION_LIMIT = 10000;

/**
 * Enumerate CLI command files.
 * Scans src/cli/commands/*.ts and extracts command metadata.
 */
async function enumerateCliCommands(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const commandsDir = path.join(workspace, 'src', 'cli', 'commands');
  const pattern = '*.ts';

  try {
    const files = await glob(pattern, {
      cwd: commandsDir,
      absolute: true,
      ignore: ['index.ts', '*.test.ts', '*.spec.ts'],
    });

    const entities: EnumeratedEntity[] = [];

    for (const filePath of files) {
      const fileName = path.basename(filePath, '.ts');
      const relativePath = path.relative(workspace, filePath);

      // Try to extract command metadata from file
      let description: string | undefined;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        // Look for @fileoverview or first comment describing the command
        const docMatch = content.match(/@fileoverview\s+(.+?)(?:\n|\r|\*)/);
        if (docMatch) {
          description = docMatch[1].trim();
        }
        // Also try to find export name
        const exportMatch = content.match(/export\s+(?:async\s+)?function\s+(\w+Command)/);
        if (exportMatch) {
          description = description || `${fileName} command`;
        }
      } catch {
        // Ignore read errors
      }

      entities.push({
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'cli_command',
        metadata: {
          commandName: fileName.replace(/_/g, '-'),
        },
        description,
      });
    }

    return entities.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Enumerate test files.
 * Scans for *.test.ts and *.spec.ts files.
 */
async function enumerateTestFiles(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const patterns = ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx'];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      });
      files.push(...matches);
    }

    // Dedupe
    const uniqueFiles = [...new Set(files)];

    const entities: EnumeratedEntity[] = uniqueFiles.map((filePath) => {
      const relativePath = path.relative(workspace, filePath);
      const fileName = path.basename(filePath);
      const dir = path.dirname(relativePath);

      return {
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'test_file',
        metadata: {
          directory: dir,
          extension: path.extname(filePath),
        },
      };
    });

    return entities.sort((a, b) => a.filePath.localeCompare(b.filePath));
  } catch {
    return [];
  }
}

/**
 * Enumerate interfaces from storage/symbol table.
 */
async function enumerateInterfaces(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const interfaces = symbolStorage.findByKind('interface');
    await symbolStorage.close();

    return interfaces.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'interface',
      metadata: {
        qualifiedName: symbol.qualifiedName,
        line: symbol.line,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    // Fallback: scan for interface declarations via file system
    return enumerateByFilePattern(workspace, 'interface');
  }
}

/**
 * Enumerate classes from storage/symbol table.
 */
async function enumerateClasses(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const classes = symbolStorage.findByKind('class');
    await symbolStorage.close();

    return classes.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'class',
      metadata: {
        qualifiedName: symbol.qualifiedName,
        line: symbol.line,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    return enumerateByFilePattern(workspace, 'class');
  }
}

/**
 * Enumerate type aliases from storage.
 */
async function enumerateTypeAliases(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const types = symbolStorage.findByKind('type');
    await symbolStorage.close();

    return types.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'type_alias',
      metadata: {
        qualifiedName: symbol.qualifiedName,
        line: symbol.line,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Enumerate functions from storage.
 */
async function enumerateFunctions(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const functions = symbolStorage.findByKind('function');
    await symbolStorage.close();

    return functions.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'function',
      metadata: {
        signature: symbol.signature,
        line: symbol.line,
        endLine: symbol.endLine,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Enumerate configuration files.
 */
async function enumerateConfigs(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const patterns = [
    '*.config.ts',
    '*.config.js',
    '*.config.json',
    'package.json',
    'tsconfig*.json',
    '.eslintrc*',
    '.prettierrc*',
    'vitest.config.*',
    'jest.config.*',
    'webpack.config.*',
    'vite.config.*',
  ];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**'],
      });
      files.push(...matches);
    }

    const uniqueFiles = [...new Set(files)];

    return uniqueFiles.map((filePath): EnumeratedEntity => {
      const relativePath = path.relative(workspace, filePath);
      const fileName = path.basename(filePath);

      return {
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'config' as const,
        metadata: {
          extension: path.extname(filePath),
        },
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Enumerate modules from storage.
 */
async function enumerateModules(
  workspace: string,
  storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  if (!storage) return [];

  try {
    const modules = await storage.getModules({ limit: MAX_ENUMERATION_LIMIT });

    return modules.map((mod) => ({
      id: mod.id,
      name: path.basename(mod.path),
      filePath: mod.path,
      category: 'module',
      metadata: {
        exports: mod.exports,
        dependencies: mod.dependencies,
      },
      description: mod.purpose,
    }));
  } catch {
    return [];
  }
}

/**
 * Enumerate documentation files.
 */
async function enumerateDocumentation(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const patterns = ['**/*.md', '**/README*', '**/CHANGELOG*', '**/CONTRIBUTING*'];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**'],
      });
      files.push(...matches);
    }

    const uniqueFiles = [...new Set(files)];

    return uniqueFiles.map((filePath): EnumeratedEntity => {
      const relativePath = path.relative(workspace, filePath);
      const fileName = path.basename(filePath);

      return {
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'documentation' as const,
        metadata: {},
      };
    }).sort((a, b) => a.filePath.localeCompare(b.filePath));
  } catch {
    return [];
  }
}

/**
 * Enumerate enums from storage.
 */
async function enumerateEnums(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const enums = symbolStorage.findByKind('enum');
    await symbolStorage.close();

    return enums.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'enum',
      metadata: {
        qualifiedName: symbol.qualifiedName,
        line: symbol.line,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Enumerate constants from storage.
 */
async function enumerateConstants(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  try {
    const symbolStorage = createSymbolStorage(workspace);
    await symbolStorage.initialize();
    const constants = symbolStorage.findByKind('const');
    await symbolStorage.close();

    return constants.map((symbol) => ({
      id: `${symbol.file}:${symbol.name}`,
      name: symbol.name,
      filePath: symbol.file,
      category: 'constant',
      metadata: {
        qualifiedName: symbol.qualifiedName,
        line: symbol.line,
        exported: symbol.exported,
      },
      line: symbol.line,
      description: symbol.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Enumerate React hooks.
 */
async function enumerateHooks(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const patterns = ['**/use*.ts', '**/use*.tsx', '**/hooks/**/*.ts', '**/hooks/**/*.tsx'];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
      });
      files.push(...matches);
    }

    const uniqueFiles = [...new Set(files)];

    return uniqueFiles.map((filePath): EnumeratedEntity => {
      const relativePath = path.relative(workspace, filePath);
      const fileName = path.basename(filePath, path.extname(filePath));

      return {
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'hook' as const,
        metadata: {},
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Enumerate React/Vue components.
 */
async function enumerateComponents(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const patterns = [
    '**/components/**/*.tsx',
    '**/components/**/*.jsx',
    '**/components/**/*.vue',
    '**/components/**/*.svelte',
  ];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'],
      });
      files.push(...matches);
    }

    const uniqueFiles = [...new Set(files)];

    return uniqueFiles.map((filePath): EnumeratedEntity => {
      const relativePath = path.relative(workspace, filePath);
      const fileName = path.basename(filePath, path.extname(filePath));

      return {
        id: relativePath,
        name: fileName,
        filePath: relativePath,
        category: 'component' as const,
        metadata: {
          extension: path.extname(filePath),
        },
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ============================================================================
// ENDPOINT TYPES
// ============================================================================

/**
 * HTTP methods for API endpoints.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * Supported web frameworks for endpoint detection.
 */
export type EndpointFramework = 'express' | 'nestjs' | 'fastify' | 'koa' | 'hapi' | 'unknown';

/**
 * Detailed endpoint information.
 */
export interface EndpointInfo {
  /** HTTP method (GET, POST, etc.) */
  method: HttpMethod;
  /** Route path (e.g., '/api/users/:id') */
  path: string;
  /** File containing the endpoint */
  file: string;
  /** Line number of the endpoint definition */
  line: number;
  /** Handler function name if identifiable */
  handler: string;
  /** Detected framework */
  framework: EndpointFramework;
  /** Middleware if detected */
  middleware?: string[];
}

// ============================================================================
// ENDPOINT DETECTION PATTERNS
// ============================================================================

/**
 * Express.js route patterns.
 * Matches: app.get('/path', handler), router.post('/path', handler), etc.
 * Requires the path to start with '/' to avoid false positives from detection code.
 */
const EXPRESS_PATTERNS = [
  /(?:app|router)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*['"`](\/[^'"`]*)['"`]/gi,
  /(?:app|router)\s*\.\s*(all)\s*\(\s*['"`](\/[^'"`]*)['"`]/gi,
  /(?:app|router)\s*\.\s*(use)\s*\(\s*['"`](\/[^'"`]*)['"`]/gi,
];

/**
 * NestJS decorator patterns.
 * Matches: @Get('/path'), @Post(), @Controller('/prefix'), etc.
 */
const NESTJS_PATTERNS = [
  /@(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*['"`]?([^'"`\)\s]*)['"`]?\s*\)/gi,
  /@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
];

/**
 * Fastify route patterns.
 * Matches: fastify.get('/path', handler), server.post('/path', opts, handler), etc.
 * Note: Uses 'fastify' or 'server' prefix (not 'app' to avoid Express overlap).
 * Requires the path to start with '/' to avoid false positives.
 */
const FASTIFY_PATTERNS = [
  /(?:fastify|server)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*['"`](\/[^'"`]*)['"`]/gi,
  /(?:fastify|server)\s*\.\s*route\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*url\s*:\s*['"`](\/[^'"`]*)['"`]/gi,
];

/**
 * Koa router patterns.
 * Matches: router.get('/path', handler), router.post('/path', handler), etc.
 */
const KOA_PATTERNS = [
  /router\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
];

/**
 * Hapi route patterns.
 * Matches: server.route({ method: 'GET', path: '/path', handler }), etc.
 */
const HAPI_PATTERNS = [
  /server\s*\.\s*route\s*\(\s*\{[^}]*method\s*:\s*['"`](\w+)['"`][^}]*path\s*:\s*['"`]([^'"`]+)['"`]/gi,
  /server\s*\.\s*route\s*\(\s*\{[^}]*path\s*:\s*['"`]([^'"`]+)['"`][^}]*method\s*:\s*['"`](\w+)['"`]/gi,
];

/**
 * Enumerate API endpoints by scanning source files for route definitions.
 *
 * Detects endpoints from multiple frameworks:
 * - Express.js (app.get, router.post, etc.)
 * - NestJS (@Get, @Post decorators)
 * - Fastify (fastify.get, server.route, etc.)
 * - Koa (router.get, etc.)
 * - Hapi (server.route, etc.)
 *
 * @param workspace - The workspace root path
 * @param _storage - Optional storage (not used for file-based scanning)
 * @returns Array of enumerated endpoint entities
 */
async function enumerateEndpoints(
  workspace: string,
  _storage?: LibrarianStorage
): Promise<EnumeratedEntity[]> {
  const settings = getEndpointScanSettings();
  if (settings.cacheEnabled) {
    const cached = endpointCache.get(workspace);
    if (cached && Date.now() - cached.at < settings.cacheTtlMs) {
      return cached.entities;
    }
  }
  const entities: EnumeratedEntity[] = [];
  const patterns = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/__tests__/**',
          '**/test/**',
          '**/tests/**',
          '**/fixtures/**',
          '**/evaluation/**',
          '**/examples/**',
          '**/*.test.*',
          '**/*.spec.*',
          '**/*.d.ts',
          '**/*.example.*',
        ],
      });
      files.push(...matches);
    }

    const uniqueFiles = [...new Set(files)];
    const endpointInfos: EndpointInfo[] = [];
    const scanStart = Date.now();
    let scanned = 0;

    for (const filePath of uniqueFiles) {
      if (scanned >= settings.maxFiles) break;
      if (Date.now() - scanStart > settings.timeBudgetMs) break;
      scanned += 1;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relativePath = path.relative(workspace, filePath);
        const lines = content.split('\n');

        // Track NestJS controller prefix
        let controllerPrefix = '';
        const controllerMatch = content.match(/@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
        if (controllerMatch) {
          controllerPrefix = controllerMatch[1];
        }

        // Check Express patterns
        for (const pattern of EXPRESS_PATTERNS) {
          pattern.lastIndex = 0; // Reset regex state
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const method = match[1].toUpperCase();
            // Skip 'use' and 'all' as they're middleware, not endpoints (unless you want them)
            if (method === 'USE') continue;

            const routePath = match[2];
            const lineNum = getLineNumber(content, match.index);

            // Skip if this looks like example/documentation code
            if (isLikelyExampleCode(content, match.index, lines, lineNum, routePath)) {
              continue;
            }

            endpointInfos.push({
              method: (method === 'ALL' ? 'GET' : method) as HttpMethod,
              path: routePath,
              file: relativePath,
              line: lineNum,
              handler: extractHandlerName(content, match.index, lines),
              framework: 'express',
            });
          }
        }

        // Check NestJS patterns
        for (const pattern of NESTJS_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            // Skip Controller decorators (already captured prefix)
            if (match[0].includes('@Controller')) continue;

            const method = match[1].toUpperCase() as HttpMethod;
            const routePath = match[2] || '/';
            const lineNum = getLineNumber(content, match.index);
            const fullPath = controllerPrefix
              ? `${controllerPrefix}${routePath.startsWith('/') ? '' : '/'}${routePath}`
              : routePath;

            // Skip if this looks like example/documentation code
            if (isLikelyExampleCode(content, match.index, lines, lineNum, fullPath)) {
              continue;
            }

            endpointInfos.push({
              method,
              path: fullPath || '/',
              file: relativePath,
              line: lineNum,
              handler: extractNestHandlerName(content, match.index, lines),
              framework: 'nestjs',
            });
          }
        }

        // Check Fastify patterns
        for (const pattern of FASTIFY_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const method = match[1].toUpperCase() as HttpMethod;
            const routePath = match[2];
            const lineNum = getLineNumber(content, match.index);

            // Skip if this looks like example/documentation code
            if (isLikelyExampleCode(content, match.index, lines, lineNum, routePath)) {
              continue;
            }

            endpointInfos.push({
              method,
              path: routePath,
              file: relativePath,
              line: lineNum,
              handler: extractHandlerName(content, match.index, lines),
              framework: 'fastify',
            });
          }
        }

        // Check Koa patterns
        for (const pattern of KOA_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const method = match[1].toUpperCase();
            if (method === 'ALL') continue; // Skip wildcard routes
            const routePath = match[2];
            const lineNum = getLineNumber(content, match.index);

            // Skip if this looks like example/documentation code
            if (isLikelyExampleCode(content, match.index, lines, lineNum, routePath)) {
              continue;
            }

            endpointInfos.push({
              method: method as HttpMethod,
              path: routePath,
              file: relativePath,
              line: lineNum,
              handler: extractHandlerName(content, match.index, lines),
              framework: 'koa',
            });
          }
        }

        // Check Hapi patterns
        for (const pattern of HAPI_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            // Hapi patterns can have method/path in different orders
            let method: string;
            let routePath: string;
            if (match[0].indexOf('method') < match[0].indexOf('path')) {
              method = match[1].toUpperCase();
              routePath = match[2];
            } else {
              routePath = match[1];
              method = match[2].toUpperCase();
            }
            const lineNum = getLineNumber(content, match.index);

            // Skip if this looks like example/documentation code
            if (isLikelyExampleCode(content, match.index, lines, lineNum, routePath)) {
              continue;
            }

            endpointInfos.push({
              method: method as HttpMethod,
              path: routePath,
              file: relativePath,
              line: lineNum,
              handler: 'handler',
              framework: 'hapi',
            });
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Dedupe endpoints (same method + path + file)
    const seen = new Set<string>();
    for (const info of endpointInfos) {
      const key = `${info.method}:${info.path}:${info.file}:${info.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          id: `${info.file}:${info.line}:${info.method}:${info.path}`,
          name: `${info.method} ${info.path}`,
          filePath: info.file,
          category: 'endpoint',
          metadata: {
            method: info.method,
            path: info.path,
            handler: info.handler,
            framework: info.framework,
          },
          line: info.line,
          description: `${info.framework} endpoint: ${info.method} ${info.path}`,
        });
      }
    }

    const sorted = entities.sort((a, b) => {
      // Sort by path first, then method
      const pathA = (a.metadata.path as string) || '';
      const pathB = (b.metadata.path as string) || '';
      const pathCompare = pathA.localeCompare(pathB);
      if (pathCompare !== 0) return pathCompare;
      return a.name.localeCompare(b.name);
    });
    if (settings.cacheEnabled) {
      endpointCache.set(workspace, { at: Date.now(), entities: sorted });
    }
    return sorted;
  } catch {
    return [];
  }
}

/**
 * Get the line number for a match index in content.
 */
function getLineNumber(content: string, index: number): number {
  const beforeMatch = content.substring(0, index);
  return (beforeMatch.match(/\n/g) || []).length + 1;
}

/**
 * Check if a detected endpoint is likely example/documentation code.
 * This helps reduce false positives from code examples in comments,
 * documentation strings, or test fixtures.
 */
function isLikelyExampleCode(
  content: string,
  matchIndex: number,
  lines: string[],
  lineNum: number,
  routePath: string
): boolean {
  // Common example paths that are clearly not real endpoints
  const examplePaths = ['/path', '/example', '/foo', '/bar', '/test'];
  if (examplePaths.includes(routePath)) {
    return true;
  }

  // Check if the line appears to be inside a string literal or comment
  const line = lines[lineNum - 1] || '';
  const trimmedLine = line.trim();

  // Skip lines that look like they're in JSDoc or block comments
  if (trimmedLine.startsWith('*') || trimmedLine.startsWith('//')) {
    return true;
  }

  // Check if this is inside a template literal or string (rough heuristic)
  // Count backticks before this match to see if we're in a template literal
  const beforeMatch = content.substring(0, matchIndex);
  const lineStart = beforeMatch.lastIndexOf('\n') + 1;
  const lineContent = content.substring(lineStart, matchIndex);

  // If the line content before the match has an odd number of backticks,
  // we're likely inside a template literal
  const backtickCount = (lineContent.match(/`/g) || []).length;
  if (backtickCount % 2 === 1) {
    return true;
  }

  // Check if this appears to be inside a property value (object literal in code)
  // by looking for patterns like "code: `" or "example: `" before the match
  if (/(?:code|example|snippet|fixture|sample)\s*:\s*[`'"]/.test(lineContent)) {
    return true;
  }

  // Check for common patterns indicating this is documentation
  const prev5Lines = lines.slice(Math.max(0, lineNum - 6), lineNum - 1).join('\n');
  if (/@example|@code|Example:|Actual code:/i.test(prev5Lines)) {
    return true;
  }

  return false;
}

/**
 * Extract handler function name from Express/Fastify/Koa style routes.
 */
function extractHandlerName(content: string, matchIndex: number, lines: string[]): string {
  const lineNum = getLineNumber(content, matchIndex);
  const line = lines[lineNum - 1] || '';

  // Look for function name after the route path
  // e.g., app.get('/users', getUsers) or app.get('/users', (req, res) => ...)
  const afterPath = line.substring(line.indexOf(',') + 1);

  // Check for named function reference
  const namedFuncMatch = afterPath.match(/^\s*(\w+)\s*[,)]/);
  if (namedFuncMatch) {
    return namedFuncMatch[1];
  }

  // Check for arrow function or anonymous function
  if (afterPath.includes('=>') || afterPath.includes('function')) {
    return 'anonymous';
  }

  // Check for array of middleware
  if (afterPath.includes('[')) {
    return 'middleware chain';
  }

  return 'handler';
}

/**
 * Extract handler method name from NestJS decorator context.
 */
function extractNestHandlerName(content: string, matchIndex: number, lines: string[]): string {
  const lineNum = getLineNumber(content, matchIndex);

  // Look for the method definition on the next few lines
  for (let i = lineNum; i < Math.min(lineNum + 5, lines.length); i++) {
    const line = lines[i] || '';
    // Look for method definition: async methodName( or methodName(
    const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\(/);
    if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
      return methodMatch[1];
    }
  }

  return 'handler';
}

/**
 * Get all endpoints from a workspace with detailed information.
 *
 * This is a convenience function that returns EndpointInfo[] instead of EnumeratedEntity[].
 *
 * @param workspace - The workspace root path
 * @returns Array of detailed endpoint information
 *
 * @example
 * ```typescript
 * const endpoints = await getEndpoints('/path/to/project');
 * for (const ep of endpoints) {
 *   console.log(`${ep.method} ${ep.path} -> ${ep.handler} (${ep.framework})`);
 * }
 * ```
 */
export async function getEndpoints(workspace: string): Promise<EndpointInfo[]> {
  const entities = await enumerateEndpoints(workspace);
  return entities.map((e) => ({
    method: e.metadata.method as HttpMethod,
    path: e.metadata.path as string,
    file: e.filePath,
    line: e.line || 0,
    handler: e.metadata.handler as string,
    framework: e.metadata.framework as EndpointFramework,
  }));
}

/**
 * Fallback enumerator using file pattern matching for symbol types.
 */
async function enumerateByFilePattern(
  workspace: string,
  symbolType: 'interface' | 'class' | 'type' | 'enum'
): Promise<EnumeratedEntity[]> {
  const patterns = ['**/*.ts', '**/*.tsx'];
  const entities: EnumeratedEntity[] = [];

  try {
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: workspace,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/*.test.*', '**/*.spec.*'],
      });
      files.push(...matches);
    }

    const regex = new RegExp(`export\\s+${symbolType}\\s+(\\w+)`, 'g');

    for (const filePath of files.slice(0, 500)) { // Limit to first 500 files
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        let match;
        while ((match = regex.exec(content)) !== null) {
          const relativePath = path.relative(workspace, filePath);
          entities.push({
            id: `${relativePath}:${match[1]}`,
            name: match[1],
            filePath: relativePath,
            category: symbolType as EnumerationCategory,
            metadata: {},
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    return entities.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ============================================================================
// MAIN ENUMERATION FUNCTION
// ============================================================================

/**
 * Map of category to enumerator function.
 */
const ENUMERATORS: Record<
  EnumerationCategory,
  (workspace: string, storage?: LibrarianStorage) => Promise<EnumeratedEntity[]>
> = {
  cli_command: enumerateCliCommands,
  test_file: enumerateTestFiles,
  interface: enumerateInterfaces,
  class: enumerateClasses,
  type_alias: enumerateTypeAliases,
  function: enumerateFunctions,
  config: enumerateConfigs,
  module: enumerateModules,
  documentation: enumerateDocumentation,
  enum: enumerateEnums,
  constant: enumerateConstants,
  hook: enumerateHooks,
  component: enumerateComponents,
  endpoint: enumerateEndpoints,
};

/**
 * Enumerate all entities of a given category.
 *
 * Returns a COMPLETE list of entities, not a top-k sample.
 *
 * @param storage - Storage backend (optional for file-based categories)
 * @param category - The category to enumerate
 * @param workspace - The workspace root path
 * @returns Complete enumeration result
 *
 * @example
 * ```typescript
 * const result = await enumerateByCategory(storage, 'cli_command', '/path/to/workspace');
 * console.log(`Found ${result.totalCount} CLI commands`);
 * for (const entity of result.entities) {
 *   console.log(`  - ${entity.name}: ${entity.filePath}`);
 * }
 * ```
 */
export async function enumerateByCategory(
  storage: LibrarianStorage | undefined,
  category: EnumerationCategory,
  workspace: string
): Promise<EnumerationResult> {
  const startTime = Date.now();

  const enumerator = ENUMERATORS[category];
  if (!enumerator) {
    return {
      category,
      totalCount: 0,
      entities: [],
      byDirectory: new Map(),
      durationMs: Date.now() - startTime,
      explanation: `Unknown category: ${category}`,
      truncated: false,
    };
  }

  const entities = await enumerator(workspace, storage);
  const truncated = entities.length >= MAX_ENUMERATION_LIMIT;

  // Group by directory
  const byDirectory = new Map<string, EnumeratedEntity[]>();
  for (const entity of entities) {
    const dir = path.dirname(entity.filePath);
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, []);
    }
    byDirectory.get(dir)!.push(entity);
  }

  const durationMs = Date.now() - startTime;

  return {
    category,
    totalCount: entities.length,
    entities,
    byDirectory,
    durationMs,
    explanation: buildEnumerationExplanation(category, entities.length, truncated),
    truncated,
    maxLimit: truncated ? MAX_ENUMERATION_LIMIT : undefined,
  };
}

/**
 * Build a human-readable explanation for enumeration results.
 */
function buildEnumerationExplanation(
  category: EnumerationCategory,
  count: number,
  truncated: boolean
): string {
  const categoryNames: Record<EnumerationCategory, string> = {
    cli_command: 'CLI commands',
    test_file: 'test files',
    interface: 'interfaces',
    class: 'classes',
    type_alias: 'type aliases',
    function: 'functions',
    config: 'configuration files',
    endpoint: 'API endpoints',
    component: 'components',
    hook: 'hooks',
    constant: 'constants',
    enum: 'enums',
    module: 'modules',
    documentation: 'documentation files',
  };

  const name = categoryNames[category] || category;
  const countText = truncated
    ? `${count}+ (truncated at ${MAX_ENUMERATION_LIMIT})`
    : count.toString();

  return `Found ${countText} ${name} in the codebase.`;
}

/**
 * Format enumeration result for display.
 */
export function formatEnumerationResult(result: EnumerationResult): string {
  const lines: string[] = [];

  lines.push(`\n=== Enumeration: ${result.category} ===`);
  lines.push(result.explanation);

  if (result.truncated) {
    lines.push(`\nWarning: Results truncated at ${result.maxLimit} entries.`);
  }

  lines.push(`\nBy Directory:`);
  const sortedDirs = Array.from(result.byDirectory.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [dir, entities] of sortedDirs.slice(0, 20)) {
    lines.push(`  ${dir}/ (${entities.length})`);
    for (const entity of entities.slice(0, 10)) {
      const desc = entity.description ? ` - ${entity.description.slice(0, 50)}` : '';
      lines.push(`    - ${entity.name}${desc}`);
    }
    if (entities.length > 10) {
      lines.push(`    ... and ${entities.length - 10} more`);
    }
  }

  if (sortedDirs.length > 20) {
    lines.push(`  ... and ${sortedDirs.length - 20} more directories`);
  }

  lines.push(`\nComplete list (${result.totalCount}):`);
  for (const entity of result.entities.slice(0, 100)) {
    lines.push(`  ${entity.filePath}`);
  }
  if (result.entities.length > 100) {
    lines.push(`  ... and ${result.entities.length - 100} more`);
  }

  lines.push(`\nQuery completed in ${result.durationMs}ms`);

  return lines.join('\n');
}

/**
 * Get all supported enumeration categories.
 */
export function getSupportedCategories(): EnumerationCategory[] {
  return Object.keys(ENUMERATORS) as EnumerationCategory[];
}

/**
 * Get category aliases for user-friendly matching.
 */
export function getCategoryAliases(): Map<string, EnumerationCategory> {
  const aliases = new Map<string, EnumerationCategory>();

  for (const { category, aliases: categoryAliases } of CATEGORY_PATTERNS) {
    for (const alias of categoryAliases) {
      aliases.set(alias.toLowerCase(), category);
    }
  }

  return aliases;
}

// ============================================================================
// PAGINATION SUPPORT
// ============================================================================

/**
 * Enumerate entities by category with pagination support.
 *
 * This function extends `enumerateByCategory` with pagination, sorting, and
 * efficient handling of large result sets.
 *
 * @param storage - Storage backend (optional for file-based categories)
 * @param category - The category to enumerate
 * @param workspace - The workspace root path
 * @param options - Pagination and sorting options
 * @returns Paginated enumeration result
 *
 * @example
 * ```typescript
 * // Get first page of 50 functions sorted by name
 * const page1 = await enumerateByCategoryPaginated(storage, 'function', workspace, {
 *   offset: 0,
 *   limit: 50,
 *   sortBy: 'name',
 *   sortOrder: 'asc'
 * });
 *
 * // Get second page
 * const page2 = await enumerateByCategoryPaginated(storage, 'function', workspace, {
 *   offset: 50,
 *   limit: 50,
 *   sortBy: 'name',
 *   sortOrder: 'asc'
 * });
 *
 * console.log(`Showing ${page1.items.length} of ${page1.total} functions`);
 * console.log(`Has more: ${page1.hasMore}`);
 * ```
 */
export async function enumerateByCategoryPaginated(
  storage: LibrarianStorage | undefined,
  category: EnumerationCategory,
  workspace: string,
  options: EnumerationOptions = {}
): Promise<PaginatedResult<EnumeratedEntity>> {
  const { offset = 0, limit = 100, sortBy = 'name', sortOrder = 'asc' } = options;

  // Get all results first (storage backends could optimize with SQL LIMIT/OFFSET)
  const result = await enumerateByCategory(storage, category, workspace);
  const allResults = [...result.entities];

  // Sort
  allResults.sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (sortBy) {
      case 'name':
        aVal = a.name;
        bVal = b.name;
        break;
      case 'file':
        aVal = a.filePath;
        bVal = b.filePath;
        break;
      case 'line':
        aVal = a.line ?? 0;
        bVal = b.line ?? 0;
        break;
      default:
        aVal = a.name;
        bVal = b.name;
    }

    const cmp = typeof aVal === 'number' && typeof bVal === 'number'
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal));
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  // Paginate
  const items = allResults.slice(offset, offset + limit);

  return {
    items,
    total: allResults.length,
    offset,
    limit,
    hasMore: offset + limit < allResults.length,
  };
}

// ============================================================================
// FRAMEWORK DETECTION
// ============================================================================

/**
 * Dependency patterns for framework detection.
 * Maps package names to framework types.
 */
const FRAMEWORK_DEPENDENCIES: Record<string, EnumerationFramework> = {
  // Frontend frameworks
  react: 'react',
  vue: 'vue',
  '@angular/core': 'angular',
  svelte: 'svelte',

  // Backend frameworks
  express: 'express',
  '@nestjs/core': 'nestjs',
  fastify: 'fastify',
  koa: 'koa',
  '@hapi/hapi': 'hapi',

  // Meta-frameworks
  next: 'next',
  nuxt: 'nuxt',
  gatsby: 'gatsby',

  // Desktop
  electron: 'electron',
};

/**
 * Detect frameworks used in a workspace by analyzing package.json.
 *
 * Checks both dependencies and devDependencies for known framework packages.
 *
 * @param workspace - The workspace root path
 * @returns Array of detected frameworks (or ['unknown'] if none detected)
 *
 * @example
 * ```typescript
 * const frameworks = await detectFramework('/path/to/project');
 * // ['react', 'next'] for a Next.js project
 * // ['express', 'nestjs'] for a NestJS backend
 * // ['unknown'] if no frameworks detected
 *
 * if (frameworks.includes('react')) {
 *   console.log('This is a React project');
 * }
 * ```
 */
export async function detectFramework(workspace: string): Promise<EnumerationFramework[]> {
  const frameworks: EnumerationFramework[] = [];

  try {
    const pkgPath = path.join(workspace, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check each known framework dependency
    for (const [depName, framework] of Object.entries(FRAMEWORK_DEPENDENCIES)) {
      if (allDeps[depName]) {
        frameworks.push(framework);
      }
    }
  } catch {
    // Ignore errors (file not found, parse error, etc.)
  }

  return frameworks.length > 0 ? frameworks : ['unknown'];
}

/**
 * Get framework-specific categories to enumerate.
 *
 * Returns categories that are relevant for the detected frameworks.
 *
 * @param frameworks - Array of detected frameworks
 * @returns Array of relevant enumeration categories
 *
 * @example
 * ```typescript
 * const frameworks = await detectFramework(workspace);
 * const categories = getFrameworkCategories(frameworks);
 * // ['component', 'hook'] for React
 * // ['endpoint'] for Express/NestJS
 * ```
 */
export function getFrameworkCategories(frameworks: EnumerationFramework[]): EnumerationCategory[] {
  const categories: Set<EnumerationCategory> = new Set();

  for (const framework of frameworks) {
    switch (framework) {
      case 'react':
        categories.add('component');
        categories.add('hook');
        break;
      case 'vue':
      case 'angular':
      case 'svelte':
        categories.add('component');
        break;
      case 'express':
      case 'nestjs':
      case 'fastify':
      case 'koa':
      case 'hapi':
        categories.add('endpoint');
        break;
      case 'next':
      case 'nuxt':
      case 'gatsby':
        categories.add('component');
        categories.add('endpoint');
        break;
    }
  }

  return Array.from(categories);
}

// ============================================================================
// SUB-CATEGORY FILTERING
// ============================================================================

/**
 * Extended entity with additional filterable metadata.
 * Used internally for filtering operations.
 */
interface FilterableEntity extends EnumeratedEntity {
  /** Whether the entity is exported */
  isExported?: boolean;
  /** Visibility modifier (public, private, protected) */
  visibility?: 'public' | 'private' | 'protected';
  /** Whether the entity is async */
  isAsync?: boolean;
  /** Whether the entity is static */
  isStatic?: boolean;
  /** Array of decorator names */
  decorators?: string[];
}

/**
 * Enumerate entities with advanced filtering support.
 *
 * Extends `enumerateByCategory` with filters for exported status, visibility,
 * modifiers, decorators, and file location.
 *
 * @param storage - Storage backend (optional for file-based categories)
 * @param category - The category to enumerate
 * @param workspace - The workspace root path
 * @param filters - Filter options
 * @returns Filtered array of enumerated entities
 *
 * @example
 * ```typescript
 * // Get only exported functions
 * const exportedFunctions = await enumerateWithFilters(
 *   storage, 'function', workspace,
 *   { exported: true }
 * );
 *
 * // Get private methods with decorators
 * const privateMethods = await enumerateWithFilters(
 *   storage, 'function', workspace,
 *   { visibility: 'private', hasDecorators: true }
 * );
 *
 * // Get all classes in a specific directory
 * const apiClasses = await enumerateWithFilters(
 *   storage, 'class', workspace,
 *   { inDirectory: 'src/api' }
 * );
 *
 * // Get async functions with a specific decorator
 * const controllerMethods = await enumerateWithFilters(
 *   storage, 'function', workspace,
 *   { isAsync: true, decoratorName: 'Get' }
 * );
 * ```
 */
export async function enumerateWithFilters(
  storage: LibrarianStorage | undefined,
  category: EnumerationCategory,
  workspace: string,
  filters: FilterOptions
): Promise<EnumeratedEntity[]> {
  // Get base enumeration results
  const result = await enumerateByCategory(storage, category, workspace);
  let entities: FilterableEntity[] = result.entities.map((e) => ({
    ...e,
    // Extract filterable metadata from entity.metadata
    isExported: e.metadata.exported as boolean | undefined,
    visibility: e.metadata.visibility as 'public' | 'private' | 'protected' | undefined,
    isAsync: e.metadata.isAsync as boolean | undefined,
    isStatic: e.metadata.isStatic as boolean | undefined,
    decorators: e.metadata.decorators as string[] | undefined,
  }));

  // Apply exported filter
  if (filters.exported !== undefined) {
    entities = entities.filter((e) => e.isExported === filters.exported);
  }

  // Apply visibility filter
  if (filters.visibility && filters.visibility !== 'all') {
    entities = entities.filter((e) => e.visibility === filters.visibility);
  }

  // Apply async filter
  if (filters.isAsync !== undefined) {
    entities = entities.filter((e) => e.isAsync === filters.isAsync);
  }

  // Apply static filter
  if (filters.isStatic !== undefined) {
    entities = entities.filter((e) => e.isStatic === filters.isStatic);
  }

  // Apply hasDecorators filter
  if (filters.hasDecorators !== undefined) {
    entities = entities.filter((e) =>
      filters.hasDecorators
        ? (e.decorators?.length ?? 0) > 0
        : !e.decorators?.length
    );
  }

  // Apply decoratorName filter
  if (filters.decoratorName) {
    const decoratorName = filters.decoratorName;
    entities = entities.filter((e) =>
      e.decorators?.includes(decoratorName)
    );
  }

  // Apply inFile filter
  if (filters.inFile) {
    const inFile = filters.inFile;
    entities = entities.filter((e) => e.filePath === inFile);
  }

  // Apply inDirectory filter
  if (filters.inDirectory) {
    const inDirectory = filters.inDirectory;
    entities = entities.filter((e) => e.filePath.startsWith(inDirectory));
  }

  // Return as base EnumeratedEntity[] (without the extended filterable fields)
  return entities.map(({ isExported, visibility, isAsync, isStatic, decorators, ...base }) => base);
}

/**
 * Convenience function to enumerate only exported entities.
 *
 * @param storage - Storage backend
 * @param category - The category to enumerate
 * @param workspace - The workspace root path
 * @returns Array of exported entities
 */
export async function enumerateExported(
  storage: LibrarianStorage | undefined,
  category: EnumerationCategory,
  workspace: string
): Promise<EnumeratedEntity[]> {
  return enumerateWithFilters(storage, category, workspace, { exported: true });
}

/**
 * Convenience function to enumerate entities in a specific directory.
 *
 * @param storage - Storage backend
 * @param category - The category to enumerate
 * @param workspace - The workspace root path
 * @param directory - Directory path prefix
 * @returns Array of entities in the directory
 */
export async function enumerateInDirectory(
  storage: LibrarianStorage | undefined,
  category: EnumerationCategory,
  workspace: string,
  directory: string
): Promise<EnumeratedEntity[]> {
  return enumerateWithFilters(storage, category, workspace, { inDirectory: directory });
}
