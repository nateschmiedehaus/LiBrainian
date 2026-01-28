export interface DiscoveredCausalRelationship {
  cause: string;
  effect: string;
  discoveryMethod: 'pc_algorithm' | 'ic_algorithm' | 'llm_inference' | 'intervention_test';
  evidence: {
    observationCount: number;
    conditionalProbability: number;
    baseRate: number;
    liftRatio: number;
  };
  causalConfidence: number;
  potentialConfounders: string[];
  verificationExperiment?: string;
}

export interface GitCommitEvent {
  id: string;
  filesChanged: string[];
  failedTests?: string[];
}

export interface GitHistory {
  commits: GitCommitEvent[];
}

export interface TestRun {
  id: string;
  changedFiles: string[];
  failedTests: string[];
}

export interface MetricObservation {
  timestamp: string;
  value: number;
  changedFiles?: string[];
}

export interface MetricTimeSeries {
  metric: string;
  observations: MetricObservation[];
  spikeThreshold?: number;
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
}

const MIN_CAUSE_OBSERVATIONS = 3;
const MIN_EFFECT_OBSERVATIONS = 3;
const MIN_JOINT_OBSERVATIONS = 2;
const MIN_LIFT = 1.5;

export class CausalDiscoveryEngine {
  async discoverFromGitHistory(history: GitHistory): Promise<DiscoveredCausalRelationship[]> {
    const observations = history.commits
      .filter((commit) => Array.isArray(commit.failedTests) && commit.failedTests.length > 0)
      .map((commit) => ({
        causes: commit.filesChanged,
        effects: commit.failedTests ?? [],
      }));
    return discoverFromObservations(observations);
  }

  async discoverFromTestResults(testRuns: TestRun[]): Promise<DiscoveredCausalRelationship[]> {
    const observations = testRuns.map((run) => ({
      causes: run.changedFiles,
      effects: run.failedTests,
    }));
    return discoverFromObservations(observations);
  }

  async discoverFromProductionMetrics(series: MetricTimeSeries[]): Promise<DiscoveredCausalRelationship[]> {
    const observations: Array<{ causes: string[]; effects: string[] }> = [];
    for (const metric of series) {
      const threshold = metric.spikeThreshold;
      if (!Number.isFinite(threshold) || threshold === undefined || threshold <= 0) {
        continue;
      }
      for (let i = 1; i < metric.observations.length; i += 1) {
        const prev = metric.observations[i - 1];
        const current = metric.observations[i];
        const delta = current.value - prev.value;
        if (Math.abs(delta) < threshold) continue;
        if (!current.changedFiles || current.changedFiles.length === 0) continue;
        observations.push({
          causes: current.changedFiles,
          effects: [`metric:${metric.metric}`],
        });
      }
    }
    return discoverFromObservations(observations);
  }

  async verifyByIntervention(
    _relationship: DiscoveredCausalRelationship
  ): Promise<VerificationResult> {
    return {
      verified: false,
      reason: 'unverified_by_trace(intervention_unimplemented)',
    };
  }
}

type Observation = { causes: string[]; effects: string[] };

function discoverFromObservations(observations: Observation[]): DiscoveredCausalRelationship[] {
  if (observations.length === 0) return [];
  const total = observations.length;
  const causeCounts = new Map<string, number>();
  const effectCounts = new Map<string, number>();
  const jointCounts = new Map<string, number>();

  for (const observation of observations) {
    const causes = new Set(observation.causes.filter(Boolean));
    const effects = new Set(observation.effects.filter(Boolean));
    for (const cause of causes) {
      causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
    }
    for (const effect of effects) {
      effectCounts.set(effect, (effectCounts.get(effect) ?? 0) + 1);
    }
    for (const cause of causes) {
      for (const effect of effects) {
        const key = `${cause}:::${effect}`;
        jointCounts.set(key, (jointCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const results: DiscoveredCausalRelationship[] = [];
  for (const [key, joint] of jointCounts.entries()) {
    const [cause, effect] = key.split(':::');
    const causeCount = causeCounts.get(cause) ?? 0;
    const effectCount = effectCounts.get(effect) ?? 0;
    if (causeCount < MIN_CAUSE_OBSERVATIONS) continue;
    if (effectCount < MIN_EFFECT_OBSERVATIONS) continue;
    if (joint < MIN_JOINT_OBSERVATIONS) continue;
    const conditional = joint / causeCount;
    const baseRate = effectCount / total;
    const lift = baseRate > 0 ? conditional / baseRate : 0;
    if (lift < MIN_LIFT) continue;

    results.push({
      cause,
      effect,
      discoveryMethod: 'pc_algorithm',
      evidence: {
        observationCount: total,
        conditionalProbability: conditional,
        baseRate,
        liftRatio: lift,
      },
      causalConfidence: deriveConfidence(joint, lift),
      potentialConfounders: [
        'co-change correlation',
        'shared dependency updates',
        'environmental changes',
      ],
      verificationExperiment: `Change ${cause} in isolation and observe ${effect}`,
    });
  }

  return results;
}

function deriveConfidence(jointCount: number, liftRatio: number): number {
  const liftScore = Math.min(1, Math.max(0, (liftRatio - 1) / 2));
  const sampleScore = Math.min(1, jointCount / 10);
  return Math.max(0, Math.min(1, liftScore * sampleScore));
}
