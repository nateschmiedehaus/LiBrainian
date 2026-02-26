# Planned Sequence: issue_838_impl

## Input
- intent: Users get logged out randomly after idle time
- changedFiles: src/auth/session.ts
- changedFunctions: src/auth/session.ts:refreshSession

## Planned order
1. smoke
- tests/unit/session_refresh.test.ts

2. targeted
- tests/integration/auth_logout.integration.test.ts

3. regression
- (none in pilot task)

4. fallback (conditional)
- npm test -- --run
- trigger: low confidence or staged test failure

## Rationale summary
- Smoke first for fast breakage detection.
- Targeted integration next for behavior-level session/logout path checks.
- Fallback broad suite to maintain regression safety when confidence is insufficient.
