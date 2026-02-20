import { describe, expect, it } from 'vitest';
import * as agentsApi from '../index.js';

describe('agents public surface', () => {
  it('keeps self-improvement developer tooling out of public agents exports', () => {
    expect('selfBootstrap' in agentsApi).toBe(false);
    expect('createSelfBootstrap' in agentsApi).toBe(false);
    expect('selfRefresh' in agentsApi).toBe(false);
    expect('createSelfRefresh' in agentsApi).toBe(false);
    expect('analyzeArchitecture' in agentsApi).toBe(false);
    expect('createAnalyzeArchitecture' in agentsApi).toBe(false);
  });

  it('retains core agent exports', () => {
    expect(typeof agentsApi.createIndexLibrarian).toBe('function');
    expect(typeof agentsApi.createHierarchicalOrchestrator).toBe('function');
  });
});
