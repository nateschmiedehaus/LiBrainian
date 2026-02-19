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
    expect(scripts['release:github-packages']).toBe('node scripts/publish-github-package.mjs');
    expect(scripts['gh:ship']).toBe('npm run policy:merge && node scripts/gh-autoland.mjs --preflight-npm-script validate:fast');
    expect(scripts['gh:prs:stabilize:dry-run']).toBe('node scripts/gh-pr-stabilize.mjs --dry-run');
    expect(scripts['gh:prs:stabilize']).toBe('node scripts/gh-pr-stabilize.mjs');
    expect(scripts['gh:cadence']).toBe('npm run policy:pull && npm run gh:prs:stabilize && npm run gh:branches:cleanup');
    expect(scripts['gh:branches:dry-run']).toBe('node scripts/gh-branch-hygiene.mjs --dry-run');
    expect(scripts['gh:branches:cleanup']).toBe('node scripts/gh-branch-hygiene.mjs');
    expect(scripts['librainian:update']).toBe('node scripts/run-with-tmpdir.mjs -- npx tsx src/cli/index.ts update');
    expect(scripts['librainian:update:staged']).toBe('node scripts/run-with-tmpdir.mjs -- npx tsx src/cli/index.ts update --staged');
    expect(scripts['hooks:update-index']).toBe('node scripts/hook-update-index.mjs');
    expect(scripts['hooks:install']).toBe('lefthook install');
    expect(scripts.prepare).toBe('npm run hooks:install');
    expect(scripts['evidence:drift-check']).toBe('node scripts/run-with-tmpdir.mjs -- tsx scripts/evidence-drift-guard.ts');
    expect(scripts['evidence:sync']).toBe('npm run evidence:manifest && npm run evidence:reconcile');
    expect(scripts['issues:plan']).toBe(
      'node scripts/run-with-tmpdir.mjs -- tsx scripts/issue-feedback-loop.ts --repo nateschmiedehaus/LiBrainian --state open --out state/plans/agent-issue-fix-plan.json'
    );
    expect(scripts['issues:plan']).not.toContain('--limit');
    expect(scripts.dogfood).toBe('node scripts/dogfood-sandbox.mjs');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-identity');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-release-provenance');
    expect(scripts.prepublishOnly).toContain('npm run package:install-smoke');
  });

  it('contains packaging guard script files', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-package-identity.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-release-provenance.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'evidence-drift-guard.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'publish-github-package.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'public-pack-check.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'gh-branch-hygiene.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'gh-pr-stabilize.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'dogfood-sandbox.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'hook-update-index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'lefthook.yml'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), '.pre-commit-hooks.yaml'))).toBe(true);
  });

  it('hardens public pack check against lifecycle log noise', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'public-pack-check.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('function parsePackOutput');
    expect(script).toContain('may emit plain text before JSON');
    expect(script).toContain('Unable to locate JSON payload in npm pack output');
    expect(script).toContain('DEFAULT_MAX_UNPACKED_SIZE_MB = 15');
    expect(script).toContain('Package unpacked size exceeds budget');
    expect(script).toContain('LIBRARIAN_MAX_UNPACKED_SIZE_MB');
  });

  it('hardens package install smoke against lifecycle log noise', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('function parsePackOutput');
    expect(script).toContain('Lifecycle hooks can write plain text before npm\'s JSON payload');
    expect(script).toContain('Unable to locate JSON payload in npm pack output');
  });

  it('publishes GitHub packages with repository-linked metadata for package visibility', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'publish-github-package.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('GITHUB_REPOSITORY');
    expect(script).toContain('Missing GitHub repository metadata');
    expect(script).toContain('git+https://github.com/');
    expect(script).toContain('?tab=packages');
  });

  it('runs dogfood commands from target workspace without mutating CLI args', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'dogfood-sandbox.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain("arg === '-w'");
    expect(script).toContain('const binPath = path.join(sandboxDir, \'node_modules\', \'.bin\', \'librainian\')');
    expect(script).toContain('cwd: workspace');
  });

  it('keeps autoland usable when gh auth is unavailable', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'gh-autoland.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('gh auth unavailable. Falling back to push-only mode.');
    expect(script).toContain('To enable full auto-PR/merge behavior, run: gh auth login -h github.com');
    expect(script).toContain('https://github.com/${repo}/pull/new/');
  });

  it('adds branch hygiene automation for stale codex branches', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'gh-branch-hygiene.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('refs/remotes/origin/${prefix}*');
    expect(script).toContain('Dry run: delete remote');
    expect(script).toContain('GitHub API request failed');
  });

  it('adds PR stabilizer automation for frequent restack and merge cadence', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'gh-pr-stabilize.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain("'update-branch'");
    expect(script).toContain("'merge'");
    expect(script).toContain('Dry run: update-branch');
    expect(script).toContain('complete repo=');
  });

  it('keeps issue planning uncapped by default', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'issue-feedback-loop.ts');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain("default: '0'");
    expect(script).toContain('0 means \"no cap\"');
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
      'npm run repo:audit && npm run public:pack && npm run evidence:drift-check && npm test -- --run src/__tests__/github_readiness_docs.test.ts src/__tests__/package_release_scripts.test.ts src/__tests__/npm_publish_workflow.test.ts'
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

  it('defines lint-staged integration for staged incremental indexing', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      ['lint-staged']?: Record<string, string[]>;
    };
    const lintStaged = packageJson['lint-staged'] ?? {};
    expect(lintStaged['*.{ts,tsx,js,jsx,mjs,cjs}']).toEqual([
      'node scripts/hook-update-index.mjs',
    ]);
  });
});
