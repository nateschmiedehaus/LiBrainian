import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('github readiness docs', () => {
  it('includes required governance files', () => {
    const root = process.cwd();
    expect(fs.existsSync(path.join(root, 'CODE_OF_CONDUCT.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'SECURITY.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.github', 'CODEOWNERS'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'config.yml'))).toBe(true);
  });

  it('links governance docs from README', () => {
    const readmePath = path.join(process.cwd(), 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');
    expect(readme).toContain('## Community Standards');
    expect(readme).toContain('[Code of Conduct](CODE_OF_CONDUCT.md)');
    expect(readme).toContain('[Security Policy](SECURITY.md)');
  });

  it('documents release-grade validation in contributing guide', () => {
    const contributingPath = path.join(process.cwd(), 'CONTRIBUTING.md');
    const contributing = fs.readFileSync(contributingPath, 'utf8');
    expect(contributing).toContain('### Release-Grade Validation (Required Before Merge)');
    expect(contributing).toContain('npm run package:assert-identity');
    expect(contributing).toContain('npm run package:install-smoke');
    expect(contributing).toContain('npm run eval:publish-gate -- --json');
  });

  it('keeps internal orchestration docs out of repository root', () => {
    const root = process.cwd();
    const internalRootArtifacts = [
      'CODEX_ORCHESTRATOR.md',
      'CODEX_FULL_IMPLEMENTATION.md',
      'CODEX_ORCHESTRATOR_PROMPT.md',
      'COMPLETE_FIX_PLAN.md',
      'ORCHESTRATION_TASKS.md',
      'START_IMPLEMENTATION.md',
      'HARD_STOP.md',
      'LIBRARIAN_QUALITY_EVALUATION_PLAN.md',
      'META_PROMPT_CRITICAL_EVALUATION.md',
    ];

    for (const file of internalRootArtifacts) {
      expect(fs.existsSync(path.join(root, file))).toBe(false);
    }

    expect(fs.existsSync(path.join(root, 'docs', 'internal', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'docs', 'internal', 'archive'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.github', 'README.md'))).toBe(false);
  });

  it('keeps public repo surface free of wip and vendored eval repos', () => {
    const trackedFiles = execSync('git ls-files', {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const trackedWip = trackedFiles.filter(
      (file) => file.endsWith('.wip') && fs.existsSync(path.join(process.cwd(), file))
    );
    expect(trackedWip).toEqual([]);

    const trackedEvalRepoExtras = trackedFiles.filter(
      (file) =>
        file.startsWith('eval-corpus/external-repos/') &&
        file !== 'eval-corpus/external-repos/manifest.json'
    );
    expect(trackedEvalRepoExtras).toEqual([]);
  });
});
