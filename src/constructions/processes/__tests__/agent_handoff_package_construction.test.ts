import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deterministic } from '../../../epistemics/confidence.js';
import { SqliteEvidenceLedger, type SessionId } from '../../../epistemics/evidence_ledger.js';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createAgentHandoffPackageConstruction } from '../agent_handoff_package_construction.js';

describe('AgentHandoffPackageConstruction', () => {
  let tempDir = '';
  let ledger: SqliteEvidenceLedger | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-handoff-'));
    await fs.mkdir(path.join(tempDir, '.librarian'), { recursive: true });
    ledger = new SqliteEvidenceLedger(path.join(tempDir, '.librarian', 'evidence_ledger.db'));
    await ledger.initialize();
  });

  afterEach(async () => {
    if (ledger) {
      await ledger.close();
      ledger = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('exports machine-readable handoff state with invariants, conflicts, blast radius, and stable hash', async () => {
    const sessionId = 'session-handoff-388' as SessionId;
    const provenance = { source: 'system_observation', method: 'agent_handoff_package_test' } as const;

    const invariantClaim = await ledger!.append({
      kind: 'claim',
      payload: {
        claim: 'invoiceId must be unique per cycle',
        category: 'behavior',
        subject: { type: 'function', identifier: 'InvoiceGenerator.generate' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: deterministic(true, 'verified_in_session'),
      },
      provenance,
      confidence: deterministic(true, 'verified_in_session'),
      relatedEntries: [],
      sessionId,
    });

    const conflictClaimA = await ledger!.append({
      kind: 'claim',
      payload: {
        claim: 'PaymentProcessor.charge() returns ChargeResult',
        category: 'behavior',
        subject: { type: 'function', identifier: 'PaymentProcessor.charge' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: deterministic(true, 'observed_contract'),
      },
      provenance,
      confidence: deterministic(true, 'observed_contract'),
      relatedEntries: [],
      sessionId,
    });

    const conflictClaimB = await ledger!.append({
      kind: 'claim',
      payload: {
        claim: 'PaymentProcessor.charge() returns Promise<void>',
        category: 'behavior',
        subject: { type: 'function', identifier: 'PaymentProcessor.charge' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: deterministic(true, 'new_contract_hypothesis'),
      },
      provenance,
      confidence: deterministic(true, 'new_contract_hypothesis'),
      relatedEntries: [],
      sessionId,
    });

    await ledger!.append({
      kind: 'contradiction',
      payload: {
        claimA: conflictClaimA.id,
        claimB: conflictClaimB.id,
        contradictionType: 'direct',
        explanation: 'Return type mismatch cannot be resolved without picking one canonical interface.',
        severity: 'blocking',
      },
      provenance,
      relatedEntries: [],
      sessionId,
    });

    await ledger!.append({
      kind: 'tool_call',
      payload: {
        toolName: 'read_file',
        arguments: { path: 'src/billing/InvoiceGenerator.ts' },
        result: { ok: true },
        success: true,
        durationMs: 4,
      },
      provenance,
      relatedEntries: [],
      sessionId,
    });

    await ledger!.append({
      kind: 'tool_call',
      payload: {
        toolName: 'apply_patch',
        arguments: { path: 'src/billing/PaymentProcessor.ts' },
        result: { ok: true },
        success: true,
        durationMs: 8,
      },
      provenance,
      relatedEntries: [],
      sessionId,
    });

    await ledger!.append({
      kind: 'human_override',
      payload: {
        constructionId: 'librainian:agent-handoff-package',
        reviewerId: 'reviewer@example',
        decision: 'Do not adopt Promise<void> yet',
        rationale: 'Existing callers depend on ChargeResult shape.',
        request: {
          sessionId,
          constructionId: 'librainian:agent-handoff-package',
          question: 'Should we switch charge() return type now?',
          context: 'Mid-refactor with unresolved API migration.',
          evidenceRefs: [invariantClaim.id],
        },
      },
      provenance,
      relatedEntries: [],
      sessionId,
    });

    const changedFiles = [
      'src/billing/PaymentProcessor.ts',
      'src/billing/InvoiceGenerator.ts',
    ];
    const blastRadiusCalls: string[] = [];

    const construction = createAgentHandoffPackageConstruction({
      workspaceRoot: tempDir,
      listChangedFiles: async () => changedFiles,
      computeBlastRadius: async (_workspaceRoot, targetPath) => {
        blastRadiusCalls.push(targetPath);
        if (targetPath.includes('PaymentProcessor')) {
          return { directCallers: 3, transitiveCallers: 8 };
        }
        return { directCallers: 1, transitiveCallers: 2 };
      },
    });

    const first = unwrapConstructionExecutionResult(await construction.execute({
      sessionId,
      continuationFocus: 'Resolve charge() return type conflict without violating invoice invariants.',
      includeRejectedAlternatives: true,
      minClaimConfidence: 0.7,
    }));

    expect(first.kind).toBe('AgentHandoffPackageResult.v1');
    expect(first.establishedInvariants.some((entry) => entry.invariant.includes('invoiceId must be unique per cycle'))).toBe(true);
    expect(first.openConflicts).toHaveLength(1);
    expect(first.openConflicts[0]?.whyUnresolvable).toContain('Return type mismatch');
    expect(first.openConflicts[0]?.claim1.description).toContain('PaymentProcessor.charge()');
    expect(first.briefingTokenEstimate).toBeLessThanOrEqual(3000);
    expect(first.inProgressChanges).toHaveLength(2);
    expect(first.inProgressChanges[0]?.currentBlastRadius.directCallers).toBeGreaterThan(0);
    expect(first.inProgressChanges[0]?.currentBlastRadius.transitiveCallers).toBeGreaterThan(0);
    expect(first.rejectedAlternatives).toHaveLength(1);
    expect(first.sessionTopology.filesRead).toContain('src/billing/InvoiceGenerator.ts');
    expect(first.sessionTopology.filesModified).toContain('src/billing/PaymentProcessor.ts');
    expect(blastRadiusCalls.sort((a, b) => a.localeCompare(b))).toEqual(
      [...changedFiles].sort((a, b) => a.localeCompare(b)),
    );

    const written = JSON.parse(await fs.readFile(first.outputPath, 'utf8')) as { handoffHash?: string };
    expect(written.handoffHash).toBe(first.handoffHash);

    const second = unwrapConstructionExecutionResult(await construction.execute({
      sessionId,
      continuationFocus: 'Resolve charge() return type conflict without violating invoice invariants.',
      includeRejectedAlternatives: true,
      minClaimConfidence: 0.7,
    }));
    expect(second.handoffHash).toBe(first.handoffHash);

    await ledger!.append({
      kind: 'claim',
      payload: {
        claim: 'Billing cycle closes before invoice emission',
        category: 'behavior',
        subject: { type: 'function', identifier: 'BillingCycle.close' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: deterministic(true, 'late_session_discovery'),
      },
      provenance,
      confidence: deterministic(true, 'late_session_discovery'),
      relatedEntries: [],
      sessionId,
    });

    const third = unwrapConstructionExecutionResult(await construction.execute({
      sessionId,
      continuationFocus: 'Resolve charge() return type conflict without violating invoice invariants.',
      includeRejectedAlternatives: true,
      minClaimConfidence: 0.7,
    }));
    expect(third.handoffHash).not.toBe(first.handoffHash);
  });
});
