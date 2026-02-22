import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import YAML from 'yaml';
import { getErrorMessage } from '../utils/errors.js';
import type { TaxonomyItem } from '../api/taxonomy.js';
import type { IngestionContext, IngestionItem, IngestionResult, IngestionSource } from './types.js';
import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';

export interface ApiEndpoint {
  path: string;
  method: string;
  summary?: string;
  requestSchemas?: string[];
  responseSchemas?: string[];
}

export interface GraphqlOperation {
  name: string;
  type: 'query' | 'mutation';
  returnType?: string;
}

export interface ApiIngestionOptions {
  openapiGlobs?: string[];
  graphqlGlobs?: string[];
  routeGlobs?: string[];
  exclude?: string[];
  maxFileBytes?: number;
  maxRouteFiles?: number;
}

const DEFAULT_OPENAPI_GLOBS = ['**/openapi*.{json,yaml,yml}', '**/swagger*.{json,yaml,yml}'];
const DEFAULT_GRAPHQL_GLOBS = ['**/*.{graphql,gql}'];
const DEFAULT_ROUTE_GLOBS = ['src/**/*.{ts,tsx,js,jsx}'];
const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_MAX_ROUTE_FILES = 200;
const API_TAXONOMY: TaxonomyItem[] = ['api_schemas'];

function hashPayload(payload: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  } catch {
    return createHash('sha256').update('{}').digest('hex');
  }
}

function parseOpenApi(content: string, isJson: boolean): ApiEndpoint[] {
  const data = isJson
    ? (() => {
        const parsed = safeJsonParse<Record<string, unknown>>(content);
        if (!parsed.ok) throw new Error(getResultErrorMessage(parsed) || 'invalid JSON');
        return parsed.value;
      })()
    : YAML.parse(content) as Record<string, unknown>;
  const paths = data.paths && typeof data.paths === 'object' ? data.paths as Record<string, unknown> : {};
  const endpoints: ApiEndpoint[] = [];
  for (const [route, methodsRaw] of Object.entries(paths)) {
    if (!methodsRaw || typeof methodsRaw !== 'object') continue;
    const methods = methodsRaw as Record<string, unknown>;
    for (const [method, detailsRaw] of Object.entries(methods)) {
      if (typeof method !== 'string') continue;
      const details = detailsRaw && typeof detailsRaw === 'object' ? detailsRaw as Record<string, unknown> : {};
      const summary = typeof details.summary === 'string' ? details.summary : undefined;
      const requestSchemas = collectSchemaRefs((details.requestBody as Record<string, unknown> | undefined)?.content);
      const responseSchemas = collectResponseSchemaRefs(details.responses);
      endpoints.push({ path: route, method: method.toUpperCase(), summary, requestSchemas, responseSchemas });
    }
  }
  return endpoints;
}

function normalizeSchemaRef(ref: string): string {
  const schemaPrefix = '#/components/schemas/';
  if (ref.startsWith(schemaPrefix)) {
    return ref.slice(schemaPrefix.length);
  }
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

function collectSchemaRefs(root: unknown): string[] {
  const refs = new Set<string>();

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const value = node as Record<string, unknown>;
    if (typeof value.$ref === 'string' && value.$ref.trim().length > 0) {
      refs.add(normalizeSchemaRef(value.$ref));
    }

    const nestedKeys = ['items', 'additionalProperties', 'not', 'contains', 'propertyNames'];
    for (const key of nestedKeys) {
      if (value[key] !== undefined) visit(value[key]);
    }

    const arrayKeys = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
    for (const key of arrayKeys) {
      const arr = value[key];
      if (Array.isArray(arr)) {
        for (const entry of arr) visit(entry);
      }
    }

    if (value.properties && typeof value.properties === 'object') {
      for (const entry of Object.values(value.properties as Record<string, unknown>)) {
        visit(entry);
      }
    }
  }

  visit(root);
  return Array.from(refs);
}

function collectResponseSchemaRefs(responsesRaw: unknown): string[] {
  if (!responsesRaw || typeof responsesRaw !== 'object') return [];
  const refs = new Set<string>();
  const responses = responsesRaw as Record<string, unknown>;
  for (const response of Object.values(responses)) {
    if (!response || typeof response !== 'object') continue;
    const content = (response as Record<string, unknown>).content;
    const schemaRefs = collectSchemaRefs(content);
    for (const ref of schemaRefs) refs.add(ref);
  }
  return Array.from(refs);
}

function parseGraphql(content: string): { operations: GraphqlOperation[]; typeNames: string[] } {
  const operations: GraphqlOperation[] = [];
  const typeNames = new Set<string>();

  const typeDefinitionRegex = /\b(type|input|interface|enum)\s+([A-Za-z0-9_]+)/g;
  let typeMatch: RegExpExecArray | null = typeDefinitionRegex.exec(content);
  while (typeMatch) {
    if (typeMatch[2]) typeNames.add(typeMatch[2]);
    typeMatch = typeDefinitionRegex.exec(content);
  }

  const typeRegex = /type\s+(Query|Mutation)\s*{([\s\S]*?)}/g;
  let match: RegExpExecArray | null = typeRegex.exec(content);
  while (match) {
    const kind = (match[1] ?? '').toLowerCase() as GraphqlOperation['type'];
    typeNames.add(match[1] ?? '');
    const body = match[2] ?? '';
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const fieldMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_\[\]!]+)/);
      if (!fieldMatch?.[1]) continue;
      const returnType = fieldMatch[2] ? fieldMatch[2].replace(/[\[\]!]/g, '') : undefined;
      if (returnType) typeNames.add(returnType);
      operations.push({ name: fieldMatch[1], type: kind, returnType });
    }
    match = typeRegex.exec(content);
  }
  return { operations, typeNames: Array.from(typeNames).filter(Boolean) };
}

async function mapEndpointsToHandlers(
  workspace: string,
  endpoints: ApiEndpoint[],
  routeFiles: string[],
  maxFileBytes: number
): Promise<Record<string, string[]>> {
  const mapping: Record<string, string[]> = {};
  endpoints.forEach((endpoint) => { mapping[`${endpoint.method} ${endpoint.path}`] = []; });

  const endpointRouteMatchers = new Map<string, RegExp[]>();
  for (const endpoint of endpoints) {
    const routeKey = `${endpoint.method} ${endpoint.path}`;
    endpointRouteMatchers.set(routeKey, buildRouteMatchers(endpoint));
  }

  for (const filePath of routeFiles) {
    let content = '';
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > maxFileBytes) continue;
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const relative = path.relative(workspace, filePath);
    for (const endpoint of endpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      const matchers = endpointRouteMatchers.get(key) ?? [];
      if (matchers.some((matcher) => matcher.test(content))) {
        mapping[`${endpoint.method} ${endpoint.path}`]?.push(relative);
      }
    }
  }
  return mapping;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toRouteLiteralVariants(endpointPath: string): string[] {
  const normalized = endpointPath.replace(/\/+/g, '/');
  const colonVariant = normalized.replace(/\{[^/}]+\}/g, ':param');
  const wildcardVariant = normalized.replace(/\{[^/}]+\}/g, '[^/]+');
  return Array.from(new Set([normalized, colonVariant, wildcardVariant]));
}

function buildRouteMatchers(endpoint: ApiEndpoint): RegExp[] {
  const lowerMethod = endpoint.method.toLowerCase();
  const variants = toRouteLiteralVariants(endpoint.path);
  const matchers: RegExp[] = [];
  for (const variant of variants) {
    const escaped = escapeRegex(variant).replace(/\\\[\^\/\]\\\+/g, '[^/]+');
    matchers.push(
      new RegExp(`\\.${lowerMethod}\\s*\\(\\s*['"\`]${escaped}['"\`]`, 'i'),
      new RegExp(`route\\s*\\(\\s*['"\`]${escaped}['"\`]\\s*\\)\\s*\\.${lowerMethod}\\s*\\(`, 'i')
    );
  }
  return matchers;
}

export function createApiIngestionSource(options: ApiIngestionOptions = {}): IngestionSource {
  const openapiGlobs = options.openapiGlobs ?? DEFAULT_OPENAPI_GLOBS;
  const graphqlGlobs = options.graphqlGlobs ?? DEFAULT_GRAPHQL_GLOBS;
  const routeGlobs = options.routeGlobs ?? DEFAULT_ROUTE_GLOBS;
  const exclude = options.exclude ?? [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const maxRouteFiles = options.maxRouteFiles ?? DEFAULT_MAX_ROUTE_FILES;

  return {
    type: 'api',
    version: 'v1',
    validate: (data: unknown) => {
      if (!data || typeof data !== 'object') return false;
      const item = data as { payload?: { endpoints?: unknown[] } };
      return Array.isArray(item.payload?.endpoints);
    },
    ingest: async (ctx: IngestionContext): Promise<IngestionResult> => {
      const items: IngestionItem[] = [];
      const errors: string[] = [];
      const endpoints: ApiEndpoint[] = [];
      const graphql: GraphqlOperation[] = [];
      const graphqlTypes = new Set<string>();

      const openapiFiles = await glob(openapiGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      for (const filePath of openapiFiles) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          const content = await fs.readFile(filePath, 'utf8');
          const isJson = filePath.endsWith('.json');
          endpoints.push(...parseOpenApi(content, isJson));
        } catch (error: unknown) {
          errors.push(`Failed to parse ${filePath}: ${getErrorMessage(error)}`);
        }
      }

      const graphqlFiles = await glob(graphqlGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      for (const filePath of graphqlFiles) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          const content = await fs.readFile(filePath, 'utf8');
          const parsed = parseGraphql(content);
          graphql.push(...parsed.operations);
          parsed.typeNames.forEach((name) => graphqlTypes.add(name));
        } catch (error: unknown) {
          errors.push(`Failed to parse ${filePath}: ${getErrorMessage(error)}`);
        }
      }

      const routeFiles = (await glob(routeGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true })).slice(0, maxRouteFiles);
      const handlerMap = await mapEndpointsToHandlers(ctx.workspace, endpoints, routeFiles, maxFileBytes);

      const payload = {
        endpoints,
        graphql,
        graphql_types: Array.from(graphqlTypes),
        openapi_files: openapiFiles.map((file) => path.relative(ctx.workspace, file)),
        graphql_files: graphqlFiles.map((file) => path.relative(ctx.workspace, file)),
        handler_map: handlerMap,
      };

      items.push({
        id: 'api:knowledge',
        sourceType: 'api',
        sourceVersion: 'v1',
        ingestedAt: ctx.now(),
        payload,
        metadata: {
          hash: hashPayload(payload),
          taxonomy: API_TAXONOMY,
          endpoint_count: endpoints.length,
          graphql_operation_count: graphql.length,
        },
      });

      return { items, errors };
    },
  };
}
