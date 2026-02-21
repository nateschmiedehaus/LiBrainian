/**
 * @fileoverview Canonical types and contracts for the librainian
 *
 * Branded types prevent mixing incompatible IDs and ensure
 * proper validation at boundaries.
 */

import * as path from 'path';
import { Result, Ok, Err } from './result.js';
import { ValidationError } from './errors.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

/**
 * Brand a type to make it nominally distinct
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Entity ID - uniquely identifies any entity in the system
 * Format: "type:path" e.g. "file:src/librainian/api/librainian.ts"
 */
export type EntityId = Brand<string, 'EntityId'>;

/**
 * Embedding ID - uniquely identifies an embedding vector
 */
export type EmbeddingId = Brand<string, 'EmbeddingId'>;

/**
 * File path - normalized, validated file path
 */
export type FilePath = Brand<string, 'FilePath'>;

/**
 * Timestamp - milliseconds since epoch
 */
export type Timestamp = Brand<number, 'Timestamp'>;

/**
 * Hash - content hash for deduplication
 */
export type ContentHash = Brand<string, 'ContentHash'>;

// ============================================================================
// ENTITY TYPES
// ============================================================================

export type EntityType =
  | 'file'
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'module'
  | 'directory'
  | 'package'
  | 'component'
  | 'subsystem'
  | 'system'
  | 'layer'
  | 'domain'
  | 'feature'
  | 'workflow'
  | 'boundary'
  | 'hotspot'
  | 'debt_cluster';

// ============================================================================
// CONSTRUCTORS
// ============================================================================

/**
 * Create a validated EntityId
 */
export function createEntityId(type: EntityType, identifier: string): EntityId {
  // Normalize path separators
  const normalized = identifier.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${type}:${normalized}` as EntityId;
}

/**
 * Parse an EntityId into its components
 */
export function parseEntityId(id: EntityId): { type: EntityType; identifier: string } {
  const colonIndex = id.indexOf(':');
  if (colonIndex === -1) {
    return { type: 'file', identifier: id };
  }
  return {
    type: id.slice(0, colonIndex) as EntityType,
    identifier: id.slice(colonIndex + 1),
  };
}

/**
 * Create a validated FilePath
 */
export function createFilePath(raw: string): Result<FilePath, ValidationError> {
  if (!raw) {
    return Err(new ValidationError('path', 'non-empty string', 'empty'));
  }

  if (raw.includes('\0')) {
    return Err(new ValidationError('path', 'no null bytes', 'contains null bytes'));
  }

  // Normalize and convert to forward slashes
  const normalized = path.normalize(raw).replace(/\\/g, '/');
  return Ok(normalized as FilePath);
}

/**
 * Create FilePath without validation (for internal use)
 */
export function unsafeFilePath(raw: string): FilePath {
  return raw.replace(/\\/g, '/') as FilePath;
}

/**
 * Create a validated Timestamp
 */
export function createTimestamp(value: number | Date): Timestamp {
  const ms = value instanceof Date ? value.getTime() : value;

  // Detect if this looks like seconds (before year 2001 in ms) and convert
  // Year 2001 in ms = 978307200000
  const normalized = ms < 978307200000 ? ms * 1000 : ms;

  return normalized as Timestamp;
}

/**
 * Get current timestamp
 */
export function now(): Timestamp {
  return Date.now() as Timestamp;
}

/**
 * Create an EmbeddingId
 */
export function createEmbeddingId(entityId: EntityId, modelId: string): EmbeddingId {
  return `${entityId}@${modelId}` as EmbeddingId;
}

/**
 * Create a ContentHash from content
 */
export async function createContentHash(content: string): Promise<ContentHash> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex as ContentHash;
}

/**
 * Create ContentHash synchronously (uses simpler hash)
 */
export function createContentHashSync(content: string): ContentHash {
  // Simple FNV-1a hash for sync use
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(16) as ContentHash;
}

// ============================================================================
// EMBEDDING VALIDATION
// ============================================================================

export interface ValidatedEmbedding {
  readonly vector: Float32Array;
  readonly dimensions: number;
  readonly modelId: string;
  readonly normalizedL2: boolean;
}

/**
 * Create a validated embedding
 */
export function createValidatedEmbedding(
  vector: number[] | Float32Array,
  modelId: string,
  expectedDimensions?: number
): Result<ValidatedEmbedding, ValidationError> {
  const dimensions = vector.length;

  // Check dimensions if expected
  if (expectedDimensions !== undefined && dimensions !== expectedDimensions) {
    return Err(new ValidationError(
      'dimensions',
      String(expectedDimensions),
      String(dimensions)
    ));
  }

  const arr = vector instanceof Float32Array ? vector : new Float32Array(vector);

  // Check for NaN or Infinity
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      return Err(new ValidationError(
        'vector',
        'finite numbers',
        `non-finite value at index ${i}`
      ));
    }
  }

  // L2 normalize
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * arr[i];
  }
  const norm = Math.sqrt(sum);

  if (norm === 0) {
    return Err(new ValidationError(
      'vector',
      'non-zero magnitude',
      'zero vector'
    ));
  }

  for (let i = 0; i < arr.length; i++) {
    arr[i] /= norm;
  }

  return Ok({
    vector: arr,
    dimensions,
    modelId,
    normalizedL2: true,
  });
}

// ============================================================================
// SCHEMA VERSIONING
// ============================================================================

const SCHEMA_VERSIONS = {
  embedding: 1,
  knowledge: 1,
  entity: 1,
  graph: 1,
  query: 1,
  config: 1,
  cochange: 1,
} as const;

export type SchemaType = keyof typeof SCHEMA_VERSIONS;

export interface Versioned<T> {
  readonly __schemaVersion: number;
  readonly __schemaType: SchemaType;
  readonly data: T;
}

/**
 * Wrap data with schema version
 */
export function wrapVersioned<T>(type: SchemaType, data: T): Versioned<T> {
  return {
    __schemaVersion: SCHEMA_VERSIONS[type],
    __schemaType: type,
    data,
  };
}

/**
 * Unwrap versioned data
 */
export function unwrapVersioned<T>(versioned: Versioned<T>): Result<T, ValidationError> {
  const expected = SCHEMA_VERSIONS[versioned.__schemaType];

  if (versioned.__schemaVersion !== expected) {
    return Err(new ValidationError(
      'schemaVersion',
      String(expected),
      String(versioned.__schemaVersion)
    ));
  }

  return Ok(versioned.data);
}

/**
 * Get current schema version
 */
export function getSchemaVersion(type: SchemaType): number {
  return SCHEMA_VERSIONS[type];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && value.includes(':');
}

export function isFilePath(value: unknown): value is FilePath {
  return typeof value === 'string' && value.length > 0;
}

export function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'number' && value > 0;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Make all properties optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Make specific properties required
 */
export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific properties optional
 */
export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Extract the value type from a Result
 */
export type ResultValue<T> = T extends Result<infer V, unknown> ? V : never;

/**
 * Extract the error type from a Result
 */
export type ResultError<T> = T extends Result<unknown, infer E> ? E : never;
