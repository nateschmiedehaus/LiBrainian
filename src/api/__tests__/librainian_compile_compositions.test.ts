import { describe, it, expect } from 'vitest';
import { Librarian } from '../librarian.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { createTechniqueComposition } from '../../strategic/techniques.js';
import { saveTechniqueComposition } from '../../state/technique_compositions.js';

type StorageStub = Pick<LibrarianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('Librarian composition compilation', () => {
  it('compiles a seeded composition into a work template', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const result = await librarian.compileTechniqueCompositionTemplate('tc_release_readiness');
    expect(result.template?.id).toBe('wt_tc_release_readiness');
    expect(result.missingPrimitiveIds).toEqual([]);
  });

  it('reports missing primitives for custom compositions', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    const storage = new MockStorage() as unknown as LibrarianStorage;
    (librarian as unknown as { storage: LibrarianStorage }).storage = storage;

    await saveTechniqueComposition(storage, createTechniqueComposition({
      id: 'tc-missing',
      name: 'Missing primitives',
      description: 'Uses missing primitive IDs',
      primitiveIds: ['tp_missing'],
    }));

    const result = await librarian.compileTechniqueCompositionTemplate('tc-missing');
    expect(result.template?.id).toBe('wt_tc-missing');
    expect(result.missingPrimitiveIds).toEqual(['tp_missing']);
  });

  it('bundles composition template with primitive definitions', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const bundle = await librarian.compileTechniqueCompositionBundle('tc_release_readiness');
    expect(bundle.template?.id).toBe('wt_tc_release_readiness');
    expect(bundle.primitives.map((item) => item.id)).toEqual(
      expect.arrayContaining(['tp_release_plan'])
    );
  });

  it('compiles bundles from intent via librarian', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const bundles = await librarian.compileTechniqueBundlesFromIntent('Prepare a release plan', {
      selectionMode: 'keyword',
    });
    expect(bundles.map((bundle) => bundle.template?.id)).toEqual(
      expect.arrayContaining(['wt_tc_release_readiness'])
    );
  });

  it('compiles intent bundles with limit', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const bundles = await librarian.compileTechniqueBundlesFromIntent('Prepare a release plan', {
      limit: 1,
      selectionMode: 'keyword',
    });
    expect(bundles).toHaveLength(1);
  });

  it('plans work from intent via librarian', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const plans = await librarian.planWork('Prepare a release plan', {
      selectionMode: 'keyword',
    });
    expect(plans.map((plan) => plan.composition.id)).toContain('tc_release_readiness');
    expect(plans[0]?.workHierarchy.root.id).toContain('wp_tc_release_readiness');
  });

  it('can omit primitives from intent bundles', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const bundles = await librarian.compileTechniqueBundlesFromIntent('Prepare a release plan', {
      includePrimitives: false,
      selectionMode: 'keyword',
    });
    expect(bundles[0]?.primitives).toBeUndefined();
  });
});
