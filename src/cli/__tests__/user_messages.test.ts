import { describe, expect, it } from 'vitest';
import {
  parseTraceMarkerMessage,
  sanitizeTraceMarkerMessage,
  sanitizeTraceStatus,
} from '../user_messages.js';

describe('user message sanitization', () => {
  it('extracts trace code and detail from unverified marker messages', () => {
    const parsed = parseTraceMarkerMessage(
      'unverified_by_trace(provider_unavailable): Embedding provider unavailable'
    );
    expect(parsed.code).toBe('provider_unavailable');
    expect(parsed.userMessage).toBe('Embedding provider unavailable');
  });

  it('falls back to code text when no detail is present', () => {
    expect(sanitizeTraceMarkerMessage('unverified_by_trace(storage_write_degraded)')).toBe(
      'storage write degraded'
    );
  });

  it('normalizes unverified stage status for display', () => {
    expect(sanitizeTraceStatus('unverified_by_trace')).toBe('needs_verification');
    expect(sanitizeTraceStatus('passed')).toBe('passed');
  });
});
