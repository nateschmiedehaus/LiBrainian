import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

function readDoc(pathFromRoot: string): string {
  return readFileSync(resolve(repoRoot, pathFromRoot), 'utf8');
}

describe('agent session test invocation docs', () => {
  it('documents concrete agent-session invocation in core test docs', () => {
    const testPolicy = readDoc('docs/TEST.md');
    const liveFire = readDoc('docs/librarian/LIVE_FIRE_E2E.md');
    const validation = readDoc('docs/librarian/validation.md');

    expect(testPolicy).toContain('Agent Session Invocation Runbook (Tier-2)');
    expect(testPolicy).toContain('AB_HARNESS_AGENT_CMD');
    expect(testPolicy).toContain('AB_HARNESS_PROMPT_FILE');
    expect(testPolicy).toContain('npm run eval:ab:agentic-bugfix:codex');
    expect(testPolicy).toContain('npm run eval:use-cases:agentic');
    expect(testPolicy).toContain('npm run test:agentic:strict');

    expect(liveFire).toContain('Agent Session Invocation (A/B + Live-Fire)');
    expect(liveFire).toContain('AB_HARNESS_AGENT_CMD');
    expect(liveFire).toContain('AB_HARNESS_WORKSPACE_ROOT');
    expect(liveFire).toContain('npm run test:agentic:strict');

    expect(validation).toContain('Agent Session Qualification Invocation');
    expect(validation).toContain('npm run eval:ab:agentic-bugfix:codex');
    expect(validation).toContain('npm run eval:use-cases:agentic');
  });
});
