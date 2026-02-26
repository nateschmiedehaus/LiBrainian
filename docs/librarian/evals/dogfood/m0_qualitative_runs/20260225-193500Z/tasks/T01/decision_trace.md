# Decision Trace — T01

- task: Bootstrap intermittently exits before useful context.
- used_librarian: yes
- uncertainty: high (index/bootstrap + cross-file behavior)
- query_intent: "Users report bootstrap intermittently exits before useful context appears"
- output_quality: partial
- what_changed_due_to_librarian: prioritized bootstrap quality gate path before broader refactor ideas.
- counterfactual_without_librarian: would likely inspect wider surface first and take longer to isolate gate behavior.
- follow_up: keep bootstrap error taxonomy explicit to preserve quick triage.
