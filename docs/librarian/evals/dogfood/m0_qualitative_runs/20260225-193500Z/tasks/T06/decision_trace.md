# Decision Trace — T06

- task: Validate legacy alias execution path for patrol-process.
- used_librarian: no
- skip_reason: deterministic_edit
- why_skip_was_right: deterministic CLI alias behavior with existing tests already scoped to target path.
- what_would_make_librarian_more_useful: automatic alias-to-runtime wiring diff view for regression checks.
- counterfactual: query overhead unlikely to improve decision quality for this narrow check.
