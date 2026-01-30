/**
 * @fileoverview Tests for Intuitive Grounding System
 *
 * Comprehensive test suite for the intuitive grounding module, covering:
 * - IntuitiveGrounding creation and validation
 * - Upgrade path mechanics
 * - Pattern recognition helpers
 * - Analogy-based reasoning
 * - Confidence handling
 * - Articulability tracking
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  // Types
  type IntuitiveGrounding,
  type IntuitiveSource,
  type Articulability,
  type UpgradePath,
  type Evidence,
  // Factory functions
  createIntuitiveGrounding,
  getDefaultConfidence,
  // Upgrade functions
  canUpgrade,
  findBestUpgradePath,
  upgradeGrounding,
  // Articulability functions
  isArticulable,
  getArticulabilityScore,
  // Pattern recognition
  detectPattern,
  analogyFromPrior,
  // Confidence
  toConfidenceValue,
  // Type guards
  isIntuitiveGrounding,
  isIntuitiveSource,
  isArticulability,
  // Validation
  validateIntuitiveGrounding,
  // Constants
  DEFAULT_INTUITIVE_CONFIDENCE,
  INTUITIVE_CONFIDENCE_BOUNDS,
  DEFAULT_UPGRADE_PATHS,
} from '../intuitive_grounding.js';
import {
  createObjectId,
  constructContent,
  type ObjectId,
  type Grounding,
} from '../universal_coherence.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestObjectIds(): { from: ObjectId; to: ObjectId } {
  return {
    from: createObjectId('from'),
    to: createObjectId('to'),
  };
}

function createTestEvidence(types: string[]): Evidence[] {
  return types.map((type, i) => ({
    id: `evidence_${i}`,
    type,
    description: `Test evidence for ${type}`,
    strength: 0.7 + i * 0.05,
  }));
}

// ============================================================================
// 1. INTUITIVE GROUNDING CREATION TESTS
// ============================================================================

describe('IntuitiveGrounding Creation', () => {
  const sources: IntuitiveSource[] = [
    'pattern_recognition',
    'heuristic',
    'experience',
    'analogy',
    'gestalt',
  ];

  describe('createIntuitiveGrounding', () => {
    it.each(sources)('creates grounding with source: %s', (source) => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, source);

      expect(grounding.type).toBe('intuitive');
      expect(grounding.source).toBe(source);
      expect(grounding.from).toBe(from);
      expect(grounding.to).toBe(to);
      expect(grounding.active).toBe(true);
      expect(grounding.upgradePaths).toBeDefined();
      expect(grounding.upgradePaths.length).toBeGreaterThan(0);
    });

    it('assigns default confidence based on source', () => {
      const { from, to } = createTestObjectIds();

      for (const source of sources) {
        const grounding = createIntuitiveGrounding(from, to, source);
        expect(grounding.strength.value).toBe(DEFAULT_INTUITIVE_CONFIDENCE[source]);
      }
    });

    it('accepts custom confidence strength', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        strength: { value: 0.75, basis: 'measured' },
      });

      expect(grounding.strength.value).toBe(0.75);
      expect(grounding.strength.basis).toBe('measured');
    });

    it('accepts custom articulability', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'gestalt', {
        articulability: 'explicit',
      });

      expect(grounding.articulability).toBe('explicit');
    });

    it('accepts custom basis description', () => {
      const { from, to } = createTestObjectIds();
      const basis = '15 years of software architecture experience';
      const grounding = createIntuitiveGrounding(from, to, 'experience', { basis });

      expect(grounding.basis).toBe(basis);
    });

    it('accepts expertise level', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        expertiseLevel: 20,
      });

      expect(grounding.expertiseLevel).toBe(20);
    });

    it('accepts calibration data', () => {
      const { from, to } = createTestObjectIds();
      const calibrationData = {
        totalPredictions: 100,
        correctPredictions: 75,
        domain: 'code_review',
      };
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        calibrationData,
      });

      expect(grounding.calibrationData).toEqual(calibrationData);
    });

    it('accepts custom upgrade paths', () => {
      const { from, to } = createTestObjectIds();
      const customPaths: UpgradePath[] = [
        {
          targetType: 'evidential',
          requiredEvidence: ['custom_evidence'],
          confidenceBoost: 0.3,
        },
      ];
      const grounding = createIntuitiveGrounding(from, to, 'heuristic', {
        upgradePaths: customPaths,
      });

      expect(grounding.upgradePaths).toEqual(customPaths);
    });

    it('generates unique grounding IDs', () => {
      const { from, to } = createTestObjectIds();
      const grounding1 = createIntuitiveGrounding(from, to, 'heuristic');
      const grounding2 = createIntuitiveGrounding(from, to, 'heuristic');

      expect(grounding1.id).not.toBe(grounding2.id);
    });
  });

  describe('getDefaultConfidence', () => {
    it('returns expected values for each source', () => {
      expect(getDefaultConfidence('pattern_recognition')).toBe(0.55);
      expect(getDefaultConfidence('heuristic')).toBe(0.50);
      expect(getDefaultConfidence('experience')).toBe(0.60);
      expect(getDefaultConfidence('analogy')).toBe(0.45);
      expect(getDefaultConfidence('gestalt')).toBe(0.40);
    });

    it('all values are within bounds', () => {
      for (const source of sources) {
        const confidence = getDefaultConfidence(source);
        expect(confidence).toBeGreaterThanOrEqual(INTUITIVE_CONFIDENCE_BOUNDS.min);
        expect(confidence).toBeLessThanOrEqual(INTUITIVE_CONFIDENCE_BOUNDS.max);
      }
    });
  });
});

// ============================================================================
// 2. ARTICULABILITY TESTS
// ============================================================================

describe('Articulability', () => {
  describe('isArticulable', () => {
    it('returns true for explicit articulability', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic', {
        articulability: 'explicit',
      });
      expect(isArticulable(grounding)).toBe(true);
    });

    it('returns true for tacit articulability', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        articulability: 'tacit',
      });
      expect(isArticulable(grounding)).toBe(true);
    });

    it('returns false for ineffable articulability', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'gestalt', {
        articulability: 'ineffable',
      });
      expect(isArticulable(grounding)).toBe(false);
    });
  });

  describe('getArticulabilityScore', () => {
    it('returns 1.0 for explicit', () => {
      expect(getArticulabilityScore('explicit')).toBe(1.0);
    });

    it('returns 0.5 for tacit', () => {
      expect(getArticulabilityScore('tacit')).toBe(0.5);
    });

    it('returns 0.0 for ineffable', () => {
      expect(getArticulabilityScore('ineffable')).toBe(0.0);
    });
  });

  describe('default articulability by source', () => {
    it('pattern_recognition defaults to tacit', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition');
      expect(grounding.articulability).toBe('tacit');
    });

    it('heuristic defaults to explicit', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic');
      expect(grounding.articulability).toBe('explicit');
    });

    it('experience defaults to tacit', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      expect(grounding.articulability).toBe('tacit');
    });

    it('analogy defaults to explicit', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'analogy');
      expect(grounding.articulability).toBe('explicit');
    });

    it('gestalt defaults to ineffable', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'gestalt');
      expect(grounding.articulability).toBe('ineffable');
    });
  });
});

// ============================================================================
// 3. UPGRADE PATH TESTS
// ============================================================================

describe('Upgrade Paths', () => {
  describe('DEFAULT_UPGRADE_PATHS', () => {
    it('provides paths for all source types', () => {
      const sources: IntuitiveSource[] = [
        'pattern_recognition',
        'heuristic',
        'experience',
        'analogy',
        'gestalt',
      ];

      for (const source of sources) {
        expect(DEFAULT_UPGRADE_PATHS[source]).toBeDefined();
        expect(DEFAULT_UPGRADE_PATHS[source].length).toBeGreaterThan(0);
      }
    });

    it('all paths have required fields', () => {
      for (const paths of Object.values(DEFAULT_UPGRADE_PATHS)) {
        for (const path of paths) {
          expect(path.targetType).toBeDefined();
          expect(path.requiredEvidence).toBeDefined();
          expect(path.requiredEvidence.length).toBeGreaterThan(0);
          expect(path.confidenceBoost).toBeGreaterThan(0);
          expect(path.confidenceBoost).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe('canUpgrade', () => {
    it('returns true when all evidence is available', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition');
      const evidence = ['historical_data', 'pattern_validation'];

      expect(canUpgrade(grounding, evidence)).toBe(true);
    });

    it('returns false when evidence is incomplete', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition');
      const evidence = ['historical_data']; // Missing pattern_validation

      expect(canUpgrade(grounding, evidence)).toBe(false);
    });

    it('returns false when no evidence provided', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic');

      expect(canUpgrade(grounding, [])).toBe(false);
    });

    it('returns true when any upgrade path can be completed', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      // This matches the testimonial upgrade path
      const evidence = ['documented_experience', 'peer_validation'];

      expect(canUpgrade(grounding, evidence)).toBe(true);
    });
  });

  describe('findBestUpgradePath', () => {
    it('returns path with highest confidence boost', () => {
      const { from, to } = createTestObjectIds();
      const customPaths: UpgradePath[] = [
        {
          targetType: 'evidential',
          requiredEvidence: ['evidence_a'],
          confidenceBoost: 0.1,
        },
        {
          targetType: 'inferential',
          requiredEvidence: ['evidence_b'],
          confidenceBoost: 0.3,
        },
      ];
      const grounding = createIntuitiveGrounding(from, to, 'heuristic', {
        upgradePaths: customPaths,
      });
      const evidence = createTestEvidence(['evidence_a', 'evidence_b']);

      const bestPath = findBestUpgradePath(grounding, evidence);
      expect(bestPath).not.toBeNull();
      expect(bestPath?.targetType).toBe('inferential');
      expect(bestPath?.confidenceBoost).toBe(0.3);
    });

    it('returns null when no path can be completed', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic');
      const evidence = createTestEvidence(['unrelated_evidence']);

      const bestPath = findBestUpgradePath(grounding, evidence);
      expect(bestPath).toBeNull();
    });

    it('considers only paths with complete evidence', () => {
      const { from, to } = createTestObjectIds();
      const customPaths: UpgradePath[] = [
        {
          targetType: 'evidential',
          requiredEvidence: ['a', 'b', 'c'],
          confidenceBoost: 0.5, // High boost but incomplete
        },
        {
          targetType: 'inferential',
          requiredEvidence: ['a'],
          confidenceBoost: 0.1, // Lower boost but complete
        },
      ];
      const grounding = createIntuitiveGrounding(from, to, 'heuristic', {
        upgradePaths: customPaths,
      });
      const evidence = createTestEvidence(['a']);

      const bestPath = findBestUpgradePath(grounding, evidence);
      expect(bestPath?.targetType).toBe('inferential');
    });
  });

  describe('upgradeGrounding', () => {
    it('upgrades to target type with boosted confidence', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition', {
        strength: { value: 0.5, basis: 'estimated' },
      });
      const evidence = createTestEvidence(['historical_data', 'pattern_validation']);

      const upgraded = upgradeGrounding(grounding, evidence);

      expect(upgraded.type).toBe('evidential');
      expect(upgraded.strength.value).toBeGreaterThan(grounding.strength.value);
      expect(upgraded.strength.basis).toBe('derived');
    });

    it('throws error when evidence is insufficient', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic');
      const evidence = createTestEvidence(['wrong_evidence']);

      expect(() => upgradeGrounding(grounding, evidence)).toThrow(
        /Cannot upgrade intuitive grounding/
      );
    });

    it('includes explanation of upgrade source', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      const evidence = createTestEvidence(['documented_experience', 'peer_validation']);

      const upgraded = upgradeGrounding(grounding, evidence);

      expect(upgraded.explanation).toContain('Upgraded from intuitive');
      expect(upgraded.explanation).toContain('experience');
    });

    it('confidence boost scales with evidence strength', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition', {
        strength: { value: 0.5, basis: 'estimated' },
      });

      // Weak evidence
      const weakEvidence = [
        { id: 'e1', type: 'historical_data', description: '', strength: 0.3 },
        { id: 'e2', type: 'pattern_validation', description: '', strength: 0.3 },
      ];
      const weakUpgraded = upgradeGrounding(grounding, weakEvidence);

      // Strong evidence
      const strongEvidence = [
        { id: 'e1', type: 'historical_data', description: '', strength: 0.9 },
        { id: 'e2', type: 'pattern_validation', description: '', strength: 0.9 },
      ];
      const strongUpgraded = upgradeGrounding(grounding, strongEvidence);

      expect(strongUpgraded.strength.value).toBeGreaterThan(weakUpgraded.strength.value);
    });

    it('caps confidence at 1.0', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition', {
        strength: { value: 0.9, basis: 'estimated' },
      });
      const evidence = [
        { id: 'e1', type: 'historical_data', description: '', strength: 1.0 },
        { id: 'e2', type: 'pattern_validation', description: '', strength: 1.0 },
      ];

      const upgraded = upgradeGrounding(grounding, evidence);

      expect(upgraded.strength.value).toBeLessThanOrEqual(1.0);
    });
  });
});

// ============================================================================
// 4. PATTERN RECOGNITION TESTS
// ============================================================================

describe('Pattern Recognition', () => {
  describe('detectPattern', () => {
    it('returns null for insufficient observations', () => {
      const observations = [
        constructContent('Observation 1'),
        constructContent('Observation 2'),
      ];

      const result = detectPattern(observations, { minOccurrences: 3 });
      expect(result).toBeNull();
    });

    it('detects pattern from recurring content types', () => {
      const observations = [
        constructContent('First propositional statement'),
        constructContent('Second propositional statement'),
        constructContent('Third propositional statement'),
        constructContent('Fourth propositional statement'),
      ];

      const result = detectPattern(observations);

      expect(result).not.toBeNull();
      expect(result?.source).toBe('pattern_recognition');
    });

    it('detects pattern from recurring terms', () => {
      const observations = [
        constructContent('Error in authentication module'),
        constructContent('Error in authorization module'),
        constructContent('Error in session module'),
        constructContent('Error in token module'),
      ];

      const result = detectPattern(observations, { minOccurrences: 3 });

      expect(result).not.toBeNull();
      expect(result?.basis).toContain('error');
    });

    it('respects confidence threshold', () => {
      const observations = [
        constructContent('Test observation'),
        constructContent('Test observation'),
        constructContent('Test observation'),
      ];

      const result = detectPattern(observations, { confidenceThreshold: 0.6 });

      if (result) {
        expect(result.strength.value).toBeGreaterThanOrEqual(0.6);
      }
    });

    it('returns grounding with pattern_recognition source', () => {
      const observations = [
        constructContent('Pattern A found'),
        constructContent('Pattern A detected'),
        constructContent('Pattern A observed'),
      ];

      const result = detectPattern(observations);

      expect(result?.source).toBe('pattern_recognition');
      expect(result?.type).toBe('intuitive');
    });

    it('returns null when no pattern found', () => {
      const observations = [
        constructContent('Random text one', 'propositional'),
        constructContent({ data: 123 }, 'structured'),
        constructContent('Do something', 'imperative'),
        constructContent('Is this true?', 'interrogative'),
      ];

      const result = detectPattern(observations, { minOccurrences: 3 });
      expect(result).toBeNull();
    });
  });

  describe('analogyFromPrior', () => {
    it('returns null when no priors provided', () => {
      const current = constructContent('Current case');

      const result = analogyFromPrior(current, []);
      expect(result).toBeNull();
    });

    it('returns null when similarity is too low', () => {
      const current = constructContent('Completely different content');
      const priors = [
        constructContent('Unrelated prior case xyz'),
        constructContent('Another unrelated abc'),
      ];

      const result = analogyFromPrior(current, priors, { similarityThreshold: 0.9 });
      expect(result).toBeNull();
    });

    it('finds analogy for similar content', () => {
      const current = constructContent('Deploy microservice to production');
      const priors = [
        constructContent('Deploy microservice to staging'),
        constructContent('Deploy service to production'),
      ];

      const result = analogyFromPrior(current, priors, { similarityThreshold: 0.3 });

      expect(result).not.toBeNull();
      expect(result?.source).toBe('analogy');
    });

    it('returns analogy source type', () => {
      const current = constructContent('Test case A');
      const priors = [constructContent('Test case A similar')];

      const result = analogyFromPrior(current, priors, { similarityThreshold: 0.2 });

      expect(result?.source).toBe('analogy');
      expect(result?.type).toBe('intuitive');
    });

    it('respects maxAnalogies parameter', () => {
      const current = constructContent('Deploy service');
      const priors = [
        constructContent('Deploy service one'),
        constructContent('Deploy service two'),
        constructContent('Deploy service three'),
        constructContent('Deploy service four'),
      ];

      const result = analogyFromPrior(current, priors, {
        similarityThreshold: 0.2,
        maxAnalogies: 2,
      });

      // Result should be based on top 2 matches
      expect(result).not.toBeNull();
      expect(result?.basis).toContain('2 similar prior case');
    });

    it('includes similarity score in basis', () => {
      const current = constructContent('Similar content here');
      const priors = [constructContent('Similar content there')];

      const result = analogyFromPrior(current, priors, { similarityThreshold: 0.2 });

      expect(result?.basis).toContain('similarity');
    });
  });
});

// ============================================================================
// 5. CONFIDENCE HANDLING TESTS
// ============================================================================

describe('Confidence Handling', () => {
  describe('toConfidenceValue', () => {
    it('returns bounded confidence for uncalibrated grounding', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');

      const confidence = toConfidenceValue(grounding);

      expect(confidence.type).toBe('bounded');
      if (confidence.type === 'bounded') {
        expect(confidence.low).toBeLessThan(confidence.high);
        expect(confidence.basis).toBe('theoretical');
      }
    });

    it('narrows bounds for calibrated grounding', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        calibrationData: {
          totalPredictions: 100,
          correctPredictions: 75,
          domain: 'code_review',
        },
      });

      const confidence = toConfidenceValue(grounding);

      expect(confidence.type).toBe('bounded');
      if (confidence.type === 'bounded') {
        expect(confidence.basis).toBe('literature');
        expect(confidence.citation).toContain('100 predictions');
      }
    });

    it('widens bounds for ineffable articulability', () => {
      const { from, to } = createTestObjectIds();
      const explicitGrounding = createIntuitiveGrounding(from, to, 'heuristic', {
        articulability: 'explicit',
        strength: { value: 0.5, basis: 'estimated' },
      });
      const ineffableGrounding = createIntuitiveGrounding(from, to, 'gestalt', {
        articulability: 'ineffable',
        strength: { value: 0.5, basis: 'estimated' },
      });

      const explicitConf = toConfidenceValue(explicitGrounding);
      const ineffableConf = toConfidenceValue(ineffableGrounding);

      if (explicitConf.type === 'bounded' && ineffableConf.type === 'bounded') {
        const explicitRange = explicitConf.high - explicitConf.low;
        const ineffableRange = ineffableConf.high - ineffableConf.low;
        expect(ineffableRange).toBeGreaterThan(explicitRange);
      }
    });

    it('includes source in citation', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition', {
        basis: 'Recurring code smell patterns',
      });

      const confidence = toConfidenceValue(grounding);

      if (confidence.type === 'bounded') {
        expect(confidence.citation).toContain('pattern_recognition');
      }
    });
  });

  describe('confidence bounds', () => {
    it('INTUITIVE_CONFIDENCE_BOUNDS are valid', () => {
      expect(INTUITIVE_CONFIDENCE_BOUNDS.min).toBeGreaterThanOrEqual(0);
      expect(INTUITIVE_CONFIDENCE_BOUNDS.max).toBeLessThanOrEqual(1);
      expect(INTUITIVE_CONFIDENCE_BOUNDS.min).toBeLessThan(INTUITIVE_CONFIDENCE_BOUNDS.max);
      expect(INTUITIVE_CONFIDENCE_BOUNDS.defaultLow).toBeGreaterThanOrEqual(
        INTUITIVE_CONFIDENCE_BOUNDS.min
      );
      expect(INTUITIVE_CONFIDENCE_BOUNDS.defaultHigh).toBeLessThanOrEqual(
        INTUITIVE_CONFIDENCE_BOUNDS.max
      );
    });
  });
});

// ============================================================================
// 6. TYPE GUARD TESTS
// ============================================================================

describe('Type Guards', () => {
  describe('isIntuitiveGrounding', () => {
    it('returns true for intuitive groundings', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'heuristic');

      expect(isIntuitiveGrounding(grounding)).toBe(true);
    });

    it('returns false for non-intuitive groundings', () => {
      const from = createObjectId('from');
      const to = createObjectId('to');
      // A regular grounding without intuitive-specific fields
      const regularGrounding: Grounding = {
        id: 'test_grounding' as any,
        from,
        to,
        type: 'evidential',
        strength: { value: 0.8, basis: 'measured' },
        active: true,
      };

      // Cast to the union type that isIntuitiveGrounding accepts
      expect(isIntuitiveGrounding(regularGrounding as Grounding | IntuitiveGrounding)).toBe(false);
    });
  });

  describe('isIntuitiveSource', () => {
    it('returns true for valid sources', () => {
      expect(isIntuitiveSource('pattern_recognition')).toBe(true);
      expect(isIntuitiveSource('heuristic')).toBe(true);
      expect(isIntuitiveSource('experience')).toBe(true);
      expect(isIntuitiveSource('analogy')).toBe(true);
      expect(isIntuitiveSource('gestalt')).toBe(true);
    });

    it('returns false for invalid sources', () => {
      expect(isIntuitiveSource('invalid')).toBe(false);
      expect(isIntuitiveSource('')).toBe(false);
      expect(isIntuitiveSource(null)).toBe(false);
      expect(isIntuitiveSource(undefined)).toBe(false);
      expect(isIntuitiveSource(123)).toBe(false);
    });
  });

  describe('isArticulability', () => {
    it('returns true for valid articulability values', () => {
      expect(isArticulability('explicit')).toBe(true);
      expect(isArticulability('tacit')).toBe(true);
      expect(isArticulability('ineffable')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isArticulability('invalid')).toBe(false);
      expect(isArticulability('')).toBe(false);
      expect(isArticulability(null)).toBe(false);
    });
  });
});

// ============================================================================
// 7. VALIDATION TESTS
// ============================================================================

describe('Validation', () => {
  describe('validateIntuitiveGrounding', () => {
    it('returns empty array for valid grounding', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');

      const errors = validateIntuitiveGrounding(grounding);
      expect(errors).toHaveLength(0);
    });

    it('detects invalid type', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      const invalidGrounding = { ...grounding, type: 'evidential' } as unknown as IntuitiveGrounding;

      const errors = validateIntuitiveGrounding(invalidGrounding);
      expect(errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('detects invalid source', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      const invalidGrounding = { ...grounding, source: 'invalid' } as unknown as IntuitiveGrounding;

      const errors = validateIntuitiveGrounding(invalidGrounding);
      expect(errors.some((e) => e.includes('source'))).toBe(true);
    });

    it('detects invalid articulability', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      const invalidGrounding = {
        ...grounding,
        articulability: 'invalid',
      } as unknown as IntuitiveGrounding;

      const errors = validateIntuitiveGrounding(invalidGrounding);
      expect(errors.some((e) => e.includes('articulability'))).toBe(true);
    });

    it('detects out-of-bounds confidence', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience');
      const invalidGrounding = {
        ...grounding,
        strength: { value: 1.5, basis: 'estimated' },
      } as IntuitiveGrounding;

      const errors = validateIntuitiveGrounding(invalidGrounding);
      expect(errors.some((e) => e.includes('Confidence'))).toBe(true);
    });

    it('warns about high confidence for intuitive grounding', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        strength: { value: 0.95, basis: 'estimated' },
      });

      const errors = validateIntuitiveGrounding(grounding);
      expect(errors.some((e) => e.includes('exceeds typical'))).toBe(true);
    });

    it('detects invalid upgrade path confidence boost', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        upgradePaths: [
          {
            targetType: 'evidential',
            requiredEvidence: ['evidence'],
            confidenceBoost: 1.5, // Invalid
          },
        ],
      });

      const errors = validateIntuitiveGrounding(grounding);
      expect(errors.some((e) => e.includes('confidence boost'))).toBe(true);
    });

    it('detects empty required evidence in upgrade path', () => {
      const { from, to } = createTestObjectIds();
      const grounding = createIntuitiveGrounding(from, to, 'experience', {
        upgradePaths: [
          {
            targetType: 'evidential',
            requiredEvidence: [], // Invalid
            confidenceBoost: 0.2,
          },
        ],
      });

      const errors = validateIntuitiveGrounding(grounding);
      expect(errors.some((e) => e.includes('no required evidence'))).toBe(true);
    });
  });
});

// ============================================================================
// 8. INTEGRATION TESTS
// ============================================================================

describe('Integration Tests', () => {
  it('complete workflow: create, detect upgrade, and upgrade', () => {
    // 1. Create an intuitive grounding based on pattern recognition
    const { from, to } = createTestObjectIds();
    const intuitiveGrounding = createIntuitiveGrounding(from, to, 'pattern_recognition', {
      basis: 'Recognized recurring bug pattern in authentication code',
      strength: { value: 0.5, basis: 'estimated' },
    });

    // 2. Check initial state
    expect(intuitiveGrounding.type).toBe('intuitive');
    expect(intuitiveGrounding.strength.value).toBe(0.5);

    // 3. Gather evidence
    const evidence = createTestEvidence(['historical_data', 'pattern_validation']);

    // 4. Check if upgrade is possible
    expect(canUpgrade(intuitiveGrounding, evidence.map((e) => e.type))).toBe(true);

    // 5. Perform upgrade
    const upgradedGrounding = upgradeGrounding(intuitiveGrounding, evidence);

    // 6. Verify upgrade
    expect(upgradedGrounding.type).toBe('evidential');
    expect(upgradedGrounding.strength.value).toBeGreaterThan(intuitiveGrounding.strength.value);
  });

  it('pattern detection to intuitive grounding workflow', () => {
    // 1. Create observations
    const observations = [
      constructContent('Bug in user authentication'),
      constructContent('Bug in admin authentication'),
      constructContent('Bug in API authentication'),
      constructContent('Bug in OAuth authentication'),
    ];

    // 2. Detect pattern
    const pattern = detectPattern(observations);

    // 3. Verify pattern was detected
    expect(pattern).not.toBeNull();
    expect(pattern?.source).toBe('pattern_recognition');

    // 4. Convert to confidence value
    const confidence = toConfidenceValue(pattern!);
    expect(confidence.type).toBe('bounded');
  });

  it('analogy-based reasoning workflow', () => {
    // 1. Create current case and priors
    const current = constructContent('New microservice deployment');
    const priors = [
      constructContent('Previous microservice deployment succeeded'),
      constructContent('Another microservice deployment was straightforward'),
    ];

    // 2. Find analogy
    const analogy = analogyFromPrior(current, priors, { similarityThreshold: 0.3 });

    // 3. Verify analogy
    expect(analogy).not.toBeNull();
    expect(analogy?.source).toBe('analogy');
    expect(analogy?.articulability).toBe('explicit');

    // 4. Check upgrade paths
    expect(analogy?.upgradePaths.some((p) => p.targetType === 'explanatory')).toBe(true);
  });

  it('handles the full epistemic lifecycle', () => {
    // 1. Expert makes intuitive judgment
    const { from, to } = createTestObjectIds();
    const expertJudgment = createIntuitiveGrounding(from, to, 'experience', {
      basis: 'Based on 15 years of code review experience',
      expertiseLevel: 15,
      calibrationData: {
        totalPredictions: 50,
        correctPredictions: 40,
        domain: 'code_quality',
      },
    });

    // 2. Validate the grounding
    const errors = validateIntuitiveGrounding(expertJudgment);
    expect(errors).toHaveLength(0);

    // 3. Check articulability
    expect(isArticulable(expertJudgment)).toBe(true); // tacit is articulable

    // 4. Convert to confidence value (with calibration data)
    const confidence = toConfidenceValue(expertJudgment);
    expect(confidence.type).toBe('bounded');

    // 5. Check if upgrade is possible
    const availableEvidence = ['documented_experience', 'peer_validation'];
    expect(canUpgrade(expertJudgment, availableEvidence)).toBe(true);

    // 6. Upgrade with evidence
    const evidence = createTestEvidence(availableEvidence);
    const upgraded = upgradeGrounding(expertJudgment, evidence);
    expect(upgraded.type).toBe('testimonial');
  });
});

// ============================================================================
// 9. EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty upgrade paths', () => {
    const { from, to } = createTestObjectIds();
    const grounding = createIntuitiveGrounding(from, to, 'heuristic', {
      upgradePaths: [],
    });

    expect(canUpgrade(grounding, ['any_evidence'])).toBe(false);
    expect(findBestUpgradePath(grounding, createTestEvidence(['any']))).toBeNull();
  });

  it('handles confidence at boundary values', () => {
    const { from, to } = createTestObjectIds();

    const minConfidence = createIntuitiveGrounding(from, to, 'gestalt', {
      strength: { value: 0, basis: 'estimated' },
    });
    expect(minConfidence.strength.value).toBe(0);

    const maxConfidence = createIntuitiveGrounding(from, to, 'experience', {
      strength: { value: 1, basis: 'measured' },
    });
    expect(maxConfidence.strength.value).toBe(1);
  });

  it('handles empty calibration data', () => {
    const { from, to } = createTestObjectIds();
    const grounding = createIntuitiveGrounding(from, to, 'experience', {
      calibrationData: {
        totalPredictions: 0,
        correctPredictions: 0,
        domain: 'test',
      },
    });

    // Should not throw and should use default confidence bounds
    const confidence = toConfidenceValue(grounding);
    expect(confidence.type).toBe('bounded');
  });

  it('handles very long basis strings', () => {
    const { from, to } = createTestObjectIds();
    const longBasis = 'A'.repeat(10000);
    const grounding = createIntuitiveGrounding(from, to, 'experience', { basis: longBasis });

    expect(grounding.basis).toBe(longBasis);
  });

  it('preserves object IDs through upgrade', () => {
    const { from, to } = createTestObjectIds();
    const grounding = createIntuitiveGrounding(from, to, 'pattern_recognition');
    const evidence = createTestEvidence(['historical_data', 'pattern_validation']);

    const upgraded = upgradeGrounding(grounding, evidence);

    expect(upgraded.from).toBe(from);
    expect(upgraded.to).toBe(to);
  });
});
