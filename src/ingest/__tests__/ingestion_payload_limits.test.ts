import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDocsIngestionSource } from '../docs_indexer.js';
import { createDomainIngestionSource } from '../domain_indexer.js';
import { createSecurityIngestionSource } from '../security_indexer.js';
import type { IngestionContext } from '../types.js';

const MAX_INGESTION_JSON_CHARS = 100_000;
const MAX_INGESTION_JSON_DEPTH = 40;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: object): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function safeJsonLength(value: unknown): { ok: true; length: number } | { ok: false } {
  try {
    return { ok: true, length: JSON.stringify(value).length };
  } catch {
    return { ok: false };
  }
}

function validateJsonNode(
  label: 'payload' | 'metadata',
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  errors: string[]
): void {
  if (depth > MAX_INGESTION_JSON_DEPTH) {
    errors.push(`${label}_depth_exceeded`);
    return;
  }
  if (value === null) return;
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push(`${label}_non_finite_number`);
    }
    return;
  }
  if (typeof value !== 'object') {
    errors.push(`${label}_invalid_type`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJsonNode(label, item, depth + 1, seen, errors);
    }
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${label}_non_plain_object`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${label}_circular`);
    return;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      errors.push(`${label}_forbidden_key:${key}`);
      continue;
    }
    validateJsonNode(label, child, depth + 1, seen, errors);
  }
  seen.delete(value);
}

function validateJsonPayload(label: 'payload' | 'metadata', value: unknown): string[] {
  const errors: string[] = [];
  const seen = new WeakSet<object>();
  validateJsonNode(label, value, 0, seen, errors);
  if (errors.length > 0) return errors;
  const serialized = safeJsonLength(value);
  if (!serialized.ok) {
    errors.push(`${label}_unserializable`);
  } else if (serialized.length > MAX_INGESTION_JSON_CHARS) {
    errors.push(`${label}_too_large`);
  }
  return errors;
}

describe('ingestion payload limits', () => {
  let tempDir: string;
  let ctx: IngestionContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ingestion-'));
    ctx = {
      workspace: tempDir,
      now: () => '2026-02-04T00:00:00.000Z',
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('docs ingestion stays within JSON payload size limits', async () => {
    await fs.mkdir(path.join(tempDir, 'docs'), { recursive: true });
    const hugeCode = 'x'.repeat(160_000);
    await fs.writeFile(
      path.join(tempDir, 'docs', 'API.md'),
      ['# API', '', '```ts', hugeCode, '```', ''].join('\n'),
      'utf8'
    );

    const source = createDocsIngestionSource({ include: ['docs/**/*.md'] });
    const result = await source.ingest(ctx);
    expect(result.errors).toEqual([]);
    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(validateJsonPayload('payload', item.payload)).toEqual([]);
    expect(validateJsonPayload('metadata', item.metadata ?? {})).toEqual([]);
  });

  it('domain ingestion truncates large knowledge payloads to fit limits', async () => {
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    for (let i = 0; i < 60; i += 1) {
      const decls = Array.from({ length: 40 }, (_, j) => `export type DomainEntity${i}_${j} = { id: string }`).join('\n');
      await fs.writeFile(path.join(tempDir, 'src', `file${i}.ts`), decls, 'utf8');
    }

    const source = createDomainIngestionSource({ include: ['src/**/*.ts'], maxFiles: 200 });
    const result = await source.ingest(ctx);
    expect(result.errors).toEqual([]);
    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(validateJsonPayload('payload', item.payload)).toEqual([]);
    expect(validateJsonPayload('metadata', item.metadata ?? {})).toEqual([]);
    // Ensure we actually had to truncate (metadata carries full counts).
    const meta = item.metadata as Record<string, unknown> | undefined;
    const entityCount = meta && typeof meta.entity_count === 'number' ? meta.entity_count : 0;
    expect(entityCount).toBeGreaterThan(0);
    if (typeof item.payload === 'object' && item.payload && 'entities' in item.payload) {
      const payloadEntities = (item.payload as { entities?: unknown }).entities;
      if (Array.isArray(payloadEntities)) {
        expect(entityCount).toBeGreaterThan(payloadEntities.length);
      }
    }
  });

  it('security ingestion produces JSON-safe payloads (no undefined)', async () => {
    await fs.writeFile(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }), 'utf8');
    await fs.writeFile(path.join(tempDir, '.eslintrc.json'), JSON.stringify({ plugins: ['security'], rules: { 'no-eval': 'error' } }), 'utf8');

    // Minimal SARIF files with missing locations to ensure adapters never emit undefined.
    const sarif = JSON.stringify({
      runs: [{ results: [{ ruleId: 'X', message: { text: 'oops' }, level: 'warning', locations: [] }] }],
    });
    await fs.writeFile(path.join(tempDir, 'codeql-results.sarif'), sarif, 'utf8');
    await fs.writeFile(path.join(tempDir, 'joern-results.sarif'), sarif, 'utf8');

    const source = createSecurityIngestionSource();
    const result = await source.ingest(ctx);
    expect(result.items.length).toBe(1);
    const item = result.items[0]!;
    expect(validateJsonPayload('payload', item.payload)).toEqual([]);
    expect(validateJsonPayload('metadata', item.metadata ?? {})).toEqual([]);
  });
});

