/**
 * @fileoverview Synthesis metric tests for eval runner.
 */

import { describe, it, expect } from 'vitest';
import { computeSynthesisMetrics } from '../synthesis_metrics.js';

describe('computeSynthesisMetrics', () => {
  it('computes fact precision/recall and hallucination rate', () => {
    const result = computeSynthesisMetrics({
      answer: 'Creates user. Writes to db. Deletes accounts.',
      claims: ['Creates user', 'Writes to db', 'Deletes accounts'],
      mustIncludeFacts: ['creates user', 'writes to db'],
      mustNotClaim: ['deletes accounts'],
      summary: 'Creates user and writes to db',
    });

    expect(result.factRecall).toBe(1);
    expect(result.factPrecision).toBeCloseTo(2 / 3, 5);
    expect(result.hallucinationCount).toBe(1);
    expect(result.hallucinationRate).toBe(1);
    expect(result.missingFacts).toHaveLength(0);
    expect(result.falseClaims).toEqual(['deletes accounts']);
  });

  it('uses acceptable variations for summary accuracy and behavioral accuracy', () => {
    const result = computeSynthesisMetrics({
      answer: 'Alt summary is valid.',
      claims: ['Alt summary is valid'],
      mustIncludeFacts: ['alt summary'],
      summary: 'Primary summary',
      acceptableVariations: ['Alt summary is valid'],
      category: 'behavioral',
    });

    expect(result.summaryAccuracy).toBe(1);
    expect(result.behavioralAccuracy).toBe(1);
  });

  it('computes grounding rate scaffolding and structural accuracy', () => {
    const result = computeSynthesisMetrics({
      answer: 'Loads module. Exports helper.',
      claims: ['Loads module', 'Exports helper'],
      citations: ['ref-1'],
      mustIncludeFacts: ['loads module', 'exports helper', 'handles errors'],
      category: 'structural',
      citationVerification: {
        verifiedCitations: 1,
        verifiableCitations: 2,
      },
    });

    expect(result.factRecall).toBeCloseTo(2 / 3, 5);
    expect(result.structuralAccuracy).toBeCloseTo(2 / 3, 5);
    expect(result.groundingRate).toBeCloseTo(0.5, 5);
    expect(result.fabricationRate).toBeCloseTo(0.5, 5);
  });
});
