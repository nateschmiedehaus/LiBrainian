import { createHash } from 'node:crypto';

/**
 * 128-bit checksum (32 hex chars) for file-content change detection.
 * This is used for persisted index freshness checks.
 */
export function computeFileChecksum(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Legacy checksum helper kept for compatibility with existing call sites.
 * Historically this returned a shorter hash and is being phased out.
 */
export function computeChecksum16(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
