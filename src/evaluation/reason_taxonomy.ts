export type GateReasonSeverity = 'blocking' | 'quality' | 'sample_size' | 'dependency' | 'informational';
export type GateReasonCategory =
  | 'execution'
  | 'objective'
  | 'measurement'
  | 'dependency'
  | 'sample_size'
  | 'quality'
  | 'context'
  | 'other';

export interface ClassifiedGateReason {
  reason: string;
  severity: GateReasonSeverity;
  category: GateReasonCategory;
}

const CLASSIFIERS: Array<{
  match: (reason: string) => boolean;
  severity: GateReasonSeverity;
  category: GateReasonCategory;
}> = [
  {
    match: (reason) =>
      reason.startsWith('journey_execution_failed:') ||
      reason.startsWith('smoke_execution_failed:') ||
      reason.includes('smoke_repo_timeout') ||
      reason === 'journey_execution_failures_detected' ||
      reason === 'smoke_execution_failures_detected' ||
      reason === 'verification_fallback_disallowed' ||
      reason.startsWith('critical_failures_present:') ||
      reason === 'journey_artifact_integrity_failures_detected' ||
      reason === 'smoke_artifact_integrity_failures_detected' ||
      reason.startsWith('artifact_integrity_share_below_threshold:'),
    severity: 'blocking',
    category: 'execution',
  },
  {
    match: (reason) =>
      reason.includes('provider_unavailable') ||
      reason.startsWith('provider_prerequisite_failures:') ||
      reason === 'provider_prerequisite_failures_detected' ||
      reason.startsWith('validation_prerequisite_failures:') ||
      reason === 'validation_prerequisite_failures_detected',
    severity: 'dependency',
    category: 'dependency',
  },
  {
    match: (reason) =>
      reason === 't3_plus_significance_sample_insufficient' ||
      reason.includes('insufficient_samples'),
    severity: 'sample_size',
    category: 'sample_size',
  },
  {
    match: (reason) =>
      reason.startsWith('t3_plus_lift_below_threshold:') ||
      reason.startsWith('t3_plus_ceiling_time_reduction_below_threshold:') ||
      reason.startsWith('journey_pass_rate_below_threshold:') ||
      reason.startsWith('retrieved_context_rate_below_threshold:') ||
      reason.startsWith('blocking_validation_rate_above_threshold:') ||
      reason.startsWith('verification_fallback_share_above_threshold:') ||
      reason.startsWith('journey_unverified_trace_errors:') ||
      reason.startsWith('journey_fallback_context_selections:') ||
      reason.startsWith('aggregate_journey_pass_rate_below_threshold:') ||
      reason.startsWith('aggregate_retrieved_context_rate_below_threshold:') ||
      reason.startsWith('aggregate_blocking_validation_rate_above_threshold:') ||
      reason.startsWith('smoke_failures:') ||
      reason === 'at_least_one_live_fire_run_failed' ||
      reason === 'journey_unverified_trace_detected' ||
      reason === 'journey_fallback_context_detected' ||
      reason === 't3_plus_not_statistically_significant',
    severity: 'quality',
    category: 'quality',
  },
  {
    match: (reason) => reason === 't3_plus_lift_unavailable',
    severity: 'blocking',
    category: 'measurement',
  },
  {
    match: (reason) =>
      reason === 'agent_command_tasks_missing' ||
      reason.startsWith('agent_command_share_below_threshold:') ||
      reason.startsWith('agent_verified_execution_share_below_threshold:') ||
      reason.startsWith('agent_baseline_guard_share_below_threshold:'),
    severity: 'quality',
    category: 'objective',
  },
  {
    match: (reason) => reason === 'smoke_skipped_due_journey_execution_failure',
    severity: 'informational',
    category: 'execution',
  },
];

export function classifyGateReason(reason: string): ClassifiedGateReason {
  const normalized = String(reason ?? '').trim();
  for (const classifier of CLASSIFIERS) {
    if (classifier.match(normalized)) {
      return {
        reason: normalized,
        severity: classifier.severity,
        category: classifier.category,
      };
    }
  }
  return {
    reason: normalized,
    severity: 'informational',
    category: 'other',
  };
}

export function classifyGateReasons(reasons: string[]): ClassifiedGateReason[] {
  return reasons.map((reason) => classifyGateReason(reason));
}

export function countBySeverity(items: ClassifiedGateReason[]): Record<GateReasonSeverity, number> {
  const counts: Record<GateReasonSeverity, number> = {
    blocking: 0,
    quality: 0,
    sample_size: 0,
    dependency: 0,
    informational: 0,
  };
  for (const item of items) {
    counts[item.severity] += 1;
  }
  return counts;
}

export function countByCategory(items: ClassifiedGateReason[]): Record<GateReasonCategory, number> {
  const counts: Record<GateReasonCategory, number> = {
    execution: 0,
    objective: 0,
    measurement: 0,
    dependency: 0,
    sample_size: 0,
    quality: 0,
    context: 0,
    other: 0,
  };
  for (const item of items) {
    counts[item.category] += 1;
  }
  return counts;
}
