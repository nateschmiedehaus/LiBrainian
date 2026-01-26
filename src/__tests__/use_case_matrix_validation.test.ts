/**
 * @fileoverview Use-Case Matrix Validation (Deterministic, Tier-0)
 *
 * What this test IS:
 * - A deterministic integrity check that the canonical UC catalog exists,
 *   is parseable, and has expected invariants (IDs, counts, dependency refs).
 *
 * What this test is NOT:
 * - A “coverage %” test proving Librarian solves the use cases. That requires
 *   Tier‑2 live-provider suites and audited artifacts (no theater).
 *
 * Canonical source:
 * - docs/librarian/USE_CASE_MATRIX.md
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

type UcRow = {
  id: string;
  domain: string;
  need: string;
  dependencies: string[];
  mechanisms: string;
  status: string;
};

type DomainTemplateMap = Map<string, string[]>;

function repoRoot(): string {
  let current = path.resolve(__dirname);
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function loadUseCaseMatrix(): string {
  const matrixPath = path.join(repoRoot(), 'docs/librarian/USE_CASE_MATRIX.md');
  return fs.readFileSync(matrixPath, 'utf-8');
}

function loadConstructionTemplatesSpec(): string {
  const specPath = path.join(repoRoot(), 'docs/librarian/specs/core/construction-templates.md');
  return fs.readFileSync(specPath, 'utf-8');
}

function parseUseCaseRows(markdown: string): UcRow[] {
  const rows: UcRow[] = [];
  const lineRegex =
    /^\|\s*(?<id>UC-\d{3})\s*\|\s*(?<domain>[^|]+?)\s*\|\s*(?<need>[^|]+?)\s*\|\s*(?<deps>[^|]+?)\s*\|\s*(?<process>[^|]+?)\s*\|\s*(?<mech>[^|]+?)\s*\|\s*(?<status>[^|]+?)\s*\|\s*$/gm;

  for (const match of markdown.matchAll(lineRegex)) {
    const id = match.groups?.id?.trim();
    const domain = match.groups?.domain?.trim();
    const need = match.groups?.need?.trim();
    const depsRaw = match.groups?.deps?.trim();
    const mechanisms = match.groups?.mech?.trim();
    const status = match.groups?.status?.trim();
    if (!id || !domain || !need || !depsRaw || !mechanisms || !status) continue;

    const dependencies =
      depsRaw === 'none'
        ? []
        : depsRaw
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d.length > 0);

    rows.push({ id, domain, need, dependencies, mechanisms, status });
  }

  return rows;
}

function parseDomainTemplateMap(constructionTemplatesSpec: string): DomainTemplateMap {
  const startMarker = '### 6.1 Domain → default templates (v1, mechanical)';
  const startIdx = constructionTemplatesSpec.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`Missing required section in construction-templates spec: ${startMarker}`);
  }

  const section = constructionTemplatesSpec.slice(startIdx);

  const mapping = new Map<string, string[]>();
  const lineRegex = /^-\s*(?<domain>[A-Za-z0-9/ -]+)\s*:\s*(?<templates>T\d+(?:\s*,\s*T\d+)*)\s*$/gm;
  for (const match of section.matchAll(lineRegex)) {
    const domain = match.groups?.domain?.trim();
    const templatesRaw = match.groups?.templates?.trim();
    if (!domain || !templatesRaw) continue;
    const templates = templatesRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    mapping.set(domain, templates);
  }

  if (mapping.size === 0) {
    throw new Error('Parsed 0 domain→template mappings; expected at least 1');
  }

  return mapping;
}

function ucNumber(id: string): number {
  const match = id.match(/^UC-(\d{3})$/);
  if (!match) throw new Error(`Invalid UC id: ${id}`);
  return Number.parseInt(match[1] ?? '0', 10);
}

describe('Use-Case Matrix (docs) integrity', () => {
  it('contains 310 UC rows (UC-001…UC-310)', () => {
    const markdown = loadUseCaseMatrix();
    const rows = parseUseCaseRows(markdown);

    expect(rows.length).toBe(310);

    const ids = rows.map((r) => r.id).sort();
    expect(ids[0]).toBe('UC-001');
    expect(ids[ids.length - 1]).toBe('UC-310');

    const all = new Set(ids);
    for (let i = 1; i <= 310; i++) {
      const id = `UC-${String(i).padStart(3, '0')}`;
      expect(all.has(id)).toBe(true);
    }
  });

  it('has unique UC ids and valid dependency references', () => {
    const markdown = loadUseCaseMatrix();
    const rows = parseUseCaseRows(markdown);

    const allIds = new Set(rows.map((r) => r.id));
    expect(allIds.size).toBe(rows.length);

    const invalidDeps: Array<{ uc: string; dep: string }> = [];
    for (const row of rows) {
      for (const dep of row.dependencies) {
        if (!allIds.has(dep)) invalidDeps.push({ uc: row.id, dep });
      }
    }

    expect(invalidDeps).toEqual([]);
  });

  it('defines L0 foundation slice UC-001…UC-030', () => {
    const markdown = loadUseCaseMatrix();
    const rows = parseUseCaseRows(markdown);

    const foundation = rows.filter((r) => {
      const n = ucNumber(r.id);
      return n >= 1 && n <= 30;
    });

    expect(foundation.length).toBe(30);
    expect(foundation[0]?.id).toBe('UC-001');
    expect(foundation[foundation.length - 1]?.id).toBe('UC-030');
  });

  it('maps every UC domain to ≥1 construction template (mechanical default)', () => {
    const markdown = loadUseCaseMatrix();
    const rows = parseUseCaseRows(markdown);
    expect(rows.length).toBe(310);

    const spec = loadConstructionTemplatesSpec();
    const domainMap = parseDomainTemplateMap(spec);

    const domainsInMatrix = Array.from(new Set(rows.map((r) => r.domain))).sort();

    const missingDomains = domainsInMatrix.filter((d) => !domainMap.has(d));
    expect(missingDomains).toEqual([]);

    const invalidTemplates: Array<{ domain: string; template: string }> = [];
    for (const domain of domainsInMatrix) {
      const templates = domainMap.get(domain) ?? [];
      if (templates.length === 0) invalidTemplates.push({ domain, template: '(none)' });
      for (const template of templates) {
        if (!/^T(?:[1-9]|1[0-2])$/.test(template)) invalidTemplates.push({ domain, template });
      }
    }

    expect(invalidTemplates).toEqual([]);
  });
});
