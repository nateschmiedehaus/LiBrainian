import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConstructionPlan, LibrarianQuery } from '../types.js';
import {
  DOMAIN_TO_TEMPLATES,
  getDefaultTemplateRegistry,
  getDomainForUcId,
  type IntentHints,
  type ConstructionTemplate,
} from './template_registry.js';

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

type RankedCandidate = NonNullable<ConstructionPlan['rankedCandidates']>[number];

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

  const matrixPath = path.join(root, 'docs', 'archive', 'USE_CASE_MATRIX.md');
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

  const specPath = path.join(root, 'docs', 'archive', 'specs', 'core', 'construction-templates.md');
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
  const registry = getDefaultTemplateRegistry();
  const rankedCandidates: RankedCandidate[] = [];
  const ucDomains = new Set<string>();

  const resolveDepthHint = (depth: LibrarianQuery['depth']): IntentHints['depth'] => {
    if (!depth) return undefined;
    if (depth === 'L0' || depth === 'L1') return 'shallow';
    if (depth === 'L2') return 'medium';
    return 'deep';
  };

  if (ucIds.length > 0) {
    source = 'uc';
    const domains = new Set<string>();
    const missingDomains: string[] = [];
    for (const ucId of ucIds) {
      const resolved = getDomainForUcId(ucId);
      if (resolved) {
        domains.add(resolved);
        ucDomains.add(resolved);
      } else {
        missingDomains.push(ucId);
      }
    }
    if (missingDomains.length > 0) {
      disclosures.push(`unverified_by_trace(uc_domain_missing): ${missingDomains.join(', ')}`);
    }
    if (domains.size > 0) {
      domain = domains.values().next().value;
      if (domains.size > 1) {
        disclosures.push(`unverified_by_trace(uc_domain_mismatch): ${Array.from(domains).join(', ')}`);
      }
    }

    const templateCandidates = ucIds.flatMap((ucId) => registry.templatesForUc(ucId));
    const deduped = new Map(templateCandidates.map((template) => [template.id, template]));
    if (deduped.size === 0) {
      disclosures.push(`unverified_by_trace(template_mapping_missing): ${ucIds.join(', ')}`);
    } else {
      const ucIdSet = new Set(ucIds);
      const rankedUcCandidates = Array.from(deduped.values())
        .map((template) => {
          const explicitUcMatches = template.supportedUcs.filter((ucId) => ucIdSet.has(ucId)).length;
          const domainMatches = Array.from(ucDomains).filter((candidateDomain) =>
            (DOMAIN_TO_TEMPLATES[candidateDomain] ?? []).includes(template.id)
          ).length;
          const capabilityBoost = (template.requiredCapabilities?.length ?? 0) > 0 ? 0.1 : 0;
          const score = explicitUcMatches * 2 + domainMatches + capabilityBoost;
          const reasoningParts: string[] = [];
          if (explicitUcMatches > 0) reasoningParts.push(`explicit_uc_match=${explicitUcMatches}`);
          if (domainMatches > 0) reasoningParts.push(`domain_match=${domainMatches}`);
          if (capabilityBoost > 0) reasoningParts.push('capability_declared');
          return {
            template,
            score,
            reasoning: reasoningParts.join(', ') || 'uc_candidate',
          };
        })
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          return left.template.id.localeCompare(right.template.id);
        });
      const selected = rankedUcCandidates[0]?.template;
      templateId = selected?.id ?? templateId;
      rankedCandidates.push(
        ...rankedUcCandidates.map((entry) => ({
          templateId: entry.template.id,
          score: Number(entry.score.toFixed(3)),
          reasoning: entry.reasoning,
          source: 'uc' as const,
        }))
      );
      if (deduped.size > 1) {
        disclosures.push(`template_selection_multi: ${Array.from(deduped.keys()).join(', ')}`);
      }
    }
  } else if (query.intent) {
    source = 'intent';
    const hints: IntentHints = {
      affectedFiles: query.affectedFiles,
      depth: resolveDepthHint(query.depth),
      tokenBudget: query.tokenBudget?.maxTokens,
    };
    const ranked = registry.templatesForIntent(query.intent, hints);
    if (ranked.length > 0) {
      templateId = ranked[0].template.id;
      rankedCandidates.push(
        ...ranked.map((entry) => ({
          templateId: entry.template.id,
          score: Number(entry.score.toFixed(3)),
          reasoning: entry.reasoning,
          source: 'intent' as const,
        }))
      );
      if (ranked.length > 1) {
        disclosures.push(`template_selection_ranked: ${ranked.map((entry) => entry.template.id).join(', ')}`);
      }
    } else {
      disclosures.push('unverified_by_trace(intent_template_defaulted): T1');
    }
  }

  if (rankedCandidates.length === 0) {
    rankedCandidates.push({
      templateId,
      score: 0,
      reasoning: 'default_template_selection',
      source: 'default',
    });
  }

  const selectedTemplate = registry.getConstructionTemplate(templateId);
  const selectionReason = `selected ${templateId} via ${source}`;

  const plan: ConstructionPlan = {
    id: `cp_${randomUUID()}`,
    templateId,
    ucIds,
    domain,
    intent: query.intent ?? '',
    source,
    createdAt: new Date().toISOString(),
    selectionReason,
    rankedCandidates,
    ...toPlanRequirements(selectedTemplate),
  };

  return { plan, disclosures };
}

function toPlanRequirements(template: ConstructionTemplate | null): Pick<
  ConstructionPlan,
  | 'requiredMaps'
  | 'optionalMaps'
  | 'requiredObjects'
  | 'optionalObjects'
  | 'requiredCapabilities'
  | 'requiredArtifacts'
> {
  if (!template) return {};
  return {
    requiredMaps: template.requiredMaps.slice(),
    optionalMaps: template.optionalMaps.slice(),
    requiredObjects: template.requiredObjects.slice(),
    optionalObjects: template.optionalObjects?.slice(),
    requiredCapabilities: template.requiredCapabilities?.slice(),
    requiredArtifacts: template.requiredArtifacts?.slice(),
  };
}
