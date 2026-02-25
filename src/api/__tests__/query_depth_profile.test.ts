import { describe, expect, it } from 'vitest';
import {
  resolveQueryDepthProfile,
  resolveRerankWindow,
  resolveSemanticCandidateWindow,
} from '../query_depth_profile.js';

describe('query depth profile helpers', () => {
  it('falls back to L1 depth when undefined', () => {
    expect(resolveQueryDepthProfile(undefined)).toBe('L1');
  });

  it('preserves explicit depth values', () => {
    expect(resolveQueryDepthProfile('L0')).toBe('L0');
    expect(resolveQueryDepthProfile('L1')).toBe('L1');
    expect(resolveQueryDepthProfile('L2')).toBe('L2');
    expect(resolveQueryDepthProfile('L3')).toBe('L3');
  });

  it('computes semantic candidate windows by depth and meta-query flag', () => {
    expect(resolveSemanticCandidateWindow('L0', false)).toBe(0);
    expect(resolveSemanticCandidateWindow('L0', true)).toBe(0);
    expect(resolveSemanticCandidateWindow('L1', false)).toBe(12);
    expect(resolveSemanticCandidateWindow('L1', true)).toBe(16);
    expect(resolveSemanticCandidateWindow('L2', true)).toBe(20);
    expect(resolveSemanticCandidateWindow('L3', true)).toBe(24);
  });

  it('computes rerank windows by depth', () => {
    expect(resolveRerankWindow('L0')).toBe(0);
    expect(resolveRerankWindow('L1')).toBe(0);
    expect(resolveRerankWindow('L2')).toBe(10);
    expect(resolveRerankWindow('L3')).toBe(14);
  });
});
