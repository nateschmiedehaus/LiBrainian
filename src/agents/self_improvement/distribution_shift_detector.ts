/**
 * @fileoverview Distribution Shift Detector (WU-SELF-303)
 *
 * Detects when query/content patterns drift from calibration data using
 * statistical tests to identify distribution shifts. Tracks query embedding
 * distributions over time and alerts when recalibration may be needed.
 *
 * Implements:
 * - Kolmogorov-Smirnov test (basic distribution comparison)
 * - T-test for mean shift
 * - Levene's test for variance shift
 */

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Represents a window of distribution samples over a time period.
 */
export interface DistributionWindow {
  /** Unique identifier for this window */
  windowId: string;
  /** Start time of the window */
  startTime: Date;
  /** End time of the window */
  endTime: Date;
  /** Sample values in this window */
  samples: number[];
  /** Mean of the samples */
  mean: number;
  /** Variance of the samples */
  variance: number;
}

/**
 * Result of a statistical shift detection test.
 */
export interface ShiftDetectionResult {
  /** Whether a significant shift was detected */
  shifted: boolean;
  /** P-value from the statistical test */
  pValue: number;
  /** Effect size (e.g., Cohen's d) */
  effectSize: number;
  /** Human-readable description of the result */
  description: string;
  /** Recommended action based on the result */
  recommendation: string;
}

/**
 * Comprehensive report of distribution shift analysis.
 */
export interface ShiftReport {
  /** Time when detection was performed */
  detectionTime: Date;
  /** Reference (baseline) distribution window */
  referenceWindow: DistributionWindow;
  /** Current distribution window */
  currentWindow: DistributionWindow;
  /** Results from all shift detection tests */
  shifts: ShiftDetectionResult[];
  /** Overall status assessment */
  overallStatus: 'stable' | 'drifting' | 'shifted';
}

/**
 * Result of a statistical test.
 */
export interface StatisticalTestResult {
  /** Test statistic value */
  statistic: number;
  /** P-value */
  pValue: number;
}

/**
 * Configuration options for the detector.
 */
export interface DistributionShiftDetectorOptions {
  /** Number of samples per window (default: 100) */
  windowSize?: number;
  /** Significance level for tests (default: 0.05) */
  significanceLevel?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate the mean of an array of numbers.
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate the sample variance of an array of numbers.
 */
function calculateVariance(values: number[], mean?: number): number {
  if (values.length <= 1) return 0;
  const m = mean ?? calculateMean(values);
  const squaredDiffs = values.map((v) => (v - m) ** 2);
  return squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
}

/**
 * Calculate the standard deviation.
 */
function calculateStdDev(values: number[], mean?: number): number {
  return Math.sqrt(calculateVariance(values, mean));
}

/**
 * Calculate Cohen's d effect size.
 */
function cohensD(
  mean1: number,
  mean2: number,
  variance1: number,
  variance2: number,
  n1: number,
  n2: number
): number {
  // Pooled standard deviation
  const pooledVar =
    ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
  const pooledStd = Math.sqrt(pooledVar);

  if (pooledStd === 0) return 0;
  return Math.abs(mean1 - mean2) / pooledStd;
}

/**
 * Generate a unique window ID.
 */
function generateWindowId(): string {
  return `window-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Filter out invalid values (NaN, Infinity).
 */
function filterValidValues(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

// ============================================================================
// DISTRIBUTION SHIFT DETECTOR CLASS
// ============================================================================

/**
 * Detects distribution shifts in query/content patterns.
 *
 * Uses statistical tests to identify when distributions drift from
 * calibration data, tracking embedding distributions over time and
 * alerting when recalibration may be needed.
 */
export class DistributionShiftDetector {
  private windowSize: number;
  private significanceLevel: number;

  /** Sample storage by category */
  private samples: Map<string, number[]>;

  /** Reference windows by category */
  private referenceWindows: Map<string, DistributionWindow>;

  /** Sample timestamps by category */
  private sampleTimestamps: Map<string, Date[]>;

  constructor(options: DistributionShiftDetectorOptions = {}) {
    this.windowSize = options.windowSize ?? 100;
    this.significanceLevel = options.significanceLevel ?? 0.05;
    this.samples = new Map();
    this.referenceWindows = new Map();
    this.sampleTimestamps = new Map();
  }

  // ==========================================================================
  // CONFIGURATION GETTERS
  // ==========================================================================

  /**
   * Get the configured window size.
   */
  getWindowSize(): number {
    return this.windowSize;
  }

  /**
   * Get the configured significance level.
   */
  getSignificanceLevel(): number {
    return this.significanceLevel;
  }

  // ==========================================================================
  // SAMPLE RECORDING
  // ==========================================================================

  /**
   * Record a sample value.
   * @param value - The sample value to record
   * @param category - Optional category for the sample (default: 'default')
   */
  recordSample(value: number, category: string = 'default'): void {
    // Filter out invalid values
    if (!Number.isFinite(value)) {
      return;
    }

    if (!this.samples.has(category)) {
      this.samples.set(category, []);
      this.sampleTimestamps.set(category, []);
    }

    const categorySamples = this.samples.get(category)!;
    const categoryTimestamps = this.sampleTimestamps.get(category)!;

    categorySamples.push(value);
    categoryTimestamps.push(new Date());
  }

  /**
   * Get the total number of samples recorded.
   * @param category - Optional category to filter by
   */
  getSampleCount(category?: string): number {
    if (category !== undefined) {
      return this.samples.get(category)?.length ?? 0;
    }
    let total = 0;
    for (const samples of this.samples.values()) {
      total += samples.length;
    }
    return total;
  }

  // ==========================================================================
  // WINDOW MANAGEMENT
  // ==========================================================================

  /**
   * Get the reference window for a category.
   * @param category - Category to get reference window for
   */
  getReferenceWindow(category: string = 'default'): DistributionWindow | null {
    return this.referenceWindows.get(category) ?? null;
  }

  /**
   * Get the current window for a category.
   * @param category - Category to get current window for
   */
  getCurrentWindow(category: string = 'default'): DistributionWindow | null {
    const categorySamples = this.samples.get(category);
    const categoryTimestamps = this.sampleTimestamps.get(category);

    if (!categorySamples || categorySamples.length === 0) {
      return null;
    }

    // Get the most recent samples up to window size
    const startIdx = Math.max(0, categorySamples.length - this.windowSize);
    const windowSamples = categorySamples.slice(startIdx);
    const validSamples = filterValidValues(windowSamples);

    if (validSamples.length === 0) {
      return null;
    }

    const mean = calculateMean(validSamples);
    const variance = calculateVariance(validSamples, mean);

    const startTime =
      categoryTimestamps![startIdx] ?? new Date();
    const endTime =
      categoryTimestamps![categorySamples.length - 1] ?? new Date();

    return {
      windowId: generateWindowId(),
      startTime,
      endTime,
      samples: validSamples,
      mean,
      variance,
    };
  }

  /**
   * Set the current window as the reference window.
   * @param category - Category to set reference for
   */
  setReferenceWindow(category: string = 'default'): void {
    const currentWindow = this.getCurrentWindow(category);
    if (currentWindow) {
      this.referenceWindows.set(category, currentWindow);
    }
  }

  // ==========================================================================
  // STATISTICAL TESTS
  // ==========================================================================

  /**
   * Perform a two-sample T-test for mean difference.
   * @param samples1 - First sample array
   * @param samples2 - Second sample array
   */
  tTest(samples1: number[], samples2: number[]): StatisticalTestResult {
    const valid1 = filterValidValues(samples1);
    const valid2 = filterValidValues(samples2);

    if (valid1.length === 0 || valid2.length === 0) {
      return { statistic: 0, pValue: 1 };
    }

    const n1 = valid1.length;
    const n2 = valid2.length;
    const mean1 = calculateMean(valid1);
    const mean2 = calculateMean(valid2);
    const var1 = calculateVariance(valid1, mean1);
    const var2 = calculateVariance(valid2, mean2);

    // If means are identical, no difference
    if (mean1 === mean2) {
      return { statistic: 0, pValue: 1 };
    }

    // Welch's t-test (unequal variance)
    const se = Math.sqrt(var1 / n1 + var2 / n2);

    if (se === 0) {
      // If standard error is 0 but means differ, significant difference
      return { statistic: Infinity, pValue: 0 };
    }

    const t = (mean1 - mean2) / se;

    // Degrees of freedom (Welch-Satterthwaite)
    const df =
      (var1 / n1 + var2 / n2) ** 2 /
      ((var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1));

    // Approximate p-value using normal distribution for large samples
    // For small samples, this is an approximation
    const pValue = this.approximateTTestPValue(Math.abs(t), df);

    return { statistic: t, pValue };
  }

  /**
   * Approximate p-value for t-test using normal approximation.
   */
  private approximateTTestPValue(t: number, df: number): number {
    // Use a simple approximation for the t-distribution
    // For large df, t-distribution approaches normal
    if (df <= 0 || !Number.isFinite(df)) {
      return 1;
    }

    // For very large t values, p is essentially 0
    if (t > 10) return 0;

    // Approximation using the complementary error function approximation
    // This is a rough approximation but works reasonably well
    const z = t * Math.sqrt(df / (df - 2 + 0.001)); // Adjust for df
    return 2 * (1 - this.normalCDF(Math.abs(z)));
  }

  /**
   * Approximate the normal CDF.
   */
  private normalCDF(x: number): number {
    // Approximation of the standard normal CDF
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y =
      1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Perform Levene's test for variance equality.
   * @param samples1 - First sample array
   * @param samples2 - Second sample array
   */
  levenesTest(samples1: number[], samples2: number[]): StatisticalTestResult {
    const valid1 = filterValidValues(samples1);
    const valid2 = filterValidValues(samples2);

    if (valid1.length === 0 || valid2.length === 0) {
      return { statistic: 0, pValue: 1 };
    }

    const n1 = valid1.length;
    const n2 = valid2.length;
    const median1 = this.median(valid1);
    const median2 = this.median(valid2);

    // Absolute deviations from median
    const z1 = valid1.map((x) => Math.abs(x - median1));
    const z2 = valid2.map((x) => Math.abs(x - median2));

    const meanZ1 = calculateMean(z1);
    const meanZ2 = calculateMean(z2);
    const meanZ = (n1 * meanZ1 + n2 * meanZ2) / (n1 + n2);

    // Between-group sum of squares
    const ssb = n1 * (meanZ1 - meanZ) ** 2 + n2 * (meanZ2 - meanZ) ** 2;

    // Within-group sum of squares
    const ssw =
      z1.reduce((sum, z) => sum + (z - meanZ1) ** 2, 0) +
      z2.reduce((sum, z) => sum + (z - meanZ2) ** 2, 0);

    if (ssw === 0) {
      return { statistic: 0, pValue: 1 };
    }

    // F statistic
    const k = 2; // number of groups
    const N = n1 + n2;
    const f = (ssb / (k - 1)) / (ssw / (N - k));

    // Approximate p-value using F-distribution approximation
    const pValue = this.approximateFTestPValue(f, k - 1, N - k);

    return { statistic: f, pValue };
  }

  /**
   * Calculate median of an array.
   */
  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Approximate p-value for F-test using a better approximation.
   * Uses the normal approximation to the F distribution.
   */
  private approximateFTestPValue(f: number, df1: number, df2: number): number {
    if (f <= 0 || !Number.isFinite(f)) return 1;
    if (f > 1000) return 0;

    // Wilson-Hilferty transformation: F to approximately normal
    // This is a well-known approximation for the F distribution

    // For very small df, use a conservative estimate
    if (df1 < 1 || df2 < 1) return 1;

    // Transform to chi-square and then to normal
    // Using the approximation: (F * df1 / df2)^(1/3) is approximately normal
    // for moderate to large df

    // Better approach: use the regularized incomplete beta function approximation
    const x = df2 / (df2 + df1 * f);

    // Use the Stirling approximation for the regularized incomplete beta
    // I_x(a,b) where a = df2/2, b = df1/2
    const a = df2 / 2;
    const b = df1 / 2;

    // For the F-test, P(F > f) = I_x(df2/2, df1/2) where x = df2/(df2 + df1*f)
    const pValue = this.regularizedIncompleteBeta(a, b, x);

    return Math.max(0, Math.min(1, pValue));
  }

  /**
   * Approximation of the regularized incomplete beta function I_x(a,b).
   * Uses continued fraction expansion for better accuracy.
   */
  private regularizedIncompleteBeta(a: number, b: number, x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // For x > (a+1)/(a+b+2), use the symmetry relation
    // I_x(a,b) = 1 - I_(1-x)(b,a)
    const threshold = (a + 1) / (a + b + 2);

    if (x > threshold) {
      return 1 - this.regularizedIncompleteBeta(b, a, 1 - x);
    }

    // Use continued fraction (Lentz's algorithm simplified)
    // This gives reasonable accuracy for most practical cases
    const maxIterations = 100;
    const epsilon = 1e-10;

    // Beta function approximation using Stirling
    const logBeta = this.logGamma(a) + this.logGamma(b) - this.logGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - logBeta) / a;

    // Continued fraction
    let f = 1;
    let c = 1;
    let d = 0;

    for (let m = 0; m <= maxIterations; m++) {
      const m2 = 2 * m;

      // Even term
      let numerator: number;
      if (m === 0) {
        numerator = 1;
      } else {
        numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      }

      d = 1 + numerator * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + numerator / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      f *= d * c;

      // Odd term
      numerator = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));

      d = 1 + numerator * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + numerator / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      f *= delta;

      if (Math.abs(delta - 1) < epsilon) break;
    }

    return front * f;
  }

  /**
   * Log gamma function approximation (Stirling's approximation).
   */
  private logGamma(x: number): number {
    if (x <= 0) return 0;

    // Stirling's approximation
    // ln(Gamma(x)) ~ (x - 0.5) * ln(x) - x + 0.5 * ln(2*pi) + 1/(12*x)
    if (x < 12) {
      // Use recursion for small x
      return this.logGamma(x + 1) - Math.log(x);
    }

    const x2 = x * x;
    const x3 = x2 * x;
    const x5 = x3 * x2;
    const x7 = x5 * x2;

    return (x - 0.5) * Math.log(x) - x + 0.9189385332046727 // 0.5 * ln(2*pi)
      + 1 / (12 * x) - 1 / (360 * x3) + 1 / (1260 * x5) - 1 / (1680 * x7);
  }

  /**
   * Perform Kolmogorov-Smirnov test for distribution difference.
   * @param samples1 - First sample array
   * @param samples2 - Second sample array
   */
  ksTest(samples1: number[], samples2: number[]): StatisticalTestResult {
    const valid1 = filterValidValues(samples1);
    const valid2 = filterValidValues(samples2);

    if (valid1.length === 0 || valid2.length === 0) {
      return { statistic: 0, pValue: 1 };
    }

    const n1 = valid1.length;
    const n2 = valid2.length;

    // Sort both arrays
    const sorted1 = [...valid1].sort((a, b) => a - b);
    const sorted2 = [...valid2].sort((a, b) => a - b);

    // Calculate D statistic (maximum difference between ECDFs)
    let d = 0;

    // Combine all unique values
    const allValues = [...new Set([...sorted1, ...sorted2])].sort(
      (a, b) => a - b
    );

    for (const x of allValues) {
      // ECDF for sample 1
      const f1 = sorted1.filter((v) => v <= x).length / n1;
      // ECDF for sample 2
      const f2 = sorted2.filter((v) => v <= x).length / n2;

      d = Math.max(d, Math.abs(f1 - f2));
    }

    // Calculate p-value using asymptotic distribution
    const en = Math.sqrt((n1 * n2) / (n1 + n2));
    const lambda = (en + 0.12 + 0.11 / en) * d;

    // Kolmogorov distribution approximation
    const pValue = this.kolmogorovPValue(lambda);

    return { statistic: d, pValue };
  }

  /**
   * Approximate p-value for Kolmogorov-Smirnov test.
   */
  private kolmogorovPValue(lambda: number): number {
    if (lambda <= 0) return 1;
    if (lambda > 3) return 0;

    // Approximation using series expansion
    let sum = 0;
    for (let k = 1; k <= 100; k++) {
      const term = Math.exp(-2 * k * k * lambda * lambda);
      sum += (k % 2 === 0 ? -1 : 1) * 2 * term;
    }
    return Math.max(0, Math.min(1, sum));
  }

  // ==========================================================================
  // SHIFT DETECTION
  // ==========================================================================

  /**
   * Compare two distribution windows.
   * @param ref - Reference window
   * @param current - Current window
   */
  compareDistributions(
    ref: DistributionWindow,
    current: DistributionWindow
  ): ShiftDetectionResult {
    // Run T-test
    const tTestResult = this.tTest(ref.samples, current.samples);

    // Run Levene's test
    const levenesResult = this.levenesTest(ref.samples, current.samples);

    // Run KS test
    const ksResult = this.ksTest(ref.samples, current.samples);

    // Calculate effect size
    const effectSize = cohensD(
      ref.mean,
      current.mean,
      ref.variance,
      current.variance,
      ref.samples.length,
      current.samples.length
    );

    // Use the minimum p-value from all tests
    const minPValue = Math.min(
      tTestResult.pValue,
      levenesResult.pValue,
      ksResult.pValue
    );

    const shifted = minPValue < this.significanceLevel;

    // Generate description
    let description: string;
    if (!shifted) {
      description = `No significant distribution shift detected (p=${minPValue.toFixed(4)})`;
    } else if (tTestResult.pValue < this.significanceLevel) {
      description = `Mean shift detected: ${ref.mean.toFixed(3)} -> ${current.mean.toFixed(3)} (p=${tTestResult.pValue.toFixed(4)})`;
    } else if (levenesResult.pValue < this.significanceLevel) {
      description = `Variance shift detected: ${ref.variance.toFixed(3)} -> ${current.variance.toFixed(3)} (p=${levenesResult.pValue.toFixed(4)})`;
    } else {
      description = `Distribution shape shift detected (KS p=${ksResult.pValue.toFixed(4)})`;
    }

    // Generate recommendation
    let recommendation: string;
    if (!shifted) {
      recommendation = 'Continue monitoring. No action needed.';
    } else if (effectSize > 0.8) {
      recommendation =
        'Large distribution shift detected. Recommend immediate recalibration of the model.';
    } else if (effectSize > 0.5) {
      recommendation =
        'Moderate distribution shift detected. Consider recalibration within the next update cycle.';
    } else {
      recommendation =
        'Small but significant shift detected. Monitor closely and recalibrate if trend continues.';
    }

    return {
      shifted,
      pValue: minPValue,
      effectSize,
      description,
      recommendation,
    };
  }

  /**
   * Detect if there's a shift from the reference distribution.
   * @param category - Category to check (default: 'default')
   */
  detectShift(category: string = 'default'): ShiftDetectionResult {
    const refWindow = this.getReferenceWindow(category);
    const currentWindow = this.getCurrentWindow(category);

    // Check for insufficient data
    if (!refWindow || !currentWindow) {
      return {
        shifted: false,
        pValue: 1,
        effectSize: 0,
        description: 'Insufficient samples to detect shift',
        recommendation: 'Collect more samples before performing shift detection.',
      };
    }

    if (refWindow.samples.length < 5 || currentWindow.samples.length < 5) {
      return {
        shifted: false,
        pValue: 1,
        effectSize: 0,
        description: 'Insufficient samples to detect shift (need at least 5 samples per window)',
        recommendation: 'Collect more samples before performing shift detection.',
      };
    }

    return this.compareDistributions(refWindow, currentWindow);
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  /**
   * Generate a comprehensive shift report.
   * @param category - Category to report on (default: 'default')
   */
  generateReport(category: string = 'default'): ShiftReport {
    const refWindow = this.getReferenceWindow(category);
    const currentWindow = this.getCurrentWindow(category);

    // Create empty windows if not available
    const emptyWindow: DistributionWindow = {
      windowId: 'empty',
      startTime: new Date(),
      endTime: new Date(),
      samples: [],
      mean: 0,
      variance: 0,
    };

    const finalRefWindow = refWindow ?? emptyWindow;
    const finalCurrentWindow = currentWindow ?? emptyWindow;

    // Run all tests
    const shifts: ShiftDetectionResult[] = [];

    if (finalRefWindow.samples.length >= 5 && finalCurrentWindow.samples.length >= 5) {
      // T-test result
      const tTestResult = this.tTest(
        finalRefWindow.samples,
        finalCurrentWindow.samples
      );
      const tEffectSize = cohensD(
        finalRefWindow.mean,
        finalCurrentWindow.mean,
        finalRefWindow.variance,
        finalCurrentWindow.variance,
        finalRefWindow.samples.length,
        finalCurrentWindow.samples.length
      );
      shifts.push({
        shifted: tTestResult.pValue < this.significanceLevel,
        pValue: tTestResult.pValue,
        effectSize: tEffectSize,
        description: `T-test for mean shift (t=${tTestResult.statistic.toFixed(3)})`,
        recommendation:
          tTestResult.pValue < this.significanceLevel
            ? 'Mean has shifted significantly. Consider recalibration.'
            : 'Mean is stable.',
      });

      // Levene's test result
      const levenesResult = this.levenesTest(
        finalRefWindow.samples,
        finalCurrentWindow.samples
      );
      shifts.push({
        shifted: levenesResult.pValue < this.significanceLevel,
        pValue: levenesResult.pValue,
        effectSize: Math.abs(finalRefWindow.variance - finalCurrentWindow.variance) /
          Math.max(finalRefWindow.variance, finalCurrentWindow.variance, 0.001),
        description: `Levene's test for variance shift (F=${levenesResult.statistic.toFixed(3)})`,
        recommendation:
          levenesResult.pValue < this.significanceLevel
            ? 'Variance has shifted significantly. Consider recalibration.'
            : 'Variance is stable.',
      });

      // KS test result
      const ksResult = this.ksTest(
        finalRefWindow.samples,
        finalCurrentWindow.samples
      );
      shifts.push({
        shifted: ksResult.pValue < this.significanceLevel,
        pValue: ksResult.pValue,
        effectSize: ksResult.statistic,
        description: `Kolmogorov-Smirnov test (D=${ksResult.statistic.toFixed(3)})`,
        recommendation:
          ksResult.pValue < this.significanceLevel
            ? 'Distribution shape has shifted. Consider recalibration.'
            : 'Distribution shape is stable.',
      });
    }

    // Determine overall status
    let overallStatus: 'stable' | 'drifting' | 'shifted';
    const shiftedCount = shifts.filter((s) => s.shifted).length;
    const avgEffectSize =
      shifts.length > 0
        ? shifts.reduce((sum, s) => sum + s.effectSize, 0) / shifts.length
        : 0;

    if (shiftedCount === 0) {
      overallStatus = 'stable';
    } else if (shiftedCount >= 2 || avgEffectSize > 0.5) {
      overallStatus = 'shifted';
    } else {
      overallStatus = 'drifting';
    }

    return {
      detectionTime: new Date(),
      referenceWindow: finalRefWindow,
      currentWindow: finalCurrentWindow,
      shifts,
      overallStatus,
    };
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Reset all state.
   */
  reset(): void {
    this.samples.clear();
    this.referenceWindows.clear();
    this.sampleTimestamps.clear();
  }
}
