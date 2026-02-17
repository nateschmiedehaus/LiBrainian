# Track J: System Dynamics Analysis (P54-P57)

> **Source**: Extracted from THEORETICAL_CRITIQUE.md Part XII.D (Dynamical Systems Science Critiques)
> **Problem References**: P54 (Stability), P55 (Bifurcation), P56 (Emergence), P57 (Resilience)
> **Purpose**: Analyze LiBrainian as a dynamical system with feedback loops
>
> **LiBrainian Story**: The learning/confidence system is a dynamical system. Without stability analysis, we cannot guarantee it won't oscillate, diverge, or collapse.
>
> **Dependency**: Requires Track F (Calibration) for confidence data, Track D (Quantification) for ConfidenceValue types.

---

## KNOWN IMPLEMENTATION ISSUES

| Issue | Severity | Status |
|-------|----------|--------|
| **No stability analysis** | HIGH | P54 - System could oscillate or diverge |
| **No bifurcation detection** | HIGH | P55 - Parameter changes cause catastrophic failures |
| **No emergence metrics** | MEDIUM | P56 - Cannot measure synthesis quality |
| **No resilience testing** | MEDIUM | P57 - Unknown recovery characteristics |

**Research vs Production**: Track J is primarily a **research track**. Components S1-S3 (Stability, Bifurcation, Emergence) require theoretical foundations before production use. S4 (Resilience) has more immediate production applicability.

---

## Overview

The LiBrainian learning loop is a dynamical system:

```
Confidence -> Agent behavior -> Outcomes -> Confidence updates -> Confidence
```

This feedback loop can exhibit complex behaviors:
- **Oscillation**: Confidence swings wildly between high and low
- **Divergence**: Runaway overconfidence leads to catastrophic decisions
- **Collapse**: Everything degrades to low confidence, system becomes useless
- **Bifurcation**: Small parameter changes cause sudden qualitative shifts

Without formal analysis, we cannot predict or prevent these failure modes.

### Track J Features

| Priority | Feature | Problem Reference | LOC | Dependencies |
|----------|---------|-------------------|-----|--------------|
| **S1** | System Stability Analysis | P54 | ~300 | C1-C4, learning_loop.ts |
| **S2** | Bifurcation Detection | P55 | ~250 | S1 |
| **S3** | Emergence Metrics | P56 | ~200 | epistemics module |
| **S4** | Resilience & Recovery | P57 | ~250 | S1, S2 |

**When to implement**: S1-S4 are research-grade features. S4 (Resilience) can be implemented independently for production chaos testing.

---

## Part 1: System Stability Analysis (P54)

### The Problem

The learning/confidence system has feedback loops that could:
- Oscillate (confidence swings wildly)
- Diverge (runaway overconfidence)
- Collapse (everything becomes low confidence)

The current implementation provides no stability guarantees.

### Interface Specification

```typescript
import type { ConfidenceValue, DerivedConfidence, MeasuredConfidence } from '../types/confidence.js';

/**
 * System stability analysis for the learning loop.
 *
 * INVARIANT: Any stable system must return to equilibrium
 * after bounded perturbations within finite time.
 */
interface SystemStabilityAnalysis {
  /** System state space definition */
  stateSpace: {
    /** Named dimensions of the state space */
    dimensions: StateSpaceDimension[];
    /** Bounds for each dimension */
    bounds: Map<string, [number, number]>;
  };

  /** Identified fixed points (equilibria) */
  fixedPoints: FixedPoint[];

  /** Stability classification for each fixed point */
  stabilityAnalysis: Map<string, StabilityClassification>;

  /** Lyapunov function if one exists */
  lyapunovFunction?: LyapunovFunction;

  /** Empirical stability test results */
  empiricalStability: EmpiricalStabilityResult;
}

interface StateSpaceDimension {
  name: string;
  description: string;
  unit: 'confidence' | 'rate' | 'count' | 'bits' | 'unitless';
  computeFrom: (state: LearningLoopState) => number;
}

/**
 * Default state space dimensions for learning loop analysis.
 */
const DEFAULT_STATE_DIMENSIONS: StateSpaceDimension[] = [
  {
    name: 'avg_confidence',
    description: 'Mean confidence across all tracked entities',
    unit: 'confidence',
    computeFrom: (state) => computeAverageConfidence(state),
  },
  {
    name: 'confidence_variance',
    description: 'Variance in confidence values',
    unit: 'confidence',
    computeFrom: (state) => computeConfidenceVariance(state),
  },
  {
    name: 'calibration_error',
    description: 'Expected calibration error (ECE)',
    unit: 'confidence',
    computeFrom: (state) => computeCalibrationError(state),
  },
  {
    name: 'learning_rate_effective',
    description: 'Effective learning rate from recent updates',
    unit: 'rate',
    computeFrom: (state) => computeEffectiveLearningRate(state),
  },
  {
    name: 'entropy',
    description: 'Shannon entropy of confidence distribution',
    unit: 'bits',
    computeFrom: (state) => computeConfidenceEntropy(state),
  },
];

/**
 * A fixed point (equilibrium) of the dynamical system.
 */
interface FixedPoint {
  /** Unique identifier for this fixed point */
  id: string;
  /** State values at the fixed point */
  state: Record<string, number>;
  /** Classification of the fixed point */
  type: 'attractor' | 'repeller' | 'saddle';
  /** Eigenvalues of linearized dynamics (determine stability) */
  eigenvalues: ComplexNumber[];
  /** Interpretation for operators */
  interpretation: string;
}

interface ComplexNumber {
  real: number;
  imag: number;
}

type StabilityType =
  | 'asymptotically_stable'  // Returns to equilibrium
  | 'stable'                 // Stays near equilibrium
  | 'unstable'               // Diverges from equilibrium
  | 'saddle';                // Stable in some directions, unstable in others

interface StabilityClassification {
  type: StabilityType;
  /** Confidence in this classification */
  confidence: ConfidenceValue;
  /** Theoretical basis for classification */
  basis: 'eigenvalue_analysis' | 'lyapunov' | 'empirical' | 'unknown';
  /** Conditions under which this classification holds */
  conditions: string[];
}

/**
 * Lyapunov function for proving stability.
 *
 * A Lyapunov function V(x) satisfies:
 * 1. V(x) > 0 for all x != x* (positive definite)
 * 2. V(x*) = 0 at equilibrium
 * 3. dV/dt <= 0 along trajectories (non-increasing)
 */
interface LyapunovFunction {
  /** Whether a valid Lyapunov function was found */
  exists: boolean;
  /** The function itself (if exists) */
  evaluate?: (state: Record<string, number>) => number;
  /** Mathematical form for documentation */
  formula?: string;
  /** Proof sketch */
  proofSketch?: string;
  /** Confidence in the proof */
  confidence: ConfidenceValue;
}

interface EmpiricalStabilityResult {
  /** Does system recover from perturbations? */
  perturbationRecovery: boolean;
  /** Rate of convergence to equilibrium */
  convergenceRate: ConfidenceValue;
  /** Region from which system converges to healthy state */
  attractorBasin: ParameterRegion;
  /** Test details */
  testRuns: StabilityTestRun[];
}

interface StabilityTestRun {
  perturbationType: 'noise' | 'spike' | 'drift' | 'corruption';
  perturbationMagnitude: number;
  initialState: Record<string, number>;
  finalState: Record<string, number>;
  trajectoryLength: number;
  recovered: boolean;
  recoveryTime?: number;
}

interface ParameterRegion {
  /** Named bounds for each parameter */
  bounds: Map<string, [number, number]>;
  /** Whether region is convex */
  convex: boolean;
  /** Volume of the region (if computable) */
  volume?: number;
}
```

### Stability Analysis Implementation

```typescript
/**
 * Analyze stability of the confidence update rule.
 *
 * The update rule is: c_{t+1} = c_t + alpha * (outcome - c_t)
 * This is stable iff 0 < alpha < 2.
 */
function analyzeConfidenceUpdateStability(alpha: number): StabilityClassification {
  // Fixed point: c* = E[outcome]
  // Linearized: c_{t+1} = (1 - alpha) * c_t + alpha * outcome
  // Eigenvalue: lambda = 1 - alpha
  // Stable iff |lambda| < 1, i.e., -1 < 1 - alpha < 1, i.e., 0 < alpha < 2

  if (alpha <= 0 || alpha >= 2) {
    return {
      type: 'unstable',
      confidence: {
        type: 'deterministic',
        value: 1.0,
        reason: 'Eigenvalue analysis: |1 - alpha| >= 1',
      },
      basis: 'eigenvalue_analysis',
      conditions: ['alpha outside (0, 2)'],
    };
  }

  if (alpha === 1) {
    return {
      type: 'asymptotically_stable',
      confidence: {
        type: 'deterministic',
        value: 1.0,
        reason: 'Eigenvalue is 0, fastest convergence',
      },
      basis: 'eigenvalue_analysis',
      conditions: ['alpha = 1 (optimal)'],
    };
  }

  return {
    type: 'stable',
    confidence: {
      type: 'derived',
      value: 1.0 - Math.abs(1 - alpha),
      formula: '1 - |1 - alpha|',
      inputs: [{ name: 'alpha', value: { type: 'deterministic', value: alpha, reason: 'parameter' } }],
    },
    basis: 'eigenvalue_analysis',
    conditions: [`alpha = ${alpha} in (0, 2)`],
  };
}

/**
 * Detect oscillation in confidence time series.
 *
 * Oscillation is indicated by:
 * - High autocorrelation at lag > 0
 * - Alternating signs in differences
 */
function detectOscillation(
  timeSeries: number[],
  options: { lagThreshold?: number; signChangeThreshold?: number } = {}
): OscillationDetectionResult {
  const lagThreshold = options.lagThreshold ?? 0.5;
  const signChangeThreshold = options.signChangeThreshold ?? 0.7;

  if (timeSeries.length < 10) {
    return {
      detected: false,
      confidence: { type: 'absent', reason: 'insufficient_data' },
      metrics: null,
    };
  }

  // Compute autocorrelation at lag 1
  const mean = timeSeries.reduce((a, b) => a + b, 0) / timeSeries.length;
  const centered = timeSeries.map(x => x - mean);
  const variance = centered.reduce((a, b) => a + b * b, 0) / centered.length;

  let autocorr = 0;
  for (let i = 0; i < centered.length - 1; i++) {
    autocorr += centered[i] * centered[i + 1];
  }
  autocorr /= (centered.length - 1) * variance;

  // Compute sign change rate
  const diffs = [];
  for (let i = 1; i < timeSeries.length; i++) {
    diffs.push(timeSeries[i] - timeSeries[i - 1]);
  }
  let signChanges = 0;
  for (let i = 1; i < diffs.length; i++) {
    if (Math.sign(diffs[i]) !== Math.sign(diffs[i - 1]) && diffs[i] !== 0) {
      signChanges++;
    }
  }
  const signChangeRate = signChanges / (diffs.length - 1);

  const oscillating = autocorr < -lagThreshold || signChangeRate > signChangeThreshold;

  return {
    detected: oscillating,
    confidence: {
      type: 'measured',
      value: oscillating ? Math.max(Math.abs(autocorr), signChangeRate) : 1 - Math.max(Math.abs(autocorr), signChangeRate),
      measurement: {
        datasetId: 'oscillation_detection',
        sampleSize: timeSeries.length,
        accuracy: Math.min(0.95, timeSeries.length / 100),
        confidenceInterval: [0.8, 0.99] as [number, number],
        measuredAt: new Date(),
      },
    },
    metrics: {
      autocorrelationLag1: autocorr,
      signChangeRate,
      period: estimatePeriod(timeSeries),
    },
  };
}

interface OscillationDetectionResult {
  detected: boolean;
  confidence: ConfidenceValue;
  metrics: {
    autocorrelationLag1: number;
    signChangeRate: number;
    period: number | null;
  } | null;
}

/**
 * Detect divergence (runaway) in confidence values.
 */
function detectDivergence(
  timeSeries: number[],
  options: { trendThreshold?: number; accelerationThreshold?: number } = {}
): DivergenceDetectionResult {
  const trendThreshold = options.trendThreshold ?? 0.1;
  const accelerationThreshold = options.accelerationThreshold ?? 0.05;

  if (timeSeries.length < 5) {
    return {
      detected: false,
      direction: null,
      confidence: { type: 'absent', reason: 'insufficient_data' },
    };
  }

  // Linear regression for trend
  const n = timeSeries.length;
  const xMean = (n - 1) / 2;
  const yMean = timeSeries.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (timeSeries[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = numerator / denominator;

  // Check for acceleration (second derivative)
  const diffs = [];
  for (let i = 1; i < n; i++) {
    diffs.push(timeSeries[i] - timeSeries[i - 1]);
  }
  const diffMean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  let acceleration = 0;
  for (let i = 1; i < diffs.length; i++) {
    acceleration += diffs[i] - diffs[i - 1];
  }
  acceleration /= diffs.length - 1;

  const diverging = Math.abs(slope) > trendThreshold && Math.abs(acceleration) > accelerationThreshold;
  const direction = slope > 0 ? 'increasing' : 'decreasing';

  return {
    detected: diverging,
    direction: diverging ? direction : null,
    confidence: {
      type: 'derived',
      value: diverging ? Math.min(Math.abs(slope) / trendThreshold, 1) : 1 - Math.abs(slope) / trendThreshold,
      formula: diverging ? 'min(|slope| / threshold, 1)' : '1 - |slope| / threshold',
      inputs: [
        { name: 'slope', value: { type: 'deterministic', value: slope, reason: 'linear_regression' } },
      ],
    },
    metrics: {
      slope,
      acceleration,
      r_squared: computeRSquared(timeSeries, slope, yMean),
    },
  };
}

interface DivergenceDetectionResult {
  detected: boolean;
  direction: 'increasing' | 'decreasing' | null;
  confidence: ConfidenceValue;
  metrics?: {
    slope: number;
    acceleration: number;
    r_squared: number;
  };
}

/**
 * Detect collapse (degradation to low confidence).
 */
function detectCollapse(
  timeSeries: number[],
  options: { collapseThreshold?: number; minFraction?: number } = {}
): CollapseDetectionResult {
  const collapseThreshold = options.collapseThreshold ?? 0.3;
  const minFraction = options.minFraction ?? 0.8;

  if (timeSeries.length < 5) {
    return {
      detected: false,
      confidence: { type: 'absent', reason: 'insufficient_data' },
    };
  }

  // Check what fraction of recent values are below threshold
  const recentWindow = Math.min(20, Math.floor(timeSeries.length / 2));
  const recentValues = timeSeries.slice(-recentWindow);
  const belowThreshold = recentValues.filter(v => v < collapseThreshold).length;
  const fraction = belowThreshold / recentValues.length;

  const collapsed = fraction >= minFraction;

  return {
    detected: collapsed,
    confidence: {
      type: 'measured',
      value: collapsed ? fraction : 1 - fraction,
      measurement: {
        datasetId: 'collapse_detection',
        sampleSize: recentWindow,
        accuracy: recentWindow / 20,
        confidenceInterval: [fraction - 0.1, fraction + 0.1] as [number, number],
        measuredAt: new Date(),
      },
    },
    metrics: {
      fractionBelowThreshold: fraction,
      meanConfidence: recentValues.reduce((a, b) => a + b, 0) / recentValues.length,
      minConfidence: Math.min(...recentValues),
    },
  };
}

interface CollapseDetectionResult {
  detected: boolean;
  confidence: ConfidenceValue;
  metrics?: {
    fractionBelowThreshold: number;
    meanConfidence: number;
    minConfidence: number;
  };
}
```

### Acceptance Criteria (S1)

- [ ] State space definition captures key learning loop dimensions
- [ ] Fixed point identification for confidence update rule
- [ ] Eigenvalue-based stability classification
- [ ] Oscillation detection with autocorrelation analysis
- [ ] Divergence detection with trend analysis
- [ ] Collapse detection with threshold monitoring
- [ ] Empirical stability testing framework
- [ ] ~300 LOC budget

---

## Part 2: Bifurcation Detection (P55)

### The Problem

As parameters change (learning rate, decay rate, thresholds), the system may undergo **bifurcations**: sudden qualitative changes in behavior.

Examples:
- At some decay rate, stable behavior becomes oscillatory
- At some threshold, the system collapses to always-low-confidence
- Parameter changes can cause sudden loss of retrieval coverage

### Interface Specification

```typescript
/**
 * Bifurcation analysis for parameter sensitivity.
 *
 * INVARIANT: The system must detect approaching bifurcations
 * before catastrophic failures occur.
 */
interface BifurcationAnalysis {
  /** Parameters being analyzed */
  parameters: ParameterDefinition[];

  /** Detected bifurcation points */
  bifurcations: BifurcationPoint[];

  /** Safe operating region in parameter space */
  safeRegion: ParameterRegion;

  /** Early warning indicators for approaching bifurcations */
  earlyWarnings: EarlyWarningIndicator[];

  /** Analysis timestamp */
  analyzedAt: Date;
}

interface ParameterDefinition {
  name: string;
  description: string;
  currentValue: number;
  validRange: [number, number];
  unit: string;
}

/**
 * A bifurcation point where system behavior changes qualitatively.
 */
interface BifurcationPoint {
  /** Which parameter triggers this bifurcation */
  parameterName: string;

  /** Critical value where bifurcation occurs */
  criticalValue: number;

  /** Type of bifurcation */
  type: BifurcationType;

  /** Behavior before the bifurcation */
  behaviorBefore: string;

  /** Behavior after the bifurcation */
  behaviorAfter: string;

  /** Is this a catastrophic (irreversible) bifurcation? */
  catastrophic: boolean;

  /** Distance from current parameter value */
  distanceFromCurrent: number;

  /** Confidence in this bifurcation detection */
  confidence: ConfidenceValue;
}

type BifurcationType =
  | 'saddle-node'      // Fixed point appears/disappears
  | 'hopf'             // Stable point becomes oscillatory
  | 'transcritical'    // Two fixed points exchange stability
  | 'pitchfork'        // Symmetric bifurcation
  | 'period-doubling'  // Route to chaos
  | 'boundary_crisis'; // Attractor collides with boundary

interface EarlyWarningIndicator {
  /** What metric to monitor */
  metric: string;

  /** Threshold for warning */
  threshold: number;

  /** Current value of the metric */
  currentValue: number;

  /** Status assessment */
  status: 'safe' | 'warning' | 'critical';

  /** Confidence in this indicator */
  confidence: ConfidenceValue;

  /** Recommendation if not safe */
  recommendation?: string;
}
```

### Bifurcation Detection Implementation

```typescript
/**
 * Detect approaching bifurcation using early warning signals.
 *
 * Key indicators:
 * 1. Critical slowing down: autocorrelation increases near bifurcation
 * 2. Increased variance: fluctuations grow near bifurcation
 * 3. Flickering: increased transitions between states
 */
function detectApproachingBifurcation(
  timeSeries: number[],
  windowSize: number,
  baseline: BifurcationBaseline
): BifurcationWarning | null {
  if (timeSeries.length < windowSize * 2) {
    return null;
  }

  const recentWindow = timeSeries.slice(-windowSize);
  const baselineWindow = timeSeries.slice(-windowSize * 2, -windowSize);

  // 1. Critical slowing down: autocorrelation increases
  const recentAutocorr = computeAutocorrelation(recentWindow, 1);
  const baselineAutocorr = computeAutocorrelation(baselineWindow, 1);
  const autocorrIncrease = recentAutocorr - baselineAutocorr;

  // 2. Variance increase
  const recentVariance = computeVariance(recentWindow);
  const baselineVariance = computeVariance(baselineWindow);
  const varianceRatio = recentVariance / (baselineVariance + 1e-10);

  // 3. Flickering rate
  const recentFlickering = computeFlickeringRate(recentWindow);
  const baselineFlickering = computeFlickeringRate(baselineWindow);
  const flickeringIncrease = recentFlickering - baselineFlickering;

  // Combine indicators
  const warningScore =
    (autocorrIncrease > baseline.autocorrThreshold ? 0.4 : 0) +
    (varianceRatio > baseline.varianceThreshold ? 0.3 : 0) +
    (flickeringIncrease > baseline.flickeringThreshold ? 0.3 : 0);

  if (warningScore >= 0.5) {
    return {
      warning: 'approaching_bifurcation',
      severity: warningScore >= 0.8 ? 'critical' : 'warning',
      indicators: {
        autocorrelation: {
          current: recentAutocorr,
          baseline: baselineAutocorr,
          change: autocorrIncrease,
        },
        variance: {
          current: recentVariance,
          baseline: baselineVariance,
          ratio: varianceRatio,
        },
        flickering: {
          current: recentFlickering,
          baseline: baselineFlickering,
          change: flickeringIncrease,
        },
      },
      confidence: {
        type: 'derived',
        value: warningScore,
        formula: 'weighted_sum(autocorr, variance, flickering)',
        inputs: [
          { name: 'autocorr_weight', value: { type: 'deterministic', value: 0.4, reason: 'critical_slowing_down' } },
          { name: 'variance_weight', value: { type: 'deterministic', value: 0.3, reason: 'fluctuation_increase' } },
          { name: 'flickering_weight', value: { type: 'deterministic', value: 0.3, reason: 'state_transitions' } },
        ],
      },
      recommendation: 'Reduce parameter change rate. Increase monitoring frequency. Consider rollback.',
    };
  }

  return null;
}

interface BifurcationBaseline {
  autocorrThreshold: number;  // Default: 0.3
  varianceThreshold: number;  // Default: 2.0
  flickeringThreshold: number; // Default: 0.2
}

interface BifurcationWarning {
  warning: 'approaching_bifurcation';
  severity: 'warning' | 'critical';
  indicators: {
    autocorrelation: { current: number; baseline: number; change: number };
    variance: { current: number; baseline: number; ratio: number };
    flickering: { current: number; baseline: number; change: number };
  };
  confidence: ConfidenceValue;
  recommendation: string;
}

/**
 * Identify safe operating region in parameter space.
 */
function computeSafeRegion(
  bifurcations: BifurcationPoint[],
  parameters: ParameterDefinition[],
  safetyMargin: number = 0.1
): ParameterRegion {
  const bounds = new Map<string, [number, number]>();

  for (const param of parameters) {
    const relevantBifurcations = bifurcations.filter(b => b.parameterName === param.name);

    if (relevantBifurcations.length === 0) {
      // No known bifurcations - use full valid range
      bounds.set(param.name, param.validRange);
      continue;
    }

    // Find safe bounds based on bifurcation points
    let safeLow = param.validRange[0];
    let safeHigh = param.validRange[1];

    for (const bif of relevantBifurcations) {
      const margin = Math.abs(bif.criticalValue) * safetyMargin;

      if (bif.criticalValue > param.currentValue) {
        // Bifurcation is above current value
        safeHigh = Math.min(safeHigh, bif.criticalValue - margin);
      } else {
        // Bifurcation is below current value
        safeLow = Math.max(safeLow, bif.criticalValue + margin);
      }
    }

    bounds.set(param.name, [safeLow, safeHigh]);
  }

  return {
    bounds,
    convex: true, // Rectangular regions are convex
    volume: computeRegionVolume(bounds),
  };
}

function computeAutocorrelation(series: number[], lag: number): number {
  const n = series.length;
  if (n <= lag) return 0;

  const mean = series.reduce((a, b) => a + b, 0) / n;
  const centered = series.map(x => x - mean);
  const variance = centered.reduce((a, b) => a + b * b, 0) / n;

  if (variance < 1e-10) return 0;

  let autocorr = 0;
  for (let i = 0; i < n - lag; i++) {
    autocorr += centered[i] * centered[i + lag];
  }

  return autocorr / ((n - lag) * variance);
}

function computeVariance(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;

  const mean = series.reduce((a, b) => a + b, 0) / n;
  return series.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
}

function computeFlickeringRate(series: number[]): number {
  if (series.length < 3) return 0;

  const median = [...series].sort((a, b) => a - b)[Math.floor(series.length / 2)];
  let transitions = 0;

  for (let i = 1; i < series.length; i++) {
    const prevSide = series[i - 1] > median;
    const currSide = series[i] > median;
    if (prevSide !== currSide) transitions++;
  }

  return transitions / (series.length - 1);
}
```

### Acceptance Criteria (S2)

- [ ] Parameter sensitivity analysis for key learning loop parameters
- [ ] Bifurcation point detection via simulation
- [ ] Early warning indicators (autocorrelation, variance, flickering)
- [ ] Safe operating region computation
- [ ] Catastrophic bifurcation flagging
- [ ] Integration with learning_loop.ts monitoring
- [ ] ~250 LOC budget

---

## Part 3: Emergence Metrics (P56)

### The Problem

LiBrainian claims to produce "understanding" through synthesis. But:
- Does the synthesis have causal efficacy, or is it epiphenomenal?
- Is the whole greater than the sum of its parts?
- How do we measure knowledge integration?

### Interface Specification

```typescript
/**
 * Emergence metrics based on Integrated Information Theory.
 *
 * Key insight: True emergence means the macro-level description
 * provides predictive power beyond the micro-level.
 */
interface KnowledgeIntegrationMetrics {
  /** Integrated Information (Phi): measure of irreducibility */
  phi: PhiMeasurement;

  /** Emergence: macro vs micro predictability comparison */
  emergence: EmergenceScore;

  /** Synergy: knowledge that exists only in combination */
  synergy: SynergyMeasurement;

  /** Analysis metadata */
  analyzedAt: Date;
  analysisConfidence: ConfidenceValue;
}

/**
 * Phi (Integrated Information) measurement.
 *
 * Phi measures how much the whole system is more than
 * the sum of its parts. High Phi = highly integrated.
 */
interface PhiMeasurement {
  /** Phi value in bits */
  value: number;

  /** Interpretation of the Phi value */
  interpretation: string;

  /** Minimum Information Partition (MIP) */
  minimumCut: Partition;

  /** Confidence in this measurement */
  confidence: ConfidenceValue;
}

interface Partition {
  /** Parts of the partition */
  parts: string[][];

  /** Information lost by this partition */
  informationLoss: number;
}

/**
 * Emergence score comparing macro and micro predictability.
 */
interface EmergenceScore {
  /** How well macro-level model predicts outcomes */
  macroPredictability: number;

  /** How well micro-level model predicts outcomes */
  microPredictability: number;

  /** Emergence score: how much better is macro level */
  score: number;

  /** Interpretation */
  interpretation: 'strong_emergence' | 'weak_emergence' | 'no_emergence' | 'reduction';

  /** Confidence */
  confidence: ConfidenceValue;
}

/**
 * Synergy measurement: knowledge that exists only in combination.
 */
interface SynergyMeasurement {
  /** Synergy value in bits */
  value: number;

  /** Claims that are synergistic (not derivable from subsets) */
  synergisticClaims: SynergisticClaim[];

  /** Confidence */
  confidence: ConfidenceValue;
}

interface SynergisticClaim {
  /** The claim itself */
  claim: string;

  /** Sources that must be combined */
  requiredSources: string[];

  /** Why this is synergistic */
  reason: string;
}
```

### Emergence Metrics Implementation

```typescript
/**
 * Compute Phi (Integrated Information) for a knowledge system.
 *
 * This is a simplified approximation - true Phi computation
 * is NP-hard in the number of elements.
 */
function computePhi(
  knowledgeGraph: KnowledgeGraph,
  options: { maxPartitions?: number } = {}
): PhiMeasurement {
  const maxPartitions = options.maxPartitions ?? 1000;
  const nodes = knowledgeGraph.nodes;

  if (nodes.length <= 1) {
    return {
      value: 0,
      interpretation: 'Single node: no integration possible',
      minimumCut: { parts: [nodes.map(n => n.id)], informationLoss: 0 },
      confidence: { type: 'deterministic', value: 1.0, reason: 'trivial_case' },
    };
  }

  // Sample partitions (exact computation is exponential)
  const partitions = samplePartitions(nodes.map(n => n.id), maxPartitions);

  let minPhi = Infinity;
  let mip: Partition | null = null;

  for (const partition of partitions) {
    // Compute effective information across this partition
    const ei = computeEffectiveInformation(knowledgeGraph, partition);

    if (ei < minPhi) {
      minPhi = ei;
      mip = { parts: partition, informationLoss: ei };
    }
  }

  const phi = minPhi === Infinity ? 0 : minPhi;

  return {
    value: phi,
    interpretation: interpretPhi(phi),
    minimumCut: mip ?? { parts: [nodes.map(n => n.id)], informationLoss: 0 },
    confidence: {
      type: 'bounded',
      low: phi * 0.8,
      high: phi * 1.2,
      basis: 'theoretical',
      citation: 'Tononi et al. 2016 - IIT approximation bounds',
    },
  };
}

function interpretPhi(phi: number): string {
  if (phi < 0.1) return 'System is nearly decomposable into independent parts';
  if (phi < 1.0) return `Weak integration: ${phi.toFixed(2)} bits irreducible`;
  if (phi < 5.0) return `Moderate integration: ${phi.toFixed(2)} bits irreducible`;
  return `Strong integration: ${phi.toFixed(2)} bits irreducible`;
}

/**
 * Compute emergence score by comparing macro vs micro predictability.
 */
function computeEmergenceScore(
  macroModel: PredictiveModel,
  microModel: PredictiveModel,
  testCases: TestCase[]
): EmergenceScore {
  if (testCases.length === 0) {
    return {
      macroPredictability: 0,
      microPredictability: 0,
      score: 0,
      interpretation: 'no_emergence',
      confidence: { type: 'absent', reason: 'insufficient_data' },
    };
  }

  // Evaluate both models on test cases
  let macroCorrect = 0;
  let microCorrect = 0;

  for (const testCase of testCases) {
    const macroPrediction = macroModel.predict(testCase.input);
    const microPrediction = microModel.predict(testCase.input);

    if (macroPrediction === testCase.expectedOutput) macroCorrect++;
    if (microPrediction === testCase.expectedOutput) microCorrect++;
  }

  const macroPredictability = macroCorrect / testCases.length;
  const microPredictability = microCorrect / testCases.length;
  const score = macroPredictability - microPredictability;

  let interpretation: EmergenceScore['interpretation'];
  if (score > 0.2) interpretation = 'strong_emergence';
  else if (score > 0.05) interpretation = 'weak_emergence';
  else if (score > -0.05) interpretation = 'no_emergence';
  else interpretation = 'reduction';

  return {
    macroPredictability,
    microPredictability,
    score,
    interpretation,
    confidence: {
      type: 'measured',
      value: 1 - 1.96 * Math.sqrt(macroPredictability * (1 - macroPredictability) / testCases.length),
      measurement: {
        datasetId: 'emergence_test',
        sampleSize: testCases.length,
        accuracy: macroPredictability,
        confidenceInterval: wilsonScoreInterval(macroCorrect, testCases.length),
        measuredAt: new Date(),
      },
    },
  };
}

/**
 * Detect synergy: claims that emerge only from combination of sources.
 */
function detectSynergy(
  synthesizedClaims: Claim[],
  sourceClaims: Map<string, Claim[]>
): SynergyMeasurement {
  const synergisticClaims: SynergisticClaim[] = [];
  let totalSynergy = 0;

  for (const claim of synthesizedClaims) {
    // Check if claim is derivable from any single source
    let derivableFromSingle = false;
    for (const [sourceId, claims] of sourceClaims) {
      if (isDerivableFrom(claim, claims)) {
        derivableFromSingle = true;
        break;
      }
    }

    if (!derivableFromSingle) {
      // Check if derivable from combination
      const allSourceClaims = Array.from(sourceClaims.values()).flat();
      if (isDerivableFrom(claim, allSourceClaims)) {
        // This is a synergistic claim
        synergisticClaims.push({
          claim: claim.content,
          requiredSources: Array.from(sourceClaims.keys()),
          reason: 'Not derivable from any single source, but derivable from combination',
        });
        totalSynergy += estimateClaimInformation(claim);
      }
    }
  }

  return {
    value: totalSynergy,
    synergisticClaims,
    confidence: {
      type: 'derived',
      value: synergisticClaims.length / Math.max(synthesizedClaims.length, 1),
      formula: 'synergistic_count / total_claims',
      inputs: [
        { name: 'synergistic_count', value: { type: 'deterministic', value: synergisticClaims.length, reason: 'count' } },
        { name: 'total_claims', value: { type: 'deterministic', value: synthesizedClaims.length, reason: 'count' } },
      ],
    },
  };
}

/**
 * Test causal efficacy of synthesis output.
 *
 * Does the synthesis actually affect agent behavior,
 * or is it epiphenomenal (has no causal effect)?
 */
function testCausalEfficacy(
  synthesisOutput: SynthesisResult,
  agentBehavior: AgentBehaviorTrace,
  controlBehavior: AgentBehaviorTrace
): CausalEfficacyResult {
  // Compare agent behavior with synthesis vs without (control)
  const behaviorDivergence = computeBehaviorDivergence(agentBehavior, controlBehavior);

  // Check if divergence correlates with synthesis content
  const contentCorrelation = computeContentBehaviorCorrelation(
    synthesisOutput,
    agentBehavior
  );

  const hasCausalEfficacy = behaviorDivergence > 0.1 && contentCorrelation > 0.3;

  return {
    hasCausalEfficacy,
    behaviorDivergence,
    contentCorrelation,
    confidence: {
      type: 'measured',
      value: hasCausalEfficacy ? contentCorrelation : 1 - behaviorDivergence,
      measurement: {
        datasetId: 'causal_efficacy_test',
        sampleSize: 1,
        accuracy: contentCorrelation,
        confidenceInterval: [contentCorrelation - 0.2, contentCorrelation + 0.2] as [number, number],
        measuredAt: new Date(),
      },
    },
    interpretation: hasCausalEfficacy
      ? 'Synthesis has causal effect on agent behavior'
      : 'Synthesis may be epiphenomenal (no measurable causal effect)',
  };
}

interface CausalEfficacyResult {
  hasCausalEfficacy: boolean;
  behaviorDivergence: number;
  contentCorrelation: number;
  confidence: ConfidenceValue;
  interpretation: string;
}
```

### Acceptance Criteria (S3)

- [ ] Phi (Integrated Information) computation
- [ ] Emergence score comparing macro vs micro models
- [ ] Synergy detection for synthesized claims
- [ ] Causal efficacy testing framework
- [ ] Integration with epistemics module
- [ ] ~200 LOC budget

---

## Part 4: Resilience & Recovery (P57)

### The Problem

The document discusses degradation modes but not **resilience**: the system's ability to recover from perturbations.

Questions unanswered:
- How does the system recover from corrupted knowledge?
- What is the basin of attraction for healthy operation?
- How large a perturbation can the system absorb?

### Interface Specification

```typescript
/**
 * Resilience metrics for the knowledge system.
 *
 * INVARIANT: A resilient system must recover from bounded
 * perturbations within finite time.
 */
interface ResilienceMetrics {
  /** Recovery time from various perturbation sizes */
  recoveryTime: RecoveryTimeMetrics;

  /** Basin of attraction for healthy operation */
  attractorBasin: AttractorBasinMetrics;

  /** Adaptive capacity of the system */
  adaptiveCapacity: AdaptiveCapacityMetrics;

  /** Overall resilience score */
  overallScore: ConfidenceValue;
}

interface RecoveryTimeMetrics {
  /** Time to recover from 10% corruption */
  smallPerturbation: RecoveryMeasurement;

  /** Time to recover from 50% corruption */
  mediumPerturbation: RecoveryMeasurement;

  /** Time to recover from 90% corruption */
  largePerturbation: RecoveryMeasurement;

  /** Perturbation size that causes permanent damage */
  nonRecoverableThreshold: number;
}

interface RecoveryMeasurement {
  /** Time steps to recovery (or null if not recoverable) */
  timeSteps: number | null;

  /** Confidence in this measurement */
  confidence: ConfidenceValue;

  /** What constitutes "recovered" */
  recoveryCriteria: string;
}

interface AttractorBasinMetrics {
  /** Region of state space from which system recovers */
  healthyOperationRegion: ParameterRegion;

  /** Distance from current state to boundary of healthy region */
  marginToFailure: number;

  /** Parameters that most affect the margin */
  criticalParameters: CriticalParameter[];
}

interface CriticalParameter {
  name: string;
  currentValue: number;
  safeRange: [number, number];
  sensitivity: number; // How much margin changes per unit parameter change
}

interface AdaptiveCapacityMetrics {
  /** How quickly the system learns from new data */
  learningRate: ConfidenceValue;

  /** How well system handles novel patterns */
  noveltyAbsorption: ConfidenceValue;

  /** How far back system can effectively learn from */
  memoryHorizon: number;
}
```

### Resilience Testing Implementation

```typescript
/**
 * Perturbation testing framework for resilience analysis.
 */
interface Perturbation {
  type: 'noise' | 'corruption' | 'deletion' | 'drift' | 'adversarial';
  magnitude: number; // 0.0 to 1.0
  target: 'confidence' | 'knowledge' | 'parameters' | 'all';
  description: string;
}

interface ResilienceTest {
  perturbation: Perturbation;
  preState: SystemState;
  postPerturbationState: SystemState;
  recoveryTrajectory: SystemState[];
  recovered: boolean;
  recoveryTime: number | null;
  permanentDamage: string[];
}

/**
 * Run resilience tests on the learning system.
 */
async function testResilience(
  system: LearningLoopSystem,
  perturbations: Perturbation[],
  maxRecoverySteps: number = 100
): Promise<ResilienceReport> {
  const results: ResilienceTest[] = [];

  for (const perturbation of perturbations) {
    // Capture pre-state
    const preState = await captureSystemState(system);

    // Apply perturbation
    await applyPerturbation(system, perturbation);
    const postPerturbationState = await captureSystemState(system);

    // Simulate recovery
    const trajectory: SystemState[] = [];
    let recovered = false;
    let recoveryTime: number | null = null;

    for (let t = 0; t < maxRecoverySteps; t++) {
      // Run one step of normal operation
      await system.step();
      const currentState = await captureSystemState(system);
      trajectory.push(currentState);

      // Check if recovered
      if (isHealthyState(currentState, preState)) {
        recovered = true;
        recoveryTime = t + 1;
        break;
      }
    }

    // Identify permanent damage
    const permanentDamage = identifyPermanentDamage(preState, trajectory[trajectory.length - 1] ?? postPerturbationState);

    results.push({
      perturbation,
      preState,
      postPerturbationState,
      recoveryTrajectory: trajectory,
      recovered,
      recoveryTime,
      permanentDamage,
    });
  }

  return analyzeResilienceResults(results);
}

/**
 * Apply a perturbation to the system.
 */
async function applyPerturbation(
  system: LearningLoopSystem,
  perturbation: Perturbation
): Promise<void> {
  switch (perturbation.type) {
    case 'noise':
      await addNoiseToConfidences(system, perturbation.magnitude);
      break;
    case 'corruption':
      await corruptKnowledge(system, perturbation.magnitude);
      break;
    case 'deletion':
      await deleteKnowledge(system, perturbation.magnitude);
      break;
    case 'drift':
      await applyDistributionDrift(system, perturbation.magnitude);
      break;
    case 'adversarial':
      await applyAdversarialPerturbation(system, perturbation.magnitude);
      break;
  }
}

async function addNoiseToConfidences(
  system: LearningLoopSystem,
  magnitude: number
): Promise<void> {
  const state = await system.getState();
  for (const entry of Object.values(state.global.compositions)) {
    entry.successes = Math.max(0, entry.successes + Math.round((Math.random() - 0.5) * magnitude * 10));
    entry.failures = Math.max(0, entry.failures + Math.round((Math.random() - 0.5) * magnitude * 10));
  }
  await system.setState(state);
}

async function corruptKnowledge(
  system: LearningLoopSystem,
  magnitude: number
): Promise<void> {
  const state = await system.getState();
  const keys = Object.keys(state.global.compositions);
  const numToCorrupt = Math.floor(keys.length * magnitude);

  for (let i = 0; i < numToCorrupt; i++) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    // Invert success/failure counts (corrupt the learning)
    const entry = state.global.compositions[key];
    const temp = entry.successes;
    entry.successes = entry.failures;
    entry.failures = temp;
  }

  await system.setState(state);
}

/**
 * Compute basin of attraction for healthy operation.
 */
function computeAttractorBasin(
  resilienceTests: ResilienceTest[]
): AttractorBasinMetrics {
  // Group by perturbation magnitude
  const byMagnitude = new Map<number, ResilienceTest[]>();
  for (const test of resilienceTests) {
    const mag = Math.round(test.perturbation.magnitude * 10) / 10;
    if (!byMagnitude.has(mag)) byMagnitude.set(mag, []);
    byMagnitude.get(mag)!.push(test);
  }

  // Find threshold where recovery rate drops below 50%
  let thresholdMagnitude = 1.0;
  for (const [mag, tests] of Array.from(byMagnitude.entries()).sort((a, b) => a[0] - b[0])) {
    const recoveryRate = tests.filter(t => t.recovered).length / tests.length;
    if (recoveryRate < 0.5) {
      thresholdMagnitude = mag;
      break;
    }
  }

  return {
    healthyOperationRegion: {
      bounds: new Map([
        ['perturbation_magnitude', [0, thresholdMagnitude]],
      ]),
      convex: true,
      volume: thresholdMagnitude,
    },
    marginToFailure: thresholdMagnitude,
    criticalParameters: identifyCriticalParameters(resilienceTests),
  };
}

function identifyCriticalParameters(tests: ResilienceTest[]): CriticalParameter[] {
  // Analyze which perturbation types cause most damage
  const byType = new Map<string, { recovered: number; total: number }>();

  for (const test of tests) {
    const key = test.perturbation.type;
    if (!byType.has(key)) byType.set(key, { recovered: 0, total: 0 });
    const entry = byType.get(key)!;
    entry.total++;
    if (test.recovered) entry.recovered++;
  }

  const parameters: CriticalParameter[] = [];
  for (const [type, stats] of byType) {
    const recoveryRate = stats.recovered / stats.total;
    parameters.push({
      name: `${type}_perturbation`,
      currentValue: 0,
      safeRange: [0, recoveryRate > 0.5 ? 0.5 : 0.3],
      sensitivity: 1 - recoveryRate,
    });
  }

  return parameters.sort((a, b) => b.sensitivity - a.sensitivity);
}

/**
 * Standard perturbation suite for testing.
 */
const STANDARD_PERTURBATION_SUITE: Perturbation[] = [
  // Small perturbations
  { type: 'noise', magnitude: 0.1, target: 'confidence', description: '10% noise on confidence values' },
  { type: 'corruption', magnitude: 0.1, target: 'knowledge', description: '10% knowledge corruption' },
  { type: 'deletion', magnitude: 0.1, target: 'knowledge', description: '10% knowledge deletion' },

  // Medium perturbations
  { type: 'noise', magnitude: 0.3, target: 'confidence', description: '30% noise on confidence values' },
  { type: 'corruption', magnitude: 0.3, target: 'knowledge', description: '30% knowledge corruption' },
  { type: 'drift', magnitude: 0.3, target: 'all', description: '30% distribution drift' },

  // Large perturbations
  { type: 'noise', magnitude: 0.5, target: 'confidence', description: '50% noise on confidence values' },
  { type: 'corruption', magnitude: 0.5, target: 'knowledge', description: '50% knowledge corruption' },

  // Extreme perturbations
  { type: 'corruption', magnitude: 0.9, target: 'knowledge', description: '90% knowledge corruption' },
  { type: 'adversarial', magnitude: 0.5, target: 'all', description: 'Adversarial attack' },
];
```

### Acceptance Criteria (S4)

- [ ] Perturbation testing framework
- [ ] Recovery time measurement for various perturbation sizes
- [ ] Basin of attraction computation
- [ ] Adaptive capacity metrics
- [ ] Standard perturbation test suite
- [ ] Integration with learning_loop.ts
- [ ] ~250 LOC budget

---

## Integration Points

### learning_loop.ts Integration

```typescript
// In learning_loop.ts, add stability monitoring hooks

interface LearningLoopWithDynamics extends LearningLoop {
  /** Get stability analysis for current state */
  getStabilityAnalysis(): Promise<SystemStabilityAnalysis>;

  /** Get bifurcation warnings */
  getBifurcationWarnings(): Promise<BifurcationWarning[]>;

  /** Run resilience test suite */
  runResilienceTests(suite?: Perturbation[]): Promise<ResilienceReport>;

  /** Subscribe to stability events */
  onStabilityEvent(handler: (event: StabilityEvent) => void): void;
}

type StabilityEvent =
  | { type: 'oscillation_detected'; details: OscillationDetectionResult }
  | { type: 'divergence_detected'; details: DivergenceDetectionResult }
  | { type: 'collapse_detected'; details: CollapseDetectionResult }
  | { type: 'bifurcation_warning'; details: BifurcationWarning };
```

### Epistemics Module Integration

```typescript
// Emergence metrics tie into the epistemics module

interface EpistemicsWithEmergence {
  /** Compute emergence score for a synthesis result */
  measureEmergence(synthesis: SynthesisResult): Promise<EmergenceScore>;

  /** Compute Phi for current knowledge state */
  measureIntegration(): Promise<PhiMeasurement>;

  /** Test causal efficacy of synthesis */
  testCausalEfficacy(
    synthesis: SynthesisResult,
    agentTrace: AgentBehaviorTrace
  ): Promise<CausalEfficacyResult>;
}
```

### Calibration Integration

```typescript
// Track F calibration feeds into Track J dynamics

interface CalibrationWithDynamics {
  /** Get confidence time series for stability analysis */
  getConfidenceTimeSeries(window: number): Promise<number[]>;

  /** Get calibration error time series */
  getCalibrationErrorTimeSeries(window: number): Promise<number[]>;

  /** Report stability metrics to calibration */
  reportStabilityMetrics(metrics: SystemStabilityAnalysis): Promise<void>;
}
```

---

## Implementation Roadmap

### Research Track (S1-S3)

These features require theoretical foundations and are not production-ready:

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| **R1** | Research | Formalize learning loop as dynamical system |
| **R2** | Research | Prove stability bounds for confidence update rule |
| **R3** | Research | Implement bifurcation detection prototype |
| **R4** | Research | Validate emergence metrics on synthetic data |
| **R5** | Research | Publish findings / internal documentation |

### Production Track (S4)

Resilience testing has immediate production value:

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| **P1** | Week 1 | Perturbation framework implementation |
| **P2** | Week 2 | Standard test suite and baseline metrics |
| **P3** | Week 3 | Integration with CI/CD (chaos testing) |
| **P4** | Week 4 | Alerting and monitoring dashboards |

### Dependencies

```
Track D (ConfidenceValue) ────┐
                              ├──> Track J S1 (Stability)
Track F (Calibration) ────────┤
                              ├──> Track J S2 (Bifurcation) ──> S4 (Resilience)
learning_loop.ts ─────────────┤
                              └──> Track J S3 (Emergence)
epistemics module ────────────┘
```

---

## The 25 Greats' Verdict

**Prigogine**: "A system far from equilibrium can exhibit bifurcations, oscillations, and emergence. Without understanding these dynamics, LiBrainian is flying blind."

**Strogatz**: "The confidence-outcome feedback loop is a classic nonlinear dynamical system. Stability analysis is not optional - it's fundamental."

**Kauffman**: "At the edge of chaos, complex systems can exhibit both stability and adaptability. LiBrainian needs to find this edge, not stumble into it."

**Tononi**: "Integrated Information Theory provides the tools to measure whether synthesis is truly integrated or merely aggregated. Phi distinguishes understanding from retrieval."

**Holling**: "Resilience is not just recovering from perturbation - it's maintaining function across scales of disturbance. Basin of attraction analysis is essential."

---

## Summary

Track J System Dynamics Analysis addresses fundamental questions about LiBrainian's behavior as a dynamical system:

1. **S1 (Stability Analysis)**: Is the learning loop stable? Can it oscillate, diverge, or collapse?
2. **S2 (Bifurcation Detection)**: When do parameter changes cause catastrophic failures?
3. **S3 (Emergence Metrics)**: Does synthesis produce genuine understanding or just aggregation?
4. **S4 (Resilience & Recovery)**: How does the system recover from corruption?

**Total estimated LOC**: ~1000

**Research vs Production**: S1-S3 are research-grade features requiring theoretical validation. S4 (Resilience) has immediate production applicability for chaos testing and reliability engineering.

Without dynamics analysis, LiBrainian operates as a black box that could fail catastrophically at any moment. With it, we gain predictive understanding of system behavior and early warning of approaching failures.
