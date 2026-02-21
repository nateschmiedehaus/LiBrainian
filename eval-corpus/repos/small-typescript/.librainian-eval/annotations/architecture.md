# Architecture Notes — Small TypeScript Fixture

## Overview
The fixture models a minimal library lending system with a clean, layered architecture:

- **Controllers** enforce role checks and delegate to services.
- **Services** implement domain behavior (users, books, loans, audits).
- **Repositories** provide CRUD operations over an in-memory database.
- **Auth** manages sessions and role authorization.
- **Policy** modules capture checkout rules and rate limits.
- **Reporting** builds overdue summaries.
- **Utils/Config** provide shared helpers and constants.

## Layering & Dependencies

1. **Controllers** (`src/controllers/*`) depend on auth and services.
2. **Services** depend on repositories, policy modules, and utilities.
3. **Repositories** depend only on the in-memory database.
4. **Data** (`src/data/db.ts`) stores state arrays for users, books, loans, sessions, and audits.

The dependency flow is intentionally one-directional: controllers → services → repositories → data.

## Key Workflows

### Checkout flow
1. `loanController.checkout` validates role and calls `loanService.checkoutBook`.
2. `loanService.checkoutBook` applies rate limiting and loan policy checks.
3. If allowed, a loan is created and inventory is decremented.
4. A loan receipt is sent and an audit event is recorded.

### Overdue reporting
1. `loanController.overdueReport` gathers open loans.
2. `reporting/overdueReport` filters loans beyond the grace period.
3. The report joins user and book information for display.
