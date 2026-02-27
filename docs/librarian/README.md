# LiBrainian Documentation

## What LiBrainian Is
LiBrainian is the knowledge and understanding layer for any codebase. It
extracts, constructs, and serves evidence-backed understanding for agents
and humans, with calibrated confidence, defeaters, and explicit traces.

## What LiBrainian Provides
- Understanding: purpose, mechanism, contract, dependencies, consequences.
- Knowledge mappings: dependency, data flow, ownership, risk, tests, rationale.
- Agent-ready responses: answer + evidence + confidence + next actions.
- Method guidance: hints and checklists for applicable problem-solving methods.
- Full lifecycle support: onboarding, change, debug, refactor, release.
- Universal codebase support: immediate onboarding for new languages.

## What LiBrainian Is Not
- Not a general-purpose orchestrator or task runner.
- Not a replacement for tests, reviews, or CI.
- Not a fake-embedding system or heuristic-only retrieval.

## Essential Documents

| Document | Purpose |
|----------|---------|
| `docs/librarian/STATUS.md` | Machine-verified project status |
| `docs/librarian/GATES.json` | Machine-readable gate metrics |
| `docs/librarian/CONVERSATION_INSIGHTS.md` | Strategy tracker (required at release checkpoints) |
| `docs/librarian/DIAGNOSIS_AND_PLAN.md` | Recovery plan |
| `docs/librarian/ROADMAP.md` | Milestone plan |
| `docs/librarian/API.md` | API reference |
| `docs/TEST.md` | Testing policy |

## Launch Evidence Rule
- `REAL_AGENT_REAL_LIBRARIAN_ONLY`: launch and publish claims must come from real agents operating on the real LiBrainian repository.
- `NO_SYNTHETIC_OR_REFERENCE_FOR_RELEASE`: mock, synthetic, or reference harness outputs are non-release evidence only.
- `NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE`: any retry/fallback/degraded path in release artifacts is a release failure.
- `PERFECT_RELEASE_EVIDENCE_ONLY`: launch evidence is accepted only when strict gates pass with zero strict-failure markers.

## How to Interpret Docs
- `STATUS.md` is reality with evidence; treat it as truth.
- `ROADMAP.md` is forward-looking; treat it as intent until verified.
- `docs/archive/` contains historical docs; do not treat as current guidance.

## Archived Documentation
Historical specs, process docs, phase reports, and validation docs have been
moved to `docs/archive/`. See `docs/archive/README.md` for details.
