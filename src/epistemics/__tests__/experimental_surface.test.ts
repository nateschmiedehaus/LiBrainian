import { describe, expect, it } from 'vitest';
import * as stableEpistemics from '../index.js';
import * as experimentalEpistemics from '../experimental/index.js';

describe('epistemics experimental surface', () => {
  it('does not expose experimental modules on the stable epistemics index', () => {
    expect((stableEpistemics as Record<string, unknown>).createBDIAgentState).toBeUndefined();
    expect((stableEpistemics as Record<string, unknown>).createCredalSet).toBeUndefined();
    expect((stableEpistemics as Record<string, unknown>).createBeliefMass).toBeUndefined();
  });

  it('exposes experimental modules through the explicit experimental namespace', () => {
    expect(typeof (experimentalEpistemics as Record<string, unknown>).createBDIAgentState).toBe('function');
    expect(typeof (experimentalEpistemics as Record<string, unknown>).createCredalSet).toBe('function');
    expect(typeof (experimentalEpistemics as Record<string, unknown>).createBeliefMass).toBe('function');
  });
});
