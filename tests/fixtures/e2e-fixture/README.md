# E2E Acceptance Fixture

Deterministic fixture used by LiBrainian E2E acceptance tests.

Key invariants:
- Authentication flow lives in `src/auth/session.js`.
- Validation logic lives in `src/validation/user.js`.
- User lookup lives in `src/user/repository.js`.
- `authenticateUser` calls `validateEmail` and `loadUserByEmail`.
