# LiBrainian Examples

These examples are practical end-to-end starting points for integrating LiBrainian into agent workflows.

## Run

From the repository root:

```bash
npx tsx examples/quickstart_programmatic.ts
npx tsx examples/agentic_task_loop.ts
npx tsx examples/feedback_loop_example.ts
```

Or target a different workspace:

```bash
npx tsx examples/quickstart_programmatic.ts /absolute/path/to/repo "Where is authentication enforced?"
```

## Example Guide

- `quickstart_programmatic.ts`
  - Single-call `initializeLibrarian(...)`
  - Query + confidence + related files output
  - Session health and graceful shutdown
- `agentic_task_loop.ts`
  - Agent loop scaffold: query → act → record outcome
  - Good baseline for orchestrator wrappers
- `feedback_loop_example.ts`
  - Feedback and calibration primitives
  - Signal collection for quality improvement

## Expected Experience

- Auto-bootstrap on first run
- Incremental speedups on repeated runs
- Actionable context with explicit confidence

## CLI Equivalent

```bash
npx librainian quickstart
npx librainian query "How does bootstrap recovery work?"
npx librainian status
npx librainian health
```
