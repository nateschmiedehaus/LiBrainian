export interface TestingTrackerArtifact<T> {
  present: boolean;
  path: string;
  data?: T;
  parseError?: string;
}

export interface TestingTrackerInput {
  generatedAt: string;
  artifacts: {
    useCase: TestingTrackerArtifact<unknown>;
    liveFire: TestingTrackerArtifact<unknown>;
    smoke: TestingTrackerArtifact<unknown>;
    testingDiscipline: TestingTrackerArtifact<unknown>;
  };
}

export interface TestingTrackerFlaw {
  id: string;
  title: string;
  status: 'fixed' | 'open' | 'unknown';
  evidence: string;
}

export interface TestingTrackerReport {
  schema: 'TestingTrackerReport.v1';
  generatedAt: string;
  artifacts: Array<{
    id: string;
    present: boolean;
    path: string;
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

function boolLabel(value: boolean): string {
  return value ? 'true' : 'false';
}

function artifactStatus<T>(artifact: TestingTrackerArtifact<T>): 'fixed' | 'open' | 'unknown' {
  if (!artifact.present) return 'open';
  if (artifact.parseError) return 'unknown';
  return 'fixed';
}

function extractBooleanPath(value: unknown, path: string[]): boolean | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'boolean' ? current : undefined;
}

export function buildTestingTrackerReport(input: TestingTrackerInput): TestingTrackerReport {
  const artifacts = [
    { id: 'useCase', ...input.artifacts.useCase },
    { id: 'liveFire', ...input.artifacts.liveFire },
    { id: 'smoke', ...input.artifacts.smoke },
    { id: 'testingDiscipline', ...input.artifacts.testingDiscipline },
  ];

  const testingDisciplinePassed = extractBooleanPath(input.artifacts.testingDiscipline.data, ['passed']);
  const useCaseGatePassed = extractBooleanPath(input.artifacts.useCase.data, ['gate', 'passed']);
  const liveFireGatePassed = extractBooleanPath(input.artifacts.liveFire.data, ['gates', 'passed']);
  const smokeFailures = (() => {
    const smokeData = input.artifacts.smoke.data;
    if (!smokeData || typeof smokeData !== 'object' || Array.isArray(smokeData)) return undefined;
    const summary = (smokeData as Record<string, unknown>).summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return undefined;
    const failures = (summary as Record<string, unknown>).failures;
    return typeof failures === 'number' && Number.isFinite(failures) ? failures : undefined;
  })();

  const flaws: TestingTrackerFlaw[] = [
    {
      id: 'use_case_release_evidence',
      title: 'Use-case release evidence',
      status: artifactStatus(input.artifacts.useCase) === 'fixed' && useCaseGatePassed === true ? 'fixed' : artifactStatus(input.artifacts.useCase),
      evidence: `present=${boolLabel(input.artifacts.useCase.present)}; gatePassed=${String(useCaseGatePassed ?? 'missing')}`,
    },
    {
      id: 'live_fire_gate',
      title: 'Live-fire gate',
      status: artifactStatus(input.artifacts.liveFire) === 'fixed' && liveFireGatePassed === true ? 'fixed' : artifactStatus(input.artifacts.liveFire),
      evidence: `present=${boolLabel(input.artifacts.liveFire.present)}; gatesPassed=${String(liveFireGatePassed ?? 'missing')}`,
    },
    {
      id: 'external_smoke_reliability',
      title: 'External smoke reliability',
      status: artifactStatus(input.artifacts.smoke) === 'fixed' && smokeFailures === 0 ? 'fixed' : artifactStatus(input.artifacts.smoke),
      evidence: `present=${boolLabel(input.artifacts.smoke.present)}; failures=${String(smokeFailures ?? 'missing')}`,
    },
    {
      id: 'testing_discipline_gate',
      title: 'Testing discipline gate',
      status: artifactStatus(input.artifacts.testingDiscipline) === 'fixed' && testingDisciplinePassed === true
        ? 'fixed'
        : artifactStatus(input.artifacts.testingDiscipline),
      evidence: `present=${boolLabel(input.artifacts.testingDiscipline.present)}; passed=${String(testingDisciplinePassed ?? 'missing')}`,
    },
  ];

  const fixedCount = flaws.filter((flaw) => flaw.status === 'fixed').length;
  const openCount = flaws.filter((flaw) => flaw.status === 'open').length;
  const unknownCount = flaws.filter((flaw) => flaw.status === 'unknown').length;

  return {
    schema: 'TestingTrackerReport.v1',
    generatedAt: input.generatedAt,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
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
