import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueryRelevanceGateConstruction } from '../query_relevance_gate.js';

const tempRoots: string[] = [];

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-relevance-'));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('Query Relevance Gate', () => {
  it('evaluates curated query pairs, reports precision@k, and flags threshold regressions', async () => {
    const fixture = await createFixture({
      'src/policy/loanPolicy.ts': [
        'export interface LoanDecision { allowed: boolean; reason?: string }',
        'export function canCheckout(activeLoans: number, limit: number): LoanDecision {',
        '  if (activeLoans >= limit) return { allowed: false, reason: "Loan limit reached" };',
        '  return { allowed: true };',
        '}',
      ].join('\n'),
      'src/auth/sessionStore.ts': [
        'export interface Session { token: string; userId: string }',
        'export function createSession(userId: string): Session {',
        '  return { token: `session-${userId}`, userId };',
        '}',
      ].join('\n'),
      'src/data/db.ts': [
        'export interface DbConnection { connected: boolean }',
        'export function connectDatabase(): DbConnection {',
        '  return { connected: true };',
        '}',
      ].join('\n'),
    });

    const gate = createQueryRelevanceGateConstruction();
    const outcome = await gate.execute({
      fixtures: [
        {
          name: 'query-relevance-fixture',
          repoPath: fixture,
          pairs: [
            { query: 'loan policy and borrowing limits', expectedFiles: ['src/policy/loanPolicy.ts'] },
            { query: 'session storage for authentication tokens', expectedFiles: ['src/auth/sessionStore.ts'] },
            { query: 'database connection and persistence', expectedFiles: ['src/data/db.ts'] },
          ],
        },
      ],
      k: 3,
      precisionThreshold: 0.2,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const result = outcome.value;

    expect(result.kind).toBe('QueryRelevanceGateResult.v1');
    expect(result.k).toBe(3);
    expect(result.precisionThreshold).toBe(0.2);
    expect(result.fixtures.length).toBeGreaterThan(0);
    expect(result.fixtures.every((fixtureResult) => fixtureResult.pairResults.length >= 3)).toBe(true);

    expect(
      result.fixtures.every((fixtureResult) =>
        fixtureResult.pairResults.every((pair) =>
          pair.precisionAtK >= 0 &&
          pair.precisionAtK <= 1 &&
          pair.confidenceValues.every((confidence) => confidence >= 0 && confidence <= 1) &&
          pair.quality.kind === 'ResultQualityJudgment.v1' &&
          pair.quality.scores.relevance >= 0 &&
          pair.quality.scores.relevance <= 1 &&
          pair.quality.scores.completeness >= 0 &&
          pair.quality.scores.completeness <= 1 &&
          pair.quality.scores.actionability >= 0 &&
          pair.quality.scores.actionability <= 1 &&
          pair.quality.scores.accuracy >= 0 &&
          pair.quality.scores.accuracy <= 1
        )
      )
    ).toBe(true);

    expect(
      result.fixtures.every((fixtureResult) =>
        fixtureResult.pairResults.every((pair) => !pair.topFiles.some((file) => file.includes('.librarian/')))
      )
    ).toBe(true);

    const hasPrecisionRegression = result.fixtures.some((fixtureResult) =>
      fixtureResult.pairResults.some((pair) => pair.precisionAtK < result.precisionThreshold),
    );
    if (hasPrecisionRegression) {
      expect(result.pass).toBe(false);
      expect(result.findings.some((finding) => finding.includes(`precision@${result.k}`))).toBe(true);
    }
  }, 160_000);
});
