# M2/M3/M4 Scope Freeze

**Effective**: 2026-02-27 | **Issue**: #864 | **Rationale**: docs/LiBrainian/DIAGNOSIS_AND_PLAN.md

## Status

M2 (Agent Integration), M3 (Scale & Epistemics), and M4 (World-Class) are **frozen**.
No new issues may be filed against these milestones. No work may begin on them.

## Why

The product does not work at M0. Measured reality (2026-02-22):

- Embedding coverage: 1.6% (target: ~100%)
- Context Precision: 15.6% (target: 70%)
- Hallucination Rate: 40.3% (target: <5%)
- NPS: 4, 0% would-recommend

Building M2+ features on a broken M0 makes the problem worse, not better.

## What Must Happen First

All work must focus on M0 (Dogfood-Ready) and M1 (Construction MVP).

M0 success metrics (unfreeze preconditions):
1. T0.5 smoke test passes on real embeddings (not mocked)
2. LLM synthesis works via API transport fallback (#855)
3. Embedding coverage >= 80% after xenova migration (#866)
4. Patrol NPS >= 6 on a fresh repo
5. No CRITICAL-severity patrol findings on core query/bootstrap

## When to Unfreeze

A human decision is required. When all M0 success metrics above are met, the milestone freeze
may be lifted. Agents may not unfreeze milestones unilaterally.

## Patrol Enforcement

The patrol agent should flag any new issue filed against M2/M3/M4 as a policy violation.
See #864 and #853 for patrol enforcement details.
