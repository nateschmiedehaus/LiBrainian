/**
 * @fileoverview Tests for purpose vector fallback chain (Issue #664)
 *
 * Verifies that buildPurposeOnlyInput() uses:
 *   1. llmPurpose when provided
 *   2. @fileoverview / @description / first JSDoc paragraph from fileContent
 *   3. Filename-derived name as last resort
 */

import { describe, it, expect } from 'vitest';
import { buildPurposeOnlyInput } from '../api/embedding_providers/multi_vector_representations.js';

describe('buildPurposeOnlyInput — purpose vector fallback chain', () => {
  const filePath = 'src/api/sqlite_storage.ts';

  // -------------------------------------------------------------------------
  // Priority 1: LLM purpose
  // -------------------------------------------------------------------------

  it('uses llmPurpose when provided', () => {
    const result = buildPurposeOnlyInput(filePath, 'Stores and retrieves knowledge graph data in SQLite');
    expect(result).toBe('Stores and retrieves knowledge graph data in SQLite');
  });

  it('sanitizes control characters in llmPurpose', () => {
    const result = buildPurposeOnlyInput(filePath, 'Purpose\x00with\x01control\x1fchars');
    expect(result).toBe('Purposewithcontrolchars');
  });

  it('prefers llmPurpose over fileContent docstring', () => {
    const fileContent = `/**
 * @fileoverview This is the file overview.
 */
export class Foo {}
`;
    const result = buildPurposeOnlyInput(filePath, 'LLM purpose wins', fileContent);
    expect(result).toBe('LLM purpose wins');
  });

  // -------------------------------------------------------------------------
  // Priority 2: @fileoverview / @description / first JSDoc paragraph
  // -------------------------------------------------------------------------

  it('uses @fileoverview when llmPurpose is absent', () => {
    const fileContent = `/**
 * @fileoverview Manages persistent storage of AST-derived knowledge in SQLite.
 */
export class SqliteStorage {}
`;
    const result = buildPurposeOnlyInput(filePath, undefined, fileContent);
    expect(result).toBe('Manages persistent storage of AST-derived knowledge in SQLite.');
  });

  it('uses @description when @fileoverview is absent', () => {
    const fileContent = `/**
 * @description Handles embedding generation and caching.
 */
export function generateEmbedding() {}
`;
    const result = buildPurposeOnlyInput(filePath, undefined, fileContent);
    expect(result).toBe('Handles embedding generation and caching.');
  });

  it('uses first JSDoc paragraph when no @fileoverview or @description', () => {
    const fileContent = `/**
 * Provides query routing and scoring logic for multi-vector retrieval.
 */
export function scoreQuery() {}
`;
    const result = buildPurposeOnlyInput(filePath, undefined, fileContent);
    expect(result).toContain('Provides query routing and scoring logic');
  });

  it('skips JSDoc tags in first-paragraph extraction', () => {
    const fileContent = `/**
 * @param foo the thing
 * @returns the other thing
 */
export function doSomething() {}
`;
    // All lines start with @, so no first-paragraph text — falls back to filename
    const result = buildPurposeOnlyInput(filePath, undefined, fileContent);
    // Should not contain the @param content as purpose
    expect(result).not.toContain('@param');
  });

  // -------------------------------------------------------------------------
  // Priority 3: Filename-derived name (last resort)
  // -------------------------------------------------------------------------

  it('falls back to filename when no llmPurpose and no fileContent', () => {
    const result = buildPurposeOnlyInput(filePath);
    expect(result).toBe('Module: sqlite storage');
  });

  it('falls back to filename when fileContent has no JSDoc', () => {
    const fileContent = `// plain comment, no JSDoc
export class Foo {}
`;
    const result = buildPurposeOnlyInput(filePath, undefined, fileContent);
    expect(result).toBe('Module: sqlite storage');
  });

  it('converts camelCase filename to human-readable words', () => {
    const result = buildPurposeOnlyInput('src/api/multiVectorRepresentations.ts');
    expect(result).toBe('Module: multi vector representations');
  });

  it('converts kebab-case filename to human-readable words', () => {
    const result = buildPurposeOnlyInput('src/utils/error-handler.ts');
    expect(result).toBe('Module: error handler');
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('throws when filePath is empty', () => {
    expect(() => buildPurposeOnlyInput('')).toThrow('purpose_input_invalid');
  });

  it('throws when filePath is whitespace only', () => {
    expect(() => buildPurposeOnlyInput('   ')).toThrow('purpose_input_invalid');
  });

  it('handles empty fileContent gracefully', () => {
    const result = buildPurposeOnlyInput(filePath, undefined, '');
    expect(result).toBe('Module: sqlite storage');
  });
});
