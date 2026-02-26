# Autonomous Agent Work Loop Prompt v2 (Natural Dogfooding)

Purpose: preserve milestone-driven autonomous execution while aligning with issue #833 natural-usage principles.

## Core Loop

1. Orient every resume
- `git status`
- `git log --oneline -5`
- Read: `AGENTS.md`, `CLAUDE.md`, `docs/librarian/STATUS.md`

2. Pick active milestone
- Strict order: `M0 -> M1 -> M2 -> M3 -> M4`
- Select next issue by priority, kind, actionable label, then issue number.

3. Understand before coding
- Read full issue body and linked blockers.
- Find affected files and tests.
- Identify acceptance criteria and verification commands.

4. Use LiBrainian naturally (not ceremonially)
- Query when uncertainty is high.
- Use natural-language intents tied to user outcomes.
- Skip LiBrainian for trivial deterministic edits.
- Capture `decision_trace.md` when LiBrainian changes the plan.

5. Implement with evidence discipline
- Add regression tests for bug fixes.
- Run required build/test/patrol gates.
- Preserve fail-closed behavior.

6. Verify and close with evidence
- `npm run build && npm test`
- Include issue closure evidence fields:
  - Natural usage evidence
  - Causal usefulness evidence
  - Restraint evidence
  - Patrol/CI signal review

7. Continue to next issue
- Never stop after one issue unless hard blocked.

## Natural-Usage Guardrails

- No mandatory wrapper loop that forces LiBrainian usage on every task.
- Prefer one high-quality query over many low-value queries.
- Run L0 prompts in evaluation to test spontaneous adoption.
- Prove causal usefulness with ablation replay.
- Measure restraint with use-vs-skip precision/recall.
