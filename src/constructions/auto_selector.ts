/**
 * @fileoverview Automatic Constructable Selection
 *
 * Detects project characteristics and automatically selects appropriate
 * constructions based on:
 * - Project structure (monorepo, microservices, etc.)
 * - Language/framework detection (TypeScript, React, Django, etc.)
 * - Configuration files (package.json, pyproject.toml, Cargo.toml, etc.)
 * - Pattern detection (testing frameworks, build tools, etc.)
 *
 * This enables agents to auto-enable relevant constructions without
 * manual configuration, improving out-of-box experience.
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import type {
  ProjectType,
  Language,
  FrameworkCategory,
  Framework,
  ProjectPattern,
  ConstructableId,
} from './constructable_types.js';
import {
  listConstructableDefinitions,
  getConstructableDefinition,
  type ConstructableDefinition,
} from './constructable_registry.js';

export type {
  ProjectType,
  Language,
  FrameworkCategory,
  Framework,
  ProjectPattern,
  ConstructableId,
} from './constructable_types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Detected project type with confidence.
 */
export interface DetectedProjectType {
  /** Project type identifier */
  type: ProjectType;
  /** Confidence in detection (0-1) */
  confidence: number;
  /** Evidence supporting detection */
  evidence: string[];
}

/**
 * Detected framework with confidence.
 */
export interface DetectedFramework {
  /** Framework identifier */
  framework: Framework;
  /** Framework category */
  category: FrameworkCategory;
  /** Confidence in detection (0-1) */
  confidence: number;
  /** Version if detected */
  version?: string;
  /** Evidence supporting detection */
  evidence: string[];
}

/**
 * Detected project pattern.
 */
export interface DetectedPattern {
  /** Pattern identifier */
  pattern: ProjectPattern;
  /** Confidence in detection (0-1) */
  confidence: number;
  /** Evidence supporting detection */
  evidence: string[];
}

/**
 * Configuration for a constructable.
 */
export interface ConstructableConfig {
  /** Constructable identifier */
  id: ConstructableId;
  /** Whether enabled by default */
  enabled: boolean;
  /** Confidence in this recommendation (0-1) */
  confidence: number;
  /** Reason for recommendation */
  reason: string;
  /** Priority (higher = more important) */
  priority: number;
  /** Configuration overrides */
  config?: Record<string, unknown>;
}

/**
 * Result of project analysis.
 */
export interface ProjectAnalysis {
  /** Detected project types */
  projectTypes: DetectedProjectType[];
  /** Detected frameworks */
  frameworks: DetectedFramework[];
  /** Detected patterns */
  patterns: DetectedPattern[];
  /** Primary language */
  primaryLanguage: Language | null;
  /** All detected languages */
  languages: Language[];
  /** Has TypeScript */
  hasTypeScript: boolean;
  /** Has JavaScript */
  hasJavaScript: boolean;
  /** Is monorepo */
  isMonorepo: boolean;
  /** Has tests */
  hasTests: boolean;
  /** Testing frameworks */
  testingFrameworks: string[];
  /** Build tools */
  buildTools: string[];
  /** Package managers */
  packageManagers: string[];
}

/**
 * Optimal constructable configuration.
 */
export interface OptimalConstructableConfig {
  /** Enabled constructables */
  enabled: ConstructableId[];
  /** Disabled constructables (explicitly not recommended) */
  disabled: ConstructableId[];
  /** Full configuration for each constructable */
  configurations: ConstructableConfig[];
  /** Overall confidence in recommendations */
  confidence: number;
  /** Project analysis details */
  analysis: ProjectAnalysis;
  /** Reasons for recommendations */
  reasons: string[];
}

/**
 * Manual override configuration.
 */
export interface ManualOverrides {
  /** Force enable these constructables */
  forceEnable?: ConstructableId[];
  /** Force disable these constructables */
  forceDisable?: ConstructableId[];
  /** Custom configuration overrides */
  configOverrides?: Partial<Record<ConstructableId, Record<string, unknown>>>;
  /** Minimum confidence threshold for auto-enabling */
  minConfidence?: number;
}

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * Project detection and constructable identifiers are defined in
 * ./constructable_types.ts and re-exported from this module.
 */

// ============================================================================
// DETECTION RULES
// ============================================================================

interface FileDetectionRule {
  files: string[];
  detect: Language | Framework | ProjectPattern | ProjectType;
  type: 'language' | 'framework' | 'pattern' | 'projectType';
  category?: FrameworkCategory;
  confidence: number;
}

interface ContentDetectionRule {
  file: string;
  patterns: RegExp[];
  detect: Framework | ProjectPattern;
  type: 'framework' | 'pattern';
  category?: FrameworkCategory;
  confidence: number;
  versionPattern?: RegExp;
}

const FILE_DETECTION_RULES: FileDetectionRule[] = [
  // Languages
  { files: ['tsconfig.json', 'tsconfig.*.json'], detect: 'typescript', type: 'language', confidence: 1.0 },
  { files: ['package.json'], detect: 'javascript', type: 'language', confidence: 0.7 },
  { files: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'], detect: 'python', type: 'language', confidence: 1.0 },
  { files: ['Cargo.toml'], detect: 'rust', type: 'language', confidence: 1.0 },
  { files: ['go.mod', 'go.sum'], detect: 'go', type: 'language', confidence: 1.0 },
  { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], detect: 'java', type: 'language', confidence: 1.0 },
  { files: ['*.csproj', '*.sln'], detect: 'csharp', type: 'language', confidence: 1.0 },
  { files: ['Gemfile', '*.gemspec'], detect: 'ruby', type: 'language', confidence: 1.0 },
  { files: ['composer.json'], detect: 'php', type: 'language', confidence: 1.0 },
  { files: ['Package.swift'], detect: 'swift', type: 'language', confidence: 1.0 },
  { files: ['build.gradle.kts'], detect: 'kotlin', type: 'language', confidence: 0.8 },
  { files: ['build.sbt'], detect: 'scala', type: 'language', confidence: 1.0 },
  { files: ['mix.exs'], detect: 'elixir', type: 'language', confidence: 1.0 },

  // Project Patterns
  { files: ['turbo.json'], detect: 'monorepo-turborepo', type: 'pattern', confidence: 1.0 },
  { files: ['nx.json'], detect: 'monorepo-nx', type: 'pattern', confidence: 1.0 },
  { files: ['lerna.json'], detect: 'monorepo-lerna', type: 'pattern', confidence: 1.0 },
  { files: ['pnpm-workspace.yaml'], detect: 'monorepo-pnpm', type: 'pattern', confidence: 1.0 },
  { files: ['.github/workflows/*.yml', '.github/workflows/*.yaml'], detect: 'ci-cd-github-actions', type: 'pattern', confidence: 1.0 },
  { files: ['.gitlab-ci.yml'], detect: 'ci-cd-gitlab', type: 'pattern', confidence: 1.0 },
  { files: ['.circleci/config.yml'], detect: 'ci-cd-circleci', type: 'pattern', confidence: 1.0 },
  { files: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'], detect: 'containerized', type: 'pattern', confidence: 0.9 },
  { files: ['serverless.yml', 'serverless.yaml', 'serverless.ts'], detect: 'serverless', type: 'pattern', confidence: 1.0 },
  { files: ['terraform/*.tf', 'pulumi/*.ts', 'cdk.json'], detect: 'infrastructure-as-code', type: 'pattern', confidence: 1.0 },

  // Frameworks - Testing
  { files: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'], detect: 'jest', type: 'framework', category: 'testing', confidence: 1.0 },
  { files: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'], detect: 'vitest', type: 'framework', category: 'testing', confidence: 1.0 },
  { files: ['.mocharc.js', '.mocharc.json', '.mocharc.yml'], detect: 'mocha', type: 'framework', category: 'testing', confidence: 1.0 },
  { files: ['pytest.ini', 'pyproject.toml'], detect: 'pytest', type: 'framework', category: 'testing', confidence: 0.7 },
  { files: ['cypress.config.js', 'cypress.config.ts', 'cypress.json'], detect: 'cypress', type: 'framework', category: 'testing', confidence: 1.0 },
  { files: ['playwright.config.js', 'playwright.config.ts'], detect: 'playwright', type: 'framework', category: 'testing', confidence: 1.0 },

  // Frameworks - Frontend
  { files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], detect: 'next', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['nuxt.config.js', 'nuxt.config.ts'], detect: 'nuxt', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['remix.config.js'], detect: 'remix', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['gatsby-config.js', 'gatsby-config.ts'], detect: 'gatsby', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['astro.config.mjs', 'astro.config.js'], detect: 'astro', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['svelte.config.js'], detect: 'svelte', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['angular.json'], detect: 'angular', type: 'framework', category: 'frontend', confidence: 1.0 },
  { files: ['vue.config.js', 'vite.config.ts'], detect: 'vue', type: 'framework', category: 'frontend', confidence: 0.6 },

  // Frameworks - ORM
  { files: ['prisma/schema.prisma'], detect: 'prisma', type: 'framework', category: 'orm', confidence: 1.0 },
  { files: ['drizzle.config.ts'], detect: 'drizzle', type: 'framework', category: 'orm', confidence: 1.0 },

  // Frameworks - Desktop/Mobile
  { files: ['electron.vite.config.ts', 'electron-builder.yml'], detect: 'electron', type: 'framework', category: 'desktop', confidence: 1.0 },
  { files: ['tauri.conf.json', 'src-tauri/tauri.conf.json'], detect: 'tauri', type: 'framework', category: 'desktop', confidence: 1.0 },
  { files: ['app.json', 'expo.json'], detect: 'expo', type: 'framework', category: 'mobile', confidence: 0.8 },
  { files: ['pubspec.yaml'], detect: 'flutter', type: 'framework', category: 'mobile', confidence: 1.0 },
  { files: ['ionic.config.json'], detect: 'ionic', type: 'framework', category: 'mobile', confidence: 1.0 },
];

const CONTENT_DETECTION_RULES: ContentDetectionRule[] = [
  // React detection from package.json
  {
    file: 'package.json',
    patterns: [/"react"\s*:/],
    detect: 'react',
    type: 'framework',
    category: 'frontend',
    confidence: 1.0,
    versionPattern: /"react"\s*:\s*"[^"]*?(\d+\.\d+\.\d+)/,
  },
  // Vue detection from package.json
  {
    file: 'package.json',
    patterns: [/"vue"\s*:/],
    detect: 'vue',
    type: 'framework',
    category: 'frontend',
    confidence: 1.0,
    versionPattern: /"vue"\s*:\s*"[^"]*?(\d+\.\d+\.\d+)/,
  },
  // Angular detection from package.json
  {
    file: 'package.json',
    patterns: [/"@angular\/core"\s*:/],
    detect: 'angular',
    type: 'framework',
    category: 'frontend',
    confidence: 1.0,
    versionPattern: /"@angular\/core"\s*:\s*"[^"]*?(\d+\.\d+\.\d+)/,
  },
  // Svelte detection from package.json
  {
    file: 'package.json',
    patterns: [/"svelte"\s*:/],
    detect: 'svelte',
    type: 'framework',
    category: 'frontend',
    confidence: 1.0,
  },
  // Solid detection from package.json
  {
    file: 'package.json',
    patterns: [/"solid-js"\s*:/],
    detect: 'solid',
    type: 'framework',
    category: 'frontend',
    confidence: 1.0,
  },

  // Backend frameworks - Node
  {
    file: 'package.json',
    patterns: [/"express"\s*:/],
    detect: 'express',
    type: 'framework',
    category: 'backend',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"fastify"\s*:/],
    detect: 'fastify',
    type: 'framework',
    category: 'backend',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"@nestjs\/core"\s*:/],
    detect: 'nestjs',
    type: 'framework',
    category: 'backend',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"koa"\s*:/],
    detect: 'koa',
    type: 'framework',
    category: 'backend',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"@hapi\/hapi"\s*:/],
    detect: 'hapi',
    type: 'framework',
    category: 'backend',
    confidence: 1.0,
  },

  // State Management
  {
    file: 'package.json',
    patterns: [/"redux"\s*:/, /"@reduxjs\/toolkit"\s*:/],
    detect: 'redux',
    type: 'framework',
    category: 'state-management',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"zustand"\s*:/],
    detect: 'zustand',
    type: 'framework',
    category: 'state-management',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"mobx"\s*:/],
    detect: 'mobx',
    type: 'framework',
    category: 'state-management',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"pinia"\s*:/],
    detect: 'pinia',
    type: 'framework',
    category: 'state-management',
    confidence: 1.0,
  },
  {
    file: 'package.json',
    patterns: [/"recoil"\s*:/],
    detect: 'recoil',
    type: 'framework',
    category: 'state-management',
    confidence: 1.0,
  },

  // React Native
  {
    file: 'package.json',
    patterns: [/"react-native"\s*:/],
    detect: 'react-native',
    type: 'framework',
    category: 'mobile',
    confidence: 1.0,
  },

  // ORM - TypeORM
  {
    file: 'package.json',
    patterns: [/"typeorm"\s*:/],
    detect: 'typeorm',
    type: 'framework',
    category: 'orm',
    confidence: 1.0,
  },
  // ORM - Sequelize
  {
    file: 'package.json',
    patterns: [/"sequelize"\s*:/],
    detect: 'sequelize',
    type: 'framework',
    category: 'orm',
    confidence: 1.0,
  },

  // Testing - Testing Library
  {
    file: 'package.json',
    patterns: [/"@testing-library\//],
    detect: 'testing-library',
    type: 'framework',
    category: 'testing',
    confidence: 1.0,
  },

  // Python frameworks from pyproject.toml
  {
    file: 'pyproject.toml',
    patterns: [/django/i],
    detect: 'django',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'pyproject.toml',
    patterns: [/flask/i],
    detect: 'flask',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'pyproject.toml',
    patterns: [/fastapi/i],
    detect: 'fastapi',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'pyproject.toml',
    patterns: [/starlette/i],
    detect: 'starlette',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'pyproject.toml',
    patterns: [/sqlalchemy/i],
    detect: 'sqlalchemy',
    type: 'framework',
    category: 'orm',
    confidence: 0.9,
  },
  {
    file: 'pyproject.toml',
    patterns: [/pytest/i],
    detect: 'pytest',
    type: 'framework',
    category: 'testing',
    confidence: 1.0,
  },
  {
    file: 'requirements.txt',
    patterns: [/^django/im],
    detect: 'django',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'requirements.txt',
    patterns: [/^flask/im],
    detect: 'flask',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },
  {
    file: 'requirements.txt',
    patterns: [/^fastapi/im],
    detect: 'fastapi',
    type: 'framework',
    category: 'backend',
    confidence: 0.9,
  },

  // GraphQL detection
  {
    file: 'package.json',
    patterns: [/"graphql"\s*:/, /"@apollo\//],
    detect: 'graphql-api',
    type: 'pattern',
    confidence: 0.9,
  },

  // gRPC detection
  {
    file: 'package.json',
    patterns: [/"@grpc\/grpc-js"\s*:/, /"grpc-tools"\s*:/],
    detect: 'grpc-api',
    type: 'pattern',
    confidence: 0.9,
  },
];

// ============================================================================
// CONSTRUCTABLE MAPPINGS
// ============================================================================

type ConstructableMapping = ConstructableDefinition;

const CONSTRUCTABLE_MAPPINGS: ConstructableMapping[] = listConstructableDefinitions();

// ============================================================================
// DETECTOR CLASS
// ============================================================================

/**
 * Project analyzer that detects characteristics and recommends constructables.
 */
export class ProjectAnalyzer {
  private workspace: string;
  private fileCache: Map<string, string> = new Map();

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /**
   * Analyze the project and detect characteristics.
   */
  async analyze(): Promise<ProjectAnalysis> {
    const languages: Language[] = [];
    const frameworks: DetectedFramework[] = [];
    const patterns: DetectedPattern[] = [];
    const projectTypes: DetectedProjectType[] = [];
    const testingFrameworks: string[] = [];
    const buildTools: string[] = [];
    const packageManagers: string[] = [];

    // Detect from file presence
    for (const rule of FILE_DETECTION_RULES) {
      const matched = await this.checkFilesExist(rule.files);
      if (matched.length > 0) {
        const evidence = matched.map(f => `file:${f}`);

        if (rule.type === 'language') {
          if (!languages.includes(rule.detect as Language)) {
            languages.push(rule.detect as Language);
          }
        } else if (rule.type === 'framework') {
          frameworks.push({
            framework: rule.detect as Framework,
            category: rule.category!,
            confidence: rule.confidence,
            evidence,
          });
          if (rule.category === 'testing') {
            testingFrameworks.push(rule.detect as string);
          }
        } else if (rule.type === 'pattern') {
          patterns.push({
            pattern: rule.detect as ProjectPattern,
            confidence: rule.confidence,
            evidence,
          });
        } else if (rule.type === 'projectType') {
          projectTypes.push({
            type: rule.detect as ProjectType,
            confidence: rule.confidence,
            evidence,
          });
        }
      }
    }

    // Detect from file contents
    for (const rule of CONTENT_DETECTION_RULES) {
      const content = await this.readFile(rule.file);
      if (content) {
        for (const pattern of rule.patterns) {
          if (pattern.test(content)) {
            const evidence = [`content:${rule.file}:${pattern.source.substring(0, 30)}`];
            let version: string | undefined;

            if (rule.versionPattern) {
              const versionMatch = content.match(rule.versionPattern);
              if (versionMatch) {
                version = versionMatch[1];
              }
            }

            if (rule.type === 'framework') {
              // Check if already detected
              const existing = frameworks.find(f => f.framework === rule.detect);
              if (!existing) {
                frameworks.push({
                  framework: rule.detect as Framework,
                  category: rule.category!,
                  confidence: rule.confidence,
                  version,
                  evidence,
                });
                if (rule.category === 'testing') {
                  testingFrameworks.push(rule.detect as string);
                }
              } else {
                // Boost confidence and add evidence
                existing.confidence = Math.min(1.0, existing.confidence + 0.1);
                existing.evidence.push(...evidence);
                if (version && !existing.version) {
                  existing.version = version;
                }
              }
            } else if (rule.type === 'pattern') {
              const existingPattern = patterns.find(p => p.pattern === rule.detect);
              if (!existingPattern) {
                patterns.push({
                  pattern: rule.detect as ProjectPattern,
                  confidence: rule.confidence,
                  evidence,
                });
              }
            }
            break; // Only match once per rule
          }
        }
      }
    }

    // Detect package managers
    if (await this.fileExists('pnpm-lock.yaml')) packageManagers.push('pnpm');
    if (await this.fileExists('yarn.lock')) packageManagers.push('yarn');
    if (await this.fileExists('package-lock.json')) packageManagers.push('npm');
    if (await this.fileExists('bun.lockb')) packageManagers.push('bun');
    if (await this.fileExists('Pipfile.lock')) packageManagers.push('pipenv');
    if (await this.fileExists('poetry.lock')) packageManagers.push('poetry');
    if (await this.fileExists('Cargo.lock')) packageManagers.push('cargo');
    if (await this.fileExists('go.sum')) packageManagers.push('go');

    // Detect build tools
    if (await this.fileExists('vite.config.ts') || await this.fileExists('vite.config.js')) buildTools.push('vite');
    if (await this.fileExists('webpack.config.js') || await this.fileExists('webpack.config.ts')) buildTools.push('webpack');
    if (await this.fileExists('rollup.config.js') || await this.fileExists('rollup.config.mjs')) buildTools.push('rollup');
    if (await this.fileExists('esbuild.config.js') || await this.fileExists('esbuild.mjs')) buildTools.push('esbuild');
    if (await this.fileExists('turbo.json')) buildTools.push('turborepo');

    // Infer project types from detected characteristics
    const inferredProjectTypes = this.inferProjectTypes(languages, frameworks, patterns);
    projectTypes.push(...inferredProjectTypes);

    // Determine primary language
    const primaryLanguage = this.determinePrimaryLanguage(languages, frameworks);

    // Check for monorepo
    const isMonorepo = patterns.some(p =>
      p.pattern.startsWith('monorepo-') ||
      p.pattern === 'microservices'
    ) || await this.checkMonorepoStructure();

    // Check for tests
    const hasTests = await this.hasTestFiles();

    return {
      projectTypes,
      frameworks,
      patterns,
      primaryLanguage,
      languages,
      hasTypeScript: languages.includes('typescript'),
      hasJavaScript: languages.includes('javascript'),
      isMonorepo,
      hasTests,
      testingFrameworks: [...new Set(testingFrameworks)],
      buildTools,
      packageManagers,
    };
  }

  private async checkFilesExist(patterns: string[]): Promise<string[]> {
    const matched: string[] = [];
    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.workspace,
          nodir: true,
          dot: true,
          maxDepth: 3,
        });
        if (files.length > 0) {
          matched.push(...files);
        }
      } catch {
        // Ignore glob errors
      }
    }
    return matched;
  }

  private async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.workspace, filename));
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(filename: string): Promise<string | null> {
    if (this.fileCache.has(filename)) {
      return this.fileCache.get(filename)!;
    }
    try {
      const content = await fs.readFile(path.join(this.workspace, filename), 'utf-8');
      this.fileCache.set(filename, content);
      return content;
    } catch {
      return null;
    }
  }

  private async checkMonorepoStructure(): Promise<boolean> {
    // Check for common monorepo directory structures
    const monorepoIndicators = ['packages', 'apps', 'services', 'libs', 'modules'];
    for (const dir of monorepoIndicators) {
      try {
        const stats = await fs.stat(path.join(this.workspace, dir));
        if (stats.isDirectory()) {
          // Check if it contains multiple package.json files
          const subPackages = await glob(`${dir}/*/package.json`, {
            cwd: this.workspace,
          });
          if (subPackages.length >= 2) {
            return true;
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
    return false;
  }

  private async hasTestFiles(): Promise<boolean> {
    const testPatterns = [
      '**/*.test.ts',
      '**/*.test.js',
      '**/*.spec.ts',
      '**/*.spec.js',
      '**/test_*.py',
      '**/*_test.py',
      '**/*_test.go',
      '**/*_test.rs',
    ];
    for (const pattern of testPatterns) {
      const files = await glob(pattern, {
        cwd: this.workspace,
        nodir: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        maxDepth: 5,
      });
      if (files.length > 0) {
        return true;
      }
    }
    return false;
  }

  private inferProjectTypes(
    languages: Language[],
    frameworks: DetectedFramework[],
    patterns: DetectedPattern[]
  ): DetectedProjectType[] {
    const types: DetectedProjectType[] = [];

    // Web app detection
    const frontendFrameworks = frameworks.filter(f => f.category === 'frontend');
    if (frontendFrameworks.length > 0) {
      types.push({
        type: 'web-app',
        confidence: Math.max(...frontendFrameworks.map(f => f.confidence)),
        evidence: frontendFrameworks.flatMap(f => f.evidence),
      });
    }

    // API server detection
    const backendFrameworks = frameworks.filter(f => f.category === 'backend');
    if (backendFrameworks.length > 0) {
      types.push({
        type: 'api-server',
        confidence: Math.max(...backendFrameworks.map(f => f.confidence)),
        evidence: backendFrameworks.flatMap(f => f.evidence),
      });
    }

    // Full-stack detection
    if (frontendFrameworks.length > 0 && backendFrameworks.length > 0) {
      types.push({
        type: 'full-stack',
        confidence: 0.9,
        evidence: [...frontendFrameworks, ...backendFrameworks].flatMap(f => f.evidence),
      });
    }

    // Mobile app detection
    const mobileFrameworks = frameworks.filter(f => f.category === 'mobile');
    if (mobileFrameworks.length > 0) {
      types.push({
        type: 'mobile-app',
        confidence: Math.max(...mobileFrameworks.map(f => f.confidence)),
        evidence: mobileFrameworks.flatMap(f => f.evidence),
      });
    }

    // Desktop app detection
    const desktopFrameworks = frameworks.filter(f => f.category === 'desktop');
    if (desktopFrameworks.length > 0) {
      types.push({
        type: 'desktop-app',
        confidence: Math.max(...desktopFrameworks.map(f => f.confidence)),
        evidence: desktopFrameworks.flatMap(f => f.evidence),
      });
    }

    // Monorepo detection
    if (patterns.some(p => p.pattern.startsWith('monorepo-'))) {
      types.push({
        type: 'monorepo',
        confidence: 1.0,
        evidence: patterns.filter(p => p.pattern.startsWith('monorepo-')).flatMap(p => p.evidence),
      });
    }

    // Microservices detection
    if (patterns.some(p => p.pattern === 'microservices' || p.pattern === 'containerized')) {
      types.push({
        type: 'microservices',
        confidence: 0.8,
        evidence: patterns.filter(p => p.pattern === 'microservices' || p.pattern === 'containerized').flatMap(p => p.evidence),
      });
    }

    // Infrastructure detection
    if (patterns.some(p => p.pattern === 'infrastructure-as-code')) {
      types.push({
        type: 'infrastructure',
        confidence: 0.9,
        evidence: patterns.filter(p => p.pattern === 'infrastructure-as-code').flatMap(p => p.evidence),
      });
    }

    // Library detection (if no clear app type but has exports)
    if (types.length === 0 && (languages.includes('typescript') || languages.includes('javascript'))) {
      types.push({
        type: 'library',
        confidence: 0.5,
        evidence: ['default:no-clear-app-type'],
      });
    }

    return types;
  }

  private determinePrimaryLanguage(languages: Language[], frameworks: DetectedFramework[]): Language | null {
    if (languages.length === 0) return null;
    if (languages.length === 1) return languages[0];

    // Prefer TypeScript over JavaScript
    if (languages.includes('typescript')) return 'typescript';

    // Otherwise, choose based on framework count
    const langFrameworkCount = new Map<Language, number>();
    for (const lang of languages) {
      langFrameworkCount.set(lang, 0);
    }

    for (const framework of frameworks) {
      // Map frameworks to languages
      const frameworkLangs = this.getFrameworkLanguages(framework.framework);
      for (const lang of frameworkLangs) {
        if (langFrameworkCount.has(lang)) {
          langFrameworkCount.set(lang, (langFrameworkCount.get(lang) || 0) + 1);
        }
      }
    }

    // Sort by framework count and return top
    const sorted = Array.from(langFrameworkCount.entries())
      .sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? languages[0];
  }

  private getFrameworkLanguages(framework: Framework): Language[] {
    const mapping: Partial<Record<Framework, Language[]>> = {
      'react': ['typescript', 'javascript'],
      'vue': ['typescript', 'javascript'],
      'angular': ['typescript'],
      'svelte': ['typescript', 'javascript'],
      'solid': ['typescript', 'javascript'],
      'next': ['typescript', 'javascript'],
      'nuxt': ['typescript', 'javascript'],
      'remix': ['typescript', 'javascript'],
      'gatsby': ['typescript', 'javascript'],
      'astro': ['typescript', 'javascript'],
      'express': ['typescript', 'javascript'],
      'fastify': ['typescript', 'javascript'],
      'nestjs': ['typescript'],
      'koa': ['typescript', 'javascript'],
      'hapi': ['typescript', 'javascript'],
      'django': ['python'],
      'flask': ['python'],
      'fastapi': ['python'],
      'starlette': ['python'],
      'rails': ['ruby'],
      'spring': ['java', 'kotlin'],
      'actix': ['rust'],
      'gin': ['go'],
      'echo': ['go'],
      'phoenix': ['elixir'],
      'jest': ['typescript', 'javascript'],
      'vitest': ['typescript', 'javascript'],
      'mocha': ['typescript', 'javascript'],
      'pytest': ['python'],
      'cypress': ['typescript', 'javascript'],
      'playwright': ['typescript', 'javascript'],
      'testing-library': ['typescript', 'javascript'],
      'prisma': ['typescript', 'javascript'],
      'typeorm': ['typescript'],
      'sequelize': ['typescript', 'javascript'],
      'drizzle': ['typescript'],
      'sqlalchemy': ['python'],
      'diesel': ['rust'],
      'react-native': ['typescript', 'javascript'],
      'flutter': ['dart' as Language],
      'ionic': ['typescript', 'javascript'],
      'expo': ['typescript', 'javascript'],
      'electron': ['typescript', 'javascript'],
      'tauri': ['typescript', 'javascript', 'rust'],
    };
    return mapping[framework] || [];
  }
}

// ============================================================================
// SELECTOR
// ============================================================================

/**
 * Select optimal constructables based on project analysis.
 */
export function selectConstructables(
  analysis: ProjectAnalysis,
  overrides?: ManualOverrides
): OptimalConstructableConfig {
  const configurations: ConstructableConfig[] = [];
  const reasons: string[] = [];
  const minConfidence = overrides?.minConfidence ?? 0.5;

  // Collect detected frameworks and languages for quick lookup
  const detectedFrameworks = new Set(analysis.frameworks.map(f => f.framework));
  const detectedLanguages = new Set(analysis.languages);
  const detectedPatterns = new Set(analysis.patterns.map(p => p.pattern));

  for (const mapping of CONSTRUCTABLE_MAPPINGS) {
    let confidence = 0;
    let priority = mapping.basePriority;
    const matchReasons: string[] = [];

    if (mapping.isCore) {
      // Core constructables are always enabled with base confidence
      confidence = 0.7;
      matchReasons.push('core constructable');
    }

    // Check language matches
    if (mapping.languages) {
      for (const lang of mapping.languages) {
        if (detectedLanguages.has(lang)) {
          confidence = Math.max(confidence, 0.9);
          priority += 10;
          matchReasons.push(`language: ${lang}`);
        }
      }
    }

    // Check framework matches
    if (mapping.frameworks) {
      for (const fw of mapping.frameworks) {
        if (detectedFrameworks.has(fw)) {
          const fwInfo = analysis.frameworks.find(f => f.framework === fw);
          confidence = Math.max(confidence, fwInfo?.confidence ?? 0.8);
          priority += 15;
          matchReasons.push(`framework: ${fw}`);
        }
      }
    }

    // Check pattern matches
    if (mapping.patterns) {
      for (const pattern of mapping.patterns) {
        if (detectedPatterns.has(pattern)) {
          const patternInfo = analysis.patterns.find(p => p.pattern === pattern);
          confidence = Math.max(confidence, patternInfo?.confidence ?? 0.8);
          priority += 5;
          matchReasons.push(`pattern: ${pattern}`);
        }
      }
    }

    // Check project type matches
    if (mapping.projectTypes) {
      for (const pt of mapping.projectTypes) {
        if (analysis.projectTypes.some(t => t.type === pt)) {
          const typeInfo = analysis.projectTypes.find(t => t.type === pt);
          confidence = Math.max(confidence, typeInfo?.confidence ?? 0.7);
          priority += 5;
          matchReasons.push(`project type: ${pt}`);
        }
      }
    }

    // Apply manual overrides
    const forceEnabled = overrides?.forceEnable?.includes(mapping.id);
    const forceDisabled = overrides?.forceDisable?.includes(mapping.id);

    if (forceEnabled) {
      confidence = 1.0;
      matchReasons.push('manually enabled');
    } else if (forceDisabled) {
      confidence = 0;
      matchReasons.push('manually disabled');
    }

    const enabled = confidence >= minConfidence && !forceDisabled;
    const config = overrides?.configOverrides?.[mapping.id];

    configurations.push({
      id: mapping.id,
      enabled,
      confidence,
      reason: matchReasons.join(', ') || 'no matches',
      priority,
      config,
    });

    if (enabled && matchReasons.length > 0) {
      reasons.push(`${mapping.id}: ${matchReasons.join(', ')}`);
    }
  }

  // Sort by priority (higher first)
  configurations.sort((a, b) => b.priority - a.priority);

  const enabled = configurations.filter(c => c.enabled).map(c => c.id);
  const disabled = configurations.filter(c => !c.enabled).map(c => c.id);

  // Calculate overall confidence as weighted average of enabled constructables
  const enabledConfidences = configurations.filter(c => c.enabled).map(c => c.confidence);
  const overallConfidence = enabledConfidences.length > 0
    ? enabledConfidences.reduce((sum, c) => sum + c, 0) / enabledConfidences.length
    : 0;

  return {
    enabled,
    disabled,
    configurations,
    confidence: Math.round(overallConfidence * 100) / 100,
    analysis,
    reasons,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Detect optimal constructables for a workspace.
 *
 * @param workspace - Path to the workspace root
 * @param overrides - Optional manual overrides
 * @returns Optimal constructable configuration
 *
 * @example
 * ```typescript
 * const recommended = await detectOptimalConstructables('/path/to/project');
 * // Returns: {
 * //   enabled: ['typescript-patterns', 'react-components', 'jest-testing'],
 * //   disabled: ['python-patterns'],
 * //   confidence: 0.92
 * // }
 * ```
 */
export async function detectOptimalConstructables(
  workspace: string,
  overrides?: ManualOverrides
): Promise<OptimalConstructableConfig> {
  const analyzer = new ProjectAnalyzer(workspace);
  const analysis = await analyzer.analyze();
  return selectConstructables(analysis, overrides);
}

/**
 * Analyze a project without selecting constructables.
 *
 * @param workspace - Path to the workspace root
 * @returns Project analysis
 */
export async function analyzeProject(workspace: string): Promise<ProjectAnalysis> {
  const analyzer = new ProjectAnalyzer(workspace);
  return analyzer.analyze();
}

/**
 * Get all available constructable IDs.
 */
export function getAvailableConstructables(): ConstructableId[] {
  return listConstructableDefinitions().map(m => m.id);
}

/**
 * Get constructable metadata.
 */
export function getConstructableMetadata(id: ConstructableId): ConstructableMapping | undefined {
  return getConstructableDefinition(id);
}

/**
 * Validate a constructable configuration.
 */
export function validateConstructableConfig(config: OptimalConstructableConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const allIds = new Set(listConstructableDefinitions().map(m => m.id));

  for (const id of config.enabled) {
    if (!allIds.has(id)) {
      errors.push(`Unknown constructable: ${id}`);
    }
  }

  for (const id of config.disabled) {
    if (!allIds.has(id)) {
      errors.push(`Unknown constructable: ${id}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// BOOTSTRAP INTEGRATION
// ============================================================================

/**
 * Configuration for auto-selection during bootstrap.
 */
export interface BootstrapAutoSelectionConfig {
  /** Whether to enable auto-selection */
  enabled: boolean;
  /** Minimum confidence for auto-enabling */
  minConfidence: number;
  /** Manual overrides */
  overrides?: ManualOverrides;
  /** Callback when selection is complete */
  onSelectionComplete?: (config: OptimalConstructableConfig) => void | Promise<void>;
}

/**
 * Default bootstrap auto-selection configuration.
 */
export const DEFAULT_BOOTSTRAP_AUTO_SELECTION: BootstrapAutoSelectionConfig = {
  enabled: true,
  minConfidence: 0.6,
};

/**
 * Integrate constructable auto-selection with bootstrap.
 *
 * This function should be called during the bootstrap process to
 * automatically detect and enable appropriate constructions.
 *
 * @param workspace - Workspace path
 * @param config - Auto-selection configuration
 * @returns Selected constructable configuration
 */
export async function integrateWithBootstrap(
  workspace: string,
  config: BootstrapAutoSelectionConfig = DEFAULT_BOOTSTRAP_AUTO_SELECTION
): Promise<OptimalConstructableConfig> {
  if (!config.enabled) {
    // Return empty config if auto-selection is disabled
    return {
      enabled: [],
      disabled: getAvailableConstructables(),
      configurations: [],
      confidence: 0,
      analysis: {
        projectTypes: [],
        frameworks: [],
        patterns: [],
        primaryLanguage: null,
        languages: [],
        hasTypeScript: false,
        hasJavaScript: false,
        isMonorepo: false,
        hasTests: false,
        testingFrameworks: [],
        buildTools: [],
        packageManagers: [],
      },
      reasons: ['auto-selection disabled'],
    };
  }

  const overrides: ManualOverrides = {
    ...config.overrides,
    minConfidence: config.minConfidence,
  };

  const result = await detectOptimalConstructables(workspace, overrides);

  if (config.onSelectionComplete) {
    await config.onSelectionComplete(result);
  }

  return result;
}
