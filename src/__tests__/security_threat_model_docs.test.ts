import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('security threat model docs', () => {
  it('publishes docs/security.md with required threat-model sections', () => {
    const filePath = path.join(process.cwd(), 'docs', 'security.md');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('# Security Threat Model');
    expect(content).toContain('## Data Flows');
    expect(content).toContain('## External Network Calls');
    expect(content).toContain('## Attack Surfaces');
    expect(content).toContain('## Prompt Injection via Code Comments');
    expect(content).toContain('## Required Runtime Modes');
  });

  it('documents known outbound endpoints', () => {
    const content = fs.readFileSync(path.join(process.cwd(), 'docs', 'security.md'), 'utf8');
    expect(content).toContain('api.github.com');
    expect(content).toContain('/rest/api/3/search');
    expect(content).toContain('api.pagerduty.com');
    expect(content).toContain('registry.npmjs.org');
    expect(content).toContain('pypi.org');
    expect(content).toContain('crates.io');
  });

  it('documents security contact in SECURITY.md', () => {
    const content = fs.readFileSync(path.join(process.cwd(), 'SECURITY.md'), 'utf8');
    expect(content).toContain('security@librainian.dev');
  });
});
