/**
 * @fileoverview Tests for Skills Type Definitions
 *
 * Tests cover:
 * - Type guards
 * - Factory functions
 * - Cache metadata
 * - Skill structure validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SKILLS_SCHEMA_VERSION,
  createEmptyValidation,
  createCacheMetadata,
  isCacheExpired,
  isAgentSkill,
  isSkillIdentity,
  isSkillDefinition,
  isSkillValidation,
  isSkillMethodPack,
  type AgentSkill,
  type SkillIdentity,
  type SkillDefinition,
  type SkillValidation,
  type SkillMethodPack,
  type SkillCacheMetadata,
} from '../types.js';

describe('Skills Types', () => {
  describe('Schema Version', () => {
    it('should have a valid semantic version', () => {
      expect(SKILLS_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('createEmptyValidation', () => {
    it('should create a valid empty validation result', () => {
      const validation = createEmptyValidation();

      expect(validation.valid).toBe(true);
      expect(validation.validatedAt).toBeTruthy();
      expect(validation.validatorVersion).toBe(SKILLS_SCHEMA_VERSION);
      expect(validation.errors).toEqual([]);
      expect(validation.warnings).toEqual([]);
      expect(validation.info).toEqual([]);
    });

    it('should set validatedAt to current time', () => {
      const before = new Date();
      const validation = createEmptyValidation();
      const after = new Date();

      const validatedAt = new Date(validation.validatedAt);
      expect(validatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(validatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('createCacheMetadata', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create cache metadata with correct TTL', () => {
      const now = new Date('2026-01-08T12:00:00Z');
      vi.setSystemTime(now);

      const ttlMs = 3600000; // 1 hour
      const cache = createCacheMetadata(ttlMs, 'content123', 'deps456');

      expect(cache.ttlMs).toBe(ttlMs);
      expect(cache.contentHash).toBe('content123');
      expect(cache.depsHash).toBe('deps456');
      expect(cache.cacheVersion).toBe(SKILLS_SCHEMA_VERSION);

      const expiresAt = new Date(cache.expiresAt);
      expect(expiresAt.getTime()).toBe(now.getTime() + ttlMs);
    });
  });

  describe('isCacheExpired', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return false for unexpired cache', () => {
      const now = new Date('2026-01-08T12:00:00Z');
      vi.setSystemTime(now);

      const cache = createCacheMetadata(3600000, 'hash1', 'hash2');

      expect(isCacheExpired(cache)).toBe(false);
    });

    it('should return true for expired cache', () => {
      const now = new Date('2026-01-08T12:00:00Z');
      vi.setSystemTime(now);

      const cache = createCacheMetadata(3600000, 'hash1', 'hash2');

      // Move time forward past expiration
      vi.setSystemTime(new Date('2026-01-08T14:00:00Z'));

      expect(isCacheExpired(cache)).toBe(true);
    });

    it('should return true exactly at expiration', () => {
      const now = new Date('2026-01-08T12:00:00Z');
      vi.setSystemTime(now);

      const ttlMs = 3600000;
      const cache = createCacheMetadata(ttlMs, 'hash1', 'hash2');

      // Move time to exactly expiration time + 1ms
      vi.setSystemTime(new Date(now.getTime() + ttlMs + 1));

      expect(isCacheExpired(cache)).toBe(true);
    });
  });

  describe('Type Guards', () => {
    describe('isAgentSkill', () => {
      it('should return true for valid AgentSkill', () => {
        const skill: AgentSkill = {
          schemaVersion: '1.0.0',
          identity: {
            id: 'test-skill',
            name: 'Test Skill',
            version: '1.0.0',
            qualifiedName: 'test-skill',
            path: 'skills/test-skill',
            absolutePath: '/workspace/skills/test-skill',
          },
          meta: {
            description: 'A test skill',
            tags: ['test'],
            modifiedAt: '2026-01-08T00:00:00Z',
            source: { type: 'local', path: 'skills/test-skill' },
          },
          definition: {
            trigger: {},
            workflow: [],
            inputs: [],
            outputs: [],
            dependencies: [],
          },
          scripts: [],
          resources: [],
          config: {},
          validation: createEmptyValidation(),
          cache: createCacheMetadata(3600000, 'hash1', 'hash2'),
        };

        expect(isAgentSkill(skill)).toBe(true);
      });

      it('should return false for invalid objects', () => {
        expect(isAgentSkill(null)).toBe(false);
        expect(isAgentSkill(undefined)).toBe(false);
        expect(isAgentSkill({})).toBe(false);
        expect(isAgentSkill({ schemaVersion: '1.0.0' })).toBe(false);
      });
    });

    describe('isSkillIdentity', () => {
      it('should return true for valid SkillIdentity', () => {
        const identity: SkillIdentity = {
          id: 'test-skill',
          name: 'Test Skill',
          version: '1.0.0',
          qualifiedName: 'test-skill',
          path: 'skills/test-skill',
          absolutePath: '/workspace/skills/test-skill',
        };

        expect(isSkillIdentity(identity)).toBe(true);
      });

      it('should return false for invalid objects', () => {
        expect(isSkillIdentity(null)).toBe(false);
        expect(isSkillIdentity({})).toBe(false);
        expect(isSkillIdentity({ id: 'test' })).toBe(false);
      });
    });

    describe('isSkillDefinition', () => {
      it('should return true for valid SkillDefinition', () => {
        const definition: SkillDefinition = {
          trigger: {
            taskTypes: ['refactor'],
            priority: 10,
          },
          workflow: [
            {
              id: 'step1',
              name: 'First Step',
              description: 'Do something',
              type: 'script',
              action: { type: 'script', script: 'run.sh' },
            },
          ],
          inputs: [
            {
              name: 'target',
              type: 'file',
              description: 'Target file',
              required: true,
            },
          ],
          outputs: [
            {
              name: 'result',
              type: 'string',
              description: 'Result message',
            },
          ],
          dependencies: [],
        };

        expect(isSkillDefinition(definition)).toBe(true);
      });

      it('should return false for invalid objects', () => {
        expect(isSkillDefinition(null)).toBe(false);
        expect(isSkillDefinition({})).toBe(false);
        expect(isSkillDefinition({ trigger: {} })).toBe(false);
      });
    });

    describe('isSkillValidation', () => {
      it('should return true for valid SkillValidation', () => {
        const validation = createEmptyValidation();
        expect(isSkillValidation(validation)).toBe(true);
      });

      it('should return true for validation with errors', () => {
        const validation: SkillValidation = {
          valid: false,
          validatedAt: '2026-01-08T00:00:00Z',
          validatorVersion: '1.0.0',
          errors: [
            {
              code: 'E001',
              message: 'Missing required field',
              severity: 'error',
            },
          ],
          warnings: [],
          info: [],
        };

        expect(isSkillValidation(validation)).toBe(true);
      });

      it('should return false for invalid objects', () => {
        expect(isSkillValidation(null)).toBe(false);
        expect(isSkillValidation({})).toBe(false);
        expect(isSkillValidation({ valid: true })).toBe(false);
      });
    });

    describe('isSkillMethodPack', () => {
      it('should return true for valid SkillMethodPack', () => {
        const pack: SkillMethodPack = {
          id: 'pack-1',
          skillId: 'test-skill',
          families: ['MF-01', 'MF-02'],
          ucIds: ['UC-001'],
          hints: ['Use when refactoring'],
          steps: ['Analyze code', 'Apply changes'],
          requiredInputs: ['target'],
          confidence: 0.85,
          generatedAt: '2026-01-08T00:00:00Z',
          evidence: {
            source: { type: 'local', path: 'skills/test' },
            version: '1.0.0',
            validated: true,
            contentHash: 'abc123',
            skillModifiedAt: '2026-01-07T00:00:00Z',
          },
        };

        expect(isSkillMethodPack(pack)).toBe(true);
      });

      it('should return false for invalid objects', () => {
        expect(isSkillMethodPack(null)).toBe(false);
        expect(isSkillMethodPack({})).toBe(false);
        expect(isSkillMethodPack({ id: 'test' })).toBe(false);
      });
    });
  });

  describe('Skill Structure', () => {
    it('should support all step types', () => {
      const stepTypes = ['script', 'command', 'llm', 'decision', 'parallel', 'conditional', 'manual'];

      for (const type of stepTypes) {
        const definition: SkillDefinition = {
          trigger: {},
          workflow: [
            {
              id: 'step1',
              name: 'Test Step',
              description: `A ${type} step`,
              type: type as any,
              action: { type: 'script', script: 'test.sh' },
            },
          ],
          inputs: [],
          outputs: [],
          dependencies: [],
        };

        expect(isSkillDefinition(definition)).toBe(true);
      }
    });

    it('should support all input types', () => {
      const inputTypes = ['string', 'number', 'boolean', 'file', 'directory', 'array', 'object'];

      for (const type of inputTypes) {
        const definition: SkillDefinition = {
          trigger: {},
          workflow: [],
          inputs: [
            {
              name: 'test',
              type: type as any,
              description: `A ${type} input`,
              required: false,
            },
          ],
          outputs: [],
          dependencies: [],
        };

        expect(isSkillDefinition(definition)).toBe(true);
      }
    });

    it('should support optional dependencies', () => {
      const definition: SkillDefinition = {
        trigger: {},
        workflow: [],
        inputs: [],
        outputs: [],
        dependencies: [
          { skillId: 'required-skill', version: '^1.0.0' },
          { skillId: 'optional-skill', optional: true },
        ],
      };

      expect(isSkillDefinition(definition)).toBe(true);
    });
  });

  describe('Trigger Patterns', () => {
    it('should support task type triggers', () => {
      const definition: SkillDefinition = {
        trigger: {
          taskTypes: ['refactor', 'debug', 'test'],
        },
        workflow: [],
        inputs: [],
        outputs: [],
        dependencies: [],
      };

      expect(isSkillDefinition(definition)).toBe(true);
    });

    it('should support intent pattern triggers', () => {
      const definition: SkillDefinition = {
        trigger: {
          intentPatterns: ['how to.*', 'fix.*bug', 'optimize.*performance'],
        },
        workflow: [],
        inputs: [],
        outputs: [],
        dependencies: [],
      };

      expect(isSkillDefinition(definition)).toBe(true);
    });

    it('should support file pattern triggers', () => {
      const definition: SkillDefinition = {
        trigger: {
          filePatterns: ['**/*.test.ts', 'src/**/*.tsx'],
        },
        workflow: [],
        inputs: [],
        outputs: [],
        dependencies: [],
      };

      expect(isSkillDefinition(definition)).toBe(true);
    });

    it('should support combined triggers', () => {
      const definition: SkillDefinition = {
        trigger: {
          taskTypes: ['refactor'],
          intentPatterns: ['refactor.*'],
          filePatterns: ['**/*.ts'],
          priority: 10,
        },
        workflow: [],
        inputs: [],
        outputs: [],
        dependencies: [],
      };

      expect(isSkillDefinition(definition)).toBe(true);
    });
  });

  describe('Validation Issues', () => {
    it('should support error issues', () => {
      const validation: SkillValidation = {
        valid: false,
        validatedAt: '2026-01-08T00:00:00Z',
        validatorVersion: '1.0.0',
        errors: [
          {
            code: 'SKILL_001',
            message: 'SKILL.md not found',
            severity: 'error',
            location: 'skills/broken-skill/',
            suggestion: 'Create a SKILL.md file in the skill directory',
          },
        ],
        warnings: [],
        info: [],
      };

      expect(isSkillValidation(validation)).toBe(true);
      expect(validation.errors[0].severity).toBe('error');
    });

    it('should support warning issues', () => {
      const validation: SkillValidation = {
        valid: true,
        validatedAt: '2026-01-08T00:00:00Z',
        validatorVersion: '1.0.0',
        errors: [],
        warnings: [
          {
            code: 'SKILL_101',
            message: 'No examples defined',
            severity: 'warning',
          },
        ],
        info: [],
      };

      expect(isSkillValidation(validation)).toBe(true);
      expect(validation.warnings[0].severity).toBe('warning');
    });

    it('should support info issues', () => {
      const validation: SkillValidation = {
        valid: true,
        validatedAt: '2026-01-08T00:00:00Z',
        validatorVersion: '1.0.0',
        errors: [],
        warnings: [],
        info: [
          {
            code: 'SKILL_201',
            message: 'Skill validated successfully',
            severity: 'info',
          },
        ],
      };

      expect(isSkillValidation(validation)).toBe(true);
      expect(validation.info[0].severity).toBe('info');
    });
  });

  describe('Method Pack Evidence', () => {
    it('should include skill provenance', () => {
      const pack: SkillMethodPack = {
        id: 'pack-1',
        skillId: 'test-skill',
        families: ['MF-01'],
        ucIds: [],
        hints: ['Test hint'],
        steps: ['Step 1'],
        requiredInputs: [],
        confidence: 0.9,
        generatedAt: '2026-01-08T00:00:00Z',
        evidence: {
          source: { type: 'local', path: '/skills/test' },
          version: '1.0.0',
          validated: true,
          contentHash: 'sha256:abc123',
          skillModifiedAt: '2026-01-07T00:00:00Z',
        },
      };

      expect(pack.evidence.source.type).toBe('local');
      expect(pack.evidence.validated).toBe(true);
      expect(pack.evidence.contentHash).toBeTruthy();
    });

    it('should support registry sources', () => {
      const pack: SkillMethodPack = {
        id: 'pack-2',
        skillId: 'registry-skill',
        families: ['MF-02'],
        ucIds: [],
        hints: [],
        steps: [],
        requiredInputs: [],
        confidence: 0.8,
        generatedAt: '2026-01-08T00:00:00Z',
        evidence: {
          source: {
            type: 'registry',
            registry: 'npm',
            package: '@librarian/skill-pack',
            version: '1.2.3',
          },
          version: '1.2.3',
          validated: true,
          contentHash: 'sha256:def456',
          skillModifiedAt: '2026-01-06T00:00:00Z',
        },
      };

      expect(pack.evidence.source.type).toBe('registry');
      if (pack.evidence.source.type === 'registry') {
        expect(pack.evidence.source.package).toBe('@librarian/skill-pack');
      }
    });
  });
});
