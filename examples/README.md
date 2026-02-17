# LiBrainian Examples

These examples are designed to be practical, copy-pasteable starting points.

## Run Examples

From the repo root:

```bash
npx tsx examples/quickstart_programmatic.ts
npx tsx examples/agentic_task_loop.ts
npx tsx examples/feedback_loop_example.ts
```

You can also point examples at another workspace:

```bash
npx tsx examples/quickstart_programmatic.ts /absolute/path/to/repo "Where is auth handled?"
```

## What Each Example Covers

- `quickstart_programmatic.ts`
  - one-call `initializeLibrarian(...)`
  - query + structured output
  - health inspection
- `agentic_task_loop.ts`
  - query → task execution placeholder → outcome recording
  - practical pattern for agent wrappers and orchestrators
- `feedback_loop_example.ts`
  - low-level feedback loop primitives
  - signal tracking and calibration bias analysis

## Notes

- `initializeLibrarian(...)` auto-bootstraps and auto-configures for the workspace.
- LLM providers are optional for many paths, but richer synthesis requires provider configuration.
- For CLI-first usage, run:

```bash
npx librainian quickstart
npx librainian query "How does bootstrap recovery work?"
npx librainian health
```
