export type TestingTrackerStatus = 'fixed' | 'open' | 'unknown';

export interface TestingTrackerArtifact<T> {
  present: boolean;
  path?: string;
  parseError?: string;
  data?: T;
}

interface AbLiftSignificanceLike {
  statisticallySignificant?: boolean | null;
  sampleSizeAdequate?: boolean;
}

interface AbLiftLike {
  successRateLift?: number;
  absoluteSuccessRateDelta?: number;
  controlSuccessRate?: number;
  treatmentSuccessRate?: number;
  timeReduction?: number;
  agentCommandTimeReduction?: number;
  significance?: AbLiftSignificanceLike;
}

interface AbReportLike {
  gates?: {
    thresholds?: {
      requireT3CeilingTimeReduction?: boolean;
    };
  };
  diagnostics?: {
    verificationFallbackShare?: number;
    artifactIntegrityShare?: number;
    agentVerifiedExecutionShare?: number;
    failureReasons?: Record<string, number>;
    criticalFailureReasons?: Record<string, number>;
  };
  t3PlusLift?: AbLiftLike | null;
}

interface UseCaseReportLike {
  summary?: {
    strictFailureShare?: number;
  };
}

interface LiveFireReportLike {
  gates?: {
    passed?: boolean;
  };
}

interface SmokeReportLike {
  summary?: {
    failures?: number;
  };
}

interface TestingDisciplineReportLike {
  passed?: boolean;
  summary?: {
    failedBlockingChecks?: number;
  };
}

interface PublishGateReportLike {
  passed?: boolean;
  summary?: {
    blockerCount?: number;
    warningCount?: number;
  };
}

export interface TestingTrackerInput {
  generatedAt?: string;
  artifacts: {
    ab: TestingTrackerArtifact<AbReportLike>;
    useCase: TestingTrackerArtifact<UseCaseReportLike>;
    liveFire: TestingTrackerArtifact<LiveFireReportLike>;
    smoke: TestingTrackerArtifact<SmokeReportLike>;
    testingDiscipline: TestingTrackerArtifact<TestingDisciplineReportLike>;
    publishGate: TestingTrackerArtifact<PublishGateReportLike>;
  };
}

export interface TestingTrackerFlaw {
  id: string;
  title: string;
  status: TestingTrackerStatus;
  evidence: string;
}

export interface TestingTrackerReport {
  schema: 'TestingTrackerReport.v1';
  generatedAt: string;
  artifacts: Array<{
    id: keyof TestingTrackerInput['artifacts'];
    present: boolean;
    path?: string;
    parseError?: string;
  }>;
  flaws: TestingTrackerFlaw[];
  summary: {
    fixedCount: number;
    openCount: number;
    unknownCount: number;
    publishReady: boolean;
  };
}

const AB_SUCCESS_SATURATION_RATE = 0.999;
const MIN_T3_SUCCESS_RATE_LIFT = 0.25;
const MIN_T3_CEILING_TIME_REDUCTION = 0.01;

function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(3) : String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return 'missing';
  return String(value);
}

function createFlaw(
  id: string,
  title: string,
  status: TestingTrackerStatus,
  evidence: string
): TestingTrackerFlaw {
  return { id, title, status, evidence };
}

function evaluateAbSuperiority(artifact: TestingTrackerArtifact<AbReportLike>): TestingTrackerFlaw {
  if (!artifact.present || !artifact.data) {
    return createFlaw(
      'ab_superiority_signal',
      'A/B superiority signal',
      'unknown',
      'A/B report missing'
    );
  }

  const lift = artifact.data.t3PlusLift;
  if (!lift) {
    return createFlaw(
      'ab_superiority_signal',
      'A/B superiority signal',
      'unknown',
      't3PlusLift missing'
    );
  }

  const controlSuccessRate = lift.controlSuccessRate;
  const treatmentSuccessRate = lift.treatmentSuccessRate;
  const absoluteDelta = lift.absoluteSuccessRateDelta;
  const successRateLift = lift.successRateLift;
  const sampleSizeAdequate = lift.significance?.sampleSizeAdequate;
  const statisticallySignificant = lift.significance?.statisticallySignificant;
  const timeReduction = lift.timeReduction;
  const agentTimeReduction = lift.agentCommandTimeReduction;
  const successCeilingReached = typeof controlSuccessRate === 'number'
    && typeof treatmentSuccessRate === 'number'
    && typeof absoluteDelta === 'number'
    && controlSuccessRate >= AB_SUCCESS_SATURATION_RATE
    && treatmentSuccessRate >= AB_SUCCESS_SATURATION_RATE
    && Math.abs(absoluteDelta) < 1e-9;
  const requireCeilingTimeReduction = artifact.data.gates?.thresholds?.requireT3CeilingTimeReduction !== false;

  if (successCeilingReached) {
    if (!requireCeilingTimeReduction) {
      const pass = sampleSizeAdequate === true;
      return createFlaw(
        'ab_superiority_signal',
        'A/B superiority signal',
        pass ? 'fixed' : 'open',
        `ceiling_mode=true, requireCeilingTimeReduction=false, sampleSizeAdequate=${formatValue(sampleSizeAdequate)}`
      );
    }
    const effectiveTimeReduction = Math.max(
      typeof timeReduction === 'number' ? timeReduction : Number.NEGATIVE_INFINITY,
      typeof agentTimeReduction === 'number' ? agentTimeReduction : Number.NEGATIVE_INFINITY
    );
    const pass = effectiveTimeReduction >= MIN_T3_CEILING_TIME_REDUCTION && sampleSizeAdequate === true;
    return createFlaw(
      'ab_superiority_signal',
      'A/B superiority signal',
      pass ? 'fixed' : 'open',
      `ceiling_mode=true, effectiveTimeReduction=${formatValue(effectiveTimeReduction)}, sampleSizeAdequate=${formatValue(sampleSizeAdequate)}`
    );
  }

  if (
    typeof successRateLift !== 'number'
    || sampleSizeAdequate === undefined
    || statisticallySignificant === undefined
  ) {
    return createFlaw(
      'ab_superiority_signal',
      'A/B superiority signal',
      'unknown',
      `lift=${formatValue(successRateLift)}, sampleSizeAdequate=${formatValue(sampleSizeAdequate)}, significant=${formatValue(statisticallySignificant)}`
    );
  }

  const pass = successRateLift >= MIN_T3_SUCCESS_RATE_LIFT
    && sampleSizeAdequate === true
    && statisticallySignificant === true;

  return createFlaw(
    'ab_superiority_signal',
    'A/B superiority signal',
    pass ? 'fixed' : 'open',
    `lift=${formatValue(successRateLift)}, minLift=${MIN_T3_SUCCESS_RATE_LIFT.toFixed(3)}, sampleSizeAdequate=${formatValue(sampleSizeAdequate)}, significant=${formatValue(statisticallySignificant)}`
  );
}

export function buildTestingTrackerReport(input: TestingTrackerInput): TestingTrackerReport {
  const artifacts = input.artifacts;

  const flaws: TestingTrackerFlaw[] = [];

  if (!artifacts.ab.present || !artifacts.ab.data) {
    flaws.push(createFlaw('ab_fallback_control', 'A/B fallback control', 'unknown', 'A/B report missing'));
    flaws.push(createFlaw('ab_artifact_integrity', 'A/B artifact integrity', 'unknown', 'A/B report missing'));
    flaws.push(createFlaw('ab_verified_execution', 'A/B verified execution share', 'unknown', 'A/B report missing'));
    flaws.push(createFlaw('ab_timeout_fragility', 'A/B timeout fragility', 'unknown', 'A/B report missing'));
    flaws.push(evaluateAbSuperiority(artifacts.ab));
  } else {
    const diagnostics = artifacts.ab.data.diagnostics ?? {};
    const fallbackShare = diagnostics.verificationFallbackShare;
    const artifactIntegrityShare = diagnostics.artifactIntegrityShare;
    const verifiedExecutionShare = diagnostics.agentVerifiedExecutionShare;
    const failureReasons = diagnostics.failureReasons ?? {};
    const criticalFailureReasons = diagnostics.criticalFailureReasons ?? {};
    const timeoutFailures = (failureReasons.agent_command_timeout ?? 0) + (criticalFailureReasons.agent_command_timeout ?? 0);

    if (typeof fallbackShare !== 'number') {
      flaws.push(createFlaw('ab_fallback_control', 'A/B fallback control', 'unknown', 'verificationFallbackShare missing'));
    } else {
      flaws.push(createFlaw(
        'ab_fallback_control',
        'A/B fallback control',
        fallbackShare === 0 ? 'fixed' : 'open',
        `verificationFallbackShare=${formatValue(fallbackShare)}`
      ));
    }

    if (typeof artifactIntegrityShare !== 'number') {
      flaws.push(createFlaw('ab_artifact_integrity', 'A/B artifact integrity', 'unknown', 'artifactIntegrityShare missing'));
    } else {
      flaws.push(createFlaw(
        'ab_artifact_integrity',
        'A/B artifact integrity',
        artifactIntegrityShare === 1 ? 'fixed' : 'open',
        `artifactIntegrityShare=${formatValue(artifactIntegrityShare)}`
      ));
    }

    if (typeof verifiedExecutionShare !== 'number') {
      flaws.push(createFlaw('ab_verified_execution', 'A/B verified execution share', 'unknown', 'agentVerifiedExecutionShare missing'));
    } else {
      flaws.push(createFlaw(
        'ab_verified_execution',
        'A/B verified execution share',
        verifiedExecutionShare === 1 ? 'fixed' : 'open',
        `agentVerifiedExecutionShare=${formatValue(verifiedExecutionShare)}`
      ));
    }

    flaws.push(createFlaw(
      'ab_timeout_fragility',
      'A/B timeout fragility',
      timeoutFailures === 0 ? 'fixed' : 'open',
      `agent_command_timeout_count=${timeoutFailures}`
    ));

    flaws.push(evaluateAbSuperiority(artifacts.ab));
  }

  if (!artifacts.useCase.present || !artifacts.useCase.data) {
    flaws.push(createFlaw(
      'use_case_strict_marker_control',
      'Use-case strict marker control',
      'unknown',
      'Use-case report missing'
    ));
  } else {
    const strictFailureShare = artifacts.useCase.data.summary?.strictFailureShare;
    if (typeof strictFailureShare !== 'number') {
      flaws.push(createFlaw('use_case_strict_marker_control', 'Use-case strict marker control', 'unknown', 'strictFailureShare missing'));
    } else {
      flaws.push(createFlaw(
        'use_case_strict_marker_control',
        'Use-case strict marker control',
        strictFailureShare === 0 ? 'fixed' : 'open',
        `strictFailureShare=${formatValue(strictFailureShare)}`
      ));
    }
  }

  if (!artifacts.liveFire.present || !artifacts.liveFire.data) {
    flaws.push(createFlaw('live_fire_gate', 'Live-fire gate', 'unknown', 'Live-fire report missing'));
  } else {
    const passed = artifacts.liveFire.data.gates?.passed;
    flaws.push(createFlaw(
      'live_fire_gate',
      'Live-fire gate',
      passed === true ? 'fixed' : 'open',
      `gates.passed=${formatValue(passed)}`
    ));
  }

  if (!artifacts.smoke.present || !artifacts.smoke.data) {
    flaws.push(createFlaw('external_smoke_reliability', 'External smoke reliability', 'unknown', 'Smoke report missing'));
  } else {
    const failures = artifacts.smoke.data.summary?.failures;
    if (typeof failures !== 'number') {
      flaws.push(createFlaw('external_smoke_reliability', 'External smoke reliability', 'unknown', 'summary.failures missing'));
    } else {
      flaws.push(createFlaw(
        'external_smoke_reliability',
        'External smoke reliability',
        failures === 0 ? 'fixed' : 'open',
        `summary.failures=${failures}`
      ));
    }
  }

  if (!artifacts.testingDiscipline.present || !artifacts.testingDiscipline.data) {
    flaws.push(createFlaw('testing_discipline_gate', 'Testing discipline gate', 'unknown', 'Testing-discipline report missing'));
  } else {
    const passed = artifacts.testingDiscipline.data.passed;
    const failedBlockingChecks = artifacts.testingDiscipline.data.summary?.failedBlockingChecks;
    const status = passed === true && failedBlockingChecks === 0 ? 'fixed' : 'open';
    flaws.push(createFlaw(
      'testing_discipline_gate',
      'Testing discipline gate',
      status,
      `passed=${formatValue(passed)}, failedBlockingChecks=${formatValue(failedBlockingChecks)}`
    ));
  }

  const fixedCount = flaws.filter((item) => item.status === 'fixed').length;
  const openCount = flaws.filter((item) => item.status === 'open').length;
  const unknownCount = flaws.filter((item) => item.status === 'unknown').length;

  return {
    schema: 'TestingTrackerReport.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifacts: (Object.entries(artifacts) as Array<[keyof TestingTrackerInput['artifacts'], TestingTrackerArtifact<unknown>]>)
      .map(([id, artifact]) => ({
        id,
        present: artifact.present,
        path: artifact.path,
        parseError: artifact.parseError,
      })),
    flaws,
    summary: {
      fixedCount,
      openCount,
      unknownCount,
      publishReady: openCount === 0 && unknownCount === 0,
    },
  };
}
