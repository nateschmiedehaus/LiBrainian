import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConstructionPlan, LibrarianQuery } from '../types.js';

type UcRow = {
  id: string;
  domain: string;
  need: string;
  dependencies: string[];
  mechanisms: string;
  status: string;
};

const ucDomainCache = new Map<string, Map<string, string>>();
const domainTemplateCache = new Map<string, Map<string, string[]>>();

function resolveRepoRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
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

function parseDomainTemplateMap(constructionTemplatesSpec: string): Map<string, string[]> {
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

export async function loadUcDomainMap(workspaceRoot: string): Promise<Map<string, string>> {
  const root = resolveRepoRoot(workspaceRoot);
  const cached = ucDomainCache.get(root);
  if (cached) return cached;

  const matrixPath = path.join(root, 'docs', 'librarian', 'USE_CASE_MATRIX.md');
  const markdown = await fs.readFile(matrixPath, 'utf8');
  const rows = parseUseCaseRows(markdown);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.domain);
  }
  ucDomainCache.set(root, map);
  return map;
}

export async function loadDomainTemplateMap(workspaceRoot: string): Promise<Map<string, string[]>> {
  const root = resolveRepoRoot(workspaceRoot);
  const cached = domainTemplateCache.get(root);
  if (cached) return cached;

  const specPath = path.join(root, 'docs', 'librarian', 'specs', 'core', 'construction-templates.md');
  const markdown = await fs.readFile(specPath, 'utf8');
  const map = parseDomainTemplateMap(markdown);
  domainTemplateCache.set(root, map);
  return map;
}

export async function buildConstructionPlan(
  query: LibrarianQuery,
  workspaceRoot: string
): Promise<{ plan: ConstructionPlan; disclosures: string[] }> {
  const disclosures: string[] = [];
  const ucIds = query.ucRequirements?.ucIds ?? [];
  let domain: string | undefined;
  let templateId = 'T1';
  let source: ConstructionPlan['source'] = 'default';

  if (ucIds.length > 0) {
    source = 'uc';
    try {
      const ucDomainMap = await loadUcDomainMap(workspaceRoot);
      const domains = new Set(ucIds.map((id) => ucDomainMap.get(id)).filter(Boolean) as string[]);
      if (domains.size === 0) {
        disclosures.push(`unverified_by_trace(uc_missing): ${ucIds.join(', ')}`);
      } else {
        const domainValue = domains.values().next().value;
        domain = domainValue ?? '';
        if (domains.size > 1) {
          disclosures.push(`unverified_by_trace(uc_domain_mismatch): ${Array.from(domains).join(', ')}`);
        }
        const domainMap = await loadDomainTemplateMap(workspaceRoot);
        const templates = domainMap.get(domain) ?? [];
        if (templates.length === 0) {
          disclosures.push(`unverified_by_trace(template_mapping_missing): ${domain}`);
        } else {
          templateId = templates[0]!;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      disclosures.push(`unverified_by_trace(construction_template_unavailable): ${message}`);
    }
  }

  const plan: ConstructionPlan = {
    id: `cp_${randomUUID()}`,
    templateId,
    ucIds,
    domain,
    intent: query.intent ?? '',
    source,
    createdAt: new Date().toISOString(),
  };

  return { plan, disclosures };
}
