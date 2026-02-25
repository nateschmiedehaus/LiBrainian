import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  UnitPatrolEvaluationCriteria,
  UnitPatrolExecutionProfile,
  UnitPatrolInput,
  UnitPatrolOperation,
  UnitPatrolScenario,
  UnitPatrolSelectorDecisionTrace,
  UnitPatrolTask,
  UnitPatrolDomain,
} from './types.js';

export type UnitPatrolExecutionBudget = {
  maxDurationMs: number;
  maxOperations: number;
  maxQueries: number;
  maxMetamorphicTransforms: number;
};

export type UnitPatrolSelection = {
  profile: UnitPatrolExecutionProfile;
  domain: UnitPatrolDomain;
  task: UnitPatrolTask;
  strategyPack: UnitPatrolExecutionProfile;
  budget: UnitPatrolExecutionBudget;
  scenario: UnitPatrolScenario;
  evaluation: Required<UnitPatrolEvaluationCriteria>;
  trace: UnitPatrolSelectorDecisionTrace;
};

const PROFILE_BUDGETS: Record<UnitPatrolExecutionProfile, UnitPatrolExecutionBudget> = {
  quick: {
    maxDurationMs: 60_000,
    maxOperations: 3,
    maxQueries: 1,
    maxMetamorphicTransforms: 0,
  },
  strict: {
    maxDurationMs: 180_000,
    maxOperations: 4,
    maxQueries: 1,
    maxMetamorphicTransforms: 5,
  },
  'deep-bounded': {
    maxDurationMs: 300_000,
    maxOperations: 6,
    maxQueries: 2,
    maxMetamorphicTransforms: 5,
  },
};

const PROFILE_EVALUATION: Record<UnitPatrolExecutionProfile, Required<UnitPatrolEvaluationCriteria>> = {
  quick: {
    minPassRate: 0.67,
    minQueryPacks: 1,
    requireBootstrapped: true,
    maxDurationMs: PROFILE_BUDGETS.quick.maxDurationMs,
    minMetamorphicTransforms: 0,
    maxMetamorphicFailureRate: 1,
  },
  strict: {
    minPassRate: 0.75,
    minQueryPacks: 1,
    requireBootstrapped: true,
    maxDurationMs: PROFILE_BUDGETS.strict.maxDurationMs,
    minMetamorphicTransforms: 5,
    maxMetamorphicFailureRate: 1,
  },
  'deep-bounded': {
    minPassRate: 0.8,
    minQueryPacks: 2,
    requireBootstrapped: true,
    maxDurationMs: PROFILE_BUDGETS['deep-bounded'].maxDurationMs,
    minMetamorphicTransforms: 5,
    maxMetamorphicFailureRate: 0.8,
  },
};

export async function resolveUnitPatrolSelection(
  input: UnitPatrolInput,
  defaultScenario: UnitPatrolScenario,
  defaultEvaluation: Required<UnitPatrolEvaluationCriteria>,
): Promise<UnitPatrolSelection> {
  const rationale: string[] = [];
  const domain = input.domain ?? (await inferDomainFromWorkspace(input.fixtureRepoPath));
  rationale.push(input.domain ? `domain_override:${input.domain}` : `domain_detected:${domain}`);

  const task = input.task ?? inferTaskFromScenario(input.scenario ?? defaultScenario);
  rationale.push(input.task ? `task_override:${input.task}` : `task_inferred:${task}`);

  const profile = input.profile ?? inferProfileFromTask(task);
  rationale.push(input.profile ? `profile_override:${input.profile}` : `profile_inferred:${profile}`);

  const strategyPack = profile;
  const budget = PROFILE_BUDGETS[profile];
  const generatedScenario = buildScenarioForProfile(profile, domain, task);
  const hasSelectionOverrides =
    typeof input.profile === 'string' ||
    typeof input.task === 'string' ||
    typeof input.domain === 'string';
  const baseScenario =
    input.scenario ??
    (hasSelectionOverrides ? generatedScenario : (defaultScenario ?? generatedScenario));
  const enforcement = enforceScenarioBudget(baseScenario, budget);
  const evaluation = {
    ...PROFILE_EVALUATION[profile],
    ...defaultEvaluation,
    ...(input.evaluation ?? {}),
    maxDurationMs: Math.min(
      input.evaluation?.maxDurationMs ?? defaultEvaluation.maxDurationMs ?? budget.maxDurationMs,
      budget.maxDurationMs,
    ),
  };

  rationale.push(
    `strategy_pack:${strategyPack}`,
    `budget:maxDurationMs<=${budget.maxDurationMs}`,
    `budget:maxOperations<=${budget.maxOperations}`,
    `budget:maxQueries<=${budget.maxQueries}`,
  );

  if (enforcement.enforcement.droppedOperations > 0 || enforcement.enforcement.droppedQueries > 0 || enforcement.enforcement.droppedMetamorphic > 0) {
    rationale.push(
      `budget_enforced:droppedOperations=${enforcement.enforcement.droppedOperations}`,
      `budget_enforced:droppedQueries=${enforcement.enforcement.droppedQueries}`,
      `budget_enforced:droppedMetamorphic=${enforcement.enforcement.droppedMetamorphic}`,
    );
  }

  const trace: UnitPatrolSelectorDecisionTrace = {
    profile,
    domain,
    task,
    strategyPack,
    budgets: { ...budget },
    rationale,
    enforcement: enforcement.enforcement,
  };

  return {
    profile,
    domain,
    task,
    strategyPack,
    budget,
    scenario: enforcement.scenario,
    evaluation,
    trace,
  };
}

function inferTaskFromScenario(scenario: UnitPatrolScenario): UnitPatrolTask {
  const operations = scenario.operations.map((operation) => operation.kind);
  if (operations.includes('adversarial')) {
    return 'adversarial';
  }
  if (operations.includes('metamorphic') && operations.filter((kind) => kind === 'query').length > 1) {
    return 'deep-audit';
  }
  if (operations.includes('metamorphic')) {
    return 'metamorphic';
  }
  if (operations.includes('query')) {
    return 'retrieval';
  }
  return 'smoke';
}

function inferProfileFromTask(task: UnitPatrolTask): UnitPatrolExecutionProfile {
  switch (task) {
    case 'smoke':
      return 'quick';
    case 'retrieval':
      return 'quick';
    case 'metamorphic':
      return 'strict';
    case 'deep-audit':
      return 'deep-bounded';
    case 'adversarial':
      return 'strict';
    default:
      return 'strict';
  }
}

function buildScenarioForProfile(
  profile: UnitPatrolExecutionProfile,
  domain: UnitPatrolDomain,
  task: UnitPatrolTask,
): UnitPatrolScenario {
  const primaryIntent = selectDomainIntent(domain, task);
  if (profile === 'quick') {
    return {
      name: `unit-patrol-${domain}-quick`,
      operations: [
        { kind: 'bootstrap', description: 'Bootstrap the repository under patrol.' },
        { kind: 'query', description: 'Run primary domain query.', query: { intent: primaryIntent, depth: 'L1', llmRequirement: 'disabled', timeoutMs: 30_000 } },
        { kind: 'status', description: 'Capture readiness status and index stats.' },
      ],
    };
  }

  if (profile === 'strict') {
    return {
      name: `unit-patrol-${domain}-strict`,
      operations: [
        { kind: 'bootstrap', description: 'Bootstrap the repository under patrol.' },
        { kind: 'query', description: 'Run primary domain query.', query: { intent: primaryIntent, depth: 'L1', llmRequirement: 'disabled', timeoutMs: 45_000 } },
        { kind: 'metamorphic', description: 'Validate semantic query stability under source-preserving transforms.', query: { intent: primaryIntent, depth: 'L1', llmRequirement: 'disabled', timeoutMs: 45_000 } },
        { kind: 'status', description: 'Capture readiness status and index stats.' },
      ],
    };
  }

  return {
    name: `unit-patrol-${domain}-deep-bounded`,
    operations: [
      { kind: 'bootstrap', description: 'Bootstrap the repository under patrol.' },
      { kind: 'query', description: 'Run architecture-focused query.', query: { intent: primaryIntent, depth: 'L2', llmRequirement: 'disabled', timeoutMs: 60_000 } },
      { kind: 'query', description: 'Run domain-specific failure-mode query.', query: { intent: selectSecondaryIntent(domain), depth: 'L2', llmRequirement: 'disabled', timeoutMs: 60_000 } },
      { kind: 'metamorphic', description: 'Validate semantic query stability under source-preserving transforms.', query: { intent: primaryIntent, depth: 'L2', llmRequirement: 'disabled', timeoutMs: 60_000 } },
      { kind: 'status', description: 'Capture readiness status and index stats.' },
    ],
  };
}

function selectDomainIntent(domain: UnitPatrolDomain, task: UnitPatrolTask): string {
  if (task === 'deep-audit') {
    return 'Map core architecture boundaries, failure modes, and dependency hot paths for this repository.';
  }
  switch (domain) {
    case 'python':
      return 'Locate service entrypoints, dependency wiring, and error handling paths in the Python codebase.';
    case 'rust':
      return 'Locate crate/module boundaries, trait implementations, and error propagation paths in the Rust codebase.';
    case 'go':
      return 'Locate package boundaries, interface implementations, and error handling patterns in the Go codebase.';
    case 'javascript':
    case 'typescript':
      return 'Summarize repository architecture, runtime entrypoints, and cross-module dependencies.';
    case 'polyglot':
      return 'Summarize cross-language architecture boundaries and integration points in this repository.';
    default:
      return 'Summarize repository architecture and key entrypoints.';
  }
}

function selectSecondaryIntent(domain: UnitPatrolDomain): string {
  switch (domain) {
    case 'python':
      return 'Identify Python modules with highest change risk and missing test coverage signals.';
    case 'rust':
      return 'Identify unsafe/error-prone Rust paths and recently changed modules requiring verification.';
    case 'go':
      return 'Identify concurrency or goroutine-sensitive Go paths with elevated regression risk.';
    case 'javascript':
    case 'typescript':
      return 'Identify high-risk modules with dense dependencies and likely regression impact.';
    case 'polyglot':
      return 'Identify cross-language integration seams with highest regression risk.';
    default:
      return 'Identify modules with highest regression risk and dependency concentration.';
  }
}

function enforceScenarioBudget(
  scenario: UnitPatrolScenario,
  budget: UnitPatrolExecutionBudget,
): {
  scenario: UnitPatrolScenario;
  enforcement: UnitPatrolSelectorDecisionTrace['enforcement'];
} {
  const operations: UnitPatrolOperation[] = [];
  let queryCount = 0;
  let metamorphicCount = 0;
  let droppedOperations = 0;
  let droppedQueries = 0;
  let droppedMetamorphic = 0;

  for (const operation of scenario.operations) {
    if (operations.length >= budget.maxOperations) {
      droppedOperations += 1;
      continue;
    }
    if (operation.kind === 'query' && queryCount >= budget.maxQueries) {
      droppedOperations += 1;
      droppedQueries += 1;
      continue;
    }
    if (operation.kind === 'metamorphic' && metamorphicCount >= 1) {
      droppedOperations += 1;
      droppedMetamorphic += 1;
      continue;
    }
    operations.push(operation);
    if (operation.kind === 'query') queryCount += 1;
    if (operation.kind === 'metamorphic') metamorphicCount += 1;
  }

  return {
    scenario: {
      name: scenario.name,
      operations,
    },
    enforcement: {
      droppedOperations,
      droppedQueries,
      droppedMetamorphic,
    },
  };
}

async function inferDomainFromWorkspace(workspace: string): Promise<UnitPatrolDomain> {
  const extensionCounts = new Map<string, number>();
  const stack = [workspace];
  const ignored = new Set(['.git', '.librarian', 'node_modules', 'dist', 'coverage', '.tmp']);
  let inspected = 0;

  while (stack.length > 0 && inspected < 500) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      inspected += 1;
      const extension = path.extname(entry.name).toLowerCase();
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
      if (inspected >= 500) break;
    }
  }

  const tsLike = (extensionCounts.get('.ts') ?? 0) + (extensionCounts.get('.tsx') ?? 0);
  const jsLike = (extensionCounts.get('.js') ?? 0) + (extensionCounts.get('.jsx') ?? 0) + (extensionCounts.get('.mjs') ?? 0) + (extensionCounts.get('.cjs') ?? 0);
  const py = extensionCounts.get('.py') ?? 0;
  const go = extensionCounts.get('.go') ?? 0;
  const rust = extensionCounts.get('.rs') ?? 0;

  const languages = [
    { domain: 'typescript' as const, count: tsLike },
    { domain: 'javascript' as const, count: jsLike },
    { domain: 'python' as const, count: py },
    { domain: 'go' as const, count: go },
    { domain: 'rust' as const, count: rust },
  ].filter((item) => item.count > 0);

  if (languages.length === 0) return 'unknown';
  if (languages.length > 1) {
    const dominant = [...languages].sort((left, right) => right.count - left.count)[0];
    const total = languages.reduce((sum, item) => sum + item.count, 0);
    if (dominant.count / Math.max(total, 1) < 0.7) {
      return 'polyglot';
    }
    return dominant.domain;
  }
  return languages[0].domain;
}
