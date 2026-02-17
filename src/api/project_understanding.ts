/**
 * @fileoverview Project Understanding Module
 *
 * Provides comprehensive project understanding for ANY agent on ANY project.
 * This module helps agents quickly understand:
 * - What a codebase does and why
 * - How it's structured and organized
 * - What conventions are used
 * - Where the important code lives
 * - What patterns to follow
 *
 * Handles high-level project queries like "What does this codebase do?"
 * Prioritizes README.md, package.json, AGENTS.md, and top-level documentation
 * over low-level function implementations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ContextPack, LibrarianVersion, ContextPackType, FunctionKnowledge, ModuleKnowledge, FileKnowledge } from '../types.js';
import type { LibrarianStorage, GraphEdgeQueryOptions } from '../storage/types.js';
import { detectEntryPoints, type DetectedEntryPoint } from '../knowledge/entry_point_detector.js';
import { computeHotspotScores, type HotspotInput, type HotspotScore } from '../strategic/hotspot.js';

// ============================================================================
// PROJECT UNDERSTANDING QUERY DETECTION
// ============================================================================

/**
 * Patterns that indicate a PROJECT-LEVEL query about what the codebase does.
 * These queries need high-level project understanding, not low-level functions.
 * Examples: "What does this codebase do?", "What is the purpose of this project?"
 */
export const PROJECT_UNDERSTANDING_PATTERNS = [
  /\bwhat\s+(does|is)\s+(this|the)\s*(codebase|project|repo|repository|code|thing)?\s*(do|for|about)?\b/i,
  /\bwhat\s+does\s+(this|it)\s+do\b/i,
  /\bwhat\s+is\s+this\s*(for|about)?\b/i,
  /\b(purpose|goal|objective)\s+(of\s+)?(this|the)\s*(codebase|project|repo)?\b/i,
  /\b(describe|explain|summarize)\s+(this|the)\s*(codebase|project|repo|repository)\b/i,
  /\b(project|codebase|repo)\s*(overview|summary|description|purpose)\b/i,
  /\b(high[- ]?level|overall|general)\s*(overview|summary|architecture|structure)\b/i,
  /\barchitecture\s*(overview|summary|of\s+(this|the))?\b/i,
  // NOTE: /\bentry\s*points?\b/i removed - handled by entry_point_query.ts to prevent overlap
  /\bmain\s*(features?|capabilities|functionality)\b/i,
  /\bwhat\s+can\s+(this|it|i)\s+(do|use\s+it\s+for)\b/i,
  /\btell\s+me\s+about\s+(this|the)\s*(project|codebase|repo)\b/i,
  /\bproject\s+structure\b/i,
  /\bhow\s+is\s+(this|the)\s*(project|codebase|code)\s+organized\b/i,
];

/**
 * Detects if a query is asking about high-level project understanding.
 */
export function isProjectUnderstandingQuery(intent: string): boolean {
  return PROJECT_UNDERSTANDING_PATTERNS.some(pattern => pattern.test(intent));
}

// ============================================================================
// PROJECT SUMMARY EXTRACTION
// ============================================================================

/**
 * High-priority files for project understanding, in priority order.
 */
const PROJECT_SUMMARY_FILES = [
  'README.md',
  'README.markdown',
  'readme.md',
  'Readme.md',
  'package.json',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'docs/README.md',
  'doc/README.md',
  'docs/index.md',
  'docs/overview.md',
  'docs/architecture.md',
];

export interface ProjectSummary {
  name: string;
  description: string;
  purpose: string;
  mainFeatures: string[];
  entryPoints: string[];
  architecture: string;
  techStack: string[];
  sources: string[];
  confidence: number;
}

/**
 * Extracts project summary from high-priority documentation files.
 */
export async function extractProjectSummary(workspaceRoot: string): Promise<ProjectSummary> {
  const summary: ProjectSummary = {
    name: path.basename(workspaceRoot),
    description: '',
    purpose: '',
    mainFeatures: [],
    entryPoints: [],
    architecture: '',
    techStack: [],
    sources: [],
    confidence: 0.5,
  };

  // Try to read package.json for name and description
  try {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    if (pkg.name) summary.name = pkg.name;
    if (pkg.description) {
      summary.description = pkg.description;
      summary.purpose = pkg.description;
    }
    if (pkg.main) summary.entryPoints.push(pkg.main);
    if (pkg.bin) {
      if (typeof pkg.bin === 'string') {
        summary.entryPoints.push(pkg.bin);
      } else if (typeof pkg.bin === 'object') {
        summary.entryPoints.push(...Object.values(pkg.bin as Record<string, string>));
      }
    }
    if (pkg.keywords) summary.mainFeatures.push(...pkg.keywords);

    // Extract tech stack from dependencies
    const dependencyKeys = Object.keys(pkg.dependencies ?? {});
    const devDependencyKeys = Object.keys(pkg.devDependencies ?? {});
    const allDependencyKeys = [...dependencyKeys, ...devDependencyKeys];

    if (dependencyKeys.some(d => d.includes('react'))) summary.techStack.push('React');
    if (dependencyKeys.some(d => d.includes('vue'))) summary.techStack.push('Vue');
    if (dependencyKeys.some(d => d.includes('express'))) summary.techStack.push('Express');
    if (dependencyKeys.some(d => d.includes('fastify'))) summary.techStack.push('Fastify');
    if (dependencyKeys.some(d => d.includes('sqlite'))) summary.techStack.push('SQLite');
    if (dependencyKeys.some(d => d.includes('postgres'))) summary.techStack.push('PostgreSQL');

    if (allDependencyKeys.includes('typescript')) summary.techStack.push('TypeScript');
    if (allDependencyKeys.some(d => d.includes('vitest'))) summary.techStack.push('Vitest');
    if (allDependencyKeys.some(d => d.includes('jest'))) summary.techStack.push('Jest');

    summary.sources.push('package.json');
    summary.confidence = Math.min(1.0, summary.confidence + 0.15);
  } catch {
    // package.json not found or invalid
  }

  // Try to read README.md for more detailed info
  for (const readmeName of ['README.md', 'readme.md', 'Readme.md', 'README.markdown']) {
    try {
      const readmePath = path.join(workspaceRoot, readmeName);
      const content = await fs.readFile(readmePath, 'utf-8');

      // Extract first paragraph as description if not already set
      if (!summary.description) {
        const firstParagraph = extractFirstParagraph(content);
        if (firstParagraph) summary.description = firstParagraph;
      }

      // Extract purpose from "What is" or "About" sections
      const purposeSection = extractSection(content, ['What is', 'About', 'Overview', 'Introduction']);
      if (purposeSection && !summary.purpose) {
        summary.purpose = purposeSection.slice(0, 500);
      }

      // Extract features from "Features" section
      const featuresSection = extractSection(content, ['Features', 'Key Features', 'Capabilities']);
      if (featuresSection) {
        const features = extractListItems(featuresSection);
        summary.mainFeatures.push(...features.slice(0, 10));
      }

      // Extract architecture from relevant section
      const archSection = extractSection(content, ['Architecture', 'Structure', 'Design', 'How it works']);
      if (archSection) {
        summary.architecture = archSection.slice(0, 800);
      }

      summary.sources.push(readmeName);
      summary.confidence = Math.min(1.0, summary.confidence + 0.2);
      break; // Found README, stop searching
    } catch {
      // File not found, try next
    }
  }

  // Try to read AGENTS.md for agent-specific context
  try {
    const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
    const content = await fs.readFile(agentsPath, 'utf-8');

    // AGENTS.md often has great project context
    const overview = extractSection(content, ['Overview', 'About', 'This project', 'Purpose']);
    if (overview && !summary.purpose) {
      summary.purpose = overview.slice(0, 500);
    }

    summary.sources.push('AGENTS.md');
    summary.confidence = Math.min(1.0, summary.confidence + 0.15);
  } catch {
    // AGENTS.md not found
  }

  // Deduplicate features
  summary.mainFeatures = [...new Set(summary.mainFeatures)];
  summary.techStack = [...new Set(summary.techStack)];

  return summary;
}

/**
 * Extracts the first non-heading paragraph from markdown content.
 */
function extractFirstParagraph(content: string): string {
  const lines = content.split('\n');
  let inParagraph = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip headings, badges, and empty lines at start
    if (trimmed.startsWith('#') || trimmed.startsWith('[![') || trimmed.startsWith('<')) {
      if (inParagraph) break;
      continue;
    }

    if (trimmed === '') {
      if (inParagraph && paragraphLines.length > 0) break;
      continue;
    }

    inParagraph = true;
    paragraphLines.push(trimmed);
  }

  return paragraphLines.join(' ').slice(0, 400);
}

/**
 * Extracts a section from markdown by its heading.
 */
function extractSection(content: string, headings: string[]): string | null {
  const lines = content.split('\n');
  const lowerHeadings = headings.map(h => h.toLowerCase());

  let inSection = false;
  let sectionLevel = 0;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].toLowerCase();

      if (inSection) {
        // End section if we hit a heading of same or higher level
        if (level <= sectionLevel) break;
      } else {
        // Check if this is our target section
        if (lowerHeadings.some(h => text.includes(h))) {
          inSection = true;
          sectionLevel = level;
          continue;
        }
      }
    }

    if (inSection) {
      sectionLines.push(trimmed);
    }
  }

  const result = sectionLines.join('\n').trim();
  return result || null;
}

/**
 * Extracts list items from markdown content.
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^[-*]\s+(.+)$/);
    if (match) {
      // Remove markdown formatting
      const text = match[1]
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (text) items.push(text);
    }
  }

  return items;
}

// ============================================================================
// PROJECT UNDERSTANDING CONTEXT PACK
// ============================================================================

/**
 * Creates a project understanding context pack for high-level queries.
 */
export async function createProjectUnderstandingPack(
  workspaceRoot: string,
  version: LibrarianVersion
): Promise<ContextPack> {
  const summary = await extractProjectSummary(workspaceRoot);

  const keyFacts: string[] = [];

  if (summary.description) {
    keyFacts.push(`Description: ${summary.description}`);
  }
  if (summary.purpose) {
    keyFacts.push(`Purpose: ${summary.purpose.slice(0, 200)}`);
  }
  if (summary.mainFeatures.length > 0) {
    keyFacts.push(`Main features: ${summary.mainFeatures.slice(0, 5).join(', ')}`);
  }
  if (summary.entryPoints.length > 0) {
    keyFacts.push(`Entry points: ${summary.entryPoints.join(', ')}`);
  }
  if (summary.techStack.length > 0) {
    keyFacts.push(`Tech stack: ${summary.techStack.join(', ')}`);
  }
  if (summary.architecture) {
    keyFacts.push(`Architecture: ${summary.architecture.slice(0, 300)}`);
  }

  const packSummary = summary.purpose || summary.description ||
    `${summary.name} - a project with ${summary.mainFeatures.length} key features`;

  return {
    packId: `project_understanding_${summary.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
    packType: 'project_understanding' as ContextPackType,
    targetId: 'project:root',
    summary: packSummary,
    keyFacts,
    codeSnippets: [],
    relatedFiles: summary.sources,
    confidence: summary.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: summary.sources,
  };
}

/**
 * Gets or creates a project understanding pack for the workspace.
 */
export async function getProjectUnderstandingPack(
  storage: LibrarianStorage,
  workspaceRoot: string
): Promise<ContextPack | null> {
  // Try to get existing pack
  const existing = await storage.getContextPackForTarget('project:root', 'project_understanding');
  if (existing) {
    return existing;
  }

  // Create new pack on-demand
  try {
    const version = await storage.getVersion();
    if (!version) return null;

    const pack = await createProjectUnderstandingPack(workspaceRoot, version);
    await storage.upsertContextPack(pack);
    return pack;
  } catch {
    return null;
  }
}

/**
 * Options for handling project understanding queries.
 */
export interface HandleProjectUnderstandingQueryOptions {
  /** Whether to include deep project understanding analysis */
  includeDeepAnalysis?: boolean;
  /** Maximum time to spend on deep analysis (ms) */
  deepAnalysisTimeoutMs?: number;
}

/**
 * Handles a project understanding query by prioritizing high-level documentation.
 * Optionally includes deep project understanding for comprehensive context.
 */
export async function handleProjectUnderstandingQuery(
  storage: LibrarianStorage,
  workspaceRoot: string,
  existingPacks: ContextPack[],
  options?: HandleProjectUnderstandingQueryOptions
): Promise<ContextPack[]> {
  const { includeDeepAnalysis = false } = options ?? {};

  // Get or create project understanding pack
  const projectPack = await getProjectUnderstandingPack(storage, workspaceRoot);

  // Filter and prioritize existing packs
  const prioritizedPacks: ContextPack[] = [];

  // If deep analysis is requested, generate comprehensive understanding
  if (includeDeepAnalysis) {
    try {
      const version = await storage.getVersion();
      if (version) {
        const deepUnderstanding = await generateProjectUnderstanding({
          workspace: workspaceRoot,
          storage,
          includeHotspots: false, // Skip hotspots for faster response
        });
        const deepPack = createDeepProjectUnderstandingPack(deepUnderstanding, version);
        prioritizedPacks.push(deepPack);
      }
    } catch {
      // Fall back to basic pack if deep analysis fails
      if (projectPack) {
        prioritizedPacks.push(projectPack);
      }
    }
  } else {
    // Add basic project understanding pack first if available
    if (projectPack) {
      prioritizedPacks.push(projectPack);
    }
  }

  // Prioritize doc_context packs (README, AGENTS.md, etc.)
  const docPacks = existingPacks.filter(p => p.packType === 'doc_context');

  // Sort doc packs by relevance (README first, then AGENTS.md, etc.)
  docPacks.sort((a, b) => {
    const aScore = getDocRelevanceScore(a);
    const bScore = getDocRelevanceScore(b);
    return bScore - aScore;
  });

  prioritizedPacks.push(...docPacks);

  // Add some module context packs for entry points
  const modulePacks = existingPacks
    .filter(p => p.packType === 'module_context')
    .filter(p => isEntryPointPack(p))
    .slice(0, 3);

  prioritizedPacks.push(...modulePacks);

  return prioritizedPacks;
}

/**
 * Scores a documentation pack for relevance to project understanding.
 */
function getDocRelevanceScore(pack: ContextPack): number {
  const target = pack.targetId.toLowerCase();
  const files = pack.relatedFiles.map(f => f.toLowerCase());

  // README gets highest priority
  if (target.includes('readme') || files.some(f => f.includes('readme'))) {
    return 100;
  }

  // AGENTS.md, CLAUDE.md for agent context
  if (target.includes('agents') || target.includes('claude') ||
      files.some(f => f.includes('agents') || f.includes('claude'))) {
    return 90;
  }

  // CONTRIBUTING, ARCHITECTURE docs
  if (target.includes('contributing') || target.includes('architecture') ||
      files.some(f => f.includes('contributing') || f.includes('architecture'))) {
    return 80;
  }

  // Top-level docs
  if (files.some(f => !f.includes('/') || f.startsWith('docs/'))) {
    return 70;
  }

  return 50;
}

/**
 * Checks if a module pack represents an entry point.
 */
function isEntryPointPack(pack: ContextPack): boolean {
  const files = pack.relatedFiles.map(f => f.toLowerCase());
  const summary = pack.summary.toLowerCase();

  // Check for common entry point patterns
  if (files.some(f =>
    f.endsWith('index.ts') ||
    f.endsWith('index.js') ||
    f.endsWith('main.ts') ||
    f.endsWith('main.js') ||
    f.includes('/cli/') ||
    f.includes('/bin/')
  )) {
    return true;
  }

  // Check summary for entry point keywords
  if (summary.includes('entry point') ||
      summary.includes('main export') ||
      summary.includes('public api') ||
      summary.includes('cli')) {
    return true;
  }

  return false;
}

// ============================================================================
// DEEP PROJECT UNDERSTANDING SYSTEM
// ============================================================================

/**
 * Comprehensive project understanding that helps ANY agent on ANY project
 * understand context quickly. This is the main interface for deep project analysis.
 */
export interface ProjectUnderstanding {
  // Core identity
  /** Project name from package.json or directory name */
  name: string;
  /** Project description from package.json or README */
  description: string;
  /** Inferred purpose - what problem does this solve */
  purpose: string;
  /** Primary programming language */
  primaryLanguage: string;
  /** All detected languages */
  languages: string[];

  // Architecture
  architecture: {
    /** Detected architecture type */
    type: 'monolith' | 'microservices' | 'serverless' | 'library' | 'cli' | 'webapp' | 'mobile' | 'hybrid';
    /** Identified architectural layers (api, storage, utils, etc.) */
    layers: string[];
    /** Application entry points */
    entryPoints: string[];
    /** Core modules that are central to the system */
    coreModules: string[];
  };

  // Dependencies
  dependencies: {
    /** Production dependencies */
    runtime: string[];
    /** Development dependencies */
    dev: string[];
    /** Detected frameworks (React, Express, etc.) */
    frameworks: string[];
    /** Detected test frameworks (Vitest, Jest, etc.) */
    testFrameworks: string[];
  };

  // Conventions
  conventions: {
    /** Primary naming convention */
    namingStyle: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
    /** Test file naming pattern */
    testPattern: string;
    /** Config file format preference */
    configFormat: 'json' | 'yaml' | 'toml' | 'env';
    /** Import path style */
    importStyle: 'relative' | 'absolute' | 'aliased';
  };

  // Key areas for agents
  hotspots: {
    /** Files with most changes (churn) */
    mostChanged: string[];
    /** Most complex files/functions */
    mostComplex: string[];
    /** Most important/central files (by dependency graph) */
    mostImportant: string[];
  };

  // Agent guidance
  agentGuidance: {
    /** Things to check before modifying code */
    beforeModifying: string[];
    /** Common patterns used in this codebase */
    commonPatterns: string[];
    /** Anti-patterns to avoid */
    antiPatterns: string[];
    /** Testing requirements */
    testingRequirements: string[];
  };

  // Metadata
  metadata: {
    /** When this understanding was generated */
    generatedAt: string;
    /** Confidence in the analysis (0-1) */
    confidence: number;
    /** Sources used for analysis */
    sources: string[];
  };
}

/**
 * Options for generating project understanding.
 */
export interface GenerateProjectUnderstandingOptions {
  /** Workspace root directory */
  workspace: string;
  /** Storage instance for accessing indexed data */
  storage: LibrarianStorage;
  /** Include hotspot analysis (requires git history) */
  includeHotspots?: boolean;
  /** Maximum files to analyze for conventions */
  maxFilesForConventions?: number;
}

/**
 * Generates comprehensive project understanding for any codebase.
 * This is the main entry point for deep project analysis.
 *
 * @param options - Generation options including workspace and storage
 * @returns Complete project understanding
 */
export async function generateProjectUnderstanding(
  options: GenerateProjectUnderstandingOptions
): Promise<ProjectUnderstanding> {
  const { workspace, storage, includeHotspots = true, maxFilesForConventions = 100 } = options;
  const sources: string[] = [];

  // Analyze package.json for name, deps, scripts
  const pkg = await analyzePackageJson(workspace);
  if (pkg.found) sources.push('package.json');

  // Analyze directory structure for architecture
  const structure = await analyzeDirectoryStructure(workspace, storage);
  if (structure.analyzed) sources.push('directory_structure');

  // Analyze code for conventions
  const conventions = await analyzeCodeConventions(storage, maxFilesForConventions);
  if (conventions.analyzed) sources.push('code_analysis');

  // Identify hotspots if requested
  const hotspots = includeHotspots
    ? await identifyHotspots(storage)
    : { mostChanged: [], mostComplex: [], mostImportant: [] };

  // Detect entry points
  const entryPoints = await findEntryPoints(workspace, storage);
  if (entryPoints.length > 0) sources.push('entry_point_detection');

  // Identify core modules (most depended upon)
  const coreModules = await identifyCoreModules(storage);

  // Generate agent guidance
  const guidance = await generateAgentGuidance(storage, conventions);

  // Calculate confidence based on data quality
  const confidence = calculateConfidence(pkg, structure, conventions, entryPoints);

  return {
    name: pkg.name || path.basename(workspace),
    description: pkg.description || structure.description || '',
    purpose: inferProjectPurpose(pkg, structure),
    primaryLanguage: structure.primaryLanguage,
    languages: structure.languages,
    architecture: {
      type: inferArchitectureType(structure, pkg),
      layers: structure.layers,
      entryPoints: entryPoints.map(ep => ep.relativePath),
      coreModules,
    },
    dependencies: {
      runtime: Object.keys(pkg.dependencies || {}),
      dev: Object.keys(pkg.devDependencies || {}),
      frameworks: detectFrameworks(pkg),
      testFrameworks: detectTestFrameworks(pkg),
    },
    conventions,
    hotspots,
    agentGuidance: guidance,
    metadata: {
      generatedAt: new Date().toISOString(),
      confidence,
      sources,
    },
  };
}

// ============================================================================
// PACKAGE.JSON ANALYSIS
// ============================================================================

interface PackageJsonAnalysis {
  found: boolean;
  name: string;
  description: string;
  version: string;
  main: string;
  bin: Record<string, string> | string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  keywords: string[];
  type: string;
}

async function analyzePackageJson(workspace: string): Promise<PackageJsonAnalysis> {
  const defaultResult: PackageJsonAnalysis = {
    found: false,
    name: '',
    description: '',
    version: '',
    main: '',
    bin: {},
    scripts: {},
    dependencies: {},
    devDependencies: {},
    keywords: [],
    type: 'commonjs',
  };

  try {
    const pkgPath = path.join(workspace, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    return {
      found: true,
      name: pkg.name ?? '',
      description: pkg.description ?? '',
      version: pkg.version ?? '',
      main: pkg.main ?? '',
      bin: pkg.bin ?? {},
      scripts: pkg.scripts ?? {},
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      keywords: pkg.keywords ?? [],
      type: pkg.type ?? 'commonjs',
    };
  } catch {
    return defaultResult;
  }
}

// ============================================================================
// DIRECTORY STRUCTURE ANALYSIS
// ============================================================================

interface DirectoryStructureAnalysis {
  analyzed: boolean;
  description: string;
  primaryLanguage: string;
  languages: string[];
  layers: string[];
  hasReactComponents: boolean;
  hasExpressRoutes: boolean;
  hasCliCommands: boolean;
  hasTests: boolean;
  hasDocs: boolean;
  topLevelDirs: string[];
}

async function analyzeDirectoryStructure(
  workspace: string,
  storage: LibrarianStorage
): Promise<DirectoryStructureAnalysis> {
  const defaultResult: DirectoryStructureAnalysis = {
    analyzed: false,
    description: '',
    primaryLanguage: 'unknown',
    languages: [],
    layers: [],
    hasReactComponents: false,
    hasExpressRoutes: false,
    hasCliCommands: false,
    hasTests: false,
    hasDocs: false,
    topLevelDirs: [],
  };

  try {
    // Get all files from storage
    const files = await storage.getFiles({ limit: 1000 });
    if (files.length === 0) {
      // Fallback to filesystem scan
      return await analyzeDirectoryFromFilesystem(workspace);
    }

    // Detect languages from file extensions
    const extensionCounts: Record<string, number> = {};
    for (const file of files) {
      const ext = file.extension.toLowerCase();
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    }

    const languages = detectLanguagesFromExtensions(extensionCounts);
    const primaryLanguage = languages[0] || 'unknown';

    // Detect layers from directory structure
    const layers = detectLayers(files);

    // Detect patterns
    const hasReactComponents = files.some(f =>
      f.path.includes('component') ||
      f.extension === 'tsx' ||
      f.extension === 'jsx'
    );
    const hasExpressRoutes = files.some(f =>
      f.path.includes('routes') ||
      f.path.includes('router')
    );
    const hasCliCommands = files.some(f =>
      f.path.includes('/cli/') ||
      f.path.includes('/bin/')
    );
    const hasTests = files.some(f =>
      f.path.includes('__tests__') ||
      f.path.includes('.test.') ||
      f.path.includes('.spec.')
    );
    const hasDocs = files.some(f =>
      f.path.includes('/docs/') ||
      f.name.toLowerCase().includes('readme')
    );

    // Get top-level directories
    const topLevelDirs = getTopLevelDirectories(files);

    return {
      analyzed: true,
      description: `${primaryLanguage} project with ${files.length} files across ${layers.length} layers`,
      primaryLanguage,
      languages,
      layers,
      hasReactComponents,
      hasExpressRoutes,
      hasCliCommands,
      hasTests,
      hasDocs,
      topLevelDirs,
    };
  } catch {
    return defaultResult;
  }
}

async function analyzeDirectoryFromFilesystem(workspace: string): Promise<DirectoryStructureAnalysis> {
  const result: DirectoryStructureAnalysis = {
    analyzed: true,
    description: '',
    primaryLanguage: 'unknown',
    languages: [],
    layers: [],
    hasReactComponents: false,
    hasExpressRoutes: false,
    hasCliCommands: false,
    hasTests: false,
    hasDocs: false,
    topLevelDirs: [],
  };

  try {
    const entries = await fs.readdir(workspace, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    result.topLevelDirs = dirs.map(d => d.name);

    // Detect common patterns
    result.hasTests = dirs.some(d => ['test', 'tests', '__tests__', 'spec'].includes(d.name));
    result.hasDocs = dirs.some(d => ['docs', 'doc', 'documentation'].includes(d.name));
    result.hasCliCommands = dirs.some(d => ['cli', 'bin', 'commands'].includes(d.name));

    // Check for src directory structure
    if (dirs.some(d => d.name === 'src')) {
      try {
        const srcEntries = await fs.readdir(path.join(workspace, 'src'), { withFileTypes: true });
        const srcDirs = srcEntries.filter(e => e.isDirectory()).map(e => e.name);
        result.layers = srcDirs.filter(d =>
          ['api', 'storage', 'utils', 'lib', 'core', 'services', 'components', 'routes', 'models'].includes(d)
        );
      } catch {
        // src directory read failed
      }
    }

    const rootFiles = entries.filter(e => e.isFile());
    const rootLanguageMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.mjs': 'JavaScript',
      '.cjs': 'JavaScript',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.kts': 'Kotlin',
      '.swift': 'Swift',
      '.scala': 'Scala',
      '.dart': 'Dart',
      '.cs': 'C#',
      '.c': 'C',
      '.cpp': 'C++',
      '.cc': 'C++',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.lua': 'Lua',
      '.r': 'R',
    };
    for (const file of rootFiles) {
      const ext = path.extname(file.name).toLowerCase();
      const lang = rootLanguageMap[ext];
      if (lang) {
        result.primaryLanguage = lang;
        result.languages = lang === 'TypeScript' ? ['TypeScript', 'JavaScript'] : [lang];
        break;
      }
    }

    result.description = `${result.primaryLanguage} project with ${result.topLevelDirs.length} directories`;
  } catch {
    // Filesystem read failed
  }

  return result;
}

function detectLanguagesFromExtensions(extensionCounts: Record<string, number>): string[] {
  const languageMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    mts: 'TypeScript',
    cts: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    kt: 'Kotlin',
    kts: 'Kotlin',
    swift: 'Swift',
    scala: 'Scala',
    sc: 'Scala',
    rb: 'Ruby',
    php: 'PHP',
    cs: 'C#',
    cpp: 'C++',
    cc: 'C++',
    cxx: 'C++',
    hpp: 'C++',
    c: 'C',
    h: 'C',
    dart: 'Dart',
    lua: 'Lua',
    r: 'R',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    md: 'Markdown',
    json: 'JSON',
    jsonc: 'JSON',
    json5: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
  };

  const languageCounts: Record<string, number> = {};
  for (const [ext, count] of Object.entries(extensionCounts)) {
    const lang = languageMap[ext];
    if (lang) {
      languageCounts[lang] = (languageCounts[lang] || 0) + count;
    }
  }

  // Sort by count and return
  return Object.entries(languageCounts)
    .filter(([lang]) => !['JSON', 'YAML', 'Markdown', 'SQL'].includes(lang)) // Exclude config/doc langs from primary
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

function detectLayers(files: FileKnowledge[]): string[] {
  const layerSet = new Set<string>();
  const commonLayers = ['api', 'storage', 'utils', 'lib', 'core', 'services', 'components',
                        'routes', 'models', 'controllers', 'views', 'middleware', 'hooks',
                        'providers', 'context', 'actions', 'reducers', 'selectors', 'types',
                        'schemas', 'validators', 'helpers', 'constants', 'config', 'cli',
                        'ingest', 'knowledge', 'graphs', 'strategic', 'evaluation', 'query'];

  for (const file of files) {
    const parts = file.path.split(path.sep);
    for (const part of parts) {
      if (commonLayers.includes(part.toLowerCase())) {
        layerSet.add(part);
      }
    }
  }

  return Array.from(layerSet);
}

function getTopLevelDirectories(files: FileKnowledge[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const relativePath = file.relativePath || file.path;
    const parts = relativePath.split(/[/\\]/);
    if (parts.length > 1 && parts[0] && !parts[0].startsWith('.')) {
      dirs.add(parts[0]);
    }
  }
  return Array.from(dirs).slice(0, 20);
}

// ============================================================================
// CODE CONVENTIONS ANALYSIS
// ============================================================================

/**
 * Conventions analysis result with explicit properties.
 */
interface ConventionsAnalysis {
  analyzed: boolean;
  namingStyle: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
  testPattern: string;
  configFormat: 'json' | 'yaml' | 'toml' | 'env';
  importStyle: 'relative' | 'absolute' | 'aliased';
}

async function analyzeCodeConventions(
  storage: LibrarianStorage,
  maxFiles: number
): Promise<ConventionsAnalysis> {
  const defaultResult: ConventionsAnalysis = {
    analyzed: false,
    namingStyle: 'camelCase',
    testPattern: '**/*.test.ts',
    configFormat: 'json',
    importStyle: 'relative',
  };

  try {
    const functions = await storage.getFunctions({ limit: maxFiles });
    if (functions.length === 0) {
      return defaultResult;
    }

    // Analyze naming conventions from function names
    const namingStyle = detectNamingStyle(functions);

    // Analyze test patterns
    const testPattern = await detectTestPattern(storage);

    // Analyze import style
    const modules = await storage.getModules({ limit: maxFiles });
    const importStyle = detectImportStyle(modules);

    // Detect config format preference
    const configFormat = await detectConfigFormat(storage);

    return {
      analyzed: true,
      namingStyle,
      testPattern,
      configFormat,
      importStyle,
    };
  } catch {
    return defaultResult;
  }
}

function detectNamingStyle(functions: FunctionKnowledge[]): 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case' {
  const counts = {
    camelCase: 0,
    snake_case: 0,
    PascalCase: 0,
    'kebab-case': 0,
  };

  for (const fn of functions) {
    const name = fn.name;
    if (!name) continue;

    if (name.includes('_')) {
      counts.snake_case++;
    } else if (name.includes('-')) {
      counts['kebab-case']++;
    } else if (name[0] === name[0].toUpperCase() && name.length > 1) {
      counts.PascalCase++;
    } else {
      counts.camelCase++;
    }
  }

  // Return the most common style
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][0] as 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
}

async function detectTestPattern(storage: LibrarianStorage): Promise<string> {
  try {
    const files = await storage.getFiles({ category: 'test', limit: 50 });
    if (files.length === 0) {
      return '**/*.test.ts';
    }

    // Check common patterns
    const patterns = {
      '.test.ts': 0,
      '.spec.ts': 0,
      '.test.js': 0,
      '.spec.js': 0,
      '_test.go': 0,
      '_test.py': 0,
    };

    for (const file of files) {
      const name = file.name.toLowerCase();
      for (const pattern of Object.keys(patterns)) {
        if (name.includes(pattern.replace('.', ''))) {
          patterns[pattern as keyof typeof patterns]++;
        }
      }
    }

    const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > 0) {
      const pattern = sorted[0][0];
      const ext = pattern.split('.').pop() || 'ts';
      return `**/*${pattern.replace(`.${ext}`, '')}.${ext}`;
    }

    return '**/*.test.ts';
  } catch {
    return '**/*.test.ts';
  }
}

function detectImportStyle(modules: ModuleKnowledge[]): 'relative' | 'absolute' | 'aliased' {
  let relativeCount = 0;
  let absoluteCount = 0;
  let aliasedCount = 0;

  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      if (dep.startsWith('./') || dep.startsWith('../')) {
        relativeCount++;
      } else if (dep.startsWith('@/') || dep.startsWith('~')) {
        aliasedCount++;
      } else if (dep.startsWith('/')) {
        absoluteCount++;
      }
    }
  }

  if (aliasedCount > relativeCount && aliasedCount > absoluteCount) {
    return 'aliased';
  } else if (absoluteCount > relativeCount) {
    return 'absolute';
  }
  return 'relative';
}

async function detectConfigFormat(storage: LibrarianStorage): Promise<'json' | 'yaml' | 'toml' | 'env'> {
  try {
    const files = await storage.getFiles({ category: 'config', limit: 50 });

    const counts = { json: 0, yaml: 0, toml: 0, env: 0 };
    for (const file of files) {
      const ext = file.extension.toLowerCase();
      if (ext === 'json') counts.json++;
      else if (ext === 'yaml' || ext === 'yml') counts.yaml++;
      else if (ext === 'toml') counts.toml++;
      else if (file.name.startsWith('.env')) counts.env++;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][0] as 'json' | 'yaml' | 'toml' | 'env';
  } catch {
    return 'json';
  }
}

// ============================================================================
// HOTSPOT IDENTIFICATION
// ============================================================================

async function identifyHotspots(storage: LibrarianStorage): Promise<ProjectUnderstanding['hotspots']> {
  const result: ProjectUnderstanding['hotspots'] = {
    mostChanged: [],
    mostComplex: [],
    mostImportant: [],
  };

  try {
    // Get functions for complexity analysis
    const functions = await storage.getFunctions({ limit: 500 });

    // Build hotspot inputs from available data
    const inputs: HotspotInput[] = functions.map(fn => ({
      entityId: fn.filePath,
      entityType: 'file' as const,
      // Use validation count as a proxy for changes if available
      commitCount: fn.validationCount || 0,
      // Use outcome history as quality signal
      cyclomaticComplexity: fn.endLine - fn.startLine, // Proxy: lines as complexity indicator
    }));

    // Deduplicate by file
    const fileInputs = new Map<string, HotspotInput>();
    for (const input of inputs) {
      const existing = fileInputs.get(input.entityId);
      if (!existing || (input.commitCount || 0) > (existing.commitCount || 0)) {
        fileInputs.set(input.entityId, input);
      }
    }

    if (fileInputs.size > 0) {
      const scores = computeHotspotScores(Array.from(fileInputs.values()));

      // Extract most changed (high churn)
      const byChurn = [...scores].sort((a, b) => b.churnScore - a.churnScore);
      result.mostChanged = byChurn.slice(0, 10).map(s => extractRelativePathFromId(s.entityId));

      // Extract most complex
      const byComplexity = [...scores].sort((a, b) => b.complexityScore - a.complexityScore);
      result.mostComplex = byComplexity.slice(0, 10).map(s => extractRelativePathFromId(s.entityId));
    }

    // Get most important by graph centrality
    try {
      const graphMetrics = await storage.getGraphMetrics({ limit: 20 });
      result.mostImportant = graphMetrics
        .sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0))
        .slice(0, 10)
        .map(m => extractRelativePathFromId(m.entityId));
    } catch {
      // Graph metrics not available - use function access counts
      const byAccess = [...functions].sort((a, b) => b.accessCount - a.accessCount);
      result.mostImportant = [...new Set(byAccess.slice(0, 10).map(f => extractRelativePathFromId(f.filePath)))];
    }
  } catch {
    // Return empty hotspots if analysis fails
  }

  return result;
}

function extractRelativePathFromId(fullPath: string): string {
  // Extract relative path from full path
  const markers = ['/src/', '\\src\\', '/lib/', '\\lib\\'];
  for (const marker of markers) {
    const idx = fullPath.indexOf(marker);
    if (idx !== -1) {
      return fullPath.slice(idx + 1);
    }
  }
  // Fallback: return last 3 path segments
  const parts = fullPath.split(/[/\\]/);
  return parts.slice(-3).join('/');
}

// ============================================================================
// ENTRY POINT DETECTION
// ============================================================================

async function findEntryPoints(
  workspace: string,
  storage: LibrarianStorage
): Promise<DetectedEntryPoint[]> {
  try {
    const functions = await storage.getFunctions({ limit: 1000 });
    const modules = await storage.getModules({ limit: 500 });

    const result = await detectEntryPoints({
      workspace,
      functions,
      modules,
      includeIndexFiles: true,
      includeCliEntries: true,
    });

    return result.entryPoints.slice(0, 20); // Top 20 entry points
  } catch {
    // Return empty if detection fails
    return [];
  }
}

// ============================================================================
// CORE MODULE IDENTIFICATION
// ============================================================================

async function identifyCoreModules(storage: LibrarianStorage): Promise<string[]> {
  try {
    // Core modules are those that many other modules depend on
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'], limit: 5000 });

    // Count incoming imports
    const importCounts = new Map<string, number>();
    for (const edge of edges) {
      const current = importCounts.get(edge.toId) || 0;
      importCounts.set(edge.toId, current + 1);
    }

    // Sort by import count and return top modules
    const sorted = Array.from(importCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    return sorted.map(([id]) => extractRelativePathFromId(id));
  } catch {
    return [];
  }
}

// ============================================================================
// PURPOSE INFERENCE
// ============================================================================

function inferProjectPurpose(pkg: PackageJsonAnalysis, structure: DirectoryStructureAnalysis): string {
  const hints: string[] = [];

  // Check keywords
  if (pkg.keywords?.includes('cli')) hints.push('Command-line tool');
  if (pkg.keywords?.includes('api')) hints.push('API service');
  if (pkg.keywords?.includes('library') || pkg.keywords?.includes('lib')) hints.push('Library/SDK');
  if (pkg.keywords?.includes('framework')) hints.push('Framework');

  // Check bin field
  if (pkg.bin && Object.keys(pkg.bin).length > 0) {
    hints.push('Executable CLI');
  }

  // Check structure patterns
  if (structure.hasReactComponents) hints.push('React application');
  if (structure.hasExpressRoutes) hints.push('Express web server');
  if (structure.hasCliCommands) hints.push('CLI application');

  // Use description as fallback
  if (pkg.description) {
    hints.push(pkg.description);
  }

  return hints.join('. ') || 'Software project (purpose not detected)';
}

// ============================================================================
// ARCHITECTURE TYPE INFERENCE
// ============================================================================

function inferArchitectureType(
  structure: DirectoryStructureAnalysis,
  pkg: PackageJsonAnalysis
): ProjectUnderstanding['architecture']['type'] {
  // Check for CLI
  if (pkg.bin && Object.keys(pkg.bin).length > 0) {
    return 'cli';
  }
  if (structure.hasCliCommands) {
    return 'cli';
  }

  // Check for webapp patterns
  if (structure.hasReactComponents) {
    return 'webapp';
  }

  // Check for microservices patterns (multiple service dirs)
  const servicePatterns = ['services', 'microservices', 'apps'];
  if (structure.topLevelDirs.some(d => servicePatterns.includes(d.toLowerCase()))) {
    return 'microservices';
  }

  // Check for serverless patterns
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['serverless'] || deps['aws-lambda'] || deps['@aws-cdk/core']) {
    return 'serverless';
  }

  // Check for library patterns
  if (pkg.main || (pkg.keywords && pkg.keywords.includes('library'))) {
    // Has main entry and exports - likely a library
    return 'library';
  }

  // Check for mobile patterns
  if (deps['react-native'] || deps['expo'] || deps['@capacitor/core']) {
    return 'mobile';
  }

  // Check for mixed patterns
  if (structure.hasExpressRoutes && structure.hasReactComponents) {
    return 'hybrid';
  }

  // Default to monolith
  return 'monolith';
}

// ============================================================================
// FRAMEWORK DETECTION
// ============================================================================

function detectFrameworks(pkg: PackageJsonAnalysis): string[] {
  const frameworks: string[] = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Frontend frameworks
  if (deps['react'] || deps['react-dom']) frameworks.push('React');
  if (deps['vue']) frameworks.push('Vue');
  if (deps['@angular/core']) frameworks.push('Angular');
  if (deps['svelte']) frameworks.push('Svelte');
  if (deps['solid-js']) frameworks.push('Solid');
  if (deps['next']) frameworks.push('Next.js');
  if (deps['nuxt']) frameworks.push('Nuxt');
  if (deps['astro']) frameworks.push('Astro');

  // Backend frameworks
  if (deps['express']) frameworks.push('Express');
  if (deps['fastify']) frameworks.push('Fastify');
  if (deps['koa']) frameworks.push('Koa');
  if (deps['hapi'] || deps['@hapi/hapi']) frameworks.push('Hapi');
  if (deps['nestjs'] || deps['@nestjs/core']) frameworks.push('NestJS');

  // Database/ORM
  if (deps['prisma'] || deps['@prisma/client']) frameworks.push('Prisma');
  if (deps['typeorm']) frameworks.push('TypeORM');
  if (deps['mongoose']) frameworks.push('Mongoose');
  if (deps['drizzle-orm']) frameworks.push('Drizzle');

  // Other
  if (deps['graphql']) frameworks.push('GraphQL');
  if (deps['trpc'] || deps['@trpc/server']) frameworks.push('tRPC');
  if (deps['socket.io']) frameworks.push('Socket.io');

  return frameworks;
}

function detectTestFrameworks(pkg: PackageJsonAnalysis): string[] {
  const frameworks: string[] = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['vitest']) frameworks.push('Vitest');
  if (deps['jest']) frameworks.push('Jest');
  if (deps['mocha']) frameworks.push('Mocha');
  if (deps['ava']) frameworks.push('AVA');
  if (deps['tap']) frameworks.push('TAP');
  if (deps['cypress']) frameworks.push('Cypress');
  if (deps['playwright'] || deps['@playwright/test']) frameworks.push('Playwright');
  if (deps['@testing-library/react']) frameworks.push('Testing Library');

  return frameworks;
}

// ============================================================================
// AGENT GUIDANCE GENERATION
// ============================================================================

async function generateAgentGuidance(
  storage: LibrarianStorage,
  conventions: ConventionsAnalysis
): Promise<ProjectUnderstanding['agentGuidance']> {
  const functions = await storage.getFunctions({ limit: 200 });

  // Extract common patterns from function names and structures
  const commonPatterns = extractCommonPatterns(functions);

  return {
    beforeModifying: [
      'Check for existing tests in __tests__ directory or *.test.* files',
      'Review related functions in the same module',
      'Check for usage patterns in the codebase (use grep/search)',
      'Verify type compatibility with existing code',
      'Look for similar implementations to follow the same pattern',
      'Check AGENTS.md or similar documentation for project-specific guidance',
    ],
    commonPatterns,
    antiPatterns: [
      'Avoid circular dependencies between modules',
      'Don\'t bypass error handling patterns used elsewhere',
      'Maintain existing naming conventions (' + conventions.namingStyle + ')',
      'Don\'t mix import styles (project uses ' + conventions.importStyle + ')',
      'Avoid adding large new dependencies without justification',
    ],
    testingRequirements: [
      `Tests should follow ${conventions.testPattern} pattern`,
      'All public functions should have corresponding tests',
      'Mock external dependencies (API calls, file system, databases)',
      'Include both positive and negative test cases',
      'Run existing tests before and after changes',
    ],
  };
}

function extractCommonPatterns(functions: FunctionKnowledge[]): string[] {
  const patterns: string[] = [];
  const namePatterns = new Map<string, number>();

  // Look for common prefixes/patterns
  for (const fn of functions) {
    const name = fn.name;
    if (!name) continue;

    // Check for common patterns
    if (name.startsWith('create')) namePatterns.set('Factory pattern (createXxx)', (namePatterns.get('Factory pattern (createXxx)') || 0) + 1);
    if (name.startsWith('get')) namePatterns.set('Getter pattern (getXxx)', (namePatterns.get('Getter pattern (getXxx)') || 0) + 1);
    if (name.startsWith('set')) namePatterns.set('Setter pattern (setXxx)', (namePatterns.get('Setter pattern (setXxx)') || 0) + 1);
    if (name.startsWith('is') || name.startsWith('has')) namePatterns.set('Boolean accessor (isXxx/hasXxx)', (namePatterns.get('Boolean accessor (isXxx/hasXxx)') || 0) + 1);
    if (name.startsWith('handle')) namePatterns.set('Event handler (handleXxx)', (namePatterns.get('Event handler (handleXxx)') || 0) + 1);
    if (name.startsWith('use')) namePatterns.set('Hook pattern (useXxx)', (namePatterns.get('Hook pattern (useXxx)') || 0) + 1);
    if (name.endsWith('Async')) namePatterns.set('Async suffix convention', (namePatterns.get('Async suffix convention') || 0) + 1);
  }

  // Return patterns with significant usage (>3 occurrences)
  for (const [pattern, count] of namePatterns) {
    if (count > 3) {
      patterns.push(pattern);
    }
  }

  // Add some universal patterns
  if (patterns.length < 3) {
    patterns.push('Use async/await for asynchronous operations');
    patterns.push('Export public functions at module level');
    patterns.push('Group related functions in the same file');
  }

  return patterns.slice(0, 8);
}

// ============================================================================
// CONFIDENCE CALCULATION
// ============================================================================

function calculateConfidence(
  pkg: PackageJsonAnalysis,
  structure: DirectoryStructureAnalysis,
  conventions: ConventionsAnalysis,
  entryPoints: DetectedEntryPoint[]
): number {
  let confidence = 0.3; // Base confidence

  if (pkg.found) confidence += 0.2;
  if (pkg.description) confidence += 0.1;
  if (structure.analyzed) confidence += 0.15;
  if (structure.layers.length > 0) confidence += 0.1;
  if (conventions.analyzed) confidence += 0.1;
  if (entryPoints.length > 0) confidence += 0.15;

  return Math.min(0.95, confidence);
}

// ============================================================================
// AGENT CONTEXT PROMPT GENERATION
// ============================================================================

/**
 * Generates a concise context prompt for agent system prompts.
 * This gives any agent immediate understanding of the project.
 *
 * @param understanding - The full project understanding
 * @returns Formatted string for inclusion in agent prompts
 */
export function generateAgentContextPrompt(understanding: ProjectUnderstanding): string {
  const coreModulesStr = understanding.architecture.coreModules.length > 0
    ? understanding.architecture.coreModules.slice(0, 5).join(', ')
    : 'Not yet identified';

  const entryPointsStr = understanding.architecture.entryPoints.length > 0
    ? understanding.architecture.entryPoints.slice(0, 3).join(', ')
    : 'Not yet identified';

  const frameworksStr = understanding.dependencies.frameworks.length > 0
    ? understanding.dependencies.frameworks.join(', ')
    : 'None detected';

  return `
PROJECT: ${understanding.name}
PURPOSE: ${understanding.purpose}
TYPE: ${understanding.architecture.type}
LANGUAGES: ${understanding.languages.join(', ')}
FRAMEWORKS: ${frameworksStr}
CORE MODULES: ${coreModulesStr}
ENTRY POINTS: ${entryPointsStr}

CONVENTIONS:
- Naming: ${understanding.conventions.namingStyle}
- Imports: ${understanding.conventions.importStyle}
- Tests: ${understanding.conventions.testPattern}
- Config: ${understanding.conventions.configFormat}

BEFORE MODIFYING CODE:
${understanding.agentGuidance.beforeModifying.map(g => `- ${g}`).join('\n')}

COMMON PATTERNS:
${understanding.agentGuidance.commonPatterns.map(p => `- ${p}`).join('\n')}

ANTI-PATTERNS TO AVOID:
${understanding.agentGuidance.antiPatterns.slice(0, 3).map(p => `- ${p}`).join('\n')}
`.trim();
}

/**
 * Creates a comprehensive project understanding context pack.
 * This pack can be cached and served for project-level queries.
 *
 * @param understanding - The full project understanding
 * @param version - Librarian version for the pack
 * @returns Context pack containing project understanding
 */
export function createDeepProjectUnderstandingPack(
  understanding: ProjectUnderstanding,
  version: LibrarianVersion
): ContextPack {
  const keyFacts: string[] = [
    `Name: ${understanding.name}`,
    `Purpose: ${understanding.purpose}`,
    `Type: ${understanding.architecture.type}`,
    `Languages: ${understanding.languages.join(', ')}`,
    `Layers: ${understanding.architecture.layers.join(', ')}`,
    `Frameworks: ${understanding.dependencies.frameworks.join(', ')}`,
    `Test Frameworks: ${understanding.dependencies.testFrameworks.join(', ')}`,
  ];

  if (understanding.architecture.entryPoints.length > 0) {
    keyFacts.push(`Entry Points: ${understanding.architecture.entryPoints.slice(0, 5).join(', ')}`);
  }

  if (understanding.architecture.coreModules.length > 0) {
    keyFacts.push(`Core Modules: ${understanding.architecture.coreModules.slice(0, 5).join(', ')}`);
  }

  if (understanding.hotspots.mostImportant.length > 0) {
    keyFacts.push(`Most Important Files: ${understanding.hotspots.mostImportant.slice(0, 5).join(', ')}`);
  }

  const agentPrompt = generateAgentContextPrompt(understanding);

  return {
    packId: `deep_project_understanding_${understanding.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
    packType: 'project_understanding' as ContextPackType,
    targetId: 'project:root:deep',
    summary: agentPrompt,
    keyFacts,
    codeSnippets: [],
    relatedFiles: understanding.metadata.sources,
    confidence: understanding.metadata.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: ['package.json', 'README.md', 'AGENTS.md', 'tsconfig.json'],
  };
}
