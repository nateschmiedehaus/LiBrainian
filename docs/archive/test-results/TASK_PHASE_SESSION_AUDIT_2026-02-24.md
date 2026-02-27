# Task Phase Session-State Audit (2026-02-24)

Scope: verify whether tool-call history is persisted and retrievable for phase classification.

## Commands run

```bash
rg -n "tool|history|ConversationTurn|packIds|session" src/api/context_sessions.ts
rg -n "queryHistory|sessions: Map|tool call" src/mcp/server.ts
```

## Evidence

1. `src/api/context_sessions.ts` persists conversation turns (`history`, `packIds`) and query/drilldown/summary state, but no dedicated tool-call sequence store.
2. `src/mcp/server.ts` maintains in-memory `SessionState.queryHistory` for loop detection, but this is process-memory state and not durable persistence.

## Conclusion

- Tool-call history is retrievable in-memory during an MCP server session.
- Durable persisted tool-call history in `context_sessions` is not currently present.
- Phase detector integration therefore accepts explicit `recentToolCalls` as input, and transition logic is deterministic from provided session signals.

## Follow-up recommendation

- Add durable tool-call timeline persistence to context sessions (or a dedicated session-store table) so phase detection can source history directly without caller-supplied tool traces.
