import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RequiredGuide = {
  file: string;
  title: string;
};

const repoRoot = process.cwd();
const integrationsRoot = resolve(repoRoot, 'docs', 'integrations');

const requiredGuides: RequiredGuide[] = [
  { file: 'mcp.md', title: 'MCP Integration' },
  { file: 'cli.md', title: 'CLI Integration' },
  { file: 'rest-api.md', title: 'OpenAPI/REST Integration' },
  { file: 'utcp.md', title: 'UTCP Integration' },
  { file: 'a2a.md', title: 'A2A Integration' },
  { file: 'python-sdk.md', title: 'Python SDK Integration' },
];

const requiredSections = [
  'Prerequisites',
  'Working example',
  'Real-world use case',
  'Troubleshooting',
  'Related tests',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('integration guide docs', () => {
  it('ships a universal integration hub with required surface links', () => {
    const integrationReadme = resolve(integrationsRoot, 'README.md');
    expect(existsSync(integrationReadme)).toBe(true);

    const content = readFileSync(integrationReadme, 'utf8');
    expect(content).toContain('# Universal Integration Guide');
    expect(content).toContain('## Decision Tree');

    for (const guide of requiredGuides) {
      expect(content).toContain(`./${guide.file}`);
    }

    expect(existsSync(resolve(integrationsRoot, 'protocol-adapters.md'))).toBe(true);
  });

  it('keeps all required integration guides with expected sections and code examples', () => {
    for (const guide of requiredGuides) {
      const filePath = resolve(integrationsRoot, guide.file);
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain(`# ${guide.title}`);

      for (const section of requiredSections) {
        const heading = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'im');
        expect(content).toMatch(heading);
      }

      expect(content).toMatch(/```[a-zA-Z0-9_-]*\n[\s\S]+?```/);
    }
  });

  it('links integration docs from root readme and docs index', () => {
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    expect(readme).toContain('## Integration Decision Tree');
    expect(readme).toContain('docs/integrations/README.md');

    for (const guide of requiredGuides) {
      expect(readme).toContain(`docs/integrations/${guide.file}`);
    }

    const docsIndex = readFileSync(resolve(repoRoot, 'docs', 'README.md'), 'utf8');
    expect(docsIndex).toContain('/docs/integrations/README.md');
  });
});
