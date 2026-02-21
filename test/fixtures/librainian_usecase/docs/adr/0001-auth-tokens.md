# ADR 0001: Use JWT for Authentication Tokens

## Status
Accepted

## Context
We need a stateless authentication mechanism for our user service that can scale horizontally.

## Decision
We will use JSON Web Tokens (JWT) for authentication. Tokens will be signed with RS256 and have a 24-hour expiry.

## Consequences
- Stateless authentication allows horizontal scaling
- Tokens cannot be revoked until expiry (mitigated by short expiry)
- Need to handle token refresh properly
