import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const agentsPath = resolve(repoRoot, 'AGENTS.md');
const claudePath = resolve(repoRoot, 'CLAUDE.md');

describe('agent policy docs', () => {
  it('keeps AGENTS and CLAUDE aligned on strict release rules', () => {
    expect(existsSync(agentsPath)).toBe(true);
    expect(existsSync(claudePath)).toBe(true);

    const agents = readFileSync(agentsPath, 'utf8');
    const claude = readFileSync(claudePath, 'utf8');
    const normalizedAgents = agents.toLowerCase();
    const normalizedClaude = claude.toLowerCase();

    for (const marker of [
      'real_agent_real_librarian_only',
      'no_retry_no_fallback',
      '100%',
      'test:agentic:strict',
      'conversation_insights.md',
    ]) {
      expect(normalizedAgents).toContain(marker);
      expect(normalizedClaude).toContain(marker);
    }
  });
});
