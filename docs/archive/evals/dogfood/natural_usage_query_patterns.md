# Natural Usage Query Patterns (Issue #833)

Status: active
Owner: librarianship
Last Updated: 2026-02-25

This file defines task-language query patterns with expected output contracts so contributors can use LiBrainian naturally without wrapper rituals.

## 1) Bug Investigation

Natural query example:
- `npx librainian query "Users get logged out randomly after idle time"`

Expected output:
- Primary candidate files/functions tied to session expiry/auth refresh.
- At least one evidence-backed hypothesis with file/line context.
- Suggested verification tests or logs to check next.

## 2) Feature Location

Natural query example:
- `npx librainian query "Where should I add retry budget enforcement for API calls?"`

Expected output:
- Recommended insertion points with dependency context.
- Related interfaces/callers likely affected.
- Concrete next edits (`file`, `function`, `reason`).

## 3) Safe Refactor Planning

Natural query example:
- `npx librainian query "What could break if I split query cache helpers from src/api/query.ts?"`

Expected output:
- Direct and transitive impact map (imports/callers/tests).
- High-risk areas and rollback-sensitive paths.
- Ordered validation checklist for before/after refactor.

## 4) Test Impact Analysis

Natural query example:
- `npx librainian query "What tests should change if I modify bootstrap quality gate warnings?"`

Expected output:
- Candidate test files by strongest relevance.
- Missing or weakly-covered scenarios to add.
- Suggested assertion updates mapped to changed behavior.

## Non-Ceremonial Rule

These patterns are defaults for high-uncertainty work. They are not mandatory loops; skip LiBrainian for trivial deterministic edits and record why.
