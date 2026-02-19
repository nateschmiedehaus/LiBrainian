# OpenClaw Memory Bridge

LiBrainian can bridge `harvest_session_knowledge` outputs into annotated `MEMORY.md` entries that are linked to evidence IDs.

## Why

OpenClaw memory files are useful but can go stale. The memory bridge adds:

1. `librainian:ev_*` annotations with confidence metadata.
2. Evidence-ledger entries with provenance (`memory_bridge_harvest`).
3. Stale-marking support via Homeostasis hooks when defeaters are detected.

## Harvest to Memory

```bash
# MCP tool call payload
{
  "sessionId": "sess_123",
  "workspace": "/path/to/repo",
  "minConfidence": 0.8,
  "memoryFilePath": "/path/to/repo/.openclaw/memory/MEMORY.md",
  "persistToMemory": true,
  "source": "openclaw-session"
}
```

When persisted, claims are written like:

```markdown
- UserRepository uses CockroachDB <!-- librainian:ev_abc123:confidence=0.88 -->
```

## CLI Status Check

```bash
librarian memory-bridge status --memory-file /path/to/repo/.openclaw/memory/MEMORY.md --json
```

This reports total, active, and defeated entries from the local memory-bridge state file.

## Stale Marking Hook

Use `applyMemoryBridgeDefeaters` from `src/homeostasis/memory_bridge_hook.ts` after a reindex cycle to mark defeated memory claims:

```ts
await applyMemoryBridgeDefeaters({
  workspaceRoot,
  memoryFilePath,
  defeaters: [
    {
      evidenceId: 'ev_abc123',
      reason: 'schema migration detected: CockroachDB',
      replacement: {
        claim: 'UserRepository uses CockroachDB',
        evidenceId: 'ev_xyz789',
        confidence: 0.89,
      },
    },
  ],
});
```
