import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('performance SLA docs', () => {
  it('publishes docs/performance-sla.md', () => {
    const filePath = path.join(process.cwd(), 'docs', 'performance-sla.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('# Performance SLA');
    expect(content).toContain('## Query Latency');
    expect(content).toContain('## Indexing Throughput');
    expect(content).toContain('## Memory Budget');
    expect(content).toContain('## CI Enforcement Policy');
  });

  it('documents performance characteristics in README', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('## Performance Characteristics');
    expect(readme).toContain('librarian benchmark');
    expect(readme).toContain('--fail-on block');
  });

  it('enforces deterministic benchmark gate in CI', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(workflow).toContain('Performance SLA benchmark gate');
    expect(workflow).toContain('src/cli/index.ts benchmark');
    expect(workflow).toContain('--fail-on block');
    expect(workflow).toContain('PerformanceSLAReport.v1.json');
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
  });
});
