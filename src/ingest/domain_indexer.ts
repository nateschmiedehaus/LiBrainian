import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { getErrorMessage } from '../utils/errors.js';
import type { TaxonomyItem } from '../api/taxonomy.js';
import type { IngestionContext, IngestionItem, IngestionResult, IngestionSource } from './types.js';

export interface DomainEntity { name: string; file: string; kind: 'type' | 'interface' | 'class'; }
export interface DomainInvariant { name: string; file: string; line: number; kind: 'validate' | 'assert' | 'invariant'; }

export interface DomainIngestionOptions {
  include?: string[];
  exclude?: string[];
  maxFileBytes?: number;
  maxFiles?: number;
}

const DEFAULT_GLOBS = ['src/**/*.{ts,tsx}'];
const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_MAX_FILES = 400;
const MAX_DOMAIN_ENTITIES_STORED = 200;
const MAX_DOMAIN_INVARIANTS_STORED = 200;
const MAX_DOMAIN_FILES_STORED = 200;
const DOMAIN_TAXONOMY: TaxonomyItem[] = ['domain_model_invariants', 'business_rules_constraints'];

function hashPayload(payload: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  } catch {
    return createHash('sha256').update('{}').digest('hex');
  }
}

function extractEntities(content: string, file: string): DomainEntity[] {
  const entities: DomainEntity[] = [];
  const typeRegex = /\btype\s+([A-Z][A-Za-z0-9_]+)/g;
  const interfaceRegex = /\binterface\s+([A-Z][A-Za-z0-9_]+)/g;
  const classRegex = /\bclass\s+([A-Z][A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null = typeRegex.exec(content);
  while (match) {
    entities.push({ name: match[1] ?? 'Unknown', file, kind: 'type' });
    match = typeRegex.exec(content);
  }
  match = interfaceRegex.exec(content);
  while (match) {
    entities.push({ name: match[1] ?? 'Unknown', file, kind: 'interface' });
    match = interfaceRegex.exec(content);
  }
  match = classRegex.exec(content);
  while (match) {
    entities.push({ name: match[1] ?? 'Unknown', file, kind: 'class' });
    match = classRegex.exec(content);
  }
  return entities;
}

function extractInvariants(content: string, file: string): DomainInvariant[] {
  const invariants: DomainInvariant[] = [];
  const lines = content.split(/\r?\n/);
  const patterns: Array<{ regex: RegExp; kind: DomainInvariant['kind'] }> = [
    { regex: /\b(validate|isValid)\w*\s*\(/i, kind: 'validate' },
    { regex: /\bassert\w*\s*\(/i, kind: 'assert' },
    { regex: /\binvariant\w*\s*\(/i, kind: 'invariant' },
  ];
  lines.forEach((line, idx) => {
    for (const { regex, kind } of patterns) {
      const match = line.match(regex);
      if (!match) continue;
      const nameMatch = line.match(/\b([A-Za-z0-9_]+)\s*\(/);
      invariants.push({
        name: nameMatch?.[1] ?? match[1] ?? 'unknown',
        file,
        line: idx + 1,
        kind,
      });
      break;
    }
  });
  return invariants;
}

export function createDomainIngestionSource(options: DomainIngestionOptions = {}): IngestionSource {
  const include = options.include ?? DEFAULT_GLOBS;
  const exclude = options.exclude ?? [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  return {
    type: 'domain',
    version: 'v1',
    validate: (data: unknown) => {
      if (!data || typeof data !== 'object') return false;
      const item = data as { payload?: { entities?: unknown[]; invariants?: unknown[] } };
      return Array.isArray(item.payload?.entities) && Array.isArray(item.payload?.invariants);
    },
    ingest: async (ctx: IngestionContext): Promise<IngestionResult> => {
      const items: IngestionItem[] = [];
      const errors: string[] = [];
      const files = await glob(include, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      const limited = files.slice(0, maxFiles);
      const entities: DomainEntity[] = [];
      const invariants: DomainInvariant[] = [];

      for (const filePath of limited) {
        let content = '';
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          content = await fs.readFile(filePath, 'utf8');
        } catch (error: unknown) {
          errors.push(`Failed to read ${filePath}: ${getErrorMessage(error)}`);
          continue;
        }
        const relative = path.relative(ctx.workspace, filePath);
        entities.push(...extractEntities(content, relative));
        invariants.push(...extractInvariants(content, relative));
      }

      const fileList = limited.map((file) => path.relative(ctx.workspace, file));
      const payload = {
        entities: entities.slice(0, MAX_DOMAIN_ENTITIES_STORED),
        invariants: invariants.slice(0, MAX_DOMAIN_INVARIANTS_STORED),
        files: fileList.slice(0, MAX_DOMAIN_FILES_STORED),
        truncated: {
          entities: entities.length > MAX_DOMAIN_ENTITIES_STORED,
          invariants: invariants.length > MAX_DOMAIN_INVARIANTS_STORED,
          files: fileList.length > MAX_DOMAIN_FILES_STORED,
        },
      };
      items.push({
        id: 'domain:knowledge',
        sourceType: 'domain',
        sourceVersion: 'v1',
        ingestedAt: ctx.now(),
        payload,
        metadata: {
          hash: hashPayload(payload),
          taxonomy: DOMAIN_TAXONOMY,
          file_count: fileList.length,
          entity_count: entities.length,
          invariant_count: invariants.length,
        },
      });

      return { items, errors };
    },
  };
}
