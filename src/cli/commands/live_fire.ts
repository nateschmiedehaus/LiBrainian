/**
 * @fileoverview Live-Fire Trial Command
 *
 * Runs continuous trial-by-fire evaluations on real external repos using
 * strict objective journey mode and optional smoke validation.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createError } from '../errors.js';
import { printKeyValue } from '../progress.js';
import type { JourneyLlmMode } from '../../evaluation/agentic_journey.js';
import { loadEvaluationModule } from '../../utils/evaluation_loader.js';

type LiveFireTrialsModule = typeof import('../../evaluation/live_fire_trials.js');

async function loadLiveFireTrialsModule(): Promise<LiveFireTrialsModule> {
  const externalModuleId = 'librainian-eval/live_fire_trials.js';
  return loadEvaluationModule<LiveFireTrialsModule>(
    'librarian live-fire',
    () => import('../../evaluation/live_fire_trials.js'),
    () => import(externalModuleId) as Promise<LiveFireTrialsModule>,
  );
}

export interface LiveFireCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface LiveFireProfile {
  rounds?: number;
  maxRepos?: number;
  llmModes?: JourneyLlmMode[];
  deterministic?: boolean;
  strictObjective?: boolean;
  includeSmoke?: boolean;
  minJourneyPassRate?: number;
  minRetrievedContextRate?: number;
  maxBlockingValidationRate?: number;
  journeyTimeoutMs?: number;
  smokeTimeoutMs?: number;
}

interface LiveFireMatrixRun {
  profile: string;
  reportPath: string;
  passed: boolean;
  reasons: string[];
  reasonCounts: Record<string, number>;
  aggregate: {
    passRate: number;
    meanJourneyPassRate: number;
    meanRetrievedContextRate: number;
    meanBlockingValidationRate: number;
  };
}

interface LiveFireMatrixReport {
  schema: 'LiveFireMatrixReport.v1';
  createdAt: string;
  reposRoot: string;
  runs: LiveFireMatrixRun[];
  overall: {
    totalProfiles: number;
    passedProfiles: number;
    failedProfiles: number;
    passed: boolean;
    failedProfileNames: string[];
  };
}

const BUILTIN_PROFILES: Record<string, LiveFireProfile> = {
  baseline: {
    rounds: 1,
    maxRepos: 3,
    llmModes: ['disabled'],
    deterministic: true,
    strictObjective: true,
    includeSmoke: true,
    minJourneyPassRate: 1,
    minRetrievedContextRate: 0.95,
    maxBlockingValidationRate: 0,
    journeyTimeoutMs: 180000,
    smokeTimeoutMs: 180000,
  },
  hardcore: {
    rounds: 2,
    maxRepos: 6,
    llmModes: ['disabled', 'optional'],
    deterministic: true,
    strictObjective: true,
    includeSmoke: true,
    minJourneyPassRate: 1,
    minRetrievedContextRate: 0.98,
    maxBlockingValidationRate: 0,
    journeyTimeoutMs: 180000,
    smokeTimeoutMs: 180000,
  },
  soak: {
    rounds: 4,
    maxRepos: 10,
    llmModes: ['disabled', 'optional'],
    deterministic: true,
    strictObjective: true,
    includeSmoke: true,
    minJourneyPassRate: 1,
    minRetrievedContextRate: 0.98,
    maxBlockingValidationRate: 0,
    journeyTimeoutMs: 240000,
    smokeTimeoutMs: 180000,
  },
};

function parsePositiveInt(raw: string | undefined, name: string): number | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError('INVALID_ARGUMENT', `${name} must be a positive integer.`);
  }
  return parsed;
}

function parseRate(raw: string | undefined, name: string): number | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw createError('INVALID_ARGUMENT', `${name} must be between 0 and 1.`);
  }
  return parsed;
}

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const values = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseModes(raw: string | undefined): JourneyLlmMode[] | undefined {
  const values = parseList(raw);
  if (!values) return undefined;
  const modes = values.filter((value): value is JourneyLlmMode => value === 'disabled' || value === 'optional');
  if (modes.length === 0) {
    throw createError('INVALID_ARGUMENT', 'llm-modes must contain disabled and/or optional.');
  }
  return Array.from(new Set(modes));
}

function parseModesLoose(raw: unknown, label: string): JourneyLlmMode[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw createError('INVALID_ARGUMENT', `${label}.llmModes must be an array containing disabled and/or optional.`);
  }
  const modes = raw.filter((value): value is JourneyLlmMode => value === 'disabled' || value === 'optional');
  if (modes.length !== raw.length) {
    throw createError('INVALID_ARGUMENT', `${label}.llmModes can only include disabled and optional.`);
  }
  return modes.length > 0 ? Array.from(new Set(modes)) : undefined;
}

function parseBooleanLoose(raw: unknown, label: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') {
    throw createError('INVALID_ARGUMENT', `${label} must be a boolean.`);
  }
  return raw;
}

function parseRateLoose(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw createError('INVALID_ARGUMENT', `${label} must be a number between 0 and 1.`);
  }
  return raw;
}

function parsePositiveIntLoose(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw createError('INVALID_ARGUMENT', `${label} must be a positive integer.`);
  }
  return raw;
}

function normalizeProfile(input: unknown, label: string): LiveFireProfile {
  if (!input || typeof input !== 'object') {
    throw createError('INVALID_ARGUMENT', `${label} must be an object.`);
  }
  const record = input as Record<string, unknown>;
  return {
    rounds: parsePositiveIntLoose(record.rounds, `${label}.rounds`),
    maxRepos: parsePositiveIntLoose(record.maxRepos, `${label}.maxRepos`),
    llmModes: parseModesLoose(record.llmModes, label),
    deterministic: parseBooleanLoose(record.deterministic, `${label}.deterministic`),
    strictObjective: parseBooleanLoose(record.strictObjective, `${label}.strictObjective`),
    includeSmoke: parseBooleanLoose(record.includeSmoke, `${label}.includeSmoke`),
    minJourneyPassRate: parseRateLoose(record.minJourneyPassRate, `${label}.minJourneyPassRate`),
    minRetrievedContextRate: parseRateLoose(record.minRetrievedContextRate, `${label}.minRetrievedContextRate`),
    maxBlockingValidationRate: parseRateLoose(record.maxBlockingValidationRate, `${label}.maxBlockingValidationRate`),
    journeyTimeoutMs: parsePositiveIntLoose(record.journeyTimeoutMs, `${label}.journeyTimeoutMs`),
    smokeTimeoutMs: parsePositiveIntLoose(record.smokeTimeoutMs, `${label}.smokeTimeoutMs`),
  };
}

function loadProfiles(filePath: string | undefined): Record<string, LiveFireProfile> {
  const merged: Record<string, LiveFireProfile> = { ...BUILTIN_PROFILES };
  if (!filePath) return merged;
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw createError('INVALID_ARGUMENT', `profiles-file not found: ${resolvedPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    throw createError('INVALID_ARGUMENT', `Could not parse profiles-file ${resolvedPath}: ${message}`);
  }
  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const profileSection = (record.profiles && typeof record.profiles === 'object')
    ? record.profiles as Record<string, unknown>
    : record;
  for (const [name, profile] of Object.entries(profileSection)) {
    merged[name] = normalizeProfile(profile, `profiles.${name}`);
  }
  return merged;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function writeLatestPointer(pointerRoot: string | undefined, payload: unknown): string | undefined {
  if (!pointerRoot) {
    return undefined;
  }
  if (!fs.existsSync(pointerRoot)) {
    mkdirSync(pointerRoot, { recursive: true });
  }
  const latestPath = path.join(pointerRoot, 'latest.json');
  const previousPath = path.join(pointerRoot, 'latest.prev.json');
  if (fs.existsSync(latestPath)) {
    try {
      fs.copyFileSync(latestPath, previousPath);
    } catch {
      // Best-effort history snapshot; proceed with latest write if copy fails.
    }
  }
  writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');
  return latestPath;
}

export async function liveFireCommand(options: LiveFireCommandOptions): Promise<void> {
  const { rawArgs, workspace } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'repos-root': { type: 'string' },
      'max-repos': { type: 'string' },
      rounds: { type: 'string' },
      repo: { type: 'string' },
      'llm-modes': { type: 'string' },
      deterministic: { type: 'boolean' },
      'strict-objective': { type: 'boolean' },
      'include-smoke': { type: 'boolean' },
      'min-journey-pass-rate': { type: 'string' },
      'min-retrieved-context-rate': { type: 'string' },
      'max-blocking-validation-rate': { type: 'string' },
      'journey-timeout-ms': { type: 'string' },
      'smoke-timeout-ms': { type: 'string' },
      profile: { type: 'string' },
      profiles: { type: 'string' },
      'profiles-file': { type: 'string' },
      matrix: { type: 'boolean' },
      'list-profiles': { type: 'boolean' },
      'artifacts-dir': { type: 'string' },
      output: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });
  const profileRegistry = loadProfiles(typeof values['profiles-file'] === 'string' ? values['profiles-file'] : undefined);
  const profileNames = Object.keys(profileRegistry).sort();

  if (rawArgs.includes('--list-profiles')) {
    if (values.json) {
      console.log(JSON.stringify({
        schema: 'LiveFireProfiles.v1',
        profiles: profileRegistry,
      }, null, 2));
    } else {
      console.log('Live-Fire Profiles');
      console.log('==================\n');
      for (const name of profileNames) {
        const profile = profileRegistry[name];
        printKeyValue([
          { key: 'Profile', value: name },
          { key: 'Rounds', value: profile.rounds ?? '(runner default)' },
          { key: 'Max Repos', value: profile.maxRepos ?? '(runner default)' },
          { key: 'LLM Modes', value: profile.llmModes?.join(',') ?? '(runner default)' },
          { key: 'Deterministic', value: profile.deterministic ?? '(runner default)' },
          { key: 'Strict Objective', value: profile.strictObjective ?? '(runner default)' },
          { key: 'Include Smoke', value: profile.includeSmoke ?? '(runner default)' },
          { key: 'Journey Timeout (ms)', value: profile.journeyTimeoutMs ?? '(runner default)' },
          { key: 'Smoke Timeout (ms)', value: profile.smokeTimeoutMs ?? '(runner default)' },
        ]);
        console.log('');
      }
    }
    return;
  }

  const reposRoot = typeof values['repos-root'] === 'string' && values['repos-root']
    ? values['repos-root']
    : path.join(process.cwd(), 'eval-corpus', 'external-repos');

  const manifestPath = path.join(reposRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = {
      code: 'MISSING_MANIFEST',
      message: `External repo manifest not found at ${manifestPath}`,
      hint: 'Set --repos-root to a directory containing manifest.json (defaults to eval-corpus/external-repos).',
    };
    if (values.json) {
      console.log(JSON.stringify({ error }, null, 2));
    } else {
      console.log('Live-Fire Trials');
      console.log('================\n');
      printKeyValue([
        { key: 'Repos Root', value: reposRoot },
        { key: 'Status', value: 'manifest missing' },
      ]);
      console.log(`\nError: ${error.message}`);
      console.log(`Hint: ${error.hint}`);
    }
    process.exitCode = 1;
    return;
  }

  const maxRepos = parsePositiveInt(typeof values['max-repos'] === 'string' ? values['max-repos'] : undefined, 'max-repos');
  const rounds = parsePositiveInt(typeof values.rounds === 'string' ? values.rounds : undefined, 'rounds');
  const repoNames = parseList(typeof values.repo === 'string' ? values.repo : undefined);
  const llmModes = parseModes(typeof values['llm-modes'] === 'string' ? values['llm-modes'] : undefined);
  const minJourneyPassRate = parseRate(
    typeof values['min-journey-pass-rate'] === 'string' ? values['min-journey-pass-rate'] : undefined,
    'min-journey-pass-rate'
  );
  const minRetrievedContextRate = parseRate(
    typeof values['min-retrieved-context-rate'] === 'string' ? values['min-retrieved-context-rate'] : undefined,
    'min-retrieved-context-rate'
  );
  const maxBlockingValidationRate = parseRate(
    typeof values['max-blocking-validation-rate'] === 'string' ? values['max-blocking-validation-rate'] : undefined,
    'max-blocking-validation-rate'
  );
  const journeyTimeoutMs = parsePositiveInt(
    typeof values['journey-timeout-ms'] === 'string' ? values['journey-timeout-ms'] : undefined,
    'journey-timeout-ms'
  );
  const smokeTimeoutMs = parsePositiveInt(
    typeof values['smoke-timeout-ms'] === 'string' ? values['smoke-timeout-ms'] : undefined,
    'smoke-timeout-ms'
  );
  const deterministic = rawArgs.includes('--deterministic') ? true : undefined;
  const strictObjective = rawArgs.includes('--strict-objective') ? true : undefined;
  const includeSmoke = rawArgs.includes('--include-smoke') ? true : undefined;
  const requestedProfile = typeof values.profile === 'string' && values.profile.trim().length > 0 ? values.profile.trim() : undefined;
  const requestedProfiles = parseList(typeof values.profiles === 'string' ? values.profiles : undefined);
  if (requestedProfile && requestedProfiles) {
    throw createError('INVALID_ARGUMENT', 'Use either --profile or --profiles, not both.');
  }
  const runMatrix = rawArgs.includes('--matrix');
  const selectedProfiles = requestedProfile
    ? [requestedProfile]
    : requestedProfiles
      ? requestedProfiles
      : runMatrix
        ? profileNames
        : [];
  for (const profileName of selectedProfiles) {
    if (!profileRegistry[profileName]) {
      throw createError(
        'INVALID_ARGUMENT',
        `Unknown profile: ${profileName}. Available profiles: ${profileNames.join(', ')}`
      );
    }
  }
  const artifactsDirArg = typeof values['artifacts-dir'] === 'string' && values['artifacts-dir'].trim().length > 0
    ? path.resolve(values['artifacts-dir'])
    : undefined;
  const outputPath = typeof values.output === 'string' && values.output.trim().length > 0
    ? path.resolve(values.output)
    : undefined;
  const { runLiveFireTrials } = await loadLiveFireTrialsModule();

  const runSingleProfile = async (profileName: string, profile: LiveFireProfile | undefined) => {
    const singleProfileArtifactRoot = artifactsDirArg
      ? path.join(artifactsDirArg, sanitizeFileName(profileName), 'runs')
      : undefined;
    return runLiveFireTrials({
      reposRoot,
      maxRepos: maxRepos ?? profile?.maxRepos,
      rounds: rounds ?? profile?.rounds,
      repoNames,
      llmModes: llmModes ?? profile?.llmModes,
      deterministic: deterministic ?? profile?.deterministic,
      protocol: 'objective',
      strictObjective: strictObjective ?? profile?.strictObjective,
      includeSmoke: includeSmoke ?? profile?.includeSmoke,
      minJourneyPassRate: minJourneyPassRate ?? profile?.minJourneyPassRate,
      minRetrievedContextRate: minRetrievedContextRate ?? profile?.minRetrievedContextRate,
      maxBlockingValidationRate: maxBlockingValidationRate ?? profile?.maxBlockingValidationRate,
      journeyTimeoutMs: journeyTimeoutMs ?? profile?.journeyTimeoutMs,
      smokeTimeoutMs: smokeTimeoutMs ?? profile?.smokeTimeoutMs,
      ...(singleProfileArtifactRoot ? { artifactRoot: singleProfileArtifactRoot } : {}),
    });
  };

  if (selectedProfiles.length <= 1) {
    const profileName = selectedProfiles[0] ?? 'custom';
    const profile = selectedProfiles.length === 1 ? profileRegistry[profileName] : undefined;
    const report = await runSingleProfile(profileName, profile);
    const defaultReportPath = artifactsDirArg
      ? path.join(artifactsDirArg, sanitizeFileName(profileName), 'report.json')
      : undefined;
    const resolvedReportPath = outputPath ?? defaultReportPath;
    const singleLatestPointer = writeLatestPointer(
      artifactsDirArg ? path.join(artifactsDirArg, sanitizeFileName(profileName)) : undefined,
      {
        schema: 'LiveFireLatestPointer.v1',
        createdAt: new Date().toISOString(),
        profile: profileName,
        artifactRoot: report.options.artifactRoot ?? null,
        reportPath: resolvedReportPath ?? null,
        options: {
          llmModes: report.options.llmModes,
          includeSmoke: report.options.includeSmoke,
          strictObjective: report.options.strictObjective,
        },
        gates: report.gates,
        aggregate: report.aggregate,
      }
    );

    if (resolvedReportPath) {
      const outputDir = path.dirname(resolvedReportPath);
      if (!fs.existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      writeFileSync(resolvedReportPath, JSON.stringify(report, null, 2), 'utf8');
    }

    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('Live-Fire Trials');
      console.log('================\n');
      printKeyValue([
        { key: 'Profile', value: profileName },
        { key: 'Repos Root', value: reposRoot },
        { key: 'Runs', value: report.aggregate.totalRuns },
        { key: 'Passing Runs', value: report.aggregate.passingRuns },
        { key: 'Aggregate Pass Rate', value: `${(report.aggregate.passRate * 100).toFixed(1)}%` },
        { key: 'Journey Pass Rate', value: `${(report.aggregate.meanJourneyPassRate * 100).toFixed(1)}%` },
        { key: 'Retrieved Context Rate', value: `${(report.aggregate.meanRetrievedContextRate * 100).toFixed(1)}%` },
        { key: 'Blocking Validation Rate', value: `${(report.aggregate.meanBlockingValidationRate * 100).toFixed(1)}%` },
        { key: 'Run Artifacts', value: report.options.artifactRoot ?? '(disabled)' },
        { key: 'Latest Pointer', value: singleLatestPointer ?? '(disabled)' },
        { key: 'Gate', value: report.gates.passed ? 'pass' : 'fail' },
      ]);
      if (report.gates.reasons.length > 0) {
        console.log('\nGate Failures:');
        for (const reason of report.gates.reasons) {
          console.log(`  - ${reason}`);
        }
      }
      const reasonCounts = Object.entries(report.aggregate.reasonCounts ?? {}).sort((a, b) => b[1] - a[1]);
      if (reasonCounts.length > 0) {
        console.log('\nReason Frequency:');
        for (const [reason, count] of reasonCounts) {
          console.log(`  - ${reason}: ${count}`);
        }
      }
      const failedRepos = report.aggregate.failedRepos ?? [];
      if (failedRepos.length > 0) {
        console.log(`\nFailed Repos (${failedRepos.length}):`);
        for (const repo of failedRepos) {
          console.log(`  - ${repo}`);
        }
      }
    }

    if (!report.gates.passed) {
      process.exitCode = 1;
    }
    return;
  }

  const artifactsDir = artifactsDirArg
    ?? path.join(workspace, 'state', 'eval', 'live-fire', new Date().toISOString().replace(/[:.]/g, '-'));
  if (!fs.existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }

  const matrixRuns: LiveFireMatrixRun[] = [];
  for (const profileName of selectedProfiles) {
    const report = await runSingleProfile(profileName, profileRegistry[profileName]);
    const reportPath = path.join(artifactsDir, `${sanitizeFileName(profileName)}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    matrixRuns.push({
      profile: profileName,
      reportPath,
      passed: report.gates.passed,
      reasons: report.gates.reasons,
      reasonCounts: report.aggregate.reasonCounts ?? {},
      aggregate: {
        passRate: report.aggregate.passRate,
        meanJourneyPassRate: report.aggregate.meanJourneyPassRate,
        meanRetrievedContextRate: report.aggregate.meanRetrievedContextRate,
        meanBlockingValidationRate: report.aggregate.meanBlockingValidationRate,
      },
    });
  }

  const failedProfileNames = matrixRuns.filter((run) => !run.passed).map((run) => run.profile);
  const matrixReport: LiveFireMatrixReport = {
    schema: 'LiveFireMatrixReport.v1',
    createdAt: new Date().toISOString(),
    reposRoot,
    runs: matrixRuns,
    overall: {
      totalProfiles: matrixRuns.length,
      passedProfiles: matrixRuns.length - failedProfileNames.length,
      failedProfiles: failedProfileNames.length,
      passed: failedProfileNames.length === 0,
      failedProfileNames,
    },
  };
  const matrixSummaryPath = outputPath ?? path.join(artifactsDir, 'matrix_summary.json');
  const matrixSummaryDir = path.dirname(matrixSummaryPath);
  if (!fs.existsSync(matrixSummaryDir)) {
    mkdirSync(matrixSummaryDir, { recursive: true });
  }
  writeFileSync(matrixSummaryPath, JSON.stringify(matrixReport, null, 2), 'utf8');
  const matrixLatestPointer = writeLatestPointer(artifactsDir, {
    schema: 'LiveFireMatrixLatestPointer.v1',
    createdAt: new Date().toISOString(),
    matrixSummaryPath,
    failedProfiles: matrixReport.overall.failedProfileNames,
    overall: matrixReport.overall,
  });

  if (values.json) {
    console.log(JSON.stringify(matrixReport, null, 2));
  } else {
    console.log('Live-Fire Matrix');
    console.log('================\n');
    printKeyValue([
      { key: 'Repos Root', value: reposRoot },
      { key: 'Profiles', value: matrixReport.overall.totalProfiles },
      { key: 'Passed', value: matrixReport.overall.passedProfiles },
      { key: 'Failed', value: matrixReport.overall.failedProfiles },
      { key: 'Artifacts Dir', value: artifactsDir },
      { key: 'Matrix Summary', value: matrixSummaryPath },
      { key: 'Latest Pointer', value: matrixLatestPointer ?? '(disabled)' },
      { key: 'Gate', value: matrixReport.overall.passed ? 'pass' : 'fail' },
    ]);
    if (matrixReport.overall.failedProfileNames.length > 0) {
      console.log('\nGate Failures:');
      for (const run of matrixRuns.filter((entry) => !entry.passed)) {
        const reasons = run.reasons.length > 0 ? run.reasons.join('; ') : 'unknown';
        console.log(`  - ${run.profile}: ${reasons}`);
        const reasonCounts = Object.entries(run.reasonCounts).sort((a, b) => b[1] - a[1]);
        if (reasonCounts.length > 0) {
          for (const [reason, count] of reasonCounts) {
            console.log(`    * ${reason}: ${count}`);
          }
        }
      }
    }
  }

  if (!matrixReport.overall.passed) {
    process.exitCode = 1;
  }
}
