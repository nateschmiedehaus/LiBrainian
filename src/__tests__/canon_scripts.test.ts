import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readScripts(): Record<string, string> {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

describe('canonical npm scripts', () => {
  it('declares the maintained strict release chain', () => {
    const scripts = readScripts();

    expect(scripts['eval:publish-gate']).toBeTypeOf('string');
    expect(scripts['eval:live-fire:hardcore']).toBeTypeOf('string');
    expect(scripts['eval:use-cases:agentic']).toBeTypeOf('string');
    expect(scripts['eval:testing-discipline']).toBeTypeOf('string');
    expect(scripts['eval:testing-tracker']).toBeTypeOf('string');
    expect(scripts['smoke:external:all']).toBeTypeOf('string');
    expect(scripts['test:agentic:strict']).toBeTypeOf('string');
    expect(scripts['test:agentic:strict:quick']).toBeTypeOf('string');
    expect(scripts['policy:npm:fresh']).toBeTypeOf('string');
  });

  it('pins strict release-evidence enforcement in scripts', () => {
    const scripts = readScripts();

    expect(scripts['eval:publish-gate']).toContain('--zero-warning');
    expect(scripts['eval:publish-gate']).toContain('npm run evidence:verify');
    expect(scripts['eval:publish-gate']).toContain('canon_guard.mjs');
    expect(scripts['eval:publish-gate']).toContain('complexity_check.mjs');

    expect(scripts['eval:live-fire:hardcore']).toContain('--output state/eval/live-fire/hardcore/report.json');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxUseCases 120');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxRepos 8');
    expect(scripts['eval:use-cases:agentic']).toContain('--evidenceProfile release');
    expect(scripts['eval:use-cases:agentic']).toContain('--progressive');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxStrictFailureShare 0');
    expect(scripts['eval:use-cases:agentic']).toContain('--minTargetDependencyReadyShare 1');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_LLM_PROVIDER=codex');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_LLM_MODEL=gpt-5-codex');
    expect(scripts['eval:use-cases:agentic']).toContain('--set LIBRARIAN_CROSS_ENCODER=0');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_CROSS_ENCODER=0');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--selectionMode adaptive');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--uncertaintyHistoryPath eval-results/agentic-use-case-review.json');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--out eval-results/agentic-use-case-review.quick.json');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--evidenceProfile quick');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--deterministicQueries');

    expect(scripts['test:agentic:strict']).toContain('npm run eval:use-cases:agentic');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:live-fire:hardcore');
    expect(scripts['test:agentic:strict']).toContain('npm run smoke:external:all');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:testing-discipline');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:testing-tracker');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:publish-gate');
    expect(scripts['test:agentic:strict']).not.toContain('eval:ab:');

    expect(scripts['test:agentic:strict:quick']).toContain('npm run eval:use-cases:agentic:quick');
    expect(scripts['test:agentic:strict:quick']).toContain('npm run eval:live-fire:quick');
    expect(scripts['test:agentic:strict:quick']).toContain('npm run smoke:external:sample');
    expect(scripts['test:agentic:strict:quick']).not.toContain('eval:ab:');
    expect(scripts['test:agentic:strict:quick']).not.toContain('eval:publish-gate');

    expect(scripts['prepublishOnly']).not.toContain('npm run test:agentic:strict');
    expect(scripts['eval:ab']).toBeUndefined();
    expect(scripts['eval:ab:agentic']).toBeUndefined();
    expect(scripts['eval:ab:agentic-bugfix']).toBeUndefined();
    expect(scripts['eval:ab:agentic-bugfix:codex']).toBeUndefined();
    expect(scripts['eval:ab:agentic-bugfix:quick']).toBeUndefined();
  });

  it('forbids temporary inspection scripts in scripts/', () => {
    const scriptsDir = path.join(process.cwd(), 'scripts');
    const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
    const forbidden = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^tmp[_-]/i.test(name));

    expect(forbidden).toEqual([]);
  });

  it('uses deterministic complexity-check invocation contract', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'complexity_check.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('--workspace src analyze --complexity --format json');
    expect(script).not.toContain('2>&1');
  });
});
