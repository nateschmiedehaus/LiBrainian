import { describe, it, expect } from 'vitest';
import {
  listConstructableDefinitions,
  getConstructableDefinition,
  validateConstructableDefinitions,
} from '../constructable_registry.js';

describe('Constructable registry', () => {
  it('exposes definitions for core constructables', () => {
    const definitions = listConstructableDefinitions();
    expect(definitions.length).toBeGreaterThan(5);
    const refactoring = getConstructableDefinition('refactoring-safety-checker');
    expect(refactoring?.id).toBe('refactoring-safety-checker');
    expect(refactoring?.description?.length).toBeGreaterThan(10);
  });

  it('contains language metadata for language-specific constructables', () => {
    const typescript = getConstructableDefinition('typescript-patterns');
    expect(typescript?.languages).toContain('typescript');
  });

  it('passes definition validation', () => {
    const validation = validateConstructableDefinitions();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
