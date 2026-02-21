import { afterEach, describe, expect, it } from 'vitest';
import { globalEventBus, createTaskReceivedEvent } from '../../events.js';
import { SqliteEvidenceLedger, createSessionId, type ToolCallEvidence } from '../evidence_ledger.js';
import {
  collectCorrelationConflictDisclosures,
  disableEventLedgerBridge,
  enableEventLedgerBridge,
  resetEventLedgerBridgeState,
} from '../event_ledger_bridge.js';

describe('Event ledger bridge (W3 correlation)', () => {
  afterEach(() => {
    disableEventLedgerBridge();
    resetEventLedgerBridgeState();
    globalEventBus.clear();
  });

  it('records session IDs and flags multi-agent conflicts for the same task', async () => {
    const ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    enableEventLedgerBridge({ ledger });

    const sessionA = createSessionId('sess_agent_a');
    const sessionB = createSessionId('sess_agent_b');

    const eventA = createTaskReceivedEvent('task-42', 'review logging');
    eventA.sessionId = sessionA;
    const eventB = createTaskReceivedEvent('task-42', 'review logging');
    eventB.sessionId = sessionB;

    await globalEventBus.emit(eventA);
    await globalEventBus.emit(eventB);

    const entriesA = await ledger.query({ sessionId: sessionA, kinds: ['tool_call'] });
    const entriesB = await ledger.query({ sessionId: sessionB, kinds: ['tool_call'] });

    const toolNamesA = entriesA.map((entry) => (entry.payload as ToolCallEvidence).toolName);
    const toolNamesB = entriesB.map((entry) => (entry.payload as ToolCallEvidence).toolName);

    expect(toolNamesA).toContain('librainian_event:task_received');
    expect(toolNamesB).toContain('librainian_event:task_received');
    expect(toolNamesA).toContain('librainian_event_conflict');
    expect(toolNamesB).toContain('librainian_event_conflict');
    expect(entriesA.every((entry) => entry.sessionId === sessionA)).toBe(true);
    expect(entriesB.every((entry) => entry.sessionId === sessionB)).toBe(true);

    const disclosures = await collectCorrelationConflictDisclosures(ledger, sessionA);
    expect(disclosures.some((entry) => entry.includes('multi_agent_conflict'))).toBe(true);

    await ledger.close();
  });
});
