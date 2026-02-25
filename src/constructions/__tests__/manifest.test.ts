import { describe, expect, it } from 'vitest';
import {
  compatibilityScore,
  validateManifest,
  type ConstructionManifest,
} from '../manifest.js';

function createValidManifest(): ConstructionManifest {
  return {
    id: '@acme/blast-radius-lite',
    scope: '@acme/community',
    version: '1.2.0',
    author: 'Acme',
    license: 'MIT',
    description: 'Compute low-cost blast radius summaries for a target change.',
    agentDescription: 'Use this construction when an agent is about to edit a function and needs a lightweight impact snapshot before changing code. It returns the direct callers and affected files with a concise risk summary. It cannot replace full tests and does not provide transitive impact certainty without graph support.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        risk: { type: 'number' },
      },
      required: ['risk'],
      additionalProperties: false,
    },
    requiredCapabilities: ['call-graph'],
    optionalCapabilities: ['vector-search'],
    engines: { librainian: '>=0.1.0' },
    tags: ['blast-radius', 'refactoring'],
    trustTier: 'community',
    testedOn: ['typescript-monorepo'],
    examples: [
      {
        title: 'single target',
        input: { target: 'src/auth/session.ts#refresh' },
        output: { risk: 0.62 },
        description: 'Basic impact estimate for one function edit.',
      },
    ],
    changelog: [{ version: '1.2.0', date: '2026-02-20', summary: 'Added risk score output.' }],
  };
}

describe('construction manifest validation', () => {
  it('accepts a complete valid manifest', () => {
    const result = validateManifest(createValidManifest(), {
      currentLibrarianVersion: '0.8.0',
      knownCapabilities: new Set(['call-graph', 'vector-search', 'librarian']),
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects agent descriptions that omit explicit limitations', () => {
    const manifest = createValidManifest();
    manifest.agentDescription = 'Use this construction when deciding impact for a code change and routing tasks to safe remediation pipelines with structured output.';
    const result = validateManifest(manifest, {
      knownCapabilities: new Set(['call-graph', 'vector-search']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes('limitation'))).toBe(true);
  });

  it('computes compatibility score from output to downstream input schemas', () => {
    const upstream = createValidManifest();
    const downstream = createValidManifest();
    downstream.inputSchema = {
      type: 'object',
      properties: {
        risk: { type: 'number' },
      },
      required: ['risk'],
      additionalProperties: false,
    };
    const score = compatibilityScore(upstream, downstream);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
