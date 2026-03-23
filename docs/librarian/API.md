# LiBrainian Package API

This page documents the supported TypeScript package surface for the first public release.

If you want the fastest integration path, prefer:

- CLI for shell scripts and CI
- MCP for coding-agent sessions
- TypeScript API only when you are embedding LiBrainian into a Node-based workflow

## Supported entry points

The main package currently exports these public families:

- Session-oriented orchestrator helpers

Anything deeper than these helpers should be treated as source-level internals, not as a stable package contract.

## Recommended entry point

Use `initializeLibrarian` when you want one session object that handles startup and query access for you.

```ts
import { initializeLibrarian } from 'librainian';

const session = await initializeLibrarian(process.cwd());
const result = await session.query('How does authentication work?');

console.log(result.synthesis?.answer);
```

Top-level orchestrator exports:

- `initializeLibrarian`
- `hasSession`
- `getSession`
- `shutdownAllSessions`
- `getActiveSessionCount`

Related exported types:

- `LibrarianSession`
- `InitializeOptions`
- `QueryOptions`
- `Context`
- `TaskResult`
- `HealthReport`

## Public behavior notes

- The package name is `librainian`.
- The compatibility CLI alias `librarian` does not change the package import name.
- Maintainer-only CLI workflows such as `watch`, `update`, `constructions`, `journey`, `live-fire`, and `publish-gate` are not part of the supported package API.
- Low-level runtime helpers, direct query internals, and repo-map/storage utilities may exist in source, but they are not part of the first-release root package contract.

## Stability guidance

Treat these as the stable public layers for first release:

- `initializeLibrarian(...)`
- `session.query(...)`
- `session.recordOutcome(...)`
- `shutdownAllSessions()`

If you need lower-level lifecycle control or direct storage/query primitives, prefer a source checkout or open an issue instead of depending on deep internal modules from `dist/`.

## Related docs

- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/README.md`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/docs/START_HERE.md`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/docs/integrations/README.md`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/docs/mcp-setup.md`
