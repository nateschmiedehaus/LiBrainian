import { describe, it, expect } from 'vitest';
import { buildEmbeddingInput, resolveEmbeddingInputLimit } from '../agents/index_librarian.js';
import type { FunctionKnowledge } from '../types.js';

const baseFunction: FunctionKnowledge = {
  id: 'fn-1',
  filePath: 'src/example.ts',
  name: 'example',
  signature: 'function example()',
  purpose: '',
  startLine: 1,
  endLine: 1,
  confidence: 0.5,
  accessCount: 0,
  lastAccessed: null,
  validationCount: 0,
  outcomeHistory: { successes: 0, failures: 0 },
};

describe('buildEmbeddingInput', () => {
  it('formats embedding input without control characters', () => {
    const fn: FunctionKnowledge = { ...baseFunction, purpose: 'Example purpose' };
    const content = 'line one\nline two';
    const text = buildEmbeddingInput(fn, content);

    expect(text).toContain('Function: example');
    expect(text).toContain('Signature: function example()');
    expect(text).toContain('Purpose: Example purpose');
    expect(text).toContain('File: src/example.ts');
    expect(text).toContain('Code:');
    expect(text).toContain('line one');
    expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it('truncates oversized embedding input', () => {
    const fn: FunctionKnowledge = { ...baseFunction, startLine: 1, endLine: 2 };
    const longLine = 'x'.repeat(5000);
    const content = `${longLine}\n${longLine}`;
    const text = buildEmbeddingInput(fn, content);

    expect(text.endsWith('[truncated]')).toBe(true);
    expect(text.length).toBeLessThan(content.length);
    expect(text.length).toBeLessThanOrEqual(268);
  });

  it('supports larger explicit limits for long-context embedding models', () => {
    const fn: FunctionKnowledge = { ...baseFunction, startLine: 1, endLine: 2 };
    const longLine = 'x'.repeat(5000);
    const content = `${longLine}\n${longLine}`;
    const text = buildEmbeddingInput(fn, content, 1024);

    expect(text.endsWith('[truncated]')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(1036);
    expect(text.length).toBeGreaterThan(268);
  });

  it('omits purpose when missing', () => {
    const fn: FunctionKnowledge = { ...baseFunction, purpose: '' };
    const content = 'line one\nline two';
    const text = buildEmbeddingInput(fn, content);
    expect(text).toContain('Function: example');
    expect(text).not.toContain('Purpose:');
  });

  it('handles out-of-bounds line ranges', () => {
    const fn: FunctionKnowledge = { ...baseFunction, startLine: 10, endLine: 20 };
    const content = 'line one\nline two';
    const text = buildEmbeddingInput(fn, content);
    expect(text).toContain('Code:');
    expect(text).not.toContain('line one');
  });

  it('handles zero-length spans without throwing', () => {
    const fn: FunctionKnowledge = { ...baseFunction, startLine: 3, endLine: 2 };
    const content = 'line one\nline two';
    const text = buildEmbeddingInput(fn, content);
    expect(text).toContain('Code:');
    expect(text).not.toContain('line one');
  });
});

describe('resolveEmbeddingInputLimit', () => {
  it('uses model context window for known models', () => {
    expect(resolveEmbeddingInputLimit('all-MiniLM-L6-v2')).toBe(256);
    expect(resolveEmbeddingInputLimit('bge-small-en-v1.5')).toBe(512);
    expect(resolveEmbeddingInputLimit('jina-embeddings-v2-base-en')).toBe(8192);
  });

  it('falls back safely when model is unknown', () => {
    expect(resolveEmbeddingInputLimit('unknown-model')).toBe(256);
  });
});
