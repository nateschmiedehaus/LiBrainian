import { describe, it, expect } from 'vitest';
import {
  listConstructableDefinitions,
  getConstructableDefinition,
  validateConstructableDefinitions,
  createMotivationIndex,
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

  it('warns when core constructables are missing motivation or have too-short motivation', () => {
    const validation = validateConstructableDefinitions([
      {
        id: 'code-review-pipeline',
        basePriority: 80,
        isCore: true,
        description: 'Review pipeline',
      },
      {
        id: 'migration-assistant',
        basePriority: 78,
        isCore: true,
        description: 'Migration pipeline',
        motivation: 'Too short',
      },
    ]);

    expect(validation.warnings).toContain('missing_motivation:code-review-pipeline');
    expect(validation.warnings).toContain('motivation_too_short:migration-assistant');
  });

  it('finds constructables with similar motivations', () => {
    const index = createMotivationIndex([
      {
        id: 'code-review-pipeline',
        basePriority: 80,
        isCore: true,
        description: 'Review pipeline',
        motivation: 'Review code changes for correctness security and architecture fit before merge',
      },
      {
        id: 'dependency-auditor',
        basePriority: 73,
        isCore: true,
        description: 'Dependency audit',
        motivation: 'Audit dependencies for known vulnerabilities and risky upgrade constraints',
      },
      {
        id: 'documentation-generator',
        basePriority: 74,
        isCore: true,
        description: 'Documentation',
        motivation: 'Generate accurate documentation from source code behavior and interfaces',
      },
    ]);

    const matches = index.findBySimilarMotivation(
      'audit package dependencies for vulnerability and upgrade risk',
      { minSimilarity: 0.15, topK: 2 }
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.constructable.id).toBe('dependency-auditor');
    expect(matches[0]?.similarity).toBeGreaterThan(0.15);
  });
});
