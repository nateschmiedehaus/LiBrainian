/**
 * @fileoverview Tests for Modularization Hooks
 *
 * TIER-0: These tests use mocks and do not require live providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkModularization,
  getModularizationGuidance,
  buildModularizationPrompt,
  MODULARIZATION_GUIDANCE_VERSION,
  GENERIC_FILE_NAMES,
  POOR_NAME_PATTERNS,
} from '../modularization_hooks.js';

describe('Modularization Hooks', () => {
  describe('Generic File Names Detection', () => {
    it('GENERIC_FILE_NAMES contains common anti-patterns', () => {
      expect(GENERIC_FILE_NAMES.has('utils')).toBe(true);
      expect(GENERIC_FILE_NAMES.has('helpers')).toBe(true);
      expect(GENERIC_FILE_NAMES.has('misc')).toBe(true);
      expect(GENERIC_FILE_NAMES.has('common')).toBe(true);
      expect(GENERIC_FILE_NAMES.has('types')).toBe(true);
    });

    it('blocks generic file names', async () => {
      const result = await checkModularization({
        filePath: 'src/utils.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain('Generic file name');
      expect(result.blockReason).toContain('utils');
    });

    it('blocks helpers.ts', async () => {
      const result = await checkModularization({
        filePath: 'src/helpers.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain('Generic file name');
    });

    it('blocks misc.ts', async () => {
      const result = await checkModularization({
        filePath: 'lib/misc.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
    });

    it('allows descriptive file names', async () => {
      const result = await checkModularization({
        filePath: 'src/confidence_calibration.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(true);
    });

    it('allows domain-specific names', async () => {
      const result = await checkModularization({
        filePath: 'src/librainian/query_synthesis.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Poor Naming Patterns', () => {
    it('POOR_NAME_PATTERNS includes common bad patterns', () => {
      expect(POOR_NAME_PATTERNS.some(p => p.test('new_feature.ts'))).toBe(true);
      expect(POOR_NAME_PATTERNS.some(p => p.test('old_impl.ts'))).toBe(true);
      expect(POOR_NAME_PATTERNS.some(p => p.test('temp_fix.ts'))).toBe(true);
      expect(POOR_NAME_PATTERNS.some(p => p.test('v2_feature.ts'))).toBe(true);
    });

    it('blocks new_ prefix', async () => {
      const result = await checkModularization({
        filePath: 'src/new_feature.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain('poor naming pattern');
    });

    it('blocks temp_ prefix', async () => {
      const result = await checkModularization({
        filePath: 'src/temp_workaround.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
    });

    it('blocks version prefix', async () => {
      const result = await checkModularization({
        filePath: 'src/v2_auth.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('Override Behavior', () => {
    it('allows override via allowOverride flag', async () => {
      const result = await checkModularization({
        filePath: 'src/utils.ts',
        workspace: '/tmp/test-workspace',
        allowOverride: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('Test File Exemption', () => {
    it('test files are exempt in file_ops (modularization check allows *.test.ts names)', async () => {
      // Test files (*.test.ts) have "utils.test" as basename, not "utils"
      // So they pass the generic name check because the basename includes ".test"
      const result = await checkModularization({
        filePath: 'src/__tests__/utils.test.ts',
        workspace: '/tmp/test-workspace',
      });

      // The basename is "utils.test" which is not in GENERIC_FILE_NAMES
      // file_ops.ts also exempts test files from the check entirely
      expect(result.allowed).toBe(true);
    });

    it('helper files in __tests__ without .test suffix ARE blocked', async () => {
      // Non-test helper files in test directories should still be checked
      const result = await checkModularization({
        filePath: 'src/__tests__/helpers.ts',
        workspace: '/tmp/test-workspace',
      });

      // "helpers" is a generic name
      expect(result.allowed).toBe(false);
      expect(result.blockReason).toContain('Generic file name');
    });
  });

  describe('Guidance Generation', () => {
    it('getModularizationGuidance returns valid guidance', () => {
      const guidance = getModularizationGuidance();

      expect(guidance.version).toBe(MODULARIZATION_GUIDANCE_VERSION);
      expect(guidance.prompt).toContain('Search First');
      expect(guidance.prompt).toContain('Name Descriptively');
      expect(guidance.prompt).toContain('Consolidate');
      expect(guidance.updatedAt).toBeDefined();
    });

    it('buildModularizationPrompt returns non-empty string', () => {
      const prompt = buildModularizationPrompt();

      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain('Modularization-First');
      expect(prompt).toContain('Search First');
    });

    it('prompt includes bad examples', () => {
      const prompt = buildModularizationPrompt();

      expect(prompt).toContain('BAD:');
      expect(prompt).toContain('utils.ts');
      expect(prompt).toContain('helpers.ts');
    });

    it('prompt includes good examples', () => {
      const prompt = buildModularizationPrompt();

      expect(prompt).toContain('GOOD:');
      expect(prompt).toContain('confidence_calibration.ts');
    });
  });

  describe('Confidence Scoring', () => {
    it('returns high confidence for clear allows', async () => {
      const result = await checkModularization({
        filePath: 'src/query_synthesis.ts',
        workspace: '/tmp/test-workspace',
        allowOverride: true,
      });

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('returns high confidence for clear blocks', async () => {
      const result = await checkModularization({
        filePath: 'src/utils.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Suggestions', () => {
    it('provides suggestions when blocking', async () => {
      const result = await checkModularization({
        filePath: 'src/helpers.ts',
        workspace: '/tmp/test-workspace',
      });

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions?.length).toBeGreaterThan(0);
      // Check for useful suggestions
      const suggestionsText = result.suggestions?.join(' ') || '';
      expect(
        suggestionsText.includes('Rename') ||
        suggestionsText.includes('domain') ||
        suggestionsText.includes('librainian') ||
        suggestionsText.includes('existing')
      ).toBe(true);
    });
  });
});

describe('Agent Protocol Integration', () => {
  it('agent_protocol includes modularization prompt', async () => {
    const { buildAgentProtocolPrompt } = await import('../agent_protocol.js');

    const prompt = buildAgentProtocolPrompt('test-task-123');

    // Should include knowledge protocol
    expect(prompt).toContain('LiBrainian Knowledge Protocol');

    // Should include modularization guidance
    expect(prompt).toContain('Modularization-First');

    // Should include task ID
    expect(prompt).toContain('test-task-123');
  });

  it('buildKnowledgeProtocolPrompt excludes modularization', async () => {
    const { buildKnowledgeProtocolPrompt } = await import('../agent_protocol.js');

    const prompt = buildKnowledgeProtocolPrompt('test-task-456');

    expect(prompt).toContain('LiBrainian Knowledge Protocol');
    expect(prompt).not.toContain('Modularization-First');
    expect(prompt).toContain('test-task-456');
  });
});
