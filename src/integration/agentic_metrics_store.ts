import type { LibrarianStorage } from '../storage/types.js';

const AGENTIC_TASK_OUTCOMES_KEY = 'agentic_task_outcomes_v1';
const AGENTIC_FEEDBACK_EVENTS_KEY = 'agentic_feedback_events_v1';
const MAX_TASK_OUTCOMES = 1000;
const MAX_FEEDBACK_EVENTS = 2000;

export interface AgenticTaskOutcomeRecord {
  taskId: string;
  timestamp: string;
  success: boolean;
  contextProvided: boolean;
  durationMs?: number;
  contextUsefulness?: number;
  codeQualityScore?: number;
  decisionCorrect?: boolean;
  missingContext?: boolean;
  failureType?: string;
  filesModifiedCount?: number;
  agentId?: string;
}

export interface AgenticFeedbackEventRecord {
  queryId: string;
  timestamp: string;
  usefulnessMean: number;
  totalRatings: number;
  irrelevantRatings: number;
  missingContext: boolean;
  agentId?: string;
}

export interface AgenticUtilitySnapshot {
  measured: boolean;
  reason?: string;
  taskCount: number;
  feedbackCount: number;
  ratingCount: number;
  withContextCount: number;
  withoutContextCount: number;
  taskCompletionLift: number;
  timeToSolutionReduction: number;
  contextUsageRate: number;
  codeQualityLift: number;
  decisionAccuracy: number;
  agentSatisfactionScore: number;
  missingContextRate: number;
  irrelevantContextRate: number;
}

export async function recordAgenticTaskOutcome(
  storage: LibrarianStorage,
  record: AgenticTaskOutcomeRecord
): Promise<void> {
  await appendJsonArrayRecord(storage, AGENTIC_TASK_OUTCOMES_KEY, record, MAX_TASK_OUTCOMES);
}

export async function listAgenticTaskOutcomes(
  storage: LibrarianStorage
): Promise<AgenticTaskOutcomeRecord[]> {
  return readJsonArray<AgenticTaskOutcomeRecord>(storage, AGENTIC_TASK_OUTCOMES_KEY);
}

export async function recordAgenticFeedbackEvent(
  storage: LibrarianStorage,
  record: AgenticFeedbackEventRecord
): Promise<void> {
  await appendJsonArrayRecord(storage, AGENTIC_FEEDBACK_EVENTS_KEY, record, MAX_FEEDBACK_EVENTS);
}

export async function listAgenticFeedbackEvents(
  storage: LibrarianStorage
): Promise<AgenticFeedbackEventRecord[]> {
  return readJsonArray<AgenticFeedbackEventRecord>(storage, AGENTIC_FEEDBACK_EVENTS_KEY);
}

export async function computeAgenticUtilitySnapshot(
  storage: LibrarianStorage
): Promise<AgenticUtilitySnapshot> {
  const tasks = await listAgenticTaskOutcomes(storage);
  const feedback = await listAgenticFeedbackEvents(storage);

  const taskCount = tasks.length;
  const feedbackCount = feedback.length;
  const ratingCount = feedback.reduce((sum, entry) => sum + Math.max(0, entry.totalRatings), 0);
  const withContext = tasks.filter((entry) => entry.contextProvided);
  const withoutContext = tasks.filter((entry) => !entry.contextProvided);

  if (taskCount === 0 && feedbackCount === 0) {
    return {
      measured: false,
      reason: 'missing_task_and_feedback_data',
      taskCount: 0,
      feedbackCount: 0,
      ratingCount: 0,
      withContextCount: 0,
      withoutContextCount: 0,
      taskCompletionLift: -1,
      timeToSolutionReduction: -1,
      contextUsageRate: -1,
      codeQualityLift: -1,
      decisionAccuracy: -1,
      agentSatisfactionScore: -1,
      missingContextRate: -1,
      irrelevantContextRate: -1,
    };
  }

  const withSuccess = successRate(withContext);
  const withoutSuccess = successRate(withoutContext);
  const globalSuccess = successRate(tasks);
  const withDuration = average(withContext.map((entry) => entry.durationMs).filter(isFiniteNumber));
  const withoutDuration = average(withoutContext.map((entry) => entry.durationMs).filter(isFiniteNumber));
  const allDuration = average(tasks.map((entry) => entry.durationMs).filter(isFiniteNumber));
  const withQuality = average(withContext.map((entry) => entry.codeQualityScore).filter(isFiniteNumber));
  const withoutQuality = average(withoutContext.map((entry) => entry.codeQualityScore).filter(isFiniteNumber));
  const allQuality = average(tasks.map((entry) => entry.codeQualityScore).filter(isFiniteNumber));

  const decisionSignals = tasks
    .map((entry) => entry.decisionCorrect)
    .filter((entry): entry is boolean => typeof entry === 'boolean');
  const decisionAccuracy = decisionSignals.length > 0
    ? average(decisionSignals.map((entry) => entry ? 1 : 0))
    : globalSuccess;

  const taskUsefulness = average(
    tasks
      .map((entry) => entry.contextUsefulness)
      .filter(isFiniteNumber)
  );
  const feedbackUsefulness = weightedAverage(
    feedback.map((entry) => ({
      value: entry.usefulnessMean,
      weight: Math.max(1, entry.totalRatings),
    }))
  );
  const agentSatisfactionScore = clamp01(
    feedbackUsefulness >= 0 ? feedbackUsefulness : taskUsefulness >= 0 ? taskUsefulness : 0
  );

  const missingFromTasks = tasks.filter((entry) => entry.missingContext === true).length;
  const missingFromFeedback = feedback.filter((entry) => entry.missingContext).length;
  const missingDenominator = taskCount + feedbackCount;
  const missingContextRate = missingDenominator > 0
    ? clamp01((missingFromTasks + missingFromFeedback) / missingDenominator)
    : 0;

  const irrelevantRatings = feedback.reduce((sum, entry) => sum + Math.max(0, entry.irrelevantRatings), 0);
  const irrelevantContextRate = ratingCount > 0
    ? clamp01(irrelevantRatings / ratingCount)
    : estimateIrrelevantRateFromTasks(tasks);

  const taskCompletionLift = withContext.length > 0 && withoutContext.length > 0
    ? normalizeLift(withSuccess - withoutSuccess)
    : normalizeLift(globalSuccess - 0.5);

  const timeToSolutionReduction = withDuration >= 0 && withoutDuration > 0
    ? clamp01((withoutDuration - withDuration) / withoutDuration)
    : allDuration > 0
      ? clamp01((180 - allDuration) / 180)
      : 0;

  const contextUsageRate = taskCount > 0
    ? clamp01(withContext.length / taskCount)
    : 0;

  const codeQualityLift = withQuality >= 0 && withoutQuality >= 0
    ? normalizeLift(withQuality - withoutQuality)
    : normalizeLift((allQuality >= 0 ? allQuality : 0.5) - 0.5);

  return {
    measured: true,
    taskCount,
    feedbackCount,
    ratingCount,
    withContextCount: withContext.length,
    withoutContextCount: withoutContext.length,
    taskCompletionLift,
    timeToSolutionReduction,
    contextUsageRate,
    codeQualityLift,
    decisionAccuracy: clamp01(decisionAccuracy),
    agentSatisfactionScore,
    missingContextRate,
    irrelevantContextRate,
  };
}

async function appendJsonArrayRecord<T>(
  storage: LibrarianStorage,
  key: string,
  record: T,
  maxEntries: number
): Promise<void> {
  const current = await readJsonArray<T>(storage, key);
  current.push(record);
  const bounded = current.slice(-maxEntries);
  await storage.setState(key, JSON.stringify(bounded));
}

async function readJsonArray<T>(
  storage: LibrarianStorage,
  key: string
): Promise<T[]> {
  const raw = await storage.getState(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch {
    return [];
  }
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number {
  if (values.length === 0) return -1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const valid = values.filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
  if (valid.length === 0) return -1;
  const weighted = valid.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);
  const weightSum = valid.reduce((sum, entry) => sum + entry.weight, 0);
  return weightSum > 0 ? weighted / weightSum : -1;
}

function successRate(records: AgenticTaskOutcomeRecord[]): number {
  if (records.length === 0) return 0;
  const successes = records.filter((entry) => entry.success).length;
  return successes / records.length;
}

function estimateIrrelevantRateFromTasks(records: AgenticTaskOutcomeRecord[]): number {
  const usefulness = records
    .map((entry) => entry.contextUsefulness)
    .filter(isFiniteNumber);
  if (usefulness.length === 0) return 0;
  const belowThreshold = usefulness.filter((value) => value < 0.3).length;
  return clamp01(belowThreshold / usefulness.length);
}

function normalizeLift(delta: number): number {
  // Map [-1, 1] into [0, 1] so "no lift" is neutral at 0.5.
  const bounded = Math.max(-1, Math.min(1, delta));
  return (bounded + 1) / 2;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
