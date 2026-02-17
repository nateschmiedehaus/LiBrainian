/**
 * @fileoverview Construction template registry
 *
 * Provides a single entrypoint for template lookup and selection.
 */

import type { KnowledgeObjectKind } from './registry.js';
import { createTemplateRegistry, type ConstructionTemplate as ApiConstructionTemplate } from '../api/template_registry.js';

export type ConstructionTemplateId = `T${number}`;

export interface ConstructionTemplate {
  id: ConstructionTemplateId;
  name: string;
  description: string;
  requiredObjects: KnowledgeObjectKind[];
  optionalObjects?: KnowledgeObjectKind[];
  requiredArtifacts?: string[];
  requiredCapabilities?: string[];
}

export interface TemplateSelection {
  templateIds: ConstructionTemplateId[];
  templates: ConstructionTemplate[];
  disclosures: string[];
}

export type TemplateIntentHints = {
  ucId?: string;
  domain?: string;
  depth?: string;
  affectedFiles?: string[];
};

export type IntentTemplateResolver = (intent: string, hints?: TemplateIntentHints) => ConstructionTemplateId[];

export const DEFAULT_TEMPLATE_IDS: ConstructionTemplateId[] = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
];

function mapFromApiTemplate(template: ApiConstructionTemplate): ConstructionTemplate {
  return {
    id: template.id as ConstructionTemplateId,
    name: template.name,
    description: template.description,
    requiredObjects: template.requiredObjects,
    optionalObjects: template.optionalObjects,
    requiredArtifacts: template.requiredArtifacts,
    requiredCapabilities: template.requiredCapabilities,
  };
}

export const DEFAULT_CONSTRUCTION_TEMPLATES: ConstructionTemplate[] = (() => {
  const registry = createTemplateRegistry();
  return DEFAULT_TEMPLATE_IDS.map((id) => {
    const template = registry.getConstructionTemplate(id);
    if (!template) {
      throw new Error(`unverified_by_trace(construction_template_missing): ${id}`);
    }
    return mapFromApiTemplate(template);
  });
})();

export class ConstructionTemplateRegistry {
  private templates = new Map<ConstructionTemplateId, ConstructionTemplate>();
  private ucMappings = new Map<string, ConstructionTemplateId[]>();
  private intentResolver?: IntentTemplateResolver;
  private maxTemplates: number;

  constructor(options?: {
    templates?: ConstructionTemplate[];
    ucMappings?: Map<string, ConstructionTemplateId[]>;
    intentResolver?: IntentTemplateResolver;
    maxTemplates?: number;
  }) {
    this.maxTemplates = options?.maxTemplates ?? 12;
    if (options?.templates) {
      this.registerTemplates(options.templates);
    }
    if (options?.ucMappings) {
      this.setUcMappings(options.ucMappings);
    }
    if (options?.intentResolver) {
      this.intentResolver = options.intentResolver;
    }
  }

  registerTemplate(template: ConstructionTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`unverified_by_trace(construction_template_duplicate): ${template.id}`);
    }
    if (this.templates.size >= this.maxTemplates) {
      throw new Error('unverified_by_trace(construction_template_budget_exceeded)');
    }
    this.templates.set(template.id, template);
  }

  registerTemplates(templates: ConstructionTemplate[]): void {
    for (const template of templates) {
      this.registerTemplate(template);
    }
  }

  getConstructionTemplate(templateId: ConstructionTemplateId): ConstructionTemplate | null {
    return this.templates.get(templateId) ?? null;
  }

  listTemplates(): ConstructionTemplate[] {
    return Array.from(this.templates.values());
  }

  setUcMappings(mappings: Map<string, ConstructionTemplateId[]>): void {
    this.ucMappings = new Map(mappings);
  }

  setIntentResolver(resolver: IntentTemplateResolver): void {
    this.intentResolver = resolver;
  }

  templatesForUc(ucId: string): TemplateSelection {
    const disclosures: string[] = [];
    const templateIds = this.ucMappings.get(ucId) ?? [];
    if (templateIds.length === 0) {
      disclosures.push(`unverified_by_trace(template_mapping_missing): ${ucId}`);
    }
    const templates = templateIds
      .map((id) => this.getConstructionTemplate(id))
      .filter((template): template is ConstructionTemplate => Boolean(template));
    if (templates.length !== templateIds.length) {
      const missing = templateIds.filter((id) => !this.templates.has(id));
      if (missing.length > 0) {
        disclosures.push(`unverified_by_trace(construction_template_missing): ${missing.join(', ')}`);
      }
    }
    return { templateIds, templates, disclosures };
  }

  templatesForIntent(intent: string, hints?: TemplateIntentHints): TemplateSelection {
    const disclosures: string[] = [];
    const resolvedIds: ConstructionTemplateId[] = this.intentResolver ? this.intentResolver(intent, hints) : [];
    const fallbackId: ConstructionTemplateId = 'T1';
    const templateIds: ConstructionTemplateId[] = resolvedIds.length > 0 ? resolvedIds : [fallbackId];
    if (resolvedIds.length === 0) {
      disclosures.push('unverified_by_trace(intent_template_defaulted): T1');
    }
    const templates = templateIds
      .map((id) => this.getConstructionTemplate(id))
      .filter((template): template is ConstructionTemplate => Boolean(template));
    if (templates.length !== templateIds.length) {
      const missing = templateIds.filter((id) => !this.templates.has(id));
      if (missing.length > 0) {
        disclosures.push(`unverified_by_trace(construction_template_missing): ${missing.join(', ')}`);
      }
    }
    return { templateIds, templates, disclosures };
  }
}

export function createConstructionTemplateRegistry(options?: {
  templates?: ConstructionTemplate[];
  ucMappings?: Map<string, ConstructionTemplateId[]>;
  intentResolver?: IntentTemplateResolver;
  maxTemplates?: number;
}): ConstructionTemplateRegistry {
  const registry = new ConstructionTemplateRegistry({
    templates: options?.templates ?? DEFAULT_CONSTRUCTION_TEMPLATES,
    ucMappings: options?.ucMappings,
    intentResolver: options?.intentResolver,
    maxTemplates: options?.maxTemplates,
  });
  return registry;
}
