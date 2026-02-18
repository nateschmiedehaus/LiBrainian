/**
 * @fileoverview Tests for the Automatic Constructable Selection module
 *
 * Tests project detection, framework identification, and constructable selection.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProjectAnalyzer,
  detectOptimalConstructables,
  analyzeProject,
  selectConstructables,
  getAvailableConstructables,
  getConstructableMetadata,
  validateConstructableConfig,
  type ProjectAnalysis,
  type ManualOverrides,
  type ConstructableId,
} from '../auto_selector.js';

describe('ProjectAnalyzer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-selector-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('language detection', () => {
    it('detects TypeScript projects', async () => {
      await fs.writeFile(
        path.join(tempDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true } })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('typescript');
      expect(analysis.hasTypeScript).toBe(true);
      expect(analysis.primaryLanguage).toBe('typescript');
    });

    it('detects Python projects', async () => {
      await fs.writeFile(path.join(tempDir, 'pyproject.toml'), '[project]\nname = "test"');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('python');
      expect(analysis.primaryLanguage).toBe('python');
    });

    it('detects Rust projects', async () => {
      await fs.writeFile(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('rust');
      expect(analysis.primaryLanguage).toBe('rust');
    });

    it('detects Go projects', async () => {
      await fs.writeFile(path.join(tempDir, 'go.mod'), 'module test');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.languages).toContain('go');
      expect(analysis.primaryLanguage).toBe('go');
    });
  });

  describe('framework detection', () => {
    it('detects React from package.json', async () => {
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
        })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const reactFramework = analysis.frameworks.find(f => f.framework === 'react');
      expect(reactFramework).toBeDefined();
      expect(reactFramework?.category).toBe('frontend');
      expect(reactFramework?.confidence).toBeGreaterThan(0.9);
    });

    it('detects Next.js from config file', async () => {
      await fs.writeFile(path.join(tempDir, 'next.config.js'), 'module.exports = {};');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const nextFramework = analysis.frameworks.find(f => f.framework === 'next');
      expect(nextFramework).toBeDefined();
      expect(nextFramework?.category).toBe('frontend');
    });

    it('detects Express from package.json', async () => {
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.18.0' } })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const expressFramework = analysis.frameworks.find(f => f.framework === 'express');
      expect(expressFramework).toBeDefined();
      expect(expressFramework?.category).toBe('backend');
    });

    it('detects Django from pyproject.toml', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\ndependencies = ["django>=4.0"]'
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const djangoFramework = analysis.frameworks.find(f => f.framework === 'django');
      expect(djangoFramework).toBeDefined();
      expect(djangoFramework?.category).toBe('backend');
    });

    it('detects Jest testing framework', async () => {
      await fs.writeFile(path.join(tempDir, 'jest.config.js'), 'module.exports = {};');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const jestFramework = analysis.frameworks.find(f => f.framework === 'jest');
      expect(jestFramework).toBeDefined();
      expect(jestFramework?.category).toBe('testing');
      expect(analysis.testingFrameworks).toContain('jest');
    });

    it('detects Vitest testing framework', async () => {
      await fs.writeFile(path.join(tempDir, 'vitest.config.ts'), 'export default {};');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const vitestFramework = analysis.frameworks.find(f => f.framework === 'vitest');
      expect(vitestFramework).toBeDefined();
      expect(analysis.testingFrameworks).toContain('vitest');
    });

    it('detects Prisma ORM', async () => {
      await fs.mkdir(path.join(tempDir, 'prisma'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), 'generator client {}');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const prismaFramework = analysis.frameworks.find(f => f.framework === 'prisma');
      expect(prismaFramework).toBeDefined();
      expect(prismaFramework?.category).toBe('orm');
    });
  });

  describe('pattern detection', () => {
    it('detects Turborepo monorepo', async () => {
      await fs.writeFile(path.join(tempDir, 'turbo.json'), '{}');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const turboPattern = analysis.patterns.find(p => p.pattern === 'monorepo-turborepo');
      expect(turboPattern).toBeDefined();
      expect(analysis.isMonorepo).toBe(true);
    });

    it('detects pnpm workspace monorepo', async () => {
      await fs.writeFile(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const pnpmPattern = analysis.patterns.find(p => p.pattern === 'monorepo-pnpm');
      expect(pnpmPattern).toBeDefined();
    });

    it('detects GitHub Actions CI', async () => {
      await fs.mkdir(path.join(tempDir, '.github', 'workflows'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.github', 'workflows', 'ci.yml'), 'name: CI');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const ghActions = analysis.patterns.find(p => p.pattern === 'ci-cd-github-actions');
      expect(ghActions).toBeDefined();
    });

    it('detects containerized pattern', async () => {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), 'FROM node:18');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const dockerPattern = analysis.patterns.find(p => p.pattern === 'containerized');
      expect(dockerPattern).toBeDefined();
    });
  });

  describe('project type inference', () => {
    it('infers web-app for React projects', async () => {
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { react: '^18.0.0' } })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const webAppType = analysis.projectTypes.find(t => t.type === 'web-app');
      expect(webAppType).toBeDefined();
    });

    it('infers api-server for Express projects', async () => {
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.18.0' } })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const apiType = analysis.projectTypes.find(t => t.type === 'api-server');
      expect(apiType).toBeDefined();
    });

    it('infers full-stack for React + Express projects', async () => {
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.0.0', express: '^4.18.0' },
        })
      );

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      const fullStackType = analysis.projectTypes.find(t => t.type === 'full-stack');
      expect(fullStackType).toBeDefined();
    });
  });

  describe('package manager detection', () => {
    it('detects npm', async () => {
      await fs.writeFile(path.join(tempDir, 'package-lock.json'), '{}');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.packageManagers).toContain('npm');
    });

    it('detects yarn', async () => {
      await fs.writeFile(path.join(tempDir, 'yarn.lock'), '');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.packageManagers).toContain('yarn');
    });

    it('detects pnpm', async () => {
      await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), '');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.packageManagers).toContain('pnpm');
    });
  });

  describe('build tool detection', () => {
    it('detects Vite', async () => {
      await fs.writeFile(path.join(tempDir, 'vite.config.ts'), 'export default {};');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.buildTools).toContain('vite');
    });

    it('detects Webpack', async () => {
      await fs.writeFile(path.join(tempDir, 'webpack.config.js'), 'module.exports = {};');

      const analyzer = new ProjectAnalyzer(tempDir);
      const analysis = await analyzer.analyze();

      expect(analysis.buildTools).toContain('webpack');
    });
  });
});

describe('selectConstructables', () => {
  it('enables core constructables for all projects', () => {
    const analysis: ProjectAnalysis = {
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
    };

    const result = selectConstructables(analysis);

    // Core constructables should be enabled
    expect(result.enabled).toContain('refactoring-safety-checker');
    expect(result.enabled).toContain('bug-investigation-assistant');
    expect(result.enabled).toContain('security-audit-helper');
  });

  it('discloses experimental constructables and caps their confidence', () => {
    const analysis: ProjectAnalysis = {
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
    };

    const result = selectConstructables(analysis);
    const experimentalEnabled = result.configurations.filter(
      (config) => config.enabled && config.availability === 'experimental'
    );
    expect(experimentalEnabled.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.startsWith('experimental_constructable_enabled:'))).toBe(true);
    for (const config of experimentalEnabled) {
      expect(config.confidence).toBeLessThanOrEqual(0.7);
      expect(config.reason).toContain('availability: experimental');
    }
  });

  it('enables typescript-patterns for TypeScript projects', () => {
    const analysis: ProjectAnalysis = {
      projectTypes: [],
      frameworks: [],
      patterns: [],
      primaryLanguage: 'typescript',
      languages: ['typescript'],
      hasTypeScript: true,
      hasJavaScript: false,
      isMonorepo: false,
      hasTests: false,
      testingFrameworks: [],
      buildTools: [],
      packageManagers: [],
    };

    const result = selectConstructables(analysis);

    expect(result.enabled).toContain('typescript-patterns');
    expect(result.disabled).toContain('python-patterns');
  });

  it('enables react-components for React projects', () => {
    const analysis: ProjectAnalysis = {
      projectTypes: [{ type: 'web-app', confidence: 0.9, evidence: [] }],
      frameworks: [{ framework: 'react', category: 'frontend', confidence: 1.0, evidence: [] }],
      patterns: [],
      primaryLanguage: 'typescript',
      languages: ['typescript'],
      hasTypeScript: true,
      hasJavaScript: false,
      isMonorepo: false,
      hasTests: false,
      testingFrameworks: [],
      buildTools: [],
      packageManagers: [],
    };

    const result = selectConstructables(analysis);

    expect(result.enabled).toContain('react-components');
    expect(result.enabled).toContain('typescript-patterns');
  });

  it('enables jest-testing for Jest projects', () => {
    const analysis: ProjectAnalysis = {
      projectTypes: [],
      frameworks: [{ framework: 'jest', category: 'testing', confidence: 1.0, evidence: [] }],
      patterns: [],
      primaryLanguage: 'typescript',
      languages: ['typescript'],
      hasTypeScript: true,
      hasJavaScript: false,
      isMonorepo: false,
      hasTests: true,
      testingFrameworks: ['jest'],
      buildTools: [],
      packageManagers: [],
    };

    const result = selectConstructables(analysis);

    expect(result.enabled).toContain('jest-testing');
    expect(result.enabled).toContain('testing-strategy');
  });

  it('respects manual force-enable overrides', () => {
    const analysis: ProjectAnalysis = {
      projectTypes: [],
      frameworks: [],
      patterns: [],
      primaryLanguage: 'typescript',
      languages: ['typescript'],
      hasTypeScript: true,
      hasJavaScript: false,
      isMonorepo: false,
      hasTests: false,
      testingFrameworks: [],
      buildTools: [],
      packageManagers: [],
    };

    const overrides: ManualOverrides = {
      forceEnable: ['python-patterns'],
    };

    const result = selectConstructables(analysis, overrides);

    // Should be enabled despite no Python detected
    expect(result.enabled).toContain('python-patterns');
  });

  it('respects manual force-disable overrides', () => {
    const analysis: ProjectAnalysis = {
      projectTypes: [],
      frameworks: [],
      patterns: [],
      primaryLanguage: 'typescript',
      languages: ['typescript'],
      hasTypeScript: true,
      hasJavaScript: false,
      isMonorepo: false,
      hasTests: false,
      testingFrameworks: [],
      buildTools: [],
      packageManagers: [],
    };

    const overrides: ManualOverrides = {
      forceDisable: ['typescript-patterns'],
    };

    const result = selectConstructables(analysis, overrides);

    // Should be disabled despite TypeScript detected
    expect(result.disabled).toContain('typescript-patterns');
    expect(result.enabled).not.toContain('typescript-patterns');
  });

  it('respects minimum confidence threshold', () => {
    const analysis: ProjectAnalysis = {
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
    };

    // With high threshold, fewer constructables should be enabled
    const highThreshold = selectConstructables(analysis, { minConfidence: 0.9 });
    const lowThreshold = selectConstructables(analysis, { minConfidence: 0.3 });

    expect(highThreshold.enabled.length).toBeLessThan(lowThreshold.enabled.length);
  });
});

describe('detectOptimalConstructables', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-selector-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns comprehensive configuration for TypeScript React project', async () => {
    await fs.writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } })
    );
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18.0.0' },
        devDependencies: { jest: '^29.0.0' },
      })
    );
    await fs.writeFile(path.join(tempDir, 'jest.config.js'), 'module.exports = {};');

    const result = await detectOptimalConstructables(tempDir);

    // Should have high confidence (experimental caps can clamp this to 0.7).
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);

    // Should enable TypeScript, React, and Jest constructables
    expect(result.enabled).toContain('typescript-patterns');
    expect(result.enabled).toContain('react-components');
    expect(result.enabled).toContain('jest-testing');

    // Should have proper analysis
    expect(result.analysis.hasTypeScript).toBe(true);
    expect(result.analysis.frameworks.some(f => f.framework === 'react')).toBe(true);

    // Should have reasons
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('returns empty configuration for empty directory', async () => {
    const result = await detectOptimalConstructables(tempDir);

    // Should still have core constructables enabled
    expect(result.enabled.length).toBeGreaterThan(0);
    expect(result.enabled).toContain('refactoring-safety-checker');

    // Should have lower confidence
    expect(result.confidence).toBeLessThan(0.9);
  });
});

describe('utility functions', () => {
  describe('getAvailableConstructables', () => {
    it('returns all available constructable IDs', () => {
      const ids = getAvailableConstructables();

      expect(ids.length).toBeGreaterThan(20);
      expect(ids).toContain('refactoring-safety-checker');
      expect(ids).toContain('typescript-patterns');
      expect(ids).toContain('react-components');
    });
  });

  describe('getConstructableMetadata', () => {
    it('returns metadata for valid constructable', () => {
      const metadata = getConstructableMetadata('typescript-patterns');

      expect(metadata).toBeDefined();
      expect(metadata?.id).toBe('typescript-patterns');
      expect(metadata?.languages).toContain('typescript');
      expect(metadata?.description).toContain('TypeScript');
    });

    it('returns undefined for invalid constructable', () => {
      const metadata = getConstructableMetadata('non-existent' as ConstructableId);
      expect(metadata).toBeUndefined();
    });
  });

  describe('validateConstructableConfig', () => {
    it('validates correct configuration', () => {
      const config = {
        enabled: ['typescript-patterns', 'react-components'],
        disabled: ['python-patterns'],
        configurations: [],
        confidence: 0.9,
        analysis: {} as ProjectAnalysis,
        reasons: [],
        warnings: [],
      };

      const validation = validateConstructableConfig(config);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('reports unknown constructables', () => {
      const config = {
        enabled: ['typescript-patterns', 'unknown-constructable'],
        disabled: ['another-unknown'],
        configurations: [],
        confidence: 0.9,
        analysis: {} as ProjectAnalysis,
        reasons: [],
        warnings: [],
      };

      const validation = validateConstructableConfig(config);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Unknown constructable: unknown-constructable');
      expect(validation.errors).toContain('Unknown constructable: another-unknown');
    });
  });
});

describe('complex project scenarios', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-selector-complex-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles Next.js full-stack project', async () => {
    await fs.writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } })
    );
    await fs.writeFile(path.join(tempDir, 'next.config.js'), 'module.exports = {};');
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0',
          prisma: '^5.0.0',
        },
        devDependencies: {
          vitest: '^1.0.0',
          '@testing-library/react': '^14.0.0',
        },
      })
    );
    await fs.writeFile(path.join(tempDir, 'vitest.config.ts'), 'export default {};');
    await fs.mkdir(path.join(tempDir, 'prisma'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), '');

    const result = await detectOptimalConstructables(tempDir);

    expect(result.enabled).toContain('typescript-patterns');
    expect(result.enabled).toContain('react-components');
    expect(result.enabled).toContain('vitest-testing');
    expect(result.analysis.frameworks.some(f => f.framework === 'next')).toBe(true);
    expect(result.analysis.frameworks.some(f => f.framework === 'prisma')).toBe(true);
  });

  it('handles Python FastAPI project', async () => {
    await fs.writeFile(
      path.join(tempDir, 'pyproject.toml'),
      '[project]\ndependencies = ["fastapi", "sqlalchemy", "pytest"]'
    );
    await fs.writeFile(path.join(tempDir, 'pytest.ini'), '[pytest]\n');

    const result = await detectOptimalConstructables(tempDir);

    expect(result.enabled).toContain('python-patterns');
    expect(result.enabled).toContain('fastapi-endpoints');
    expect(result.enabled).toContain('pytest-testing');
    expect(result.analysis.primaryLanguage).toBe('python');
  });

  it('handles Turborepo monorepo', async () => {
    await fs.writeFile(path.join(tempDir, 'turbo.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');
    await fs.mkdir(path.join(tempDir, 'packages', 'web'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'packages', 'api'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'packages', 'web', 'package.json'),
      JSON.stringify({ name: '@project/web' })
    );
    await fs.writeFile(
      path.join(tempDir, 'packages', 'api', 'package.json'),
      JSON.stringify({ name: '@project/api' })
    );

    const result = await detectOptimalConstructables(tempDir);

    expect(result.analysis.isMonorepo).toBe(true);
    expect(result.analysis.patterns.some(p => p.pattern === 'monorepo-turborepo')).toBe(true);
    expect(result.analysis.patterns.some(p => p.pattern === 'monorepo-pnpm')).toBe(true);
    expect(result.analysis.projectTypes.some(t => t.type === 'monorepo')).toBe(true);
  });
});
