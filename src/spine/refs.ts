/**
 * @fileoverview Refs Stub
 * Provides file reference utilities for standalone librainian.
 */

import { createHash } from 'crypto';
import { hostname } from 'os';

export interface FileRef {
  path: string;
  line?: number;
  column?: number;
}

export interface FunctionRef {
  name: string;
  file: FileRef;
  signature?: string;
}

export function createFileRef(path: string, line?: number, column?: number): FileRef {
  return { path, line, column };
}

export function createFunctionRef(name: string, file: FileRef, signature?: string): FunctionRef {
  return { name, file, signature };
}

export function formatRef(ref: FileRef): string {
  let result = ref.path;
  if (ref.line !== undefined) {
    result += `:${ref.line}`;
    if (ref.column !== undefined) {
      result += `:${ref.column}`;
    }
  }
  return result;
}

export function parseRef(refString: string): FileRef {
  const parts = refString.split(':');
  return {
    path: parts[0],
    line: parts[1] ? parseInt(parts[1], 10) : undefined,
    column: parts[2] ? parseInt(parts[2], 10) : undefined,
  };
}

/**
 * Compute a canonical reference for an entity
 * Can be called with:
 * - computeCanonRef(workspaceDir) - returns canon ref for workspace
 * - computeCanonRef(entityType, name, filePath?) - returns entity ref
 */
export function computeCanonRef(entityTypeOrDir: string, name?: string, filePath?: string): string {
  // Single argument means it's a workspace directory
  if (name === undefined) {
    const dir = entityTypeOrDir;
    // Return a hash-based canon ref for the directory
    return `workspace::${createHash('sha256').update(dir).digest('hex').substring(0, 16)}`;
  }

  const parts = [entityTypeOrDir, name];
  if (filePath) {
    parts.push(filePath);
  }
  return parts.join('::');
}

/**
 * Compute an environment reference
 * Can be called with:
 * - computeEnvironmentRef() - returns ref for current environment
 * - computeEnvironmentRef(envName, key) - returns specific env ref
 */
export function computeEnvironmentRef(envName?: string, key?: string): string {
  if (envName === undefined || key === undefined) {
    // Return a ref for the current environment
    const host = hostname();
    const platform = process.platform;
    return `env::${platform}::${host}`;
  }
  return `env::${envName}::${key}`;
}

/**
 * Parse a canonical reference
 */
export function parseCanonRef(ref: string): { entityType: string; name: string; filePath?: string } {
  const parts = ref.split('::');
  return {
    entityType: parts[0],
    name: parts[1],
    filePath: parts[2],
  };
}
