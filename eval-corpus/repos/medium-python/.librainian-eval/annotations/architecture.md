# Medium Python Incident Tracker

## Overview
- Tickets are created through service.open_ticket, which enforces rate limits,
  policy checks, severity classification, and audit logging.
- Assignment happens via service.assign_ticket_flow using triage.assign_ticket
  and notifications.send_assignment_notice.

## Data Model
- models.User, models.Ticket, models.TokenRecord, and models.AuditEvent define
  the core data shapes.
- store.InMemoryStore is the singleton data layer holding users, tickets,
  tokens, audits, and rate limit state.

## Security and Limits
- auth.authenticate checks token expiry and user active state.
- rate_limit.check_rate_limit enforces a per-minute request ceiling.
