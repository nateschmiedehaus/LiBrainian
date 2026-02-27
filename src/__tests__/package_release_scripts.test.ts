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
    expect(scripts['policy:npm:fresh']).toBe('node scripts/npm-freshness-guard.mjs');
    expect(scripts['test:e2e:outcome']).toBe('node scripts/e2e-outcome-harness.mjs --strict --agentic-report eval-results/agentic-use-case-review.json --artifact state/e2e/outcome-report.json --markdown state/e2e/outcome-report.md');
    expect(scripts['test:e2e:triage']).toBe('node scripts/e2e-outcome-triage.mjs --report state/e2e/outcome-report.json --artifact state/e2e/outcome-triage.json --markdown state/e2e/outcome-triage.md');
    expect(scripts['test:e2e:dev-truth']).toBe('node scripts/e2e-reality-gate.mjs --source tarball --strict --agentic-report eval-results/agentic-use-case-review.json --artifact state/e2e/reality-dev-truth.json --outcome-artifact state/e2e/outcome-report.dev-truth.json');
    expect(scripts['test:e2e:reality']).toContain('npm-freshness-guard.mjs');
    expect(scripts['test:e2e:reality']).toContain('e2e-reality-gate.mjs --source latest --strict');
    expect(scripts['eval:ab:diagnose']).toBeUndefined();
    expect(scripts['test:e2e:full']).toBe('npm run policy:e2e:mainline && npm run eval:use-cases:agentic && npm run test:e2e:outcome && npm run test:e2e:triage && npm run test:e2e:dev-truth && npm run test:e2e:reality && npm run test:e2e:acceptance');
    expect(scripts['release:github-packages']).toBe('node scripts/publish-github-package.mjs');
    expect(scripts['policy:e2e:mainline']).toBe('node scripts/e2e-mainline-guard.mjs --base main --prefix codex/');
    expect(scripts['gh:ship']).toContain('gh-flow-policy-check.mjs --mode pull');
    expect(scripts['gh:ship']).toContain('gh-flow-policy-check.mjs --mode merge');
    expect(scripts['gh:ship']).toContain('git-hygiene-guard.mjs --mode enforce --check-pr --require-issue-link');
    expect(scripts['gh:ship']).toContain('gh-autoland.mjs --preflight-npm-script validate:fast');
    expect(scripts['gh:cadence']).toContain('gh-flow-policy-check.mjs --mode pull');
    expect(scripts['gh:cadence']).toContain('git-hygiene-guard.mjs --mode enforce');
    expect(scripts['gh:cadence']).toContain('gh-pr-stabilize.mjs');
    expect(scripts['gh:cadence']).toContain('gh-branch-hygiene.mjs');
    expect(scripts['gh:branches:cleanup']).toBe('node scripts/gh-branch-hygiene.mjs');
    expect(scripts['librainian:update']).toBe('node scripts/run-with-tmpdir.mjs -- npx tsx src/cli/index.ts update');
    expect(scripts['librainian:update:staged']).toBe('node scripts/run-with-tmpdir.mjs -- npx tsx src/cli/index.ts update --staged');
    expect(scripts['hooks:update-index']).toBe('node scripts/hook-update-index.mjs');
    expect(scripts['hooks:install']).toBe('lefthook install');
    expect(scripts.prepare).toBe('npm run hooks:install');
    expect(scripts['evidence:drift-check']).toBe('node scripts/run-with-tmpdir.mjs -- tsx scripts/evidence-drift-guard.ts');
    expect(scripts['evidence:verify']).toBe('npm run evidence:drift-check');
    expect(scripts['eval:publish-gate']).toContain('npm run evidence:verify');
    expect(scripts['issues:plan']).toBe(
      'node scripts/run-with-tmpdir.mjs -- tsx scripts/issue-feedback-loop.ts --repo nateschmiedehaus/LiBrainian --state open --out state/plans/agent-issue-fix-plan.json'
    );
    expect(scripts['issues:plan']).not.toContain('--limit');
    expect(scripts.dogfood).toBe('node scripts/dogfood-sandbox.mjs');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-identity');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-release-provenance');
    expect(scripts.prepublishOnly).toContain('npm run public:pack');
    expect(scripts.prepublishOnly).toContain('npm run package:install-smoke');
  });

  it('contains packaging guard script files', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-package-identity.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-release-provenance.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'evidence-drift-guard.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'publish-github-package.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'public-pack-check.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'npm-freshness-guard.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'npm-external-blackbox-e2e.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'e2e-outcome-harness.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'e2e-outcome-triage.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'e2e-reality-gate.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'context-pack-export.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'context-pack-diff.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'gh-branch-hygiene.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'gh-pr-stabilize.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'ab-diagnosis.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'refresh-external-eval-corpus.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'refresh-external-eval-corpus-batched.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'git-hygiene-guard.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'prepush-patrol-smoke.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'e2e-mainline-guard.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'dogfood-sandbox.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'hook-update-index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'lefthook.yml'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), '.pre-commit-hooks.yaml'))).toBe(true);
  });

  it('routes pre-commit framework hook through the non-blocking update wrapper', () => {
    const hooksPath = path.join(process.cwd(), '.pre-commit-hooks.yaml');
    const hooksConfig = fs.readFileSync(hooksPath, 'utf8');
    expect(hooksConfig).toContain('id: librainian-update-staged');
    expect(hooksConfig).toContain('entry: node scripts/hook-update-index.mjs');
    expect(hooksConfig).toContain('pass_filenames: true');
  });

  it('routes pre-push patrol smoke through bounded runtime wrapper', () => {
    const hooksPath = path.join(process.cwd(), 'lefthook.yml');
    const hooksConfig = fs.readFileSync(hooksPath, 'utf8');
    expect(hooksConfig).toContain('pre-push:');
    expect(hooksConfig).toContain('patrol-smoke:');
    expect(hooksConfig).toContain('run: node scripts/prepush-patrol-smoke.mjs');
    expect(hooksConfig).toContain('optional: true');
  });

  it('documents temporary hook bypass policy for --no-verify', () => {
    const policyPath = path.join(process.cwd(), 'docs', 'archive', 'policies', 'hook-fallback-policy.md');
    expect(fs.existsSync(policyPath)).toBe(true);
    const policy = fs.readFileSync(policyPath, 'utf8');
    expect(policy).toContain('--no-verify');
    expect(policy).toContain('#832');
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
    expect(script).toContain('Package contains legacy memory cache paths');
    expect(script).toContain('Package contains deprecated integrations directory paths');
    expect(script).toContain('Package contains aspirational federation paths');
    expect(script).toContain('Zero-importer federation policy violated');
    expect(script).toContain('Package contains TODO/FIXME debt markers in runtime JS');
    expect(script).toContain('extractRelativeImportSpecifiers');
    expect(script).toContain('resolveRelativeImportCandidates');
    expect(script).toContain('Package excludes runtime-imported dist modules');
  });

  it('hardens package install smoke against lifecycle log noise', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('function parsePackOutput');
    expect(script).toContain('function runAllowFailure');
    expect(script).toContain('function assertNoModuleResolutionCrash');
    expect(script).toContain('Lifecycle hooks can write plain text before npm\'s JSON payload');
    expect(script).toContain('Unable to locate JSON payload in npm pack output');
    expect(script).toContain("'status', '--json'");
    expect(script).toContain("'query', 'smoke check', '--json', '--no-bootstrap', '--no-synthesis'");
    expect(script).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('enforces strict reality-gate skip semantics and artifact output', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'e2e-reality-gate.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('LIBRARIAN_E2E_SKIP_REASON');
    expect(script).toContain('Strict reality gate cannot skip');
    expect(script).toContain("kind: 'RealityGateReport.v1'");
    expect(script).toContain("'scripts/npm-external-blackbox-e2e.mjs'");
    expect(script).toContain("'scripts/e2e-outcome-harness.mjs'");
    expect(script).toContain('Outcome harness artifact missing');
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

  it('adds lightweight git hygiene guardrails for branch and PR stability', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'git-hygiene-guard.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain('Conflict markers detected');
    expect(script).toContain('Untracked/generated JS artifacts');
    expect(script).toContain('is behind origin/main');
    expect(script).toContain('missing an issue-closing keyword');
  });
  it('keeps issue planning uncapped by default', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'issue-feedback-loop.ts');
    const script = fs.readFileSync(scriptPath, 'utf8');
    expect(script).toContain("default: '0'");
    expect(script).toContain('0 means "no cap"');
  });

  it('defines staged validation scripts for daily, PR, and release gates', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['test:changed']).toBe(
      'node scripts/run-with-tmpdir.mjs --set LIBRAINIAN_TEST_MODE=unit -- vitest --run --changed'
    );
    expect(scripts['validate:fast']).toContain('npm run typecheck');
    expect(scripts['validate:fast']).toContain('npm run test:changed');
    expect(scripts['validate:fast']).toContain('guard-generated-artifacts.mjs');
    expect(scripts['validate:fast']).toContain('repo-folder-audit.mjs');
    expect(scripts['validate:fast']).toContain('public-pack-check.mjs');
    expect(scripts['validate:fast']).toContain('evidence-drift-guard.ts');
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
      '!dist/guidance/**',
      '!dist/skills/**',
      '!dist/federation/**',
      '!dist/evaluation/**',
      '!dist/evolution/**',
      '!dist/agents/self_improvement/**',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ]);
  });

  it('excludes test sources from distributable build output', () => {
    const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
      compilerOptions?: { removeComments?: boolean };
      exclude?: string[];
    };
    expect(tsconfig.compilerOptions?.removeComments).toBe(true);
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
    expect(npmignore).toContain('dist/evaluation/**');
    expect(npmignore).toContain('dist/federation/**');
    expect(npmignore).toContain('dist/evolution/**');
    expect(npmignore).toContain('dist/agents/self_improvement/**');
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
