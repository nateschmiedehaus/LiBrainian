import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createAdversarialFixtureUnitPatrolConstruction,
  type UnitPatrolAdversarialCheck,
  type UnitPatrolOperationResult,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOS_ROOT = path.resolve(__dirname, '../../../../eval-corpus/repos');

type AdversarialFixtureCase = {
  repo: string;
  check: UnitPatrolAdversarialCheck;
  expectDeadCodeCheck?: boolean;
  expectSameNameCheck?: boolean;
  expectCircularCheck?: boolean;
};

const CASES: AdversarialFixtureCase[] = [
  {
    repo: 'adversarial-misleading-names',
    check: {
      id: 'misleading-file-name-order-pricing',
      intent: 'Locate the PRICE_ENGINE_CANONICAL discount math implementation.',
      expectedPath: 'src/utils.ts',
      misleadingPath: 'src/domain/orderPricing.ts',
      topK: 5,
    },
  },
  {
    repo: 'adversarial-dead-code',
    check: {
      id: 'dead-code-billing-policy',
      intent: 'Locate ACTIVE_BILLING_POLICY enforcement for overdue invoice handling.',
      expectedPath: 'src/live/billingPolicy.ts',
      misleadingPath: 'src/dead/legacyBilling.ts',
      topK: 5,
    },
    expectDeadCodeCheck: true,
  },
  {
    repo: 'adversarial-circular-deps',
    check: {
      id: 'circular-dependency-entrypoint',
      intent: 'Find CYCLE_SENTINEL_RESOLVE entrypoint behavior and return path.',
      expectedPath: 'src/graph/entry.ts',
      misleadingPath: 'src/graph/a.ts',
      topK: 5,
    },
    expectCircularCheck: true,
  },
  {
    repo: 'adversarial-same-name-paths',
    check: {
      id: 'same-name-worker-index',
      intent: 'Locate WORKER_BACKOFF_JITTER queue retry logic in worker index.',
      expectedPath: 'src/worker/index.ts',
      misleadingPath: 'src/api/index.ts',
      topK: 5,
    },
    expectSameNameCheck: true,
  },
  {
    repo: 'adversarial-opposite-names',
    check: {
      id: 'opposite-naming-banned-user-block',
      intent: 'Locate BLOCK_BANNED_USERS logic that blocks banned accounts.',
      expectedPath: 'src/security/allowAccess.ts',
      misleadingPath: 'src/security/denyAccess.ts',
      topK: 5,
    },
  },
];

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

function getAdversarialOperation(result: { operations: UnitPatrolOperationResult[] }): UnitPatrolOperationResult {
  const operation = result.operations.find((item) => item.operation === 'adversarial');
  if (!operation) {
    throw new Error('Expected adversarial operation result.');
  }
  return operation;
}

describe('Adversarial Fixture Unit Patrol Gate', () => {
  it('contains at least five adversarial fixture repos', async () => {
    const entries = await fs.readdir(REPOS_ROOT, { withFileTypes: true });
    const fixtureRepos = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('adversarial-'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    expect(fixtureRepos.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps expected files ahead of adversarial traps across all fixtures', async () => {
    const construction = createAdversarialFixtureUnitPatrolConstruction();

    for (const fixtureCase of CASES) {
      const outcome = await construction.execute({
        fixtureRepoPath: path.join(REPOS_ROOT, fixtureCase.repo),
        keepSandbox: false,
        timeoutMs: 120_000,
        budget: { maxDurationMs: 120_000 },
        profile: 'strict',
        task: 'adversarial',
        scenario: {
          name: `unit-patrol-adversarial-${fixtureCase.repo}`,
          operations: [
            { kind: 'bootstrap' },
            {
              kind: 'adversarial',
              adversarial: {
                checks: [fixtureCase.check],
                depth: 'L1',
                llmRequirement: 'disabled',
                timeoutMs: 45_000,
              },
            },
            { kind: 'status' },
          ],
        },
        evaluation: {
          minPassRate: 1,
          minMetamorphicTransforms: 0,
          maxDurationMs: 120_000,
        },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        throw outcome.error;
      }
      const result = outcome.value;
      expect(result.pass).toBe(true);

      const adversarialOperation = getAdversarialOperation(result);
      expect(adversarialOperation.pass).toBe(true);

      const details = adversarialOperation.details;
      const checkCount = asNumber(details.checkCount);
      const failedChecks = asNumber(details.failedChecks);
      const deadCodeChecks = asNumber(details.deadCodeChecks);
      const deadCodeSuppressedCount = asNumber(details.deadCodeSuppressedCount);
      const circularChecks = asNumber(details.circularChecks);
      const sameNameChecks = asNumber(details.sameNameChecks);

      expect(checkCount).toBe(1);
      expect(failedChecks).toBe(0);
      expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);

      if (fixtureCase.expectDeadCodeCheck) {
        expect(deadCodeChecks).toBe(1);
        const deadCodeWarning = result.findings.find((finding) => finding.code === 'dead_code_not_deprioritized');
        expect(deadCodeSuppressedCount === 1 || Boolean(deadCodeWarning)).toBe(true);
      }

      if (fixtureCase.expectCircularCheck) {
        expect(circularChecks).toBe(1);
      }

      if (fixtureCase.expectSameNameCheck) {
        expect(sameNameChecks).toBe(1);
      }
    }
  }, 600_000);
});
