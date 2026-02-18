import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('package release scripts', () => {
  it('declares package identity and install smoke scripts', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['package:assert-identity']).toBe('node scripts/assert-package-identity.mjs');
    expect(scripts['package:assert-release-provenance']).toBe('node scripts/assert-release-provenance.mjs');
    expect(scripts['package:install-smoke']).toBe('node scripts/package-install-smoke.mjs');
    expect(scripts.dogfood).toBe('node scripts/dogfood-sandbox.mjs');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-identity');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-release-provenance');
    expect(scripts.prepublishOnly).toContain('npm run package:install-smoke');
  });

  it('contains packaging guard script files', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-package-identity.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-release-provenance.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'public-pack-check.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'dogfood-sandbox.mjs'))).toBe(true);
  });

  it('runs dogfood commands from target workspace without mutating CLI args', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'dogfood-sandbox.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain("arg === '-w'");
    expect(script).toContain('const binPath = path.join(sandboxDir, \'node_modules\', \'.bin\', \'librainian\')');
    expect(script).toContain('cwd: workspace');
  });

  it('defines staged validation scripts for daily, PR, and release gates', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['test:changed']).toBe(
      'node scripts/run-with-tmpdir.mjs --set LIBRARIAN_TEST_MODE=unit -- vitest --run --changed'
    );
    expect(scripts['validate:public']).toBe(
      'npm run repo:audit && npm run public:pack && npm test -- --run src/__tests__/github_readiness_docs.test.ts src/__tests__/package_release_scripts.test.ts src/__tests__/npm_publish_workflow.test.ts'
    );
    expect(scripts['validate:fast']).toBe('npm run typecheck && npm run test:changed && npm run validate:public');
  });

  it('ships a focused npm package surface', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      files?: string[];
    };
    const files = packageJson.files ?? [];
    expect(files).toEqual([
      'dist/**/*.js',
      'dist/**/*.d.ts',
      '!dist/epistemics/belief_functions.js',
      '!dist/epistemics/belief_functions.d.ts',
      '!dist/epistemics/belief_revision.js',
      '!dist/epistemics/belief_revision.d.ts',
      '!dist/epistemics/calibration_laws.js',
      '!dist/epistemics/calibration_laws.d.ts',
      '!dist/epistemics/causal_reasoning.js',
      '!dist/epistemics/causal_reasoning.d.ts',
      '!dist/epistemics/conative_attitudes.js',
      '!dist/epistemics/conative_attitudes.d.ts',
      '!dist/epistemics/credal_sets.js',
      '!dist/epistemics/credal_sets.d.ts',
      '!dist/epistemics/intuitive_grounding.js',
      '!dist/epistemics/intuitive_grounding.d.ts',
      '!dist/epistemics/experimental/index.js',
      '!dist/epistemics/experimental/index.d.ts',
      'dist/migrations/*.sql',
      '!dist/**/*.map',
      '!dist/test/**',
      '!dist/**/__tests__/**',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ]);
  });

  it('excludes test sources from distributable build output', () => {
    const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
      exclude?: string[];
    };
    const excludes = tsconfig.exclude ?? [];
    expect(excludes).toContain('**/*.test.ts');
    expect(excludes).toContain('**/__tests__/**');
  });

  it('keeps npm tarball lean by ignoring maps and test bundles', () => {
    const npmignorePath = path.join(process.cwd(), '.npmignore');
    expect(fs.existsSync(npmignorePath)).toBe(true);
    const npmignore = fs.readFileSync(npmignorePath, 'utf8');
    expect(npmignore).toContain('dist/**/*.map');
    expect(npmignore).toContain('dist/test/**');
    expect(npmignore).toContain('dist/**/__tests__/**');
  });
});
