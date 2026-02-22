import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('canonical npm scripts', () => {
  it('declares evaluation scripts referenced by staged evaluation', () => {
    const root = process.cwd();
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    expect(scripts['test:tier0']).toBeTypeOf('string');
    expect(scripts['test:e2e:reality']).toBeTypeOf('string');
    expect(scripts['test:e2e:triage']).toBeTypeOf('string');
    expect(scripts['test:e2e:cadence']).toBeTypeOf('string');
    expect(scripts['tier1:dogfood']).toBeTypeOf('string');
    expect(scripts['complexity:check']).toBeTypeOf('string');
    expect(scripts['eval:publish-gate']).toBeTypeOf('string');
    expect(scripts['validate:checkpoint']).toBeTypeOf('string');
    expect(scripts['validate:checkpoint']).toBe('node scripts/validate-checkpoint.mjs');
    expect(scripts['eval:ab:agentic-bugfix:codex']).toBeTypeOf('string');
    expect(scripts['eval:live-fire:hardcore']).toBeTypeOf('string');
    expect(scripts['eval:use-cases:agentic']).toBeTypeOf('string');
    expect(scripts['eval:testing-discipline']).toBeTypeOf('string');
    expect(scripts['eval:testing-tracker']).toBeTypeOf('string');
    expect(scripts['test:agentic:strict']).toBeTypeOf('string');
    expect(scripts['policy:npm:fresh']).toBeTypeOf('string');
  });

  it('pins strict release-evidence enforcement in scripts', () => {
    const root = process.cwd();
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    expect(scripts['eval:publish-gate']).toContain('--zero-warning');
    expect(scripts['eval:publish-gate']).toContain('npm run validate:checkpoint');
    expect(scripts['eval:publish-gate']).toContain('npm run canon:guard');
    expect(scripts['eval:publish-gate']).toContain('npm run complexity:check');
    expect(scripts['eval:ab:agentic']).toContain('--maxVerificationFallbackShare 0');
    expect(scripts['eval:ab:agentic']).toContain('--minAgentCritiqueShare 1');
    expect(scripts['eval:ab:agentic']).toContain('--requireT3Significance');
    expect(scripts['eval:ab:agentic']).toContain('--evidenceProfile release');
    expect(scripts['eval:ab:agentic']).toContain('--timeoutMs 420000');
    expect(scripts['eval:ab:agentic-bugfix']).toContain('--maxVerificationFallbackShare 0');
    expect(scripts['eval:ab:agentic-bugfix']).toContain('--minAgentCritiqueShare 1');
    expect(scripts['eval:ab:agentic-bugfix']).toContain('--requireT3Significance');
    expect(scripts['eval:ab:agentic-bugfix']).toContain('--evidenceProfile release');
    expect(scripts['eval:ab:agentic-bugfix']).toContain('--timeoutMs 420000');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('ab-agent-codex.mjs');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('AB_HARNESS_AGENT_TIMEOUT_MS=180000');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--timeoutMs 180000');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--maxTasks 6');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--selectionMode adaptive');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--minAgentCritiqueShare 1');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--uncertaintyHistoryPath eval-results/ab-harness-report.json');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--out eval-results/ab-harness-report.quick.json');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--evidenceProfile quick');
    expect(scripts['eval:ab:agentic-bugfix:quick']).toContain('--disableT3CeilingTimeReduction');
    expect(scripts['eval:live-fire:hardcore']).toContain('--output state/eval/live-fire/hardcore/report.json');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxUseCases 120');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxRepos 8');
    expect(scripts['eval:use-cases:agentic']).toContain('--evidenceProfile release');
    expect(scripts['eval:use-cases:agentic']).toContain('--progressive');
    expect(scripts['eval:use-cases:agentic']).toContain('--maxStrictFailureShare 0');
    expect(scripts['eval:use-cases:agentic']).toContain('--minTargetDependencyReadyShare 1');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_LLM_PROVIDER=codex');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_LLM_MODEL=gpt-5-codex');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--set LIBRARIAN_CROSS_ENCODER=0');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--selectionMode adaptive');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--uncertaintyHistoryPath eval-results/agentic-use-case-review.json');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--out eval-results/agentic-use-case-review.quick.json');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--evidenceProfile quick');
    expect(scripts['eval:use-cases:agentic:quick']).toContain('--deterministicQueries');
    expect(scripts['eval:trial-by-fire:publish']).toContain('npm run eval:use-cases:agentic');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:ab:agentic-bugfix:codex');
    expect(scripts['test:agentic:strict:quick']).toContain('npm run eval:ab:agentic-bugfix:quick');
    expect(scripts['test:agentic:strict:quick']).not.toContain('agentic-bugfix:reference');
    expect(scripts['test:agentic:strict:quick']).not.toContain('eval:publish-gate');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:use-cases:agentic');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:live-fire:hardcore');
    expect(scripts['test:agentic:strict']).toContain('npm run smoke:external:all');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:testing-discipline');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:testing-tracker');
    expect(scripts['test:agentic:strict']).toContain('npm run eval:publish-gate');
    expect(scripts['prepublishOnly']).not.toContain('npm run test:agentic:strict');
    expect(scripts['release:qualify']).toContain('npm run validate:full');
    expect(scripts['release:qualify']).toContain('npm run test:agentic:strict');
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
