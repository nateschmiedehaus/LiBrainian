# Security Use Case Test Results

**Date**: 2026-01-31
**Tester**: Claude Opus 4.5
**Mode**: `--no-synthesis` (raw semantic retrieval)

## Executive Summary

The LiBrainian performs **moderately well** for security-related queries but has significant gaps in surface-level security discovery. It excels at finding internal sanitization/validation code but struggles with database access patterns and comprehensive security infrastructure discovery.

**Overall Rating**: 6/10 for Security Use Cases

---

## Query 1: "where is user input validated"

### Results Returned (7 packs, confidence 0.803)

| File | Function | Relevance |
|------|----------|-----------|
| `src/api/technique_contracts.ts` | `validateTechniqueContractInput` | TRUE POSITIVE - validates input against schema |
| `src/api/technique_contracts.ts` | `validateTechniqueContractPostconditions` | TRUE POSITIVE - validates postconditions |
| `src/api/technique_execution.ts` | `sanitizeCompositionInputs` | TRUE POSITIVE - sanitizes composition inputs |
| `src/epistemics/formula_ast.ts` | `isInputRefNode` | FALSE POSITIVE - type guard, not validation |
| `src/constructions/base/validation_construction.ts` | `validate()` | TRUE POSITIVE - validation interface |
| `src/constructions/base/validation_construction.ts` | `getRules()` | MARGINAL - gets validation rules |
| `src/skills/validator.ts` | `validateInput` | TRUE POSITIVE - validates skill inputs |

### Assessment

- **Did it find security-relevant code?** YES - Found 5 of 7 results genuinely related to input validation
- **False positives?** 1 (type guard `isInputRefNode` is not security validation)
- **What was MISSED?**
  - `/src/security/sanitization.ts` - The MAIN sanitization module with `sanitizePath`, `sanitizeString`, `sanitizeQuery`
  - `/src/mcp/authentication.ts` - Session token validation
  - `/src/api/query.ts` - Query input validation at API boundary

**Score: 7/10** - Good recall on technique/construction validation, missed the dedicated security module

---

## Query 2: "authentication and authorization code"

### Results Returned (7 packs, confidence 0.800)

| File | Function | Relevance |
|------|----------|-----------|
| `src/guidance/parser.ts` | `detectAuthRuleType` | TRUE POSITIVE - auth rule detection |
| `src/mcp/server.ts` | `getAuthManager` | TRUE POSITIVE - retrieves auth manager |
| `src/mcp/authentication.ts` | `createAuthenticationManager` | TRUE POSITIVE - creates auth manager |
| `src/utils/auth_checker.ts` | `getAuthGuidance` | TRUE POSITIVE - auth guidance |
| `src/mcp/authentication.ts` | `getToolAuthorization` | TRUE POSITIVE - tool authorization |
| `src/mcp/audit.ts` | `logAuthorization` | TRUE POSITIVE - audit logging |
| `src/constructions/strategic/developer_experience_construction.ts` | `createDeveloperExperienceConstruction` | FALSE POSITIVE - unrelated |

### Assessment

- **Did it find security-relevant code?** YES - 6 of 7 results are auth-related
- **False positives?** 1 (`developer_experience_construction` is not auth code)
- **What was MISSED?**
  - Session token validation logic in `src/mcp/authentication.ts`
  - RBAC/scope enforcement code
  - Consent tracking mechanisms

**Score: 8/10** - Good coverage of auth infrastructure

---

## Query 3: "SQL injection vulnerabilities or raw queries"

### Results Returned (2 packs, confidence 0.812)

| File | Function | Relevance |
|------|----------|-----------|
| `src/constructions/security_audit_helper.ts` | `getDescriptionForPattern` | FALSE POSITIVE - helper for descriptions, not SQL |
| `src/constructions/security_audit_helper.ts` | `getRemediationForPattern` | FALSE POSITIVE - remediation text, not SQL code |

### Assessment

- **Did it find security-relevant code?** NO - Both results are about security audit UI text, not actual database code
- **False positives?** 2/2 (100% false positive rate)
- **What was MISSED?**
  - `/src/storage/sqlite_storage.ts` - ALL raw SQL queries (700+ lines with `.prepare()`, `.exec()`, `.all()`)
  - `/src/migrations/001_initial.sql` - SQL migration file
  - Database access patterns using `better-sqlite3`
  - No parameterized query detection

**Score: 2/10** - Critical failure. The codebase uses SQLite extensively but the query found nothing relevant

---

## Query 4: "secrets and API keys handling"

### Results Returned (3 packs, confidence 0.824)

| File | Function | Relevance |
|------|----------|-----------|
| `src/api/operator_interpreters.ts` | `resolveOperatorOutputKey` | FALSE POSITIVE - operator keys, not API keys |
| `src/api/llm_provider_discovery.ts` | `isSensitiveKey` | TRUE POSITIVE - detects sensitive metadata keys |
| `src/constructions/security_audit_helper.ts` | `getDescriptionForPattern` | MARGINAL - security patterns |

### Assessment

- **Did it find security-relevant code?** PARTIALLY - 1 of 3 is directly relevant
- **False positives?** 1 (`resolveOperatorOutputKey` is about operator naming, not secrets)
- **What was MISSED?**
  - Environment variable handling for LLM API keys
  - Any .env file parsing
  - Credential storage/retrieval patterns
  - The auth token generation using `crypto.randomBytes` in authentication.ts
  - Session token hashing

**Score: 4/10** - Found one relevant function but missed critical secret handling patterns

---

## Query 5: "input sanitization functions"

### Results Returned (10 packs, confidence 0.829)

| File | Function | Relevance |
|------|----------|-----------|
| `src/api/technique_execution.ts` | `sanitizeCompositionInputs` | TRUE POSITIVE |
| `src/api/technique_execution.ts` | `sanitizeInputValue` | TRUE POSITIVE |
| `src/api/operator_interpreters.ts` | `sanitizeOutputKey` | TRUE POSITIVE |
| `src/api/plan_compiler.ts` | `sanitizeId` | TRUE POSITIVE |
| `src/api/technique_execution.ts` | `sanitizeOperatorState` | TRUE POSITIVE |
| `src/api/technique_execution.ts` | `sanitizeOutputValue` | TRUE POSITIVE |
| `src/api/operator_interpreters.ts` | `sanitizeCheckpointRecord` | TRUE POSITIVE |
| `src/api/operator_interpreters.ts` | `sanitizeOperatorKey` | TRUE POSITIVE |
| `src/storage/sqlite_storage.ts` | `sanitizeForError` | TRUE POSITIVE |
| `src/api/technique_execution.ts` | `mergeOperatorOutputs` | MARGINAL - merge, not sanitize |

### Assessment

- **Did it find security-relevant code?** YES - 9 of 10 are sanitization functions
- **False positives?** 1 marginal result
- **What was MISSED?**
  - `/src/security/sanitization.ts` - THE MAIN SANITIZATION MODULE with:
    - `sanitizePath()` - path traversal prevention
    - `sanitizeString()` - string sanitization
    - `sanitizeQuery()` - query sanitization
    - `escapeRegex()` - regex escaping
    - `escapeShell()` - shell command escaping
    - `sanitizeObject()` - object schema validation
  - Control character removal functions

**Score: 5/10** - Found many internal sanitizers but completely missed the dedicated security/sanitization.ts module!

---

## Critical Missed Security Infrastructure

The LiBrainian **failed to surface** these critical security components:

### 1. Dedicated Security Module (`/src/security/`)
```
src/security/
  - index.ts (security exports, SecureConfig)
  - sanitization.ts (path/string/query sanitization, injection prevention)
  - rate_limiter.ts (RateLimiter, CircuitBreaker classes)
  - error_boundary.ts (safe error handling)
```

### 2. Rate Limiting Infrastructure
The codebase has comprehensive rate limiting (token bucket, sliding window, circuit breaker) in `src/security/rate_limiter.ts` but NO queries found it.

### 3. Database Security
- 700+ lines of raw SQL in `sqlite_storage.ts`
- Uses parameterized queries via `better-sqlite3` (good practice)
- But LiBrainian couldn't surface this for SQL injection review

### 4. Authentication Token Security
- Uses `crypto.randomBytes()` for token generation
- Hashes tokens before storage
- Has session expiration logic

---

## Root Cause Analysis

### Why Did Security Queries Fail?

1. **Semantic Gap**: The embedding model doesn't strongly associate "SQL injection" with patterns like `.prepare()`, `.exec()`, `db.run()`

2. **Module Discovery Weakness**: The `/src/security/` directory is the canonical security module but wasn't prioritized despite direct semantic match

3. **File vs Function Indexing**: Results are function-level but security review needs file-level or module-level discovery

4. **Missing Security Domain Keywords**: The index may not weight security-specific terms (injection, vulnerability, sanitization, XSS, CSRF) strongly enough

---

## Recommendations

1. **Add Security Domain Boosting**: Weight results from known security directories (`/security/`, `/auth/`, `/sanitization/`)

2. **SQL Pattern Detection**: Add specialized heuristics for database access patterns (`.query()`, `.exec()`, `.prepare()`)

3. **Security Keyword Expansion**: Expand queries like "SQL injection" to include implementation patterns: `prepare`, `exec`, `parameterized`, `escape`

4. **Module-Level Results**: For security queries, surface entire modules not just functions

5. **Create Security-Specific Index**: Tag files/functions with security relevance during indexing

---

## Summary Table

| Query | Packs Found | True Positives | False Positives | Critical Misses | Score |
|-------|-------------|----------------|-----------------|-----------------|-------|
| User input validation | 7 | 5 | 1 | 3 | 7/10 |
| Auth/authz code | 7 | 6 | 1 | 2 | 8/10 |
| SQL injection | 2 | 0 | 2 | 4 | 2/10 |
| Secrets/API keys | 3 | 1 | 1 | 5 | 4/10 |
| Input sanitization | 10 | 9 | 1 | 6 | 5/10 |

**Overall Security Use Case Score: 5.2/10**

The LiBrainian is currently **not suitable** for comprehensive security audits without significant improvements to security-domain retrieval.
