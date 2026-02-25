import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Librarian } from '../../api/librarian.js';
import { deterministic } from '../../epistemics/confidence.js';
import {
  ConstructionCapabilityError,
  ConstructionInputError,
} from '../base/construction_base.js';
import { createConstruction } from '../factory.js';
import { getConstructionManifest } from '../registry.js';
import type { Context, LibrarianContext } from '../types.js';
import { ok } from '../types.js';

function createContext(options?: {
  embeddings?: boolean;
  graphMetrics?: boolean;
}): Context<LibrarianContext> {
  const librarian = {
    queryOptional: async () => ({ packs: [] }),
    getStorageCapabilities: () => ({
      core: {
        getFunctions: true as const,
        getFiles: true as const,
        getContextPacks: true as const,
      },
      optional: {
        graphMetrics: options?.graphMetrics ?? true,
        multiVectors: false,
        embeddings: options?.embeddings ?? true,
        episodes: false,
        verificationPlans: false,
      },
      versions: {
        schema: 1,
        api: 1,
      },
    }),
  } as unknown as Librarian;

  return {
    deps: {
      librarian,
    },
    signal: new AbortController().signal,
    sessionId: 'factory-test-session',
  };
}

describe('createConstruction factory', () => {
  it('returns ConstructionInputError when input schema validation fails', async () => {
    const execute = vi.fn(async (input: { value: number }) => ok({ doubled: input.value * 2 }));

    const construction = createConstruction({
      id: '@librainian-community/factory-invalid-input',
      name: 'Factory Invalid Input',
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
      execute,
    });

    const outcome = await construction.execute(
      { value: 'oops' } as unknown as { value: number },
      createContext(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ConstructionInputError);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns ConstructionCapabilityError when required capability is unavailable', async () => {
    const execute = vi.fn(async (input: { value: number }) => ok({ doubled: input.value * 2 }));

    const construction = createConstruction({
      id: '@librainian-community/factory-missing-capability',
      name: 'Factory Missing Capability',
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
      requiredCapabilities: ['embedding-search'],
      execute,
    });

    const outcome = await construction.execute(
      { value: 21 },
      createContext({ embeddings: false }),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ConstructionCapabilityError);
      expect(outcome.error.requiredCapability).toBe('embedding-search');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto-registers generated construction manifests with schemas and supports operator methods', async () => {
    const construction = createConstruction({
      id: '@librainian-community/factory-registry-presence',
      name: 'Factory Registry Presence',
      description: 'factory registration test',
      agentDescription: 'use for factory registration checks',
      tags: ['factory', 'registry'],
      requiredCapabilities: ['librarian'],
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({
        value: z.number(),
        confidence: z.object({
          type: z.literal('deterministic'),
          value: z.number(),
          reason: z.string(),
        }),
        evidenceRefs: z.array(z.string()),
        analysisTimeMs: z.number(),
      }),
      execute: async (input) => ok({
        value: input.value * 2,
        confidence: deterministic(true, 'factory'),
        evidenceRefs: [],
        analysisTimeMs: 0,
      }),
    });

    const mapped = construction.map((output) => ({ summary: String(output.value) }));
    const mappedOutcome = await mapped.execute({ value: 4 }, createContext());
    expect(mappedOutcome.ok).toBe(true);
    if (mappedOutcome.ok) {
      expect(mappedOutcome.value.summary).toBe('8');
    }

    const manifest = getConstructionManifest('@librainian-community/factory-registry-presence');
    expect(manifest).toBeTruthy();
    expect(manifest?.available).toBe(true);
    expect(manifest?.requiredCapabilities).toContain('librarian');
    expect(manifest?.tags).toContain('factory');
    expect(manifest?.inputSchema.type).toBe('object');
    expect(manifest?.outputSchema.type).toBe('object');
  });
});
