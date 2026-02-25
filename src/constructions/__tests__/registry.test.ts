import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../composition.js';
import { ConstructionError } from '../base/construction_base.js';
import type { Construction, ConstructionManifest } from '../types.js';
import {
  ConstructionRegistry,
  getConstructionManifest,
  listConstructions,
} from '../registry.js';
import { isConstructionId } from '../types.js';

function createTestConstruction(
  id: string,
  name: string,
): Construction<unknown, unknown, ConstructionError, unknown> {
  return {
    id,
    name,
    async execute(input: unknown): Promise<unknown> {
      return input;
    },
  };
}

function createManifest(
  id: ConstructionManifest['id'],
  options: {
    inputType: string;
    outputType: string;
  },
): ConstructionManifest {
  return {
    id,
    name: `Manifest ${id}`,
    scope: '@librainian-community',
    version: '0.0.1-test',
    description: 'Test manifest',
    agentDescription: 'Test manifest for registry behavior',
    inputSchema: { type: options.inputType },
    outputSchema: { type: options.outputType },
    requiredCapabilities: [],
    tags: ['test'],
    trustTier: 'community',
    examples: [
      {
        description: 'Test example',
        input: {},
        expectedOutputSummary: 'Returns the same payload',
      },
    ],
    construction: createTestConstruction(id, `Construction ${id}`),
    available: true,
  };
}

describe('construction id guards', () => {
  it('accepts official and scoped IDs and rejects unknown IDs', () => {
    expect(isConstructionId('librainian:security-audit-helper')).toBe(true);
    expect(isConstructionId('@acme/custom-construction')).toBe(true);
    expect(isConstructionId('librainian:not-real')).toBe(false);
  });
});

describe('default construction registry', () => {
  it('returns official manifest metadata for registered constructions', () => {
    const manifest = getConstructionManifest('librainian:security-audit-helper');
    expect(manifest).toBeTruthy();
    expect(manifest?.scope).toBe('@librainian');
    expect(manifest?.agentDescription.length ?? 0).toBeGreaterThan(0);
    expect(manifest?.tags).toContain('security');
  });

  it('filters constructions by tags and trust tier', () => {
    const filtered = listConstructions({
      tags: ['security'],
      trustTier: 'official',
    });
    expect(filtered.some((manifest) => manifest.id === 'librainian:security-audit-helper')).toBe(true);
  });

  it('registers patrol-process as an executable official construction', () => {
    const manifest = getConstructionManifest('librainian:patrol-process');
    expect(manifest).toBeTruthy();
    expect(manifest?.scope).toBe('@librainian');
    expect(manifest?.available).toBe(true);
    expect(manifest?.description).toMatch(/patrol/i);
  });

  it('registers complex preset constructions as executable official constructions', () => {
    const presetIds = [
      'librainian:code-review-pipeline',
      'librainian:migration-assistant',
      'librainian:documentation-generator',
      'librainian:stale-documentation-sensor',
      'librainian:test-slop-detector',
      'librainian:diff-semantic-summarizer',
      'librainian:intent-behavior-coherence-checker',
      'librainian:semantic-duplicate-detector',
      'librainian:regression-detector',
      'librainian:onboarding-assistant',
      'librainian:release-qualification',
      'librainian:dependency-auditor',
    ] as const;

    for (const presetId of presetIds) {
      const manifest = getConstructionManifest(presetId);
      expect(manifest).toBeTruthy();
      expect(manifest?.scope).toBe('@librainian');
      expect(manifest?.available).toBe(true);
    }
  });

  it('auto-registers generated constructions created via createConstruction', async () => {
    const construction = createConstruction(
      'registry-auto-generated-test',
      'Registry Auto Generated Test',
      async (input: number) => ({
        data: input * 3,
        confidence: deterministic(true, 'registry_auto_generated'),
      }),
    );

    const manifest = getConstructionManifest('@librainian-community/registry-auto-generated-test');
    expect(manifest).toBeTruthy();
    expect(manifest?.available).toBe(true);
    expect(construction.id).toBe('registry-auto-generated-test');
  });
});

describe('ConstructionRegistry class', () => {
  it('throws on duplicate registration', () => {
    const registry = new ConstructionRegistry();
    const manifest = createManifest('@test/duplicate', {
      inputType: 'string',
      outputType: 'string',
    });
    registry.register(manifest.id, manifest);
    expect(() => registry.register(manifest.id, manifest)).toThrow(/already registered/i);
  });

  it('computes compatibility score for matching output/input schemas', () => {
    const registry = new ConstructionRegistry();
    registry.register(
      '@test/a',
      createManifest('@test/a', {
        inputType: 'number',
        outputType: 'string',
      }),
    );
    registry.register(
      '@test/b',
      createManifest('@test/b', {
        inputType: 'string',
        outputType: 'object',
      }),
    );

    expect(registry.compatibilityScore('@test/a', '@test/b')).toBe(1);
  });
});
