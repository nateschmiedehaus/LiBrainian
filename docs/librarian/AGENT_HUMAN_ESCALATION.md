# Agent Human Escalation (`request_human_review`)

## Why this exists
LiBrainian implements a first-class human escalation tool to support 12-Factor Agents Factor 7: contact humans through tool calls.  
Instead of ad-hoc prose warnings, agents can emit a structured escalation event that is auditable and consistent.

## Tool contract
`request_human_review` accepts:
- `reason`
- `context_summary`
- `proposed_action`
- `confidence_tier` (`low` | `uncertain`)
- `risk_level` (`low` | `medium` | `high`)
- `blocking` (`true` pauses workflow intent, `false` advisory)

It returns:
- `review_request_id`
- `status` (`pending` for blocking, `advisory` otherwise)
- `human_readable_summary`
- `blocking`
- `expires_in_seconds`

## When agents should call it
Use `request_human_review` when continuing without confirmation could cause costly or unsafe mistakes:
- Low or uncertain retrieval confidence for a high-impact action.
- Repeated retrieval loops with unresolved ambiguity.
- Security-sensitive intent (auth, tokens, secrets, permissions, deletion) with sub-strong confidence.
- Stale index state while planning write-oriented changes.

## Query-side recommendation path
`query` may include `humanReviewRecommendation` (and `human_review_recommendation`) to suggest calling `request_human_review`.  
This is a recommendation, not a forced block, so orchestration layers keep control flow authority.

## Audit trail
Every `request_human_review` invocation appends an entry to:
- `.librainian/audit-log.jsonl`

Each entry includes timestamp, review id, reason, pending outcome, confidence tier, risk level, action summary, and workspace root.
