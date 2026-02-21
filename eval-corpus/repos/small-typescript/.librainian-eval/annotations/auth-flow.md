# Auth Flow Notes — Small TypeScript Fixture

## Session lifecycle
- Sessions are created with `createSession`, which assigns a token, sets `createdAt`, and calculates `expiresAt` based on `config.sessionTtlDays`.
- Sessions are stored in the in-memory database.
- `isSessionExpired` compares `expiresAt` to the current time.

## Authentication
- `authenticate(token)` loads the session, rejects expired sessions, and resolves the user record.
- Inactive users are rejected even if the session is valid.

## Authorization
- `requireRole` verifies that the current user role is included in the allowed role list.
- Controllers call `requireRole` before performing privileged actions.

## Controller enforcement examples
- Book creation and inventory updates require `LiBrainian` or `admin`.
- User deactivation requires `admin`.
- Overdue reports require `LiBrainian` or `admin`.
