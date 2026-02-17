import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const insightsPath = resolve(repoRoot, 'docs/librarian/CONVERSATION_INSIGHTS.md');
const statusPath = resolve(repoRoot, 'docs/librarian/STATUS.md');
const readmePath = resolve(repoRoot, 'docs/librarian/README.md');

const requiredHeadings = [
  '## Context Snapshot',
  '## Non-Negotiable Product Signals',
  '## Agent Failure Modes Observed',
  '## OpenClaw Patterns to Borrow (Mapped to LiBrainian files)',
  '## Action Items',
  '## Accepted Wording for Positioning',
  '## Deferred Ideas',
  '## Evidence Links',
];
const allowedMappings = new Set([
  'Code task',
  'Evaluation task',
  'Documentation task',
  'Gate/status update',
]);

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`${escaped}\\n([\\s\\S]*?)(\\n##\\s+|$)`));
  return match?.[1] ?? '';
}

describe('conversation insights doc', () => {
  it('exists and contains all required sections', () => {
    expect(existsSync(insightsPath)).toBe(true);
    const content = readFileSync(insightsPath, 'utf8');
    for (const heading of requiredHeadings) {
      expect(content).toContain(heading);
    }
    expect(content).toContain('major planning checkpoint');
    expect(content).toContain('before release-gate runs');
  });

  it('action items map to required categories and include concrete trace targets', () => {
    const content = readFileSync(insightsPath, 'utf8');
    const actionSection = extractSection(content, '## Action Items');
    const rows = actionSection.split('\n').filter((line) => /^\|\s*CI-\d+/i.test(line));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const columns = row.split('|').map((value) => value.trim());
      const mapping = columns[2] ?? '';
      const fileTargets = columns[4] ?? '';
      const gateImpact = columns[5] ?? '';
      expect(allowedMappings.has(mapping)).toBe(true);
      expect(/`[^`]+`/.test(fileTargets)).toBe(true);
      expect(/`[^`]+`/.test(gateImpact)).toBe(true);
    }
  });

  it('is cross-linked from docs README and STATUS', () => {
    const readme = readFileSync(readmePath, 'utf8');
    const status = readFileSync(statusPath, 'utf8');
    expect(readme).toContain('docs/LiBrainian/CONVERSATION_INSIGHTS.md');
    expect(status).toContain('docs/LiBrainian/CONVERSATION_INSIGHTS.md');
  });
});
