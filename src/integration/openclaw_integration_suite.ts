import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createSkillAuditConstruction } from '../constructions/skill_audit.js';
import { computeCalibrationReport, type CalibrationClaim } from '../measurement/calibration.js';

export type OpenclawScenarioId =
  | 'scenario_1_cold_start_context_efficiency'
  | 'scenario_2_memory_staleness_detection'
  | 'scenario_3_semantic_navigation_accuracy'
  | 'scenario_4_context_exhaustion_prevention'
  | 'scenario_5_malicious_skill_detection'
  | 'scenario_6_calibration_convergence';

export interface OpenclawScenarioResult {
  id: OpenclawScenarioId;
  title: string;
  passed: boolean;
  thresholds: Record<string, number>;
  measurements: Record<string, number>;
}

export interface OpenclawIntegrationSuiteResult {
  kind: 'OpenclawIntegrationSuite.v1';
  generatedAt: string;
  workspaceRoot: string;
  fixtureRoot: string;
  summary: {
    total: number;
    passing: number;
    failing: number;
  };
  scenarios: OpenclawScenarioResult[];
}

export interface OpenclawIntegrationSuiteOptions {
  workspaceRoot: string;
  fixtureRoot?: string;
  scenarioIds?: OpenclawScenarioId[];
}

interface ColdStartFixture {
  baselineTokensBeforeFirstEdit: number;
  integrationTokensBeforeFirstEdit: number;
  maxIntegrationTokens: number;
}

interface MemoryStalenessFixture {
  staleMarkerDetected: boolean;
  detectionLatencySeconds: number;
  maxDetectionLatencySeconds: number;
}

interface NavigationFixtureEntry {
  id: string;
  librarianTop1Correct: boolean;
  grepTop1Correct: boolean;
}

interface BudgetGateRun {
  warningBeforeSpawn: boolean;
}

interface BudgetGateFixture {
  runs: BudgetGateRun[];
}

interface CalibrationSession {
  confidence: number;
  correct: boolean;
}

interface CalibrationFixture {
  initialEce: number;
  sessions: CalibrationSession[];
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function toClaims(sessions: CalibrationSession[], offset: number): CalibrationClaim[] {
  return sessions.map((session, index) => ({
    claimId: `openclaw_calibration_${offset + index + 1}`,
    confidence: session.confidence,
    correct: session.correct,
  }));
}

async function evaluateScenario1(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const fixture = await readJsonFile<ColdStartFixture>(
    path.join(fixtureRoot, 'scenario1-cold-start.json'),
  );
  const tokenReduction = 1 - ratio(
    fixture.integrationTokensBeforeFirstEdit,
    fixture.baselineTokensBeforeFirstEdit,
  );
  const passed = fixture.integrationTokensBeforeFirstEdit <= fixture.maxIntegrationTokens;

  return {
    id: 'scenario_1_cold_start_context_efficiency',
    title: 'Cold Start Context Efficiency',
    passed,
    thresholds: {
      maxIntegrationTokens: fixture.maxIntegrationTokens,
    },
    measurements: {
      baselineTokensBeforeFirstEdit: fixture.baselineTokensBeforeFirstEdit,
      integrationTokensBeforeFirstEdit: fixture.integrationTokensBeforeFirstEdit,
      tokenReduction,
    },
  };
}

async function evaluateScenario2(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const fixture = await readJsonFile<MemoryStalenessFixture>(
    path.join(fixtureRoot, 'scenario2-memory-staleness.json'),
  );
  const passed = fixture.staleMarkerDetected
    && fixture.detectionLatencySeconds <= fixture.maxDetectionLatencySeconds;

  return {
    id: 'scenario_2_memory_staleness_detection',
    title: 'Memory Staleness Detection',
    passed,
    thresholds: {
      markerDetected: 1,
      maxDetectionLatencySeconds: fixture.maxDetectionLatencySeconds,
    },
    measurements: {
      markerDetected: fixture.staleMarkerDetected ? 1 : 0,
      detectionLatencySeconds: fixture.detectionLatencySeconds,
    },
  };
}

async function evaluateScenario3(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const entries = await readJsonFile<NavigationFixtureEntry[]>(
    path.join(fixtureRoot, 'nav-queries.json'),
  );
  const total = entries.length;
  const librarianCorrect = entries.filter((entry) => entry.librarianTop1Correct).length;
  const grepCorrect = entries.filter((entry) => entry.grepTop1Correct).length;
  const librarianAccuracy = ratio(librarianCorrect, total);
  const grepAccuracy = ratio(grepCorrect, total);
  const minLibrarianAccuracy = 0.9;

  return {
    id: 'scenario_3_semantic_navigation_accuracy',
    title: 'Sub-agent Semantic Navigation Accuracy',
    passed: librarianAccuracy >= minLibrarianAccuracy,
    thresholds: {
      minLibrarianAccuracy,
    },
    measurements: {
      totalQueries: total,
      librarianCorrect,
      grepCorrect,
      librarianAccuracy,
      grepAccuracy,
    },
  };
}

async function evaluateScenario4(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const fixture = await readJsonFile<BudgetGateFixture>(
    path.join(fixtureRoot, 'scenario4-budget-gate.json'),
  );
  const totalRuns = fixture.runs.length;
  const warningBeforeSpawnCount = fixture.runs.filter((run) => run.warningBeforeSpawn).length;
  const warningRate = ratio(warningBeforeSpawnCount, totalRuns);

  return {
    id: 'scenario_4_context_exhaustion_prevention',
    title: 'Context Exhaustion Prevention',
    passed: warningRate === 1,
    thresholds: {
      warningRate: 1,
    },
    measurements: {
      totalRuns,
      warningBeforeSpawnCount,
      warningRate,
    },
  };
}

async function readMarkdownFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

async function evaluateScenario5(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const cleanDir = path.join(fixtureRoot, 'skill-corpus', 'clean');
  const maliciousDir = path.join(fixtureRoot, 'skill-corpus', 'malicious');
  const [cleanFiles, maliciousFiles] = await Promise.all([
    readMarkdownFiles(cleanDir),
    readMarkdownFiles(maliciousDir),
  ]);

  const auditor = createSkillAuditConstruction();
  let maliciousDetected = 0;
  for (const filePath of maliciousFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const result = await auditor.audit({ skillContent: content, skillPath: filePath, workdir: fixtureRoot });
    if (result.verdict !== 'safe') {
      maliciousDetected += 1;
    }
  }

  let cleanFalsePositives = 0;
  for (const filePath of cleanFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const result = await auditor.audit({ skillContent: content, skillPath: filePath, workdir: fixtureRoot });
    if (result.verdict !== 'safe') {
      cleanFalsePositives += 1;
    }
  }

  const minMaliciousDetected = 4;
  const maxCleanFalsePositives = 0;
  const passed = maliciousDetected >= minMaliciousDetected
    && cleanFalsePositives <= maxCleanFalsePositives;

  return {
    id: 'scenario_5_malicious_skill_detection',
    title: 'Malicious Skill Detection',
    passed,
    thresholds: {
      minMaliciousDetected,
      maxCleanFalsePositives,
    },
    measurements: {
      maliciousTotal: maliciousFiles.length,
      cleanTotal: cleanFiles.length,
      maliciousDetected,
      cleanFalsePositives,
    },
  };
}

function computeBatchEce(sessions: CalibrationSession[], batchIndex: number): number {
  const claims = toClaims(sessions, batchIndex * 100);
  const report = computeCalibrationReport({
    claims,
    scope: { kind: 'custom', paths: [`openclaw-calibration-batch-${batchIndex + 1}`] },
  });
  return report.overallCalibrationError;
}

async function evaluateScenario6(fixtureRoot: string): Promise<OpenclawScenarioResult> {
  const fixture = await readJsonFile<CalibrationFixture>(
    path.join(fixtureRoot, 'scenario6-calibration-sessions.json'),
  );

  const batchSize = 10;
  const batch10 = fixture.sessions.slice(0, batchSize);
  const batch20 = fixture.sessions.slice(batchSize, batchSize * 2);
  const batch30 = fixture.sessions.slice(batchSize * 2, batchSize * 3);

  const ece10 = computeBatchEce(batch10, 0);
  const ece20 = computeBatchEce(batch20, 1);
  const ece30 = computeBatchEce(batch30, 2);
  const maxEce30 = 0.05;

  const passed = ece10 < fixture.initialEce
    && ece20 < ece10
    && ece30 < ece20
    && ece30 < maxEce30;

  return {
    id: 'scenario_6_calibration_convergence',
    title: 'Calibration Convergence',
    passed,
    thresholds: {
      initialEceUpperBound: fixture.initialEce,
      maxEce30,
    },
    measurements: {
      initialEce: fixture.initialEce,
      ece10,
      ece20,
      ece30,
    },
  };
}

export async function runOpenclawIntegrationSuite(
  options: OpenclawIntegrationSuiteOptions,
): Promise<OpenclawIntegrationSuiteResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const fixtureRoot = options.fixtureRoot
    ? path.resolve(options.fixtureRoot)
    : path.join(workspaceRoot, 'test', 'fixtures', 'openclaw');

  const runners: Record<OpenclawScenarioId, () => Promise<OpenclawScenarioResult>> = {
    'scenario_1_cold_start_context_efficiency': () => evaluateScenario1(fixtureRoot),
    'scenario_2_memory_staleness_detection': () => evaluateScenario2(fixtureRoot),
    'scenario_3_semantic_navigation_accuracy': () => evaluateScenario3(fixtureRoot),
    'scenario_4_context_exhaustion_prevention': () => evaluateScenario4(fixtureRoot),
    'scenario_5_malicious_skill_detection': () => evaluateScenario5(fixtureRoot),
    'scenario_6_calibration_convergence': () => evaluateScenario6(fixtureRoot),
  };

  const selected = options.scenarioIds && options.scenarioIds.length > 0
    ? options.scenarioIds
    : (Object.keys(runners) as OpenclawScenarioId[]);

  const scenarios: OpenclawScenarioResult[] = [];
  for (const scenarioId of selected) {
    scenarios.push(await runners[scenarioId]());
  }

  const passing = scenarios.filter((scenario) => scenario.passed).length;
  const total = scenarios.length;
  return {
    kind: 'OpenclawIntegrationSuite.v1',
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    fixtureRoot,
    summary: {
      total,
      passing,
      failing: total - passing,
    },
    scenarios,
  };
}
