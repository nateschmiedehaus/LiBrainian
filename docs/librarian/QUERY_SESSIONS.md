# Query Sessions

Date: 2026-02-18

## Programmatic Multi-turn Sessions
LiBrainian supports conversational query sessions through the `Librarian` API.

```ts
const librarian = await createLibrarian({ workspace, autoBootstrap: true });
await librarian.initialize();

const session = await librarian.startContextSession({ intent: 'auth flow overview', depth: 'L1' });
const followUp = await librarian.followUpContextSession(session.sessionId, 'focus on refresh-token rotation');
const drill = await librarian.drillDownContextSession(session.sessionId, 'src/auth/token_manager.ts');
const summary = await librarian.summarizeContextSession(session.sessionId);
await librarian.closeContextSession(session.sessionId);
```

## CLI Behavior
- `librarian query` is currently stateless.
- For conversational investigations today, use the API session methods above.
- CLI output includes drill-down hints to guide next queries.
