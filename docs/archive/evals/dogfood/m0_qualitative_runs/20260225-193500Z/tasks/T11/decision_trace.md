# Decision Trace — T11

- task: Investigate flaky behavior under constrained memory.
- used_librarian: no
- skip_reason: low_uncertainty
- why_skip_was_right: resource guard behavior and worker reduction path were already directly observable in test/runtime telemetry.
- what_would_make_librarian_more_useful: built-in constrained-resource flake diagnosis preset with top candidate causes.
- counterfactual: direct deterministic diagnosis remained fastest and sufficient.
