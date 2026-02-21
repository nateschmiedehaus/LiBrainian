import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import YAML from 'yaml';
import stripJsonComments from 'strip-json-comments';
import { getErrorMessage } from '../utils/errors.js';
import type { TaxonomyItem } from '../api/taxonomy.js';
import type { IngestionContext, IngestionItem, IngestionResult, IngestionSource } from './types.js';
import { emptyObject } from '../api/empty_values.js';
import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';

export interface ConfigKeyEntry { key: string; valuePreview: string; }
export interface ConfigReferenceMap { [key: string]: string[]; }

export interface ConfigIngestionOptions {
  include?: string[];
  exclude?: string[];
  referenceGlobs?: string[];
  maxReferenceFiles?: number;
  maxFileBytes?: number;
}

const DEFAULT_CONFIG_GLOBS = ['**/*.json', '**/*.yml', '**/*.yaml', '**/*.toml'];
const DEFAULT_REFERENCE_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];
const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_MAX_REFERENCE_FILES = 200;
const CONFIG_TAXONOMY: TaxonomyItem[] = [
  'config_files_keys',
  'environment_variables_usage',
  'feature_flags',
  'logging_telemetry_usage',
  'caching_layers',
  'performance_budgets',
  'concurrency_model',
  'queue_topic_topology',
  'deployment_pipeline',
];

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function parseToml(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      const sectionPath = sectionMatch[1]?.trim() ?? '';
      current = root;
      if (!sectionPath) continue;
      const parts = sectionPath.split('.').filter(Boolean);
      for (const part of parts) {
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part] as Record<string, unknown>;
      }
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1] ?? '';
    const rawValue = kvMatch[2]?.trim() ?? '';
    let value: unknown = rawValue;
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      value = rawValue.slice(1, -1);
    } else if (rawValue === 'true' || rawValue === 'false') {
      value = rawValue === 'true';
    } else if (!Number.isNaN(Number(rawValue))) {
      value = Number(rawValue);
    }
    current[key] = value;
  }

  return root;
}

function flattenKeys(value: unknown, prefix: string[] = [], output: ConfigKeyEntry[] = []): ConfigKeyEntry[] {
  if (!value || typeof value !== 'object') {
    const key = prefix.join('.');
    if (key) output.push({ key, valuePreview: previewValue(value) });
    return output;
  }

  if (Array.isArray(value)) {
    const key = prefix.join('.');
    output.push({ key, valuePreview: `[${value.length} items]` });
    return output;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    flattenKeys(entryValue, [...prefix, entryKey], output);
  }

  return output;
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return '[redacted]';
  if (typeof value === 'number') return '[number]';
  if (typeof value === 'boolean') return '[boolean]';
  if (Array.isArray(value)) return `[${value.length} items]`;
  return '{...}';
}

async function findReferences(
  workspace: string,
  keys: string[],
  exclude: string[],
  referenceGlobs: string[],
  maxFiles: number,
  referenceFiles?: string[],
  contentCache?: Map<string, string>
): Promise<ConfigReferenceMap> {
  if (!keys.length) return emptyObject<ConfigReferenceMap>();
  const files = referenceFiles ?? await glob(referenceGlobs, { cwd: workspace, ignore: exclude, absolute: true });
  const limited = files.slice(0, maxFiles);
  const references: ConfigReferenceMap = {};
  for (const key of keys) references[key] = [];

  for (const filePath of limited) {
    let content = contentCache?.get(filePath) ?? '';
    try {
      if (!content) content = await fs.readFile(filePath, 'utf8');
      if (contentCache && content) contentCache.set(filePath, content);
    } catch {
      continue;
    }

    for (const key of keys) {
      const envKey = key.replace(/\./g, '_').toUpperCase();
      if (content.includes(key) || content.includes(envKey)) {
        references[key]?.push(path.relative(workspace, filePath));
      }
    }
  }

  return references;
}

function parseConfigFile(ext: string, content: string): { data: Record<string, unknown> | null; error?: string } {
  try {
    if (ext === '.json') {
      const parsed = safeJsonParse<Record<string, unknown>>(stripJsonComments(content));
      if (!parsed.ok) throw new Error(getResultErrorMessage(parsed) || 'invalid JSON');
      return { data: parsed.value };
    }
    if (ext === '.yaml' || ext === '.yml') return { data: YAML.parse(content) as Record<string, unknown> };
    if (ext === '.toml') return { data: parseToml(content) as Record<string, unknown> };
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) };
  }
  return { data: null, error: `Unsupported config extension: ${ext}` };
}

export function createConfigIngestionSource(options: ConfigIngestionOptions = {}): IngestionSource {
  const include = options.include ?? DEFAULT_CONFIG_GLOBS;
  const exclude = [...(options.exclude ?? []), 'state/**', '**/state/**', '.librainian/**', '**/.librainian/**'];
  const referenceGlobs = options.referenceGlobs ?? DEFAULT_REFERENCE_GLOBS;
  const maxReferenceFiles = options.maxReferenceFiles ?? DEFAULT_MAX_REFERENCE_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;

  return {
    type: 'config',
    version: 'v1',
    validate: (data: unknown) => {
      if (!data || typeof data !== 'object') return false;
      const item = data as { payload?: { path?: string; keys?: ConfigKeyEntry[] } };
      return typeof item.payload?.path === 'string' && Array.isArray(item.payload?.keys);
    },
    ingest: async (ctx: IngestionContext): Promise<IngestionResult> => {
      const files = await glob(include, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      const referenceFiles = await glob(referenceGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      const referenceContentCache = new Map<string, string>();
      const items: IngestionItem[] = [];
      const errors: string[] = [];

      for (const filePath of files) {
        let content: string;
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          content = await fs.readFile(filePath, 'utf8');
        } catch (error: unknown) {
          errors.push(`Failed to read ${filePath}: ${getErrorMessage(error)}`);
          continue;
        }

        const ext = path.extname(filePath).toLowerCase();
        const parsed = parseConfigFile(ext, content);
        if (!parsed.data) {
          errors.push(`Failed to parse ${filePath}: ${parsed.error ?? 'unknown error'}`);
          continue;
        }

        const relativePath = path.relative(ctx.workspace, filePath);
        const keys = flattenKeys(parsed.data);
        const keyNames = keys.map((entry) => entry.key).filter(Boolean);
        const references = await findReferences(ctx.workspace, keyNames, exclude, referenceGlobs, maxReferenceFiles, referenceFiles, referenceContentCache);
        const payload = {
          path: relativePath,
          format: ext.replace('.', ''),
          keys,
          references,
        };

        items.push({
          id: `config:${relativePath}`,
          sourceType: 'config',
          sourceVersion: 'v1',
          ingestedAt: ctx.now(),
          payload,
          metadata: {
            hash: hashContent(content),
            taxonomy: CONFIG_TAXONOMY,
          },
        });
      }

      return { items, errors };
    },
  };
}
