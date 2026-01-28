/**
 * @fileoverview Tests for Claim Type Calibration (WU-CALX-005)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The ClaimTypeCalibrator maintains separate calibration curves per claim type,
 * detects when different claim types have different calibration needs, and
 * applies type-specific adjustments to confidence values. This prevents
 * "confidence monism" (one-size-fits-all confidence).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClaimTypeCalibrator,
  createClaimTypeCalibrator,
  type ClaimType,
  type TypeCalibrationData,
  type CalibrationCurve,
  type CalibrationAdjustment,
  type TypeComparisonResult,
} from '../claim_type_calibration.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const structuralClaimType: ClaimType = {
  id: 'structural',
  name: 'Structural Claims',
  description: 'Claims about code structure (function signatures, imports, types)',
  examples: [
    'Function X returns type Y',
    'Class A extends B',
    'File imports X from Y',
  ],
};

const behavioralClaimType: ClaimType = {
  id: 'behavioral',
  name: 'Behavioral Claims',
  description: 'Claims about code behavior and runtime characteristics',
  examples: [
    'Function X calls Y',
    'Method handles errors gracefully',
    'Component triggers event Z',
  ],
};

const factualClaimType: ClaimType = {
  id: 'factual',
  name: 'Factual Claims',
  description: 'Claims about verifiable facts (locations, definitions)',
  examples: [
    'Class is defined in file X',
    'Function is located at line N',
    'Module exports X',
  ],
};

const architecturalClaimType: ClaimType = {
  id: 'architectural',
  name: 'Architectural Claims',
  description: 'Claims about high-level architecture and design patterns',
  examples: [
    'System uses MVC pattern',
    'Component follows singleton pattern',
    'Layer A depends on layer B',
  ],
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createClaimTypeCalibrator', () => {
  it('should create a ClaimTypeCalibrator instance', () => {
    const calibrator = createClaimTypeCalibrator();
    expect(calibrator).toBeInstanceOf(ClaimTypeCalibrator);
  });

  it('should create instance with default options', () => {
    const calibrator = createClaimTypeCalibrator();
    expect(calibrator).toBeDefined();
  });

  it('should create instance with custom minimum samples', () => {
    const calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 50 });
    expect(calibrator).toBeDefined();
  });
});

// ============================================================================
// CLAIM TYPE REGISTRATION TESTS
// ============================================================================

describe('ClaimTypeCalibrator - registerClaimType', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator();
  });

  it('should register a new claim type', () => {
    calibrator.registerClaimType(structuralClaimType);
    const types = calibrator.getRegisteredTypes();
    expect(types).toContain('structural');
  });

  it('should register multiple claim types', () => {
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
    calibrator.registerClaimType(factualClaimType);

    const types = calibrator.getRegisteredTypes();
    expect(types).toContain('structural');
    expect(types).toContain('behavioral');
    expect(types).toContain('factual');
  });

  it('should update existing claim type on re-registration', () => {
    calibrator.registerClaimType(structuralClaimType);

    const updatedType: ClaimType = {
      ...structuralClaimType,
      description: 'Updated description',
    };
    calibrator.registerClaimType(updatedType);

    const types = calibrator.getRegisteredTypes();
    expect(types.filter((t) => t === 'structural').length).toBe(1);
  });

  it('should initialize empty calibration data for new type', () => {
    calibrator.registerClaimType(structuralClaimType);
    const data = calibrator.getCalibrationData('structural');

    expect(data).toBeDefined();
    expect(data.predictions).toEqual([]);
  });
});

// ============================================================================
// PREDICTION RECORDING TESTS
// ============================================================================

describe('ClaimTypeCalibrator - recordPrediction', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator();
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
  });

  it('should record a single prediction', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    const data = calibrator.getCalibrationData('structural');

    expect(data.predictions.length).toBe(1);
    expect(data.predictions[0].confidence).toBe(0.8);
    expect(data.predictions[0].correct).toBe(true);
  });

  it('should record multiple predictions for same type', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('structural', 0.6, false);
    calibrator.recordPrediction('structural', 0.9, true);

    const data = calibrator.getCalibrationData('structural');
    expect(data.predictions.length).toBe(3);
  });

  it('should record predictions for different types independently', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('behavioral', 0.7, false);

    const structuralData = calibrator.getCalibrationData('structural');
    const behavioralData = calibrator.getCalibrationData('behavioral');

    expect(structuralData.predictions.length).toBe(1);
    expect(behavioralData.predictions.length).toBe(1);
  });

  it('should update lastUpdated timestamp on recording', () => {
    const beforeRecord = new Date();
    calibrator.recordPrediction('structural', 0.8, true);
    const data = calibrator.getCalibrationData('structural');

    expect(data.lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeRecord.getTime());
  });

  it('should throw error for unregistered claim type', () => {
    expect(() => {
      calibrator.recordPrediction('unknown', 0.8, true);
    }).toThrow();
  });

  it('should clamp confidence values to [0, 1]', () => {
    calibrator.recordPrediction('structural', 1.5, true);
    calibrator.recordPrediction('structural', -0.2, false);

    const data = calibrator.getCalibrationData('structural');
    expect(data.predictions[0].confidence).toBeLessThanOrEqual(1);
    expect(data.predictions[1].confidence).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// CALIBRATION CURVE TESTS
// ============================================================================

describe('ClaimTypeCalibrator - getCalibrationCurve', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 5 });
    calibrator.registerClaimType(structuralClaimType);
  });

  it('should return default curve with insufficient data', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('structural', 0.6, false);

    const curve = calibrator.getCalibrationCurve('structural');

    expect(curve).toBeDefined();
    expect(curve.points.length).toBeGreaterThan(0);
  });

  it('should calculate ECE (Expected Calibration Error)', () => {
    // Add enough predictions
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 8); // 80% accuracy at 0.8 confidence
    }

    const curve = calibrator.getCalibrationCurve('structural');

    expect(typeof curve.ece).toBe('number');
    expect(curve.ece).toBeGreaterThanOrEqual(0);
    expect(curve.ece).toBeLessThanOrEqual(1);
  });

  it('should have calibration points with predicted and actual values', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.7, i < 7);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    curve.points.forEach((point) => {
      expect(typeof point.predicted).toBe('number');
      expect(typeof point.actual).toBe('number');
      expect(point.predicted).toBeGreaterThanOrEqual(0);
      expect(point.predicted).toBeLessThanOrEqual(1);
      expect(point.actual).toBeGreaterThanOrEqual(0);
      expect(point.actual).toBeLessThanOrEqual(1);
    });
  });

  it('should provide an adjustment function', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6); // 60% accuracy at 0.8 confidence (overconfident)
    }

    const curve = calibrator.getCalibrationCurve('structural');

    expect(typeof curve.adjustmentFunction).toBe('function');
    const adjusted = curve.adjustmentFunction(0.8);
    expect(typeof adjusted).toBe('number');
    expect(adjusted).toBeGreaterThanOrEqual(0);
    expect(adjusted).toBeLessThanOrEqual(1);
  });

  it('should use isotonic regression for calibration', () => {
    // Create predictions that need isotonic regression
    // Overconfident at high confidence, underconfident at low confidence
    for (let i = 0; i < 20; i++) {
      if (i < 5) {
        calibrator.recordPrediction('structural', 0.3, i < 4); // 80% accurate at 30% confidence
      } else if (i < 10) {
        calibrator.recordPrediction('structural', 0.5, i < 8); // 60% accurate at 50% confidence
      } else if (i < 15) {
        calibrator.recordPrediction('structural', 0.7, i < 12); // 40% accurate at 70% confidence
      } else {
        calibrator.recordPrediction('structural', 0.9, i < 17); // 40% accurate at 90% confidence
      }
    }

    const curve = calibrator.getCalibrationCurve('structural');

    // Isotonic regression should produce monotonically increasing predictions
    for (let i = 1; i < curve.points.length; i++) {
      // The predicted values should be in increasing order (isotonic property)
      expect(curve.points[i].predicted).toBeGreaterThanOrEqual(curve.points[i - 1].predicted);
    }
  });

  it('should throw error for unregistered claim type', () => {
    expect(() => {
      calibrator.getCalibrationCurve('unknown');
    }).toThrow();
  });
});

// ============================================================================
// CONFIDENCE ADJUSTMENT TESTS
// ============================================================================

describe('ClaimTypeCalibrator - adjustConfidence', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 5 });
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
  });

  it('should return adjustment with original and adjusted confidence', () => {
    // Add predictions showing overconfidence
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.9, i < 5); // 50% accuracy at 0.9 confidence
    }

    const adjustment = calibrator.adjustConfidence('structural', 0.9);

    expect(adjustment.claimType).toBe('structural');
    expect(adjustment.originalConfidence).toBe(0.9);
    expect(typeof adjustment.adjustedConfidence).toBe('number');
    expect(adjustment.adjustedConfidence).toBeGreaterThanOrEqual(0);
    expect(adjustment.adjustedConfidence).toBeLessThanOrEqual(1);
  });

  it('should lower confidence for overconfident predictions', () => {
    // Model is overconfident: predicts 90% but only 50% accurate
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.9, i < 10);
    }

    const adjustment = calibrator.adjustConfidence('structural', 0.9);

    expect(adjustment.adjustedConfidence).toBeLessThan(adjustment.originalConfidence);
  });

  it('should raise confidence for underconfident predictions', () => {
    // Model is underconfident: predicts 30% but 80% accurate
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.3, i < 16);
    }

    const adjustment = calibrator.adjustConfidence('structural', 0.3);

    expect(adjustment.adjustedConfidence).toBeGreaterThan(adjustment.originalConfidence);
  });

  it('should include adjustment reason', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const adjustment = calibrator.adjustConfidence('structural', 0.8);

    expect(adjustment.adjustmentReason).toBeDefined();
    expect(adjustment.adjustmentReason.length).toBeGreaterThan(0);
  });

  it('should include curve ECE in adjustment', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const adjustment = calibrator.adjustConfidence('structural', 0.8);

    expect(typeof adjustment.curveECE).toBe('number');
    expect(adjustment.curveECE).toBeGreaterThanOrEqual(0);
    expect(adjustment.curveECE).toBeLessThanOrEqual(1);
  });

  it('should apply different adjustments for different claim types', () => {
    // Structural: overconfident
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.9, i < 10);
    }

    // Behavioral: underconfident
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('behavioral', 0.9, i < 18);
    }

    const structuralAdj = calibrator.adjustConfidence('structural', 0.9);
    const behavioralAdj = calibrator.adjustConfidence('behavioral', 0.9);

    expect(structuralAdj.adjustedConfidence).not.toBe(behavioralAdj.adjustedConfidence);
  });

  it('should return original confidence with insufficient data', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('structural', 0.8, false);

    const adjustment = calibrator.adjustConfidence('structural', 0.8);

    expect(adjustment.adjustedConfidence).toBe(adjustment.originalConfidence);
    expect(adjustment.adjustmentReason.toLowerCase()).toContain('insufficient');
  });

  it('should throw error for unregistered claim type', () => {
    expect(() => {
      calibrator.adjustConfidence('unknown', 0.8);
    }).toThrow();
  });
});

// ============================================================================
// TYPE COMPARISON TESTS
// ============================================================================

describe('ClaimTypeCalibrator - compareCalibration', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 5 });
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
    calibrator.registerClaimType(factualClaimType);
  });

  it('should compare calibration between types', () => {
    // Structural: well-calibrated
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
    }

    // Behavioral: poorly calibrated
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('behavioral', 0.8, i < 8);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.types).toEqual(['structural', 'behavioral']);
    expect(typeof result.significantDifference).toBe('boolean');
    expect(typeof result.pValue).toBe('number');
  });

  it('should identify significant calibration differences', () => {
    // Structural: well-calibrated (80% accurate at 80% confidence)
    for (let i = 0; i < 100; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 80);
    }

    // Behavioral: poorly calibrated (30% accurate at 80% confidence)
    for (let i = 0; i < 100; i++) {
      calibrator.recordPrediction('behavioral', 0.8, i < 30);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.significantDifference).toBe(true);
  });

  it('should identify no significant difference for similar calibrations', () => {
    // Both types have similar calibration
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
      calibrator.recordPrediction('behavioral', 0.8, i < 16);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.significantDifference).toBe(false);
  });

  it('should include p-value from statistical test', () => {
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
      calibrator.recordPrediction('behavioral', 0.8, i < 10);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it('should provide recommendation', () => {
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
      calibrator.recordPrediction('behavioral', 0.8, i < 8);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.recommendation).toBeDefined();
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('should identify worst calibrated type', () => {
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16); // 80% accurate - well calibrated
      calibrator.recordPrediction('behavioral', 0.8, i < 8); // 40% accurate - poorly calibrated
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.worstCalibratedType).toBe('behavioral');
  });

  it('should compare multiple types at once', () => {
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
      calibrator.recordPrediction('behavioral', 0.8, i < 10);
      calibrator.recordPrediction('factual', 0.8, i < 8);
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral', 'factual']);

    expect(result.types.length).toBe(3);
  });

  it('should handle comparison with insufficient data', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('behavioral', 0.8, true);

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    expect(result.recommendation.toLowerCase()).toContain('insufficient');
  });
});

// ============================================================================
// MONISM DETECTION TESTS
// ============================================================================

describe('ClaimTypeCalibrator - detectMonism', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 5 });
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
    calibrator.registerClaimType(factualClaimType);
  });

  it('should detect when monistic approach is being used', () => {
    // Same calibration curve would apply to all types (monistic)
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
      calibrator.recordPrediction('behavioral', 0.8, i < 16);
      calibrator.recordPrediction('factual', 0.8, i < 16);
    }

    const result = calibrator.detectMonism();

    expect(typeof result.isMonistic).toBe('boolean');
    expect(result.recommendation).toBeDefined();
  });

  it('should return isMonistic=true when all types are similar', () => {
    // All types have nearly identical calibration
    for (let i = 0; i < 30; i++) {
      calibrator.recordPrediction('structural', 0.7, i < 21);
      calibrator.recordPrediction('behavioral', 0.7, i < 21);
      calibrator.recordPrediction('factual', 0.7, i < 21);
    }

    const result = calibrator.detectMonism();

    expect(result.isMonistic).toBe(true);
    expect(result.recommendation).toContain('unified');
  });

  it('should return isMonistic=false when types differ significantly', () => {
    // Types have very different calibration needs
    for (let i = 0; i < 30; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 24); // 80% accurate
      calibrator.recordPrediction('behavioral', 0.8, i < 12); // 40% accurate
      calibrator.recordPrediction('factual', 0.8, i < 27); // 90% accurate
    }

    const result = calibrator.detectMonism();

    expect(result.isMonistic).toBe(false);
    expect(result.recommendation).toContain('type-specific');
  });

  it('should provide appropriate recommendation for monistic case', () => {
    for (let i = 0; i < 30; i++) {
      calibrator.recordPrediction('structural', 0.7, i < 21);
      calibrator.recordPrediction('behavioral', 0.7, i < 21);
      calibrator.recordPrediction('factual', 0.7, i < 21);
    }

    const result = calibrator.detectMonism();

    expect(result.recommendation).toBeDefined();
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('should provide appropriate recommendation for non-monistic case', () => {
    for (let i = 0; i < 30; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 24);
      calibrator.recordPrediction('behavioral', 0.8, i < 12);
      calibrator.recordPrediction('factual', 0.8, i < 27);
    }

    const result = calibrator.detectMonism();

    expect(result.recommendation).toBeDefined();
    expect(result.recommendation).toContain('type-specific');
  });

  it('should handle insufficient data gracefully', () => {
    calibrator.recordPrediction('structural', 0.8, true);

    const result = calibrator.detectMonism();

    expect(result.isMonistic).toBe(true); // Default assumption with insufficient data
    expect(result.recommendation.toLowerCase()).toContain('insufficient');
  });
});

// ============================================================================
// CALIBRATION DATA STRUCTURE TESTS
// ============================================================================

describe('TypeCalibrationData Interface', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator();
    calibrator.registerClaimType(structuralClaimType);
  });

  it('should have all required fields', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const data = calibrator.getCalibrationData('structural');

    expect(data.claimType).toBe('structural');
    expect(Array.isArray(data.predictions)).toBe(true);
    expect(data.calibrationCurve).toBeDefined();
    expect(data.lastUpdated).toBeInstanceOf(Date);
  });

  it('should have valid predictions array', () => {
    calibrator.recordPrediction('structural', 0.8, true);
    calibrator.recordPrediction('structural', 0.6, false);

    const data = calibrator.getCalibrationData('structural');

    data.predictions.forEach((pred) => {
      expect(typeof pred.confidence).toBe('number');
      expect(typeof pred.correct).toBe('boolean');
    });
  });
});

// ============================================================================
// CALIBRATION CURVE INTERFACE TESTS
// ============================================================================

describe('CalibrationCurve Interface', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 5 });
    calibrator.registerClaimType(structuralClaimType);
  });

  it('should have all required fields', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    expect(Array.isArray(curve.points)).toBe(true);
    expect(typeof curve.ece).toBe('number');
    expect(typeof curve.adjustmentFunction).toBe('function');
  });

  it('should have valid calibration points', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    curve.points.forEach((point) => {
      expect(typeof point.predicted).toBe('number');
      expect(typeof point.actual).toBe('number');
      expect(point.predicted).toBeGreaterThanOrEqual(0);
      expect(point.predicted).toBeLessThanOrEqual(1);
      expect(point.actual).toBeGreaterThanOrEqual(0);
      expect(point.actual).toBeLessThanOrEqual(1);
    });
  });

  it('should have adjustment function that returns valid values', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    // Test adjustment function at various confidence levels
    [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((conf) => {
      const adjusted = curve.adjustmentFunction(conf);
      expect(adjusted).toBeGreaterThanOrEqual(0);
      expect(adjusted).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ClaimTypeCalibrator - Edge Cases', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator();
    calibrator.registerClaimType(structuralClaimType);
  });

  it('should handle all correct predictions', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.9, true);
    }

    const curve = calibrator.getCalibrationCurve('structural');
    expect(curve.ece).toBeDefined();
  });

  it('should handle all incorrect predictions', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.9, false);
    }

    const curve = calibrator.getCalibrationCurve('structural');
    expect(curve.ece).toBeDefined();
  });

  it('should handle predictions at boundary values', () => {
    calibrator.recordPrediction('structural', 0, false);
    calibrator.recordPrediction('structural', 1, true);
    calibrator.recordPrediction('structural', 0.5, true);

    const data = calibrator.getCalibrationData('structural');
    expect(data.predictions.length).toBe(3);
  });

  it('should handle large number of predictions', () => {
    for (let i = 0; i < 1000; i++) {
      const conf = Math.random();
      const correct = Math.random() < conf;
      calibrator.recordPrediction('structural', conf, correct);
    }

    const curve = calibrator.getCalibrationCurve('structural');
    expect(curve.points.length).toBeGreaterThan(0);
    expect(curve.ece).toBeDefined();
  });

  it('should handle identical predictions', () => {
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.5, true);
    }

    const curve = calibrator.getCalibrationCurve('structural');
    expect(curve.ece).toBeDefined();
  });

  it('should handle comparison with single type', () => {
    for (let i = 0; i < 10; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 6);
    }

    const result = calibrator.compareCalibration(['structural']);

    expect(result.types).toEqual(['structural']);
    expect(result.significantDifference).toBe(false);
  });

  it('should handle comparison with unregistered type gracefully', () => {
    expect(() => {
      calibrator.compareCalibration(['structural', 'unknown']);
    }).toThrow();
  });

  it('should handle empty comparison array', () => {
    const result = calibrator.compareCalibration([]);

    expect(result.types).toEqual([]);
    expect(result.significantDifference).toBe(false);
  });
});

// ============================================================================
// STATISTICAL TESTS
// ============================================================================

describe('ClaimTypeCalibrator - Statistical Properties', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 10 });
    calibrator.registerClaimType(structuralClaimType);
  });

  it('should calculate ECE close to 0 for perfectly calibrated predictions', () => {
    // Add predictions where accuracy matches confidence
    for (let i = 0; i < 100; i++) {
      if (i < 20) calibrator.recordPrediction('structural', 0.2, i < 4);
      else if (i < 40) calibrator.recordPrediction('structural', 0.4, i < 28);
      else if (i < 60) calibrator.recordPrediction('structural', 0.6, i < 52);
      else if (i < 80) calibrator.recordPrediction('structural', 0.8, i < 76);
      else calibrator.recordPrediction('structural', 1.0, true);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    // ECE should be relatively low for well-calibrated predictions
    expect(curve.ece).toBeLessThan(0.2);
  });

  it('should calculate high ECE for miscalibrated predictions', () => {
    // Add predictions where accuracy does not match confidence
    for (let i = 0; i < 100; i++) {
      // Always predict 90% confidence but only 30% accurate
      calibrator.recordPrediction('structural', 0.9, i < 30);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    // ECE should be high for miscalibrated predictions
    expect(curve.ece).toBeGreaterThan(0.3);
  });

  it('should maintain monotonicity in isotonic regression output', () => {
    // Add diverse predictions
    for (let i = 0; i < 100; i++) {
      const conf = Math.random();
      calibrator.recordPrediction('structural', conf, Math.random() < 0.5);
    }

    const curve = calibrator.getCalibrationCurve('structural');

    // Sorted by predicted value, actual values should be monotonically non-decreasing
    const sortedPoints = [...curve.points].sort((a, b) => a.predicted - b.predicted);
    for (let i = 1; i < sortedPoints.length; i++) {
      // Due to isotonic regression, values should be monotonic
      expect(sortedPoints[i].actual).toBeGreaterThanOrEqual(sortedPoints[i - 1].actual - 0.001);
    }
  });

  it('should use appropriate significance level for comparison', () => {
    // Create two types with clearly different calibration
    calibrator.registerClaimType(behavioralClaimType);

    for (let i = 0; i < 100; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 80); // Well calibrated
      calibrator.recordPrediction('behavioral', 0.8, i < 40); // Poorly calibrated
    }

    const result = calibrator.compareCalibration(['structural', 'behavioral']);

    // p-value should be low (significant difference)
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significantDifference).toBe(true);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ClaimTypeCalibrator - Integration', () => {
  let calibrator: ClaimTypeCalibrator;

  beforeEach(() => {
    calibrator = createClaimTypeCalibrator({ minSamplesForCalibration: 10 });
    calibrator.registerClaimType(structuralClaimType);
    calibrator.registerClaimType(behavioralClaimType);
    calibrator.registerClaimType(factualClaimType);
    calibrator.registerClaimType(architecturalClaimType);
  });

  it('should support full calibration workflow', () => {
    // 1. Record predictions for multiple types with larger sample sizes for statistical power
    for (let i = 0; i < 100; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 80); // Well calibrated (80% acc at 80% conf)
      calibrator.recordPrediction('behavioral', 0.8, i < 40); // Overconfident (40% acc at 80% conf)
      calibrator.recordPrediction('factual', 0.5, i < 70); // Underconfident (70% acc at 50% conf)
      calibrator.recordPrediction('architectural', 0.7, i < 35); // Overconfident (35% acc at 70% conf)
    }

    // 2. Get calibration curves
    const structuralCurve = calibrator.getCalibrationCurve('structural');
    const behavioralCurve = calibrator.getCalibrationCurve('behavioral');

    expect(structuralCurve.ece).toBeLessThan(behavioralCurve.ece);

    // 3. Adjust confidences
    const structuralAdj = calibrator.adjustConfidence('structural', 0.8);
    const behavioralAdj = calibrator.adjustConfidence('behavioral', 0.8);

    expect(Math.abs(structuralAdj.adjustedConfidence - 0.8)).toBeLessThan(
      Math.abs(behavioralAdj.adjustedConfidence - 0.8)
    );

    // 4. Compare calibrations
    const comparison = calibrator.compareCalibration(['structural', 'behavioral', 'factual', 'architectural']);

    expect(comparison.significantDifference).toBe(true);

    // 5. Detect monism
    const monism = calibrator.detectMonism();

    expect(monism.isMonistic).toBe(false);
  });

  it('should provide consistent results across multiple calls', () => {
    for (let i = 0; i < 30; i++) {
      calibrator.recordPrediction('structural', 0.7, i < 21);
    }

    const curve1 = calibrator.getCalibrationCurve('structural');
    const curve2 = calibrator.getCalibrationCurve('structural');

    expect(curve1.ece).toBe(curve2.ece);

    const adj1 = calibrator.adjustConfidence('structural', 0.7);
    const adj2 = calibrator.adjustConfidence('structural', 0.7);

    expect(adj1.adjustedConfidence).toBe(adj2.adjustedConfidence);
  });

  it('should update calibration with new predictions', () => {
    // Initial predictions
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 16);
    }

    const curve1 = calibrator.getCalibrationCurve('structural');
    const adj1 = calibrator.adjustConfidence('structural', 0.8);

    // Add more predictions showing different calibration
    for (let i = 0; i < 20; i++) {
      calibrator.recordPrediction('structural', 0.8, i < 10);
    }

    const curve2 = calibrator.getCalibrationCurve('structural');
    const adj2 = calibrator.adjustConfidence('structural', 0.8);

    // Calibration should have changed
    expect(curve2.ece).not.toBe(curve1.ece);
    expect(adj2.adjustedConfidence).not.toBe(adj1.adjustedConfidence);
  });
});
