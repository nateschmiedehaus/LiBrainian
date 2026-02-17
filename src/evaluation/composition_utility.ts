import type { TechniqueComposition } from '../strategic/techniques.js';
import { DEFAULT_TECHNIQUE_COMPOSITIONS } from '../api/technique_compositions.js';
import { rankTechniqueCompositionsByKeyword } from '../api/composition_keywords.js';

export interface CompositionUtilityScenario {
  id: string;
  intent: string;
  expectedCompositionId: string;
}

export interface CompositionUtilityFailure {
  scenarioId: string;
  intent: string;
  expectedCompositionId: string;
  selectedCompositionIds: string[];
  rank: number | null;
  reason: string;
}

export interface CompositionUtilityScenarioResult {
  scenarioId: string;
  expectedCompositionId: string;
  selectedCompositionIds: string[];
  top1Match: boolean;
  top3Match: boolean;
  rank: number | null;
}

export interface CompositionUtilityReport {
  generatedAt: string;
  totalScenarios: number;
  passedScenarios: number;
  passRate: number;
  top1Accuracy: number;
  top3Recall: number;
  scenarioResults: CompositionUtilityScenarioResult[];
  failures: CompositionUtilityFailure[];
}

export const DEFAULT_COMPOSITION_UTILITY_SCENARIOS: CompositionUtilityScenario[] = [
  {
    id: 'release-readiness',
    intent: 'prepare release rollout and deployment verification',
    expectedCompositionId: 'tc_release_readiness',
  },
  {
    id: 'root-cause',
    intent: 'find root cause for regression and failure',
    expectedCompositionId: 'tc_root_cause_recovery',
  },
  {
    id: 'security-review',
    intent: 'security threat audit for new API',
    expectedCompositionId: 'tc_security_review',
  },
  {
    id: 'cross-repo-contract-drift',
    intent: 'cross repo api contract drift before release',
    expectedCompositionId: 'tc_cross_repo_contract_drift',
  },
  {
    id: 'migration-safety',
    intent: 'schema migration rollout safety with rollback evidence',
    expectedCompositionId: 'tc_migration_safety_rollout',
  },
  {
    id: 'incident-hotfix',
    intent: 'incident hotfix with audit trail and blast radius control',
    expectedCompositionId: 'tc_incident_hotfix_governed',
  },
  {
    id: 'performance',
    intent: 'performance latency bottleneck and scaling',
    expectedCompositionId: 'tc_performance_reliability',
  },
  {
    id: 'repo-rehab',
    intent: 'legacy repo rehab and stabilization triage',
    expectedCompositionId: 'tc_repo_rehab_triage',
  },
];

export function evaluateCompositionUtility(
  scenarios: CompositionUtilityScenario[],
  compositions: TechniqueComposition[] = DEFAULT_TECHNIQUE_COMPOSITIONS
): CompositionUtilityReport {
  const failures: CompositionUtilityFailure[] = [];
  const scenarioResults: CompositionUtilityScenarioResult[] = [];
  let passedScenarios = 0;
  let top1Matches = 0;
  let top3Matches = 0;

  for (const scenario of scenarios) {
    const rankedSelections = rankTechniqueCompositionsByKeyword(scenario.intent, compositions);
    const selectedCompositionIds = rankedSelections.map((selection) => selection.id);
    const rank = selectedCompositionIds.indexOf(scenario.expectedCompositionId);
    const rankValue = rank >= 0 ? rank + 1 : null;
    const top1Match = rank === 0;
    const top3Match = rank >= 0 && rank < 3;
    if (rank >= 0) {
      passedScenarios += 1;
    }
    if (top1Match) {
      top1Matches += 1;
    }
    if (top3Match) {
      top3Matches += 1;
    }

    const scenarioResult: CompositionUtilityScenarioResult = {
      scenarioId: scenario.id,
      expectedCompositionId: scenario.expectedCompositionId,
      selectedCompositionIds,
      top1Match,
      top3Match,
      rank: rankValue,
    };
    scenarioResults.push(scenarioResult);

    if (rank < 0) {
      failures.push({
        scenarioId: scenario.id,
        intent: scenario.intent,
        expectedCompositionId: scenario.expectedCompositionId,
        selectedCompositionIds,
        rank: rankValue,
        reason: 'expected composition missing from keyword selection',
      });
    }
  }

  const totalScenarios = scenarios.length;
  const passRate = totalScenarios === 0 ? 1 : passedScenarios / totalScenarios;
  const top1Accuracy = totalScenarios === 0 ? 1 : top1Matches / totalScenarios;
  const top3Recall = totalScenarios === 0 ? 1 : top3Matches / totalScenarios;
  return {
    generatedAt: new Date().toISOString(),
    totalScenarios,
    passedScenarios,
    passRate,
    top1Accuracy,
    top3Recall,
    scenarioResults,
    failures,
  };
}
