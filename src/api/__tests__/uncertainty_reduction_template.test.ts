/**
 * @fileoverview Tests for T12 UncertaintyReduction Template
 *
 * WU-TMPL-012: T12 UncertaintyReduction Template
 *
 * Tests cover:
 * - Uncertainty source identification
 * - Reduction step planning
 * - Iterative confidence improvement
 * - Defeater integration
 * - Edge cases and error handling
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import {
  deterministic,
  bounded,
  absent,
  measuredConfidence,
  getNumericValue,
} from '../../epistemics/confidence.js';
import type { ExtendedDefeater } from '../../epistemics/types.js';
import { createClaimId } from '../../epistemics/types.js';
import {
  type UncertaintyReductionInput,
  type UncertaintyReductionOutput,
  type UncertaintySource,
  type ReductionStep,
  identifyUncertaintySources,
  planReductionSteps,
  executeReductionStep,
  iterateUntilTarget,
  createUncertaintyReductionTemplate,
  mapDefeaterToUncertaintySource,
  type UncertaintyReductionTemplate,
} from '../uncertainty_reduction_template.js';

describe('T12 UncertaintyReduction Template', () => {
  // ============================================================================
  // UNCERTAINTY SOURCE IDENTIFICATION
  // ============================================================================

  describe('identifyUncertaintySources', () => {
    it('identifies missing_context uncertainty from low confidence', () => {
      const response = 'The function getUserById retrieves a user from the database.';
      const confidence: ConfidenceValue = bounded(
        0.3,
        0.5,
        'theoretical',
        'Limited context available'
      );

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.length).toBeGreaterThan(0);
      expect(sources.some((s) => s.type === 'missing_context')).toBe(true);
    });

    it('identifies ambiguous_query from uncertain language', () => {
      const response =
        'This might be related to authentication, but it could also be for authorization.';
      const confidence: ConfidenceValue = bounded(
        0.4,
        0.6,
        'theoretical',
        'Ambiguous interpretation'
      );

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.some((s) => s.type === 'ambiguous_query')).toBe(true);
    });

    it('identifies conflicting_sources when response mentions conflicts', () => {
      const response =
        'The documentation says X but the code shows Y. There is a discrepancy between the two.';
      const confidence: ConfidenceValue = bounded(0.3, 0.7, 'theoretical', 'Conflicting evidence');

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.some((s) => s.type === 'conflicting_sources')).toBe(true);
    });

    it('identifies stale_data when response mentions outdated information', () => {
      const response =
        'Based on the cached information from 6 months ago, this function was deprecated.';
      const confidence: ConfidenceValue = bounded(0.3, 0.5, 'theoretical', 'Potentially stale');

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.some((s) => s.type === 'stale_data')).toBe(true);
    });

    it('identifies limited_coverage when bounded confidence has wide range', () => {
      const response = 'The module handles user management.';
      const confidence: ConfidenceValue = bounded(0.2, 0.8, 'theoretical', 'Wide uncertainty range');

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.some((s) => s.type === 'limited_coverage')).toBe(true);
    });

    it('returns empty array for high confidence deterministic values', () => {
      const response = 'The function returns true.';
      const confidence: ConfidenceValue = deterministic(true, 'exact_match');

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources).toHaveLength(0);
    });

    it('marks reducible sources correctly', () => {
      const response = 'Need more context about the configuration.';
      const confidence: ConfidenceValue = bounded(0.3, 0.5, 'theoretical', 'Missing context');

      const sources = identifyUncertaintySources(response, confidence);

      // missing_context should be reducible via retrieval
      const missingContext = sources.find((s) => s.type === 'missing_context');
      if (missingContext) {
        expect(missingContext.reducible).toBe(true);
        expect(missingContext.reductionStrategy).toBeDefined();
      }
    });

    it('handles absent confidence appropriately', () => {
      const response = 'Unable to determine the purpose.';
      const confidence: ConfidenceValue = absent('uncalibrated');

      const sources = identifyUncertaintySources(response, confidence);

      // Absent confidence indicates high uncertainty
      expect(sources.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // REDUCTION STEP PLANNING
  // ============================================================================

  describe('planReductionSteps', () => {
    it('plans retrieve_more for missing_context', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-1',
          type: 'missing_context',
          description: 'Need more information about the module',
          affectedClaims: ['claim-1'],
          reducible: true,
          reductionStrategy: 'Retrieve additional context',
        },
      ];

      const steps = planReductionSteps(sources);

      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0].action).toBe('retrieve_more');
    });

    it('plans clarify_query for ambiguous_query', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-2',
          type: 'ambiguous_query',
          description: 'Query interpretation unclear',
          affectedClaims: ['claim-2'],
          reducible: true,
          reductionStrategy: 'Clarify intent',
        },
      ];

      const steps = planReductionSteps(sources);

      expect(steps.some((s) => s.action === 'clarify_query')).toBe(true);
    });

    it('plans verify_claim for conflicting_sources', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-3',
          type: 'conflicting_sources',
          description: 'Documentation contradicts code',
          affectedClaims: ['claim-3'],
          reducible: true,
          reductionStrategy: 'Verify against source of truth',
        },
      ];

      const steps = planReductionSteps(sources);

      expect(steps.some((s) => s.action === 'resolve_conflict' || s.action === 'verify_claim')).toBe(
        true
      );
    });

    it('plans refresh_data for stale_data', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-4',
          type: 'stale_data',
          description: 'Information may be outdated',
          affectedClaims: ['claim-4'],
          reducible: true,
          reductionStrategy: 'Re-fetch current data',
        },
      ];

      const steps = planReductionSteps(sources);

      expect(steps.some((s) => s.action === 'refresh_data')).toBe(true);
    });

    it('orders steps by expected reduction', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-1',
          type: 'missing_context',
          description: 'Missing context',
          affectedClaims: ['claim-1'],
          reducible: true,
        },
        {
          id: 'src-2',
          type: 'stale_data',
          description: 'Stale data',
          affectedClaims: ['claim-2'],
          reducible: true,
        },
      ];

      const steps = planReductionSteps(sources);

      // Steps should be ordered by expected reduction (descending)
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i - 1].expectedReduction).toBeGreaterThanOrEqual(steps[i].expectedReduction);
      }
    });

    it('assigns sequential step numbers', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-1',
          type: 'missing_context',
          description: 'Missing context',
          affectedClaims: [],
          reducible: true,
        },
        {
          id: 'src-2',
          type: 'ambiguous_query',
          description: 'Ambiguous query',
          affectedClaims: [],
          reducible: true,
        },
      ];

      const steps = planReductionSteps(sources);

      for (let i = 0; i < steps.length; i++) {
        expect(steps[i].stepNumber).toBe(i + 1);
      }
    });

    it('skips non-reducible sources', () => {
      const sources: UncertaintySource[] = [
        {
          id: 'src-1',
          type: 'limited_coverage',
          description: 'Fundamental limitation',
          affectedClaims: [],
          reducible: false,
        },
      ];

      const steps = planReductionSteps(sources);

      expect(steps).toHaveLength(0);
    });
  });

  // ============================================================================
  // REDUCTION STEP EXECUTION
  // ============================================================================

  describe('executeReductionStep', () => {
    it('executes retrieve_more step and returns updated confidence', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'retrieve_more',
        target: 'module:auth',
        expectedReduction: 0.15,
      };

      const result = await executeReductionStep(step, {
        query: 'How does authentication work?',
        currentResponse: 'Authentication uses JWT tokens.',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Limited context'),
      });

      expect(result.actualReduction).toBeDefined();
      expect(result.newConfidence).toBeDefined();
    });

    it('executes clarify_query step', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'clarify_query',
        target: 'query:auth_type',
        expectedReduction: 0.2,
      };

      const result = await executeReductionStep(step, {
        query: 'How does auth work?',
        currentResponse: 'Could be OAuth or basic auth.',
        currentConfidence: bounded(0.3, 0.5, 'theoretical', 'Ambiguous'),
      });

      expect(result.actualReduction).toBeDefined();
    });

    it('executes verify_claim step', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'verify_claim',
        target: 'claim:function_returns_user',
        expectedReduction: 0.25,
      };

      const result = await executeReductionStep(step, {
        query: 'What does getUserById return?',
        currentResponse: 'Returns a User object.',
        currentConfidence: bounded(0.5, 0.7, 'theoretical', 'Needs verification'),
      });

      expect(result.newConfidence).toBeDefined();
    });

    it('executes resolve_conflict step', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'resolve_conflict',
        target: 'conflict:docs_vs_code',
        expectedReduction: 0.3,
      };

      const result = await executeReductionStep(step, {
        query: 'What is the return type?',
        currentResponse: 'Docs say string, code shows number.',
        currentConfidence: bounded(0.2, 0.6, 'theoretical', 'Conflicting'),
      });

      expect(result.actualReduction).toBeDefined();
    });

    it('executes refresh_data step', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'refresh_data',
        target: 'data:api_schema',
        expectedReduction: 0.2,
      };

      const result = await executeReductionStep(step, {
        query: 'What is the API schema?',
        currentResponse: 'Based on cached schema from 3 months ago.',
        currentConfidence: bounded(0.3, 0.5, 'theoretical', 'Stale'),
      });

      expect(result.newConfidence).toBeDefined();
    });

    it('handles step execution failure gracefully', async () => {
      const step: ReductionStep = {
        stepNumber: 1,
        action: 'retrieve_more',
        target: 'nonexistent:target',
        expectedReduction: 0.2,
      };

      const result = await executeReductionStep(step, {
        query: 'What is this?',
        currentResponse: 'Unknown.',
        currentConfidence: absent('uncalibrated'),
      });

      // Should return with zero or negative reduction on failure
      expect(result.actualReduction).toBeLessThanOrEqual(result.expectedReduction);
    });
  });

  // ============================================================================
  // ITERATIVE REFINEMENT
  // ============================================================================

  describe('iterateUntilTarget', () => {
    it('iterates until target confidence is reached', async () => {
      const input: UncertaintyReductionInput = {
        query: 'How does the caching work?',
        currentResponse: 'The system uses Redis for caching.',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Limited info'),
        targetConfidence: 0.75,
        maxIterations: 5,
      };

      const result = await iterateUntilTarget(input);

      expect(result.finalConfidence).toBeGreaterThanOrEqual(result.originalConfidence);
      expect(result.iterationsUsed).toBeGreaterThanOrEqual(1);
      expect(result.reductionSteps.length).toBeGreaterThan(0);
    });

    it('stops at maxIterations even if target not reached', async () => {
      const input: UncertaintyReductionInput = {
        query: 'What is the architecture?',
        currentResponse: 'Complex microservices.',
        currentConfidence: bounded(0.2, 0.4, 'theoretical', 'Very limited'),
        targetConfidence: 0.99, // Unreachable target
        maxIterations: 3,
      };

      const result = await iterateUntilTarget(input);

      expect(result.iterationsUsed).toBeLessThanOrEqual(3);
    });

    it('reports unreducible uncertainty sources', async () => {
      const input: UncertaintyReductionInput = {
        query: 'What will the system do in the future?',
        currentResponse: 'Cannot predict future behavior.',
        currentConfidence: bounded(0.1, 0.3, 'theoretical', 'Fundamentally uncertain'),
        maxIterations: 3,
      };

      const result = await iterateUntilTarget(input);

      // Some uncertainties may not be reducible
      expect(result.unreducibleUncertainty).toBeDefined();
    });

    it('tracks confidence improvement through iterations', async () => {
      const input: UncertaintyReductionInput = {
        query: 'How does error handling work?',
        currentResponse: 'Errors are caught and logged.',
        currentConfidence: bounded(0.3, 0.5, 'theoretical', 'Partial understanding'),
        maxIterations: 4,
      };

      const result = await iterateUntilTarget(input);

      expect(result.originalConfidence).toBeDefined();
      expect(result.finalConfidence).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('produces refined response when confidence improves', async () => {
      const input: UncertaintyReductionInput = {
        query: 'What is the purpose of this module?',
        currentResponse: 'It handles some operations.',
        currentConfidence: bounded(0.3, 0.5, 'theoretical', 'Vague'),
        maxIterations: 3,
      };

      const result = await iterateUntilTarget(input);

      // If steps were executed, may have refined response
      if (result.reductionSteps.some((s) => s.actualReduction && s.actualReduction > 0)) {
        expect(result.refinedResponse).toBeDefined();
      }
    });

    it('uses default maxIterations when not specified', async () => {
      const input: UncertaintyReductionInput = {
        query: 'Test query',
        currentResponse: 'Test response',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Test'),
      };

      const result = await iterateUntilTarget(input);

      expect(result.iterationsUsed).toBeLessThanOrEqual(5); // Default max
    });

    it('uses default targetConfidence when not specified', async () => {
      const input: UncertaintyReductionInput = {
        query: 'Test query',
        currentResponse: 'Test response',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Test'),
      };

      const result = await iterateUntilTarget(input);

      // Should use reasonable default target (e.g., 0.7)
      expect(result).toBeDefined();
    });
  });

  // ============================================================================
  // DEFEATER INTEGRATION
  // ============================================================================

  describe('mapDefeaterToUncertaintySource', () => {
    it('maps staleness defeater to stale_data', () => {
      const defeater: ExtendedDefeater = {
        id: 'def-1',
        type: 'staleness',
        description: 'Data is 7 days old',
        severity: 'warning',
        affectedClaimIds: [createClaimId('claim-1')],
        confidenceReduction: 0.2,
        autoResolvable: true,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      const source = mapDefeaterToUncertaintySource(defeater);

      expect(source.type).toBe('stale_data');
      expect(source.reducible).toBe(true);
    });

    it('maps code_change defeater to missing_context', () => {
      const defeater: ExtendedDefeater = {
        id: 'def-2',
        type: 'code_change',
        description: 'File was modified',
        severity: 'partial',
        affectedClaimIds: [createClaimId('claim-2')],
        confidenceReduction: 0.3,
        autoResolvable: true,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      const source = mapDefeaterToUncertaintySource(defeater);

      expect(source.type).toBe('missing_context');
    });

    it('maps contradiction defeater to conflicting_sources', () => {
      const defeater: ExtendedDefeater = {
        id: 'def-3',
        type: 'contradiction',
        description: 'Conflicting claims detected',
        severity: 'full',
        affectedClaimIds: [createClaimId('claim-3'), createClaimId('claim-4')],
        confidenceReduction: 0.5,
        autoResolvable: false,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      const source = mapDefeaterToUncertaintySource(defeater);

      expect(source.type).toBe('conflicting_sources');
      expect(source.reducible).toBe(true); // Can be resolved through verification
    });

    it('maps coverage_gap defeater to limited_coverage', () => {
      const defeater: ExtendedDefeater = {
        id: 'def-4',
        type: 'coverage_gap',
        description: 'Insufficient test coverage',
        severity: 'warning',
        affectedClaimIds: [createClaimId('claim-5')],
        confidenceReduction: 0.15,
        autoResolvable: false,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      const source = mapDefeaterToUncertaintySource(defeater);

      expect(source.type).toBe('limited_coverage');
    });

    it('preserves affected claims from defeater', () => {
      const defeater: ExtendedDefeater = {
        id: 'def-5',
        type: 'staleness',
        description: 'Old data',
        severity: 'warning',
        affectedClaimIds: [createClaimId('claim-a'), createClaimId('claim-b'), createClaimId('claim-c')],
        confidenceReduction: 0.1,
        autoResolvable: true,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      const source = mapDefeaterToUncertaintySource(defeater);

      expect(source.affectedClaims).toEqual([createClaimId('claim-a'), createClaimId('claim-b'), createClaimId('claim-c')]);
    });
  });

  // ============================================================================
  // TEMPLATE INTEGRATION
  // ============================================================================

  describe('createUncertaintyReductionTemplate', () => {
    it('creates a template with correct T12 identifier', () => {
      const template = createUncertaintyReductionTemplate();

      expect(template.id).toBe('T12');
      expect(template.name).toBe('UncertaintyReduction');
    });

    it('declares correct supported UCs', () => {
      const template = createUncertaintyReductionTemplate();

      expect(template.supportedUcs).toContain('UC-241');
      expect(template.supportedUcs).toContain('UC-251');
    });

    it('declares optional maps for gap and adequacy', () => {
      const template = createUncertaintyReductionTemplate();

      expect(template.optionalMaps).toContain('GapModel');
      expect(template.optionalMaps).toContain('AdequacyReport');
    });

    it('declares correct output envelope', () => {
      const template = createUncertaintyReductionTemplate();

      expect(template.outputEnvelope.packTypes).toContain('NextQuestionPack');
      expect(template.outputEnvelope.requiresAdequacy).toBe(true);
    });
  });

  describe('UncertaintyReductionTemplate execute', () => {
    it('produces UncertaintyReductionOutput with required fields', async () => {
      const template = createUncertaintyReductionTemplate();
      const result = await template.execute({
        intent: 'Reduce uncertainty about authentication module',
        workspace: '/test/repo',
        depth: 'medium',
      });

      expect(result.success).toBe(true);
      expect(result.packs.length).toBeGreaterThan(0);
    });

    it('includes confidence value in output', async () => {
      const template = createUncertaintyReductionTemplate();
      const result = await template.execute({
        intent: 'Clarify the purpose of the service layer',
        workspace: '/test/repo',
      });

      expect(result.packs[0].confidence).toBeGreaterThanOrEqual(0);
    });

    it('emits evidence for template selection', async () => {
      const template = createUncertaintyReductionTemplate();
      const result = await template.execute({
        intent: 'Reduce uncertainty',
        workspace: '/test/repo',
      });

      expect(result.evidence).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].templateId).toBe('T12');
    });

    it('includes disclosures for limitations', async () => {
      const template = createUncertaintyReductionTemplate();
      const result = await template.execute({
        intent: 'Impossible certainty',
        workspace: '/test/repo',
      });

      expect(result.disclosures).toBeDefined();
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty response gracefully', () => {
      const response = '';
      const confidence: ConfidenceValue = absent('insufficient_data');

      const sources = identifyUncertaintySources(response, confidence);

      expect(sources.length).toBeGreaterThan(0);
    });

    it('handles very high initial confidence', () => {
      const sources: UncertaintySource[] = [];

      const steps = planReductionSteps(sources);

      expect(steps).toHaveLength(0);
    });

    it('handles measured confidence with narrow interval', () => {
      const response = 'The function is well-documented.';
      const confidence: ConfidenceValue = measuredConfidence({
        datasetId: 'test-dataset',
        sampleSize: 100,
        accuracy: 0.95,
        ci95: [0.93, 0.97],
      });

      const sources = identifyUncertaintySources(response, confidence);

      // High measured confidence should have few/no uncertainty sources
      expect(sources.length).toBe(0);
    });

    it('handles multiple overlapping uncertainty sources', () => {
      const response =
        'Based on old docs (might be outdated), the function may return X or Y (conflicting info).';
      const confidence: ConfidenceValue = bounded(0.2, 0.5, 'theoretical', 'Multiple issues');

      const sources = identifyUncertaintySources(response, confidence);

      // Should identify multiple sources
      expect(sources.length).toBeGreaterThan(1);

      // Should not have duplicates by ID
      const ids = sources.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('handles zero iterations gracefully', async () => {
      const input: UncertaintyReductionInput = {
        query: 'Test',
        currentResponse: 'Response',
        currentConfidence: deterministic(true, 'certain'),
        maxIterations: 0,
      };

      const result = await iterateUntilTarget(input);

      expect(result.iterationsUsed).toBe(0);
      expect(result.originalConfidence).toBe(result.finalConfidence);
    });
  });

  // ============================================================================
  // OUTPUT STRUCTURE
  // ============================================================================

  describe('UncertaintyReductionOutput structure', () => {
    it('includes all required fields', async () => {
      const input: UncertaintyReductionInput = {
        query: 'How does the system handle errors?',
        currentResponse: 'Errors are logged and retried.',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Partial understanding'),
        maxIterations: 2,
      };

      const result = await iterateUntilTarget(input);

      expect(result.originalConfidence).toBeDefined();
      expect(result.finalConfidence).toBeDefined();
      expect(result.uncertaintySources).toBeDefined();
      expect(result.reductionSteps).toBeDefined();
      expect(result.iterationsUsed).toBeDefined();
      expect(result.unreducibleUncertainty).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('tracks confidence as ConfidenceValue type', async () => {
      const input: UncertaintyReductionInput = {
        query: 'Test',
        currentResponse: 'Response',
        currentConfidence: bounded(0.4, 0.6, 'theoretical', 'Test'),
        maxIterations: 1,
      };

      const result = await iterateUntilTarget(input);

      expect(result.confidence).toBeDefined();
      expect(['deterministic', 'derived', 'measured', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });
  });
});
