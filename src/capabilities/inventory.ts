import { createHash } from 'node:crypto';
import { listConstructions } from '../constructions/registry.js';
import type { ConstructionManifest } from '../constructions/types.js';
import { DEFAULT_TECHNIQUE_COMPOSITIONS } from '../api/technique_compositions.js';
import type { TechniqueComposition } from '../strategic/techniques.js';
import { LIBRARIAN_VERSION } from '../index.js';

export type CapabilityKind = 'mcp_tool' | 'construction' | 'composition';

export interface CapabilityToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CapabilityEntry {
  kind: CapabilityKind;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  exampleUsage: string;
  version: string;
}

export interface CapabilityInventory {
  kind: 'LiBrainianCapabilities.v1';
  schemaVersion: 1;
  inventoryVersion: string;
  generatedAt: string;
  librainianVersion: string;
  counts: {
    mcpTools: number;
    constructions: number;
    compositions: number;
    total: number;
  };
  capabilities: CapabilityEntry[];
}

function asObjectSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { type: 'object', properties: {}, required: [] };
}

function inferExampleValue(property: unknown): unknown {
  if (!property || typeof property !== 'object' || Array.isArray(property)) {
    return '<value>';
  }
  const typed = property as { type?: unknown; enum?: unknown; items?: unknown };
  if (Array.isArray(typed.enum) && typed.enum.length > 0) {
    return typed.enum[0];
  }
  if (typed.type === 'string') return '<string>';
  if (typed.type === 'number' || typed.type === 'integer') return 0;
  if (typed.type === 'boolean') return false;
  if (typed.type === 'array') return typed.items ? [inferExampleValue(typed.items)] : [];
  if (typed.type === 'object') return {};
  return '<value>';
}

function buildExampleArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const propertiesValue = schema.properties;
  const properties = (
    propertiesValue
    && typeof propertiesValue === 'object'
    && !Array.isArray(propertiesValue)
  ) ? propertiesValue as Record<string, unknown> : {};
  const requiredValue = schema.required;
  const required = Array.isArray(requiredValue)
    ? requiredValue.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const keys = required.length > 0
    ? required.slice(0, 3)
    : Object.keys(properties).slice(0, 2);
  const args: Record<string, unknown> = {};
  for (const key of keys) {
    args[key] = inferExampleValue(properties[key]);
  }
  return args;
}

function makeMcpToolCapabilities(tools: CapabilityToolDefinition[]): CapabilityEntry[] {
  return tools.map((tool) => {
    const schema = asObjectSchema(tool.inputSchema);
    const args = buildExampleArgs(schema);
    return {
      kind: 'mcp_tool',
      name: tool.name,
      description: tool.description?.trim() || `MCP tool: ${tool.name}`,
      inputSchema: schema,
      exampleUsage: `{"tool":"${tool.name}","arguments":${JSON.stringify(args)}}`,
      version: LIBRARIAN_VERSION.string,
    };
  });
}

function buildConstructionExample(manifest: ConstructionManifest): string {
  const rawInput = manifest.examples[0]?.input;
  const input = (
    rawInput
    && typeof rawInput === 'object'
    && !Array.isArray(rawInput)
  ) ? rawInput as Record<string, unknown> : buildExampleArgs(asObjectSchema(manifest.inputSchema));
  return `librarian constructions run ${manifest.id} --input '${JSON.stringify(input)}'`;
}

function makeConstructionCapabilities(manifests: ConstructionManifest[]): CapabilityEntry[] {
  return manifests.map((manifest) => ({
    kind: 'construction',
    name: manifest.id,
    description: manifest.description,
    inputSchema: asObjectSchema(manifest.inputSchema),
    exampleUsage: buildConstructionExample(manifest),
    version: manifest.version || LIBRARIAN_VERSION.string,
  }));
}

function makeCompositionCapabilities(compositions: TechniqueComposition[]): CapabilityEntry[] {
  return compositions.map((composition) => ({
    kind: 'composition',
    name: composition.id,
    description: composition.description,
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: {
          type: 'string',
          description: 'Technique composition ID',
        },
        workspace: {
          type: 'string',
          description: 'Workspace path (optional)',
        },
      },
      required: ['compositionId'],
    },
    exampleUsage: `{"tool":"compile_technique_composition","arguments":{"compositionId":"${composition.id}"}}`,
    version: composition.updatedAt || composition.createdAt || LIBRARIAN_VERSION.string,
  }));
}

function computeInventoryVersion(capabilities: CapabilityEntry[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(
      capabilities.map((capability) => ({
        kind: capability.kind,
        name: capability.name,
        version: capability.version,
        schema: capability.inputSchema,
      })),
    ))
    .digest('hex')
    .slice(0, 16);
  return `v1-${digest}`;
}

export function buildCapabilityInventory(input: {
  mcpTools: CapabilityToolDefinition[];
  compositions?: TechniqueComposition[];
}): CapabilityInventory {
  const compositions = input.compositions ?? DEFAULT_TECHNIQUE_COMPOSITIONS;
  const mcpCapabilities = makeMcpToolCapabilities(input.mcpTools);
  const constructionCapabilities = makeConstructionCapabilities(listConstructions({}));
  const compositionCapabilities = makeCompositionCapabilities(compositions);

  const capabilities = [
    ...mcpCapabilities,
    ...constructionCapabilities,
    ...compositionCapabilities,
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.name.localeCompare(right.name));

  return {
    kind: 'LiBrainianCapabilities.v1',
    schemaVersion: 1,
    inventoryVersion: computeInventoryVersion(capabilities),
    generatedAt: new Date().toISOString(),
    librainianVersion: LIBRARIAN_VERSION.string,
    counts: {
      mcpTools: mcpCapabilities.length,
      constructions: constructionCapabilities.length,
      compositions: compositionCapabilities.length,
      total: capabilities.length,
    },
    capabilities,
  };
}
